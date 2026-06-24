import { NextResponse } from 'next/server';
import { getTidb } from '@/lib/tidb/client';
import { embed, vecLit } from '@/lib/openai/embed';
import { parseQuery, ParsedQuery } from '@/lib/openai/parseQuery';
import { buildHybridSearchSQL, computeHybridScore } from '@/lib/search/buildSql';
import { rerankWithMem9 } from '@/lib/search/rerankWithMem9';
import type { ScoredPlayer } from '@/lib/search/types';

// mem0 SDK が Edge 不可のため一旦 Node ランタイムで運用
export const runtime = 'nodejs';

type Body = {
  raw_query?: string;     // AI 自動入力モード: 1本のNL文
  parsed?: unknown;       // 3カラム手動モード: { filters, semantic_query, keywords }
};

export async function POST(req: Request) {
  const started = Date.now();
  const body = (await req.json()) as Body;
  const userId = process.env.NEXT_PUBLIC_DEMO_USER_ID || 'demo-user';

  // 1) parsed が直接渡されたらそれを使う、なければ raw_query を gpt-4o-mini で構造化
  let parsed: ParsedQuery;
  let rawQueryForHistory: string;
  if (body.parsed && typeof body.parsed === 'object') {
    parsed = ParsedQuery.parse(body.parsed);
    rawQueryForHistory = `[manual] ${parsed.semantic_query || ''} | ${(parsed.keywords ?? []).join(',')}`;
  } else if (body.raw_query && body.raw_query.trim()) {
    parsed = await parseQuery(body.raw_query);
    rawQueryForHistory = body.raw_query;
  } else {
    return NextResponse.json({ error: 'raw_query または parsed が必要です' }, { status: 400 });
  }

  // 2) 意味検索文を埋め込み (空なら raw_query を fallback)
  const semanticForEmbed = parsed.semantic_query?.trim() || rawQueryForHistory;
  const embedding = await embed(semanticForEmbed);
  const embLit = vecLit(embedding);

  // 3) ハイブリッド検索 SQL を実行 / hybrid_score は Node で合成
  const { sql, bindings } = buildHybridSearchSQL(parsed, embLit, 50);
  const rawRows = (await getTidb().execute(sql, bindings)) as unknown as Record<string, unknown>[];
  const rows: ScoredPlayer[] = rawRows
    .map((r) => {
      const o: any = { ...r };
      o.vec_score = Number(o.vec_score) || 0;
      o.text_score = Number(o.text_score) || 0;
      o.quant_score = 1.0;
      o.hybrid_score = computeHybridScore(o);
      return o as ScoredPlayer;
    })
    .sort((a, b) => b.hybrid_score - a.hybrid_score);

  // 4) mem9 でリランク
  const reranked = await rerankWithMem9(userId, semanticForEmbed, rows);

  // 5) search_history へ INSERT (失敗してもメイン応答には影響させない)
  try {
    await getTidb().execute(
      'INSERT INTO search_history (user_id, raw_query, parsed_json) VALUES (?, ?, ?)',
      [userId, rawQueryForHistory, JSON.stringify(parsed)],
    );
  } catch (e) {
    console.warn('[search_history insert failed]', e);
  }

  return NextResponse.json({
    parsed,
    sql,
    bindings: bindings.map((b) =>
      typeof b === 'string' && b.startsWith('[') && b.length > 200 ? `<vector ${b.split(',').length} dims>` : b,
    ),
    embedding_head: embedding.slice(0, 8),
    results: reranked,
    elapsed_ms: Date.now() - started,
  });
}

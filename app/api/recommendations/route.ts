import { NextResponse } from 'next/server';
import { getTidb } from '@/lib/tidb/client';
import { embed, vecLit } from '@/lib/openai/embed';
import { getMem9 } from '@/lib/mem9/client';

export const runtime = 'nodejs';

// mem9 が学んだお気に入り傾向の文字列をクエリにして類似度上位を返す
export async function GET() {
  const userId = process.env.NEXT_PUBLIC_DEMO_USER_ID || 'demo-user';
  const mem9 = getMem9();

  let queryText = '';
  if (mem9.enabled) {
    const memories = await mem9.search('お気に入り傾向', userId, 5);
    queryText = memories.map((m) => m.memory).join('\n');
  }
  // mem9 が空 or 無効ならお気に入りからレポート文を集めてフォールバック
  if (!queryText) {
    const favs = (await getTidb().execute(
      `SELECT p.report_text
       FROM favorites f JOIN players p ON p.id = f.player_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC
       LIMIT 5`,
      [userId],
    )) as any[];
    queryText = favs.map((r: any) => r.report_text).join('\n');
  }
  if (!queryText) {
    return NextResponse.json({ source: 'empty', results: [] });
  }

  const emb = await embed(queryText);
  const rows = (await getTidb().execute(
    `SELECT id, name, nationality, club, position, foot, age, overall_rating, report_text,
            1 - VEC_COSINE_DISTANCE(report_embedding, ?) AS vec_score
     FROM players
     WHERE id NOT IN (SELECT player_id FROM favorites WHERE user_id = ?)
     ORDER BY vec_score DESC
     LIMIT 20`,
    [vecLit(emb), userId],
  )) as any[];

  return NextResponse.json({
    source: mem9.enabled ? 'mem9' : 'favorites_text',
    results: rows,
  });
}

import { NextResponse } from 'next/server';
import { parseQuery } from '@/lib/openai/parseQuery';

export const runtime = 'nodejs';

// 自然言語 → { filters, semantic_query, keywords } の構造化のみ実行。
// 3カラム入力UIから「文章から自動入力」ボタンを押したときに使う。
export async function POST(req: Request) {
  const { raw_query } = (await req.json()) as { raw_query?: string };
  if (!raw_query || !raw_query.trim()) {
    return NextResponse.json({ error: 'raw_query is required' }, { status: 400 });
  }
  const parsed = await parseQuery(raw_query);
  return NextResponse.json({ parsed });
}

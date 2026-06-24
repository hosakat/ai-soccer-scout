import { NextResponse } from 'next/server';
import { getTidb } from '@/lib/tidb/client';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const pid = parseInt(id, 10);
  if (!Number.isFinite(pid)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const r = (await getTidb().execute('SELECT * FROM players WHERE id = ?', [pid])) as any[];
  const player = r[0];
  if (!player) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 類似5件: 同 player の embedding に対して cosine 距離が小さい他の player を取る
  const similar = (await getTidb().execute(
    `SELECT id, name, nationality, club, position, foot, age, overall_rating, report_text,
            1 - VEC_COSINE_DISTANCE(report_embedding,
              (SELECT report_embedding FROM players WHERE id = ?)) AS vec_score
     FROM players
     WHERE id <> ?
     ORDER BY vec_score DESC
     LIMIT 5`,
    [pid, pid],
  )) as any[];

  return NextResponse.json({ player, similar });
}

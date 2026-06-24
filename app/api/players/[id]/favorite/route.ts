import { NextResponse } from 'next/server';
import { getTidb } from '@/lib/tidb/client';
import { getMem9 } from '@/lib/mem9/client';

export const runtime = 'nodejs';

const userId = () => process.env.NEXT_PUBLIC_DEMO_USER_ID || 'demo-user';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const pid = parseInt(id, 10);
  if (!Number.isFinite(pid)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const u = userId();

  const r = (await getTidb().execute('SELECT id, name, nationality, position, foot, report_text FROM players WHERE id = ?', [pid])) as any[];
  const player = r[0];
  if (!player) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await getTidb().execute(
    'INSERT IGNORE INTO favorites (user_id, player_id) VALUES (?, ?)',
    [u, pid],
  );

  // mem9 にお気に入り情報を保存（ユーザーの好み学習用）
  const mem9 = getMem9();
  await mem9.add({
    userId: u,
    messages: [
      { role: 'user', content: `${player.name} (${player.position}, ${player.nationality}) をお気に入り登録` },
      { role: 'user', content: `理由メモ: ${String(player.report_text).slice(0, 200)}` },
    ],
    metadata: { player_id: pid, position: player.position, foot: player.foot },
  });

  return NextResponse.json({ ok: true, mem9_enabled: mem9.enabled });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const pid = parseInt(id, 10);
  if (!Number.isFinite(pid)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const u = userId();

  await getTidb().execute('DELETE FROM favorites WHERE user_id = ? AND player_id = ?', [u, pid]);
  const mem9 = getMem9();
  await mem9.delete(u, pid);
  return NextResponse.json({ ok: true });
}

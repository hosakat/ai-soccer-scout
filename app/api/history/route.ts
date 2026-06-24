import { NextResponse } from 'next/server';
import { getTidb } from '@/lib/tidb/client';

export const runtime = 'nodejs';

export async function GET() {
  const userId = process.env.NEXT_PUBLIC_DEMO_USER_ID || 'demo-user';
  const rows = (await getTidb().execute(
    `SELECT id, raw_query, parsed_json, created_at
     FROM search_history
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId],
  )) as any[];

  const favs = (await getTidb().execute(
    `SELECT f.player_id, p.name, p.nationality, p.position, p.foot, p.age, p.overall_rating, f.created_at
     FROM favorites f JOIN players p ON p.id = f.player_id
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC`,
    [userId],
  )) as any[];

  return NextResponse.json({ history: rows, favorites: favs });
}

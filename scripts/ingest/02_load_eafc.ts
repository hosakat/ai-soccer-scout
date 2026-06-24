// Kaggle "EA Sports FC 25" male_players.csv から必要列のみ抽出
// 入力 (要手動DL): data/raw/male_players.csv
// 出力: data/intermediate/eafc25.json
//
// 想定列 (Kaggle datasets nyagami/ea-sports-fc-25-database 系の一般的なヘッダ):
//   short_name, long_name, age, height_cm, weight_kg, club_name,
//   nationality_name, overall, pace, shooting, passing, dribbling,
//   defending, physic, preferred_foot, player_positions
//   ※ パス成功率は attacking_short_passing が代用列。
//
// データセットによって列名が微妙に違う可能性があるため、見つからない列は null で吸収。

import { parse } from 'csv-parse/sync';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const IN = resolve(process.cwd(), 'data/raw/male_players.csv');
const OUT = resolve(process.cwd(), 'data/intermediate/eafc25.json');

type EaPlayer = {
  short_name: string;
  long_name: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  club_name: string | null;
  nationality_name: string;
  overall: number | null;
  pace: number | null;
  shooting: number | null;
  passing: number | null;
  dribbling: number | null;
  defending: number | null;
  physic: number | null;
  pass_accuracy: number | null; // attacking_short_passing
  preferred_foot: 'Left' | 'Right' | null;
  player_positions: string[];   // ["ST","LW"]
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function foot(v: unknown): 'Left' | 'Right' | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'left') return 'Left';
  if (t === 'right') return 'Right';
  return null;
}

function main() {
  if (!existsSync(IN)) {
    console.error(`[error] input CSV not found: ${IN}`);
    console.error('  Kaggle "EA Sports FC 25 Database" の male_players.csv をDLして data/raw/ に置いてください');
    process.exit(1);
  }
  const buf = readFileSync(IN, 'utf8');
  // ヘッダで自動マッピング、不明列はそのまま、空セルは null として扱う
  const rows = parse(buf, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

  // CSV には複数 fifa_version × update_as_of の履歴行が含まれる。
  // 同一 player_id について最新 (fifa_version, update_as_of) を1件だけ残す。
  const latestByPid = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const pid = r.player_id;
    if (!pid) continue;
    const cur = latestByPid.get(pid);
    if (!cur) { latestByPid.set(pid, r); continue; }
    const a = `${cur.fifa_version ?? ''}|${cur.update_as_of ?? ''}`;
    const b = `${r.fifa_version ?? ''}|${r.update_as_of ?? ''}`;
    if (b > a) latestByPid.set(pid, r);
  }
  const latest = [...latestByPid.values()];
  console.log(`[info] ${rows.length} raw rows → ${latest.length} latest unique players`);

  const out: EaPlayer[] = latest.map((r) => ({
    short_name: r.short_name ?? '',
    long_name: r.long_name ?? r.short_name ?? '',
    age: num(r.age),
    height_cm: num(r.height_cm),
    weight_kg: num(r.weight_kg),
    club_name: r.club_name || null,
    nationality_name: r.nationality_name ?? '',
    overall: num(r.overall),
    pace: num(r.pace),
    shooting: num(r.shooting),
    passing: num(r.passing),
    dribbling: num(r.dribbling),
    defending: num(r.defending),
    physic: num(r.physic),
    pass_accuracy: num(r.attacking_short_passing ?? r.passing),
    preferred_foot: foot(r.preferred_foot),
    player_positions: (r.player_positions ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  })).filter((p) => p.long_name);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ ${out.length} players written to ${OUT}`);
  console.log('  sample:', JSON.stringify(out[0], null, 2));
}

main();

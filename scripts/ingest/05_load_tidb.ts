// players_with_reports.jsonl を TiDB へバッチ INSERT
// 入力: data/intermediate/players_with_reports.jsonl
// 100件ずつ multi-row INSERT、ベクトルは '[0.012,...]' 文字列でバインド

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();
import { connect } from '@tidbcloud/serverless';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.TIDB_DATABASE_URL) {
  console.error('[error] TIDB_DATABASE_URL が未設定です');
  process.exit(1);
}

const conn = connect({ url: process.env.TIDB_DATABASE_URL });
const IN = resolve(process.cwd(), 'data/intermediate/players_with_reports.jsonl');
const BATCH = 50; // VECTOR(1536) で行あたり 6KB 弱、50行/バッチでも十分速い

type In = {
  external_key: string;
  name: string;
  country: string;
  club: string;
  pos: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  overall_rating: number | null;
  pace: number | null;
  shooting: number | null;
  passing: number | null;
  dribbling: number | null;
  defending: number | null;
  physic: number | null;
  pass_accuracy: number | null;
  preferred_foot: 'Left' | 'Right' | 'Both';
  report_text: string;
  report_embedding: number[];
};

function vecLit(v: number[]): string {
  // Float32 程度の精度で十分。'[0.012345,-0.00321,...]'
  return '[' + v.map((x) => x.toFixed(6)).join(',') + ']';
}

async function main() {
  const buf = readFileSync(IN, 'utf8');
  const rows: In[] = buf.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  console.log(`[info] inserting ${rows.length} rows in batches of ${BATCH}`);

  // 既存データはクリア（毎回フル再投入する設計。冪等性は external_key UNIQUE で担保するならON DUPLICATE）
  await conn.execute('DELETE FROM players');

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const placeholders = slice.map(
      () => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).join(',');
    const sql =
      `INSERT INTO players
        (external_key, name, nationality, club, position, foot, age,
         height_cm, weight_kg, overall_rating,
         pace, shooting, passing, dribbling, defending, physic, pass_accuracy,
         report_text, report_embedding)
       VALUES ${placeholders}`;
    const params: any[] = [];
    for (const r of slice) {
      params.push(
        r.external_key,
        r.name,
        r.country,
        r.club,
        r.pos,
        r.preferred_foot,
        r.age ?? 0,
        r.height_cm,
        r.weight_kg,
        r.overall_rating,
        r.pace, r.shooting, r.passing, r.dribbling, r.defending, r.physic,
        r.pass_accuracy,
        r.report_text,
        vecLit(r.report_embedding),
      );
    }
    await conn.execute(sql, params);
    total += slice.length;
    console.log(`  ${total}/${rows.length}`);
  }

  // ANALYZE TABLE は TiDB Cloud Serverless では非対応（DCL 扱いで弾かれる）
  // 統計は自動収集されるので明示は不要

  const cnt = await conn.execute('SELECT COUNT(*) AS c FROM players');
  console.log('✓ COUNT(*) =', cnt);
}

main().catch((e) => { console.error(e); process.exit(1); });

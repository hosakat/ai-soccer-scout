// db/migrations/*.sql を順番に流す軽量マイグレータ
// CREATE TABLE IF NOT EXISTS を前提に冪等で動かす（履歴テーブルは持たない）

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv(); // .env をフォールバックで読む
import { connect } from '@tidbcloud/serverless';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.TIDB_DATABASE_URL) {
  console.error('[error] TIDB_DATABASE_URL が未設定です');
  process.exit(1);
}

const conn = connect({ url: process.env.TIDB_DATABASE_URL });
const dir = resolve(process.cwd(), 'db/migrations');

async function main() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const raw = readFileSync(resolve(dir, f), 'utf8');
    // 行頭 `-- ...` コメントを行単位で除去 (各行ではなく文ごとの startsWith は誤動作する)
    const sql = raw
      .split('\n')
      .filter((line) => !/^\s*--/.test(line))
      .join('\n');
    // ; で分割して実行 (Serverless Driver は multi-statement 非対応)
    const stmts = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter((s) => s.length > 0);
    console.log(`[migrate] ${f} (${stmts.length} statements)`);
    for (const stmt of stmts) {
      try {
        await conn.execute(stmt);
        console.log(`  ok: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`);
      } catch (e: any) {
        console.error(`  ✗ failed:\n----\n${stmt}\n----\nerror:`, e.message, JSON.stringify(e.details));
        throw e;
      }
    }
  }
  // 確認
  const tables = await conn.execute('SHOW TABLES');
  console.log('✓ tables:', tables);
  const idx = await conn.execute('SHOW INDEX FROM players');
  console.log('✓ players indexes:', (idx as any[]).map((r: any) => `${r.Key_name}(${r.Index_type})`).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });

import { connect } from '@tidbcloud/serverless';

type Conn = ReturnType<typeof connect>;
let cached: Conn | null = null;

export function getTidb(): Conn {
  if (cached) return cached;
  if (!process.env.TIDB_DATABASE_URL) {
    throw new Error('TIDB_DATABASE_URL が未設定です。.env.local を確認してください');
  }
  cached = connect({ url: process.env.TIDB_DATABASE_URL });
  return cached;
}

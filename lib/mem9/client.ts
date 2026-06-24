// mem9 (mem0) クライアントのラッパ
// 実 SDK は mem0ai v3。API キー未設定の場合は no-op で動かして mem9 機能が無くてもアプリが落ちないようにする。
//
// mem0ai v3 のシグネチャ:
//   import MemoryClient from 'mem0ai';
//   const client = new MemoryClient({ apiKey });
//   await client.add(messages, { userId, metadata });
//   const r = await client.search(query, { userId, topK });
//   await client.delete(memoryId);

type AddArgs = {
  userId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata?: Record<string, unknown>;
};
type SearchHit = { memory: string; score?: number };

export type Mem9Client = {
  enabled: boolean;
  add(args: AddArgs): Promise<void>;
  search(query: string, userId: string, topK?: number): Promise<SearchHit[]>;
  delete(userId: string, playerId: number): Promise<void>;
};

let cached: Mem9Client | null = null;

export function getMem9(): Mem9Client {
  if (cached) return cached;
  const apiKey = process.env.MEM9_API_KEY;
  if (!apiKey) {
    cached = noop();
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('mem0ai');
    const MemoryClient = mod.MemoryClient ?? mod.default;
    const client = new MemoryClient({ apiKey });
    cached = {
      enabled: true,
      async add({ userId, messages, metadata }) {
        try {
          const r = await client.add(messages, { userId, metadata });
          console.log('[mem9.add] ok', { userId, count: Array.isArray(r) ? r.length : '?' });
        } catch (e) {
          console.warn('[mem9.add] failed:', e);
        }
      },
      async search(query, userId, topK = 10) {
        try {
          // 注意: search() は add() と違い filters: { user_id } を要求 (SDK 仕様差)
          const r: any = await client.search(query, { filters: { user_id: userId }, topK });
          const list: any[] = Array.isArray(r) ? r : (r?.results ?? r?.memories ?? []);
          return list.map((x) => ({ memory: x.memory ?? x.text ?? x.data?.memory ?? '', score: x.score }));
        } catch (e) {
          console.warn('[mem9.search] failed:', e);
          return [];
        }
      },
      async delete(userId, playerId) {
        try {
          const r: any = await client.search(String(playerId), { filters: { user_id: userId }, topK: 5 });
          const list: any[] = Array.isArray(r) ? r : (r?.results ?? []);
          for (const x of list) {
            if (x?.id) await client.delete(x.id);
          }
        } catch (e) {
          console.warn('[mem9.delete] failed:', e);
        }
      },
    };
  } catch (e) {
    console.warn('[mem9] mem0ai のロードに失敗。no-op で動作します:', e);
    cached = noop();
  }
  return cached!;
}

function noop(): Mem9Client {
  return {
    enabled: false,
    async add() {},
    async search() { return []; },
    async delete() {},
  };
}

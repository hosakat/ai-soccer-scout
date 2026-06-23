# AI Soccer Scout — SPEC.md

## 1. システム概要

「次世代サッカースカウトAI」は、2026 FIFA W杯出場 48カ国・最大1248選手を対象に、自然言語クエリ1本で **数値条件 (SQL) × 意味検索 (ベクトル) × キーワード (全文検索)** を **TiDB Cloud Serverless の単一 SQL** で実行するスカウティング支援アプリ。

**主要ユースケース:**
1. **複合条件スカウティング**: 「身長180cm以上、パス成功率80%以上、25歳以下、左足が正確で中盤の底からゲームを作れる、リーダーシップ」のような自然言語クエリから候補リスト＋根拠スコア＋実行SQLを返す。
2. **パーソナライズドレコメンド**: お気に入り登録した選手の傾向を mem0 (本記事内では mem9 と表記) が学習し、新規クエリ結果を再ランキングする。
3. **クエリ説明性デモ**: 生成された実 SQL とフィルタ JSON、各候補の `quant_score / vec_score / text_score / hybrid_score` をデバッガーパネルに表示する。

**想定読者 (記事映え):** TiDB のハイブリッド検索を本番サービス級コードで読みたい Web エンジニア／LLM × DB に関心のあるアプリ開発者。

---

## 2. アーキテクチャ

```
Browser (React / Next.js App Router)
   │ fetch
   ▼
Next.js Route Handlers (runtime: 'edge')
   ├─▶ OpenAI gpt-4o-mini  (NL → {filters, semantic_query, keywords} を structured output で抽出)
   ├─▶ OpenAI text-embedding-3-small (semantic_query を 1536 次元化)
   ├─▶ TiDB Cloud Serverless  via @tidbcloud/serverless  (1 クエリでハイブリッド検索)
   └─▶ mem9 (mem0)  via mem0ai SDK  (お気に入り傾向の add / search → 再ランキング)
```

**取り込みバッチ (一回限り、`scripts/ingest/`):**

```
Wikipedia 2026 FIFA WC squads (cheerio scrape)
        │
        ▼ JSON (国別ロースター)
Kaggle EA Sports FC 25 dataset (CSV を data/raw/ に手動配置)
        │
        ▼ 選手名 fuzzy match (fuse.js / Levenshtein)
正規化済 players JSON
        │
        ▼ gpt-4o-mini で日本語スカウティングレポート (300〜500字) 生成
        ▼ text-embedding-3-small で 1536 次元埋め込み
        ▼ @tidbcloud/serverless で BATCH INSERT
TiDB Cloud Serverless
```

---

## 3. データモデル (TiDB スキーマ)

> 参考: TiDB の `VECTOR(N)`, `VECTOR INDEX ... USING HNSW`, `FULLTEXT INDEX ... WITH PARSER MULTILINGUAL`, `fts_match_word()` は TiDB Cloud Serverless 公式ドキュメント (2025年5月の Full-text search beta リリース、`/ai/reference/vector-search-index`, `/ai/guides/vector-search-full-text-search-sql`) に基づく。

```sql
-- 選手基本情報 + 数値スタッツ + スカウティングレポート (1テーブルに同居させて JOIN を避ける)
CREATE TABLE players (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  external_key    VARCHAR(128) NOT NULL,           -- "Kylian Mbappé|FRA" など正規化キー
  name            VARCHAR(128) NOT NULL,
  name_kana       VARCHAR(128),                    -- 日本語表示用 (TODO: 取り込み時に再確認、Wikipedia ja から拾えるか)
  nationality     VARCHAR(64)  NOT NULL,           -- ISO国コードではなく "France" 等の表示名
  club            VARCHAR(128),
  position        VARCHAR(16)  NOT NULL,           -- GK/CB/LB/RB/DM/CM/AM/LW/RW/ST
  foot            ENUM('Left','Right','Both') NOT NULL,
  age             TINYINT UNSIGNED NOT NULL,
  height_cm       SMALLINT UNSIGNED NOT NULL,
  weight_kg       SMALLINT UNSIGNED,
  overall_rating  TINYINT UNSIGNED NOT NULL,       -- EA FC 25 の OVR
  pace            TINYINT UNSIGNED,
  shooting        TINYINT UNSIGNED,
  passing         TINYINT UNSIGNED,
  dribbling       TINYINT UNSIGNED,
  defending       TINYINT UNSIGNED,
  physic          TINYINT UNSIGNED,
  pass_accuracy   TINYINT UNSIGNED,                -- 0-100
  -- スカウティングレポート (LLM生成、日本語、300-500字)
  report_text     TEXT NOT NULL,
  report_embedding VECTOR(1536) NOT NULL COMMENT 'text-embedding-3-small',

  KEY idx_age (age),
  KEY idx_rating (overall_rating),
  KEY idx_position (position),
  KEY idx_foot (foot),
  KEY idx_pass_acc (pass_accuracy),
  KEY idx_height (height_cm),
  UNIQUE KEY uk_external_key (external_key),

  -- 全文検索 (TiDB Cloud Serverless beta、多言語パーサで日本語OK)
  FULLTEXT INDEX ft_report (report_text) WITH PARSER MULTILINGUAL,

  -- HNSW ベクトルインデックス (cosine)
  VECTOR INDEX idx_report_vec ((VEC_COSINE_DISTANCE(report_embedding))) USING HNSW
);
```

```sql
-- お気に入り (UI/履歴用。mem9 がレコメンドの主役なので最小構造)
CREATE TABLE favorites (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     VARCHAR(64) NOT NULL,                -- 単一ユーザーデモなら 'demo-user' 固定
  player_id   INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_player (user_id, player_id),
  KEY idx_user (user_id),
  CONSTRAINT fk_fav_player FOREIGN KEY (player_id) REFERENCES players(id)
);

-- 検索履歴 (デバッガーパネル & mem9 補助)
CREATE TABLE search_history (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     VARCHAR(64) NOT NULL,
  raw_query   TEXT NOT NULL,
  parsed_json JSON NOT NULL,                       -- {filters, semantic_query, keywords}
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, created_at)
);
```

> 1 クエリで `WHERE age <= 25 AND overall_rating >= 80 AND fts_match_word('リーダーシップ', report_text) ORDER BY VEC_COSINE_DISTANCE(report_embedding, ?) LIMIT 20` が成立する。後述 §5 でハイブリッドスコア計算を含む CTE 版を示す。

---

## 4. データパイプライン (一回限りバッチ)

`scripts/ingest/` 配下に置き `pnpm tsx scripts/ingest/run.ts` で順次実行。

**ステップ1: Wikipedia 2026 FIFA World Cup squads スクレイピング**
- `cheerio` + `undici` で `https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads` を取得。
- 各国セクションの `<table class="wikitable">` から `No / Pos / Player / DoB(age) / Caps / Goals / Club` を抽出。
- 出力: `data/intermediate/squads.json` (約1248行)。

**ステップ2: Kaggle EA Sports FC 25 dataset**
- `data/raw/male_players.csv` を手動DL (取り込みバッチは API 化しない)。
- `csv-parse/sync` で読み込み、必要列のみ抽出 (`short_name, long_name, age, height_cm, weight_kg, club_name, nationality_name, overall, pace, shooting, passing, dribbling, defending, physic, preferred_foot, player_positions, attacking_short_passing` など)。

**ステップ3: 選手名 fuzzy マッチング**
- `fuse.js` で `long_name + nationality` をキーに正規化マッチ (threshold 0.3)。
- マッチ失敗 (架空候補・引退・新人) は `data/intermediate/unmatched.json` にログ。手動補正リスト (`data/manual/aliases.json`) を二段目で適用。
- 期待マッチ率: 1248 名中 90% 以上 (TODO: 取り込み時に再確認、補完不能な場合は OVR を国内リーグ平均で代替)。

**ステップ4: スカウティングレポート生成 + 埋め込み**
- 1選手につき以下プロンプトで `gpt-4o-mini` を呼ぶ:
  ```
  system: あなたはサッカーのプロスカウト。以下の数値プロファイルから、日本語で300〜500字のスカウティングレポートを書きなさい。
          プレースタイル/強み/弱点/起用法/性格傾向(リーダーシップ等)に必ず触れること。
  user:   {name, position, age, foot, height_cm, weight_kg, overall, pace, shooting, passing, dribbling, defending, physic, club, nationality}
  ```
- `response_format: { type: 'json_schema', strict: true }` で `{ report_text: string }` を返す。
- 続けて `text-embedding-3-small` で `report_text` を 1536 次元化。
- レート制御: `p-limit` で並列度 8、429 時は exponential backoff (max 5 retry)。中間結果は 50件ごとに JSONL でチェックポイント書き出し (再開可能)。

**ステップ5: TiDB へバッチ INSERT**
- `@tidbcloud/serverless` で 100件ずつ multi-row INSERT。
- ベクトルは `'[0.012, -0.003, ...]'` 形式の文字列でバインド (TiDB の VECTOR 型は文字列リテラル受理)。
- 投入後、`ANALYZE TABLE players` を実行。

> **実装注記 (執筆スコープ)**: 初期投入は記事執筆短縮のため 2026 W杯 グループF/G/H/I の4グループ（16カ国・約416名）に絞る。本SPECの設計（スキーマ・検索SQL・UI）は48カ国・1248名スケールで動作するよう書かれており、残選手データは記事公開後に追加投入する。

---

## 5. ハイブリッド検索ロジック

### ステップA: 自然言語 → 構造化 (gpt-4o-mini structured output)

```ts
// lib/search/parseQuery.ts
import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const openai = new OpenAI();

const ParsedQuery = z.object({
  filters: z.object({
    age_max: z.number().int().nullable(),
    age_min: z.number().int().nullable(),
    height_min: z.number().int().nullable(),
    overall_min: z.number().int().nullable(),
    pass_accuracy_min: z.number().int().nullable(),
    position: z.array(z.string()).nullable(),
    foot: z.enum(['Left', 'Right', 'Both']).nullable(),
    nationality: z.array(z.string()).nullable(),
  }),
  semantic_query: z.string(),   // 例: "左足が正確で中盤の底からゲームを作れる"
  keywords: z.array(z.string()),// 例: ["リーダーシップ"]
});

export type ParsedQuery = z.infer<typeof ParsedQuery>;

export async function parseQuery(raw: string): Promise<ParsedQuery> {
  const completion = await openai.chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'サッカースカウトの自然言語要望を、SQLフィルタ/意味検索文/全文検索キーワードに分解せよ。該当なしは null。' },
      { role: 'user', content: raw },
    ],
    response_format: zodResponseFormat(ParsedQuery, 'parsed_query'),
  });
  return completion.choices[0].message.parsed!;
}
```

### ステップB: 埋め込み

```ts
// lib/openai/embed.ts
export async function embed(text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return r.data[0].embedding; // 1536 次元
}
```

### ステップC: 1 クエリでハイブリッド検索 (CTE)

`vec_score = 1 - VEC_COSINE_DISTANCE` (0-1, 大きいほど近い)、`text_score = fts_match_word(...)` (BM25 相対値)、`quant_score` はフィルタの厳しさで合致するほど 1.0 寄り、`hybrid_score` は重み付き和。

```sql
-- :emb は '[0.01, ...]' 形式の文字列、:kw はスペース区切り全文検索語
WITH base AS (
  SELECT
    id, name, name_kana, nationality, club, position, foot,
    age, height_cm, overall_rating, pass_accuracy, report_text,
    1 - VEC_COSINE_DISTANCE(report_embedding, :emb) AS vec_score,
    CASE WHEN :kw = '' THEN 0
         ELSE fts_match_word(:kw, report_text)
    END AS text_score
  FROM players
  WHERE
    (:age_max       IS NULL OR age            <= :age_max)
    AND (:age_min   IS NULL OR age            >= :age_min)
    AND (:height_min IS NULL OR height_cm     >= :height_min)
    AND (:ovr_min   IS NULL OR overall_rating >= :ovr_min)
    AND (:pa_min    IS NULL OR pass_accuracy  >= :pa_min)
    AND (:foot      IS NULL OR foot            = :foot)
    AND (:position_csv IS NULL OR FIND_IN_SET(position, :position_csv) > 0)
    AND (:nation_csv   IS NULL OR FIND_IN_SET(nationality, :nation_csv) > 0)
    AND (:kw = '' OR fts_match_word(:kw, report_text))
),
scored AS (
  SELECT
    *,
    1.0 AS quant_score,                              -- フィルタを通過した時点で 1.0 (UI 表示用)
    (0.55 * vec_score
     + 0.30 * LEAST(text_score / 5.0, 1.0)          -- BM25 スコアを 0-1 に粗く正規化
     + 0.15 * (overall_rating / 100.0)) AS hybrid_score
  FROM base
)
SELECT *
FROM scored
ORDER BY hybrid_score DESC
LIMIT 50;
```

> TODO: 取り込み時に再確認 — `fts_match_word` のスコアレンジは BM25 で文書集合に依存するため、実データで `MAX/MEDIAN` を測ってから 5.0 の正規化定数を調整する。

### ステップD: mem9 リランキング (TS)

```ts
// lib/search/rerankWithMem9.ts
import MemoryClient from 'mem0ai';
const mem9 = new MemoryClient({ apiKey: process.env.MEM9_API_KEY! });

export async function rerankWithMem9<T extends { id: number; report_text: string; hybrid_score: number }>(
  userId: string,
  semanticQuery: string,
  rows: T[],
): Promise<(T & { mem_boost: number; final_score: number })[]> {
  const memories = await mem9.search(semanticQuery, {
    filters: { user_id: userId },
    topK: 10,
  });
  const memoryText = (memories.results ?? []).map((m: any) => m.memory).join('\n');
  if (!memoryText) return rows.map(r => ({ ...r, mem_boost: 0, final_score: r.hybrid_score }));

  // 軽量: 過去の好み文字列に出てくる単語が report_text に含まれるかでブースト
  const tokens = memoryText.split(/[\s、。,.]+/).filter(t => t.length >= 2);
  return rows.map(r => {
    const hits = tokens.filter(t => r.report_text.includes(t)).length;
    const mem_boost = Math.min(hits * 0.02, 0.2);
    return { ...r, mem_boost, final_score: r.hybrid_score + mem_boost };
  }).sort((a, b) => b.final_score - a.final_score);
}
```

---

## 6. mem9 (mem0) の使い所

**お気に入り登録時に `mem9.add()`:**

```ts
// app/api/players/[id]/favorite/route.ts (抜粋)
await mem9.add(
  [
    { role: 'user', content: `${player.name} (${player.position}, ${player.nationality}) をお気に入り登録` },
    { role: 'user', content: `理由メモ: ${player.report_text.slice(0, 200)}` },
  ],
  { userId: 'demo-user', metadata: { player_id: player.id, position: player.position, foot: player.foot } },
);
```

**検索時:** §5 ステップD のとおり `mem9.search(semantic_query, { filters: { user_id: 'demo-user' }, topK: 10 })` で過去傾向を取得し、上位50件を再ランキング。

**選手詳細ページ:** 「あなたの過去のスカウト履歴を踏まえるとこの選手も推しです」セクションで `mem9.search(player.report_text, { filters: { user_id }, topK: 5 })` を呼び、抽出された傾向タグ（例: 「左利きCM」「リーダーシップ重視」）と類似選手5名を表示。

> TODO: 取り込み時に再確認 — mem9 がプロジェクト独自派生なら API シグネチャを確定。本SPECは mem0 TS SDK (`mem0ai` パッケージ、`MemoryClient.add/search`) と互換である前提。

---

## 7. UI 仕様 (3 ペイン)

```
┌──────────────┬───────────────────────┬──────────────┐
│ Search Pane  │  Player Detail Pane   │ History Pane │
│ (左 320px)   │  (中央 fluid)          │ (右 360px)    │
├──────────────┼───────────────────────┼──────────────┤
│ NL textarea  │ Profile + Radar       │ 過去検索      │
│ Filters acc. │ レポート(全文)         │ お気に入り    │
│ Keywords     │ Why match (スコア内訳)│ mem9学習傾向  │
│ Result cards │ 類似選手 5            │ タグ表示      │
│ (score bar)  │ Favorite ボタン       │              │
├──────────────┴───────────────────────┴──────────────┤
│ Debugger Drawer (下、開閉式): 生成SQL / embedding 先頭8dim / parsed JSON │
└─────────────────────────────────────────────────────┘
```

- **Search Pane**: NL 入力 + フィルタアコーディオン (年齢/身長/OVR/パス精度/利き足/ポジション/国) + 全文キーワードチップ + 結果カード (4 スコアの水平バー)。
- **Player Detail Pane**: プロフィール / 6 軸レーダー (pace, shooting, passing, dribbling, defending, physic) / 日本語レポート / Why match (vec_score 内訳と FTS マッチ語ハイライト) / 類似選手 5 / お気に入り。
- **History Pane**: 過去検索 (raw_query クリックで再実行) / お気に入り一覧 / mem9 が学んだ傾向タグ。
- **Debugger Drawer**: 生成 SQL (シンタックスハイライト)、`?` バインド値、embedding 先頭 8 次元、parsed JSON。

UI ライブラリ: shadcn/ui + Tailwind、レーダーチャートは Recharts。

---

## 8. API エンドポイント

すべて `runtime = 'edge'` の Next.js Route Handler。

| メソッド | パス | 役割 |
|---|---|---|
| `POST` | `/api/search` | body: `{ raw_query: string }`。response: `{ parsed, sql, bindings, results: Player[] (各スコア付き), debug }` |
| `GET`  | `/api/players/[id]` | 詳細 + 類似 5 件 (vec_score 上位) |
| `POST` | `/api/players/[id]/favorite` | mem9.add + favorites INSERT |
| `DELETE` | `/api/players/[id]/favorite` | mem9.delete + favorites DELETE |
| `GET`  | `/api/recommendations` | mem9.search ベース、フィルタなしで上位 20 |
| `GET`  | `/api/history` | search_history を新しい順に 50 件 |

レスポンス例 (`/api/search`):

```json
{
  "parsed": { "filters": {"age_max":25,"overall_min":80}, "semantic_query": "...", "keywords": ["リーダーシップ"] },
  "sql": "WITH base AS (...)",
  "bindings": ["[0.01,...]","リーダーシップ",25,null,null,80,null,null,null,null],
  "results": [
    { "id": 42, "name": "...", "vec_score": 0.81, "text_score": 3.2, "quant_score": 1.0, "hybrid_score": 0.74, "mem_boost": 0.04, "final_score": 0.78 }
  ]
}
```

---

## 9. 環境変数

```
TIDB_DATABASE_URL=mysql://<user>.<cluster>:<password>@<host>:4000/<db>?ssl={"rejectUnauthorized":true}
OPENAI_API_KEY=sk-...
MEM9_API_KEY=...
NEXT_PUBLIC_DEMO_USER_ID=demo-user
```

`@tidbcloud/serverless` は単一 URL で接続するため `TIDB_DATABASE_URL` 一本にまとめる (元要件の HOST/USER/PASSWORD/DATABASE は内部的にこれに集約)。

---

## 10. ディレクトリ構成

```
ai-soccer-scout/
├─ app/
│  ├─ layout.tsx
│  ├─ page.tsx                       # 3ペイン本体
│  └─ api/
│     ├─ search/route.ts
│     ├─ players/[id]/route.ts
│     ├─ players/[id]/favorite/route.ts
│     ├─ recommendations/route.ts
│     └─ history/route.ts
├─ components/                        # SearchPane, PlayerDetailPane, HistoryPane, DebuggerDrawer ...
├─ lib/
│  ├─ tidb/client.ts                  # connect({url}) を export
│  ├─ openai/{client.ts,embed.ts,parseQuery.ts}
│  ├─ mem9/client.ts                  # MemoryClient ラッパ
│  └─ search/{buildSql.ts,rerankWithMem9.ts,types.ts}
├─ scripts/
│  └─ ingest/
│     ├─ 01_scrape_squads.ts
│     ├─ 02_load_eafc.ts
│     ├─ 03_match_names.ts
│     ├─ 04_generate_reports.ts
│     ├─ 05_load_tidb.ts
│     └─ run.ts
├─ data/                              # .gitignore
│  ├─ raw/                            # Kaggle CSV
│  ├─ intermediate/                   # squads.json, unmatched.json
│  └─ manual/aliases.json
├─ db/migrations/0001_init.sql
├─ public/
├─ .env.local.example
└─ package.json
```

---

## 11. Zenn 記事の章立て案

TiDB の工夫を中心にライトな読み物にする。API/環境変数/ディレクトリ構成 (SPEC §8〜§10) は記事スコープ外。

1. **「W杯×ハイブリッド検索」というネタ立て** — なぜ TiDB Cloud Serverless 1 本で SQL × Vector × FTS が刺さるのか、生成SQL を見せるデモのインパクト。
2. **TiDB スキーマ：HNSW × FULLTEXT を1テーブルに同居させる** — `VECTOR(1536)` / `VECTOR INDEX ... USING HNSW` / `FULLTEXT INDEX ... WITH PARSER MULTILINGUAL` の宣言、`fts_match_word()` の挙動。
3. **1 クエリで全部やる SQL** — CTE で `vec_score / text_score / quant_score / hybrid_score` を合成し、生 SQL をユーザに見せて説明性を担保。
4. *(おまけ)* **mem9 でパーソナライズ** — お気に入りから傾向を学び再ランキング、AI Agent への発展可能性。

---

## 12. 検証計画

| 項目 | 期待値 / 方法 |
|---|---|
| データ取り込み件数 | 1248 名 ±10%、`SELECT COUNT(*) FROM players`。欠損率レポート (位置/利き足/OVR が NULL の行数を CSV 化) |
| 名前マッチ率 | 90% 以上、`unmatched.json` 行数 / 全体 |
| 検索肌感 (5パターン) | (a) 「身長180+ パス80+ 25歳以下 左足CM リーダーシップ」 (b) 「20歳以下の右SB」 (c) 「日本人GK」 (d) 「ドリブルが武器のWG」 (e) 「フィジカル系CB」。各クエリで上位 5 件が常識的かを目視 |
| mem9 効果 | お気に入り 3 件 (例: 全員左利きCM) を登録 → 同条件外の中立クエリで上位 10 件中の左利きCM 比率が、登録前比で +20pt 以上 |
| 単一クエリ実行時間 | TiDB 単体で < 800ms (p50)、API 全体で < 2.0s (p50)。`EXPLAIN ANALYZE` を採取 |
| TiDB Serverless 無料枠 | 行数 ≤ 1300、ベクトル次元 1536、ストレージ・RU ともに Free Tier 内 (TODO: 取り込み時に再確認、レポート生成時に追加列を増やしすぎないこと) |
| Edge ランタイム互換 | `@tidbcloud/serverless` は Edge 対応、`mem0ai` SDK は fetch ベースなので Edge 動作前提で確認 (TODO: 取り込み時に再確認、もし Node API に依存していれば該当ルートのみ `runtime = 'nodejs'` にフォールバック) |

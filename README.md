# ⚽ AI Soccer Scout

2026 FIFA W 杯出場選手をスカウトする AI アプリ。**TiDB Cloud Starter 1 本**で、SQL × ベクトル × 全文検索を **1 SQL に集約したハイブリッド検索** を実装。お気に入り傾向は **mem9** で覚えて再ランクに使う構成。

Zenn 技術記事執筆コンテスト「TiDB で作る AI 時代のデータ基盤」への投稿サンプル実装です。

## できること

- **ハード条件**（年齢・利き足・ポジション）+ **ソフト条件**（プレースタイル文・キーワード）を 1 行の自然言語で投げると、Query Understanding が 3 種類の検索条件に分解
- TiDB の `VECTOR(1536)` + `FULLTEXT INDEX ... WITH PARSER MULTILINGUAL` + `WHERE` を 1 SELECT で同時評価
- 検索結果は `vec_score / text_score / hybrid_score / mem9` のスコア内訳付きで返る
- お気に入り登録すると mem9 が好み傾向を要約して保存、後続検索で再ランクに使う

## スタック

- Next.js 16 (App Router) + React 19 + Tailwind v4
- TiDB Cloud Starter (`@tidbcloud/serverless`) — `VECTOR(N)` / `fts_match_word()` / `WITH PARSER MULTILINGUAL`
- OpenAI `gpt-4o-mini` + `text-embedding-3-small`（structured output で NL → 構造化）
- mem9 (`mem0ai` v3) — 派生プロファイルの保存と検索

## はじめかた

`.env.local` に以下を設定:

```
TIDB_DATABASE_URL=mysql://...
OPENAI_API_KEY=sk-...
MEM9_API_KEY=...        # 未設定なら no-op で動作
```

データ投入と起動:

```bash
npm install
npx tsx scripts/ingest/01_scrape_wikipedia.ts   # Wikipedia から W 杯出場選手
npx tsx scripts/ingest/02_kaggle_match.ts       # EA FC 25 とファジーマッチ
npx tsx scripts/ingest/03_generate_reports.ts   # LLM レポート + embedding 生成
npx tsx scripts/ingest/04_insert_tidb.ts        # TiDB に投入
npm run dev
```

http://localhost:3000 を開いてスカウト開始。

## 解説記事

https://zenn.dev/ptwo/articles/37f94f47423eba

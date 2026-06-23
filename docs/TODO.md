# TODO — AI Soccer Scout 実装＋執筆チェックリスト

凡例: `[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了 / `~~取消~~`
時間見積は経験ベースの目安（実装スコープ＝グループF/G/H/I、約416名）。

---

## P0. プロジェクト初期化（〜30分）

- [ ] `pnpm create next-app@latest` で TypeScript / App Router / Tailwind を有効化して repo ルートに展開
- [ ] `pnpm add @tidbcloud/serverless openai zod mem0ai cheerio undici fuse.js csv-parse p-limit recharts`
- [ ] `pnpm add -D tsx @types/node`
- [ ] shadcn/ui 初期化（`pnpm dlx shadcn@latest init`）、`button` `card` `accordion` `drawer` `badge` `input` `textarea` を generate
- [ ] `.env.local.example` に `TIDB_DATABASE_URL` / `OPENAI_API_KEY` / `MEM9_API_KEY` / `NEXT_PUBLIC_DEMO_USER_ID` を記載
- [ ] `.gitignore` に `data/`、`.env.local`、`scripts/ingest/checkpoints/` 追加

## P1. TiDB Cloud Serverless 準備（〜30分）

- [ ] TiDB Cloud で Serverless cluster 作成、Connection Strings から `TIDB_DATABASE_URL` を `.env.local` へ
- [ ] `db/migrations/0001_init.sql` を作成（SPEC §3 の `players` / `favorites` / `search_history`）
- [ ] マイグレーション実行スクリプト `scripts/db/migrate.ts`（`@tidbcloud/serverless` で 0001 を流す）
- [ ] `pnpm tsx scripts/db/migrate.ts` 実行 → `SHOW TABLES` で3つ存在確認
- [ ] `SHOW INDEX FROM players` で `idx_report_vec`（HNSW）と `ft_report`（FULLTEXT）が出ることを確認

## P2. データ取り込みパイプライン（〜2.5時間）

### P2.1 Wikipedia スクレイピング — グループF/G/H/I のみ
- [ ] `scripts/ingest/01_scrape_squads.ts`：`https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads` を fetch、`Group F` / `Group G` / `Group H` / `Group I` のセクションのみパース
- [ ] 出力 `data/intermediate/squads.json`（約416行、`{country, group, no, pos, name, dob, age, caps, club}`）

### P2.2 Kaggle EA FC 25 取り込み
- [ ] Kaggle から `male_players.csv` を手動DLし `data/raw/` に配置
- [ ] `scripts/ingest/02_load_eafc.ts`：`csv-parse/sync` で必要列のみ抽出、`data/intermediate/eafc25.json`

### P2.3 fuzzy 名寄せ
- [ ] `scripts/ingest/03_match_names.ts`：`fuse.js`（threshold 0.3）で `long_name + nationality_name` キーにマッチ
- [ ] 未マッチを `data/intermediate/unmatched.json` に出力、`data/manual/aliases.json` で手動補正の二段適用
- [ ] マッチ率 90% 以上を確認（残りは外す or 手動追記）

### P2.4 LLM スカウティングレポート生成 + 埋め込み
- [ ] `scripts/ingest/04_generate_reports.ts`：1選手ずつ `gpt-4o-mini` で日本語300〜500字のレポート生成（structured output `{report_text}`）
- [ ] `text-embedding-3-small` で 1536 次元 embedding
- [ ] `p-limit` 並列度 8、429 時 exponential backoff（max 5 retry）、50件ごとに `data/intermediate/checkpoints/*.jsonl` へ保存して再開可能化
- [ ] 全件完了後、`data/intermediate/players_with_reports.jsonl` を1本化

### P2.5 TiDB バッチ INSERT
- [ ] `scripts/ingest/05_load_tidb.ts`：100件ずつ multi-row INSERT、ベクトルは `'[0.012, ...]'` 文字列でバインド
- [ ] 投入後 `ANALYZE TABLE players` 実行
- [ ] `SELECT COUNT(*) FROM players` が 416 ±10% であることを確認
- [ ] `scripts/ingest/run.ts` で 01〜05 を順次起動できるようにする

## P3. lib 層（〜1時間）

- [ ] `lib/tidb/client.ts`：`connect({ url: process.env.TIDB_DATABASE_URL! })` を export
- [ ] `lib/openai/client.ts`：`new OpenAI()` を export
- [ ] `lib/openai/embed.ts`：`embed(text)` で 1536 次元 number[] を返す
- [ ] `lib/openai/parseQuery.ts`：SPEC §5 ステップA の `parseQuery(raw)` を `zodResponseFormat` で実装
- [ ] `lib/mem9/client.ts`：`MemoryClient` ラッパ（`add` / `search` / `delete` を user_id 固定で薄く包む）
- [ ] `lib/search/buildSql.ts`：parsed query + embedding から SPEC §5 ステップC の CTE を生成、`{ sql, bindings }` を返す
- [ ] `lib/search/rerankWithMem9.ts`：SPEC §5 ステップD のリランク
- [ ] `lib/search/types.ts`：`Player`, `ParsedQuery`, `SearchResult`, `Score` 型

## P4. API Route Handlers（〜1時間）

- [ ] `app/api/search/route.ts`：parseQuery → embed → TiDB クエリ → mem9 リランク → `{ parsed, sql, bindings, results }` を返す。同時に `search_history` へINSERT
- [ ] `app/api/players/[id]/route.ts`：詳細＋vec_score 上位5件の類似選手
- [ ] `app/api/players/[id]/favorite/route.ts`：POST=mem9.add + favorites INSERT、DELETE=mem9.delete + favorites DELETE
- [ ] `app/api/recommendations/route.ts`：mem9.search ベースで上位20件
- [ ] `app/api/history/route.ts`：search_history を新しい順50件
- [ ] 各 Route に `export const runtime = 'edge'`（mem9 のみ Edge 動作不可なら該当だけ `'nodejs'`）

## P5. UI 実装（〜2.5時間）

### P5.1 レイアウト
- [ ] `app/layout.tsx`：日本語 metadata、Tailwind 適用
- [ ] `app/page.tsx`：3ペイン CSS Grid（左320 / 中央 fluid / 右360）+ 下部 Debugger Drawer

### P5.2 検索ペイン
- [ ] `components/SearchPane.tsx`：NL textarea、フィルタアコーディオン（年齢/身長/OVR/パス精度/利き足/ポジション/国）、全文キーワード入力、検索ボタン
- [ ] `components/ResultCard.tsx`：4スコア（vec/text/quant/hybrid）の水平バー、選手選択でフォーカス

### P5.3 選手詳細ペイン
- [ ] `components/PlayerDetailPane.tsx`：プロフィール、Recharts レーダー（pace/shooting/passing/dribbling/defending/physic）、レポート全文、Why match、お気に入りボタン
- [ ] 類似選手5件表示
- [ ] mem9 ベースの「あなた向け推薦」セクション

### P5.4 履歴ペイン
- [ ] `components/HistoryPane.tsx`：過去検索（クリックで再実行）、お気に入り一覧、mem9 学習タグ表示

### P5.5 デバッガードロワー
- [ ] `components/DebuggerDrawer.tsx`：生成 SQL（シンタックスハイライト）、bindings、embedding 先頭8 dim、parsed JSON
- [ ] トグルボタンで開閉

## P6. 動作検証（〜45分）

- [ ] 検索パターン (a)〜(e) を SPEC §12 のとおり手動実行、上位5件が常識的かを目視
- [ ] CTE スコア重み（0.55/0.30/0.15）と `text_score / 5.0` の正規化定数を実データで再調整
- [ ] お気に入り3件登録 → 中立クエリで再ランクが寄ることを確認
- [ ] 単一クエリ p50 < 800ms（TiDB EXPLAIN ANALYZE 採取）、API p50 < 2.0s
- [ ] ブラウザ動作確認（Chrome）、コンソールエラー潰す

## P7. Zenn 記事執筆（〜2.5時間）

> 記事スコープは TiDB の工夫中心（SPEC §11 のとおり、APIエンドポイント/環境変数/ディレクトリ構成は記事に含めない）。

- [ ] §1 「W杯×ハイブリッド検索」というネタ立て — TiDB Cloud Serverless 1本で SQL × Vector × FTS の要点
- [ ] §2 TiDB スキーマ：HNSW × FULLTEXT を1テーブルに同居 — `VECTOR(1536)` / `VECTOR INDEX ... USING HNSW` / `FULLTEXT INDEX ... WITH PARSER MULTILINGUAL` / `fts_match_word()`
- [ ] §3 1クエリで全部やるSQL — CTE のスコア合成、生成SQLを見せるデモ画像
- [ ] §4 (おまけ) mem9 でパーソナライズ — `add` / `search` の薄い使い方
- [ ] スクリーンショット（検索結果＋デバッガーパネル展開状態）撮影
- [ ] サムネイル画像作成（Zenn OGP 用）
- [ ] 公開設定（タグ：TiDB / Next.js / RAG / ハイブリッド検索）

## P8. 後追いタスク（記事公開後）

- [ ] 残32カ国の squads データ追加投入（Wikipedia の他グループ）
- [ ] フィルタ重み調整、UI 微修正（フィードバックを受けて）
- [ ] mem9 学習タグの可視化リッチ化

---

## 進捗サマリ用メモ

| ブロック | 見積 | 実績 | 状態 |
|---|---|---|---|
| P0 初期化 | 0.5h | | |
| P1 TiDB | 0.5h | | |
| P2 取り込み | 2.5h | | |
| P3 lib | 1.0h | | |
| P4 API | 1.0h | | |
| P5 UI | 2.5h | | |
| P6 検証 | 0.75h | | |
| P7 執筆 | 2.5h | | |
| **合計** | **11.25h** | | |

> 当初見積は 9〜12h 帯。データ範囲を416名に縮小したことで P2.4 の LLM 呼び出しが 1248→416 になり時間削減効果あり。タイトな場合は P5.3 の「mem9 ベース推薦セクション」と P5.5 の embedding 先頭dim 表示は最後にカット可能。

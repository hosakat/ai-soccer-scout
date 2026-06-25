-- 0001_init.sql — AI Soccer Scout 初期スキーマ
-- 対象: TiDB Cloud Starter (Frankfurt / Singapore リージョン、FULLTEXT beta 有効ティア)

CREATE TABLE IF NOT EXISTS players (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  external_key    VARCHAR(128) NOT NULL,
  name            VARCHAR(128) NOT NULL,
  name_kana       VARCHAR(128),
  nationality     VARCHAR(64)  NOT NULL,
  club            VARCHAR(128),
  position        VARCHAR(16)  NOT NULL,           -- "GK" / "DF" / "MF" / "FW"
  foot            ENUM('Left','Right','Both') NOT NULL,
  age             TINYINT UNSIGNED NOT NULL,
  height_cm       SMALLINT UNSIGNED,
  weight_kg       SMALLINT UNSIGNED,
  overall_rating  TINYINT UNSIGNED,
  pace            TINYINT UNSIGNED,
  shooting        TINYINT UNSIGNED,
  passing         TINYINT UNSIGNED,
  dribbling       TINYINT UNSIGNED,
  defending       TINYINT UNSIGNED,
  physic          TINYINT UNSIGNED,
  pass_accuracy   TINYINT UNSIGNED,
  report_text     TEXT NOT NULL,
  report_embedding VECTOR(1536) NOT NULL COMMENT 'text-embedding-3-small',

  KEY idx_age (age),
  KEY idx_rating (overall_rating),
  KEY idx_position (position),
  KEY idx_foot (foot),
  KEY idx_pass_acc (pass_accuracy),
  KEY idx_height (height_cm),
  UNIQUE KEY uk_external_key (external_key),

  -- 全文検索 (TiDB Cloud Starter beta、多言語パーサで日本語OK)
  FULLTEXT INDEX ft_report (report_text) WITH PARSER MULTILINGUAL

  -- 注: VECTOR INDEX (HNSW) は TiFlash レプリカ必須のため Starter ティアでは作成不可。
  --     Essential 以上か Self-hosted で `ALTER TABLE players ADD VECTOR INDEX ...` を実行。
  --     416 行規模ではフルスキャン cosine でも十分高速 (数十ms)。
);

CREATE TABLE IF NOT EXISTS favorites (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     VARCHAR(64) NOT NULL,
  player_id   INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_player (user_id, player_id),
  KEY idx_user (user_id)
);

CREATE TABLE IF NOT EXISTS search_history (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     VARCHAR(64) NOT NULL,
  raw_query   TEXT NOT NULL,
  parsed_json JSON NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, created_at)
);

import type { ParsedQuery } from '@/lib/openai/parseQuery';

export type BuiltQuery = { sql: string; bindings: unknown[] };

// ハイブリッド検索 1 クエリ。
// プレースホルダは ? にして @tidbcloud/serverless の execute(sql, bindings) で渡す。
//
// TiDB の制約 (Error 1221):
//   - SELECT 内の fts_match_word() は他関数や CASE で包めない
//   - SELECT で fts_match_word() を使うなら WHERE にも対応する fts_match_word() が必要
//   - CTE 経由で fts_match_word() の値を最終 SELECT に伝播させると同様にエラー
// → 単一 SELECT で fts_match_word() を SELECT/WHERE の両方に裸で置き、
//   重み合成は外側ではなくクライアント側 (Node) で行う。
export function buildHybridSearchSQL(
  parsed: ParsedQuery,
  embeddingLiteral: string,           // '[0.012,...]' 文字列
  limit = 50,
): BuiltQuery {
  const f = parsed.filters;
  const kw = (parsed.keywords ?? []).filter(Boolean).join(' ').trim();

  const bindings: unknown[] = [];
  const where: string[] = [];

  // (1) SELECT vec_score 用
  bindings.push(embeddingLiteral);

  // (2) SELECT text_score 用 (kw 非空時のみ)
  if (kw) bindings.push(kw);

  if (f.age_max != null) { where.push('age <= ?'); bindings.push(f.age_max); }
  if (f.age_min != null) { where.push('age >= ?'); bindings.push(f.age_min); }
  if (f.height_min != null) { where.push('height_cm >= ?'); bindings.push(f.height_min); }
  if (f.height_max != null) { where.push('height_cm <= ?'); bindings.push(f.height_max); }
  if (f.pace_min != null) { where.push('pace >= ?'); bindings.push(f.pace_min); }
  if (f.overall_min != null) { where.push('overall_rating >= ?'); bindings.push(f.overall_min); }
  if (f.pass_accuracy_min != null) { where.push('pass_accuracy >= ?'); bindings.push(f.pass_accuracy_min); }
  if (f.foot) { where.push('foot = ?'); bindings.push(f.foot); }
  if (f.position && f.position.length) {
    where.push(`position IN (${f.position.map(() => '?').join(',')})`);
    bindings.push(...f.position);
  }
  if (f.nationality && f.nationality.length) {
    where.push(`nationality IN (${f.nationality.map(() => '?').join(',')})`);
    bindings.push(...f.nationality);
  }
  if (kw) {
    where.push('fts_match_word(?, report_text)');
    bindings.push(kw);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const textScoreExpr = kw
    ? 'fts_match_word(?, report_text)'    // 裸で書く
    : '0';

  // ORDER BY は overall_rating 降順 + 多めに取得 → ハイブリッドスコアは Node で計算
  const sql = `SELECT
    id, name, nationality, club, position, foot,
    age, height_cm, weight_kg, overall_rating,
    pace, shooting, passing, dribbling, defending, physic, pass_accuracy,
    report_text,
    1 - VEC_COSINE_DISTANCE(report_embedding, ?) AS vec_score,
    ${textScoreExpr} AS text_score
  FROM players
  ${whereClause}
  ORDER BY vec_score DESC
  LIMIT ${Number(limit) | 0};`;

  return { sql, bindings };
}

// hybrid_score を Node 側で合成
// vec_score (0-1, 大きいほど近い), text_score (BM25 raw, 0..0.05程度), overall_rating (0-100)
export function computeHybridScore(row: {
  vec_score: number;
  text_score: number;
  overall_rating: number | null;
}): number {
  const vec = Number(row.vec_score) || 0;
  const text = Math.min((Number(row.text_score) || 0) / 0.05, 1);
  const ovr = (Number(row.overall_rating) || 0) / 100;
  return 0.55 * vec + 0.30 * text + 0.15 * ovr;
}

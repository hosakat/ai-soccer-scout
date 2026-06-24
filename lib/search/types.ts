export type Player = {
  id: number;
  external_key: string;
  name: string;
  nationality: string;
  club: string | null;
  position: string;
  foot: 'Left' | 'Right' | 'Both';
  age: number;
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
  report_text: string;
};

export type ScoredPlayer = Player & {
  vec_score: number;     // 0..1
  text_score: number;    // BM25 raw（NULLの場合 0）
  quant_score: number;   // 1.0 固定（フィルタ通過）
  hybrid_score: number;  // 重み付き合計
  mem_boost?: number;    // mem9 リランクのブースト
  final_score?: number;  // hybrid + mem_boost
};

export type SearchDebug = {
  parsed: import('@/lib/openai/parseQuery').ParsedQuery;
  sql: string;
  bindings: unknown[];
  embedding_head: number[]; // 先頭8次元
};

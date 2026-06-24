import { getMem9 } from '@/lib/mem9/client';
import type { ScoredPlayer } from './types';

export async function rerankWithMem9<T extends ScoredPlayer>(
  userId: string,
  semanticQuery: string,
  rows: T[],
): Promise<T[]> {
  const mem9 = getMem9();
  if (!mem9.enabled || rows.length === 0) {
    return rows.map((r) => ({ ...r, mem_boost: 0, final_score: r.hybrid_score }));
  }
  const memories = await mem9.search(semanticQuery, userId, 10);
  const memoryText = memories.map((m) => m.memory).join('\n');
  if (!memoryText) {
    return rows.map((r) => ({ ...r, mem_boost: 0, final_score: r.hybrid_score }));
  }

  // 軽量: 過去メモリ文字列の単語が report_text に出現する数で boost
  const tokens = Array.from(new Set(
    memoryText.split(/[\s、。,.()「」『』\-―/]+/).filter((t) => t.length >= 2),
  ));

  return rows
    .map((r) => {
      const hits = tokens.filter((t) => r.report_text.includes(t)).length;
      const mem_boost = Math.min(hits * 0.02, 0.2);
      return { ...r, mem_boost, final_score: r.hybrid_score + mem_boost };
    })
    .sort((a, b) => (b.final_score! - a.final_score!));
}

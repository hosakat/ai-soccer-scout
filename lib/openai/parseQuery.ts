import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { getOpenAI } from './client';

// gpt-4o-mini に NL クエリを構造化させる
// strict json_schema 互換のため: optional ではなく nullable で揃える
export const ParsedQuery = z.object({
  filters: z.object({
    age_max: z.number().int().nullable(),
    age_min: z.number().int().nullable(),
    height_min: z.number().int().nullable(),
    height_max: z.number().int().nullable(),
    pace_min: z.number().int().nullable(),
    overall_min: z.number().int().nullable(),
    pass_accuracy_min: z.number().int().nullable(),
    position: z.array(z.enum(['GK', 'DF', 'MF', 'FW'])).nullable(),
    foot: z.enum(['Left', 'Right', 'Both']).nullable(),
    nationality: z.array(z.string()).nullable(),
  }),
  semantic_query: z.string(),
  keywords: z.array(z.string()),
});

export type ParsedQuery = z.infer<typeof ParsedQuery>;

const SYS = `あなたはサッカースカウトの自然言語要望を、3種の検索条件に分解するアシスタントです。
出力は JSON。要望を以下に分けます。

  filters       … 数値・enum で表せる条件 (年齢上下限、身長下限、OVR下限、パス精度下限、ポジション、利き足、国)
  semantic_query … 「左足が正確で中盤の底からゲームを作れる」のような プレースタイル/文脈的要望 (短い日本語)
  keywords      … 「リーダーシップ」「決定力」のような 全文検索したい日本語キーワード (1〜3 語)

重要:
- 該当しない filters の項目は **必ず null** を入れてください。
- position は ["GK","DF","MF","FW"] のいずれかの配列。CB/CDM など細分化された英略語は MF / DF にまとめてください。
- semantic_query は要望から抽出。要望にプレースタイル要素がない場合は raw_query をそのまま入れてください。`;

export async function parseQuery(raw: string): Promise<ParsedQuery> {
  const completion = await getOpenAI().chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: raw },
    ],
    response_format: zodResponseFormat(ParsedQuery, 'parsed_query'),
  });
  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) throw new Error('parsed query is null');
  return parsed;
}

import { getOpenAI } from './client';

export async function embed(text: string): Promise<number[]> {
  const r = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return r.data[0]!.embedding;
}

export function vecLit(v: number[]): string {
  return '[' + v.map((x) => x.toFixed(6)).join(',') + ']';
}

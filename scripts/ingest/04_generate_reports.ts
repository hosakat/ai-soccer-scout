// マッチ済選手にスカウティングレポート (gpt-4o-mini) と embedding (text-embedding-3-small) を付与
// 入力: data/intermediate/matched.json (matched=true のみ対象)
// 出力: data/intermediate/players_with_reports.jsonl (1行=1選手のJSON)
// チェックポイント: scripts/ingest/checkpoints/players_with_reports.jsonl  (再開可能)
//
// レート制御:
//   - p-limit 並列度 8
//   - 429 / Network / 500系で exponential backoff (max 5 retry)
// 中間状態:
//   - 完了 player_id (= external_key) を Set に持ち、起動時に jsonl から再構築

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import pLimit from 'p-limit';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const MATCHED = resolve(process.cwd(), 'data/intermediate/matched.json');
const OUT = resolve(process.cwd(), 'data/intermediate/players_with_reports.jsonl');
const CKPT = resolve(process.cwd(), 'scripts/ingest/checkpoints/players_with_reports.jsonl');
const CONCURRENCY = 8;
const MAX_RETRY = 5;

if (!process.env.OPENAI_API_KEY) {
  console.error('[error] OPENAI_API_KEY が未設定です。.env.local に追記してください');
  process.exit(1);
}

const openai = new OpenAI();

const ReportSchema = z.object({
  report_text: z.string().describe('日本語300〜500字のスカウティングレポート'),
});

type Squad = {
  country: string; group: string; no: number | null; pos: string;
  name: string; dob: string | null; age: number | null;
  caps: number | null; goals: number | null; club: string;
};
type Ea = {
  short_name: string; long_name: string; age: number | null;
  height_cm: number | null; weight_kg: number | null; club_name: string | null;
  nationality_name: string; overall: number | null;
  pace: number | null; shooting: number | null; passing: number | null;
  dribbling: number | null; defending: number | null; physic: number | null;
  pass_accuracy: number | null; preferred_foot: 'Left' | 'Right' | null;
  player_positions: string[];
};
type Matched = Squad & { matched: boolean; eafc: Ea | null; match_score: number };

type Out = Squad & {
  external_key: string;
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
  preferred_foot: 'Left' | 'Right' | 'Both';
  report_text: string;
  report_embedding: number[];
};

function externalKey(name: string, country: string): string {
  return `${name}|${country.replace(/\s+/g, '_')}`;
}

function buildPrompt(p: Matched): string {
  const e = p.eafc;
  const pf = e?.preferred_foot ?? '不明';
  const lines: string[] = [
    `名前: ${p.name}`,
    `代表: ${p.country}`,
    `所属クラブ: ${p.club}`,
    `年齢: ${p.age ?? '不明'}`,
    `背番号: ${p.no ?? '-'} / 表記ポジション: ${p.pos}`,
    `代表キャップ: ${p.caps ?? '-'} / 得点: ${p.goals ?? '-'}`,
  ];
  if (e) {
    lines.push(
      '',
      'EA Sports FC 25 ステータス（参考値）:',
      `  Overall: ${e.overall ?? '-'} / 利き足: ${pf}`,
      `  身長: ${e.height_cm ?? '-'}cm / 体重: ${e.weight_kg ?? '-'}kg`,
      `  Pace: ${e.pace ?? '-'} / Shooting: ${e.shooting ?? '-'} / Passing: ${e.passing ?? '-'}`,
      `  Dribbling: ${e.dribbling ?? '-'} / Defending: ${e.defending ?? '-'} / Physical: ${e.physic ?? '-'}`,
      `  Short Passing (パス精度の代理): ${e.pass_accuracy ?? '-'}`,
      `  ポジション群: ${e.player_positions.join('/') || '-'}`,
    );
  } else {
    lines.push('', '※ 詳細スタッツは未取得。Wikipedia 情報のみで簡潔に。');
  }
  return lines.join('\n');
}

async function generateReport(p: Matched): Promise<{ report: string; embedding: number[] }> {
  const userText = buildPrompt(p);
  let lastErr: any = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const completion = await openai.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'あなたはサッカーのプロスカウト。与えられた数値プロファイルから、日本語で300〜500字のスカウティングレポートを書きなさい。プレースタイル/強み/弱点/起用法/性格傾向（リーダーシップなど）に必ず触れること。固有名詞や事実は与えられた情報の範囲のみ。装飾的な見出し・箇条書きは使わず散文1パラグラフ。' },
          { role: 'user', content: userText },
        ],
        response_format: zodResponseFormat(ReportSchema, 'scout_report'),
      });
      const parsed = completion.choices[0]?.message?.parsed;
      if (!parsed) throw new Error('parsed is null');
      const report = parsed.report_text;

      const emb = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: report,
      });
      const embedding = emb.data[0]!.embedding;
      return { report, embedding };
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (attempt < MAX_RETRY && (status === 429 || status >= 500 || e?.code === 'ECONNRESET')) {
        const wait = Math.min(2 ** attempt * 500, 8000) + Math.floor(Math.random() * 250);
        console.warn(`[retry ${attempt + 1}/${MAX_RETRY}] ${p.name}: ${status ?? e?.message} wait=${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function loadCheckpoint(): Map<string, Out> {
  const m = new Map<string, Out>();
  if (!existsSync(CKPT)) return m;
  const buf = readFileSync(CKPT, 'utf8');
  for (const line of buf.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Out;
      m.set(o.external_key, o);
    } catch { /* 壊れた行はスキップ */ }
  }
  return m;
}

async function main() {
  const matched = JSON.parse(readFileSync(MATCHED, 'utf8')) as Matched[];
  // 未マッチでも Wikipedia 情報のみでレポート生成は可能なので全選手を対象
  const targets = matched;

  mkdirSync(dirname(CKPT), { recursive: true });
  const ckpt = loadCheckpoint();
  console.log(`[info] checkpoint: ${ckpt.size} done / ${matched.length} matched / ${targets.length} targets`);

  const limit = pLimit(CONCURRENCY);
  let done = ckpt.size;
  let err = 0;

  const tasks = targets.map((p) => limit(async () => {
    const key = externalKey(p.name, p.country);
    if (ckpt.has(key)) return;
    try {
      const { report, embedding } = await generateReport(p);
      const e = p.eafc;
      const out: Out = {
        ...p,
        external_key: key,
        height_cm: e?.height_cm ?? null,
        weight_kg: e?.weight_kg ?? null,
        overall_rating: e?.overall ?? null,
        pace: e?.pace ?? null,
        shooting: e?.shooting ?? null,
        passing: e?.passing ?? null,
        dribbling: e?.dribbling ?? null,
        defending: e?.defending ?? null,
        physic: e?.physic ?? null,
        pass_accuracy: e?.pass_accuracy ?? null,
        preferred_foot: e?.preferred_foot ?? 'Both',
        report_text: report,
        report_embedding: embedding,
      };
      appendFileSync(CKPT, JSON.stringify(out) + '\n', 'utf8');
      ckpt.set(key, out);
      done++;
      if (done % 20 === 0) console.log(`  ... ${done}/${targets.length}`);
    } catch (e: any) {
      err++;
      console.error(`[fail] ${p.name}: ${e?.message ?? e}`);
    }
  }));

  await Promise.all(tasks);

  // 最終 jsonl を CKPT からコピー (順序は処理順)
  writeFileSync(OUT, [...ckpt.values()].map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
  console.log(`✓ done: ${done}/${targets.length}, err: ${err}`);
  console.log(`✓ ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

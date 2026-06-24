// Wikipedia squads と Kaggle EA FC 25 を選手名で fuzzy match
// 入力: data/intermediate/squads.json + data/intermediate/eafc25.json + data/manual/aliases.json
// 出力: data/intermediate/matched.json + data/intermediate/unmatched.json

import Fuse from 'fuse.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

type Aliases = Record<string, string>; // wiki name → ea long_name (manual override)

const SQUADS = resolve(process.cwd(), 'data/intermediate/squads.json');
const EAFC = resolve(process.cwd(), 'data/intermediate/eafc25.json');
const ALIASES = resolve(process.cwd(), 'data/manual/aliases.json');
const MATCHED = resolve(process.cwd(), 'data/intermediate/matched.json');
const UNMATCHED = resolve(process.cwd(), 'data/intermediate/unmatched.json');

// 国名のゆらぎ (Wikipedia ⇔ Kaggle nationality_name)
const COUNTRY_ALIAS: Record<string, string[]> = {
  'Cape Verde': ['Cape Verde Islands', 'Cabo Verde'],
  'New Zealand': ['New Zealand'],
  'Saudi Arabia': ['Saudi Arabia'],
  Iran: ['Iran', 'Iran Islamic Republic of'],
  // 他は基本一致を期待
};

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ダイアクリティカル / 長音記号 (̄) 除去
    .toLowerCase()
    .replace(/[.\-'`’]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Takefusa Kubo" → ["takefusa kubo", "kubo", "t kubo"]
// "K. Mbappé"     → ["k mbappe", "mbappe", "k mbappe"]
function nameKeys(name: string): string[] {
  const norm = normalizeName(name);
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length === 0) return [];
  const last = parts[parts.length - 1];
  const initialPlusLast = parts.length >= 2 ? `${parts[0][0]} ${last}` : last;
  return Array.from(new Set([norm, last, initialPlusLast]));
}

function main() {
  const squads = JSON.parse(readFileSync(SQUADS, 'utf8')) as Squad[];
  const eafc = JSON.parse(readFileSync(EAFC, 'utf8')) as Ea[];
  let aliases: Aliases = {};
  try {
    aliases = JSON.parse(readFileSync(ALIASES, 'utf8'));
  } catch { /* aliases なくてもOK */ }

  // 国別 EA 候補を作っておくと探索範囲が小さくなる
  const eaByCountry = new Map<string, Ea[]>();
  for (const e of eafc) {
    const k = e.nationality_name;
    if (!eaByCountry.has(k)) eaByCountry.set(k, []);
    eaByCountry.get(k)!.push(e);
  }

  type Matched = Squad & {
    matched: boolean;
    eafc: Ea | null;
    match_score: number; // 0.0〜1.0、大きいほどよくない
  };

  const matched: Matched[] = [];
  const unmatched: Squad[] = [];

  // 国 × キー → 候補 EA 配列、を構築。1選手は複数キーで登録。
  // EA の long_name は漢字のことがあるので keys から落ちる場合あり。short_name の "T. Kubo" → "t kubo" / "kubo" を必ず登録。
  const indexBy = (poolKey: 'country' | 'global', key: string, e: Ea, idx: Map<string, Ea[]>) => {
    if (!key) return;
    const id = `${poolKey}|${key}`;
    if (!idx.has(id)) idx.set(id, []);
    idx.get(id)!.push(e);
  };

  const idxByCountry = new Map<string, Ea[]>();
  const idxGlobal = new Map<string, Ea[]>();

  for (const e of eafc) {
    const ks = Array.from(new Set([
      ...nameKeys(e.long_name),
      ...nameKeys(e.short_name),
    ]));
    for (const k of ks) {
      indexBy('country', `${e.nationality_name}|${k}`, e, idxByCountry);
      indexBy('global', k, e, idxGlobal);
    }
  }

  function pickBest(cands: Ea[]): Ea | null {
    if (!cands.length) return null;
    return cands.reduce((a, b) => ((b.overall ?? 0) > (a.overall ?? 0) ? b : a));
  }

  for (const s of squads) {
    // 1) 手動 alias 完全一致
    const alias = aliases[s.name];
    if (alias) {
      const hit = eafc.find((e) => e.long_name === alias || e.short_name === alias);
      if (hit) { matched.push({ ...s, matched: true, eafc: hit, match_score: 0 }); continue; }
    }

    const countryKeys = [s.country, ...(COUNTRY_ALIAS[s.country] ?? [])];
    const sKeys = nameKeys(s.name);

    // 2a) 国別 + キー完全一致 (long, last, initial+last の順で優先)
    let hit: Ea | null = null;
    let hitScore = 0.05;
    outer: for (const ck of countryKeys) {
      for (const sk of sKeys) {
        const cands = idxByCountry.get(`country|${ck}|${sk}`);
        if (cands && cands.length) {
          hit = pickBest(cands);
          if (hit) break outer;
        }
      }
    }

    // 2b) 国別プールに対し fuse.js ファジー (全キー対象)
    if (!hit) {
      let pool: Ea[] = [];
      for (const ck of countryKeys) pool = pool.concat(eaByCountry.get(ck) ?? []);
      if (pool.length) {
        const docs = pool.map((e) => ({
          ...e,
          _keys: [...nameKeys(e.long_name), ...nameKeys(e.short_name)].join(' | '),
        }));
        const fuse = new Fuse(docs, { keys: ['_keys'], threshold: 0.35, includeScore: true });
        const q = sKeys.join(' | ');
        const r = fuse.search(q);
        if (r.length && r[0].score! <= 0.35) {
          hit = r[0].item as Ea;
          hitScore = r[0].score!;
        }
      }
    }

    // 3) 国フィルタなし完全一致
    if (!hit) {
      for (const sk of sKeys) {
        const cands = idxGlobal.get(`global|${sk}`);
        if (cands && cands.length) {
          // 同姓多数になりがちなのでスキップではなく長フルネーム一致のみ受け入れ
          if (sk.includes(' ') && sk.length > 6) {
            hit = pickBest(cands);
            if (hit) { hitScore = 0.4; break; }
          }
        }
      }
    }

    if (hit) {
      matched.push({ ...s, matched: true, eafc: hit, match_score: hitScore });
    } else {
      matched.push({ ...s, matched: false, eafc: null, match_score: 1.0 });
      unmatched.push(s);
    }
  }

  writeFileSync(MATCHED, JSON.stringify(matched, null, 2), 'utf8');
  writeFileSync(UNMATCHED, JSON.stringify(unmatched, null, 2), 'utf8');

  const matchedCount = matched.filter((m) => m.matched).length;
  console.log(`✓ matched ${matchedCount}/${matched.length} (${(matchedCount / matched.length * 100).toFixed(1)}%)`);
  console.log(`✓ unmatched written to ${UNMATCHED}: ${unmatched.length}`);
  if (unmatched.length) {
    console.log('  unmatched sample (first 10):');
    for (const u of unmatched.slice(0, 10)) console.log(`    ${u.country.padEnd(15)} ${u.name}`);
  }
}

main();

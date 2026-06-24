// 2026 FIFA World Cup squads (Wikipedia) から Group F/G/H/I のロースターを抽出
// 出力: data/intermediate/squads.json
//
// 取得構造 (現行 Wikipedia / Vector 2022):
//   <div class="mw-heading mw-heading2"><h2 id="Group_F">Group F</h2></div>
//   <div class="mw-heading mw-heading3"><h3 id="Japan">Japan</h3></div>
//   <p>Coach: ...</p>
//   <table class="sortable wikitable plainrowheaders"> ... </table>
//
// 親要素 (mw-parser-output) の children() が一部しか取れないケースがあるため、
// h2#Group_X を起点に .next() で兄弟を走査して走査終端を次の mw-heading2 とする。

import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const URL = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads';
const TARGET_GROUPS = [
  ['Group_F', 'F'],
  ['Group_G', 'G'],
  ['Group_H', 'H'],
  ['Group_I', 'I'],
] as const;
const OUT = resolve(process.cwd(), 'data/intermediate/squads.json');

type Player = {
  country: string;
  group: string;
  no: number | null;
  pos: string;
  name: string;
  dob: string | null;
  age: number | null;
  caps: number | null;
  goals: number | null;
  club: string;
};

async function main() {
  const html = await fetch(URL, {
    headers: { 'User-Agent': 'ai-soccer-scout/0.1 (zenn article)' },
  }).then((r) => r.text());

  const $ = cheerio.load(html);
  const players: Player[] = [];

  for (const [groupId, groupLetter] of TARGET_GROUPS) {
    const h2 = $(`h2#${groupId}`).first();
    if (!h2.length) {
      console.warn(`[warn] heading not found: ${groupId}`);
      continue;
    }
    const wrap = h2.parent('.mw-heading2'); // <div class="mw-heading mw-heading2">
    if (!wrap.length) {
      console.warn(`[warn] heading wrapper not found for ${groupId}`);
      continue;
    }

    let cur = wrap.next();
    let currentCountry: string | null = null;

    while (cur.length) {
      if (cur.hasClass('mw-heading2')) break;

      if (cur.hasClass('mw-heading3')) {
        const h3 = cur.find('h3').first();
        const text = (h3.text() || '').replace(/\[edit\]/g, '').trim();
        const id = h3.attr('id') || '';
        currentCountry = text || id.replace(/_/g, ' ');
      } else if ((cur.get(0) as any)?.tagName === 'table' && cur.hasClass('wikitable') && currentCountry) {
        const country = currentCountry;
        // plainrowheaders: Player列は <th scope="row">、他6列は <td>
        // 行構造: [td No] [td Pos] [th Player] [td DoB(age)] [td Caps] [td Goals] [td Club]
        cur.find('tbody > tr').each((_, tr) => {
          const $tr = $(tr);
          const th = $tr.find('th[scope="row"]').first();
          const tds = $tr.find('td');
          if (!th.length || tds.length < 6) return; // ヘッダ行スキップ
          const no = parseIntOrNull($(tds[0]).text());
          const pos = normalizePos($(tds[1]).text());
          const name = cleanName(th.text());
          const dobCell = $(tds[2]).text().trim();
          const { dob, age } = parseDobAge(dobCell);
          const caps = parseIntOrNull($(tds[3]).text());
          const goals = parseIntOrNull($(tds[4]).text());
          const club = cleanName($(tds[5]).text());
          if (!name || !pos) return;
          players.push({ country, group: groupLetter, no, pos, name, dob, age, caps, goals, club });
        });
      }
      cur = cur.next();
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(players, null, 2), 'utf8');

  const byCountry: Record<string, number> = {};
  for (const p of players) byCountry[p.country] = (byCountry[p.country] || 0) + 1;
  console.log(`✓ ${players.length} players written to ${OUT}`);
  console.log('  per-country:', byCountry);
}

function parseIntOrNull(s: string): number | null {
  const t = s.replace(/[^\d-]/g, '');
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function cleanName(s: string): string {
  return s.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
}

function parseDobAge(cell: string): { dob: string | null; age: number | null } {
  const dobMatch = cell.match(/(\d{4}-\d{2}-\d{2})/);
  const ageMatch = cell.match(/age[\s ]+(\d+)/i);
  let age: number | null = ageMatch ? parseInt(ageMatch[1], 10) : null;
  // age セルが取れないケースが多いため DOB から計算（2026 W杯本大会開催時点 = 2026-06-11 基準で計算）
  if (age == null && dobMatch) {
    age = computeAge(dobMatch[1], '2026-06-11');
  }
  return { dob: dobMatch ? dobMatch[1] : null, age };
}

function computeAge(dob: string, asOf: string): number {
  const [by, bm, bd] = dob.split('-').map((x) => parseInt(x, 10));
  const [ay, am, ad] = asOf.split('-').map((x) => parseInt(x, 10));
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age -= 1;
  return age;
}

// "1GK" / "GK" / "GK\n" のような Wikipedia ソートキー付きセルを "GK" 等に正規化
function normalizePos(raw: string): string {
  const m = raw.toUpperCase().match(/(GK|DF|MF|FW)/);
  return m ? m[1] : raw.trim();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

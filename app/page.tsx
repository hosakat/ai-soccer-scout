'use client';

import { useEffect, useState } from 'react';

type Player = {
  id: number;
  name: string;
  nationality: string;
  club: string | null;
  position: string;
  foot: string;
  age: number;
  height_cm: number | null;
  overall_rating: number | null;
  pace: number | null; shooting: number | null; passing: number | null;
  dribbling: number | null; defending: number | null; physic: number | null;
  pass_accuracy: number | null;
  report_text: string;
  vec_score: number;
  text_score: number;
  quant_score: number;
  hybrid_score: number;
  mem_boost?: number;
  final_score?: number;
};

type Filters = {
  age_max: number | null;
  age_min: number | null;
  height_min: number | null;
  height_max: number | null;
  pace_min: number | null;
  overall_min: number | null;
  pass_accuracy_min: number | null;
  position: ('GK'|'DF'|'MF'|'FW')[] | null;
  foot: 'Left' | 'Right' | 'Both' | null;
  nationality: string[] | null;
};

type Parsed = {
  filters: Filters;
  semantic_query: string;
  keywords: string[];
};

type SearchResp = {
  parsed: Parsed;
  sql: string;
  bindings: any[];
  embedding_head: number[];
  results: Player[];
  elapsed_ms: number;
};

type HistoryResp = {
  history: { id: number; raw_query: string; created_at: string }[];
  favorites: { player_id: number; name: string; nationality: string; position: string }[];
};

const SUGGESTED_TAGS = ['リーダーシップ', 'タフ', 'ドリブル', '冷静', '決定力', 'スピード', 'クロス', '誠実', '左利き', 'ヘディング'];

const NL_EXAMPLES = [
  '左足が正確で中盤の底からゲームを作れる、25歳以下',
  '身長190cm以上のセンターバック、リーダーシップ',
  '20歳以下の右ウイング、ドリブルが武器',
];

const initialFilters: Filters = {
  age_max: 35,
  age_min: 18,
  height_min: null,
  height_max: null,
  pace_min: null,
  overall_min: null,
  pass_accuracy_min: null,
  position: null,
  foot: null,
  nationality: null,
};

export default function Home() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [semantic, setSemantic] = useState('中盤の底からゲームを作る、ビルドアップに優れた選手');
  const [keywords, setKeywords] = useState<string[]>(['リーダーシップ']);
  const [kwInput, setKwInput] = useState('');
  const [nlInput, setNlInput] = useState(NL_EXAMPLES[0]);

  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [resp, setResp] = useState<SearchResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Player | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [history, setHistory] = useState<HistoryResp | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // 初期テーマを localStorage から読む
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const t = (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
    setTheme(t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try { localStorage.setItem('theme', next); } catch {}
  }

  async function search() {
    setLoading(true); setError(null);
    try {
      const parsed: Parsed = {
        filters: {
          ...filters,
          age_min: filters.age_min === 18 ? null : filters.age_min,
          age_max: filters.age_max === 35 ? null : filters.age_max,
        },
        semantic_query: semantic,
        keywords,
      };
      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parsed }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const data: SearchResp = await r.json();
      setResp(data);
      setSelected(data.results[0] ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
      loadHistory();
    }
  }

  async function autoFromNL() {
    if (!nlInput.trim()) return;
    setParsing(true); setError(null);
    try {
      const r = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw_query: nlInput }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const { parsed }: { parsed: Parsed } = await r.json();
      setFilters((prev) => ({
        ...prev,
        age_max: parsed.filters.age_max ?? prev.age_max,
        age_min: parsed.filters.age_min ?? prev.age_min,
        height_min: parsed.filters.height_min ?? null,
        height_max: (parsed.filters as any).height_max ?? null,
        pace_min: (parsed.filters as any).pace_min ?? null,
        overall_min: parsed.filters.overall_min ?? null,
        pass_accuracy_min: parsed.filters.pass_accuracy_min ?? null,
        position: parsed.filters.position ?? null,
        foot: parsed.filters.foot ?? null,
        nationality: parsed.filters.nationality ?? null,
      }));
      setSemantic(parsed.semantic_query || nlInput);
      setKeywords(parsed.keywords ?? []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setParsing(false);
    }
  }

  async function loadHistory() {
    try {
      const r = await fetch('/api/history');
      if (r.ok) setHistory(await r.json());
    } catch { /* noop */ }
  }
  useEffect(() => { loadHistory(); }, []);

  async function toggleFavorite(p: Player, faved: boolean) {
    await fetch(`/api/players/${p.id}/favorite`, { method: faved ? 'DELETE' : 'POST' });
    loadHistory();
  }
  const favSet = new Set((history?.favorites ?? []).map((f) => f.player_id));

  function addKeyword(k: string) {
    const t = k.trim();
    if (!t) return;
    if (keywords.includes(t)) return;
    setKeywords([...keywords, t]);
  }
  function removeKeyword(k: string) {
    setKeywords(keywords.filter((x) => x !== k));
  }
  function togglePosition(p: 'GK'|'DF'|'MF'|'FW') {
    const cur = filters.position ?? [];
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
    setFilters({ ...filters, position: next.length ? next : null });
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center gap-4 bg-white dark:bg-zinc-950">
        <h1 className="font-bold text-lg">⚽ TiDB サッカースカウトAI</h1>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">SQL × Vector × FullText を 1 クエリで</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-zinc-500">2026 W杯 グループF/G/H/I (416選手)</span>
          <button
            onClick={toggleTheme}
            className="rounded border border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 px-2 py-1 text-xs"
            title="テーマ切替"
          >
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      {/* AI 自動入力バー */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/50 px-6 py-3 flex gap-2 items-center">
        <span className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">🤖 文章から自動入力:</span>
        <input
          className="flex-1 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500"
          value={nlInput}
          onChange={(e) => setNlInput(e.target.value)}
          placeholder="例: 左足が正確で中盤の底からゲームを作れる25歳以下"
        />
        <button
          onClick={autoFromNL}
          disabled={parsing || !nlInput.trim()}
          className="rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 whitespace-nowrap"
        >
          {parsing ? '解析中…' : '✨ AI で 3 カラムへ'}
        </button>
        <select
          className="rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-xs"
          onChange={(e) => { if (e.target.value) setNlInput(e.target.value); e.target.value = ''; }}
          value=""
        >
          <option value="">サンプル…</option>
          {NL_EXAMPLES.map((ex) => <option key={ex} value={ex}>{ex.slice(0, 30)}</option>)}
        </select>
      </div>

      {/* 3カラム入力 */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 grid grid-cols-3 gap-4 bg-zinc-50 dark:bg-zinc-950">
        <Card title="定量条件 (SQL)" badge="WHERE" badgeColor="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40">
          <RangeRow
            label="年齢" min={16} max={45}
            valueMin={filters.age_min ?? 16}
            valueMax={filters.age_max ?? 45}
            onChange={(lo, hi) => setFilters({ ...filters, age_min: lo, age_max: hi })}
            unit="歳"
          />
          <RangeRow
            label="身長" min={160} max={210}
            valueMin={filters.height_min ?? 160}
            valueMax={filters.height_max ?? 210}
            onChange={(lo, hi) => setFilters({ ...filters, height_min: lo === 160 ? null : lo, height_max: hi === 210 ? null : hi })}
            unit="cm"
          />
          <SingleSliderRow
            label="Pace 下限" min={40} max={100}
            value={filters.pace_min ?? 40}
            onChange={(v) => setFilters({ ...filters, pace_min: v === 40 ? null : v })}
          />
          <div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">ポジション</div>
            <div className="flex gap-1.5 flex-wrap">
              {(['GK','DF','MF','FW'] as const).map((p) => {
                const on = (filters.position ?? []).includes(p);
                return (
                  <button key={p}
                    onClick={() => togglePosition(p)}
                    className={`rounded px-2.5 py-1 text-xs border transition ${
                      on
                        ? 'bg-rose-500 border-rose-400 text-white'
                        : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 text-zinc-700 dark:text-zinc-300'
                    }`}>{p}</button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">利き足</div>
            <div className="flex gap-1.5">
              {(['Left','Right','Both'] as const).map((f) => {
                const on = filters.foot === f;
                return (
                  <button key={f}
                    onClick={() => setFilters({ ...filters, foot: on ? null : f })}
                    className={`rounded px-2.5 py-1 text-xs border transition ${
                      on
                        ? 'bg-rose-500 border-rose-400 text-white'
                        : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 text-zinc-700 dark:text-zinc-300'
                    }`}>{f}</button>
                );
              })}
            </div>
          </div>
        </Card>

        <Card title="定性条件 (ベクトル検索)" badge="VEC_COSINE" badgeColor="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40">
          <textarea
            className="w-full rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 p-2 text-sm focus:outline-none focus:border-emerald-500"
            rows={5}
            value={semantic}
            onChange={(e) => setSemantic(e.target.value)}
            placeholder="プレースタイル / 役割 / 性格を自由記述"
          />
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-snug">
            このテキストを <code className="text-emerald-600 dark:text-emerald-300">text-embedding-3-small</code> で1536次元ベクトル化し、
            選手レポートの埋め込みとコサイン距離で比較します。
          </p>
        </Card>

        <Card title="特徴キーワード (全文検索)" badge="fts_match_word" badgeColor="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/40">
          <div className="flex gap-1.5 flex-wrap min-h-[28px]">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full bg-sky-50 dark:bg-sky-500/20 border border-sky-200 dark:border-sky-500/40 px-2.5 py-0.5 text-xs text-sky-700 dark:text-sky-200">
                {k}
                <button onClick={() => removeKeyword(k)} className="text-sky-500 hover:text-sky-900 dark:text-sky-300 dark:hover:text-white">×</button>
              </span>
            ))}
            {keywords.length === 0 && <span className="text-xs text-zinc-500">タグなし</span>}
          </div>
          <input
            className="w-full rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm focus:outline-none focus:border-sky-500"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addKeyword(kwInput);
                setKwInput('');
              }
            }}
            placeholder="Enter で追加"
          />
          <div className="text-[11px] text-zinc-500 mb-1">推奨タグ:</div>
          <div className="flex gap-1 flex-wrap">
            {SUGGESTED_TAGS.map((t) => {
              const on = keywords.includes(t);
              return (
                <button key={t}
                  onClick={() => on ? removeKeyword(t) : addKeyword(t)}
                  className={`text-[11px] rounded-full px-2 py-0.5 border transition ${
                    on
                      ? 'bg-sky-500 border-sky-400 text-white'
                      : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 text-zinc-600 dark:text-zinc-400'
                  }`}>{t}</button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 検索ボタン */}
      <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 flex items-center gap-3">
        <button
          onClick={search}
          disabled={loading}
          className="rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-bold px-6 py-2.5 shadow-sm"
        >
          {loading ? '検索中…' : '🔎 スカウトを開始する！'}
        </button>
        {error && <div className="text-rose-600 dark:text-rose-400 text-xs">{error}</div>}
        {resp && (
          <div className="text-xs text-zinc-500 ml-auto">
            {resp.results.length}件 / {resp.elapsed_ms}ms
          </div>
        )}
      </div>

      {/* 検索結果 + 詳細 + 履歴 */}
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 flex min-h-0">
          <section className="w-[400px] border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 bg-white dark:bg-zinc-950">
            <ul className="flex-1 overflow-auto divide-y divide-zinc-200 dark:divide-zinc-800">
              {(resp?.results ?? []).map((p) => (
                <li key={p.id}
                    className={`px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 ${selected?.id === p.id ? 'bg-amber-50 dark:bg-zinc-900' : ''}`}
                    onClick={() => setSelected(p)}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-amber-600 dark:text-amber-400 w-12">{(Number(p.final_score ?? p.hybrid_score) || 0).toFixed(2)}</span>
                    <span className="font-bold">{p.name}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{p.nationality} / {p.position} / {p.age}歳</span>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                    <ScoreBar label="vec" v={Number(p.vec_score) || 0} color="bg-emerald-500"/>
                    <ScoreBar label="text" v={Math.min((Number(p.text_score) || 0) / 0.05, 1)} color="bg-sky-500"/>
                    <ScoreBar label="qnt" v={(Number(p.overall_rating) || 0) / 100} color="bg-rose-500"/>
                    {p.mem_boost != null && Number(p.mem_boost) > 0 && (
                      <ScoreBar label="mem9" v={(Number(p.mem_boost) || 0) / 0.2} color="bg-fuchsia-500"/>
                    )}
                  </div>
                </li>
              ))}
              {!resp && !loading && (
                <li className="px-4 py-6 text-zinc-500 text-sm">
                  上のフォームで条件を設定して「スカウトを開始する！」を押してください。
                </li>
              )}
            </ul>
          </section>

          <section className="flex-1 overflow-auto p-6 min-h-0 bg-zinc-50 dark:bg-zinc-950">
            {!selected && <div className="text-zinc-500">左で選手を選んでください。</div>}
            {selected && (
              <div className="max-w-3xl space-y-4">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-3xl font-bold">{selected.name}</h2>
                  <span className="text-zinc-500 dark:text-zinc-400">{selected.nationality} / {selected.club ?? '-'}</span>
                  <button
                    onClick={() => toggleFavorite(selected, favSet.has(selected.id))}
                    className={`ml-auto rounded px-3 py-1 text-sm border ${
                      favSet.has(selected.id)
                        ? 'border-amber-500 bg-amber-500 text-zinc-950'
                        : 'border-zinc-300 dark:border-zinc-700 hover:border-amber-400'
                    }`}>
                    {favSet.has(selected.id) ? '★ Favorited' : '☆ お気に入り'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Profile label="Position" v={selected.position}/>
                  <Profile label="Age" v={`${selected.age}`}/>
                  <Profile label="Foot" v={selected.foot}/>
                  <Profile label="Height" v={selected.height_cm ? `${selected.height_cm}cm` : '-'}/>
                  <Profile label="Overall" v={selected.overall_rating ?? '-'}/>
                  <Profile label="PassAcc" v={selected.pass_accuracy ?? '-'}/>
                </div>
                <div className="grid grid-cols-6 gap-2 text-xs">
                  {(['pace','shooting','passing','dribbling','defending','physic'] as const).map((k) => (
                    <div key={k} className="rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2 text-center">
                      <div className="text-zinc-500 uppercase tracking-wide">{k}</div>
                      <div className="font-bold text-lg">{(selected as any)[k] ?? '-'}</div>
                    </div>
                  ))}
                </div>

                <section>
                  <h3 className="font-bold text-lg mb-2 mt-4">スカウティングレポート</h3>
                  <p className="text-sm leading-7 text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">{selected.report_text}</p>
                </section>

                <section>
                  <h3 className="font-bold text-lg mb-2 mt-4">なぜマッチした？</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <ScoreRow label="ベクトル類似度 (vec_score)" v={selected.vec_score} max={1}/>
                    <ScoreRow label="全文検索 BM25 (text_score)" v={selected.text_score} max={0.05}/>
                    <ScoreRow label="数値合致 (quant_score)" v={selected.quant_score} max={1}/>
                    <ScoreRow label="ハイブリッド合計 (hybrid)" v={selected.hybrid_score} max={1}/>
                    {typeof selected.mem_boost === 'number' && (
                      <ScoreRow label="mem9 ブースト" v={selected.mem_boost} max={0.2}/>
                    )}
                  </div>
                </section>
              </div>
            )}
          </section>
        </main>

        <aside className="w-72 border-l border-zinc-200 dark:border-zinc-800 overflow-auto p-4 space-y-4 text-sm bg-white dark:bg-zinc-950">
          <div>
            <div className="font-bold mb-2">★ お気に入り</div>
            {(history?.favorites ?? []).length === 0 && <div className="text-zinc-500 text-xs">まだなし</div>}
            <ul className="space-y-1">
              {(history?.favorites ?? []).map((f) => (
                <li key={f.player_id} className="text-xs">
                  <span className="text-amber-500">★</span> {f.name} <span className="text-zinc-500">{f.nationality}/{f.position}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-bold mb-2">過去検索</div>
            {(history?.history ?? []).length === 0 && <div className="text-zinc-500 text-xs">まだなし</div>}
            <ul className="space-y-1">
              {(history?.history ?? []).slice(0, 20).map((h) => (
                <li key={h.id} className="text-xs text-zinc-600 dark:text-zinc-400">
                  {h.raw_query.slice(0, 40)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900">
        <button onClick={() => setDebugOpen((v) => !v)} className="w-full text-left px-6 py-2 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400">
          {debugOpen ? '▼' : '▲'} デバッガー: 生成SQL / parsed JSON / embedding 先頭8dim
        </button>
        {debugOpen && resp && (
          <div className="grid grid-cols-3 gap-4 p-4 text-xs font-mono">
            <pre className="bg-zinc-900 text-zinc-100 dark:bg-black/50 rounded p-3 overflow-auto col-span-2 max-h-72">{resp.sql}</pre>
            <div className="space-y-3 max-h-72 overflow-auto">
              <div>
                <div className="text-zinc-500 mb-1">parsed</div>
                <pre className="bg-zinc-900 text-zinc-100 dark:bg-black/50 rounded p-2 whitespace-pre-wrap">{JSON.stringify(resp.parsed, null, 2)}</pre>
              </div>
              <div>
                <div className="text-zinc-500 mb-1">embedding head[0..7]</div>
                <pre className="bg-zinc-900 text-zinc-100 dark:bg-black/50 rounded p-2">[{resp.embedding_head.map((x) => x.toFixed(4)).join(', ')}]</pre>
              </div>
              <div>
                <div className="text-zinc-500 mb-1">bindings</div>
                <pre className="bg-zinc-900 text-zinc-100 dark:bg-black/50 rounded p-2">{JSON.stringify(resp.bindings, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, badge, badgeColor, children }: { title: string; badge: string; badgeColor: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-4 space-y-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-bold text-sm">{title}</h3>
        <span className={`text-[10px] font-mono rounded border px-1.5 py-0.5 ${badgeColor}`}>{badge}</span>
      </div>
      {children}
    </div>
  );
}

function RangeRow({ label, min, max, valueMin, valueMax, onChange, unit }: {
  label: string; min: number; max: number; valueMin: number; valueMax: number;
  onChange: (lo: number, hi: number) => void; unit: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-600 dark:text-zinc-400">{valueMin}–{valueMax} {unit}</span>
      </div>
      <div className="flex gap-2 items-center">
        <input type="range" min={min} max={max} value={valueMin}
          onChange={(e) => onChange(Math.min(+e.target.value, valueMax), valueMax)}
          className="flex-1 accent-rose-500" />
        <input type="range" min={min} max={max} value={valueMax}
          onChange={(e) => onChange(valueMin, Math.max(+e.target.value, valueMin))}
          className="flex-1 accent-rose-500" />
      </div>
    </div>
  );
}

function SingleSliderRow({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-600 dark:text-zinc-400">{value} 以上</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full accent-rose-500" />
    </div>
  );
}

function ScoreBar({ label, v, color }: { label: string; v: number; color: string }) {
  const n = Number(v) || 0;
  const w = Math.max(0, Math.min(1, n));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between"><span>{label}</span><span>{(w * 100).toFixed(0)}</span></div>
      <div className="h-1 bg-zinc-200 dark:bg-zinc-800 rounded">
        <div className={`h-1 rounded ${color}`} style={{ width: `${w * 100}%` }} />
      </div>
    </div>
  );
}

function ScoreRow({ label, v, max }: { label: string; v: number; max: number }) {
  const n = Number(v) || 0;
  const w = Math.max(0, Math.min(1, n / max));
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-400">
        <span>{label}</span><span className="font-mono">{n.toFixed(3)} / {max}</span>
      </div>
      <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded">
        <div className="h-2 rounded bg-amber-500" style={{ width: `${w * 100}%` }} />
      </div>
    </div>
  );
}

function Profile({ label, v }: { label: string; v: any }) {
  return (
    <div className="rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-bold">{v ?? '-'}</div>
    </div>
  );
}

import { useState } from 'react';
import { LEAGUE_POINTS, PLAYOFF_DEFS, playoffPlayers, standings, type League, type PlayoffResult, type Playoffs } from '../../../shared/bnl';
import type { BnlData } from '../../components/show/BnlGraphics';
import { ConfirmButton, Label, Panel, Segmented, TextField } from '../controller/ui';

const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const asPlayers = (names: Record<string, string>) => Object.entries(names).map(([id, name]) => ({ id, name } as any));

export function LeagueAdmin({ data, send }: { data: BnlData; send: (m: any) => void }) {
  const [div, setDiv] = useState(0);
  const lg = data.league;
  const d = lg.divisions[div];
  const set = (l: League) => send({ t: 'league-set', league: l });
  const setDivRows = (rows: typeof d.rows) => set({ ...lg, divisions: lg.divisions.map((x, i) => (i === div ? { ...x, rows } : x)) });
  const rows = standings(d, asPlayers(data.names));
  const allIds = Object.keys(data.names).sort((a, b) => data.names[a].localeCompare(data.names[b]));
  const [add, setAdd] = useState('');
  return (
    <Panel title="League phase" right={<Segmented size="sm" value={String(div)} onChange={v => setDiv(+v)} options={lg.divisions.map((x, i) => ({ value: String(i), label: x.name }))} />}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1"><Label>Season name</Label><TextField value={lg.name} onChange={v => set({ ...lg, name: v })} /></div>
        <label className="text-[12px] text-white/55">Qualify top
          <input type="number" min={1} max={16} className="input ml-2 w-16" value={d.qualify} onChange={e => set({ ...lg, divisions: lg.divisions.map((x, i) => (i === div ? { ...x, qualify: +e.target.value || 1 } : x)) })} />
        </label>
      </div>
      <div className="text-[11px] text-white/40">Points per match: {LEAGUE_POINTS.map((p, i) => `${ord(i + 1)} ${p}`).join(' · ')} · no-show 0 · empty = not played. TB: manual tiebreak rank (lower wins) for head-to-head.</div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[11px] text-white/40">
            <th className="w-8 py-1">#</th><th>Player</th>{Array.from({ length: lg.matches }, (_, i) => <th key={i} className="w-14 text-center">M{i + 1}</th>)}<th className="w-14 text-center">TB</th><th className="w-12 text-center">PTS</th><th className="w-8" />
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const ri = d.rows.findIndex(x => x.player === r.player);
              const row = d.rows[ri];
              return (
                <tr key={r.player} className={`border-t border-white/[0.06] ${r.pos === d.qualify ? 'border-b-2 border-b-white/40' : ''}`}>
                  <td className="py-1 text-white/50">{r.pos}</td>
                  <td className="truncate">{r.name}</td>
                  {row.results.map((v, mi) => (
                    <td key={mi} className="px-0.5">
                      <select className="input w-full px-1 text-center" value={v ?? ''} onChange={e => setDivRows(d.rows.map((x, k) => (k === ri ? { ...x, results: x.results.map((y, j) => (j === mi ? (e.target.value === '' ? null : +e.target.value) : y)) } : x)))}>
                        <option value="">–</option>{[4, 3, 2, 1, 0].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                  ))}
                  <td className="px-0.5"><input type="number" min={0} className="input w-full px-1 text-center" value={row.tb || ''} onChange={e => setDivRows(d.rows.map((x, k) => (k === ri ? { ...x, tb: +e.target.value || 0 } : x)))} /></td>
                  <td className="text-center font-semibold">{r.total}</td>
                  <td><button type="button" className="btn-xs" onClick={() => setDivRows(d.rows.filter((_, k) => k !== ri))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <select className="input min-w-0 flex-1" value={add} onChange={e => setAdd(e.target.value)}>
          <option value="">Add player to {d.name}…</option>
          {allIds.filter(id => !lg.divisions.some(x => x.rows.some(r => r.player === id))).map(id => <option key={id} value={id}>{data.names[id]}</option>)}
        </select>
        <button type="button" className="btn-sm" disabled={!add} onClick={() => { setDivRows([...d.rows, { player: add, results: Array(lg.matches).fill(null), tb: 0 }]); setAdd(''); }}>Add</button>
        <ConfirmButton onConfirm={() => setDivRows(d.rows.map(r => ({ ...r, results: Array(lg.matches).fill(null), tb: 0 })))}>Clear results</ConfirmButton>
      </div>
    </Panel>
  );
}

export function PlayoffsAdmin({ data, send }: { data: BnlData; send: (m: any) => void }) {
  const po = data.playoffs;
  const set = (p: Playoffs) => send({ t: 'playoffs-set', playoffs: p });
  const allIds = Object.keys(data.names).sort((a, b) => data.names[a].localeCompare(data.names[b]));
  const fromStandings = () => {
    const pl = asPlayers(data.names);
    const s1 = standings(data.league.divisions[0], pl).slice(0, 8).map(r => r.player);
    const s2 = data.league.divisions[1] ? standings(data.league.divisions[1], pl).slice(0, 4).map(r => r.player) : po.d2Seeds;
    set({ ...po, d1Seeds: s1, d2Seeds: s2 });
  };
  const setRes = (id: string, r: PlayoffResult | null) => {
    const results = { ...po.results };
    if (r) results[id] = r; else delete results[id];
    set({ ...po, results });
  };
  const seedSel = (list: string[], key: 'd1Seeds' | 'd2Seeds', n: number) => (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <label key={i} className="flex items-center gap-1.5 text-[12px] text-white/50">{i + 1}
          <select className="input min-w-0 flex-1" value={list[i] ?? ''} onChange={e => { const l = Array.from({ length: n }, (_, k) => list[k] ?? ''); l[i] = e.target.value; set({ ...po, [key]: l }); }}>
            <option value="">—</option>{allIds.map(id => <option key={id} value={id}>{data.names[id]}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
  return (
    <Panel title="Playoffs" right={<ConfirmButton onConfirm={fromStandings}>Fill seeds from standings</ConfirmButton>}>
      <Label>Division 1 seeds (top 8)</Label>
      {seedSel(po.d1Seeds, 'd1Seeds', 8)}
      <div className="mt-3"><Label>Division 2 promotion seeds (top 4)</Label></div>
      {seedSel(po.d2Seeds, 'd2Seeds', 4)}
      <div className="mt-4 space-y-2">
        {PLAYOFF_DEFS.map(def => {
          const ids = playoffPlayers(po, def).filter(Boolean) as string[];
          const r = po.results[def.id];
          const order = r?.order ?? [];
          const status = r?.status ?? 'upcoming';
          const base: PlayoffResult = r ?? { order: [], points: {}, status: 'upcoming', time: '' };
          return (
            <div key={def.id} className="rounded-md border border-white/10 bg-[#171717] p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] font-semibold">{def.label}</span>
                <span className="text-[11px] text-white/40">start {def.start} · until {def.winners} left</span>
                <input className="input ml-auto w-24" placeholder="Time" value={base.time} onChange={e => setRes(def.id, { ...base, time: e.target.value })} />
                <Segmented size="sm" value={status} onChange={v => setRes(def.id, { ...base, status: v })} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'live', label: 'Live' }, { value: 'done', label: 'Done' }]} />
                {r && <ConfirmButton onConfirm={() => setRes(def.id, null)}>Clear</ConfirmButton>}
              </div>
              <div className="mt-2 grid gap-1.5 md:grid-cols-2">
                {Array.from({ length: Math.max(ids.length, 4) }, (_, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-8 text-[12px] text-white/50">{ord(i + 1)}</span>
                    <select className="input min-w-0 flex-1" value={order[i] ?? ''} onChange={e => { const o = Array.from({ length: Math.max(ids.length, 4) }, (_, k) => order[k] ?? ''); o[i] = e.target.value; setRes(def.id, { ...base, order: o.filter(Boolean) as string[] }); }}>
                      <option value="">—</option>{ids.map(id => <option key={id} value={id}>{data.names[id]}</option>)}
                    </select>
                    {order[i] && <input type="number" className="input w-16 px-1 text-center" title="Points left" value={base.points[order[i]] ?? ''} onChange={e => setRes(def.id, { ...base, points: { ...base.points, [order[i]]: +e.target.value } })} />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-white/40">Results saved from the Reverse Cup desk in the controller land here automatically.</div>
    </Panel>
  );
}

import { useEffect, useState } from 'react';
import type { ControllerState, Show } from '../../../shared/types';
import type { QuickOp, RcOp } from '../../../shared/protocol';
import { PLAYOFF_DEFS, RC_DNF, RC_REPARTITION, type ReverseCup } from '../../../shared/bnl';
import type { BnlData } from '../../components/show/BnlGraphics';
import { ConfirmButton, Label, Segmented, Switch, TextField } from './ui';

const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** Reverse Cup scoring desk. Every action is instant (scores go straight to air). */
export function ReverseCupPanel({ live, st, quick, bnl }: { live: Show; st: ControllerState; quick: (op: QuickOp) => void; bnl: BnlData | null }) {
  const rc: ReverseCup = live.rc;
  const op = (o: RcOp) => quick({ k: 'rc', op: o });
  const [finish, setFinish] = useState<string[]>([]);
  const [dnf, setDnf] = useState<string[]>([]);
  const [loadDiv, setLoadDiv] = useState<'d1' | 'd2'>('d1');
  const [loadMatch, setLoadMatch] = useState(0);
  // clear the entry when a round has been applied
  useEffect(() => { setFinish([]); setDnf([]); }, [rc.roundAt, rc.mapIndex]);

  const alive = rc.players.filter(p => p.id && p.place === null);
  const n = alive.length;
  const table = RC_REPARTITION[n] ?? [];
  const toggleFinish = (id: string) => {
    setDnf(d => d.filter(x => x !== id));
    setFinish(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]));
  };
  const toggleDnf = (id: string) => {
    setFinish(f => f.filter(x => x !== id));
    setDnf(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]));
  };
  const complete = n > 0 && finish.length + dnf.length === n;
  const playerOpts = st.players.slice().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch on={rc.enabled} onChange={v => op({ a: 'set', patch: { enabled: v } })} label="Use Reverse Cup scoreboard" />
        <span className="text-[12px] text-white/45">Replaces the team scoreboard on gameplay, casters and screens. Changes go to air immediately.</span>
      </div>

      {/* Load a match */}
      <div className="grid gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3 md:grid-cols-2">
        <div>
          <Label>Load playoff match</Label>
          <div className="flex flex-wrap gap-1.5">
            {PLAYOFF_DEFS.map(d => (
              <button key={d.id} type="button" className={`btn-sm ${rc.source?.kind === 'playoff' && rc.source.id === d.id ? 'bg-white text-[#111]' : ''}`} onClick={() => { op({ a: 'load-playoff', id: d.id }); op({ a: 'set', patch: { enabled: true } }); }} title={d.label}>{d.short}</button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-white/40">Fills players from the bracket, start points and winners from the rulebook.</div>
        </div>
        <div>
          <Label>Load league match</Label>
          <div className="flex items-center gap-2">
            <Segmented size="sm" value={loadDiv} onChange={setLoadDiv} options={[{ value: 'd1', label: 'Div 1' }, { value: 'd2', label: 'Div 2' }]} />
            <select className="input w-auto" value={loadMatch} onChange={e => setLoadMatch(+e.target.value)}>
              {Array.from({ length: bnl?.league.matches ?? 5 }, (_, i) => <option key={i} value={i}>Match {i + 1}</option>)}
            </select>
            <button type="button" className="btn-sm" onClick={() => { op({ a: 'load-league', div: loadDiv, match: loadMatch }); op({ a: 'set', patch: { enabled: true } }); }}>Load</button>
          </div>
          <div className="mt-1 text-[11px] text-white/40">Pick the 4 players of the lobby below.</div>
        </div>
      </div>

      {/* Settings */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0"><Label>Title</Label><TextField value={rc.title} onChange={v => op({ a: 'set', patch: { title: v } })} /></div>
        <div><Label>Start points</Label>
          <Segmented size="sm" value={String(rc.start)} onChange={v => op({ a: 'reset', start: +v })} options={[{ value: '100', label: '100 League' }, { value: '120', label: '120 Playoffs' }, { value: '140', label: '140 GF' }]} />
        </div>
        <div><Label>Play until</Label>
          <Segmented size="sm" value={String(rc.winners)} onChange={v => op({ a: 'set', patch: { winners: +v } })} options={[{ value: '1', label: '1 left' }, { value: '2', label: '2 left' }]} />
        </div>
      </div>
      <div>
        <Label>Maps (play order)</Label>
        <div className="grid grid-cols-5 gap-2">
          {rc.maps.map((m, i) => (
            <div key={i} className={`rounded-md border p-1 ${i === rc.mapIndex ? 'border-white/60' : 'border-white/10'}`}>
              <TextField value={m} onChange={v => op({ a: 'set', patch: { maps: rc.maps.map((x, k) => (k === i ? v : x)) } })} />
              <button type="button" className="mt-1 w-full text-[11px] text-white/50 hover:text-white" onClick={() => op({ a: 'set', patch: { mapIndex: i, round: 1 } })}>{i === rc.mapIndex ? '● Current' : 'Set current'}</button>
            </div>
          ))}
        </div>
      </div>

      {/* Lobby */}
      <div>
        <Label>Lobby</Label>
        <div className="grid gap-2 md:grid-cols-2">
          {rc.players.map((p, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-white/10 bg-[#171717] p-2">
              <select className="input min-w-0 flex-1" value={p.id} onChange={e => op({ a: 'player', i, id: e.target.value || null })}>
                <option value="">— empty —</option>
                {playerOpts.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
              <input className="input w-[72px] text-center" type="number" value={p.points} onChange={e => op({ a: 'player', i, id: p.id || undefined as any, points: +e.target.value })} title="Correct points" />
              <span className="w-[42px] text-center text-[12px] text-white/50">{p.place ? ord(p.place) : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Round entry */}
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-semibold">
            {rc.finished ? 'Match finished' : `Map ${rc.mapIndex + 1} · Round ${rc.round} — click players in finishing order`}
          </div>
          <div className="text-[11px] text-white/45">{n > 0 && `${n} alive: ${table.map((v, i) => `${ord(i + 1)} −${v}`).join(' · ')} · DNF −${RC_DNF}`}</div>
        </div>
        {!rc.finished && (
          <div className="grid gap-2 md:grid-cols-4">
            {alive.map(p => {
              const fi = finish.indexOf(p.id), isDnf = dnf.includes(p.id);
              const loss = fi >= 0 ? table[fi] : isDnf ? RC_DNF : null;
              return (
                <div key={p.id} className={`overflow-hidden rounded-md border ${fi >= 0 ? 'border-white bg-white text-[#111]' : isDnf ? 'border-[#e5484d] bg-[#e5484d]/15' : 'border-white/15 bg-[#171717]'}`}>
                  <button type="button" className="w-full px-3 py-3 text-left" onClick={() => toggleFinish(p.id)}>
                    <div className="truncate text-[14px] font-semibold">{p.name}</div>
                    <div className={`text-[12px] ${fi >= 0 ? 'text-black/60' : 'text-white/50'}`}>
                      {p.points} pts{fi >= 0 ? ` · ${ord(fi + 1)} → ${p.points - loss!}` : isDnf ? ` · DNF → ${p.points - RC_DNF}` : ''}
                    </div>
                  </button>
                  <button type="button" className={`w-full border-t px-3 py-1 text-[11px] font-bold tracking-wider ${fi >= 0 ? 'border-black/10 text-black/50' : 'border-white/10 text-white/50 hover:text-white'}`} onClick={() => toggleDnf(p.id)}>{isDnf ? 'UNDO DNF' : 'DNF'}</button>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!rc.finished && <button type="button" className="btn-primary" disabled={!complete} onClick={() => op({ a: 'round', finish, dnf })}>Apply round</button>}
          {!rc.finished && (finish.length > 0 || dnf.length > 0) && <button type="button" className="btn-sm" onClick={() => { setFinish([]); setDnf([]); }}>Clear</button>}
          <button type="button" className="btn-sm" disabled={rc.history.length === 0} onClick={() => op({ a: 'undo' })}>Undo last round</button>
          <ConfirmButton onConfirm={() => op({ a: 'reset' })}>Reset match</ConfirmButton>
          {rc.source && (
            <button type="button" className="btn-sm ml-auto" disabled={!rc.finished} onClick={() => op({ a: 'save' })} title="Write the result to the league table / playoff bracket">
              Save result → {rc.source.kind === 'playoff' ? rc.source.id : `${rc.source.div.toUpperCase()} M${rc.source.match + 1}`}
            </button>
          )}
        </div>
        <div className="mt-2 text-[11px] text-white/40">Players at 0 or below are out. Ties: the player with more points in the previous round places higher. Correct a mistake by typing points in the lobby.</div>
      </div>
    </div>
  );
}

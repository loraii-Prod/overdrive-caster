/**
 * 3.1 Track Progression module (Producer Inspector of the Track Progression graphic, and the 'track' module).
 * One shared state (the event's `wc.track`): every console and the graphic see the same rounds.
 *
 *   Source: Entered here (round buttons, works with no sheet) · Google Sheet (Control tab, or match + track query; Load / Auto)
 *   Start a track: teams of the cast match, track number → map and "picked by" from the map veto (editable)
 *   Rounds: Ace / 2–1 / Draw / 1–2 / Ace for the other team · Undo · fastest lap · key takeaway · Demo / Clear
 */
import { useEffect, useState } from 'react';
import { MAJOR_MAPS } from '../../../shared/maps';
import { MAJOR_PROFILES, MAJOR_TEAMS } from '../../../shared/major';
import { vetoRows, wcResolve, type WcOp } from '../../../shared/wildcard';
import { ROUND_RESULTS, TRACK_CONTROL_TAB, TRACK_DEFAULT_SHEET, lapTime, trackStory, type TrackOp } from '../../../shared/trackProgress';
import { Btn, Chip, Seg, Tiny, PVW, WARN, type Ctx } from './modules';

const send = (op: TrackOp) => fetch('/api/v1/msg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'wc', op: op as WcOp }) }).then(r => (r.ok ? null : `Not sent (${r.status})`)).catch(() => 'Not sent (connection)');
const INPUT = 'h-[24px] min-w-0 rounded-[2px] border border-white/15 bg-black px-1.5 text-[12px] outline-none';
const L = 'w-[70px] flex-none text-[11px] font-bold uppercase tracking-[0.08em] text-white/40';

export function TrackModule({ x }: { x: Ctx }) {
  const t = x.wc.track, d = t.data, src = t.src;
  const s = d ? trackStory(d) : null;
  const [err, setErr] = useState<string | null>(null);
  const op = async (o: TrackOp) => { setErr(null); const e = await send(o); if (e) setErr(e); };

  // a new track: the cast match's teams; track n → the map and who picked it, from the map veto
  const R = wcResolve(x.wc.matches, x.wc.teams), cast = x.wc.cast ? R[x.wc.cast] : null;
  const played = cast ? (Number(x.wc.matches[x.wc.cast!]?.s1) || 0) + (Number(x.wc.matches[x.wc.cast!]?.s2) || 0) : 0;
  const [ta, setTa] = useState(cast?.t1 ?? ''), [tb, setTb] = useState(cast?.t2 ?? '');
  const [num, setNum] = useState(Math.min(5, played + 1));
  useEffect(() => { setTa(cast?.t1 ?? ''); setTb(cast?.t2 ?? ''); setNum(Math.min(5, played + 1)); }, [x.wc.cast, cast?.t1, cast?.t2, played]);
  const veto = vetoRows(x.wc.veto).find(r => r.mapNo === num);
  const [mapId, setMapId] = useState(veto?.map ?? '');
  useEffect(() => setMapId(veto?.map ?? ''), [veto?.map]);
  const pickedBy = !veto ? '' : veto.step.by === 'd' ? 'Decider' : `${veto.step.by === 'a' ? ta : tb} pick`;
  const teams = [...new Set([...MAJOR_TEAMS.map(m => m.name), ...x.wc.teams.filter(Boolean)])];

  const [fp, setFp] = useState(''), [ft, setFt] = useState(''), [fr, setFr] = useState('');
  const [story, setStory] = useState(d?.narrative ?? '');
  useEffect(() => setStory(d?.narrative ?? ''), [d?.narrative]);
  const players = d ? [d.teamA, d.teamB].flatMap(tm => (tm.roster ? tm.roster.split(/\s*&\s*/) : MAJOR_PROFILES.filter(p => p.team === tm.name).map(p => p.handle))) : [];
  const lapMs = (v: string) => { const m = /^(?:(\d+):)?(\d{1,2})[.,](\d{1,3})$/.exec(v.trim()); return m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 + Number(m[3].padEnd(3, '0')) : 0; };

  return (
    <div className="space-y-2 text-[12px]" data-track-module>
      <div className="flex items-center gap-2"><span className={L}>Source</span>
        <Seg value={src.mode} options={[['manual', 'Entered here'], ['sheet', 'Google Sheet']]} onChange={v => op({ k: 'track-src', patch: { mode: v as 'manual' | 'sheet' } })} />
      </div>

      {src.mode === 'sheet' && (
        <div className="space-y-1.5 rounded-[3px] border border-white/10 p-2" data-track-sheet>
          <div className="flex items-center gap-2"><span className={L}>Sheet</span>
            <input aria-label="Sheet id" defaultValue={src.sheetId} key={src.sheetId} placeholder={`${TRACK_DEFAULT_SHEET.slice(0, 14)}… (overlay sheet)`} className={`${INPUT} flex-1`} onBlur={e => e.target.value.trim() !== src.sheetId && op({ k: 'track-src', patch: { sheetId: e.target.value } })} />
          </div>
          <div className="flex items-center gap-2"><span className={L}>Read</span>
            <Seg value={src.match ? 'query' : 'control'} options={[['control', `Control tab`], ['query', 'Match + track']]} onChange={v => op({ k: 'track-src', patch: { match: v === 'query' ? (src.match || 'match_0001') : '' } })} />
          </div>
          {src.match ? (
            <div className="flex items-center gap-2"><span className={L}>Match</span>
              <input aria-label="Sheet match id" defaultValue={src.match} key={src.match} className={`${INPUT} w-[130px]`} onBlur={e => e.target.value.trim() && e.target.value.trim() !== src.match && op({ k: 'track-src', patch: { match: e.target.value } })} data-track-match />
              <span className="text-white/40">track</span>
              {[1, 2, 3, 4, 5].map(n => <Chip key={n} on={src.track === n} onClick={() => op({ k: 'track-src', patch: { track: n } })}>{n}</Chip>)}
            </div>
          ) : (
            <div className="flex items-center gap-2"><span className={L}>Tab</span>
              <input aria-label="Control tab" defaultValue={src.tab} key={src.tab} placeholder={TRACK_CONTROL_TAB} className={`${INPUT} w-[200px]`} onBlur={e => e.target.value.trim() && e.target.value.trim() !== src.tab && op({ k: 'track-src', patch: { tab: e.target.value } })} />
              <span className="text-[10.5px] text-white/35">what the sheet's control panel selects</span>
            </div>
          )}
          <div className="flex items-center gap-2"><span className={L} />
            <span className="whitespace-nowrap"><Btn active onClick={() => op({ k: 'track-load' })} data-track-load="">Load</Btn></span>
            <span data-track-auto=""><Chip on={src.auto} onClick={() => op({ k: 'track-src', patch: { auto: !src.auto } })}>Auto 8 s</Chip></span>
            <span className="text-[11px]" style={{ color: t.error ? '#ff8a8d' : PVW }} data-track-sheet-status>{t.error ? t.error : t.at && d && !t.demo ? `Loaded ${new Date(t.at).toLocaleTimeString()}` : ''}</span>
          </div>
        </div>
      )}

      {src.mode === 'manual' && (
        <div className="space-y-1.5 rounded-[3px] border border-white/10 p-2" data-track-new>
          <div className="flex items-center gap-1.5"><span className={L}>New track</span>
            <select aria-label="Team A" value={ta} onChange={e => setTa(e.target.value)} className={`${INPUT} w-[120px]`}><option value="">Team A</option>{teams.map(n => <option key={n}>{n}</option>)}</select>
            <span className="text-white/40">vs</span>
            <select aria-label="Team B" value={tb} onChange={e => setTb(e.target.value)} className={`${INPUT} w-[120px]`}><option value="">Team B</option>{teams.map(n => <option key={n}>{n}</option>)}</select>
          </div>
          <div className="flex items-center gap-1.5"><span className={L}>Track</span>
            {[1, 2, 3, 4, 5].map(n => <Chip key={n} on={num === n} onClick={() => setNum(n)}>{n}</Chip>)}
            <select aria-label="Map" value={mapId} onChange={e => setMapId(e.target.value)} className={`${INPUT} w-[130px]`}><option value="">Map…</option>{MAJOR_MAPS.map(m => <option key={m.id} value={m.id}>{m.country}</option>)}</select>
          </div>
          <div className="flex items-center gap-1.5"><span className={L} />
            <Btn active disabled={!ta || !tb || ta === tb || !mapId} onClick={() => op({ k: 'track-new', teamA: ta, teamB: tb, mapId, mapNumber: num, pickedBy, matchId: x.wc.cast ?? '' })} data-track-start="">Start track</Btn>
            <span className="truncate text-[10.5px] text-white/40">{veto ? `From the veto: ${pickedBy || 'pick'}` : 'No veto pick for this track: choose the map'}{d && d.rounds.length ? ' · replaces the current rounds' : ''}</span>
          </div>
        </div>
      )}

      {d && s && (
        <div className="space-y-1.5" data-track-live>
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <b className="whitespace-nowrap">{d.teamA.tag || d.teamA.name}</b>
            <span className="font-mono text-[15px] font-bold tabular-nums" data-track-score>{s.scoreA}–{s.scoreB}</span>
            <b className="whitespace-nowrap">{d.teamB.tag || d.teamB.name}</b>
            <span className="whitespace-nowrap text-[11px]" style={{ color: s.done ? PVW : WARN }}>{t.demo ? 'DEMO' : s.done ? 'Track won' : `Round ${s.steps.length + 1} next`} · {d.track.replace(/^OverDrive\s+/i, '').replace(/\s+20\d\d$/, '')}</span>
          </div>
          {src.mode === 'manual' && <>
            <div className="grid grid-cols-5 gap-1" data-track-rounds>
              {ROUND_RESULTS.map(([a, b]) => (
                <button key={`${a}${b}`} type="button" onClick={() => op({ k: 'track-round', ptsA: a, ptsB: b })} data-track-add={`${a}-${b}`}
                  className="h-[34px] rounded-[2px] border border-white/15 text-[11.5px] font-bold leading-tight hover:bg-white/10"
                  title={a === 3 ? `${d.teamA.name} 1-2 (Ace)` : b === 3 ? `${d.teamB.name} 1-2 (Ace)` : a === b ? 'Draw (1-4 / 2-3)' : `${a > b ? d.teamA.name : d.teamB.name} 2–1`}>
                  {a === 3 ? <>◆ {d.teamA.tag}<br />Ace 3–0</> : b === 3 ? <>◆ {d.teamB.tag}<br />Ace 0–3</> : a === b ? <>Draw<br />1–1</> : <>{a > b ? d.teamA.tag : d.teamB.tag}<br />{a}–{b}</>}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tiny title="Remove the last round" disabled={!d.rounds.length} onClick={() => op({ k: 'track-undo' })}>Undo round</Tiny>
              <span className="text-[11px] text-white/40">first to</span>
              <input aria-label="Point threshold" type="number" min={3} max={30} defaultValue={d.pointLimit} key={d.pointLimit} className={`${INPUT} w-[52px]`} onBlur={e => Number(e.target.value) !== d.pointLimit && op({ k: 'track-meta', patch: { pointLimit: Number(e.target.value) } })} />
              <span className="text-[11px] text-white/40">pts</span>
            </div>
          </>}
          <div className="flex flex-wrap items-center gap-1.5"><span className={L}>Fastest lap</span>
            {d.fastest ? <span className="text-white/75" data-track-fastest-set>{d.fastest.player} {lapTime(d.fastest.timeMs)}{d.fastest.round ? ` (R${d.fastest.round})` : ''}</span> : <span className="text-white/35">none</span>}
            {src.mode === 'manual' && <>
              <select aria-label="Fastest player" value={fp} onChange={e => setFp(e.target.value)} className={`${INPUT} w-[100px]`}><option value="">Player</option>{players.map(p => <option key={p}>{p}</option>)}</select>
              <input aria-label="Lap time" value={ft} onChange={e => setFt(e.target.value)} placeholder="41.237" className={`${INPUT} w-[70px]`} />
              <input aria-label="Round" value={fr} onChange={e => setFr(e.target.value.replace(/\D/g, ''))} placeholder="R" className={`${INPUT} w-[34px]`} />
              <Tiny title="Set the fastest lap" disabled={!fp || !lapMs(ft)} onClick={() => op({ k: 'track-meta', patch: { fastest: { player: fp, timeMs: lapMs(ft), round: fr } } })}>Set</Tiny>
              {d.fastest && <Tiny title="Remove" onClick={() => op({ k: 'track-meta', patch: { fastest: null } })}>✕</Tiny>}
            </>}
          </div>
          <div className="flex items-center gap-1.5"><span className={L}>Takeaway</span>
            <input aria-label="Key takeaway" value={story} onChange={e => setStory(e.target.value)} placeholder={s.narrative} className={`${INPUT} flex-1`} />
            <Tiny title={story ? 'Use this text on the graphic' : 'Back to the automatic text'} onClick={() => op({ k: 'track-meta', patch: { narrative: story } })}>{story ? 'Set' : 'Auto'}</Tiny>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t border-white/10 pt-1.5">
        <Tiny title="A demo track (two of our teams, overtime story), labelled DEMO on the graphic" onClick={() => op({ k: 'track-demo' })}>Demo track</Tiny>
        <Tiny title="No track: the graphic draws nothing" disabled={!d} onClick={() => op({ k: 'track-clear' })}>Clear</Tiny>
        {src.mode === 'manual' && t.error && <span className="text-[11px]" style={{ color: '#ff8a8d' }}>{t.error}</span>}
        {err && <span className="text-[11px]" style={{ color: '#ff8a8d' }}>{err}</span>}
      </div>
    </div>
  );
}

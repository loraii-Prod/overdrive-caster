import { useMemo, useState } from 'react';
import type { ControllerState, Show } from '../../../shared/types';
import type { QuickOp } from '../../../shared/protocol';
import { vdoPushUrl } from '../../../shared/players';
import { Dot, Segmented, Switch, TextField } from './ui';

type Send = (m: any) => void;

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function PlayerCamsTab({ st, show, setShow, send, quick, now }: {
  st: ControllerState; show: Show; setShow: (p: Partial<Show>) => void; send: Send; quick: (op: QuickOp) => void; now: number;
}) {
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const live = st.showLive;
  const active = live.activePlayer;
  const lineup = new Set(live.lineup.map(l => l.id));
  const f = st.follow;
  const lg = st.lastGame;
  const players = useMemo(() => {
    const k = q.trim().toLowerCase();
    const ps = [...st.players].sort((a, b) => Number(lineup.has(b.id)) - Number(lineup.has(a.id)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return k ? ps.filter(p => (p.name + ' ' + p.ingame).toLowerCase().includes(k)) : ps;
  }, [st.players, q, live.lineup]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFollow = (p: Partial<typeof f>) => send({ t: 'follow-set', follow: { ...f, ...p } });
  const flash = (id: string) => { setCopied(id); setTimeout(() => setCopied(''), 1200); };
  const toggleLineup = (id: string) => quick({ k: 'lineup', ids: lineup.has(id) ? [...lineup].filter(x => x !== id) : [...lineup, id] });
  const pw = show.vdo.password;
  const age = lg ? Math.round((now - lg.at) / 1000) : 0;
  const matchedName = lg?.matched ? st.players.find(p => p.id === lg.matched)?.name : null;

  return (
    <div className="space-y-5">
      {/* Auto-follow */}
      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Switch on={f.enabled} onChange={v => setFollow({ enabled: v })} label={<b>Follow the game</b>} />
          <div className="flex items-center gap-2 text-[12px] text-white/50">Settle time
            <Segmented size="sm" value={String(f.delayMs)} onChange={v => setFollow({ delayMs: +v })}
              options={['0', '150', '300', '600', '1000'].map(v => ({ value: v, label: `${v}ms` }))} />
          </div>
          <Switch on={f.keepLast} onChange={v => setFollow({ keepLast: v })} label="Keep last cam on free-cam / menus" />
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-black/25 px-3 py-2.5 text-[13px]">
          <Dot tone={lg && now - lg.at < 30_000 ? 'ok' : lg ? 'warn' : 'off'} />
          {lg ? (
            <>
              <span className="text-white/50">Game is showing</span>
              <b>{lg.name || '— nobody (free cam / menu)'}</b>
              {lg.name && (matchedName ? <span className="text-emerald-300/80">→ {matchedName}</span> : <span className="text-amber-300/90">→ no matching player</span>)}
              <span className="text-white/30">{age}s ago</span>
            </>
          ) : <span className="text-white/45">No signal from the game yet. Install the Openplanet plugin below.</span>}
        </div>
        {lg && lg.name && !lg.matched && (
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            <span className="text-white/50">Link “{lg.name}” to</span>
            <select className="input h-8" value={linkTo} onChange={e => setLinkTo(e.target.value)}>
              <option value="">choose player…</option>
              {[...st.players].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" className="btn-sm" disabled={!linkTo} onClick={() => {
              send({ t: 'players-set', players: st.players.map(p => (p.id === linkTo ? { ...p, ingame: lg.login || lg.name } : p)) });
              quick({ k: 'active-player', id: linkTo });
              setLinkTo('');
            }}>Link & switch</button>
          </div>
        )}
      </section>

      {/* On air + display settings */}
      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-white/50">Player cam on gameplay</span>
          {active ? <span className="rounded-[3px] bg-[#e5484d] px-2 py-[2px] text-[11px] font-bold">{active.name}{active.via === 'game' ? ' · auto' : ''}</span> : <span className="text-[12px] text-white/40">none</span>}
          {active && <button type="button" className="btn-xs" onClick={() => quick({ k: 'active-player', id: null })}>Hide</button>}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Switch on={show.playerCam.enabled} onChange={v => setShow({ playerCam: { ...show.playerCam, enabled: v } })} label="Show player cam" />
          <Segmented size="sm" value={show.playerCam.mode} onChange={v => setShow({ playerCam: { ...show.playerCam, mode: v } })} options={[{ value: 'single', label: 'Spectated player' }, { value: 'strip', label: 'All lobby cams (strip)' }]} />
          <Segmented size="sm" value={show.playerCam.corner} onChange={v => setShow({ playerCam: { ...show.playerCam, corner: v } })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          <Segmented size="sm" value={show.playerCam.size} onChange={v => setShow({ playerCam: { ...show.playerCam, size: v } })} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} />
        </div>
        <div className="mt-3 grid grid-cols-[220px_1fr] gap-3">
          <label><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">VDO.Ninja password (optional)</div>
            <TextField value={show.vdo.password} onChange={v => setShow({ vdo: { ...show.vdo, password: v } })} placeholder="none" /></label>
          <label><div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Extra view parameters</div>
            <TextField mono value={show.vdo.params} onChange={v => setShow({ vdo: { ...show.vdo, params: v } })} /></label>
        </div>
        <p className="mt-2 text-[11px] text-white/40">These settings go to preview: press TAKE LIVE. Switching players is instant and needs no TAKE.</p>
      </section>

      {/* Players + links */}
      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">Players in this match <span className="text-white/40">({lineup.size})</span></h2>
          <input className="input w-56" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
          <button type="button" className="btn-sm" disabled={!lineup.size} onClick={async () => {
            const lines = st.players.filter(p => lineup.has(p.id)).map(p => `${p.name}: ${vdoPushUrl(p, pw)}`);
            if (await copy(lines.join('\n'))) flash('all');
          }}>{copied === 'all' ? 'Copied!' : 'Copy links for match'}</button>
          <button type="button" className="btn-sm" disabled={!lineup.size} onClick={() => quick({ k: 'lineup', ids: [] })}>Clear match</button>
        </div>
        <p className="mb-3 text-[11.5px] leading-relaxed text-white/40">
          Tick the players in this match: their cams are preloaded so switching is instant. Send each player their camera link (it opens VDO.Ninja, where they pick their webcam).
        </p>
        <div className="max-h-[520px] space-y-1 overflow-y-auto">
          {players.map(p => {
            const inMatch = lineup.has(p.id), on = active?.id === p.id;
            return (
              <div key={p.id} className={`flex items-center gap-3 rounded-md px-2.5 py-1.5 ${on ? 'bg-[#e5484d]/15 ring-1 ring-[#e5484d]/60' : inMatch ? 'bg-white/[0.05]' : ''}`}>
                <input type="checkbox" className="h-4 w-4 accent-white" checked={inMatch} onChange={() => toggleLineup(p.id)} title="In this match" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{p.name}</div>
                  <div className="truncate text-[11px] text-white/40">{p.ingame ? `in game: ${p.ingame} · ` : ''}{p.vdo}</div>
                </div>
                <button type="button" className="btn-xs" onClick={async () => { if (await copy(vdoPushUrl(p, pw))) flash(p.id); }}>{copied === p.id ? 'Copied' : 'Camera link'}</button>
                <button type="button" className={`btn-xs ${on ? '!border-[#e5484d] !bg-[#e5484d] !text-white' : ''}`} onClick={() => quick({ k: 'active-player', id: on ? null : p.id })}>{on ? 'ON AIR' : 'CAM'}</button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Plugin */}
      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">Openplanet plugin: auto-follow</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-white/65">
          <li><a className="font-semibold text-white underline" href="/api/plugin/BNLCamFollow.op">Download BNLCamFollow.op</a> (already set up with this server and your token).</li>
          <li>Put it in <code className="text-white/80">C:\Users\&lt;you&gt;\OpenplanetNext\Plugins</code> on the PC that runs Trackmania for spectating.</li>
          <li>In game, open Openplanet (F3) → Developer → Load plugin, or restart the game. If Openplanet refuses an unsigned plugin, set Settings → Developer → Signature mode to “Developer”.</li>
          <li>Spectate a player: the status above shows who the game is on, and the cam follows.</li>
        </ol>
        <p className="mt-2 text-[11.5px] text-white/40">If the game runs on another PC, change the plugin's Server URL (Openplanet → Settings → BNL Cam Follow) to this PC's address. Names are matched loosely (colours, dots and “tm” ignored); use “Link” above for anyone whose in-game name is different.</p>
      </section>
    </div>
  );
}

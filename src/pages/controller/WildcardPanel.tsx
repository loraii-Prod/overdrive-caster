import { useEffect, useState, type ReactNode } from 'react';
import type { ClientMsg, QuickOp } from '../../../shared/protocol';
import type { Caster, Show } from '../../../shared/types';
import type { SheetState } from '../../../shared/sheet';
import type { WcLive } from '../../lib/hooks';
import { formatRemaining } from '../../components/show/parts';
import {
  PICK_SCORES, WC_IDS, WC_PARTS, colTime, isWcBackup, matchName, matchStart, nextMatchId, realTeam, shortCode, wcResolve,
  type WcOp, type WcOpts, type WcResolved, type WildcardState,
} from '../../../shared/wildcard';
import { ConfirmButton, CopyField, Segmented, Switch } from './ui';
import { MAJOR_PROFILES, MAJOR_TEAMS, INTRO_VS_SECONDS, introPhase, introScreen, normHandle, teamPlayers } from '../../../shared/major';
import { showcaseList } from '../../components/wildcard/Profiles';
import { seasonOf } from '../../../shared/season';
import { MAJOR_MAPS, mapPhoto } from '../../../shared/maps';
import { pickemTable } from '../../../shared/wildcard';
import { PbEditor, VetoControls } from './Talent';
import { MapArt } from '../../components/wildcard/MapArt';

/** OverDrive Wildcard 2026: bracket controller (replaces the standalone overlay's #control page). */
export function WildcardPanel(props: {
  wc: WcLive | null; send: (m: ClientMsg) => void; quick: (op: QuickOp) => void; live: Show; now: number;
  sheet: SheetState | undefined; origin: string; keyQ: string; outputs: { route: string; count: number }[]; onOpenSheet: () => void;
  /** Casters on air (names / roles for the predictions). */
  casters?: Caster[];
}) {
  if (!props.wc) return <Card title="Major bracket"><p className="text-[13px] text-white/50">Waiting for the server…</p></Card>;
  return <Inner {...props} state={props.wc.state} />;
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">{title}</h2>
        {note && <span className="text-[11px] text-white/35">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** Text/number field that only sends when you leave it or press Enter (no half-typed values on air). */
function CommitField({ value, onCommit, className, label, type = 'text' }: { value: string; onCommit: (v: string) => void; className?: string; label: string; type?: 'text' | 'number' }) {
  const [v, setV] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setV(value); }, [value, focus]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <input className={`input h-7 px-2 text-[12px] ${className ?? ''}`} type={type} aria-label={label} placeholder={label} value={v}
      onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); commit(); }}
      onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

const PLACES: { k: keyof WcOpts; label: string; hint: string }[] = [
  { k: 'inBracket', label: 'Bracket screen', hint: 'Part on air, full frame' },
  { k: 'inIntermission', label: 'Starting / BRB / Thanks', hint: 'Up next + countdown, latest result in the bottom bar' },
  { k: 'inCasters', label: 'Casters screen', hint: 'Up next card, bottom left' },
  { k: 'inGameplay', label: 'Gameplay screen', hint: 'Popups when a map or a match is won' },
  { k: 'inWarmup', label: 'Player / team card: Major showcase', hint: 'Full-screen player and team cards instead of the player cams' },
];

function Inner({ state: s, send, quick, live, now, sheet, origin, keyQ, outputs, onOpenSheet, casters = [] }: Parameters<typeof WildcardPanel>[0] & { state: WildcardState }) {
  const [edit, setEdit] = useState<1 | 2>(s.air);
  const [restore, setRestore] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2500); return () => clearTimeout(t); }, [msg]);
  const op = (o: WcOp) => send({ t: 'wc', op: o });
  const opts = (patch: Partial<WcOpts>) => op({ k: 'opts', patch });
  const R = wcResolve(s.matches, s.teams);
  const castable = WC_IDS.filter(id => (!R[id].winner && realTeam(R[id].t1) && realTeam(R[id].t2)) || id === s.cast);
  const next = nextMatchId(s, R);
  const nextAt = next ? matchStart(s.matches[next]) : null;
  const timer = live.timer.target;
  const nudge = (min: number) => {
    const base = Math.max(Date.now(), timer ?? nextAt ?? Date.now());
    quick({ k: 'timer-until', target: Math.max(Date.now(), base + min * 60_000) });
  };
  const count = (route: string) => outputs.find(o => o.route === route)?.count ?? 0;
  const url = (r: string) => `${origin}/output/${r}${keyQ}`;
  const sheetStatus = !sheet?.id ? null : sheet.error ? <span className="text-amber-300/85">{sheet.error}</span>
    : sheet.lastAt ? <>Sheet synced {new Date(sheet.lastAt).toLocaleTimeString()}{s.enabled && s.sheetAuto ? ' · every 30 s' : ''}</> : 'Sheet not synced yet';

  return (
    <>
      <Card title="First round" note="Pick the 8 teams in bracket order · the rest of the bracket fills in from the scores">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {[0, 1, 2, 3].map(m => (
            <div key={m} className="rounded-md border border-white/[0.07] bg-black/20 p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Upper quarter-final {m + 1}</div>
              {[0, 1].map(k => {
                const i = m * 2 + k;
                return (
                  <select key={k} className="input mb-1 h-8 w-full text-[12.5px]" value={s.teams[i] ?? ''}
                    onChange={e => { const t = [...s.teams]; t[i] = e.target.value; op({ k: 'teams', teams: t }); }}>
                    <option value="">TBD</option>
                    {MAJOR_TEAMS.map(t => <option key={t.name} value={t.name} disabled={s.teams.includes(t.name) && s.teams[i] !== t.name}>{t.name} · {t.how}</option>)}
                  </select>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Major bracket" note="Instant · results are facts, no TAKE needed">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Switch on={s.enabled} onChange={v => op({ k: 'enabled', on: v })} label="Use in the program" title="Bracket, Starting/BRB/Thanks, Casters and Gameplay screens use the Major graphics" />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-white/55">On air</span>
            <Segmented value={String(s.air) as '1' | '2'} onChange={v => op({ k: 'air', part: v === '2' ? 2 : 1 })}
              options={[{ value: '1', label: 'Part 1 · Upper' }, { value: '2', label: 'Part 2 · Lower' }]} />
          </div>
          <div className="flex items-center gap-2 text-[12px] text-white/60">
            <Switch on={s.opts.rotate} onChange={v => opts({ rotate: v })} label="Auto switch every" />
            <CommitField type="number" className="w-14" label="Seconds between parts" value={String(s.opts.rotateSec)} onCommit={v => opts({ rotateSec: Number(v) || 20 })} />
            s
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex items-center gap-2 text-[12px] text-white/60">
            Cast match
            <select className="input h-8 max-w-[420px] text-[12.5px]" value={s.cast ?? ''} onChange={e => op({ k: 'cast', id: e.target.value || null })}>
              <option value="">No cast match</option>
              {castable.map(id => <option key={id} value={id}>{shortCode(id)} · {R[id].t1 ?? 'TBD'} vs {R[id].t2 ?? 'TBD'}{R[id].winner ? ' (finished)' : ''}</option>)}
            </select>
          </label>
          <span className="text-[11px] text-white/40">Marked “On cast” on every graphic, and put on the scoreboard as the featured sheet match.</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
          <Switch on={s.sheetAuto} onChange={v => op({ k: 'sheet-auto', on: v })} label="Scores from the Google Sheet" />
          <button type="button" className="btn-sm" disabled={!sheet?.id} onClick={() => { op({ k: 'pull' }); setMsg('Pulling the sheet…'); }}>Pull from sheet now</button>
          <span className="text-[12px] text-white/50">{sheetStatus ?? <>No sheet set: <button type="button" className="underline hover:text-white" onClick={onOpenSheet}>Tournament → Google Sheet</button></>}</span>
          {msg && <span className="text-[12px] text-emerald-300/80">{msg}</span>}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
          A sheet value only overwrites a match when it changes on the sheet, so a correction made here stays until the sheet changes. “Pull from sheet now” overwrites every match with the sheet.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/[0.06] pt-3">
          <Switch on={s.opts.title} onChange={v => opts({ title: v })} label="Header" />
          <Switch on={s.opts.times} onChange={v => opts({ times: v })} label="Times" />
          <Switch on={s.opts.seeds} onChange={v => opts({ seeds: v })} label="Seeds" />
          <Switch on={s.opts.bg} onChange={v => opts({ bg: v })} label="Dark backdrop" title="Turns transparency off" />
          <label className="flex items-center gap-2 text-[12px] text-white/60">
            Box opacity
            <input type="range" min={40} max={100} value={s.opts.opacity} onChange={e => opts({ opacity: Number(e.target.value) })} className="accent-[#FF6A13]" />
            <span className="w-9 tabular-nums">{s.opts.opacity}%</span>
          </label>
        </div>
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/45">In /output/program</div>
          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            {PLACES.map(p => <Switch key={p.k} on={s.opts[p.k] as boolean} disabled={!s.enabled} onChange={v => opts({ [p.k]: v })} label={p.label} title={p.hint} />)}
          </div>
        </div>
      </Card>

      <Card title="Matches" note="+ / − maps · first to 3 · WO = walkover win">
        <div className="mb-3">
          <Segmented size="sm" value={String(edit) as '1' | '2'} onChange={v => setEdit(v === '2' ? 2 : 1)}
            options={[{ value: '1', label: 'Part 1 matches' }, { value: '2', label: 'Part 2 matches' }]} />
        </div>
        <div className="space-y-4">
          {WC_PARTS[edit].cols.map(col => {
            const t = colTime(s, col.ids);
            return (
              <section key={col.name}>
                <h3 className="mb-2 flex items-baseline gap-3 text-[13px] font-extrabold uppercase italic">
                  {col.name}
                  <span className="text-[12px] font-semibold normal-case not-italic text-white/45">{col.major ? 'Winner takes the OverDrive Major' : t ? `${t} CET` : ''}</span>
                </h3>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
                  {col.ids.map(id => <MatchCard key={id} id={id} s={s} r={R[id]} op={op} />)}
                </div>
              </section>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5">
        <Card title="Gameplay popups" note="Every gameplay source shows it">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn-sm" onClick={() => op({ k: 'test', kind: 'map' })}>Test map popup</button>
            <button type="button" className="btn-sm" onClick={() => op({ k: 'test', kind: 'match' })}>Test match popup</button>
            <button type="button" className="btn-sm" onClick={() => op({ k: 'replay' })}>Replay last</button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">Real popups come by themselves when a map is won or a match ends, from the sheet or from the score buttons here. Reloading a source never replays old results.</p>
        </Card>
        <Card title="Waiting screen countdown" note="Shared with the show countdown">
          <div className="mb-2 font-display text-[26px] font-semibold tabular-nums">
            {timer != null ? formatRemaining(timer - now) : nextAt != null ? <span className="text-white/60">{nextAt > now ? formatRemaining(nextAt - now) : 'Starting soon'}</span> : <span className="text-white/30">--:--</span>}
            <span className="ml-3 align-middle text-[11px] font-normal text-white/45">{timer != null ? `Manual · ends ${new Date(timer).toLocaleTimeString()}` : next ? `Following the start time of ${shortCode(next)}` : 'No match to count down to'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 5, 10, 15, 20, 30].map(n => <button key={n} type="button" className="btn-xs" onClick={() => quick({ k: 'timer-start', minutes: n })}>{n} min</button>)}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[-5, -1, 1, 5].map(n => <button key={n} type="button" className="btn-xs" onClick={() => nudge(n)}>{n > 0 ? `+${n}` : `−${-n}`} min</button>)}
            <button type="button" className={`btn-xs ${timer == null ? '!border-white/60' : ''}`} onClick={() => quick({ k: 'timer-stop' })}>Match time</button>
          </div>
        </Card>
      </div>

      <IntroCard s={s} op={op} now={now} casters={casters} />
      <Card title="Pick'em" note="Your picks, scored when each match ends · 1 = right winner, 3 = exact score">
        {pickemTable(s).length ? (
          <div className="flex flex-wrap items-center gap-2">
            {pickemTable(s).map((r, i) => <span key={r.slot} className="rounded-md bg-black/30 px-3 py-1.5 text-[13px]"><b>{i + 1}. {casters.find(c => String(c.id) === r.slot)?.name || `Slot ${r.slot}`}</b> <span className="text-white/55">{r.points} pts · {r.right}/{r.played}</span></span>)}
            <button type="button" className="btn-xs ml-auto" onClick={() => { if (window.confirm("Clear the pick'em standings?")) op({ k: 'pickem-reset' }); }}>Reset</button>
          </div>
        ) : <p className="text-[12.5px] text-white/45">No finished match with picks yet. Enter picks from the scene dock before each match; they're scored when the match ends. Show the table on the desk: Desk → Pick'em.</p>}
      </Card>
      <Card title="Team PBs" note="Shown on the veto screen after each pick · kept for the whole event"><PbEditor s={s} op={op} /></Card>
      <Card title="Map veto" note="Instant · shows on the Map veto screen · resets when the match changes"><VetoControls s={s} op={op} /></Card>
      <MapsCard s={s} op={op} />
      <ShowcaseCard s={s} op={op} now={now} />

      <Card title="Major OBS sources" note="1920 × 1080 · not needed with /output/program">
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {[
            ['major', 'Bracket (part on air · ?part=1 or ?part=2 pins one)'],
            ['major/gameplay', 'Gameplay popups'],
            ['major/waiting', 'Waiting screen (over the Start/BRB/End loop video)'],
            ['major/casters', 'Casters booth: up next card'],
          ].map(([r, label]) => <CopyField key={r} value={url(r)} label={<>{label} {count(r) > 0 && <span className="ml-1 text-emerald-400/80">● {count(r)}</span>}</>} />)}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Add <code>?cast=R2_UB1</code> to pin a cast match on one source. The waiting screen's title follows the screen text of Starting soon / BRB / Thanks (whichever is on air); <code>?title=none</code> hides it.
        </p>
      </Card>

      <Card title="Backup">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn-sm" onClick={() => {
            const data = JSON.stringify({ matches: s.matches, opts: s.opts, air: s.air, cast: s.cast });
            navigator.clipboard?.writeText(data).then(() => setMsg('Backup copied'), () => setRestore(data));
          }}>Copy backup</button>
          <ConfirmButton confirmLabel="Clear every score and live flag?" onConfirm={() => op({ k: 'reset' })}>Clear all scores</ConfirmButton>
          {msg && <span className="text-[12px] text-emerald-300/80">{msg}</span>}
        </div>
        <div className="mt-2 flex gap-1.5">
          <textarea className="input h-16 min-w-0 flex-1 py-1.5 font-mono text-[11px]" value={restore} onChange={e => setRestore(e.target.value)}
            placeholder="Paste a backup here (from this panel or from the old standalone overlay's Copy backup)" />
          <button type="button" className="btn-sm self-start" disabled={!restore.trim()} onClick={() => {
            let data: unknown = null;
            try { data = JSON.parse(restore); } catch { /* not JSON */ }
            if (!isWcBackup(data)) { setMsg("That text isn't a bracket backup."); return; }
            op({ k: 'restore', data }); setRestore(''); setMsg('Backup restored');
          }}>Restore</button>
        </div>
        <p className="mt-1.5 text-[11px] text-white/40">Match times stay when you clear scores.</p>
      </Card>
    </>
  );
}

function MatchCard({ id, s, r, op }: { id: string; s: WildcardState; r: WcResolved; op: (o: WcOp) => void }) {
  const st = s.matches[id];
  const ready = realTeam(r.t1) && realTeam(r.t2);
  const live = st.live && !r.winner;
  const line = (name: string | null, side: 1 | 2, hint: string) => {
    const v = side === 1 ? st.s1 : st.s2;
    const shown = !name ? hint || 'To be decided' : name === 'BYE' ? 'Bye' : name;
    return (
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <span className={`truncate text-[13px] ${!name ? 'italic text-white/35' : r.winner === name ? 'font-bold text-[#FF6A13]' : 'font-semibold'}`}>{shown}</span>
        {ready && (
          <span className="flex items-center gap-1">
            <button type="button" className="btn-xs w-7" aria-label={`Remove a map from ${name}`} onClick={() => op({ k: 'score', id, side, delta: -1 })}>−</button>
            <span className="w-7 text-center text-[16px] font-black italic">{v === '' ? '–' : v}</span>
            <button type="button" className="btn-xs w-7" aria-label={`Add a map to ${name}`} onClick={() => op({ k: 'score', id, side, delta: 1 })}>+</button>
            <button type="button" className="btn-xs ml-1 text-white/55" title="Walkover win" aria-label={`Walkover win for ${name}`} onClick={() => op({ k: 'wo', id, side })}>WO</button>
          </span>
        )}
      </div>
    );
  };
  return (
    <div className={`grid min-w-0 gap-1.5 rounded-md border bg-black/20 px-3 py-2.5 ${live ? 'border-[#e5484d] shadow-[inset_3px_0_0_#e5484d]' : r.winner ? 'border-[#7A3A1A]' : 'border-white/10'}`}>
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
        <span>{shortCode(id)} · {matchName(id)}</span>
        {live && <span className="text-[#e5484d]">● Live</span>}
        {!live && s.cast === id && !r.winner && <span className="text-[#FFB23F]">On cast</span>}
      </div>
      {line(r.t1, 1, r.hints[0])}
      {line(r.t2, 2, r.hints[1])}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {ready && <button type="button" className={`btn-xs ${st.live ? '!border-[#e5484d] !text-[#ff8a8d]' : ''}`} onClick={() => op({ k: 'live', id })}>{st.live ? 'Stop live' : 'Go live'}</button>}
        {ready && !r.winner && <button type="button" className="btn-xs" onClick={() => op({ k: 'cast', id: s.cast === id ? null : id })}>{s.cast === id ? 'Uncast' : 'Cast'}</button>}
        {ready && <button type="button" className="btn-xs" onClick={() => op({ k: 'clear', id })}>Clear</button>}
        <CommitField className="ml-auto w-[110px]" label={`Start time for ${matchName(id)}`} value={st.time} onCommit={v => op({ k: 'time', id, time: v })} />
      </div>
    </div>
  );
}

/** Warm-up player showcase: timing, team filter, hold a player, and a photo per player. */
/** Map pool: the map card plays from the Gameplay controls; an uploaded photo replaces the drawn artwork. */
function MapsCard({ s, op }: { s: WildcardState; op: (o: WcOp) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const upload = async (id: string, file: File | undefined) => {
    if (!file) return;
    setBusy(id); setErr('');
    try {
      const r = await fetch('/api/upload?role=map', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error ?? `Upload failed (${r.status})`);
      op({ k: 'map-photo', id, url: j.url });
      if (j.advice) setErr(`${id}: uploaded. ${j.advice}`);
    } catch (e: any) { setErr(`${id}: ${e.message ?? e}`); }
    finally { setBusy(null); }
  };
  return (
    <Card title="Map pool · map card" note="Plays from Gameplay → Next map · in-game shots by default; upload to replace">
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
        {MAJOR_MAPS.map(m => (
          <div key={m.id} className="rounded-md border border-white/[0.07] bg-black/20 p-2.5">
            <div className="mb-2 aspect-video overflow-hidden rounded bg-black/40">
              {mapPhoto(m.id, s.mapPhotos) ? <img src={mapPhoto(m.id, s.mapPhotos)} alt="" className="h-full w-full object-cover" /> : <MapArt id={m.id} />}
            </div>
            <div className="text-[13px] font-semibold">{m.title}</div>
            <div className="mb-2 text-[11.5px] text-white/45">by {m.author} · {s.mapPhotos[m.id] ? 'your upload' : 'in-game shot'}</div>
            <div className="flex flex-wrap gap-1.5">
              <label className="btn-xs cursor-pointer">{busy === m.id ? 'Uploading…' : 'Upload photo'}<input type="file" accept="image/*" className="hidden" onChange={e => upload(m.id, e.target.files?.[0])} /></label>
              {s.mapPhotos[m.id] && <button type="button" className="btn-xs" onClick={() => op({ k: 'map-photo', id: m.id, url: null })}>Back to in-game shot</button>}
              <button type="button" className={`btn-xs ${s.map.id === m.id ? '!border-[#e5484d] !text-white' : ''}`} onClick={() => op({ k: 'map', id: m.id })}>Play card</button>
            </div>
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-[12px] text-amber-300/85">{err}</p>}
    </Card>
  );
}

function ShowcaseCard({ s, op, now }: { s: WildcardState; op: (o: WcOp) => void; now: number }) {
  const sc = s.showcase;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const teams = [...new Set(MAJOR_PROFILES.map(p => p.team))];
  const list = showcaseList(s), period = sc.seconds * 1000;
  const onAir = sc.pin ?? normHandle(list[Math.floor(now / period) % list.length].handle);
  const upload = async (handle: string, file: File | undefined) => {
    if (!file) return;
    setBusy(handle); setErr('');
    try {
      const r = await fetch('/api/upload?role=portrait', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error ?? `Upload failed (${r.status})`);
      op({ k: 'photo', player: handle, url: j.url });
      if (j.advice) setErr(`${handle}: uploaded. ${j.advice}`);
    } catch (e: any) { setErr(`${handle}: ${e.message ?? e}`); }
    finally { setBusy(null); }
  };
  return (
    <Card title="Player showcase · Player / team card screen" note="Instant · every source shows the same player">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[12px] text-white/60">
          Players
          <select className="input h-8 text-[12.5px]" value={sc.team} onChange={e => op({ k: 'showcase', patch: { team: e.target.value, pin: null } })}>
            <option value="">All 16 Major players</option>
            {teams.map(t => <option key={t} value={t}>{t} only</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/60">
          Each player
          <CommitField type="number" className="w-14" label="Seconds per player" value={String(sc.seconds)} onCommit={v => op({ k: 'showcase', patch: { seconds: Number(v) || 12 } })} />
          s
        </label>
        {sc.pin
          ? <button type="button" className="btn-sm !border-[#e5484d] !text-[#ff8a8d]" onClick={() => op({ k: 'showcase', patch: { pin: null } })}>Holding {MAJOR_PROFILES.find(p => normHandle(p.handle) === sc.pin)?.handle ?? sc.pin} · resume rotation</button>
          : <span className="text-[12px] text-white/45">Rotating. “Show” holds one player on screen.</span>}
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {MAJOR_PROFILES.map(p => {
          const k = normHandle(p.handle), photo = sc.photos[k], live = onAir === k;
          return (
            <div key={k} className={`flex items-center gap-3 rounded-md border bg-black/20 p-2 ${live ? 'border-[#e5484d]' : 'border-white/10'}`}>
              <div className="h-14 w-14 flex-none overflow-hidden rounded bg-white/[0.06]">
                {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[10px] text-white/30">no photo</div>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold">{p.handle} {live && <span className="ml-1 text-[10px] font-bold tracking-[0.14em] text-[#e5484d]">ON SCREEN</span>}</div>
                <div className="truncate text-[11px] text-white/45">{p.team}</div>
                <div className="mt-1 flex gap-1">
                  <label className="btn-xs inline-flex cursor-pointer items-center">
                    {busy === p.handle ? 'Uploading…' : photo ? 'Replace photo' : 'Add photo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { upload(p.handle, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  {photo && <button type="button" className="btn-xs" onClick={() => op({ k: 'photo', player: p.handle, url: null })}>Remove</button>}
                  <button type="button" className="btn-xs" onClick={() => op({ k: 'showcase', patch: { pin: sc.pin === k ? null : k } })}>{sc.pin === k ? 'Release' : 'Show'}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="mt-2 text-[12px] text-amber-300/85">{err}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">Portrait photos look best (the panel is 800 × 964). Use photos the players or the league provided. A photo set for the same name in the Players tab is used when none is set here.</p>
    </Card>
  );
}

/** Match intro: Team A vs Team B, then each player, on the Warm-up screen. One button plays it. */
function IntroCard({ s, op, now, casters }: { s: WildcardState; op: (o: WcOp) => void; now: number; casters: Caster[] }) {
  const it = s.intro, ph = introPhase(it, now);
  const total = INTRO_VS_SECONDS + (teamPlayers(it.a).length + teamPlayers(it.b).length) * it.step;
  const set = (patch: Partial<Omit<WildcardState['intro'], 'at'>>) => op({ k: 'intro', patch });
  const pick = (side: 'a' | 'b') => (
    <select className="input h-8 text-[12.5px]" value={side === 'a' ? it.a : it.b} onChange={e => set(side === 'a' ? { a: e.target.value } : { b: e.target.value })}>
      <option value="">Team {side.toUpperCase()}…</option>
      {MAJOR_TEAMS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
    </select>
  );
  const resting = introScreen(it, now, !!s.showcase.pin);
  const status = !ph ? (resting ? 'Showing the team card (VS)' : 'Showing the player cards')
    : ph.kind === 'vs' ? (ph.end ? 'Holding the VS screen' : 'VS screen')
    : `Player ${ph.n} / ${ph.of}: ${ph.profile.handle}`;
  return (
    <Card title="Match intro · Player / team card screen" note={`About ${Math.round(total)} s · needs “Player / team card: Major showcase” on`}>
      <div className="flex flex-wrap items-center gap-2">
        {pick('a')}<span className="text-[12px] font-bold text-white/45">VS</span>{pick('b')}
        <button type="button" className="btn-sm ml-2 !border-[#e5484d] !bg-[#e5484d] !text-white" disabled={!it.a || !it.b || it.a === it.b} onClick={() => op({ k: 'intro-play' })}>▶ Play intro</button>
        <button type="button" className="btn-sm" disabled={!it.at} onClick={() => op({ k: 'intro-stop' })}>Stop</button>
        <span className={`text-[12px] ${ph ? 'text-[#ff8a8d]' : 'text-white/45'}`}>{status}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-white/60">
        When not playing, the screen shows
        <Segmented size="sm" value={it.idle} onChange={v => set({ idle: v })}
          options={[{ value: 'vs', label: 'The teams (VS)' }, { value: 'showcase', label: 'Player rotation' }]} />
        <span className="text-white/40">“Show” on a player in the showcase card still puts that player up.</span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
        <CommitField label="Match label" className="h-8 w-full" value={it.label} onCommit={v => set({ label: v })} />
        <CommitField label="Road so far, team A" className="h-8 w-full" value={it.roadA} onCommit={v => set({ roadA: v })} />
        <CommitField label="Road so far, team B" className="h-8 w-full" value={it.roadB} onCommit={v => set({ roadB: v })} />
        <button type="button" className="btn-xs" disabled={!it.a && !it.b} onClick={() => set({ roadA: seasonOf(it.a)?.road ?? it.roadA, roadB: seasonOf(it.b)?.road ?? it.roadB })}>Fill roads from the season</button>
        <label className="flex items-center gap-1.5 text-[12px] text-white/60">
          <CommitField type="number" className="h-8 w-14" label="Seconds per player" value={String(it.step)} onCommit={v => set({ step: Number(v) || 7 })} />s / player
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">
        Fields left to right: match label (e.g. “Upper bracket quarterfinal”), each team's road so far (e.g. “Beat COOK 3–1”; empty shows how they qualified), seconds per player.
        Play cuts the program to the Player / team card screen and plays: VS screen ({INTRO_VS_SECONDS} s), the 4 players, then holds the VS screen until you Stop or switch screen.
      </p>
      {it.a && it.b && it.a !== it.b && <PicksEditor s={s} op={op} casters={casters} />}
    </Card>
  );
}

/** Caster & analyst predictions for the intro match: set by each caster on their camera page, or here. */
export function PicksEditor({ s, op, casters }: { s: WildcardState; op: (o: WcOp) => void; casters: Caster[] }) {
  const it = s.intro;
  const on = casters.filter(c => c.enabled);
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/45">Caster predictions</span>
        <Switch on={it.picksShow} onChange={v => op({ k: 'intro', patch: { picksShow: v } })} label="Show on stream" />
        <Switch on={it.picksLocked} onChange={v => op({ k: 'intro', patch: { picksLocked: v } })} label="Locked" title="Casters can't change their pick any more (you still can)" />
        <span className="text-[11px] text-white/40">Casters pick on their camera link page (Casters tab); it shows in their name bar, on the VS screen and on the analyst desk.</span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {on.length === 0 && <span className="text-[12px] text-white/45">No caster enabled.</span>}
        {on.map(c => {
          const p = it.picks[String(c.id)];
          const set = (x: Partial<{ team: string; score: string }>) => op({ k: 'pick', slot: c.id, pick: { team: x.team ?? p?.team ?? it.a, score: x.score ?? p?.score ?? '' } });
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
              <span className="mr-1 min-w-0 max-w-[120px] truncate text-[12.5px] font-bold">{c.name || `Caster ${c.id}`}<span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">{c.role}</span></span>
              {[it.a, it.b].map(t => <button key={t} type="button" className={`btn-xs ${p?.team === t ? '!border-[#e5484d] !bg-[#e5484d]/25' : ''}`} onClick={() => set({ team: t })}>{t}</button>)}
              {PICK_SCORES.map(sc => <button key={sc} type="button" disabled={!p} className={`btn-xs ${p?.score === sc ? '!border-[#e5484d] !bg-[#e5484d]/25' : ''}`} onClick={() => set({ score: sc })}>{sc.replace('-', '–')}</button>)}
              {p && <button type="button" className="btn-xs ml-auto" onClick={() => op({ k: 'pick', slot: c.id, pick: null })}>✕</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

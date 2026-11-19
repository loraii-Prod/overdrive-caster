/**
 * Producer modules for the audience graphics: Pick'ems, Community MVP, QR. Every button either changes voting (vote
 * service) or PREPARES a graphic step; the step goes to the source only with Publish, and OBS is never switched.
 * Live counts shown here are private: graphics never get them.
 */
import { useEffect, useState } from 'react';
import { STAGES, mvpStage, nextAction, type MvpFlowIn } from '../../../shared/mvpFlow';
import type { AudOp, QrLink } from '../../../shared/audience';
import { MVP_ACHIEVEMENTS, MVP_STATS, pcts, teamRoster } from '../../../shared/audience';
import { matchName, WC_IDS, wcResolve } from '../../../shared/wildcard';
import type { AudPrivate } from '../../../shared/protocol';
import type { AudLive } from '../../lib/hooks';
import { Qr } from '../../components/Qr';
import { Btn, Chip, Seg, Tag, Tiny, PGM, PVW, WARN, type Ctx } from './modules';
import { ChatVotingPanel } from './ChatVoting';

export interface AudCtx { aud: AudLive | null; priv: AudPrivate | null; op: (op: AudOp, label: string) => Promise<string | null> }

function Health({ a }: { a: AudCtx }) {
  const p = a.priv;
  if (!p) return null;
  if (!p.configured) return <div className="rounded-[2px] border px-2 py-1 text-[11.5px]" style={{ borderColor: WARN, color: WARN }}>Vote service not configured (VOTE_URL / VOTE_SECRET): graphics work, no public voting.</div>;
  if (!p.online) return <div data-aud-offline className="rounded-[2px] border px-2 py-1 text-[11.5px] font-bold" style={{ borderColor: PGM, color: '#ff8a8d' }}>Voting offline: {p.error}. Last confirmed {p.summary ? new Date(p.summary.at).toLocaleTimeString() : 'never'}; nothing new is published.</div>;
  return <div className="text-[11px]" style={{ color: PVW }}>● Vote service online · {p.summary?.viewers ?? 0} players</div>;
}

const matchesWithTeams = (x: Ctx) => { const R = wcResolve(x.wc.matches, x.wc.teams); return WC_IDS.filter(id => R[id].t1 && R[id].t2).map(id => ({ id, ...R[id] })); };
const gfxOf = (x: Ctx, id: string) => x.st.graphics?.find(g => g.id === id);

/** Prepare a step of a graphic (its draft), then Publish sends it. */
function Steps({ x, gfx, match, steps, value, disabled }: { x: Ctx; gfx: string; match: string; steps: [string, string, boolean?][]; value: string; disabled?: string }) {
  const g = gfxOf(x, gfx);
  const pub = g?.config.step, pubMatch = g?.config.match, draft = g?.draft?.step;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">{steps.map(([v, l, off]) => <Chip key={v} on={(draft ?? pub) === v && (g?.draft?.match ?? pubMatch) === match} disabled={!!disabled || off}
        title={off ? 'Not ready yet' : 'Prepare this step (Publish sends it)'} onClick={() => x.run({ c: 'gfx-set', id: gfx, patch: { match, step: v } }, `Prepared ${gfx}: ${l}`)}>{l}</Chip>)}</div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-white/50">On source: <b className="text-white/80">{steps.find(s => s[0] === pub)?.[1] ?? String(pub ?? '')}</b>{g?.draft ? <> · prepared: <b style={{ color: PVW }}>{steps.find(s => s[0] === draft)?.[1] ?? '–'}</b></> : null}</span>
        <Btn disabled={!g?.draft} onClick={() => x.run({ c: 'gfx-publish', id: gfx }, `Publish ${gfx}`)} title="Send the prepared step to the browser source (does not switch OBS)">Publish</Btn>
        <Tiny title="Graphic IN" onClick={() => x.run({ c: 'gfx-anim', id: gfx, action: 'in' }, `${gfx} IN`)}>IN</Tiny>
        <Tiny title="Graphic OUT" onClick={() => x.run({ c: 'gfx-anim', id: gfx, action: 'out' }, `${gfx} OUT`)}>OUT</Tiny>
      </div>
      {value && <div className="hidden">{value}</div>}
      {disabled && <div className="text-[11px]" style={{ color: WARN }}>{disabled}</div>}
    </div>
  );
}

function Bars({ rows }: { rows: [string, number][] }) {
  const p = pcts(rows.map(r => r[1]));
  return <div className="space-y-0.5">{rows.map(([k, n], i) => <div key={k} className="flex items-center gap-2 text-[11.5px]"><span className="w-[96px] truncate">{k}</span><div className="h-[6px] flex-1 bg-white/10"><div className="h-full" style={{ width: `${p[i]}%`, background: '#ff6a13' }} /></div><span className="w-[70px] text-right tabular-nums">{n} · {p[i]}%</span></div>)}</div>;
}

// ------------------------------------------------------------------ Pick'ems

export function PickemsModule({ x, a }: { x: Ctx; a: AudCtx }) {
  const ms = matchesWithTeams(x);
  const [sel, setSel] = useState<string>('');
  const id = sel || x.wc.cast || ms[0]?.id || '';
  const m = ms.find(r => r.id === id);
  const t = a.priv?.summary?.matches.find(r => r.id === id);
  const locked = a.priv?.lockedMatches.includes(id);
  const picks = id === x.wc.cast ? x.wc.intro.picks : x.wc.pickem[id] ?? {};
  const nDesk = Object.keys(picks).length;
  const steps: [string, string, boolean?][] = [['intro', 'Sealed'], ...Array.from({ length: Math.max(1, Math.min(4, nDesk)) }, (_, i) => [`d${i + 1}`, `Desk ${i + 1}`] as [string, string]), ['community', 'Community', !t || t.status === 'open'], ['verdict', 'Verdict', !t || t.status === 'open']];
  return (
    <>
      <Health a={a} />
      <div className="flex items-center gap-2"><Tag>Match</Tag>
        <select value={id} onChange={e => setSel(e.target.value)} className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 py-0.5 text-[12px]">
          {ms.map(r => <option key={r.id} value={r.id}>{matchName(r.id)}: {r.t1} vs {r.t2}{r.id === x.wc.cast ? ' (cast)' : ''}</option>)}
        </select></div>
      {!m ? <div className="text-[12px] text-white/50">No match has both teams yet.</div> : <>
        <div className="flex items-center gap-2 text-[12px]"><Tag live>Public picks</Tag>
          <span>{t ? (t.status === 'final' ? 'Final' : t.status === 'locked' ? 'Locked' : 'Open') : '–'} · {t?.total ?? 0} picks</span>
          {t?.status !== 'final' && <Btn danger={!locked} onClick={() => a.op({ k: 'lock-match', match: id, locked: !locked }, locked ? 'Reopen picks' : 'Lock picks')}>{locked ? 'Reopen picks' : 'Lock picks'}</Btn>}
        </div>
        {t && t.total > 0 && <Bars rows={[[m.t1!, t.byTeam[m.t1!] ?? 0], [m.t2!, t.byTeam[m.t2!] ?? 0]]} />}
        <div className="text-[11px] text-white/45">Picks lock by themselves once the match starts. The split above is private until you take the Community step.</div>
        <Tag>Desk picks ({nDesk})</Tag>
        <div className="text-[11.5px] text-white/70">{nDesk ? Object.entries(picks).map(([s, p]) => `${x.st.live.casters.find(c => String(c.id) === s)?.name ?? 'Pos ' + s}: ${p.team} ${p.score}`).join(' · ') : 'Enter them in Predictions (they stay sealed on air until you reveal them).'}</div>
        <Tag>Reveal (prepare, then Publish)</Tag>
        <Steps x={x} gfx="pickem" match={id} steps={steps} value="" />
      </>}
      <Tag live>Community record</Tag>
      <div className="text-[11.5px]">{a.priv?.summary ? `${a.priv.summary.accuracy.right}/${a.priv.summary.accuracy.played} right · ${a.priv.summary.accuracy.points} pts` : '–'}
        {a.priv?.summary?.leaderboard.slice(0, 3).map((r, i) => <span key={r.name} className="ml-2 text-white/60">#{i + 1} {r.name} {r.points}</span>)}</div>
      <div className="flex items-center gap-2 text-[11.5px]"><span>Champion picks: {a.priv?.summary?.champion.total ?? 0}</span>
        <Btn onClick={() => a.op({ k: 'lock-champion', locked: !a.priv?.championLocked }, a.priv?.championLocked ? 'Reopen champion picks' : 'Lock champion picks')}>{a.priv?.championLocked ? 'Reopen champion' : 'Lock champion'}</Btn></div>
    </>
  );
}

// ------------------------------------------------------------------ MVP

const COUNTDOWNS: [string, string][] = [['0', 'No timer'], ['60', '1 min'], ['120', '2 min'], ['180', '3 min'], ['300', '5 min']];

export function MvpModule({ x, a }: { x: Ctx; a: AudCtx }) {
  const archived = a.aud?.archived ?? [];
  const done = matchesWithTeams(x).filter(r => r.winner && r.winner !== 'BYE');
  // 3.0: ONE MVP match for every console (the MVP graphic's match, kept in step with the results by the server).
  // Choosing another match here changes it for everyone (Producer, Studio, graphic, vote), never just this panel.
  const next = [...done].reverse().find(d => !archived.includes(d.id) && d.id !== String(gfxOf(x, 'mvp')?.config.match ?? ''));
  const id = String(gfxOf(x, 'mvp')?.config.match ?? '');
  const setSel = (m: string) => { if (m) void x.run({ c: 'mvp-match', match: m }, `MVP match: ${m}`); };
  const m = done.find(r => r.id === id);
  const roster = m ? [...teamRoster(m.t1!, x.wc.rosters), ...teamRoster(m.t2!, x.wc.rosters)] : [];
  const [off, setOff] = useState<string[]>([]);
  const [cd, setCd] = useState('0');
  const poll = a.priv?.summary?.polls.filter(p => p.match === id).pop();
  const staff = a.aud?.staffMvp[id] ?? {};
  const seats = [1, 2, 3, 4, 5].filter(s => x.st.live.casters.find(c => c.id === s)?.enabled);
  const frozen = !!poll?.frozen;
  const isArchived = archived.includes(id);
  const totalsOn = !!poll && !!a.priv?.liveTotals.includes(poll.id);
  const left = poll?.status === 'open' && poll.closesAt ? Math.max(0, Math.round((poll.closesAt - x.now) / 1000)) : null;
  const g = gfxOf(x, 'mvp'), draftStep = g?.draft?.step, draftMatch = g?.draft?.match;
  const reveal = ['winner', 'desk', 'compare'];
  const [busy, setBusy] = useState(false);
  const once = async (f: () => unknown) => { if (busy) return; setBusy(true); try { await f(); } finally { setTimeout(() => setBusy(false), 600); } };
  const top = poll?.frozen ? Object.entries(poll.frozen.counts).sort((p, q) => q[1] - p[1])[0]?.[0] : undefined;
  const studio = !!x.studio;
  return (
    <>
      <Health a={a} />
      {m && <MvpSequence x={x} a={a} match={id} poll={poll} staff={Object.keys(staff).length > 0} prepare={() => a.op({ k: 'mvp-prepare', match: id, players: roster.filter(p => !off.includes(p.handle)).map(p => p.handle) }, 'Prepare MVP vote')} countdown={Number(cd) || 0} />}
      <div className="flex items-center gap-2"><Tag>Match</Tag>
        <select value={id} onChange={e => { setSel(e.target.value); setOff([]); }} className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 py-0.5 text-[12px]">
          {!done.some(r => r.id === id) && <option value={id}>{id ? `${matchName(id)} (no result yet)` : '— no MVP match yet —'}</option>}
          {done.map(r => <option key={r.id} value={r.id}>{matchName(r.id)}: {r.t1} vs {r.t2}{archived.includes(r.id) ? ' (archived)' : ''}</option>)}
        </select></div>
      {!m ? <><div className="text-[12px] text-white/50">MVP voting opens after a match has a result.</div><ChatVotingPanel a={a} poll={undefined} now={x.now} /></> : <>
        <Tag>Eligible players</Tag>
        <div className="flex flex-wrap gap-1">{roster.map(p => <Chip key={p.handle} on={!off.includes(p.handle)} disabled={!!poll && poll.status !== 'draft'} onClick={() => setOff(o => (o.includes(p.handle) ? o.filter(h => h !== p.handle) : [...o, p.handle]))}>{p.handle}</Chip>)}</div>
        <Tag live>Voting</Tag>
        <div className="flex flex-wrap items-center gap-1 text-[12px]">
          <span className="mr-1" data-testid="mvp-status">{poll ? poll.status.toUpperCase() : 'NOT PREPARED'}</span>
          {(!poll || poll.status === 'draft') && <Btn onClick={() => a.op({ k: 'mvp-prepare', match: id, players: roster.filter(p => !off.includes(p.handle)).map(p => p.handle) }, 'Prepare MVP vote')}>Prepare</Btn>}
          {studio && poll && poll.status !== 'draft' && <span className="text-white/45">Voting is operated in Producer Mode.</span>}
          {!studio && poll?.status === 'draft' && <>
            <Seg value={cd} options={COUNTDOWNS} onChange={setCd} />
            <Btn active onClick={() => a.op({ k: 'mvp-open', poll: poll.id, ...(Number(cd) ? { seconds: Number(cd) } : {}) }, 'Open MVP voting')}>Open voting</Btn>
          </>}
          {!studio && poll?.status === 'open' && <>
            <Btn danger onClick={() => a.op({ k: 'mvp-close', poll: poll.id }, 'Close MVP voting')}>Close voting</Btn>
            <Tiny title="Countdown +30 s" onClick={() => a.op({ k: 'mvp-timer', poll: poll.id, seconds: (left ?? 0) + 30 }, 'MVP countdown +30 s')}>+30s</Tiny>
            {left != null && <Tiny title="Remove the countdown (close by hand)" onClick={() => a.op({ k: 'mvp-timer', poll: poll.id, seconds: null }, 'MVP countdown off')}>No timer</Tiny>}
            {left != null && <span className="tabular-nums text-white/70" data-testid="mvp-countdown">closes in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
          </>}
        </div>
        {poll?.status === 'open' && <div className="flex items-center gap-2 text-[11.5px]">
          <Chip on={totalsOn} onClick={() => a.op({ k: 'mvp-totals', poll: poll.id, on: !totalsOn }, totalsOn ? 'MVP live totals off air' : 'MVP live totals on air')}>Live totals on air</Chip>
          <span className="text-white/45">{totalsOn ? 'Viewers see the running split on the voting graphic.' : 'Off: totals stay private until the reveal.'}</span>
        </div>}
        {poll && poll.status !== 'draft' && <><div className="text-[11px] text-white/50">{poll.status === 'open' ? `Live count (private): ${poll.total ?? 0} votes` : `Frozen at close: ${poll.frozen?.total ?? 0} votes · ${poll.status === 'revealed' ? 'revealed' : 'not revealed yet'}`}</div>
          <Bars rows={poll.players.map(p => [p.handle, (poll.status === 'open' ? poll.counts?.[p.handle] : poll.frozen?.counts[p.handle]) ?? 0] as [string, number]).sort((p, q) => q[1] - p[1])} /></>}
        <ChatVotingPanel a={a} poll={poll} now={x.now} />
        <Tag live>Analyst MVP</Tag>
        {seats.map(s => { const name = x.st.live.casters.find(c => c.id === s)?.name ?? `Pos ${s}`, cur = staff[String(s)]?.player; return (
          <div key={s} className="flex flex-wrap items-center gap-1 text-[11.5px]"><span className="w-[80px] truncate font-bold">{name}</span>
            {roster.map(p => <Chip key={p.handle} on={cur === p.handle} onClick={() => a.op({ k: 'staff-mvp', match: id, slot: s, player: cur === p.handle ? null : p.handle }, `${name} MVP ${p.handle}`)}>{p.handle}</Chip>)}</div>); })}
        <CardEditor a={a} match={id} roster={roster.map(p => p.handle)} suggest={top ?? Object.values(staff)[0]?.player} />
        <Tag>Graphic (prepare, then Publish)</Tag>
        <Steps x={x} gfx="mvp" match={id} value="" disabled={!a.priv?.online && !frozen ? 'Voting offline: the winner can only be shown from a frozen result.' : undefined}
          steps={[['voting', 'Voting open'], ['winner', 'Community MVP', !frozen], ['desk', 'Analyst MVP', !Object.keys(staff).length], ['compare', 'Community vs Analysts', !frozen || !Object.keys(staff).length]]} />
        {!studio && <div className="flex flex-wrap items-center gap-1">
          <Btn disabled={!frozen || busy} title={frozen ? 'Prepare the Community MVP reveal in Preview (Program untouched)' : 'Close voting first'} onClick={() => once(() => x.run({ c: 'gfx-set', id: 'mvp', patch: { match: id, step: 'winner' } }, 'Preview MVP reveal'))}>Preview reveal</Btn>
          <Btn danger disabled={busy || !g?.draft || draftMatch !== id || !reveal.includes(String(draftStep))} title="Publish the prepared reveal to Program (does not switch OBS)"
            onClick={() => once(() => x.run({ c: 'gfx-publish', id: 'mvp' }, 'REVEAL MVP on Program'))}>REVEAL on Program</Btn>
          <span className="text-[11px] text-white/45">{g?.draft && reveal.includes(String(draftStep)) && draftMatch === id ? `Prepared: ${draftStep}` : 'Nothing prepared'}</span>
        </div>}
        {!frozen && <div className="text-[11px] text-white/45">The reveal steps unlock once voting is closed. Closing never shows anything on air.</div>}
        <Tag>Session</Tag>
        <div className="flex flex-wrap items-center gap-1 text-[11.5px]">
          <Btn disabled={poll?.status === 'open'} title={poll?.status === 'open' ? 'Close voting first' : ''} onClick={() => a.op({ k: 'mvp-archive', match: id, on: !isArchived }, isArchived ? 'Restore MVP session' : 'Archive MVP session').then(e => { if (!e && !isArchived && next) setSel(next.id); })}>{isArchived ? 'Restore' : 'Archive & next match'}</Btn>
          <span className="text-white/45">{isArchived ? 'Archived: results kept.' : next && next.id !== id ? `Next: ${matchName(next.id)}` : 'Results stay stored after archiving.'}</span>
        </div>
      </>}
    </>
  );
}

/**
 * The MVP sequence in one row: Voting prepared → open → closed → results ready → Community MVP → Analyst MVP →
 * comparison → next scene, with ONE "next step" button. Reveals ask for a second click when the MVP graphic's
 * "Reveals need producer confirmation" is on (default). Studio shows where the sequence stands; it does not act.
 */
function MvpSequence({ x, a, match, poll, staff, prepare, countdown }: { x: Ctx; a: AudCtx; match: string; poll: import('../../../shared/audience').AudPoll | undefined; staff: boolean; prepare: () => unknown; countdown: number }) {
  const g = gfxOf(x, 'mvp');
  const gMatch = String(g?.config.match || x.wc.cast || '');
  const flow: MvpFlowIn = { status: poll?.status ?? null, frozen: !!poll?.frozen, desk: staff, published: gMatch === match ? String(g?.config.step ?? '') : '' };
  const stage = mvpStage(flow), act = nextAction(flow);
  const confirmOn = (g?.draft?.confirmReveal ?? g?.config.confirmReveal) !== false;
  const [armed, setArmed] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(null), 4000); return () => clearTimeout(t); }, [armed]);
  const i = STAGES.findIndex(s => s.id === stage);
  const step = async () => {
    if (busy) return;
    const key = act.kind === 'reveal' ? act.step : act.kind;
    if (act.critical && confirmOn && armed !== key) { setArmed(key); return; }
    setArmed(null); setBusy(true);
    try {
      if (act.kind === 'prepare') await prepare();
      else if (act.kind === 'open' && poll) await a.op({ k: 'mvp-open', poll: poll.id, ...(countdown ? { seconds: countdown } : {}) }, 'Open MVP voting');
      else if (act.kind === 'close' && poll) await a.op({ k: 'mvp-close', poll: poll.id }, 'Close MVP voting');
      else if (act.kind === 'reveal') {
        // Only this graphic: the reveal step for this match goes to its source (frozen result only: the step is offered
        // by nextAction() only once it is allowed), IN if it was out. OBS is never switched.
        const s1 = await x.run({ c: 'gfx-set', id: 'mvp', patch: { match, step: act.step } }, `Prepare ${act.label}`);
        if (s1.ok) await x.run({ c: 'gfx-publish', id: 'mvp' }, act.label);
        if (s1.ok && g?.anim.action === 'out') await x.run({ c: 'gfx-anim', id: 'mvp', action: 'in' }, 'MVP IN');
      } else if (act.kind === 'next') {
        if (x.st.plan?.next || x.st.plan?.pending) await x.run({ c: 'sp-go' }, 'Show GO (after the MVP)');
        else await x.run({ c: 'gfx-anim', id: 'mvp', action: 'out' }, 'MVP OUT');
      }
    } finally { setTimeout(() => setBusy(false), 500); }
  };
  const replayable = stage === 'community' || stage === 'analyst' || stage === 'compare';
  return (
    <div className="space-y-1.5 rounded-[2px] border border-white/10 bg-white/[0.03] p-1.5" data-mvp-sequence={stage}>
      <div className="flex flex-wrap items-center gap-[3px]">
        {STAGES.map((s, k) => (
          <span key={s.id} data-mvp-stage={s.id} className="rounded-[2px] px-1.5 py-[2px] text-[10.5px] font-bold uppercase tracking-[0.04em]"
            style={k === i ? { background: s.id === 'community' || s.id === 'analyst' || s.id === 'compare' ? PGM : '#fff', color: s.id === 'community' || s.id === 'analyst' || s.id === 'compare' ? '#fff' : '#000' } : k < i ? { color: PVW } : { color: 'rgba(255,255,255,.35)' }}>
            {k < i ? '✓ ' : ''}{s.label}</span>
        ))}
        <span className="px-1 text-[10.5px] font-bold uppercase tracking-[0.04em] text-white/35">→ Next scene</span>
      </div>
      {x.studio ? <div className="text-[11px] text-white/50">Producer Mode runs this sequence (one Next step button; reveals need a second click{confirmOn ? '' : ': confirmation is OFF for this graphic'}).</div> : (
        <div className="flex flex-wrap items-center gap-1">
          <Btn active={!act.critical && act.kind !== 'wait'} danger={act.critical} disabled={busy || act.kind === 'wait'} onClick={step}
            title={act.critical ? (confirmOn ? 'Click twice: the winner goes on air' : 'Goes on air at once (confirmation is off)') : act.label}>
            {act.kind === 'reveal' && armed === act.step ? `CONFIRM: ${act.label}` : `Next step: ${act.label}`}
          </Btn>
          {replayable && <Btn onClick={() => x.run({ c: 'gfx-anim', id: 'mvp', action: 'in' }, 'Replay the MVP reveal')} title="Plays the reveal animation again (same step, same result)">Replay reveal</Btn>}
          <Chip on={confirmOn} onClick={() => x.run({ c: 'gfx-set', id: 'mvp', patch: { confirmReveal: !confirmOn } }, `Reveal confirmation ${confirmOn ? 'off' : 'on'} (prepared)`)}
            title="Reveals need a second click here and a producer GO in automation. Prepared: Publish the MVP graphic to apply.">Confirm reveals</Chip>
        </div>
      )}
    </div>
  );
}

/** Reveal extras for one player: up to 4 stats (label + value) and 3 achievements, entered by the producer. */
export function CardEditor({ a, match, roster, suggest }: { a: AudCtx; match: string; roster: string[]; suggest?: string }) {
  const [who, setWho] = useState('');
  const player = who && roster.includes(who) ? who : suggest && roster.includes(suggest) ? suggest : roster[0] ?? '';
  const card = a.aud?.mvpCards?.[match]?.[player];
  const [draft, setDraft] = useState<{ key: string; stats: { label: string; value: string }[]; ach: string[] } | null>(null);
  const key = `${match}|${player}|${JSON.stringify(card ?? null)}`;
  const d = draft && draft.key === key ? draft : { key, stats: Array.from({ length: MVP_STATS }, (_, i) => card?.stats[i] ?? { label: '', value: '' }), ach: Array.from({ length: MVP_ACHIEVEMENTS }, (_, i) => card?.achievements[i] ?? '') };
  const set = (f: (x: typeof d) => typeof d) => setDraft(f({ ...d, stats: d.stats.map(s => ({ ...s })), ach: [...d.ach] }));
  if (!player) return null;
  return (
    <details className="text-[11.5px]">
      <summary className="cursor-pointer text-white/70">Reveal card: stats & achievements{card ? ' ✓' : ''}</summary>
      <div className="mt-1 space-y-1">
        <select value={player} onChange={e => { setWho(e.target.value); setDraft(null); }} className="rounded-[2px] border border-white/15 bg-black px-1 py-0.5">
          {roster.map(h => <option key={h} value={h}>{h}{h === suggest ? ' (suggested)' : ''}</option>)}</select>
        {d.stats.map((st, i) => <div key={i} className="flex gap-1">
          <input aria-label={`Stat ${i + 1} label`} placeholder="Stat (e.g. Maps won)" maxLength={24} value={st.label} onChange={e => set(x => { x.stats[i].label = e.target.value; return x; })} className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1" />
          <input aria-label={`Stat ${i + 1} value`} placeholder="Value" maxLength={16} value={st.value} onChange={e => set(x => { x.stats[i].value = e.target.value; return x; })} className="w-[80px] rounded-[2px] border border-white/15 bg-black px-1" /></div>)}
        {d.ach.map((t, i) => <input key={i} aria-label={`Achievement ${i + 1}`} placeholder="Achievement (e.g. Fastest lap on Oasis)" maxLength={60} value={t} onChange={e => set(x => { x.ach[i] = e.target.value; return x; })} className="w-full rounded-[2px] border border-white/15 bg-black px-1" />)}
        <div className="flex gap-1">
          <Btn onClick={() => a.op({ k: 'mvp-card', match, player, card: { stats: d.stats, achievements: d.ach } }, `MVP card ${player}`).then(() => setDraft(null))}>Save card</Btn>
          {card && <Btn onClick={() => a.op({ k: 'mvp-card', match, player, card: null }, `Clear MVP card ${player}`).then(() => setDraft(null))}>Clear</Btn>}
        </div>
        <div className="text-white/45">Shown on the reveal under the player (Community, Analyst and agree views). Only what you type here: nothing is computed.</div>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ QR

export function QrModule({ x, a }: { x: Ctx; a: AudCtx }) {
  const links = a.aud?.qr ?? [];
  const g = gfxOf(x, 'qr');
  const cur = String((g?.draft ?? g?.config)?.qr ?? 'vote');
  const link = links.find(l => l.id === cur);
  const [label, setLabel] = useState(''), [url, setUrl] = useState(''), [hours, setHours] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const custom = a.priv?.customQr ?? [];
  const save = async (list: QrLink[]) => { const e = await a.op({ k: 'qr-set', qr: list }, 'QR links'); setErr(e); return !e; };
  return (
    <>
      <div className="flex gap-2">
        <div className="flex-none bg-white p-1">{link ? <Qr url={link.url} size={96} /> : <div className="grid h-[96px] w-[96px] place-items-center text-[10px] text-black/60">no link</div>}</div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap gap-1">{links.map(l => <Chip key={l.id} on={cur === l.id} onClick={() => x.run({ c: 'gfx-set', id: 'qr', patch: { qr: l.id } }, `QR: ${l.label}`)}>{l.label}</Chip>)}</div>
          {link && <div className="truncate text-[11px] text-white/55" title={link.url}>{link.url}{link.expires ? ` · expires ${new Date(link.expires).toLocaleString()}` : ''}</div>}
          <Seg value={String((g?.draft ?? g?.config)?.position ?? 'lower-third')} options={[['lower-third', 'Lower third'], ['corner', 'Gameplay corner'], ['desk', 'Analyst desk']]} onChange={v => x.run({ c: 'gfx-set', id: 'qr', patch: { position: v } }, `QR position ${v}`)} />
          <div className="flex items-center gap-1">
            <Btn disabled={!g?.draft} onClick={() => x.run({ c: 'gfx-publish', id: 'qr' }, 'Publish QR')}>Publish</Btn>
            <Btn active onClick={() => x.run({ c: 'gfx-anim', id: 'qr', action: 'in' }, 'QR IN')}>Show</Btn>
            <Btn onClick={() => x.run({ c: 'gfx-anim', id: 'qr', action: 'out' }, 'QR OUT')}>Hide</Btn>
          </div>
        </div>
      </div>
      {!links.length && <div className="text-[11px]" style={{ color: WARN }}>No approved link yet: set VOTE_PUBLIC_URL, or add one below.</div>}
      <Tag>Custom approved links</Tag>
      {custom.map(q => <div key={q.id} className="flex items-center gap-1 text-[11.5px]"><span className="flex-1 truncate">{q.label}: {q.url}</span><Tiny onClick={() => save(custom.filter(c => c.id !== q.id))}>✕</Tiny></div>)}
      <div className="flex gap-1"><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" className="w-[90px] rounded-[2px] border border-white/15 bg-black px-1 text-[12px]" />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 text-[12px]" />
        <input value={hours} onChange={e => setHours(e.target.value.replace(/\D/g, ''))} placeholder="h" title="Expires after (hours), empty = never" className="w-[34px] rounded-[2px] border border-white/15 bg-black px-1 text-[12px]" />
        <Btn disabled={!label || !url} onClick={async () => { if (await save([...custom, { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'link', label, url, expires: hours ? Date.now() + Number(hours) * 3600e3 : 0 }])) { setLabel(''); setUrl(''); setHours(''); } }}>Add</Btn></div>
      {err && <div className="text-[11px]" style={{ color: '#ff8a8d' }}>{err}</div>}
      <div className="text-[10.5px] text-white/40">Approved hosts: {(a.priv?.qrHosts ?? []).join(', ') || 'none'}. Only https links on these hosts can be shown.</div>
    </>
  );
}

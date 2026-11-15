/**
 * MVP & Awards scenes in Producer Mode: the controls of the selected MVP scene, directly under the preview.
 * Select the scene (preview only, Program untouched) → its controls (prepare / open / close / pick / preview) →
 * TAKE: the server prepares what the scene needs (closes voting, authorizes a reveal), switches OBS to the scene's
 * own browser source and moves the show rundown on. Reveals ask for a second click. Nothing here invents a result:
 * a reveal needs the frozen result (or the analysts' pick), exactly like the MVP sequence.
 */
import { useEffect, useState } from 'react';
import { teamRoster, pcts } from '../../../shared/audience';
import { matchName, wcResolve } from '../../../shared/wildcard';
import { isRevealView, revealAllowed, revealedOf, type MvpFlowIn, type MvpView } from '../../../shared/mvpFlow';
import type { SourceDef } from '../../../shared/registry';
import { Btn, Chip, Seg, Tiny, PGM, PVW, WARN, type Ctx } from './modules';
import type { AudCtx } from './audienceModules';

const COUNTDOWNS: [string, string][] = [['0', 'No timer'], ['60', '1 min'], ['120', '2 min'], ['180', '3 min'], ['300', '5 min']];
const LABEL = "font-['Barlow_Condensed'] font-bold uppercase tracking-[0.1em]";

/** Everything an MVP scene needs to know, from the shared state (same rules as the MVP sequence). */
export function mvpSceneData(x: Ctx, a: AudCtx) {
  const g = x.st.graphics?.find(q => q.id === 'mvp');
  const R = wcResolve(x.wc.matches, x.wc.teams);
  const match = String(g?.config.match || x.wc.cast || '');
  const m = match ? R[match] : undefined;
  const finished = !!m?.winner && m.winner !== 'BYE';
  const roster = m?.t1 && m?.t2 ? [...teamRoster(m.t1), ...teamRoster(m.t2)] : [];
  const poll = a.priv?.summary?.polls.filter(p => p.match === match).pop();
  const staff = a.aud?.staffMvp[match] ?? {};
  const flow: MvpFlowIn = { status: poll?.status ?? null, frozen: !!poll?.frozen, desk: Object.keys(staff).length > 0, published: String(g?.config.step ?? '') };
  const counts = poll?.frozen?.counts ?? {};
  const ranked = Object.entries(counts).sort((p, q) => q[1] - p[1]);
  const total = poll?.frozen?.total ?? 0;
  const community = ranked[0] && ranked[0][1] > 0 ? { handle: ranked[0][0], votes: ranked[0][1], share: total ? Math.round((ranked[0][1] / total) * 100) : 0 } : null;
  const deskPicks = Object.entries(staff).map(([seat, v]) => ({ seat: Number(seat), name: x.st.live.casters.find(c => c.id === Number(seat))?.name ?? `Pos ${seat}`, player: v.player }));
  const revealed = revealedOf(g?.config, match);
  return { g, match, m, finished, roster, poll, staff, flow, community, deskPicks, revealed, ranked, total };
}

const VIEW_TITLE: Record<MvpView, string> = { voting: 'Community MVP voting', closed: 'Voting closed', winner: 'Community MVP reveal', desk: 'Analyst MVP', compare: 'Comparison' };
const TAKE_LABEL: Record<MvpView, string> = { voting: 'TAKE · Voting open', closed: 'TAKE · Voting closed', winner: 'REVEAL · Community MVP', desk: 'REVEAL · Analyst MVP', compare: 'TAKE · Comparison' };

export function MvpSceneControls({ x, a, src, obsTr }: { x: Ctx; a: AudCtx; src: SourceDef; obsTr?: 'obs' | 'stinger' | 'fade' | 'cut' }) {
  const view = src.gfxView as MvpView;
  const D = mvpSceneData(x, a);
  const { g, match, m, poll, flow } = D;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [cd, setCd] = useState(String(g?.config.countdown ?? 0));
  useEffect(() => { setArmed(false); setErr(null); }, [view, match]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => setCd(String(g?.config.countdown ?? 0)), [g?.config.countdown]);
  useEffect(() => { setPick(D.roster.slice(0, 4).map(p => p.handle)); }, [match]); // eslint-disable-line react-hooks/exhaustive-deps

  const obsScene = x.st.obs.scenes.find(n => n === `Overdrive · ${src.name}`);
  const onAir = !!obsScene && x.st.obs.currentScene === obsScene;
  const reveal = isRevealView(view);
  const why = reveal ? revealAllowed(view, flow) : !D.finished ? 'MVP voting opens after the match has a result' : null;
  const confirm = reveal && g?.config.confirmReveal !== false;
  const plan = x.st.plan, nextSeg = plan?.next ? plan.segments.find(s => s.id === plan.next) : undefined;
  const left = poll?.status === 'open' && poll.closesAt ? Math.max(0, Math.round((poll.closesAt - x.now) / 1000)) : null;
  const totalsOn = !!poll && !!a.priv?.liveTotals.includes(poll.id);
  const chat = a.priv?.chat;
  const authorized = reveal && D.revealed.includes(view as 'winner' | 'desk' | 'compare');

  const act = async (f: () => Promise<string | null | undefined>) => { if (busy) return; setBusy(true); setErr(null); try { const e = await f(); if (e) setErr(e); } finally { setBusy(false); } };
  const aud = (op: Parameters<AudCtx['op']>[0], label: string) => act(() => a.op(op, label));
  const take = () => act(async () => {
    if (confirm && !armed) { setArmed(true); return null; }
    setArmed(false);
    const r = await x.run({ c: 'mvp-take', view, ...(obsTr && obsTr !== 'obs' ? { transition: obsTr } : {}) }, TAKE_LABEL[view]);
    return r.ok ? null : r.error ?? 'TAKE failed';
  });
  const replay = () => act(async () => { const r = await x.run({ c: 'gfx-anim', id: 'mvp', action: 'in' }, 'Replay MVP animation'); return r.ok ? null : r.error ?? null; });

  const status = poll ? poll.status.toUpperCase() : D.finished ? 'NOT PREPARED' : 'NO RESULT YET';
  const tone = poll?.status === 'open' ? PGM : poll?.status === 'closed' || poll?.status === 'revealed' ? PVW : 'rgba(255,255,255,.45)';
  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-white/10 px-3 py-2" data-mvp-scene={view} style={{ background: 'rgba(255,106,19,.05)' }}>
      {/* Row 1: which match, where the vote stands, participation · TAKE · next rundown item */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className={`${LABEL} text-[13px] text-white/85`}>{VIEW_TITLE[view]}</span>
        <span className="text-white/55">{match ? `${matchName(match)}${m?.t1 ? ` · ${m.t1} vs ${m.t2}` : ''}` : 'No match selected'}</span>
        <span className={`${LABEL} rounded-[2px] px-1.5 text-[11px]`} style={{ border: `1px solid ${tone}`, color: tone }} data-mvp-poll-status>{status}</span>
        {left != null && <span className="font-mono tabular-nums text-white/75" data-mvp-left>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
        {poll && poll.status !== 'draft' && <span className="text-white/55" data-mvp-participation>{poll.status === 'open' ? `${poll.total ?? 0} votes` : `${poll.frozen?.total ?? 0} votes frozen`}{poll.bySource && (poll.bySource.chat > 0 || poll.chat) ? ` · chat ${poll.bySource.chat} · web ${poll.bySource.web}` : ''} · {a.priv?.summary?.viewers ?? 0} players</span>}
        {chat && poll?.chat && <span className="text-[11px]" style={{ color: chat.conn === 'listening' ? PVW : WARN }}>chat {chat.conn === 'listening' ? `● ${chat.channel?.login ?? ''}` : chat.conn}</span>}
        {reveal && <span className="text-[11px]" style={{ color: authorized ? PVW : 'rgba(255,255,255,.45)' }} data-mvp-authorized={authorized ? 'yes' : 'no'}>{authorized ? 'reveal authorized · on its source' : 'source draws nothing until TAKE'}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {onAir && <span className={`${LABEL} rounded-[2px] px-1.5 text-[11px] text-white`} style={{ background: PGM }}>On air</span>}
          <button type="button" disabled={busy || !!why || !x.st.obs.connected && !obsScene} onClick={take} data-mvp-take={armed ? 'armed' : 'ready'}
            title={why ?? (obsScene ? `Switch OBS to “${obsScene}”${reveal ? ' and authorize the reveal' : ''}` : 'No OBS scene yet: build the MVP scenes (Studio → OBS & Outputs)')}
            className={`${LABEL} h-[26px] rounded-[2px] px-3 text-[13px] text-white disabled:opacity-35 ${armed ? 'animate-pulse' : ''}`} style={{ background: armed ? '#ff6a13' : PGM }}>
            {armed ? `CONFIRM ${TAKE_LABEL[view].replace(/^TAKE · |^REVEAL · /, '')}` : view === 'closed' && poll?.status === 'open' ? 'Close voting + TAKE' : TAKE_LABEL[view]}</button>
          {nextSeg && <Btn disabled={busy} onClick={() => act(async () => { const r = await x.run({ c: 'sp-go' }, `GO · ${nextSeg.label}`); return r.ok ? null : r.error ?? null; })} title="Show rundown: take the next segment (F9)">Next: {nextSeg.label}</Btn>}
        </span>
      </div>
      {why && <div className="text-[11.5px]" style={{ color: WARN }} data-mvp-why>{why}</div>}
      {err && <div className="text-[11.5px]" style={{ color: '#ff8a8d' }} data-mvp-error>{err}</div>}

      {/* Row 2: what this scene controls */}
      {(view === 'voting' || view === 'closed') && D.finished && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {(!poll || poll.status === 'draft') && <>
            <span className="text-white/50">Candidates ({pick.length}/4)</span>
            {D.roster.map(p => <Chip key={p.handle} on={pick.includes(p.handle)} disabled={!pick.includes(p.handle) && pick.length >= 4} onClick={() => setPick(s => (s.includes(p.handle) ? s.filter(h => h !== p.handle) : [...s, p.handle]))}>{p.handle}</Chip>)}
            <Btn disabled={busy || pick.length < 2} onClick={() => aud({ k: 'mvp-prepare', match, players: pick }, 'Prepare MVP candidates')}>{poll ? 'Update candidates' : 'Prepare candidates'}</Btn>
          </>}
          {poll?.status === 'draft' && <>
            <span className="mx-1 h-4 w-px bg-white/10" />
            <Seg value={cd} options={COUNTDOWNS.some(c => c[0] === cd) ? COUNTDOWNS : [...COUNTDOWNS, [cd, `${cd} s`]]} onChange={setCd} />
            <Btn active disabled={busy} onClick={() => aud({ k: 'mvp-open', poll: poll.id, ...(Number(cd) ? { seconds: Number(cd) } : {}) }, 'Open MVP voting')}>Open voting</Btn>
          </>}
          {poll?.status === 'open' && <>
            <Btn danger disabled={busy} onClick={() => aud({ k: 'mvp-close', poll: poll.id }, 'Close MVP voting')}>Close voting</Btn>
            <Tiny title="Countdown +30 s" onClick={() => aud({ k: 'mvp-timer', poll: poll.id, seconds: (left ?? 0) + 30 }, 'MVP countdown +30 s')}>+30s</Tiny>
            {left != null && <Tiny title="Remove the countdown" onClick={() => aud({ k: 'mvp-timer', poll: poll.id, seconds: null }, 'MVP countdown off')}>No timer</Tiny>}
            <Chip on={totalsOn} onClick={() => aud({ k: 'mvp-totals', poll: poll.id, on: !totalsOn }, totalsOn ? 'MVP live totals off air' : 'MVP live totals on air')}>Live totals on air</Chip>
            <span className="text-white/40">{poll.players.slice(0, 4).map(p => p.handle).join(' · ')}</span>
          </>}
          {(poll?.status === 'closed' || poll?.status === 'revealed') && <MiniBars rows={D.ranked.slice(0, 4)} note={`Frozen ${poll.frozen?.hash ?? ''} · producer only`} />}
        </div>
      )}
      {view === 'winner' && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-white/50">Winner preview (producer only)</span>
          {D.community ? <b className="text-[14px]" data-mvp-winner-preview>{D.community.handle} · {D.community.share}% ({D.community.votes} of {D.total})</b> : <span className="text-white/45">{poll?.status === 'open' ? 'Voting still open' : 'No frozen result yet'}</span>}
          <span className="text-white/45">Reveal: {String(g?.config.revealPace ?? 'cinematic')}{g?.config.revealSweep === false ? ' · no sweep' : ''}</span>
          <Btn disabled={busy || !authorized} onClick={replay} title={authorized ? 'Replay the reveal animation on the sources' : 'Available after the reveal'}>Replay animation</Btn>
        </div>
      )}
      {view === 'desk' && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {[1, 2, 3, 4, 5].filter(s => x.st.live.casters.find(c => c.id === s)?.enabled).map(s => {
            const name = x.st.live.casters.find(c => c.id === s)?.name ?? `Pos ${s}`, cur = D.staff[String(s)]?.player;
            return <span key={s} className="flex flex-wrap items-center gap-1"><b className="mr-0.5 max-w-[90px] truncate">{name}</b>
              {D.roster.map(p => <Chip key={p.handle} on={cur === p.handle} disabled={authorized} onClick={() => aud({ k: 'staff-mvp', match, slot: s, player: cur === p.handle ? null : p.handle }, `${name} MVP ${p.handle}`)}>{p.handle}</Chip>)}
              <span className="mx-1 h-4 w-px bg-white/10" /></span>;
          })}
          <Btn disabled={busy || !authorized} onClick={replay}>Replay animation</Btn>
        </div>
      )}
      {view === 'compare' && (
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <span>Community: <b data-mvp-compare-community>{D.community?.handle ?? '—'}</b>{D.community ? ` (${D.community.share}%)` : ''}</span>
          <span>Analysts: <b data-mvp-compare-desk>{D.deskPicks.map(p => p.player).join(' · ') || '—'}</b></span>
          <span className="text-white/45">{D.community && D.deskPicks.some(p => p.player === D.community!.handle) ? 'Same player: agreement' : D.community && D.deskPicks.length ? 'Different players' : ''}</span>
          <Btn disabled={busy || !authorized} onClick={replay}>Replay animation</Btn>
        </div>
      )}
    </div>
  );
}

function MiniBars({ rows, note }: { rows: [string, number][]; note: string }) {
  const p = pcts(rows.map(r => r[1]));
  return <span className="flex flex-wrap items-center gap-2">{rows.map(([h, n], i) => <span key={h} className="tabular-nums"><b>{h}</b> {p[i]}% <span className="text-white/40">({n})</span></span>)}<span className="text-[11px] text-white/35">{note}</span></span>;
}

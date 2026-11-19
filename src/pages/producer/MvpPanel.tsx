/**
 * Overdrive 3.0 · MVP CONTROL PANEL (Producer Mode, when the MVP main scene is selected).
 *
 * Everything here reads ONE MVP state: the MVP match (the MVP graphic's `match`, kept in step with the results by the
 * server), that match's vote, and this event's rosters. Nothing is chosen locally: changing the match here changes it
 * for every console, the graphic, OBS's sources and the vote.
 *
 *   notice (MVP ready / queued / failed) · rehearsal bar · match · status · counting · TAKE
 *   views (Voting → Closed → Community → Analyst → Comparison)
 *   candidates (pictures, teams, stats, live %) · missing data (players, pictures) · readiness checklist
 *   controls: vote (prepare / start / stop / countdown) · QR · counting · rehearsal votes · manual MVP · analysts ·
 *             reveal · automation · rehearsal · next match
 * Choosing a view only changes the preview (and OBS's Preview in Studio Mode); TAKE puts it on Program.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { WC_IDS, matchName, wcLogo, wcResolve } from '../../../shared/wildcard';
import { normHandle } from '../../../shared/major';
import { isMajorTeam, pcts, rosterSource } from '../../../shared/audience';
import { MVP_SOURCE, MVP_VIEW_LABEL, mvpViewOfSel } from '../../../shared/mainScenes';
import { MVP_VIEWS, isRevealView, mvpStage, revealAllowed, type MvpView } from '../../../shared/mvpFlow';
import { mvpReadiness, worstTone, type MvpCheck } from '../../../shared/mvpReady';
import { playerIdOf } from '../../../shared/playerIds';
import type { WcOp } from '../../../shared/wildcard';
import { mvpSceneData } from './MvpScene';
import { REGISTRY } from '../../../shared/registry';
import { obsSceneOfSource } from './Library';
import type { AudCtx } from './audienceModules';
import { Btn, Chip, Seg, Tiny, PGM, PVW, WARN, type Ctx } from './modules';

const LABEL = "font-['Barlow_Condensed'] font-bold uppercase tracking-[0.1em]";
const COUNTDOWNS: [string, string][] = [['0', 'No timer'], ['60', '1 min'], ['120', '2 min'], ['180', '3 min'], ['300', '5 min']];
const TONE: Record<string, string> = { ok: PVW, warn: WARN, bad: '#ff5a5f', off: 'rgba(255,255,255,.35)' };
const wcOp = (op: WcOp) => fetch('/api/v1/msg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'wc', op }) }).then(r => (r.ok ? null : `Not saved (${r.status})`)).catch(() => 'Not saved (connection)');

/** Everything the readiness checklist needs, from the shared state. */
export function mvpChecks(x: Ctx, a: AudCtx): MvpCheck[] {
  const D = mvpSceneData(x, a), m = D.m, priv = a.priv;
  const photo = (h: string) => !!x.wc.showcase.photos[normHandle(h)];
  const scenes = MVP_VIEWS.map(v => { const src = REGISTRY.find(r => r.id === MVP_SOURCE[v]); const scene = src ? obsSceneOfSource(src, x.st) ?? `Overdrive · ${src.name}` : null; return { view: v, scene, exists: !!scene && x.st.obs.scenes.includes(scene) }; });
  return mvpReadiness({
    match: D.match, matchLabel: D.match ? matchName(D.match) : '', finished: D.finished, teams: [m?.t1 ?? null, m?.t2 ?? null],
    rosterSource: [rosterSource(m?.t1 ?? '', x.wc.rosters), rosterSource(m?.t2 ?? '', x.wc.rosters)], logos: [!!wcLogo(m?.t1), !!wcLogo(m?.t2)],
    players: D.roster.map(p => ({ handle: p.handle, photo: photo(p.handle) })),
    poll: D.poll ? { status: D.poll.status, players: D.poll.players.length, sim: D.poll.bySource?.sim ?? 0 } : null,
    mode: priv?.mode === 'online' ? 'online' : 'local', online: !!priv?.online, publicUrl: (a.aud?.qr ?? []).find(q => q.id === 'vote')?.url ?? '',
    chat: priv?.chat?.conn ?? 'off', rehearsal: !!priv?.rehearsal,
    onlineRosterOk: [m?.t1, m?.t2].every(t => !!t && isMajorTeam(t) && rosterSource(t, x.wc.rosters) === 'verified'),
    obs: { connected: x.st.obs.connected, scenes }, sources: (x.st.outputs ?? []).filter(o => o.route.replace(/^\//, '').startsWith('g/mvp')).reduce((n, o) => n + o.count, 0),
  });
}

export function MvpPanel({ x, a, sel, onSelect, obsTr }: { x: Ctx; a: AudCtx; sel: string; onSelect: (sel: string) => void; obsTr: 'obs' | 'stinger' | 'fade' | 'cut' }) {
  const view = mvpViewOfSel(sel) ?? 'voting';
  const D = mvpSceneData(x, a);
  const { g, match, poll, flow } = D;
  const R = wcResolve(x.wc.matches, x.wc.teams);
  const finished = WC_IDS.filter(id => R[id]?.winner && R[id].winner !== 'BYE' && R[id].loser !== 'BYE').sort((p, q) => (x.wc.done[p] ?? 0) - (x.wc.done[q] ?? 0));
  const archived = new Set(a.aud?.archived ?? []);
  const priv = a.priv, chat = priv?.chat;
  const polls = priv?.summary?.polls ?? [];
  const ran = (id: string) => polls.some(p => p.match === id && (p.status === 'closed' || p.status === 'revealed'));
  /** Finished matches whose MVP has not run yet (not the current one, not archived): what "next match" goes to. */
  const waiting = finished.filter(id => id !== match && !archived.has(id) && !ran(id));
  const local = priv?.mode !== 'online';
  const rehearsal = !!priv?.rehearsal;
  const [pick, setPick] = useState<string[]>([]);
  const [cd, setCd] = useState(String(g?.config.countdown ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [ov, setOv] = useState('');
  const [showChecks, setShowChecks] = useState(false);
  const pollKey = poll ? `${poll.id}:${poll.status}:${poll.players.map(p => p.handle).join('|')}` : '';
  useEffect(() => { setPick(poll?.players.length ? poll.players.map(p => p.handle) : D.roster.slice(0, 4).map(p => p.handle)); }, [match, pollKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setErr(null); setOv(''); }, [match]);
  useEffect(() => setCd(String(g?.config.countdown ?? 0)), [g?.config.countdown]);
  useEffect(() => setArmed(false), [view, match]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);

  const act = async (f: () => Promise<string | null | undefined>) => { if (busy) return; setBusy(true); setErr(null); try { const e = await f(); if (e) setErr(e); } finally { setBusy(false); } };
  const aud = (op: Parameters<AudCtx['op']>[0], label: string) => act(() => a.op(op, label));
  const cmd = (c: Parameters<Ctx['run']>[0], label: string) => act(async () => { const r = await x.run(c, label); return r.ok ? null : r.error ?? 'Failed'; });

  const stage = mvpStage(flow);
  const left = poll?.status === 'open' && poll.closesAt ? Math.max(0, Math.round((poll.closesAt - x.now) / 1000)) : null;
  const totalsOn = !!poll && !!priv?.liveTotals.includes(poll.id);
  const live = poll?.status === 'open' ? (poll.counts ?? {}) : poll?.frozen?.counts ?? {};
  const total = poll?.status === 'open' ? poll.total ?? 0 : poll?.frozen?.total ?? 0;
  const manual = poll?.frozen?.manual ?? null;
  const draft = !poll || poll.status === 'draft';
  const shown = draft ? D.roster : poll!.players;
  const share = pcts(shown.map(p => live[p.handle] ?? 0));
  const top = manual ?? (D.community?.handle ?? null);
  const photo = (h: string) => x.wc.showcase.photos[normHandle(h)] || '';
  const stats = (h: string) => a.aud?.mvpCards?.[match]?.[h]?.stats ?? [];
  const qrOn = g?.config.qr !== false;
  const nextMatch = waiting[waiting.length - 1] ?? '';
  const why = (v: MvpView) => (isRevealView(v) ? revealAllowed(v, flow) : !D.finished ? 'MVP voting opens after the match has a result' : null);
  const checks = mvpChecks(x, a), worst = worstTone(checks);
  const notice = priv?.mvpNotice;
  const missingTeams = [D.m?.t1, D.m?.t2].filter((t): t is string => !!t && t !== 'BYE' && rosterSource(t, x.wc.rosters) === 'none');
  /** A view in Preview: this console, and OBS's own Preview in OBS Studio Mode (Program untouched). */
  const preview = (v: MvpView) => {
    onSelect(MVP_SOURCE[v]);
    const src = REGISTRY.find(r => r.id === MVP_SOURCE[v]), o = src ? obsSceneOfSource(src, x.st) : undefined;
    if (o && x.st.obs.connected) void x.run({ c: 'obs-preview', scene: o, target: `s:${MVP_SOURCE[v]}` }, `OBS Preview: ${o}`);
  };
  const canVote = rehearsal || !local || (chat?.conn === 'listening');
  const take = () => act(async () => {
    const reveal = isRevealView(view), confirm = reveal && g?.config.confirmReveal !== false;
    if (confirm && !armed) { setArmed(true); return null; }
    setArmed(false);
    const r = await x.run({ c: 'scene-take', target: `s:${MVP_SOURCE[view]}`, transition: obsTr }, `${reveal ? 'REVEAL' : 'TAKE'} · MVP ${MVP_VIEW_LABEL[view]}`);
    return r.ok ? null : r.error ?? 'TAKE failed';
  });
  const switchTo = (m: string) => act(async () => { const r = await x.run({ c: 'mvp-match', match: m }, `MVP match: ${m}`); if (!r.ok) return r.error ?? 'Failed'; onSelect(MVP_SOURCE.voting); return null; });
  const upload = (handle: string, f: File | undefined) => act(async () => {
    if (!f) return null;
    const r = await fetch(`/api/upload?role=portrait&ref=${encodeURIComponent(playerIdOf(handle) ?? '')}`, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return `${handle}: ${j.error ?? `upload failed (${r.status})`}`;
    return wcOp({ k: 'photo', player: handle, url: j.url });
  });
  const demo = (action: 'load' | 'finish' | 'leave', label: string) => act(async () => { const r = await x.run({ c: 'mvp-demo', action }, label); if (!r.ok) return r.error ?? 'Failed'; onSelect(MVP_SOURCE.voting); return null; });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-mvp-panel={view} data-mvp-match-id={match} style={{ background: 'rgba(255,106,19,.03)' }}>
      {rehearsal && (
        <div className="flex flex-none flex-wrap items-center gap-2 px-3 py-1 text-[12px] text-black" style={{ background: WARN }} data-mvp-rehearsal-bar>
          <b className={`${LABEL} text-[14px]`}>Rehearsal · demo data</b>
          <span>Fictional teams. The real event's results, votes and MVPs are untouched. Real Twitch chat is ignored.</span>
          <span className="ml-auto flex gap-1">
            <button type="button" disabled={busy} onClick={() => demo('finish', 'Rehearsal: finish demo match')} className="rounded-[2px] bg-black/80 px-2 py-0.5 text-[12px] font-bold text-white" data-demo-finish>Finish demo match</button>
            <button type="button" disabled={busy} onClick={() => demo('load', 'Rehearsal: reload demo')} className="rounded-[2px] bg-black/50 px-2 py-0.5 text-[12px] font-bold text-white" data-demo-reload>Start over</button>
            <button type="button" disabled={busy} onClick={() => demo('leave', 'Rehearsal: leave')} className="rounded-[2px] bg-white px-2 py-0.5 text-[12px] font-bold text-black" data-demo-leave>Leave rehearsal</button>
          </span>
        </div>
      )}
      {notice && (
        <div className="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-1 text-[12px]" style={{ background: notice.kind === 'error' ? 'rgba(255,90,95,.15)' : notice.kind === 'queued' ? 'rgba(255,176,32,.12)' : 'rgba(42,180,110,.12)' }} data-mvp-notice={notice.kind}>
          <span style={{ color: notice.kind === 'error' ? '#ff8a8d' : notice.kind === 'queued' ? WARN : PVW }}>●</span>
          <span className="min-w-0 flex-1 truncate" title={notice.text}>{notice.text}</span>
          {notice.kind === 'queued' && notice.match !== match && <Btn disabled={busy || poll?.status === 'open'} onClick={() => switchTo(notice.match)} title={poll?.status === 'open' ? 'Stop voting first' : ''}>Switch MVP to {matchName(notice.match)}</Btn>}
          <Tiny title="Dismiss" onClick={() => a.op({ k: 'mvp-notice-clear' }, 'MVP notice read')}>✕</Tiny>
        </div>
      )}
      {/* header: match · status · counting · TAKE */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[12px]">
        <span className={`${LABEL} text-[16px] text-white`}>MVP</span>
        <select aria-label="MVP match" value={match} disabled={busy || poll?.status === 'open'} onChange={e => switchTo(e.target.value)}
          className="h-[24px] max-w-[300px] rounded-[2px] border border-white/15 bg-black px-1 text-[12.5px] outline-none" data-mvp-match title={poll?.status === 'open' ? 'Stop voting before changing the match' : 'The MVP match (follows the results automatically)'}>
          {!finished.includes(match) && <option value={match}>{match ? `${matchName(match)} (no result yet)` : '— no finished match yet —'}</option>}
          {[...finished].reverse().map(id => <option key={id} value={id}>{matchName(id)} · {R[id].t1} vs {R[id].t2}{archived.has(id) ? ' (archived)' : ran(id) ? ' (done)' : id !== match ? ' (MVP waiting)' : ''}</option>)}
        </select>
        <span className={`${LABEL} rounded-[2px] px-1.5 text-[11px]`} style={{ border: `1px solid ${stage === 'open' ? PGM : stage === 'none' ? 'rgba(255,255,255,.3)' : PVW}`, color: stage === 'open' ? PGM : stage === 'none' ? 'rgba(255,255,255,.55)' : PVW }} data-mvp-status={stage}>
          {stage === 'none' ? (D.finished ? 'Not prepared' : 'No result yet') : stage === 'prepared' ? 'Ready' : stage === 'open' ? 'Voting open' : stage === 'closed' ? 'Counting' : manual ? 'MVP chosen' : 'Result frozen'}</span>
        {(poll?.bySource?.sim ?? 0) > 0 && <span className={`${LABEL} rounded-[2px] px-1.5 text-[11px] text-black ${rehearsal ? '' : 'animate-pulse'}`} style={{ background: WARN }} data-mvp-rehearsal title={rehearsal ? 'Simulated votes (rehearsal)' : 'This vote contains simulated rehearsal votes: do not reveal it as a real result.'}>Rehearsal votes: {poll!.bySource!.sim}</span>}
        {left != null && <span className="font-mono tabular-nums text-white/80" data-mvp-left>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
        <span className="text-white/60" data-mvp-total>{total} vote{total === 1 ? '' : 's'}{poll?.bySource ? ` · chat ${poll.bySource.chat} · web ${poll.bySource.web}${poll.bySource.sim ? ` · rehearsal ${poll.bySource.sim}` : ''}` : ''}</span>
        <span className="flex items-center gap-1 text-[11px]" data-mvp-services>
          <span style={{ color: rehearsal ? WARN : local ? WARN : priv?.online ? PVW : PGM }} title={local ? 'Votes counted by this server: Twitch chat (and rehearsal). The public website needs the online vote service.' : priv?.online ? 'Online vote service: website + Twitch chat' : priv?.error ?? 'offline'}>
            ● {rehearsal ? 'Rehearsal (this server)' : local ? 'Local counting' : priv?.online ? 'Website online' : 'Website offline'}</span>
          {!rehearsal && <span style={{ color: chat?.conn === 'listening' ? PVW : 'rgba(255,255,255,.45)' }} title="Twitch chat voting">· Twitch {chat?.conn === 'listening' ? `● ${chat.channel?.login ?? ''}` : chat?.conn ?? 'off'}{poll?.status === 'open' ? (poll.chat ? '' : ' (not for this vote)') : ''}</span>}
        </span>
        <button type="button" onClick={() => setShowChecks(v => !v)} className="rounded-[2px] px-1.5 text-[11px]" style={{ border: `1px solid ${TONE[worst]}`, color: TONE[worst] }} data-mvp-ready-toggle={worst} title="MVP readiness checklist">
          {worst === 'ok' ? '✓ Ready' : worst === 'warn' ? '⚠ Check' : '✕ Not ready'}</button>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" disabled={busy || !!why(view) || !x.st.obs.connected} onClick={take} data-mvp-panel-take={armed ? 'armed' : 'ready'}
            title={why(view) ?? (x.st.obs.connected ? `Program: MVP ${MVP_VIEW_LABEL[view]}` : 'OBS not connected')}
            className={`${LABEL} h-[26px] rounded-[2px] px-3 text-[13px] text-white disabled:opacity-35 ${armed ? 'animate-pulse' : ''}`} style={{ background: armed ? '#ff6a13' : PGM }}>
            {armed ? `CONFIRM ${MVP_VIEW_LABEL[view]}` : isRevealView(view) ? `REVEAL · ${MVP_VIEW_LABEL[view]}` : view === 'closed' && poll?.status === 'open' ? 'Close voting + TAKE' : `TAKE · ${MVP_VIEW_LABEL[view]}`}</button>
        </span>
      </div>

      {/* views of the MVP scene: what the preview shows (and TAKE puts on air) */}
      <div className="flex flex-none items-stretch gap-0.5 border-b border-white/10 px-3 py-1" data-mvp-views>
        {MVP_VIEWS.map((v, i) => {
          const w = why(v), on = v === view;
          return (
            <button key={v} type="button" onClick={() => preview(v)} data-mvp-view={v} title={w ?? `Preview: ${MVP_VIEW_LABEL[v]}`}
              className={`${LABEL} flex h-[24px] flex-1 items-center justify-center gap-1 rounded-[2px] text-[11.5px] ${on ? 'text-white' : w ? 'text-white/30' : 'text-white/70 hover:text-white'}`}
              style={{ background: on ? 'rgba(42,109,244,.35)' : 'rgba(255,255,255,.04)' }}>
              <span className="font-mono text-[10px] text-white/35">{i + 1}</span>{MVP_VIEW_LABEL[v]}{w && <span className="text-[10px]">🔒</span>}
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 gap-0" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        {/* candidates: picture · name · team · stats · votes; missing data; readiness */}
        <div className="min-h-0 overflow-y-auto border-r border-white/10 p-2" data-mvp-candidates>
          {showChecks && (
            <div className="mb-1.5 space-y-0.5 rounded-[3px] border border-white/10 p-1.5 text-[11.5px]" data-mvp-checks>
              {checks.map(c => <div key={c.id} className="flex gap-1.5" data-mvp-check={c.id} data-tone={c.tone}><span style={{ color: TONE[c.tone] }}>●</span><b className="w-[110px] flex-none text-white/70">{c.label}</b><span className="min-w-0 text-white/60">{c.detail}</span></div>)}
            </div>
          )}
          {!match ? <div className="p-2 text-[12px] text-white/50" data-mvp-empty>No finished match yet. The MVP sets itself up when a match gets its result{rehearsal ? '' : ' — or load the demo match (Rehearsal) to try the whole workflow now'}.</div>
            : !D.finished ? <div className="p-2 text-[12px] text-white/50">{matchName(match)} has no result yet. MVP voting opens after the match.</div> : (
            <>
              {missingTeams.map(t => <RosterEditor key={t} team={t} onSave={players => act(() => wcOp({ k: 'roster', team: t, players }))} />)}
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {shown.map((p, i) => {
                  const on = pick.includes(p.handle), win = top === p.handle && (poll?.status === 'closed' || poll?.status === 'revealed');
                  const n = live[p.handle] ?? 0, pic = photo(p.handle);
                  return (
                    <div key={p.handle} data-mvp-candidate={p.handle} data-on={draft ? (on ? '1' : '0') : '1'} onClick={() => draft && setPick(s => (s.includes(p.handle) ? s.filter(h => h !== p.handle) : s.length < 4 ? [...s, p.handle] : s))}
                      className={`flex gap-2 rounded-[3px] border p-1.5 ${draft ? 'cursor-pointer' : ''}`} style={{ borderColor: win ? '#ffb020' : draft && on ? PVW : 'rgba(255,255,255,.1)', background: draft && !on ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.05)', opacity: draft && !on ? 0.55 : 1 }}>
                      <div className="relative h-[52px] w-[44px] flex-none overflow-hidden rounded-[2px] bg-white/[0.06]">
                        {pic ? <img src={pic} alt="" className="h-full w-full object-cover object-top" /> : <div className="grid h-full place-items-center text-[16px] font-bold text-white/30">{p.handle.slice(0, 1)}</div>}
                        {!pic && <label className="absolute inset-x-0 bottom-0 cursor-pointer bg-black/70 text-center text-[9px] font-bold" style={{ color: WARN }} onClick={e => e.stopPropagation()} title={`Add a picture of ${p.handle}`} data-mvp-photo-add={p.handle}>
                          + photo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => upload(p.handle, e.target.files?.[0])} /></label>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1"><b className="truncate text-[13px]">{p.handle}</b>{win && <span title={manual ? 'Chosen by the production' : 'Most votes'}>{manual ? '✋' : '👑'}</span>}</div>
                        <div className="flex items-center gap-1 truncate text-[11px] text-white/50">{wcLogo(p.team) && <img src={wcLogo(p.team)} alt="" className="h-[12px] w-[12px] object-contain" />}{p.team}{stats(p.handle).length ? ` · ${stats(p.handle).slice(0, 2).map(s => `${s.label} ${s.value}`).join(' · ')}` : ''}</div>
                        {!draft && <div className="mt-0.5"><div className="flex justify-between text-[11px] tabular-nums"><span className="text-white/70">{share[i]}%</span><span className="text-white/45">{n}</span></div>
                          <div className="h-[4px] overflow-hidden rounded bg-white/10"><i className="block h-full" style={{ width: `${share[i]}%`, background: win ? '#ffb020' : PVW }} /></div></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[10.5px] text-white/35">
                Players load from {D.m?.t1} and {D.m?.t2}{[D.m?.t1, D.m?.t2].some(t => rosterSource(t ?? '', x.wc.rosters) === 'event') ? ' (this event’s roster)' : ' (verified profiles)'}. Counts are private until the reveal.{draft ? ' Click a player to leave them out, then Update candidates.' : ''}
                {!missingTeams.length && [D.m?.t1, D.m?.t2].map(t => t && <EditRosterLink key={t} team={t} players={D.roster.filter(p => p.team === t).map(p => p.handle)} onSave={players => act(() => wcOp({ k: 'roster', team: t, players }))} />)}
              </div>
            </>
          )}
        </div>

        {/* controls */}
        <div className="min-h-0 space-y-1.5 overflow-y-auto p-2 text-[12px]" data-mvp-controls>
          {D.finished && draft && (
            <Row label="Voting">
              {!poll ? <Btn active disabled={busy || D.roster.length < 2} onClick={() => aud({ k: 'mvp-ready', match }, 'Prepare MVP vote')} data-mvp-prepare="">Prepare vote ({Math.min(4, D.roster.length)} players)</Btn>
                : <>
                  {pick.join('|') !== poll.players.map(p => p.handle).join('|') && <Btn disabled={busy || pick.length < 2} onClick={() => aud({ k: 'mvp-prepare', match, players: pick }, 'Update MVP candidates')}>Update candidates ({pick.length})</Btn>}
                  <Seg value={cd} options={COUNTDOWNS.some(c => c[0] === cd) ? COUNTDOWNS : [...COUNTDOWNS, [cd, `${cd} s`]]} onChange={setCd} />
                  <Btn active disabled={busy} onClick={() => aud({ k: 'mvp-open', poll: poll.id, ...(Number(cd) ? { seconds: Number(cd) } : {}) }, 'Open MVP voting')} data-mvp-start="">Start voting</Btn></>}
            </Row>
          )}
          {poll?.status === 'open' && (
            <Row label="Voting">
              <Btn danger disabled={busy} onClick={() => aud({ k: 'mvp-close', poll: poll.id }, 'Close MVP voting')} data-mvp-stop="">Stop voting</Btn>
              <Tiny title="Countdown +30 s" onClick={() => aud({ k: 'mvp-timer', poll: poll.id, seconds: (left ?? 0) + 30 }, 'MVP countdown +30 s')}>+30s</Tiny>
              {left != null && <Tiny title="Remove the countdown" onClick={() => aud({ k: 'mvp-timer', poll: poll.id, seconds: null }, 'MVP countdown off')}>No timer</Tiny>}
              <Chip on={totalsOn} onClick={() => aud({ k: 'mvp-totals', poll: poll.id, on: !totalsOn }, totalsOn ? 'MVP live totals off air' : 'MVP live totals on air')}>Live totals on air</Chip>
            </Row>
          )}
          <Row label="Graphic">
            <Chip on={qrOn} onClick={() => cmd({ c: 'mvp-qr', on: !qrOn }, qrOn ? 'MVP QR hidden' : 'MVP QR shown')}>{qrOn ? 'QR code shown' : 'QR code hidden'}</Chip>
            <span className="text-white/40">{rehearsal ? 'Rehearsal: no QR (nobody outside can vote)' : local ? 'Local counting: the graphic shows the Twitch chat command (no website QR)' : a.aud?.qr.some(q => q.id === 'vote') ? 'Voting page QR' : 'No voting address set'}</span>
          </Row>
          {!canVote && D.finished && <div className="rounded-[2px] border px-2 py-1 text-[11.5px]" style={{ borderColor: WARN, color: WARN }} data-mvp-cannot-vote>
            Viewers cannot vote yet: connect Twitch chat voting (Studio → Audience) or set up the online vote service (VOTE_URL / VOTE_SECRET). Rehearsal votes and Manual MVP work without either.</div>}
          {!rehearsal && <Row label="Counting">
            {priv?.remoteConfigured
              ? <Seg value={priv.voteMode ?? 'auto'} options={[['auto', 'Online service'], ['local', 'Local']]} onChange={v => aud({ k: 'vote-mode', mode: v as 'auto' | 'local' }, `MVP counting: ${v}`)} />
              : <span className="text-white/55" title="Set VOTE_URL + VOTE_SECRET to use the online vote service (public website, Twitch sign-in)">Local (this server) · online service not set up</span>}
          </Row>}
          {local && poll?.status === 'open' && (
            <Row label={rehearsal ? 'Audience' : 'Rehearsal'}>
              {[10, 50, 200].map(n => <Tiny key={n} title={`Add ${n} simulated votes (counted apart as rehearsal)`} onClick={() => aud({ k: 'mvp-sim', poll: poll.id, votes: n }, `Rehearsal: +${n} simulated votes`)}>+{n} votes</Tiny>)}
              <span className="text-[11px] text-white/40">simulated, counted apart</span>
            </Row>
          )}
          {D.finished && (
            <Row label="Manual MVP">
              <select aria-label="Manual MVP" value={ov || manual || ''} onChange={e => setOv(e.target.value)} className="h-[24px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 text-[12px] outline-none" data-mvp-override-pick>
                <option value="">— choose a player —</option>
                {D.roster.map(p => <option key={p.handle} value={p.handle}>{p.handle} · {p.team}</option>)}
              </select>
              <Btn disabled={busy || !(ov || manual) || (ov || manual) === manual} onClick={() => aud({ k: 'mvp-override', match, player: ov }, `MVP chosen by the production: ${ov}`)} title="The production chooses the MVP (voting failed, or override). An open vote is closed first. The reveal says 'chosen by the broadcast team'.">Set as MVP</Btn>
              {manual && <Tiny title="Back to the vote's result" onClick={() => { setOv(''); return aud({ k: 'mvp-override', match, player: null }, 'Manual MVP removed'); }}>Undo</Tiny>}
            </Row>
          )}
          {D.finished && (
            <Row label="Analysts">
              {[1, 2, 3, 4, 5].filter(s => x.st.live.casters.find(c => c.id === s)?.enabled).length === 0 ? <span className="text-white/40">Nobody in a position</span>
                : [1, 2, 3, 4, 5].filter(s => x.st.live.casters.find(c => c.id === s)?.enabled).map(s => {
                  const name = x.st.live.casters.find(c => c.id === s)?.name ?? `Pos ${s}`, cur = D.staff[String(s)]?.player ?? '';
                  return <label key={s} className="flex min-w-0 items-center gap-1"><b className="max-w-[80px] truncate text-[11.5px]">{name}</b>
                    <select aria-label={`${name} MVP`} value={cur} disabled={D.revealed.includes('desk')} onChange={e => aud({ k: 'staff-mvp', match, slot: s, player: e.target.value || null }, `${name} MVP ${e.target.value || 'cleared'}`)} className="h-[22px] max-w-[110px] rounded-[2px] border border-white/15 bg-black text-[11.5px] outline-none">
                      <option value="">—</option>{D.roster.map(p => <option key={p.handle} value={p.handle}>{p.handle}</option>)}</select></label>;
                })}
            </Row>
          )}
          <Row label="Reveal">
            <span className="text-white/55">Pace {String(g?.config.revealPace ?? 'cinematic')}{g?.config.confirmReveal !== false ? ' · reveals ask CONFIRM' : ''}</span>
            <Btn disabled={busy || !D.revealed.length} onClick={() => cmd({ c: 'gfx-anim', id: 'mvp', action: 'in' }, 'Replay MVP animation')} title={D.revealed.length ? 'Replay the animation on the sources' : 'After a reveal'}>Replay</Btn>
          </Row>
          <Row label="On result">
            <span data-mvp-auto="prepare"><Chip on={priv?.mvpAuto?.prepare !== false} onClick={() => aud({ k: 'mvp-auto', patch: { prepare: !(priv?.mvpAuto?.prepare !== false) } }, 'MVP automation: prepare')}>Prepare MVP</Chip></span>
            <span data-mvp-auto="open"><Chip on={!!priv?.mvpAuto?.open} onClick={() => aud({ k: 'mvp-auto', patch: { open: !priv?.mvpAuto?.open } }, 'MVP automation: open voting')}>Open voting</Chip></span>
            <span data-mvp-auto="preview"><Chip on={!!priv?.mvpAuto?.preview} onClick={() => aud({ k: 'mvp-auto', patch: { preview: !priv?.mvpAuto?.preview } }, 'MVP automation: OBS preview')}>MVP in OBS Preview</Chip></span>
            <span className="text-[10.5px] text-white/35">when a match gets its result · Program never changes by itself</span>
          </Row>
          {!rehearsal && (
            <Row label="Rehearsal">
              <Btn disabled={busy || poll?.status === 'open'} onClick={() => demo('load', 'Rehearsal: load demo match')} title="Switches to a separate demo event (fictional teams): the real event is not touched, OBS is not switched" data-demo-load="">Load demo match</Btn>
              <span className="text-[10.5px] text-white/35">try the whole MVP workflow with fictional teams</span>
            </Row>
          )}
          <Row label="Next match">
            <span data-mvp-reset=""><Btn disabled={busy || poll?.status === 'open' || !match} onClick={() => act(async () => {
              const e = await a.op({ k: 'mvp-archive', match, on: true }, `MVP of ${match} archived`); if (e) return e;
              if (!nextMatch) return null;
              const r = await x.run({ c: 'mvp-match', match: nextMatch }, `MVP scene: ${nextMatch}`); if (!r.ok) return r.error ?? 'Failed';
              onSelect(MVP_SOURCE.voting); return null;
            })} title={poll?.status === 'open' ? 'Stop voting first' : `Archive this match's MVP (results kept)${nextMatch ? ` and go to ${matchName(nextMatch)}` : ''}`}>Done · next match</Btn></span>
            <span className="truncate text-white/40" data-mvp-next={nextMatch}>{nextMatch ? `→ ${matchName(nextMatch)} (MVP waiting)` : '→ the next result sets it up'}</span>
          </Row>
          {err && <div className="text-[11.5px]" style={{ color: '#ff8a8d' }} data-mvp-error>{err}</div>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5"><span className={`${LABEL} w-[78px] flex-none text-[11px] text-white/40`}>{label}</span>{children}</div>;
}

/** A team with no known players: enter them here (saved to this event; the MVP vote picks them up at once). */
function RosterEditor({ team, onSave }: { team: string; onSave: (players: string[]) => void }) {
  const [v, setV] = useState('');
  const list = v.split(',').map(s => s.trim()).filter(Boolean);
  return (
    <div className="mb-1.5 rounded-[3px] border px-2 py-1.5 text-[11.5px]" style={{ borderColor: '#ff5a5f' }} data-mvp-roster-missing={team}>
      <div style={{ color: '#ff8a8d' }}>No players known for <b>{team}</b>. Enter them (comma separated):</div>
      <div className="mt-1 flex gap-1">
        <input value={v} onChange={e => setV(e.target.value)} placeholder="Player1, Player2" className="h-[24px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 outline-none" data-mvp-roster-input={team} />
        <Btn disabled={list.length < 1} onClick={() => onSave(list)}>Save players</Btn>
      </div>
    </div>
  );
}
function EditRosterLink({ team, players, onSave }: { team: string; players: string[]; onSave: (players: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(players.join(', '));
  useEffect(() => setV(players.join(', ')), [players.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return <button type="button" className="ml-1 underline decoration-dotted hover:text-white/70" onClick={() => setOpen(true)} data-mvp-roster-edit={team}>Edit {team} players</button>;
  return (
    <span className="mt-1 flex gap-1">
      <input value={v} onChange={e => setV(e.target.value)} className="h-[22px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 text-[11px] outline-none" />
      <Btn onClick={() => { onSave(v.split(',').map(s => s.trim()).filter(Boolean)); setOpen(false); }}>Save</Btn>
      <Tiny title="Back to the verified profiles" onClick={() => { onSave([]); setOpen(false); }}>Reset</Tiny>
      <Tiny title="Cancel" onClick={() => setOpen(false)}>✕</Tiny>
    </span>
  );
}

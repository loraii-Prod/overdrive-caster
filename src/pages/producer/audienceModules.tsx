/**
 * Producer modules for the audience graphics: Pick'ems, Community MVP, QR. Every button either changes voting (vote
 * service) or PREPARES a graphic step; the step goes to the source only with Publish, and OBS is never switched.
 * Live counts shown here are private: graphics never get them.
 */
import { useState } from 'react';
import type { AudOp, QrLink } from '../../../shared/audience';
import { pcts, teamRoster } from '../../../shared/audience';
import { matchName, WC_IDS, wcResolve } from '../../../shared/wildcard';
import type { AudPrivate } from '../../../shared/protocol';
import type { AudLive } from '../../lib/hooks';
import { Qr } from '../../components/Qr';
import { Btn, Chip, Seg, Tag, Tiny, PGM, PVW, WARN, type Ctx } from './modules';

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

export function MvpModule({ x, a }: { x: Ctx; a: AudCtx }) {
  const done = matchesWithTeams(x).filter(r => r.winner && r.winner !== 'BYE');
  const [sel, setSel] = useState('');
  const id = sel || (x.wc.cast && done.some(d => d.id === x.wc.cast) ? x.wc.cast : done[done.length - 1]?.id) || '';
  const m = done.find(r => r.id === id);
  const roster = m ? [...teamRoster(m.t1!), ...teamRoster(m.t2!)] : [];
  const [off, setOff] = useState<string[]>([]);
  const poll = a.priv?.summary?.polls.filter(p => p.match === id).pop();
  const staff = a.aud?.staffMvp[id] ?? {};
  const seats = [1, 2, 3, 4, 5].filter(s => x.st.live.casters.find(c => c.id === s)?.enabled);
  const frozen = !!poll?.frozen;
  return (
    <>
      <Health a={a} />
      <div className="flex items-center gap-2"><Tag>Finished match</Tag>
        <select value={id} onChange={e => { setSel(e.target.value); setOff([]); }} className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 py-0.5 text-[12px]">
          {done.map(r => <option key={r.id} value={r.id}>{matchName(r.id)}: {r.t1} vs {r.t2}</option>)}
        </select></div>
      {!m ? <div className="text-[12px] text-white/50">MVP voting opens after a match has a result.</div> : <>
        <Tag>Eligible players</Tag>
        <div className="flex flex-wrap gap-1">{roster.map(p => <Chip key={p.handle} on={!off.includes(p.handle)} disabled={!!poll && poll.status !== 'draft'} onClick={() => setOff(o => (o.includes(p.handle) ? o.filter(h => h !== p.handle) : [...o, p.handle]))}>{p.handle}</Chip>)}</div>
        <Tag live>Voting</Tag>
        <div className="flex flex-wrap items-center gap-1 text-[12px]">
          <span className="mr-1">{poll ? poll.status.toUpperCase() : 'NOT PREPARED'}</span>
          {(!poll || poll.status === 'draft') && <Btn onClick={() => a.op({ k: 'mvp-prepare', match: id, players: roster.filter(p => !off.includes(p.handle)).map(p => p.handle) }, 'Prepare MVP vote')}>Prepare</Btn>}
          {poll?.status === 'draft' && <Btn active onClick={() => a.op({ k: 'mvp-open', poll: poll.id }, 'Open MVP voting')}>Open voting</Btn>}
          {poll?.status === 'open' && <Btn danger onClick={() => a.op({ k: 'mvp-close', poll: poll.id }, 'Close MVP voting')}>Close voting</Btn>}
        </div>
        {poll && poll.status !== 'draft' && <><div className="text-[11px] text-white/50">{poll.status === 'open' ? `Live count (private): ${poll.total ?? 0} votes` : `Frozen at close: ${poll.frozen?.total ?? 0} votes · ${poll.status === 'revealed' ? 'revealed' : 'not revealed yet'}`}</div>
          <Bars rows={poll.players.map(p => [p.handle, (poll.status === 'open' ? poll.counts?.[p.handle] : poll.frozen?.counts[p.handle]) ?? 0] as [string, number]).sort((p, q) => q[1] - p[1])} /></>}
        <Tag live>Desk MVP</Tag>
        {seats.map(s => { const name = x.st.live.casters.find(c => c.id === s)?.name ?? `Pos ${s}`, cur = staff[String(s)]?.player; return (
          <div key={s} className="flex flex-wrap items-center gap-1 text-[11.5px]"><span className="w-[80px] truncate font-bold">{name}</span>
            {roster.map(p => <Chip key={p.handle} on={cur === p.handle} onClick={() => a.op({ k: 'staff-mvp', match: id, slot: s, player: cur === p.handle ? null : p.handle }, `${name} MVP ${p.handle}`)}>{p.handle}</Chip>)}</div>); })}
        <Tag>Graphic (prepare, then Publish)</Tag>
        <Steps x={x} gfx="mvp" match={id} value="" disabled={!a.priv?.online && !frozen ? 'Voting offline: the winner can only be shown from a frozen result.' : undefined}
          steps={[['voting', 'Voting open'], ['winner', 'Winner reveal', !frozen], ['compare', 'Community vs desk', !frozen || !Object.keys(staff).length]]} />
        {!frozen && <div className="text-[11px] text-white/45">The winner steps unlock once voting is closed. Closing never shows anything on air.</div>}
      </>}
    </>
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

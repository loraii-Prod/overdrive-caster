import { useMemo, useState } from 'react';
import type { ControllerState, ScreenId, Show, SocialPlatform, Team } from '../../../shared/types';
import { SCREEN_IDS } from '../../../shared/types';
import { SCREEN_LABELS, SOCIAL_LABELS } from '../../../shared/defaults';
import type { QuickOp } from '../../../shared/protocol';
import { isTeam, resolve, type Tournament } from '../../../shared/tournament';
import { formatRemaining, TeamLogo } from '../../components/show/parts';
import { UploadButton } from '../admin/Admin';
import { ConfirmButton, CopyField, Label, Segmented, Switch, TextField } from './ui';

type Tab = 'match' | 'timer' | 'screens' | 'ticker' | 'sponsors' | 'tournament' | 'integrations';

export interface ShowProps {
  show: Show;
  live: Show;
  st: ControllerState;
  tournament: Tournament | null;
  now: number;
  set: (p: Partial<Show>) => void;
  quick: (op: QuickOp) => void;
  send: (m: any) => void;
}

export function ShowPanels(p: ShowProps) {
  const [tab, setTab] = useState<Tab>('match');
  const tabs: { value: Tab; label: string }[] = [
    { value: 'match', label: 'Match' }, { value: 'timer', label: 'Timer' }, { value: 'screens', label: 'Screens' },
    { value: 'ticker', label: 'Ticker & socials' }, { value: 'sponsors', label: 'Sponsors' }, { value: 'tournament', label: 'Tournament' }, { value: 'integrations', label: 'Integrations' },
  ];
  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#171717]">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">Show graphics</h2>
        <Segmented size="sm" value={tab} onChange={setTab} options={tabs} />
      </header>
      <div className="p-4">
        {tab === 'match' && <MatchTab {...p} />}
        {tab === 'timer' && <TimerTab {...p} />}
        {tab === 'screens' && <ScreensTab {...p} />}
        {tab === 'ticker' && <TickerTab {...p} />}
        {tab === 'sponsors' && <SponsorsTab {...p} />}
        {tab === 'tournament' && <TournamentTab {...p} />}
        {tab === 'integrations' && <IntegrationsTab {...p} />}
      </div>
      <p className="border-t border-white/[0.06] px-4 py-2 text-[11px] text-white/35">Text and toggles go to preview (TAKE to air). Scores, game number and timer controls are instant.</p>
    </section>
  );
}

function TeamEditor({ team, side, onChange, liveScore, quick, locked }: { team: Team; side: 'A' | 'B'; onChange: (t: Team) => void; liveScore: number; quick: ShowProps['quick']; locked: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.07] bg-black/20 p-3">
      <div className="mb-2.5 flex items-center gap-3">
        <TeamLogo team={team} size={40} />
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/45">Team {side}</div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn-sm w-8" onClick={() => quick({ k: 'score', team: side, delta: -1 })}>−</button>
          <span className="w-10 text-center font-display text-[24px] font-bold">{liveScore}</span>
          <button type="button" className="btn-sm w-8" onClick={() => quick({ k: 'score', team: side, delta: 1 })}>+</button>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <div><Label>Name</Label><TextField value={team.name} onChange={v => onChange({ ...team, name: v })} /></div>
        <div><Label>Tag</Label><TextField value={team.tag} onChange={v => onChange({ ...team, tag: v.toUpperCase().slice(0, 6) })} /></div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1"><Label>Logo URL</Label><TextField mono value={team.logo} onChange={v => onChange({ ...team, logo: v })} placeholder="/uploads/… or https://…" /></div>
        <UploadButton onUrl={url => onChange({ ...team, logo: url })} />
      </div>
      {locked && <p className="mt-2 text-[11px] text-white/40">Linked to the featured bracket match.</p>}
    </div>
  );
}

export function MatchTab({ show, live, set, quick, tournament }: ShowProps) {
  const locked = !!tournament?.featured;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2.5">
        <div><Label>Tournament</Label><TextField value={show.tournament} onChange={v => set({ tournament: v })} /></div>
        <div><Label>Stage</Label><TextField value={show.stage} onChange={v => set({ stage: v.toUpperCase() })} /></div>
        <div><Label>Map / mode</Label><TextField value={show.mapName} onChange={v => set({ mapName: v })} placeholder="Optional" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Best of</Label>
            <select className="input w-full" value={show.bestOf} onChange={e => set({ bestOf: +e.target.value })}>{[1, 3, 5, 7].map(n => <option key={n}>{n}</option>)}</select>
          </div>
          <div><Label>Game</Label>
            <select className="input w-full" value={live.game} onChange={e => quick({ k: 'game', value: +e.target.value })}>{Array.from({ length: show.bestOf }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TeamEditor team={show.teamA} side="A" liveScore={live.teamA.score} quick={quick} locked={locked} onChange={teamA => set({ teamA })} />
        <TeamEditor team={show.teamB} side="B" liveScore={live.teamB.score} quick={quick} locked={locked} onChange={teamB => set({ teamB })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <Switch on={show.showScoreboard} onChange={v => set({ showScoreboard: v })} label="In-game scoreboard" />
        <Switch on={show.showMatchupOnCasters} onChange={v => set({ showMatchupOnCasters: v })} label="Matchup bar on casters" />
        <Switch on={show.showMatchupOnScreens} onChange={v => set({ showMatchupOnScreens: v })} label="Matchup on screens" />
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-sm" onClick={() => quick({ k: 'swap' })} title="Swap sides (unlinks a featured match)">Swap sides</button>
          <ConfirmButton onConfirm={() => quick({ k: 'reset-scores' })} confirmLabel="Reset scores?">Reset scores</ConfirmButton>
        </div>
      </div>
    </div>
  );
}

export function TimerTab({ show, live, set, quick, now }: ShowProps) {
  const [until, setUntil] = useState('');
  const left = live.timer.target != null ? live.timer.target - now : null;
  const startUntil = () => {
    const m = /^(\d{1,2})[:h.]?(\d{2})$/.exec(until.trim());
    if (!m) return;
    const d = new Date(now);
    d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() < now) d.setDate(d.getDate() + 1);
    quick({ k: 'timer-until', target: d.getTime() });
  };
  return (
    <div className="grid grid-cols-[260px_1fr] gap-6">
      <div className="rounded-md border border-white/[0.07] bg-black/25 p-4 text-center">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/45">On air</div>
        <div className="mt-2 font-display text-[44px] font-semibold tabular-nums">{left == null ? '--:--' : left > 0 ? formatRemaining(left) : '00:00'}</div>
        <div className="text-[11px] text-white/40">{left == null ? 'No countdown' : left > 0 ? 'Running' : `Showing "${live.timer.endText}"`}</div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[11px] text-white/45">Start</span>
          {[1, 3, 5, 10, 15, 30].map(n => <button key={n} type="button" className="btn-sm" onClick={() => quick({ k: 'timer-start', minutes: n })}>{n} min</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[11px] text-white/45">Adjust</span>
          {[-1, 1, 5].map(n => <button key={n} type="button" className="btn-sm" disabled={live.timer.target == null} onClick={() => quick({ k: 'timer-add', minutes: n })}>{n > 0 ? '+' : ''}{n} min</button>)}
          <button type="button" className="btn-sm" disabled={live.timer.target == null} onClick={() => quick({ k: 'timer-stop' })}>Stop / hide</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-[11px] text-white/45">Until</span>
          <input className="input w-24" placeholder="18:30" value={until} onChange={e => setUntil(e.target.value)} onKeyDown={e => e.key === 'Enter' && startUntil()} />
          <button type="button" className="btn-sm" onClick={startUntil}>Count down to time</button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div><Label>Label</Label><TextField value={show.timer.label} onChange={v => set({ timer: { ...show.timer, label: v.toUpperCase() } })} /></div>
          <div><Label>When it hits zero</Label><TextField value={show.timer.endText} onChange={v => set({ timer: { ...show.timer, endText: v.toUpperCase() } })} /></div>
        </div>
        <div className="flex gap-5">
          {(['starting', 'brb', 'ending'] as const).map(k => (
            <Switch key={k} on={show.timer.showOn[k]} onChange={v => set({ timer: { ...show.timer, showOn: { ...show.timer.showOn, [k]: v } } })} label={`On ${SCREEN_LABELS[k]}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ScreensTab({ show, set }: ShowProps) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-6">
      <div className="space-y-3">
        {(['starting', 'brb', 'ending'] as const).map(k => (
          <div key={k} className="grid grid-cols-[1fr_1.4fr] gap-2">
            <div><Label>{SCREEN_LABELS[k]} · title</Label><TextField value={show.screens[k].title} onChange={v => set({ screens: { ...show.screens, [k]: { ...show.screens[k], title: v } } })} /></div>
            <div><Label>Subtitle</Label><TextField value={show.screens[k].subtitle} onChange={v => set({ screens: { ...show.screens, [k]: { ...show.screens[k], subtitle: v } } })} /></div>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Schedule (Starting soon)</Label>
          <Switch on={show.scheduleFromBracket} onChange={v => set({ scheduleFromBracket: v })} label="Use bracket matches" />
        </div>
        <ListEditor
          items={show.schedule}
          max={6}
          blank={{ time: '', label: '' }}
          onChange={schedule => set({ schedule })}
          row={(it, upd) => (
            <>
              <input className="input w-20" placeholder="18:00" value={it.time} onChange={e => upd({ ...it, time: e.target.value })} />
              <input className="input min-w-0 flex-1" placeholder="Label" value={it.label} onChange={e => upd({ ...it, label: e.target.value })} />
            </>
          )}
        />
        {show.scheduleFromBracket && <p className="mt-2 text-[11px] text-white/40">Bracket matches are shown when available; this list is the fallback.</p>}
      </div>
    </div>
  );
}

export function TickerTab({ show, set }: ShowProps) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-5">
          <Switch on={show.ticker.enabled} onChange={v => set({ ticker: { ...show.ticker, enabled: v } })} label="Ticker" />
          <Switch on={show.ticker.onScreens} onChange={v => set({ ticker: { ...show.ticker, onScreens: v } })} label="On full screens" />
          <label className="flex items-center gap-2 text-[12px] text-white/55">Speed
            <input type="range" min={30} max={240} value={show.ticker.speed} onChange={e => set({ ticker: { ...show.ticker, speed: +e.target.value } })} className="accent-white" />
          </label>
        </div>
        <ListEditor items={show.ticker.items} max={12} blank="" onChange={items => set({ ticker: { ...show.ticker, items } })}
          row={(it, upd) => <input className="input min-w-0 flex-1" value={it} onChange={e => upd(e.target.value)} placeholder="Message" />} />
      </div>
      <div>
        <Label>Socials</Label>
        <ListEditor items={show.socials} max={6} blank={{ platform: 'x' as SocialPlatform, handle: '' }} onChange={socials => set({ socials })}
          row={(it, upd) => (
            <>
              <select className="input w-32" value={it.platform} onChange={e => upd({ ...it, platform: e.target.value as SocialPlatform })}>
                {(Object.keys(SOCIAL_LABELS) as SocialPlatform[]).map(k => <option key={k} value={k}>{SOCIAL_LABELS[k]}</option>)}
              </select>
              <input className="input min-w-0 flex-1" value={it.handle} onChange={e => upd({ ...it, handle: e.target.value })} placeholder="@handle" />
            </>
          )} />
      </div>
    </div>
  );
}

export function SponsorsTab({ show, set }: ShowProps) {
  const [url, setUrl] = useState('');
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <UploadButton label="Upload logo" onUrl={u => set({ sponsors: [...show.sponsors, u] })} />
        <input className="input min-w-0 flex-1" placeholder="…or paste an image URL" value={url} onChange={e => setUrl(e.target.value)} />
        <button type="button" className="btn-sm" disabled={!url.trim()} onClick={() => { set({ sponsors: [...show.sponsors, url.trim()] }); setUrl(''); }}>Add</button>
        <label className="flex items-center gap-2 text-[12px] text-white/55">Rotate every
          <input type="number" min={3} max={60} className="input w-16" value={show.sponsorSeconds} onChange={e => set({ sponsorSeconds: +e.target.value || 8 })} />s
        </label>
      </div>
      {show.sponsors.length === 0 && <p className="text-[12px] text-white/40">No sponsors yet. White or transparent PNG/SVG logos work best on the dark background.</p>}
      <div className="flex flex-wrap gap-3">
        {show.sponsors.map((s, i) => (
          <div key={s + i} className="group relative grid h-20 w-48 place-items-center rounded-md border border-white/10 bg-[#141414] p-3">
            <img src={s} alt="" className="max-h-full max-w-full object-contain" />
            <button type="button" className="btn-xs absolute right-1 top-1 opacity-0 group-hover:opacity-100" onClick={() => set({ sponsors: show.sponsors.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TournamentTab({ tournament, send }: ShowProps) {
  const res = useMemo(() => (tournament ? resolve(tournament) : null), [tournament]);
  if (!tournament || !res) return null;
  const ready = tournament.matches.filter(m => { const r = res.get(m.id)!; return isTeam(r.a) && isTeam(r.b) && !r.skipped; });
  const name = (s: any) => (isTeam(s) ? s.name : 'TBD');
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-[360px] flex-1">
        <Label>Featured match (drives scoreboard, team names, BO and stage)</Label>
        <select className="input w-full" value={tournament.featured ?? ''} onChange={e => send({ t: 't-op', op: { k: 'feature', id: e.target.value || null } })}>
          <option value="">— Not linked (manual teams) —</option>
          {ready.map(m => {
            const r = res.get(m.id)!;
            return <option key={m.id} value={m.id}>{m.label}: {name(r.a)} vs {name(r.b)}{m.status === 'live' ? ' · LIVE' : m.status === 'done' ? ' · final' : m.time ? ` · ${m.time}` : ''}</option>;
          })}
        </select>
      </div>
      <a href="/admin" target="_blank" rel="noreferrer" className="btn-sm inline-flex items-center">Open tournament admin ↗</a>
      <p className="w-full text-[11px] leading-relaxed text-white/40">
        Tournament admins sign in at /admin with the admin password (ADMIN_PASSWORD) and can only edit teams, bracket and results.
        Score buttons here update the featured bracket match too.
      </p>
    </div>
  );
}

export function IntegrationsTab({ show, set, st, send }: ShowProps) {
  const origin = location.origin;
  const tok = st.apiToken;
  const ex = (path: string) => `${origin}/api/v1${path}?token=${tok}`;
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><CopyField label="Control API token (Stream Deck / Companion)" value={tok} /></div>
          <ConfirmButton onConfirm={() => send({ t: 'regen-api-token' })} confirmLabel="Revoke token?">Regenerate</ConfirmButton>
        </div>
        <div className="space-y-2">
          <CopyField label="TAKE LIVE" value={ex('/take')} />
          <CopyField label="Go to BRB screen (on air)" value={ex('/screen/brb')} />
          <CopyField label="Score team A +1" value={ex('/score/a/inc')} />
          <CopyField label="Start 5-minute countdown" value={ex('/timer/start/5')} />
          <CopyField label="Toggle caster 2 camera (preview, add &take=1 to air)" value={ex('/caster/2/camera/toggle')} />
        </div>
        <p className="text-[11px] leading-relaxed text-white/40">All endpoints accept GET or POST. In Companion, use the Generic HTTP module with these URLs. GET /api/v1/state returns JSON for button feedback. The full list is in the README.</p>
      </div>
      <div>
        <Label>Switch OBS scene when a screen goes live (optional)</Label>
        <div className="space-y-2">
          {SCREEN_IDS.map((k: ScreenId) => (
            <div key={k} className="grid grid-cols-[150px_1fr] items-center gap-2">
              <span className="text-[12px] text-white/60">{SCREEN_LABELS[k]}</span>
              <TextField value={show.obsScenes[k]} onChange={v => set({ obsScenes: { ...show.obsScenes, [k]: v } })} placeholder="OBS scene name" list="glacial-obs-scenes-all" />
            </div>
          ))}
          <datalist id="glacial-obs-scenes-all">{st.obs.scenes.map(s => <option key={s} value={s} />)}</datalist>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">Needs OBS WebSocket (OBS_WS_URL on the server). Leave empty to keep everything in /output/program.</p>
      </div>
    </div>
  );
}

function ListEditor<T>({ items, onChange, row, blank, max }: { items: T[]; onChange: (v: T[]) => void; row: (it: T, upd: (v: T) => void) => React.ReactNode; blank: T; max: number }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {row(it, v => onChange(items.map((x, j) => (j === i ? v : x))))}
          <button type="button" className="btn-xs" disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>▲</button>
          <button type="button" className="btn-xs" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn-sm" disabled={items.length >= max} onClick={() => onChange([...items, structuredClone(blank)])}>+ Add</button>
    </div>
  );
}

export function PrizeTab({ show, set }: ShowProps) {
  const p = show.prize;
  const upd = (x: Partial<Show['prize']>) => set({ prize: { ...p, ...x } });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <Switch on={p.enabled} onChange={v => upd({ enabled: v })} label="Show on Starting soon" />
        <label className="text-[12px] text-white/55">Raised
          <input type="number" min={0} className="input ml-2 w-24" value={p.raised} onChange={e => upd({ raised: Math.max(0, +e.target.value || 0) })} />
        </label>
        <label className="text-[12px] text-white/55">Currency
          <input className="input ml-2 w-14" value={p.currency} onChange={e => upd({ currency: e.target.value.slice(0, 3) })} />
        </label>
        <div className="min-w-[220px] flex-1"><Label>Contribution link</Label><TextField value={p.link} onChange={v => upd({ link: v })} /></div>
      </div>
      <div>
        <Label>Goals</Label>
        <div className="space-y-1.5">
          {p.goals.map((g, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="number" className="input w-24" value={g.amount} onChange={e => upd({ goals: p.goals.map((x, k) => (k === i ? { ...x, amount: +e.target.value || 0 } : x)) })} />
              <input className="input min-w-0 flex-1" value={g.label} onChange={e => upd({ goals: p.goals.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              <button type="button" className="btn-xs" onClick={() => upd({ goals: p.goals.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn-xs" onClick={() => upd({ goals: [...p.goals, { amount: (p.goals.at(-1)?.amount ?? 0) + 250, label: 'New goal' }] })}>+ Goal</button>
        </div>
      </div>
      <div className="text-[11px] text-white/40">Split: {p.splits.map(s => `${s.place} ${s.pct}%`).join(' · ')} (from the rulebook)</div>
    </div>
  );
}

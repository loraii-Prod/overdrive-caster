import type { AssetRole } from '../../../shared/assetAdvice';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Logo } from '../../components/Brand';
import { ScaledCanvas } from '../../components/Stage';
import { BracketView, MatchesBoard } from '../../components/show/Bracket';
import { TeamLogo } from '../../components/show/parts';
import { useConnState, useLive, useSocket, useTournament } from '../../lib/hooks';
import { ThemeProvider } from '../../lib/theme';
import { isTeam, MAX_TEAMS, nextSize, resolve, type BMatch, type Format, type Resolved, type TournamentOp, type TTeam } from '../../../shared/tournament';
import { ConfirmButton, Dot, Label, Panel, Segmented, Switch, TextField } from '../controller/ui';

/** Upload an image. `role` gets 4K size advice back (shown to the producer; the upload is kept either way). */
export async function uploadImage(file: File, role?: AssetRole): Promise<string> {
  const r = await fetch(`/api/upload${role ? `?role=${role}` : ''}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Upload failed');
  if (j.advice) window.alert(`Uploaded.\n\n${j.advice}`);
  return j.url;
}

export function UploadButton({ onUrl, label = 'Upload', accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', role }: { onUrl: (url: string, type: string) => void; label?: string; accept?: string; role?: AssetRole }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try { onUrl(await uploadImage(f, role), f.type); } catch (err: any) { alert(err.message); } finally { setBusy(false); }
        }} />
      <button type="button" className="btn-xs" disabled={busy} onClick={() => ref.current?.click()}>{busy ? '…' : label}</button>
    </>
  );
}

/** /admin — tournament admins (or producers) run teams, bracket and results. Changes publish instantly. */
export function Admin({ role, onLogout }: { role: 'producer' | 'admin'; onLogout: () => void }) {
  const sock = useSocket({ role: 'admin' });
  const conn = useConnState(sock);
  const t = useTournament(sock);
  const live = useLive(sock);
  const [view, setView] = useState<'bracket' | 'matches'>('bracket');
  const op = (o: TournamentOp) => sock.send({ t: 't-op', op: o });
  useEffect(() => sock.on(m => { if (m.t === 'error' && m.code === 'auth') onLogout(); }), [sock, onLogout]);

  if (!t) return <div className="grid min-h-screen place-items-center bg-[#111] text-sm text-white/50">Connecting…</div>;

  return (
    <ThemeProvider theme={live?.show.theme ?? 'bnl'} brand={live?.show.brand ?? null}>
    <div className="min-h-screen bg-[#101010] text-white" data-theme-ui={live?.show.theme ?? 'bnl'}>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-5 border-b border-white/[0.07] bg-[#101010]/95 px-6 backdrop-blur">
        <Logo height={36} />
        <div className="h-7 w-px bg-white/10" />
        <div className="font-display text-[13px] font-semibold tracking-[0.24em] text-white/80">TOURNAMENT ADMIN</div>
        <span className="ml-3 flex items-center gap-1.5 text-[12px] text-white/60"><Dot tone={conn === 'open' ? 'ok' : 'bad'} />{conn === 'open' ? 'Live' : 'Reconnecting'}</span>
        <span className="text-[12px] text-white/35">Every change is published to the bracket overlays immediately.</span>
        <div className="ml-auto flex items-center gap-4">
          {role === 'producer' && <a href="/controller" className="text-[12px] text-white/60 hover:text-white">← Caster control</a>}
          <button type="button" className="text-[12px] text-white/40 hover:text-white/80" onClick={async () => { await fetch('/api/logout', { method: 'POST' }); onLogout(); }}>Sign out</button>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-5 p-5">
        <main className="min-w-0 space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Segmented value={view} onChange={setView} options={[{ value: 'bracket', label: 'Bracket overlay' }, { value: 'matches', label: 'Matches overlay' }]} size="sm" />
              <span className="text-[11px] text-white/40">/output/bracket · /output/matches</span>
            </div>
            <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-[#0b0b0b]">
              <ScaledCanvas>
                <ThemeProvider theme={live?.show.theme ?? 'bnl'} brand={live?.show.brand ?? null}>
                  <div className="od-stage relative h-[1080px] w-[1920px] overflow-hidden" data-theme={live?.show.theme ?? 'bnl'}>
                    {view === 'bracket' ? <BracketView t={t} /> : live && <MatchesBoard t={t} show={live.show} />}
                  </div>
                </ThemeProvider>
              </ScaledCanvas>
            </div>
          </div>
          <MatchList t={t} op={op} />
        </main>

        <aside className="space-y-5">
          <Panel title="Tournament">
            <Label>Name</Label>
            <TextField value={t.name} onChange={v => op({ k: 'meta', name: v })} />
          </Panel>
          <Teams teams={t.teams} op={op} size={t.size} />
          <Setup t={t} op={op} />
        </aside>
      </div>
    </div>
    </ThemeProvider>
  );
}

function Teams({ teams, op, size }: { teams: TTeam[]; op: (o: TournamentOp) => void; size: number }) {
  const [draft, setDraft] = useState<TTeam[]>(teams);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(teams); }, [teams, dirty]);
  const set = (next: TTeam[]) => { setDraft(next); setDirty(true); };
  const upd = (i: number, p: Partial<TTeam>) => set(draft.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    const n = [...draft]; [n[i], n[j]] = [n[j], n[i]]; set(n);
  };
  return (
    <Panel title={`Teams · ${draft.length}/${MAX_TEAMS}`} right={<span className="text-[11px] text-white/40">order = seed</span>}>
      <div className="space-y-1.5">
        {draft.map((tm, i) => (
          <div key={tm.id} className="flex items-center gap-1.5">
            <span className="w-5 text-right text-[11px] text-white/40">{i + 1}</span>
            <TeamLogo team={tm} size={30} />
            <input className="input h-8 min-w-0 flex-1 text-[12.5px]" value={tm.name} onChange={e => upd(i, { name: e.target.value })} />
            <input className="input h-8 w-[62px] text-[12px] uppercase" value={tm.tag} maxLength={6} placeholder="TAG" onChange={e => upd(i, { tag: e.target.value.toUpperCase() })} />
            <UploadButton label="Logo" role="team-logo" onUrl={url => upd(i, { logo: url })} />
            <div className="flex flex-col">
              <button type="button" className="h-4 text-[9px] text-white/50 hover:text-white" onClick={() => move(i, -1)}>▲</button>
              <button type="button" className="h-4 text-[9px] text-white/50 hover:text-white" onClick={() => move(i, 1)}>▼</button>
            </div>
            <button type="button" className="btn-xs" onClick={() => set(draft.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-sm" disabled={draft.length >= MAX_TEAMS}
          onClick={() => set([...draft, { id: `t${Date.now().toString(36)}`, name: `Team ${draft.length + 1}`, tag: '', logo: '' }])}>+ Add team</button>
        <button type="button" className="btn-sm !border-white !bg-white !text-[#111]" disabled={!dirty} onClick={() => { op({ k: 'teams', teams: draft }); setDirty(false); }}>Save teams</button>
        {dirty && <button type="button" className="btn-sm" onClick={() => { setDraft(teams); setDirty(false); }}>Discard</button>}
      </div>
      {draft.length > size && <p className="mt-2 text-[11px] text-amber-300/80">More teams than bracket slots ({size}). Regenerate the bracket below.</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">Renaming is safe at any time. Re-ordering changes first-round pairings.</p>
    </Panel>
  );
}

function Setup({ t, op }: { t: { format: Format; size: number; gfReset: boolean; teams: TTeam[] }; op: (o: TournamentOp) => void }) {
  const [format, setFormat] = useState<Format>(t.format);
  const [gfReset, setGfReset] = useState(t.gfReset);
  const [bo, setBo] = useState(3);
  const [fbo, setFbo] = useState(5);
  const size = Math.max(nextSize(Math.max(2, t.teams.length)), format === 'double' ? 4 : 2);
  return (
    <Panel title="Bracket setup">
      <div className="space-y-3">
        <div className="flex items-center justify-between"><Label>Format</Label>
          <Segmented size="sm" value={format} onChange={setFormat} options={[{ value: 'double', label: 'Double elim' }, { value: 'single', label: 'Single elim' }]} />
        </div>
        <div className="flex items-center justify-between"><Label>Match length</Label>
          <div className="flex items-center gap-2 text-[12px] text-white/60">
            BO <select className="input h-8" value={bo} onChange={e => setBo(+e.target.value)}>{[1, 3, 5, 7].map(n => <option key={n}>{n}</option>)}</select>
            Final BO <select className="input h-8" value={fbo} onChange={e => setFbo(+e.target.value)}>{[1, 3, 5, 7].map(n => <option key={n}>{n}</option>)}</select>
          </div>
        </div>
        {format === 'double' && <Switch on={gfReset} onChange={setGfReset} label="Grand final bracket reset" />}
        <p className="text-[11px] text-white/45">{t.teams.length} teams → {size}-slot bracket{size > t.teams.length ? ` with ${size - t.teams.length} bye${size - t.teams.length > 1 ? 's' : ''}` : ''}.</p>
        <ConfirmButton className="btn-sm w-full" confirmLabel="Generate? This clears all results" onConfirm={() => op({ k: 'generate', format, size, gfReset, bestOf: bo, finalBestOf: fbo })}>
          Generate bracket
        </ConfirmButton>
        <ConfirmButton className="btn-sm w-full" confirmLabel="Clear every score?" onConfirm={() => op({ k: 'reset-results' })}>Reset all results</ConfirmButton>
      </div>
    </Panel>
  );
}

function MatchList({ t, op }: { t: NonNullable<ReturnType<typeof useTournament>>; op: (o: TournamentOp) => void }) {
  const res = useMemo(() => resolve(t), [t]);
  const groups = useMemo(() => {
    const g = new Map<string, BMatch[]>();
    for (const m of t.matches) {
      const k = `${m.side}-${m.round}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(m);
    }
    return [...g.values()];
  }, [t.matches]);
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open');
  return (
    <Panel title="Matches" right={<Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'To play' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />}>
      <div className="space-y-5">
        {groups.map(ms => {
          const rows = ms.filter(m => {
            const r = res.get(m.id)!;
            if (r.auto || r.skipped) return filter === 'all';
            return filter === 'all' || (filter === 'done' ? m.status === 'done' : m.status !== 'done');
          });
          if (!rows.length) return null;
          return (
            <div key={ms[0].id}>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-white/45">{ms[0].label}</div>
              <div className="space-y-1.5">{rows.map(m => <MatchRow key={m.id} m={m} r={res.get(m.id)!} featured={t.featured === m.id} op={op} />)}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function MatchRow({ m, r, featured, op }: { m: BMatch; r: Resolved; featured: boolean; op: (o: TournamentOp) => void }) {
  const ready = isTeam(r.a) && isTeam(r.b);
  const name = (s: Resolved['a']) => (isTeam(s) ? s.name : s === 'BYE' ? 'BYE' : 'TBD');
  const patch = (p: Partial<BMatch>) => op({ k: 'match', id: m.id, patch: p });
  const need = Math.ceil(m.bestOf / 2);
  const Score = ({ side }: { side: 'A' | 'B' }) => {
    const v = side === 'A' ? m.scoreA : m.scoreB;
    const key = side === 'A' ? 'scoreA' : 'scoreB';
    return (
      <div className="flex items-center">
        <button type="button" className="btn-xs !rounded-r-none" disabled={!ready || v <= 0} onClick={() => patch({ [key]: v - 1 })}>−</button>
        <span className="grid h-[1.6rem] w-8 place-items-center border-y border-white/14 bg-black/30 font-display text-[14px] font-bold">{v}</span>
        <button type="button" className="btn-xs !rounded-l-none" disabled={!ready} onClick={() => {
          const n = v + 1;
          // Reaching the win target closes the match automatically.
          patch({ [key]: n, ...(n >= need && m.bestOf > 1 ? { status: 'done' } : m.status === 'upcoming' ? { status: 'live' } : {}) });
        }}>+</button>
      </div>
    );
  };
  if (r.auto || r.skipped) {
    return <div className="rounded-md border border-white/[0.05] px-3 py-2 text-[12px] text-white/35">{name(r.a)} vs {name(r.b)} · {r.skipped ? 'not needed' : 'bye'}</div>;
  }
  return (
    <div data-match={m.id} className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2 ${featured ? 'border-white/50 bg-white/[0.05]' : m.status === 'live' ? 'border-[#e5484d]/50' : 'border-white/[0.08]'}`}>
      <div className={`truncate text-[13px] font-semibold ${r.winner === 'A' && m.status === 'done' ? '' : m.status === 'done' ? 'text-white/45' : ''} ${isTeam(r.a) ? '' : 'italic text-white/35'}`}>{name(r.a)}</div>
      <div className="flex items-center gap-2"><Score side="A" /><span className="text-white/30">–</span><Score side="B" /></div>
      <div className={`truncate text-right text-[13px] font-semibold ${r.winner === 'B' && m.status === 'done' ? '' : m.status === 'done' ? 'text-white/45' : ''} ${isTeam(r.b) ? '' : 'italic text-white/35'}`}>{name(r.b)}</div>
      <div className="flex items-center gap-2">
        <input className="input h-[1.6rem] w-[74px] px-2 text-[11.5px]" placeholder="Time" defaultValue={m.time} onBlur={e => e.target.value !== m.time && patch({ time: e.target.value })} />
        <select className="input h-[1.6rem] px-1 text-[11px]" value={m.bestOf} onChange={e => patch({ bestOf: +e.target.value })}>{[1, 3, 5, 7].map(n => <option key={n} value={n}>BO{n}</option>)}</select>
        <Segmented size="sm" value={m.status} onChange={s => patch({ status: s })} options={[{ value: 'upcoming', label: 'Soon' }, { value: 'live', label: 'Live' }, { value: 'done', label: 'Final' }]} />
        <button type="button" title="Feature on the broadcast: drives the scoreboard and team names" disabled={!ready}
          className={`btn-xs ${featured ? '!border-white !bg-white !text-[#111]' : ''}`} onClick={() => op({ k: 'feature', id: featured ? null : m.id })}>
          {featured ? 'ON AIR' : 'Feature'}
        </button>
      </div>
      {m.status === 'done' && m.scoreA === m.scoreB && <div className="col-span-4 text-[11px] text-amber-300/80">A final result needs a winner: scores are tied.</div>}
    </div>
  );
}

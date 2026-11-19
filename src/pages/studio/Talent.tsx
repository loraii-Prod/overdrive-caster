/**
 * Overdrive 3.0 · TALENT MANAGER (Studio → Talent).
 *
 *   Roster      one reusable profile per person (caster, analyst, host, guest): card grid, issues, quick edit
 *   Add talent  name → paste VDO.Ninja link → see the camera → pick a position → Save   (one acknowledged command)
 *   Layouts     the real desk layouts with their camera slots: drag a person onto a slot, or pick from the list
 *   Green Room  private monitoring of everyone: camera, connection, voice level, audio path, ready check
 *   Audio       channel strip per voice: fader, mute, monitoring, sync offset, OBS input, master mute
 *
 * The producer never sees browser sources here. Positions are the approved layouts' camera slots: moving
 * someone re-routes their camera and their voice on the server, so nobody reconnects and no scene is rebuilt.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Caster, ControllerState } from '../../../shared/types';
import type { EngineState } from '../../../shared/engine';
import { SEATS, SEAT_LABELS, TALENT_ROLES, cropStyle, describeVdoLink, inUse, talentLabel, type CamQuality, type Seat, type TalentAudio, type TalentRole } from '../../../shared/talent';
import { checkTalent, toneOf, type TalentIssue } from '../../../shared/talentCheck';
import { dbToFader, faderToDb } from '../../../shared/audio';
import { vdoCasterPushUrl } from '../../../shared/players';
import { Feed } from '../../components/Feed';
import { VdoContext } from '../../lib/vdo';
import { useMeter } from '../../lib/meterStore';
import type { RtcViewer } from '../../lib/rtcViewer';
import type { Run } from '../producer/modules';
import { Btn, COND, Card, Empty, Fit169, I, IconBtn, Input, LargeView, Pill, S, Seg, Select, Toggle, copy, useLocal } from './kit';
import type { SubTab } from './Sections';

export const TALENT_TABS: SubTab[] = [{ id: 'roster', label: 'Roster' }, { id: 'layouts', label: 'Layouts & positions' }, { id: 'green', label: 'Green Room' }, { id: 'audio', label: 'Audio' }];

type T = NonNullable<ControllerState['talent']>[number];
const ROLE_TONE: Record<TalentRole, string> = { caster: '#ff3b1f', analyst: '#4c8dff', host: '#c084fc', guest: '#2fbf71' };
const roleLabel = (r: TalentRole) => TALENT_ROLES.find(x => x.id === r)?.label ?? r;
const seatShort = (s: number) => SEAT_LABELS[s as Seat].replace(' · ', ' ');
const toneColor = (t: 'ok' | 'info' | 'warn' | 'bad' | 'dim') => (t === 'ok' ? S.ok : t === 'warn' ? S.warn : t === 'bad' ? S.bad : t === 'info' ? S.info : 'rgba(255,255,255,.3)');

/** Camera state in plain words. */
function camState(t: T): { tone: 'ok' | 'warn' | 'bad' | 'dim' | 'info'; text: string } {
  if (t.mode === 'vdo') return t.vdoSet ? { tone: 'info', text: 'VDO.Ninja' } : { tone: 'warn', text: 'No VDO link' };
  if (t.publishing) return { tone: 'ok', text: t.hasAudio ? 'Camera + mic' : 'Camera, no mic' };
  if (t.online) return { tone: 'warn', text: 'Connected · no camera' };
  return { tone: t.seat ? 'bad' : 'dim', text: 'Not connected' };
}

/**
 * How the desk graphics place people, exactly as their renderers do (src/gfx/Graphic.tsx):
 *  - Caster desk: the seated caster positions (1–3) in order, cut to the layout (auto = everyone seated);
 *  - Analyst desk: positions 4 (solo) or 4 + 5 (duo), plus the caster position that joins (guest).
 * `cfg` = the graphic's prepared configuration if any, else the live one.
 */
export function deskSlots(st: ControllerState) {
  const g = (id: string) => { const x = st.graphics?.find(i => i.id === id); return x ? { ...x.config, ...(x.draft ?? {}) } : null; };
  const seated = (ids: number[]) => ids.filter(s => st.seats?.[s as Seat]);
  const cd = g('caster-desk'), ad = g('analyst-desk');
  const cl = String(cd?.layout ?? 'auto'), on = seated([1, 2, 3]);
  const n = cl === 'solo' ? 1 : cl === 'duo' ? 2 : cl === 'trio' ? 3 : Math.max(1, on.length);
  const free = [1, 2, 3].filter(s => !on.includes(s));
  const caster = [...on, ...free].slice(0, n); // empty slots = the next free positions
  const al = String(ad?.layout ?? 'duo'), guest = ad?.guest && ad.guest !== 'none' ? Number(ad.guest) : null;
  const analyst = al === 'solo' ? [4] : [4, 5];
  return { casterLayout: cl, caster, analystLayout: al, analyst, guest, hasCaster: !!cd, hasAnalyst: !!ad, casterDraft: !!st.graphics?.find(i => i.id === 'caster-desk')?.draft, analystDraft: !!st.graphics?.find(i => i.id === 'analyst-desk')?.draft };
}
/** Positions the desk layouts show (for the "position in the layout but nobody assigned" check). */
export function neededSeats(st: ControllerState): number[] {
  const d = deskSlots(st);
  return [...(d.casterLayout === 'auto' ? [] : d.caster), ...(d.hasAnalyst ? d.analyst : []), ...(d.guest ? [d.guest] : [])];
}

/** A Caster object for previewing someone who is not in a position (VDO.Ninja can be viewed directly). */
function previewCaster(t: T, idForTile = 6 as Caster['id']): Caster {
  return { id: idForTile, enabled: true, name: talentLabel(t), role: roleLabel(t.role), cameraOn: true, showName: false, offMode: 'card', source: { type: t.mode === 'vdo' && t.vdoSet ? 'vdo' : 'none', url: '', obsScene: '', obsSource: '', vdo: t.vdoId, ...(t.crop.zoom !== 1 || t.crop.x || t.crop.y ? { crop: t.crop } : {}) } };
}

/** Live camera of a person: through their position when seated (relay), else VDO.Ninja directly, else a card. */
function TalentCam({ t, st, viewer, big }: { t: T; st: ControllerState; viewer: RtcViewer | null; big?: boolean }) {
  const caster = t.seat ? st.live.casters[t.seat - 1] : null;
  const c = caster && caster.enabled ? caster : t.mode === 'vdo' && t.vdoSet ? previewCaster(t) : null;
  if (!c) return (
    <div className="absolute inset-0 grid place-items-center bg-[#0b0b0e]">
      <Avatar t={t} size={big ? 220 : 110} />
      {big && t.mode !== 'vdo' && <div className="absolute bottom-[8%] left-0 right-0 text-center text-[34px] text-white/45">{t.online ? 'Connected · preview once in a position' : 'Waiting for their camera link'}</div>}
    </div>
  );
  return <Feed caster={c} viewer={viewer} size={big ? 'lg' : 'sm'} showName={false} monitor />;
}

function Avatar({ t, size = 44 }: { t: Pick<T, 'name' | 'photo' | 'role' | 'id'>; size?: number }) {
  const ini = (t.name.trim() || t.id).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return t.photo
    ? <img src={t.photo} alt="" className="flex-none rounded-full object-cover" style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ROLE_TONE[t.role]}` }} />
    : <span className={`${COND} grid flex-none place-items-center rounded-full`} style={{ width: size, height: size, fontSize: size * 0.4, background: `${ROLE_TONE[t.role]}26`, color: ROLE_TONE[t.role], boxShadow: `0 0 0 2px ${ROLE_TONE[t.role]}66` }}>{ini}</span>;
}

/** Horizontal level meter (dBFS peak → bar, green / amber / red zones like a console). */
export function Meter({ id, muted, h = 6, vertical }: { id: string; muted?: boolean; h?: number; vertical?: boolean }) {
  const db = useMeter(id);
  const f = db == null ? 0 : Math.max(0, Math.min(1, (db + 60) / 60));
  const col = db != null && db > -6 ? S.bad : db != null && db > -18 ? S.warn : S.ok;
  return (
    <div className={`relative overflow-hidden rounded-full bg-white/[0.08] ${vertical ? 'h-full' : 'w-full'}`} style={vertical ? { width: h } : { height: h }} title={db == null ? 'No level from OBS' : `${db} dBFS`} data-meter={id}>
      <div className="absolute rounded-full transition-[width,height] duration-75" style={{ background: muted ? 'rgba(255,255,255,.25)' : col, ...(vertical ? { left: 0, right: 0, bottom: 0, height: `${f * 100}%` } : { left: 0, top: 0, bottom: 0, width: `${f * 100}%` }) }} />
    </div>
  );
}

// =====================================================================================================================
export function TalentManager({ tab = 'roster', st, eng, run, viewer, setCams }: { tab?: string; st: ControllerState; eng: EngineState; run: Run; viewer: RtcViewer | null; setCams: (ids: number[]) => void }) {
  useEffect(() => { setCams([1, 2, 3, 4, 5, 6]); return () => setCams([]); }, [setCams]);
  const talent = st.talent ?? [];
  const issues = useMemo(() => checkTalent({ talent, seats: st.seats ?? ({} as never), audio: st.audio, needed: neededSeats(st) }), [talent, st.seats, st.audio, st.graphics]);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const vdoCtx = { password: st.showLive.vdo.password, params: st.showLive.vdo.params, embeds: false, monitorFeeds: true };
  const active = talent.filter(t => inUse(t, !!t.seat));
  const onAdded = (id: string | null) => { setAdding(false); if (id) setSel(id); };

  return (
    <VdoContext.Provider value={vdoCtx}>
      <div className="flex h-full min-h-0 flex-col gap-3" data-talent-manager={tab}>
        <TalentBar st={st} talent={active} issues={issues} onAdd={() => setAdding(true)} run={run} />
        <div className="min-h-0 flex-1">
          {tab === 'roster' && <Roster st={st} run={run} viewer={viewer} talent={active} issues={issues} sel={sel} setSel={setSel} onAdd={() => setAdding(true)} />}
          {tab === 'layouts' && <Layouts st={st} eng={eng} run={run} talent={active} viewer={viewer} />}
          {tab === 'green' && <GreenRoom st={st} run={run} viewer={viewer} talent={active} issues={issues} onAdd={() => setAdding(true)} />}
          {tab === 'audio' && <AudioMixer st={st} run={run} talent={active} />}
        </div>
      </div>
      {adding && <AddTalent st={st} run={run} onDone={onAdded} />}
    </VdoContext.Provider>
  );
}

function TalentBar({ st, talent, issues, onAdd, run }: { st: ControllerState; talent: T[]; issues: TalentIssue[]; onAdd: () => void; run: Run }) {
  const seated = talent.filter(t => t.seat);
  const camsLive = seated.filter(t => (t.mode === 'vdo' ? t.vdoSet : t.publishing)).length;
  const ready = seated.filter(t => t.ready).length;
  const bad = issues.filter(i => i.tone === 'bad').length, warn = issues.filter(i => i.tone === 'warn').length;
  const master = st.audio?.master === true;
  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5" data-talent-bar>
      <Btn kind="accent" size="lg" onClick={onAdd} icon={I.plus} data-add-talent="">Add talent</Btn>
      <div className="mx-1 h-[30px] w-px bg-white/10" />
      <Pill tone={seated.length ? 'ok' : 'dim'}>{seated.length} in the show</Pill>
      <Pill tone={camsLive === seated.length ? (seated.length ? 'ok' : 'dim') : 'warn'}>{camsLive}/{seated.length} cameras</Pill>
      <Pill tone={ready === seated.length ? (seated.length ? 'ok' : 'dim') : 'info'}>{ready}/{seated.length} ready</Pill>
      {bad > 0 && <Pill tone="bad">{bad} to fix</Pill>}
      {warn > 0 && <Pill tone="warn">{warn} warning{warn === 1 ? '' : 's'}</Pill>}
      <span className="ml-auto flex items-center gap-2">
        <Pill tone={st.audio?.obs ? 'ok' : 'warn'} title="Talent volume, mute and meters go through OBS WebSocket">{st.audio?.obs ? 'Audio · OBS' : 'Audio · OBS offline'}</Pill>
        <Btn size="sm" kind={master ? 'pgm' : 'default'} onClick={() => run({ c: 'audio-master', muted: !master }, master ? 'Talent voices back on' : 'Mute every talent voice')} icon={I.mic} data-master-mute={master ? 'on' : 'off'}>{master ? 'Talent muted' : 'Mute all talent'}</Btn>
      </span>
    </div>
  );
}

// ===================================================================================================== ROSTER
function Roster({ st, run, viewer, talent, issues, sel, setSel, onAdd }: { st: ControllerState; run: Run; viewer: RtcViewer | null; talent: T[]; issues: TalentIssue[]; sel: string | null; setSel: (id: string | null) => void; onAdd: () => void }) {
  const [filter, setFilter] = useLocal<'all' | TalentRole>('od.talent.filter', 'all');
  const list = talent.filter(t => filter === 'all' || t.role === filter).sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || a.name.localeCompare(b.name));
  const cur = talent.find(t => t.id === sel) ?? null;
  return (
    <div className="grid h-full min-h-0 gap-3" style={{ gridTemplateColumns: cur ? 'minmax(0, 1fr) minmax(460px, 0.9fr)' : 'minmax(0, 1fr)' }}>
      <div className="flex min-h-0 flex-col gap-2.5">
        <div className="flex flex-none items-center gap-2">
          <Seg size="sm" value={filter} options={[['all', `All · ${talent.length}`], ...TALENT_ROLES.map(r => [r.id, `${r.label}s`] as [TalentRole, string])]} onChange={setFilter} />
        </div>
        {list.length === 0
          ? <Card fill><Empty action={<Btn kind="accent" onClick={onAdd} icon={I.plus}>Add talent</Btn>}>{talent.length ? 'Nobody with this role yet.' : <>No talent yet. <b className="text-white/80">Add talent</b>: type a name, paste their VDO.Ninja link, pick a position. Profiles are kept for the next events.</>}</Empty></Card>
          : <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gridAutoRows: 'max-content' }}>
              {list.map(t => <TalentCard key={t.id} t={t} st={st} run={run} viewer={viewer} issues={issues} on={t.id === sel} onClick={() => setSel(t.id === sel ? null : t.id)} />)}
            </div>}
      </div>
      {cur && <TalentEditor key={cur.id} t={cur} st={st} run={run} viewer={viewer} issues={issues.filter(i => i.talent === cur.id)} onClose={() => setSel(null)} />}
    </div>
  );
}

function TalentCard({ t, st, run, viewer, issues, on, onClick }: { t: T; st: ControllerState; run: Run; viewer: RtcViewer | null; issues: TalentIssue[]; on: boolean; onClick: () => void }) {
  const cam = camState(t), tone = toneOf(issues, t.id), mine = issues.filter(i => i.talent === t.id && i.tone !== 'info');
  const line = mine.length ? mine[0].text.replace(`${talentLabel(t)}: `, '').replace(`${talentLabel(t)} `, '').replace(/^\([^)]*\)\s*/, '') : t.audio.source === 'obs' ? `Voice: ${t.audio.input || 'OBS input'}` : t.audio.source === 'none' ? 'No audio' : 'Voice: camera link';
  return (
    <div className="flex min-w-0 cursor-pointer gap-3 overflow-hidden rounded-[10px] border p-2.5 transition hover:border-white/25" onClick={onClick}
      style={{ background: S.panel, borderColor: on ? S.accent : S.line, boxShadow: on ? `0 0 0 1px ${S.accent}` : undefined }} data-talent-card={t.id}>
      <div className="relative w-[176px] flex-none overflow-hidden rounded-[7px]">
        <Fit169 w={960} h={540} className="aspect-video w-full bg-black"><TalentCam t={t} st={st} viewer={viewer} /></Fit169>
        <span className="absolute right-1.5 top-1.5 h-[10px] w-[10px] rounded-full" style={{ background: toneColor(tone === 'info' ? 'ok' : tone), boxShadow: '0 0 0 2px rgba(0,0,0,.6)' }} title={mine[0]?.text ?? 'All good'} />
        <span className={`${COND} pointer-events-none absolute bottom-1 left-1 rounded-[4px] bg-black/75 px-1.5 text-[11.5px] tracking-[0.1em]`} style={{ color: t.seat ? '#fff' : 'rgba(255,255,255,.55)' }}>{t.seat ? seatShort(t.seat) : 'No position'}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <Avatar t={t} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold leading-tight">{talentLabel(t)}</div>
            <div className="flex items-center gap-1.5 text-[12.5px]"><span style={{ color: ROLE_TONE[t.role] }} className={`${COND} tracking-[0.1em]`}>{roleLabel(t.role)}</span><span className="text-white/35">·</span><span className="truncate" style={{ color: toneColor(cam.tone) }}>{cam.text}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <div className="min-w-0 flex-1"><Meter id={t.id} muted={t.audio.muted || st.audio?.master} /></div>
          <IconBtn size={30} title={t.audio.muted ? `Unmute ${talentLabel(t)}` : `Mute ${talentLabel(t)}`} active={t.audio.muted} onClick={() => run({ c: 'talent-edit', id: t.id, audio: { muted: !t.audio.muted } }, `${talentLabel(t)} ${t.audio.muted ? 'unmuted' : 'muted'}`)}>{t.audio.muted ? <span className="text-[12px] font-bold" style={{ color: S.bad }}>M</span> : I.mic}</IconBtn>
        </div>
        <div className="mt-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: mine.length ? toneColor(mine[0].tone) : 'rgba(255,255,255,.45)' }} title={mine.map(i => i.text).join('\n')}>{line}</span>
          <Toggle on={t.ready} label={<span className="text-[13px]">Ready</span>} onChange={v => run({ c: 'talent-edit', id: t.id, ready: v }, `${talentLabel(t)} ${v ? 'ready' : 'not ready'}`)} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- profile editor
function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return <div className="border-b px-5 py-4" style={{ borderColor: S.line }}><div className="mb-3 flex items-center gap-2"><span className={`${COND} text-[14px] tracking-[0.14em] text-white/55`}>{title}</span><span className="ml-auto flex items-center gap-2">{extra}</span></div>{children}</div>;
}
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="grid items-center gap-3 py-1" style={{ gridTemplateColumns: '120px minmax(0, 1fr)' }}><span className="text-[13.5px] text-white/60">{label}</span><div className="flex min-w-0 items-center gap-2">{children}</div></div>;
}

function TalentEditor({ t, st, run, viewer, issues, onClose }: { t: T; st: ControllerState; run: Run; viewer: RtcViewer | null; issues: TalentIssue[]; onClose: () => void }) {
  const name = talentLabel(t);
  const edit = (patch: Omit<Extract<Parameters<Run>[0], { c: 'talent-edit' }>, 'c' | 'id'>, label: string) => run({ c: 'talent-edit', id: t.id, ...patch }, `${name}: ${label}`);
  const [vdoText, setVdoText] = useState('');
  const info = describeVdoLink(vdoText);
  const talentLink = `${location.origin}/talent/${t.id}?key=${encodeURIComponent(t.key)}`;
  const vdoPush = vdoCasterPushUrl(t.vdoId, t.name, st.showLive.vdo.password, st.showLive.vdo.room, t.camQuality);
  const seats = (st.seats ?? {}) as Record<number, string | null>;
  const [big, setBig] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upl, setUpl] = useState('');
  const upload = async (f: File) => {
    setUpl('Uploading…');
    try { const r = await fetch('/api/upload?role=portrait', { method: 'POST', headers: { 'Content-Type': f.type }, body: f }); const j = await r.json(); if (!r.ok || !j.url) throw new Error(j.error ?? 'upload failed'); await edit({ photo: j.url }, 'picture'); setUpl(''); }
    catch (e) { setUpl((e as Error).message); }
  };
  return (
    <Card fill title={<span className="flex items-center gap-3"><Avatar t={t} size={30} />{name}</span>} bodyClass="overflow-y-auto" data-talent-editor={t.id}
      actions={<IconBtn title="Close" onClick={onClose}>{I.x}</IconBtn>}>
      {issues.length > 0 && (
        <div className="space-y-1.5 border-b px-5 py-3" style={{ borderColor: S.line, background: 'rgba(245,165,36,.05)' }} data-talent-issues>
          {issues.map((i, n) => <div key={n} className="flex items-start gap-2 text-[13.5px]"><span className="mt-[5px] h-[8px] w-[8px] flex-none rounded-full" style={{ background: toneColor(i.tone) }} /><span className="min-w-0"><span className="text-white/85">{i.text}</span>{i.fix && <span className="text-white/50"> → {i.fix}</span>}</span></div>)}
        </div>
      )}
      <Section title="Person">
        <Row label="Name"><Input ariaLabel="Name" value={t.name} placeholder="Name needed" warn={!t.name.trim()} onCommit={v => edit({ name: v }, 'renamed')} /></Row>
        <Row label="Role"><Seg size="sm" value={t.role} options={TALENT_ROLES.map(r => [r.id, r.label] as [TalentRole, string])} onChange={v => edit({ role: v }, `role ${v}`)} /></Row>
        <Row label="Position">
          <Select ariaLabel="Position" value={t.seat ? String(t.seat) : ''} options={[['', 'Not in a position'], ...SEATS.map(s => [String(s), `${SEAT_LABELS[s]}${seats[s] && seats[s] !== t.id ? ` · swap with ${talentLabel(st.talent?.find(x => x.id === seats[s]))}` : ''}`] as [string, string])]}
            onChange={v => run(v ? { c: 'seat', seat: Number(v), talent: t.id } : { c: 'seat', seat: t.seat!, talent: null }, v ? `${name} → ${SEAT_LABELS[Number(v) as Seat]}` : `${name} off position`)} />
        </Row>
        <Row label="Picture">
          <Input ariaLabel="Picture address" value={t.photo} placeholder="Upload or paste an image address" mono onCommit={v => edit({ photo: v }, 'picture')} />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          <Btn size="sm" onClick={() => fileRef.current?.click()}>Upload</Btn>
        </Row>
        {upl && <div className="pl-[132px] text-[12.5px] text-white/55">{upl}</div>}
      </Section>

      <Section title="Camera" extra={<Pill tone={camState(t).tone === 'info' ? 'info' : camState(t).tone}>{camState(t).text}</Pill>}>
        <div className="relative mb-3 cursor-zoom-in overflow-hidden rounded-[8px]" onClick={() => setBig(true)} title="Large view">
          <Fit169 w={960} h={540} className="aspect-video w-full bg-black"><TalentCam t={t} st={st} viewer={viewer} /></Fit169>
          <span className={`${COND} pointer-events-none absolute left-2 top-2 rounded-[4px] bg-black/75 px-1.5 py-0.5 text-[12px] tracking-[0.1em]`}>Private preview</span>
        </div>
        <Row label="Camera via"><Seg size="sm" value={t.mode} options={[['vdo', 'VDO.Ninja link'], ['webrtc', 'Overdrive link']]} onChange={v => edit({ mode: v }, `camera via ${v === 'vdo' ? 'VDO.Ninja' : 'Overdrive link'}`)} /></Row>
        {t.mode === 'vdo' ? <>
          <Row label="VDO.Ninja">
            <input aria-label="VDO.Ninja link" value={vdoText} onChange={e => setVdoText(e.target.value)} placeholder={t.vdoSet ? `Stream ${t.vdoId} · paste a new link to change it` : 'Paste their VDO.Ninja push= or view= link'}
              onKeyDown={e => { if (e.key === 'Enter' && info.ok) { void edit({ vdoId: vdoText }, 'VDO.Ninja link'); setVdoText(''); } }}
              className="h-[40px] min-w-0 flex-1 rounded-[6px] border bg-[#0a0a0d] px-3 font-mono text-[13px] outline-none" style={{ borderColor: vdoText && !info.ok ? S.bad : vdoText && info.ok ? S.ok : S.line2 }} />
            <Btn size="sm" kind={info.ok ? 'accent' : 'default'} disabled={!info.ok} onClick={() => { void edit({ vdoId: vdoText }, 'VDO.Ninja link'); setVdoText(''); }}>Use</Btn>
          </Row>
          {vdoText && <div className="pl-[132px] text-[12.5px]" style={{ color: info.ok ? S.ok : S.bad }}>{info.ok ? `Stream ${info.id}${info.note ? ` · ${info.note}` : ''}` : info.problem}</div>}
        </> : (
          <Row label="Their link">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-white/55">/talent/{t.id}?key=…</span>
            <Btn size="sm" onClick={() => copy(talentLink)} icon={I.link}>Copy</Btn>
            <IconBtn title="New personal link (the old one stops working)" onClick={() => { if (confirm(`Give ${name} a new link? The old one stops working at once.`)) run({ c: 'talent-regen', id: t.id }, `New link for ${name}`); }}>{I.refresh}</IconBtn>
          </Row>
        )}
        <Row label="Quality"><Seg size="sm" value={t.camQuality ?? '720p'} options={[['720p', '720p30'], ['1080p', '1080p30']]} onChange={v => edit({ camQuality: v as CamQuality }, `camera ${v}`)} />
          {t.mode === 'vdo' && <Btn size="sm" kind="ghost" onClick={() => copy(vdoPush)} icon={I.copy} title="A VDO.Ninja push link with the show's password and this quality, to send them">Copy push link for them</Btn>}</Row>
      </Section>

      <Section title="Framing" extra={(t.crop.zoom !== 1 || t.crop.x || t.crop.y) ? <Btn size="sm" kind="ghost" onClick={() => edit({ crop: { zoom: 1, x: 0, y: 0 } }, 'full frame')}>Reset</Btn> : undefined}>
        <Slider label="Zoom" min={1} max={3} step={0.05} value={t.crop.zoom} fmt={v => `${v.toFixed(2)}×`} onCommit={v => edit({ crop: { zoom: v } }, `zoom ${v.toFixed(2)}`)} />
        <Slider label="Left ↔ right" min={-50} max={50} step={1} value={t.crop.x} disabled={t.crop.zoom === 1} onCommit={v => edit({ crop: { x: v } }, 'framing')} />
        <Slider label="Up ↕ down" min={-50} max={50} step={1} value={t.crop.y} disabled={t.crop.zoom === 1} onCommit={v => edit({ crop: { y: v } }, 'framing')} />
        <p className="mt-1 text-[12.5px] text-white/45">Applies to every tile that shows {name}, on every desk. The preview above follows it.</p>
      </Section>

      <Section title="Audio"><AudioControls t={t} st={st} run={run} /></Section>

      <Section title="Notes"><textarea aria-label="Notes" defaultValue={t.notes} onBlur={e => { if (e.target.value !== t.notes) void edit({ notes: e.target.value }, 'notes'); }} rows={3} placeholder="Pronunciation, socials, setup remarks (never on air)" className="w-full rounded-[6px] border bg-[#0a0a0d] p-3 text-[14px] outline-none" style={{ borderColor: S.line2 }} /></Section>

      <div className="flex items-center gap-2 px-5 py-4">
        <span className="text-[12.5px] text-white/40">Profile {t.id.toUpperCase()} · kept for future events</span>
        <Btn size="sm" kind="danger" className="ml-auto" onClick={() => { if (confirm(`Remove ${name}? Their link stops working and the profile is cleared.`)) { void run({ c: 'talent-remove', id: t.id }, `Remove ${name}`); onClose(); } }} icon={I.trash}>Remove</Btn>
      </div>
      {big && <LargeView title={<>{name} <span className="text-white/45">· private preview</span></>} onClose={() => setBig(false)}><div className="absolute inset-0 bg-black"><TalentCam t={t} st={st} viewer={viewer} big /></div></LargeView>}
    </Card>
  );
}

function Slider({ label, min, max, step, value, fmt, onCommit, disabled }: { label: string; min: number; max: number; step: number; value: number; fmt?: (v: number) => string; onCommit: (v: number) => unknown; disabled?: boolean }) {
  const [v, setV] = useState<number | null>(null);
  return (
    <Row label={label}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={v ?? value} disabled={disabled} onChange={e => setV(Number(e.target.value))}
        onPointerUp={() => { if (v != null && v !== value) onCommit(v); setV(null); }} onKeyUp={() => { if (v != null && v !== value) onCommit(v); setV(null); }} className="min-w-0 flex-1 accent-[#ff3b1f] disabled:opacity-30" />
      <span className="w-[64px] text-right font-mono text-[13px] text-white/70">{fmt ? fmt(v ?? value) : v ?? value}</span>
    </Row>
  );
}

/** Voice path + fader + mute + sync + monitoring for one person (editor and mixer share it). */
function AudioControls({ t, st, run, compact }: { t: T; st: ControllerState; run: Run; compact?: boolean }) {
  const name = talentLabel(t);
  const set = (a: Partial<TalentAudio>, label: string) => run({ c: 'talent-edit', id: t.id, audio: a }, `${name}: ${label}`);
  const inputs = st.audio?.inputs ?? [];
  const path = st.audio?.talent?.[t.id];
  return <>
    <Row label="Voice from">
      <Seg size="sm" value={t.audio.source} options={[['feed', 'Camera link'], ['obs', 'OBS input'], ['none', 'None']]} onChange={v => set({ source: v, ...(v === 'obs' && !t.audio.input && inputs[0] ? { input: inputs.find(i => !i.startsWith('Overdrive Caster')) ?? '' } : {}) }, `voice from ${v}`)} />
    </Row>
    {t.audio.source === 'obs' && (
      <Row label="OBS input">
        <Select ariaLabel="OBS audio input" value={t.audio.input} options={[['', inputs.length ? '— choose —' : st.audio?.obs ? 'No audio inputs in OBS' : 'Connect OBS to list its inputs'], ...inputs.filter(i => !i.startsWith('Overdrive Caster')).map(i => [i, i] as [string, string]), ...(t.audio.input && !inputs.includes(t.audio.input) ? [[t.audio.input, `${t.audio.input} (not in OBS)`] as [string, string]] : [])]}
          onChange={v => set({ input: v }, `OBS input ${v}`)} />
      </Row>
    )}
    {t.audio.source !== 'none' && <>
      <Row label="Level"><div className="flex min-w-0 flex-1 items-center gap-2"><div className="min-w-0 flex-1"><Meter id={t.id} muted={t.audio.muted || st.audio?.master} h={8} /></div>
        <Btn size="sm" kind={t.audio.muted ? 'pgm' : 'default'} onClick={() => set({ muted: !t.audio.muted }, t.audio.muted ? 'unmuted' : 'muted')} data-mute={t.id}>{t.audio.muted ? 'Muted' : 'Mute'}</Btn></div></Row>
      <Slider label="Fader" min={0} max={1} step={0.005} value={dbToFader(t.audio.volumeDb)} fmt={v => `${faderToDb(v) > 0 ? '+' : ''}${faderToDb(v).toFixed(1)} dB`} onCommit={v => set({ volumeDb: faderToDb(v) }, `fader ${faderToDb(v)} dB`)} />
      {!compact && <>
        <Row label="Sync offset"><Input ariaLabel="Sync offset (ms)" type="number" value={String(t.audio.syncMs)} onCommit={v => set({ syncMs: Number(v) || 0 }, `sync ${Number(v) || 0} ms`)} className="max-w-[140px]" /><span className="text-[12.5px] text-white/45">ms · delays the voice to match a late picture</span></Row>
        <Row label="Monitoring"><Toggle on={t.audio.monitor} onChange={v => set({ monitor: v }, v ? 'monitored' : 'not monitored')} label={<span className="text-[13px] text-white/60">Hear them on this PC's monitoring device (OBS)</span>} /></Row>
      </>}
      <div className="pl-[132px] text-[12.5px] text-white/45" data-audio-path={t.id}>
        {!st.audio?.obs ? 'OBS not connected: these settings are saved and applied when it connects.'
          : !path ? (t.seat ? 'Not reaching OBS.' : 'Not in a position: their voice is kept silent.')
          : !path.exists ? <span style={{ color: S.bad }}>OBS has no “{path.input}”.</span>
          : <>OBS “{path.input}” · {path.muted ? 'muted' : 'live'} · {path.volumeDb?.toFixed(1)} dB{path.syncMs ? ` · ${path.syncMs} ms` : ''}{path.override ? ' · changed by hand in OBS' : ''}</>}
      </div>
    </>}
  </>;
}

// ===================================================================================================== ADD TALENT
function AddTalent({ st, run, onDone }: { st: ControllerState; run: Run; onDone: (id: string | null) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<TalentRole>('caster');
  const [mode, setMode] = useState<'vdo' | 'webrtc'>('vdo');
  const [link, setLink] = useState('');
  const [seat, setSeat] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const info = describeVdoLink(link);
  const seats = (st.seats ?? {}) as Record<number, string | null>;
  const freeFor = (r: TalentRole): number[] => (r === 'analyst' ? [4, 5] : r === 'guest' ? [6] : [1, 2, 3]).filter(s => !seats[s]);
  useEffect(() => { setSeat(s => (s != null && !seats[s] ? s : freeFor(role)[0] ?? null)); }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupName = !!name.trim() && (st.talent ?? []).some(t => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  const canSave = !!name.trim() && !dupName && (mode === 'webrtc' || info.ok) && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr('');
    const a = await run({ c: 'talent-add', name: name.trim(), role, mode, ...(mode === 'vdo' ? { vdo: link } : {}), seat }, `Add ${name.trim()}`);
    setBusy(false);
    if (!a.ok) { setErr(a.error ?? 'Not added'); return; }
    onDone(/Added (t\d+)/.exec(a.note ?? '')?.[1] ?? null);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onDone]);
  const preview: T | null = mode === 'vdo' && info.ok ? { id: 'new', name, role, mode: 'vdo', key: '', vdoId: info.id!, vdoSet: true, camQuality: '720p', photo: '', ready: false, audio: { source: 'feed', input: '', volumeDb: 0, muted: false, syncMs: 0, monitor: false }, crop: { zoom: 1, x: 0, y: 0 }, notes: '', online: false, publishing: false, hasAudio: false, seat: null } : null;
  const step = (n: number, label: string, done: boolean) => <span className={`${COND} mr-2 inline-grid h-[24px] w-[24px] place-items-center rounded-full text-[13px]`} style={{ background: done ? S.ok : 'rgba(255,255,255,.1)', color: done ? '#04140b' : '#fff' }} title={label}>{done ? '✓' : n}</span>;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-6" onClick={() => onDone(null)} data-add-dialog>
      <div className="flex max-h-full w-full max-w-[1180px] flex-col overflow-hidden rounded-[12px] border" style={{ background: S.panel, borderColor: S.line2 }} onClick={e => e.stopPropagation()}>
        <header className="flex h-[60px] flex-none items-center gap-3 border-b px-6" style={{ borderColor: S.line }}>
          <span style={{ color: S.accent }}>{I.talent}</span><h3 className={`${COND} text-[22px] tracking-[0.1em]`}>Add talent</h3>
          <span className="text-[14px] text-white/45">Name, camera link, position: done. Everything else is optional.</span>
          <span className="ml-auto"><IconBtn title="Close (Esc)" onClick={() => onDone(null)}>{I.x}</IconBtn></span>
        </header>
        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.05fr)' }}>
          <div className="space-y-5 border-r p-6" style={{ borderColor: S.line }}>
            <div>
              <div className="mb-2 flex items-center">{step(1, 'Name', !!name.trim() && !dupName)}<span className={`${COND} text-[15px] tracking-[0.12em] text-white/70`}>Name</span></div>
              <input autoFocus aria-label="Talent name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} placeholder="e.g. Kenji Watanabe"
                className="h-[50px] w-full rounded-[8px] border bg-[#0a0a0d] px-4 text-[20px] outline-none focus:border-white/45" style={{ borderColor: dupName ? S.bad : S.line2 }} />
              {dupName && <div className="mt-1.5 text-[13px]" style={{ color: S.bad }}>{name.trim()} already has a profile: edit it in the roster.</div>}
              <div className="mt-3"><Seg value={role} options={TALENT_ROLES.map(r => [r.id, r.label] as [TalentRole, string])} onChange={setRole} /></div>
            </div>
            <div>
              <div className="mb-2 flex items-center">{step(2, 'Camera', mode === 'webrtc' || info.ok)}<span className={`${COND} text-[15px] tracking-[0.12em] text-white/70`}>Camera</span>
                <span className="ml-auto"><Seg size="sm" value={mode} options={[['vdo', 'VDO.Ninja link'], ['webrtc', 'Overdrive link']]} onChange={setMode} /></span></div>
              {mode === 'vdo' ? <>
                <input aria-label="VDO.Ninja link" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} placeholder="Paste their VDO.Ninja link (push= or view=)"
                  className="h-[46px] w-full rounded-[8px] border bg-[#0a0a0d] px-4 font-mono text-[14px] outline-none focus:border-white/45" style={{ borderColor: link && !info.ok ? S.bad : link && info.ok ? S.ok : S.line2 }} data-vdo-input />
                <div className="mt-1.5 min-h-[20px] text-[13px]" style={{ color: !link ? 'rgba(255,255,255,.45)' : info.ok ? S.ok : S.bad }} data-vdo-feedback>
                  {!link ? 'Their own VDO.Ninja link. The show\'s VDO.Ninja password and room are used.' : info.ok ? `✓ Stream ${info.id}${info.note ? ` · ${info.note}` : ''}` : info.problem}
                </div>
              </> : <p className="text-[13.5px] leading-relaxed text-white/55">They get a personal Overdrive link (camera + mic in the browser, nothing to install). Copy it from their card after saving.</p>}
            </div>
            <div>
              <div className="mb-2 flex items-center">{step(3, 'Position', seat != null)}<span className={`${COND} text-[15px] tracking-[0.12em] text-white/70`}>Position</span><span className="ml-2 text-[13px] text-white/45">optional</span></div>
              <SeatPicker st={st} value={seat} onChange={setSeat} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 p-6">
            <div className={`${COND} text-[15px] tracking-[0.12em] text-white/70`}>Camera preview <span className="text-white/40">· private, never on air</span></div>
            <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: S.line }}>
              <Fit169 w={960} h={540} className="aspect-video w-full bg-black" data-add-preview>
                {preview ? <Feed caster={previewCaster(preview)} viewer={null} size="sm" showName={false} monitor />
                  : <div className="absolute inset-0 grid place-items-center text-center text-[34px] text-white/35">{mode === 'vdo' ? 'Paste a VDO.Ninja link to see their camera' : 'Their camera appears once they open their link'}</div>}
              </Fit169>
            </div>
            <p className="text-[13px] leading-relaxed text-white/45">The preview loads their VDO.Ninja stream directly (low bitrate). If it stays dark, they are not streaming yet or the link is wrong. Audio, framing, picture and sync can be set later on their card.</p>
            {err && <div className="rounded-[8px] border px-4 py-3 text-[14px]" style={{ borderColor: `${S.bad}88`, background: `${S.bad}14`, color: '#ffb1b3' }} data-add-error>{err}</div>}
          </div>
        </div>
        <footer className="flex h-[72px] flex-none items-center gap-3 border-t px-6" style={{ borderColor: S.line }}>
          <span className="text-[13.5px] text-white/45">{seat != null ? <>Goes to <b className="text-white/80">{SEAT_LABELS[seat as Seat]}</b> at once (every source showing that position updates).</> : 'Not in a position yet: assign later in Layouts.'}</span>
          <Btn className="ml-auto" kind="ghost" onClick={() => onDone(null)}>Cancel</Btn>
          <Btn kind="accent" size="lg" disabled={!canSave} onClick={() => void save()} data-add-save="">{busy ? 'Saving…' : 'Save'}</Btn>
        </footer>
      </div>
    </div>
  );
}

/** The three desks as small diagrams: click a free slot (taken slots show who is there). */
function SeatPicker({ st, value, onChange }: { st: ControllerState; value: number | null; onChange: (s: number | null) => void }) {
  const seats = (st.seats ?? {}) as Record<number, string | null>;
  const who = (s: number) => st.talent?.find(t => t.id === seats[s]);
  const groups: { label: string; slots: [number, string][] }[] = [
    { label: 'Caster desk', slots: [[1, 'Left'], [2, 'Center'], [3, 'Right']] },
    { label: 'Analyst desk', slots: [[4, 'Left'], [5, 'Right']] },
    { label: 'Interview', slots: [[6, 'Guest']] },
  ];
  return (
    <div className="space-y-2.5" data-seat-picker>
      {groups.map(g => (
        <div key={g.label} className="flex items-center gap-2">
          <span className="w-[104px] flex-none text-[13px] text-white/55">{g.label}</span>
          {g.slots.map(([s, l]) => {
            const w = who(s), on = value === s;
            return (
              <button key={s} type="button" disabled={!!w} onClick={() => onChange(on ? null : s)} aria-pressed={on} data-pick-seat={s}
                className="flex h-[46px] min-w-0 flex-1 flex-col items-center justify-center rounded-[7px] border px-2 transition disabled:cursor-not-allowed"
                style={{ borderColor: on ? S.accent : S.line2, background: on ? S.accentSoft : w ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.04)' }}>
                <span className={`${COND} text-[13px] tracking-[0.1em]`} style={{ color: w ? 'rgba(255,255,255,.35)' : '#fff' }}>{l}</span>
                <span className="max-w-full truncate text-[11.5px]" style={{ color: w ? 'rgba(255,255,255,.4)' : on ? S.accent : 'rgba(255,255,255,.45)' }}>{w ? talentLabel(w) : on ? 'selected' : 'free'}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ===================================================================================================== LAYOUTS
type Slot = { seat: number; label: string; x: number };
const spread = (seats: number[], labels: string[], xs: number[]): Slot[] => seats.map((seat, i) => ({ seat, label: labels[i], x: xs[i] }));

function Layouts({ st, run, talent, viewer }: { st: ControllerState; eng: EngineState; run: Run; talent: T[]; viewer: RtcViewer | null }) {
  const [drag, setDrag] = useState<string | null>(null);
  const d = deskSlots(st);
  const seatOf = (s: number) => talent.find(t => t.id === st.seats?.[s as Seat]);
  const assign = (seat: number, id: string | null) => { const t = talent.find(x => x.id === id); return run({ c: 'seat', seat, talent: id }, id ? `${talentLabel(t)} → ${SEAT_LABELS[seat as Seat]}` : `${SEAT_LABELS[seat as Seat]} cleared`); };
  const onDrop = (seat: number) => (e: DragEvent) => { e.preventDefault(); const id = e.dataTransfer?.getData('text/talent') || drag; setDrag(null); if (id) void assign(seat, id); };
  const gset = (id: string, patch: Record<string, string>, label: string) => run({ c: 'gfx-set', id, patch }, label);
  const cN = d.caster.length;
  const caster = spread(d.caster, cN === 1 ? ['Center'] : cN === 2 ? ['Left', 'Right'] : ['Left', 'Center', 'Right'], cN === 1 ? [50] : cN === 2 ? [30, 70] : [18, 50, 82]);
  const aBase = d.analyst.length === 1 ? spread(d.analyst, ['Analyst'], [d.guest ? 33 : 50]) : spread(d.analyst, ['Left', 'Right'], d.guest ? [18, 82] : [30, 70]);
  const analyst = d.guest ? [...aBase, { seat: d.guest, label: 'Host · joins', x: d.analyst.length === 1 ? 67 : 50 }] : aBase;
  const hostSeat = [1, 2, 3].find(s => seatOf(s)?.role === 'host') ?? [1, 2, 3].find(s => seatOf(s)) ?? 1;
  const desks: { id: string; gfx: string | null; label: string; slots: Slot[]; draft: boolean; presets: { label: string; on: boolean; patch: Record<string, string> }[]; note: string }[] = [
    { id: 'caster', gfx: d.hasCaster ? 'caster-desk' : null, label: 'Caster desk', slots: caster, draft: d.casterDraft, note: 'People appear left to right in position order. Auto shows everyone assigned to the caster desk.',
      presets: [['auto', 'Auto'], ['solo', 'Solo caster'], ['duo', 'Duo caster'], ['trio', 'Trio caster']].map(([v, l]) => ({ label: l, on: d.casterLayout === v, patch: { layout: v } })) },
    { id: 'analyst', gfx: d.hasAnalyst ? 'analyst-desk' : null, label: 'Analyst desk', slots: analyst, draft: d.analystDraft, note: 'The approved desk has two analyst cameras plus one joining position: "with host" brings a caster-desk position in as the third voice.',
      presets: [{ label: 'Solo analyst', on: d.analystLayout === 'solo' && !d.guest, patch: { layout: 'solo', guest: 'none' } }, { label: 'Duo analyst', on: d.analystLayout === 'duo' && !d.guest, patch: { layout: 'duo', guest: 'none' } }, { label: 'Desk with host', on: !!d.guest, patch: { layout: 'duo', guest: String(hostSeat) } }] },
    { id: 'interview', gfx: null, label: 'Interview', slots: [{ seat: 6, label: 'Guest', x: 50 }], draft: false, presets: [], note: 'One guest position (a player or guest joining remotely).' },
  ];
  return (
    <div className="grid h-full min-h-0 gap-3" style={{ gridTemplateColumns: '300px minmax(0, 1fr)' }}>
      <Card fill title="Talent" icon={I.talent} bodyClass="overflow-y-auto p-2.5" actions={<span className="text-[12.5px] text-white/45">drag onto a slot</span>}>
        {talent.length === 0 && <Empty>Add talent first.</Empty>}
        <div className="space-y-1.5">
          {talent.map(t => (
            <div key={t.id} draggable onDragStart={e => { e.dataTransfer?.setData('text/talent', t.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; setDrag(t.id); }} onDragEnd={() => setDrag(null)}
              className="flex cursor-grab items-center gap-2.5 rounded-[8px] border px-2.5 py-2 active:cursor-grabbing" style={{ borderColor: drag === t.id ? S.accent : S.line, background: S.raised }} data-drag-talent={t.id}>
              <span className="text-white/35">{I.drag}</span><Avatar t={t} size={30} />
              <div className="min-w-0 flex-1"><div className="truncate text-[14.5px] font-semibold">{talentLabel(t)}</div><div className="text-[12px] text-white/45">{roleLabel(t.role)} · {t.seat ? seatShort(t.seat) : 'no position'}</div></div>
            </div>
          ))}
        </div>
      </Card>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        {desks.map(dk => (
          <Card key={dk.id} title={dk.label} icon={I.grid} bodyClass="p-4" data-desk={dk.id}
            actions={<span className="flex items-center gap-1.5">
              {dk.gfx && dk.presets.map(p => <Btn key={p.label} size="sm" active={p.on} onClick={() => gset(dk.gfx!, p.patch, `${dk.label}: ${p.label} (prepared)`)} data-desk-preset={p.label}>{p.label}</Btn>)}
              {dk.gfx && dk.draft && <Btn size="sm" kind="draft" onClick={() => run({ c: 'gfx-publish', id: dk.gfx! }, `${dk.label} layout published`)} data-desk-publish={dk.gfx}>Publish layout</Btn>}
            </span>}>
            <div className="relative mx-auto aspect-[16/6] w-full max-w-[980px] overflow-hidden rounded-[10px] border" style={{ borderColor: S.line, background: 'linear-gradient(180deg,#1a0d0a,#0b0b0e)' }}>
              <span className={`${COND} absolute left-3 top-2 text-[12px] tracking-[0.16em] text-white/35`}>{dk.label} · {dk.slots.length === 1 ? 'solo' : dk.slots.length === 2 ? 'duo' : 'trio'}{dk.draft ? ' · prepared, not published' : ''}</span>
              {dk.slots.map(sl => {
                const t = seatOf(sl.seat), w = dk.slots.length === 1 ? 38 : dk.slots.length === 2 ? 34 : 27;
                return (
                  <div key={`${sl.seat}-${sl.label}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop(sl.seat)}
                    className="absolute top-[14%] flex flex-col overflow-hidden rounded-[8px] border-2 transition" style={{ left: `${sl.x - w / 2}%`, width: `${w}%`, height: '78%', borderColor: drag ? S.accent : t ? 'rgba(255,255,255,.25)' : 'rgba(245,165,36,.55)', borderStyle: t ? 'solid' : 'dashed', background: '#000' }} data-slot={sl.seat}>
                    <div className="relative min-h-0 flex-1">
                      {t ? <Fit169 w={960} h={540} className="absolute inset-0"><TalentCam t={t} st={st} viewer={viewer} /></Fit169> : <div className="grid h-full place-items-center px-2 text-center text-[13px] text-white/45">Drop someone here<br /><span className="text-[11.5px] text-white/30">{SEAT_LABELS[sl.seat as Seat]}</span></div>}
                      <span className={`${COND} absolute left-1.5 top-1.5 rounded-[4px] bg-black/75 px-1.5 text-[11.5px] tracking-[0.1em]`}>{sl.label}</span>
                    </div>
                    <div className="flex flex-none items-center gap-1 bg-black/80 p-1">
                      <select aria-label={`${dk.label} ${sl.label}`} value={t?.id ?? ''} onChange={e => void assign(sl.seat, e.target.value || null)} className="h-[30px] min-w-0 flex-1 rounded-[5px] border bg-[#0a0a0d] px-1.5 text-[13px] outline-none" style={{ borderColor: S.line2 }}>
                        <option value="">— empty —</option>
                        {talent.map(x => <option key={x.id} value={x.id}>{talentLabel(x)}{x.seat && x.seat !== sl.seat ? ' (swap)' : ''}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            {dk.slots.length > 1 && <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
              {dk.slots.slice(0, -1).map((a, i) => { const b = dk.slots[i + 1], ta = seatOf(a.seat), tb = seatOf(b.seat); return (
                <Btn key={a.seat} size="sm" kind="ghost" disabled={(!ta && !tb) || a.seat === b.seat} onClick={() => (ta ? assign(b.seat, ta.id) : assign(a.seat, tb!.id))} data-swap={`${a.seat}-${b.seat}`}>⇄ Swap {a.label.toLowerCase()} / {b.label.toLowerCase()}</Btn>
              ); })}
            </div>}
            <p className="mt-2 text-[12.5px] text-white/45">{dk.note} Assigning or swapping a person is immediate (their camera and voice move with them, nobody reconnects); a layout change is prepared and goes out with Publish.</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ===================================================================================================== GREEN ROOM
function GreenRoom({ st, run, viewer, talent, issues, onAdd }: { st: ControllerState; run: Run; viewer: RtcViewer | null; talent: T[]; issues: TalentIssue[]; onAdd: () => void }) {
  const [big, setBig] = useState<string | null>(null);
  const bt = talent.find(t => t.id === big);
  const list = [...talent].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5" data-green-room>
      <div className="flex flex-none items-center gap-3 rounded-[8px] border px-4 py-2.5 text-[13.5px]" style={{ borderColor: 'rgba(47,191,113,.35)', background: 'rgba(47,191,113,.06)' }}>
        <Pill tone="ok">Private</Pill>
        <span className="text-white/70">Green Room previews are only in this console: low-bitrate monitor feeds, never on Preview or Program. Check everyone, then mark them ready.</span>
        <Btn size="sm" className="ml-auto" onClick={() => talent.filter(t => t.seat && !t.ready).forEach(t => void run({ c: 'talent-edit', id: t.id, ready: true }, `${talentLabel(t)} ready`))} disabled={!talent.some(t => t.seat && !t.ready)}>Mark all in the show ready</Btn>
      </div>
      {list.length === 0 ? <Card fill><Empty action={<Btn kind="accent" onClick={onAdd} icon={I.plus}>Add talent</Btn>}>Nobody to check yet.</Empty></Card> : (
        <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gridAutoRows: 'max-content' }}>
          {list.map(t => {
            const mine = issues.filter(i => i.talent === t.id), cam = camState(t), tone = toneOf(issues, t.id), path = st.audio?.talent?.[t.id];
            return (
              <div key={t.id} className="overflow-hidden rounded-[10px] border" style={{ background: S.panel, borderColor: t.ready ? 'rgba(47,191,113,.55)' : S.line }} data-green={t.id}>
                <div className="relative cursor-zoom-in" onClick={() => setBig(t.id)}>
                  <Fit169 w={960} h={540} className="aspect-video w-full bg-black"><TalentCam t={t} st={st} viewer={viewer} /></Fit169>
                  <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center gap-1.5">
                    <span className={`${COND} rounded-[4px] bg-black/75 px-1.5 py-0.5 text-[12px] tracking-[0.1em]`} style={{ color: ROLE_TONE[t.role] }}>{roleLabel(t.role)}</span>
                    <span className={`${COND} rounded-[4px] bg-black/75 px-1.5 py-0.5 text-[12px] tracking-[0.1em]`}>{t.seat ? seatShort(t.seat) : 'Standby'}</span>
                    {t.ready && <span className={`${COND} ml-auto rounded-[4px] px-1.5 py-0.5 text-[12px] tracking-[0.1em]`} style={{ background: S.ok, color: '#04140b' }}>Ready</span>}
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2.5"><Avatar t={t} size={34} /><div className="min-w-0 flex-1"><div className="truncate text-[16px] font-semibold">{talentLabel(t)}</div>
                    <div className="flex gap-3 text-[12.5px]"><span style={{ color: toneColor(cam.tone) }}>● {cam.text}</span><span className="text-white/50">Voice: {t.audio.source === 'feed' ? 'camera link' : t.audio.source === 'obs' ? t.audio.input || 'OBS input' : 'none'}</span></div></div>
                    <IconBtn title={t.audio.muted ? 'Unmute' : 'Mute'} active={t.audio.muted} onClick={() => run({ c: 'talent-edit', id: t.id, audio: { muted: !t.audio.muted } }, `${talentLabel(t)} ${t.audio.muted ? 'unmuted' : 'muted'}`)}>{t.audio.muted ? <span className="text-[12px] font-bold" style={{ color: S.bad }}>M</span> : I.mic}</IconBtn></div>
                  <Meter id={t.id} muted={t.audio.muted || st.audio?.master} h={8} />
                  <div className="grid grid-cols-3 gap-2 text-[12px]">
                    <Stat label="Connection" value={t.mode === 'vdo' ? (t.vdoSet ? 'VDO.Ninja' : 'no link') : t.publishing ? 'live' : t.online ? 'no camera' : 'offline'} tone={cam.tone === 'info' ? 'ok' : cam.tone} />
                    <Stat label="Sync offset" value={`${t.audio.syncMs} ms`} tone={t.audio.syncMs ? 'info' : 'dim'} />
                    <Stat label="OBS audio" value={!st.audio?.obs ? 'OBS offline' : !path ? (t.seat ? '—' : 'standby') : !path.exists ? 'missing' : path.muted ? 'muted' : 'live'} tone={!path ? 'dim' : !path.exists ? 'bad' : path.muted ? 'warn' : 'ok'} />
                  </div>
                  <div className="min-h-[38px] space-y-1">
                    {mine.filter(i => i.code !== 'not-ready').slice(0, 2).map((i, n) => <div key={n} className="truncate text-[12.5px]" style={{ color: toneColor(i.tone) }} title={`${i.text}${i.fix ? ` → ${i.fix}` : ''}`}>● {i.text.replace(`${talentLabel(t)}: `, '')}</div>)}
                    {!mine.some(i => i.code !== 'not-ready') && <div className="text-[12.5px]" style={{ color: tone === 'ok' || tone === 'info' ? S.ok : S.dim }}>✓ No problems detected</div>}
                  </div>
                  <Btn className="w-full" kind={t.ready ? 'go' : 'default'} onClick={() => run({ c: 'talent-edit', id: t.id, ready: !t.ready }, `${talentLabel(t)} ${t.ready ? 'not ready' : 'ready'}`)} data-ready={t.id}>{t.ready ? '✓ Ready' : 'Mark ready'}</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {bt && <LargeView title={<>{talentLabel(bt)} <span className="text-white/45">· Green Room (private)</span></>} onClose={() => setBig(null)}><div className="absolute inset-0 bg-black"><TalentCam t={bt} st={st} viewer={viewer} big /></div></LargeView>}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'dim' | 'info' }) {
  return <div className="rounded-[6px] bg-white/[0.04] px-2 py-1.5"><div className="text-[11px] uppercase tracking-[0.1em] text-white/40">{label}</div><div className="truncate text-[13px] font-semibold" style={{ color: tone === 'dim' ? 'rgba(255,255,255,.7)' : toneColor(tone) }}>{value}</div></div>;
}

// ===================================================================================================== AUDIO
function AudioMixer({ st, run, talent }: { st: ControllerState; run: Run; talent: T[] }) {
  const voices = talent.filter(t => t.audio.source !== 'none').sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  const issues = st.audio?.issues ?? [];
  return (
    <div className="grid h-full min-h-0 gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }} data-audio-mixer>
      <Card fill title="Talent voices" icon={I.audio} bodyClass="overflow-x-auto overflow-y-hidden p-3"
        actions={<><Pill tone={st.audio?.obs ? 'ok' : 'warn'}>{st.audio?.obs ? 'OBS connected' : 'OBS offline'}</Pill><Btn size="sm" onClick={() => run({ c: 'audio-apply' }, 'Apply talent audio to OBS')} disabled={!st.audio?.obs} data-audio-apply="">Apply to OBS</Btn></>}>
        {voices.length === 0 ? <Empty>No voices yet: add talent, their audio comes from their camera link by default.</Empty> : (
          <div className="flex h-full min-h-[380px] gap-2.5">
            {voices.map(t => <Strip key={t.id} t={t} st={st} run={run} />)}
            <div className="mx-1 w-px flex-none bg-white/10" />
            <div className="flex w-[130px] flex-none flex-col items-center justify-end gap-2 rounded-[8px] border p-3" style={{ borderColor: S.line, background: S.raised }}>
              <span className={`${COND} text-[13px] tracking-[0.12em] text-white/60`}>Master</span>
              <Btn kind={st.audio?.master ? 'pgm' : 'default'} className="w-full" onClick={() => run({ c: 'audio-master', muted: !st.audio?.master }, st.audio?.master ? 'Talent voices back on' : 'Mute every talent voice')}>{st.audio?.master ? 'Muted' : 'Mute all'}</Btn>
              <span className="text-center text-[11.5px] text-white/40">every talent voice, in OBS</span>
            </div>
          </div>
        )}
      </Card>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Card title="Audio health" icon={I.warn} bodyClass="p-4 space-y-2">
          {issues.length === 0 ? <div className="text-[13.5px]" style={{ color: st.audio?.obs ? S.ok : S.dim }}>{st.audio?.obs ? '✓ Every voice reaches OBS once, nothing muted by hand, no echo risk.' : 'Connect OBS (Settings) to control and check talent audio.'}</div>
            : issues.map((i, n) => <div key={n} className="text-[13.5px]"><span style={{ color: toneColor(i.tone) }}>● </span><span className="text-white/85">{i.text}</span>{i.fix && <div className="pl-4 text-[12.5px] text-white/50">→ {i.fix}</div>}</div>)}
        </Card>
        <Card title="How talent audio is routed" icon={I.audio} bodyClass="p-4 space-y-2 text-[13px] leading-relaxed text-white/60">
          <p>Each person has one voice path that never reloads when scenes change: their position's <b className="text-white/80">Overdrive Caster N audio</b> source (in the shared “Overdrive · Caster audio” scene, nested in every Overdrive scene), or an OBS input you pick (Discord / desktop capture, a microphone, an interface or mixer channel).</p>
          <p>Overdrive sets that input's fader, mute, sync offset and monitoring in OBS, silences empty positions, silences someone's camera-link audio when their voice comes from another input (never heard twice), and mutes the input of anyone not in a position (no off-air chatter on stream).</p>
          <p>What goes to the stream, the recording and the monitoring device is OBS's own audio mixer and output settings. OBS has no talkback / caster-return bus: use Discord or VDO.Ninja for talkback, and keep that out of OBS.</p>
        </Card>
      </div>
    </div>
  );
}

function Strip({ t, st, run }: { t: T; st: ControllerState; run: Run }) {
  const set = (a: Partial<TalentAudio>, label: string) => run({ c: 'talent-edit', id: t.id, audio: a }, `${talentLabel(t)}: ${label}`);
  const [v, setV] = useState<number | null>(null);
  const path = st.audio?.talent?.[t.id];
  const db = v != null ? faderToDb(v) : t.audio.volumeDb;
  return (
    <div className="flex w-[132px] flex-none flex-col items-center gap-2 rounded-[8px] border p-2.5" style={{ borderColor: t.audio.muted ? 'rgba(229,72,77,.5)' : S.line, background: S.raised }} data-strip={t.id}>
      <Avatar t={t} size={34} />
      <div className="w-full truncate text-center text-[13.5px] font-semibold" title={talentLabel(t)}>{talentLabel(t)}</div>
      <div className="w-full truncate text-center text-[11px] text-white/45" title={path?.input ?? ''}>{t.seat ? seatShort(t.seat) : 'standby'}</div>
      <div className="flex min-h-[150px] w-full flex-1 items-stretch justify-center gap-3">
        <Meter id={t.id} vertical h={10} muted={t.audio.muted || st.audio?.master} />
        <input type="range" aria-label={`Fader ${talentLabel(t)}`} min={0} max={1} step={0.005} value={v ?? dbToFader(t.audio.volumeDb)} onChange={e => setV(Number(e.target.value))}
          onPointerUp={() => { if (v != null) void set({ volumeDb: faderToDb(v) }, `fader ${faderToDb(v)} dB`); setV(null); }}
          className="accent-[#ff3b1f]" style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 28 }} />
      </div>
      <span className="font-mono text-[12.5px] text-white/70">{db > 0 ? '+' : ''}{db.toFixed(1)} dB</span>
      <Btn size="sm" className="w-full" kind={t.audio.muted ? 'pgm' : 'default'} onClick={() => set({ muted: !t.audio.muted }, t.audio.muted ? 'unmuted' : 'muted')} data-strip-mute={t.id}>{t.audio.muted ? 'Muted' : 'Mute'}</Btn>
      <Btn size="sm" className="w-full" active={t.audio.monitor} onClick={() => set({ monitor: !t.audio.monitor }, t.audio.monitor ? 'not monitored' : 'monitored')} title="OBS audio monitoring">Monitor</Btn>
      <label className="flex w-full items-center gap-1 text-[11.5px] text-white/50">Sync<input aria-label={`Sync ${talentLabel(t)}`} type="number" defaultValue={t.audio.syncMs} key={t.audio.syncMs} onBlur={e => { const n = Number(e.target.value) || 0; if (n !== t.audio.syncMs) void set({ syncMs: n }, `sync ${n} ms`); }} className="h-[28px] w-full min-w-0 rounded-[5px] border bg-[#0a0a0d] px-1.5 text-right font-mono text-[12px] outline-none" style={{ borderColor: S.line2 }} />ms</label>
      <span className="w-full truncate text-center text-[11px]" style={{ color: !path ? 'rgba(255,255,255,.35)' : !path.exists ? S.bad : 'rgba(255,255,255,.45)' }} title={path?.input}>{t.audio.source === 'obs' ? t.audio.input || 'choose input' : 'camera link'}</span>
    </div>
  );
}

// Re-exported for the Producer console's compact talent strip.
export { AudioControls, Avatar, camState, TalentCam };
export function seatLabelShort(s: number) { return seatShort(s); }
export const cropOf = cropStyle;

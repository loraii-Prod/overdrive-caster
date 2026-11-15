/**
 * Studio Mode 2.0 · TALENT & CAMERA MANAGER. The 10 talent profiles (casters, analysts, hosts), how each
 * camera reaches the show (Overdrive app or a pasted VDO.Ninja link), camera positions with live feed
 * previews, and the duo / trio layouts of the desks.
 * Renaming or moving someone between positions re-routes their camera on the server: nobody reconnects.
 * Layout changes are prepared (Draft) like everywhere else and go out with Publish.
 */
import { useEffect, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { EngineState } from '../../../shared/engine';
import { SEAT_LABELS, talentLabel, type CamQuality, type Seat } from '../../../shared/talent';
import { vdoCasterPushUrl } from '../../../shared/players';
import { Feed } from '../../components/Feed';
import { VdoContext } from '../../lib/vdo';
import type { RtcViewer } from '../../lib/rtcViewer';
import type { Run } from '../producer/modules';
import { COND, Card, Fit169, I, IconBtn, Input, LargeView, Pill, S, Seg, Select, copy } from './kit';
import { SEAT_GROUPS } from './model';

type T = NonNullable<ControllerState['talent']>[number];
const statusOf = (t?: T): { tone: 'ok' | 'warn' | 'dim' | 'info'; text: string } => !t ? { tone: 'dim', text: 'Empty' } : t.mode === 'vdo' ? { tone: 'info', text: 'VDO.Ninja' } : t.publishing ? { tone: 'ok', text: t.hasAudio ? 'Live · cam + mic' : 'Live · cam' } : t.online ? { tone: 'warn', text: 'Online · no camera' } : { tone: 'dim', text: 'Offline' };

export function TalentManager({ st, eng, run, viewer, setCams }: { st: ControllerState; eng: EngineState; run: Run; viewer: RtcViewer | null; setCams: (ids: number[]) => void }) {
  useEffect(() => { setCams([1, 2, 3, 4, 5, 6]); return () => setCams([]); }, [setCams]);
  const talent = st.talent ?? [];
  const at = (s: number) => talent.find(t => t.id === st.seats?.[s as Seat]);
  const talentLink = (t: T) => `${location.origin}/talent/${t.id}?key=${encodeURIComponent(t.key)}`;
  const vdoPush = (t: T) => vdoCasterPushUrl(t.vdoId, t.name, st.showLive.vdo.password, st.showLive.vdo.room, t.camQuality);
  const seatOpts: [string, string][] = [['', 'No position'], ...([1, 2, 3, 4, 5, 6] as Seat[]).map(s => [String(s), `${SEAT_LABELS[s]}${at(s) ? ` · ${talentLabel(at(s))}` : ''}`] as [string, string])];
  const live = talent.filter(t => t.seat && (t.mode === 'vdo' || t.publishing)).length, seated = talent.filter(t => t.seat).length;
  const [big, setBig] = useState<Seat | null>(null);
  const vdoCtx = { password: st.showLive.vdo.password, params: st.showLive.vdo.params, embeds: false, monitorFeeds: true };

  return (
    <div className="grid h-full min-h-0 gap-3" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(420px, 1fr)' }} data-talent-manager>
      <Card fill title={`Talent · ${talent.length} profiles`} icon={I.talent} bodyClass="overflow-y-auto"
        actions={<><Pill tone={live === seated && seated ? 'ok' : 'warn'}>{live}/{seated} cameras live</Pill></>}>
        <div className="divide-y" style={{ borderColor: S.line }}>
          {talent.map(t => {
            const s = statusOf(t);
            return (
              <div key={t.id} data-talent-row={t.id} className="space-y-2.5 px-4 py-3.5" style={{ borderColor: S.line }}>
                <div className="grid items-center gap-2.5" style={{ gridTemplateColumns: '44px minmax(140px,1.2fr) 140px minmax(160px,1fr) 150px' }}>
                  <span className="grid h-[36px] place-items-center rounded-[6px] bg-white/[0.06] font-mono text-[13px] text-white/60">{t.id.toUpperCase()}</span>
                  <Input ariaLabel={`Name ${t.id}`} value={t.name} placeholder="Name needed" warn={!t.name.trim()} onCommit={v => run({ c: 'talent-edit', id: t.id, name: v }, `Rename ${t.id}`)} />
                  <Select ariaLabel={`Role of ${t.id}`} value={t.role} options={[['caster', 'Caster / host'], ['analyst', 'Analyst']]} className="text-[13.5px]" onChange={v => run({ c: 'talent-edit', id: t.id, role: v as 'caster' }, `${t.id} role ${v}`)} />
                  <Select ariaLabel={`Position of ${t.id}`} value={t.seat ? String(t.seat) : ''} options={seatOpts}
                    onChange={v => run(v ? { c: 'seat', seat: Number(v), talent: t.id } : { c: 'seat', seat: t.seat!, talent: null }, v ? `${talentLabel(t)} → ${SEAT_LABELS[Number(v) as Seat]}` : `${talentLabel(t)} off position`)} />
                  <span className="flex justify-end"><Pill tone={s.tone === 'info' ? 'info' : s.tone}>{s.text}</Pill></span>
                </div>
                <div className="grid items-center gap-2.5" style={{ gridTemplateColumns: '44px auto minmax(200px,1fr) auto auto' }}>
                  <span />
                  <Seg size="sm" value={t.mode} options={[['webrtc', 'App'], ['vdo', 'VDO.Ninja']]} onChange={v => run({ c: 'talent-edit', id: t.id, mode: v }, `${t.id} camera via ${v}`)} />
                  {t.mode === 'vdo'
                    ? <Input ariaLabel={`VDO.Ninja link of ${t.id}`} mono value={t.vdoId} placeholder="Paste a VDO.Ninja link (push= or view=)" onCommit={v => run({ c: 'talent-edit', id: t.id, vdoId: v }, `${talentLabel(t)}: VDO.Ninja stream`)} />
                    : <span className="truncate text-[13px] text-white/45">Personal link: camera + mic in the browser, no install.</span>}
                  <Seg size="sm" value={t.camQuality ?? '720p'} options={[['720p', '720p'], ['1080p', '1080p']]} onChange={v => run({ c: 'talent-edit', id: t.id, camQuality: v as CamQuality }, `${t.id} camera ${v}`)} />
                  <div className="flex items-center gap-1.5">
                    <IconBtn title={`Copy ${talentLabel(t)}'s personal link`} onClick={() => copy(talentLink(t))}>{I.link}</IconBtn>
                    <IconBtn title="Copy their VDO.Ninja push link (camera via VDO.Ninja)" onClick={() => copy(vdoPush(t))}>{I.copy}</IconBtn>
                    <IconBtn title="New personal link (the old one stops working)" onClick={() => { if (confirm(`Give ${talentLabel(t)} a new link? The old one stops working at once.`)) run({ c: 'talent-regen', id: t.id }, `New link for ${t.id}`); }}>{I.refresh}</IconBtn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <Card title="Camera positions" icon={I.cam} bodyClass="p-3" actions={<span className="text-[13px] text-white/45">Low-bitrate previews</span>}>
          <VdoContext.Provider value={vdoCtx}>
            {SEAT_GROUPS.map(g => (
              <div key={g.label} className="mb-3 last:mb-0">
                <div className={`${COND} mb-2 text-[12.5px] tracking-[0.14em] text-white/50`}>{g.label}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${g.seats.length === 1 ? 2 : g.seats.length}, minmax(0, 1fr))` }}>
                  {g.seats.map(s => <SeatTile key={s} s={s} st={st} run={run} viewer={viewer} t={at(s)} onLarge={() => setBig(s)} />)}
                </div>
              </div>
            ))}
          </VdoContext.Provider>
        </Card>
        <Layouts st={st} eng={eng} run={run} />
      </div>
      {big && st.live.casters[big - 1] && (
        <LargeView title={<>{SEAT_LABELS[big]} · {talentLabel(at(big))} <span className="text-white/45">· {statusOf(at(big)).text}</span></>} onClose={() => setBig(null)}>
          <VdoContext.Provider value={vdoCtx}><div className="absolute inset-0 bg-black" data-large-camera={big}><Feed caster={st.live.casters[big - 1]} viewer={viewer} size="lg" showName={false} monitor /></div></VdoContext.Provider>
        </LargeView>
      )}
    </div>
  );
}

function SeatTile({ s, st, run, viewer, t, onLarge }: { s: Seat; st: ControllerState; run: Run; viewer: RtcViewer | null; t?: T; onLarge: () => void }) {
  const caster = st.live.casters[s - 1], pv = st.preview.casters[s - 1], cs = st.contributors[s as 1];
  const status = statusOf(t);
  const talent = st.talent ?? [];
  return (
    <div className="min-w-0 rounded-[8px] border" style={{ borderColor: S.line, background: S.raised }} data-seat-tile={s}>
      <div className="relative cursor-zoom-in" onClick={onLarge} title="Large view">
        <Fit169 w={960} h={540} className="aspect-video w-full rounded-t-[8px] bg-black">{caster && <Feed caster={caster} viewer={viewer} size="sm" showName={false} monitor />}</Fit169>
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5">
          <span className={`${COND} whitespace-nowrap rounded-[4px] bg-black/75 px-1.5 py-0.5 text-[12px] tracking-[0.1em]`} title={SEAT_LABELS[s]}>{SEAT_LABELS[s].split(' · ')[0]}</span>
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1">
          <span className="truncate rounded-[4px] bg-black/75 px-1.5 py-0.5 text-[13px] font-semibold">{t ? talentLabel(t) : '—'}</span>
          <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: status.tone === 'ok' || status.tone === 'info' ? S.ok : status.tone === 'warn' ? S.warn : 'rgba(255,255,255,.3)' }} title={status.text} />
        </div>
      </div>
      <div className="space-y-2 p-2">
        <Select ariaLabel={`Talent in ${SEAT_LABELS[s]}`} value={t?.id ?? ''} options={[['', '— empty —'], ...talent.map(p => [p.id, `${talentLabel(p)}${p.seat && p.seat !== s ? ` (swap from ${p.seat})` : ''}`] as [string, string])]}
          onChange={v => run({ c: 'seat', seat: s, talent: v || null }, `${SEAT_LABELS[s]}: ${v || 'empty'}`)} />
        <div className="flex items-center gap-1.5">
          <Seg size="sm" value={pv?.cameraOn ? 'on' : 'off'} options={[['on', 'Cam'], ['off', 'Off']]} onChange={v => run({ c: 'camera', seat: s, on: v === 'on' }, `Camera ${s} ${v} (prepared)`)} />
          <span className="min-w-0 flex-1 truncate text-right text-[12px] text-white/45" title="Sources viewing this camera">{cs?.publishing ? `${cs.viewers}×` : ''}</span>
          <IconBtn title="Re-sync this feed for every source (the talent does nothing)" onClick={() => run({ c: 'feed-resync', seat: s }, `Re-sync camera ${s}`)}>{I.refresh}</IconBtn>
        </div>
      </div>
    </div>
  );
}

/** Duo / trio layouts of the desks (prepared: Publish sends them). Same commands as Producer's talent modules. */
function Layouts({ st, eng, run }: { st: ControllerState; eng: EngineState; run: Run }) {
  const booth = eng.stage.booth.length ? eng.stage.booth : [1, 2, 3].filter(s => st.preview.casters[s - 1]?.enabled);
  const desk = eng.stage.desk.slots.length ? eng.stage.desk.slots : [4, 5];
  const filled = (seats: number[]) => seats.filter(s => st.seats?.[s as Seat]);
  const pick = (seats: number[], n: number) => { const f = filled(seats); return [...f, ...seats.filter(s => !f.includes(s))].slice(0, n).sort(); };
  const Preset = ({ n, on, label, onClick }: { n: number; on: boolean; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} aria-pressed={on} className="flex flex-col items-center gap-2 rounded-[8px] border p-3 transition hover:border-white/35" style={{ borderColor: on ? S.accent : S.line, background: on ? S.accentSoft : 'rgba(255,255,255,.02)' }} data-layout-preset={label}>
      <span className="flex h-[38px] items-end gap-1.5">{Array.from({ length: n }, (_, i) => <span key={i} className="flex flex-col items-center"><span className="h-[13px] w-[13px] rounded-full bg-white/45" /><span className="mt-0.5 h-[16px] w-[24px] rounded-t-[10px] bg-white/30" /></span>)}</span>
      <span className={`${COND} text-[13.5px] tracking-[0.08em]`}>{label}</span>
    </button>
  );
  return (
    <Card title="Layout presets" icon={I.grid} bodyClass="p-3 space-y-3" actions={<Pill tone="warn">Prepared · Publish</Pill>}>
      <div><div className={`${COND} mb-2 text-[12.5px] tracking-[0.14em] text-white/50`}>Caster desk</div>
        <div className="grid grid-cols-3 gap-2">{([[1, '1 Caster'], [2, 'Duo'], [3, 'Trio']] as const).map(([n, l]) => <Preset key={n} n={n} label={l} on={booth.length === n} onClick={() => run({ c: 'stage-booth', ids: pick([1, 2, 3], n) }, `Caster desk: ${l}`)} />)}</div></div>
      <div><div className={`${COND} mb-2 text-[12.5px] tracking-[0.14em] text-white/50`}>Analyst desk</div>
        <div className="grid grid-cols-3 gap-2">{([[1, 'Solo analyst'], [2, 'Analyst duo']] as const).map(([n, l]) => <Preset key={n} n={n} label={l} on={desk.length === n} onClick={() => run({ c: 'stage-desk', analysts: pick([4, 5], n) }, `Analyst desk: ${l}`)} />)}
          <Preset n={3} label="Desk + caster" on={!!eng.stage.desk.guest} onClick={() => run({ c: 'stage-desk', guest: eng.stage.desk.guest ? null : (filled([1, 2, 3])[0] ?? 1) }, eng.stage.desk.guest ? 'Caster leaves the desk' : 'A caster joins the desk')} /></div></div>
      <p className="text-[12.5px] text-white/45">Layouts are prepared like every desk change: the preview shows them, Publish (inspector) sends them to the desk sources.</p>
    </Card>
  );
}

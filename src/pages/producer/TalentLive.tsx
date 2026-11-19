/**
 * Overdrive 3.0 · Producer Mode TALENT panel (shares the Rundown column: Rundown | Talent).
 * Compact live controls for the people in the show: camera thumbnail, name, connection, voice meter, mute, fader,
 * camera on / off, quick replacement, and the desk layouts. Setup (links, framing, audio paths) stays in Studio.
 */
import { useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { EngineState } from '../../../shared/engine';
import { SEATS, SEAT_LABELS, inUse, talentLabel, type Seat } from '../../../shared/talent';
import { checkTalent, toneOf } from '../../../shared/talentCheck';
import { dbToFader, faderToDb } from '../../../shared/audio';
import type { RtcViewer } from '../../lib/rtcViewer';
import { VdoContext } from '../../lib/vdo';
import { Fit169 } from '../studio/kit';
import { Meter, TalentCam, camState, deskSlots, neededSeats } from '../studio/Talent';
import type { Run } from './modules';
import { B, C, LABEL, PanelHead } from './ws';

type T = NonNullable<ControllerState['talent']>[number];
const tone = (t: string) => (t === 'ok' ? C.ok : t === 'warn' ? C.draft : t === 'bad' ? C.in : t === 'info' ? '#4c8dff' : C.faint);

export function TalentLive({ st, eng, run, viewer }: { st: ControllerState; eng: EngineState; run: Run; viewer: RtcViewer | null }) {
  const talent = (st.talent ?? []).filter(t => inUse(t, !!t.seat));
  const seated = SEATS.map(s => ({ s, t: talent.find(x => x.id === st.seats?.[s]) })).filter(x => x.t) as { s: Seat; t: T }[];
  const issues = checkTalent({ talent, seats: st.seats ?? ({} as never), audio: st.audio, needed: neededSeats(st) });
  const d = deskSlots(st);
  const master = st.audio?.master === true;
  const vdoCtx = { password: st.showLive.vdo.password, params: st.showLive.vdo.params, embeds: false, monitorFeeds: true };
  const layout = (id: string, patch: Record<string, string>, label: string) => run({ c: 'gfx-set', id, patch }, `${label} (prepared)`);
  void eng;
  return (
    <VdoContext.Provider value={vdoCtx}>
      <div className="flex min-h-0 flex-col" style={{ background: C.panel }} data-talent-live>
        <PanelHead label="Talent" info={`${seated.length} in the show · ${issues.filter(i => i.tone === 'bad').length} to fix`}>
          <B h={22} kind={master ? 'in' : 'default'} active={master} onClick={() => run({ c: 'audio-master', muted: !master }, master ? 'Talent voices back on' : 'Mute every talent voice')} title="Mute / unmute every talent voice in OBS" data-live-master>{master ? 'Talent muted' : 'Mute all'}</B>
        </PanelHead>
        <div className="flex flex-none flex-wrap items-center gap-1 border-b px-1.5 py-1" style={{ borderColor: C.line }}>
          {d.hasCaster && <><span className={`${LABEL} text-[11px] text-white/40`}>Casters</span>
            {(['auto', 'solo', 'duo', 'trio'] as const).map(v => <B key={v} h={20} active={d.casterLayout === v} onClick={() => layout('caster-desk', { layout: v }, `Caster desk ${v}`)} data-live-layout={`caster-${v}`}>{v}</B>)}</>}
          {d.hasAnalyst && <><span className={`${LABEL} ml-1.5 text-[11px] text-white/40`}>Desk</span>
            <B h={20} active={d.analystLayout === 'solo' && !d.guest} onClick={() => layout('analyst-desk', { layout: 'solo', guest: 'none' }, 'Analyst desk solo')}>solo</B>
            <B h={20} active={d.analystLayout === 'duo' && !d.guest} onClick={() => layout('analyst-desk', { layout: 'duo', guest: 'none' }, 'Analyst desk duo')}>duo</B>
            <B h={20} active={!!d.guest} onClick={() => layout('analyst-desk', { layout: 'duo', guest: String([1, 2, 3].find(s => talent.find(t => t.id === st.seats?.[s as Seat])?.role === 'host') ?? [1, 2, 3].find(s => st.seats?.[s as Seat]) ?? 1) }, 'Analyst desk with host')}>+host</B></>}
          {(d.casterDraft || d.analystDraft) && <B h={20} kind="primary" onClick={async () => { if (d.casterDraft) await run({ c: 'gfx-publish', id: 'caster-desk' }, 'Caster desk layout'); if (d.analystDraft) await run({ c: 'gfx-publish', id: 'analyst-desk' }, 'Analyst desk layout'); }} data-live-layout-publish>Publish layout</B>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {seated.length === 0 && <div className="p-3 text-[12px] text-white/45">Nobody in a position. Studio → Talent → Add talent.</div>}
          {seated.map(({ s, t }) => <Row key={s} s={s} t={t} st={st} run={run} viewer={viewer} talent={talent} dot={tone(toneOf(issues, t.id))} />)}
        </div>
      </div>
    </VdoContext.Provider>
  );
}

function Row({ s, t, st, run, viewer, talent, dot }: { s: Seat; t: T; st: ControllerState; run: Run; viewer: RtcViewer | null; talent: T[]; dot: string }) {
  const [v, setV] = useState<number | null>(null);
  const cam = camState(t), pv = st.preview.casters[s - 1], camOn = pv?.cameraOn !== false;
  const name = talentLabel(t);
  return (
    <div className="flex items-center gap-2 border-b px-1.5 py-1.5" style={{ borderColor: C.line }} data-live-talent={t.id}>
      <div className="relative w-[88px] flex-none overflow-hidden rounded-[2px]"><Fit169 w={960} h={540} className="aspect-video w-full bg-black"><TalentCam t={t} st={st} viewer={viewer} /></Fit169>
        <span className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full" style={{ background: dot }} /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span className={`${LABEL} text-[11px] text-white/45`}>{SEAT_LABELS[s].split(' · ')[0]}</span>
          <select aria-label={`Replace ${name}`} value={t.id} onChange={e => run({ c: 'seat', seat: s, talent: e.target.value || null }, e.target.value ? `${SEAT_LABELS[s]}: ${talentLabel(talent.find(x => x.id === e.target.value))}` : `${SEAT_LABELS[s]} cleared`)}
            className="h-[20px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1 text-[12.5px] font-semibold outline-none" title="Replace or swap (immediate)">
            <option value="">— empty —</option>
            {talent.map(x => <option key={x.id} value={x.id}>{talentLabel(x)}{x.seat && x.seat !== s ? ' (swap)' : ''}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]"><span style={{ color: cam.tone === 'ok' ? C.ok : cam.tone === 'info' ? '#4c8dff' : cam.tone === 'dim' ? C.faint : cam.tone === 'warn' ? C.draft : C.in }}>● {cam.text}</span>
          <span className="ml-auto font-mono text-white/50">{(v != null ? faderToDb(v) : t.audio.volumeDb).toFixed(1)} dB</span></div>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1"><Meter id={t.id} muted={t.audio.muted || st.audio?.master} h={5} /></div>
          <input type="range" aria-label={`Fader ${name}`} min={0} max={1} step={0.005} value={v ?? dbToFader(t.audio.volumeDb)} onChange={e => setV(Number(e.target.value))}
            onPointerUp={() => { if (v != null) void run({ c: 'talent-edit', id: t.id, audio: { volumeDb: faderToDb(v) } }, `${name}: fader ${faderToDb(v)} dB`); setV(null); }} className="h-[14px] w-[80px] accent-[#ff3b1f]" />
        </div>
      </div>
      <div className="flex flex-none flex-col gap-1">
        <B h={20} kind={t.audio.muted ? 'in' : 'default'} active={t.audio.muted} onClick={() => run({ c: 'talent-edit', id: t.id, audio: { muted: !t.audio.muted } }, `${name} ${t.audio.muted ? 'unmuted' : 'muted'}`)} data-live-mute={t.id}>{t.audio.muted ? 'Muted' : 'Mute'}</B>
        <B h={20} active={!camOn} onClick={() => run({ c: 'camera', seat: s, on: !camOn }, `Camera ${name} ${camOn ? 'off' : 'on'} (prepared)`)} title="Camera on / off (prepared: Publish)">{camOn ? 'Cam' : 'Cam off'}</B>
      </div>
    </div>
  );
}

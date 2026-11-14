import { useEffect, useRef, useState } from 'react';
import { vdoCasterPushUrl } from '../../shared/players';
import type { CamQuality } from '../../shared/talent';

/**
 * The caster's camera sent through VDO.Ninja, inside the caster page: a normal VDO.Ninja push link
 * (VDO's own camera / mic pickers and Start) in an embedded player, with this app's extras on top:
 * the ON AIR tally from the producer, mic mute and camera off (VDO.Ninja IFRAME API), reconnect,
 * and "open in its own tab" if the browser blocks the camera inside the page.
 */
export function VdoSender({ vdo, name, onAir, quality }: { vdo: { id: string; password: string; room?: string }; name: string; onAir: boolean; quality?: CamQuality }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true);
  const [viewers, setViewers] = useState(0);
  const room = vdo.room || '';
  const src = vdoCasterPushUrl(vdo.id, name, vdo.password, room, quality);
  const [spk, setSpk] = useState(true), [vol, setVol] = useState(1);
  const send = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(m, '*');

  // Producer / OBS views connecting and leaving (VDO.Ninja IFRAME events).
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return;
      const d = e.data as { action?: string; value?: unknown };
      if (d.action === 'view-connection') setViewers(n => Math.max(0, n + (d.value ? 1 : -1)));
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  return (
    <div className="mb-6">
      {room && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">Talent room · {room} <span className="normal-case tracking-normal text-white/35">(you see and hear the other casters here)</span></div>}
      <div className={`relative ${room ? 'h-[560px]' : 'aspect-video'} overflow-hidden rounded-lg border bg-[#1a1a1a] ${onAir ? 'border-[#e5484d] shadow-[0_0_0_2px_#e5484d]' : 'border-white/10'}`}>
        <iframe ref={frame} src={src} title="Camera (VDO.Ninja)" allow="camera; microphone; autoplay; fullscreen; display-capture" className="absolute inset-0 h-full w-full border-0" />
        <div className={`pointer-events-none absolute left-3 top-3 rounded px-2.5 py-1 text-xs font-bold tracking-[0.2em] ${onAir ? 'bg-[#e5484d] text-white' : 'bg-black/60 text-white/60'}`}>
          {onAir ? 'ON AIR' : 'STANDBY'}
        </div>
        {viewers > 0 && <div className="pointer-events-none absolute right-3 top-3 rounded bg-black/60 px-2.5 py-1 text-xs text-white/70">{viewers} receiving</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={`btn ${!mic ? '!border-[#e5484d] !bg-[#e5484d]/25' : ''}`} onClick={() => { send({ mic: !mic }); setMic(!mic); }}>{mic ? 'Mute mic' : 'Mic muted · unmute'}</button>
        <button type="button" className={`btn ${!cam ? '!border-[#e5484d] !bg-[#e5484d]/25' : ''}`} onClick={() => { send({ camera: !cam }); setCam(!cam); }}>{cam ? 'Camera off' : 'Camera off · turn on'}</button>
        {room && <button type="button" className={`btn ${!spk ? '!border-[#e5484d] !bg-[#e5484d]/25' : ''}`} onClick={() => { send({ mute: spk }); setSpk(!spk); }}>{spk ? 'Mute room' : 'Room muted · unmute'}</button>}
        {room && <input type="range" min={0} max={1} step={0.05} value={vol} title="Room volume" className="w-28" onChange={e => { const v = Number(e.target.value); setVol(v); send({ volume: v }); }} />}
        <button type="button" className="btn" onClick={() => { send({ reload: true }); setMic(true); setCam(true); setViewers(0); }}>Reconnect</button>
        <a className="btn" href={src} target="_blank" rel="noreferrer" title="If the camera doesn't start inside this page">Open in VDO.Ninja</a>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-white/40">
        Your camera goes through VDO.Ninja: pick your camera and mic in the box above and press Start there.{room ? ' You join the talent room: the other casters appear in the box and you hear them (wear headphones). Mute room only mutes what you hear.' : ''} The ON AIR tally and the buttons here come from the production.
      </p>
    </div>
  );
}

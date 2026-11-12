import { GameFeed } from '../components/GameFeed';
import { VdoSender } from '../components/VdoSender';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '../components/Brand';
import { RtcPublisher } from '../lib/rtcPublisher';
import { useConnState, useNow, useRos, useSocket, useWildcard, query } from '../lib/hooks';
import { MatchStrip } from '../components/MatchStrip';
import { RosView } from '../components/RosView';
import type { CasterId } from '../../shared/types';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

const QUALITIES = {
  '720': { width: 1280, height: 720 },
  '1080': { width: 1920, height: 1080 },
} as const;

/** /contribute/:slot?key=… — a remote caster sends their webcam (and optional mic). */
export function Contribute() {
  const params = useParams();
  const talent = typeof params.talent === 'string' ? params.talent : undefined; // 2.0 personal link /talent/:id
  const key = query().get('key') ?? '';
  const sock = useSocket(talent ? { role: 'contributor', talent, key } : { role: 'contributor', slot: Number(params.slot) as CasterId, key });
  // Position on the show: fixed for a slot link, follows the producer's assignment for a talent link.
  const slotOf = (seat: number | null | undefined) => (talent ? (seat ?? 0) : Number(params.slot)) as CasterId;
  const conn = useConnState(sock);
  const wc = useWildcard(sock);
  const pub = useMemo(() => new RtcPublisher(sock), [sock]);
  useEffect(() => () => pub.destroy(), [pub]);

  const ros = useRos(sock);
  const now = useNow(ros?.skew ?? 0, 500);
  const [info, setInfo] = useState<{ name: string; role: string; cameraVisible: boolean; vdo: { id: string; password: string; room: string } | null; talent: { id: number; name: string }[]; seat?: number | null } | null>(null);
  const slot = slotOf(info?.seat);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState(store.get('overdrive.cam'));
  const [micId, setMicId] = useState(store.get('overdrive.mic'));
  const [micOn, setMicOn] = useState(store.get('overdrive.micOn') === '1');
  const [quality, setQuality] = useState<keyof typeof QUALITIES>((store.get('overdrive.q') as '720') || '720');
  const [started, setStarted] = useState(false);
  const [viewers, setViewers] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { pub.onViewers = setViewers; }, [pub]);
  useEffect(() => sock.on(m => {
    if (m.t === 'caster-info') setInfo({ name: m.name, role: m.role, cameraVisible: m.cameraVisible, vdo: m.vdo ?? null, talent: m.talent ?? [], seat: m.seat });
    if (m.t === 'error') setError(m.message);
    if (m.t === 'welcome') setError('');
  }), [sock]);

  const refreshDevices = async () => {
    try { setDevices(await navigator.mediaDevices.enumerateDevices()); } catch {}
  };

  async function acquire() {
    setError('');
    try {
      const q = QUALITIES[quality];
      const next = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: camId ? { ideal: camId } : undefined, width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: 30 } },
        audio: micOn ? { deviceId: micId ? { ideal: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: false } : false,
      });
      const v = next.getVideoTracks()[0];
      if (v) {
        v.contentHint = 'motion';
        v.onended = () => { setError('Camera disconnected. Reconnecting…'); setTimeout(() => acquire(), 1500); };
      }
      const old = streamRef.current;
      streamRef.current = next;
      if (previewRef.current) previewRef.current.srcObject = next;
      await pub.setStream(next);
      old?.getTracks().forEach(t => t.stop());
      setStarted(true);
      refreshDevices();
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser and try again.' : `Could not start camera: ${e?.message ?? e}`);
    }
  }

  function stop() {
    pub.setStream(null);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStarted(false);
  }

  // Re-acquire when the user changes device/quality/mic while live.
  useEffect(() => {
    store.set('overdrive.cam', camId); store.set('overdrive.mic', micId); store.set('overdrive.micOn', micOn ? '1' : '0'); store.set('overdrive.q', quality);
    if (started) acquire();
  }, [camId, micId, micOn, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => { navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const cams = devices.filter(d => d.kind === 'videoinput');
  const mics = devices.filter(d => d.kind === 'audioinput');
  const denied = conn === 'denied';
  const onAir = started && info?.cameraVisible;

  return (
    <div className="min-h-screen bg-[#121212] text-white">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-10 flex items-center justify-between">
          <Logo height={52} />
          <StatusPill conn={conn} />
        </div>

        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.24em] text-white/50">{talent ? 'Talent link · ' : 'Camera link · '}{!slot ? 'Not in a position yet' : slot === 6 ? "Interview guest" : slot >= 4 ? `Analyst ${slot - 3}` : `Caster ${slot}`}</div>
        <h1 className="mb-8 font-display text-3xl font-semibold uppercase tracking-wide">{info?.name ?? '—'} <span className="ml-2 align-middle text-sm tracking-[0.2em] text-white/50">{info?.role}</span></h1>
        <MatchStrip wc={wc?.state} slot={slot} casters={info?.talent} />
        <GameFeed auth={talent ? `?talent=${talent}&key=${encodeURIComponent(key)}` : `?slot=${slot}&key=${encodeURIComponent(key)}`} />

        {(denied || error) && (
          <div className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error || 'This camera link is invalid or has been revoked. Ask the producer for a new link.'}
          </div>
        )}

        {info?.vdo ? <VdoSender vdo={info.vdo} name={info.name} onAir={!!info.cameraVisible} /> : <>
        <div className="relative mb-6 aspect-video overflow-hidden rounded-lg border border-white/10 bg-[#1a1a1a]">
          <video ref={previewRef} muted playsInline autoPlay className="h-full w-full -scale-x-100 object-cover" />
          {!started && <div className="absolute inset-0 grid place-items-center text-sm text-white/50">Camera preview</div>}
          <div className={`absolute left-3 top-3 rounded px-2.5 py-1 text-xs font-bold tracking-[0.2em] ${onAir ? 'bg-[#e5484d] text-white' : 'bg-black/60 text-white/60'}`}>
            {onAir ? 'ON AIR' : started ? 'STANDBY' : 'OFF'}
          </div>
          {started && <div className="absolute right-3 top-3 rounded bg-black/60 px-2.5 py-1 text-xs text-white/70">{viewers} receiving</div>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Camera">
            <select className="input" value={camId} onChange={e => setCamId(e.target.value)}>
              <option value="">Default camera</option>
              {cams.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
            </select>
          </Field>
          <Field label="Resolution">
            <select className="input" value={quality} onChange={e => setQuality(e.target.value as '720')}>
              <option value="720">720p (recommended)</option>
              <option value="1080">1080p</option>
            </select>
          </Field>
          <Field label="Microphone">
            <select className="input" value={micId} disabled={!micOn} onChange={e => setMicId(e.target.value)}>
              <option value="">Default microphone</option>
              {mics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
            </select>
          </Field>
          <Field label="Send microphone">
            <label className="flex h-10 cursor-pointer items-center gap-3 text-sm text-white/80">
              <input type="checkbox" className="h-4 w-4 accent-white" checked={micOn} onChange={e => setMicOn(e.target.checked)} />
              Send my mic to the producer (separate audio feed)
            </label>
          </Field>
        </div>

        <div className="mt-8 flex gap-3">
          {!started
            ? <button className="btn-primary" disabled={denied} onClick={acquire}>Start camera</button>
            : <button className="btn" onClick={stop}>Stop camera</button>}
        </div>
        </>}
        {ros && (
          <div className="mt-10">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">Run of show</div>
            <RosView ros={ros.ros} now={now} />
          </div>
        )}
        <p className="mt-6 text-xs leading-relaxed text-white/40">
          Keep this tab open during the show. The producer decides when your camera is on air; you'll see the ON AIR tally here.
          If your connection drops, this page reconnects automatically.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">{label}</div>
      {children}
    </label>
  );
}

export function StatusPill({ conn, label }: { conn: string; label?: string }) {
  const color = conn === 'open' ? 'bg-emerald-400' : conn === 'denied' ? 'bg-red-500' : 'bg-amber-400 animate-pulse';
  const text = label ?? (conn === 'open' ? 'Connected' : conn === 'denied' ? 'Rejected' : 'Reconnecting');
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
      <span className={`h-2 w-2 rounded-full ${color}`} /> {text}
    </div>
  );
}

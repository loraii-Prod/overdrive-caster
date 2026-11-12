import { useEffect, useRef, useState } from 'react';
import { GAMEFEED_MODES, vdoFeedUrl, type GameFeedMode, type GameFeedSource } from '../../shared/gamefeed';

/**
 * Low-latency game feed for casters (OBS → stream server → WebRTC). The offer goes through this
 * app's server (/gamefeed/whep), which adds the stream login; the video comes straight from the
 * stream server. Reconnects by itself; latency mode (jitter buffer), mute, volume, fullscreen.
 * `auth` = "?slot=&key=" for caster pages, "" for a signed-in producer.
 */
export function GameFeed({ auth, big = false }: { auth: string; big?: boolean }) {
  const video = useRef<HTMLVideoElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [cfg, setCfg] = useState<{ enabled: boolean; mode: GameFeedMode; source?: GameFeedSource; vdoUrl?: string } | null>(null);
  const vdo = cfg?.source === 'vdo' && !!cfg.vdoUrl;
  const frame = useRef<HTMLIFrameElement>(null);
  const [vol, setVol] = useState(1);
  const [vdoSrc, setVdoSrc] = useState('');
  const [state, setState] = useState<'off' | 'connecting' | 'waiting' | 'live' | 'error'>('connecting');
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<GameFeedMode>(() => { try { return (localStorage.getItem('overdrive.feedMode') as GameFeedMode) || 'balanced'; } catch { return 'balanced'; } });
  const [muted, setMuted] = useState(true);
  const [stats, setStats] = useState<{ delay: number; fps: number; kbps: number } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null), session = useRef<string | null>(null), modeRef = useRef(mode);
  modeRef.current = mode;

  // Settings from the server (is there a feed, default mode).
  useEffect(() => {
    let live = true;
    fetch(`/gamefeed/config${auth}`).then(r => (r.ok ? r.json() : null)).then(j => {
      if (!live) return;
      if (!j) { setState('error'); setMsg('Not allowed'); return; }
      setCfg(j);
      try { if (!localStorage.getItem('overdrive.feedMode')) setMode(j.mode); } catch { setMode(j.mode); }
    }).catch(() => live && setState('error'));
    return () => { live = false; };
  }, [auth]);

  const applyBuffer = (pc: RTCPeerConnection | null, m: GameFeedMode) => {
    const ms = GAMEFEED_MODES[m].buf;
    pc?.getReceivers().forEach(r => { try { (r as any).jitterBufferTarget = ms; } catch { /* older browsers */ } try { (r as any).playoutDelayHint = ms / 1000; } catch { /* idem */ } });
  };

  // Connect, and reconnect on failure.
  useEffect(() => {
    if (!cfg?.enabled) { setState(cfg ? 'off' : 'connecting'); return; }
    if (cfg.source === 'vdo') return;
    let stop = false, retry: ReturnType<typeof setTimeout> | undefined;
    const hangUp = () => {
      pcRef.current?.close(); pcRef.current = null;
      if (session.current) { fetch(`/gamefeed/session/${session.current}${auth}`, { method: 'DELETE', keepalive: true }).catch(() => {}); session.current = null; }
    };
    const again = (ms: number) => { clearTimeout(retry); if (!stop) retry = setTimeout(connect, ms); };
    async function connect() {
      hangUp();
      setState(s => (s === 'live' ? 'connecting' : s));
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      const ms = new MediaStream();
      pc.ontrack = e => { ms.addTrack(e.track); if (video.current) video.current.srcObject = ms; };
      pc.onconnectionstatechange = () => {
        if (pc !== pcRef.current) return;
        if (pc.connectionState === 'connected') { setState('live'); setMsg(''); applyBuffer(pc, modeRef.current); video.current?.play().catch(() => {}); }
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') { setState('connecting'); setMsg('Reconnecting…'); again(1000); }
      };
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise<void>(r => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, 1500); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }; });
        const res = await fetch(`/gamefeed/whep${auth}`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp });
        if (stop || pc !== pcRef.current) return;
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setState(res.status === 404 ? 'waiting' : 'error'); setMsg(j.error ?? `Error ${res.status}`);
          return again(res.status === 404 ? 3000 : 5000);
        }
        session.current = res.headers.get('X-Session');
        await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
        applyBuffer(pc, modeRef.current);
      } catch (e: any) {
        if (stop) return;
        setState('error'); setMsg(e?.message ?? 'Connection failed'); again(3000);
      }
    }
    connect();
    const bye = () => hangUp();
    window.addEventListener('pagehide', bye);
    return () => { stop = true; clearTimeout(retry); window.removeEventListener('pagehide', bye); hangUp(); };
  }, [cfg?.enabled, cfg?.source, auth]);

  // ---- VDO.Ninja: an embedded VDO player driven over its IFRAME API (postMessage).
  const toVdo = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, '*');
  useEffect(() => {
    if (!vdo) return;
    // The buffer is set in the link when the player loads, then changed live with setBufferDelay.
    setVdoSrc(vdoFeedUrl(cfg!.vdoUrl!, GAMEFEED_MODES[modeRef.current].buf));
    setState('connecting'); setMsg('Waiting for the stream…');
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return;
      const d = e.data as { action?: string; value?: unknown };
      if (d.action === 'view-connection') { if (d.value) { setState('live'); setMsg(''); } else { setState('waiting'); setMsg('Stream dropped, waiting…'); } }
      if (d.action === 'push-connection' && d.value === false) { setState('waiting'); setMsg('Stream dropped, waiting…'); }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [vdo, cfg?.vdoUrl]);
  useEffect(() => { if (vdo) toVdo({ setBufferDelay: GAMEFEED_MODES[mode].buf, UUID: '*' }); }, [mode, vdo]);
  useEffect(() => { if (vdo) toVdo({ volume: vol }); }, [vol, vdo]);

  useEffect(() => { applyBuffer(pcRef.current, mode); try { localStorage.setItem('overdrive.feedMode', mode); } catch { /* private mode */ } }, [mode]);

  // Stats: playout delay (jitter buffer), fps, bitrate.
  useEffect(() => {
    if (state !== 'live') { setStats(null); return; }
    let last: { bytes: number; t: number } | null = null;
    const t = setInterval(async () => {
      const pc = pcRef.current; if (!pc) return;
      const rep = await pc.getStats();
      rep.forEach((s: any) => {
        if (s.type !== 'inbound-rtp' || s.kind !== 'video') return;
        const delay = s.jitterBufferEmittedCount ? (s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000 : 0;
        const kbps = last ? ((s.bytesReceived - last.bytes) * 8) / (s.timestamp - last.t) : 0;
        last = { bytes: s.bytesReceived, t: s.timestamp };
        setStats({ delay: Math.round(delay), fps: Math.round(s.framesPerSecond ?? 0), kbps: Math.round(kbps) });
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  // Keys: 1–4 mode, F fullscreen, M mute (not while typing).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const ids = Object.keys(GAMEFEED_MODES) as GameFeedMode[];
      if (/^[1-4]$/.test(e.key)) setMode(ids[Number(e.key) - 1]);
      if (e.key === 'f' || e.key === 'F') fullscreen();
      if (e.key === 'm' || e.key === 'M') toggleMute();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const toggleMute = () => {
    if (vdo) { const m = !muted; toVdo({ mute: m }); setMuted(m); return; }
    const v = video.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); if (!v.muted) v.play().catch(() => {});
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen());

  if (cfg && !cfg.enabled) return big ? <div className="grid h-full place-items-center text-white/45">The producer hasn't switched the game feed on.</div> : null;

  return (
    <div className={big ? 'flex h-full flex-col' : 'mb-8 rounded-lg border border-white/10 bg-white/[0.03] p-3'}>
      {!big && <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">Live game feed{state === 'live' && <span className="text-emerald-400">● live</span>}</div>}
      <div ref={wrap} className={`relative overflow-hidden rounded-md bg-black ${big ? 'flex-1' : 'aspect-video'}`} onDoubleClick={fullscreen}>
        {vdo
          ? vdoSrc && <iframe ref={frame} src={vdoSrc} title="Game feed" allow="autoplay; fullscreen" className="absolute inset-0 h-full w-full border-0" onLoad={() => { toVdo({ mute: muted }); toVdo({ volume: vol }); }} />
          : <video ref={video} className="h-full w-full object-contain" autoPlay playsInline muted={muted} />}
        {state !== 'live' && !vdo && (
          <div className="absolute inset-0 grid place-items-center text-center text-[14px] text-white/55">
            {state === 'waiting' ? 'Waiting for the stream (OBS not sending yet)…' : state === 'off' ? 'Game feed is off' : msg || 'Connecting…'}
          </div>
        )}
        {vdo && state !== 'live' && <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[11.5px] text-white/70">{msg || 'Connecting…'}</div>}
        {state === 'live' && muted && (
          <button type="button" onClick={toggleMute} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/70 px-5 py-3 text-[14px] font-semibold text-white">Click for sound</button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(Object.keys(GAMEFEED_MODES) as GameFeedMode[]).map((m, i) => (
          <button key={m} type="button" title={`${GAMEFEED_MODES[m].buf} ms buffer · key ${i + 1}`} onClick={() => setMode(m)}
            className={`btn-xs ${mode === m ? '!border-[#e5484d] !bg-[#e5484d]/25 !text-white' : ''}`}>{GAMEFEED_MODES[m].name}</button>
        ))}
        <button type="button" className="btn-xs" onClick={toggleMute}>{muted ? 'Unmute (M)' : 'Mute (M)'}</button>
        {vdo && <input type="range" min={0} max={1} step={0.05} value={vol} onChange={e => setVol(Number(e.target.value))} className="w-24" title="Volume" />}
        {vdo && <button type="button" className="btn-xs" onClick={() => toVdo({ reload: true })} title="Reload the VDO.Ninja player">Reconnect</button>}
        <button type="button" className="btn-xs" onClick={fullscreen}>Fullscreen (F)</button>
        {!big && <a className="btn-xs" href={`/gamefeed${auth}`} target="_blank" rel="noreferrer">Pop out</a>}
        <span className="ml-auto text-[11px] tabular-nums text-white/40">
          {vdo ? `VDO.Ninja · ${GAMEFEED_MODES[mode].buf} ms buffer` : stats ? `buffer ${stats.delay} ms · ${stats.fps} fps · ${(stats.kbps / 1000).toFixed(1)} Mbps` : ''}
        </span>
      </div>
    </div>
  );
}

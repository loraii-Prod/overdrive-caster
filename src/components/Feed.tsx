import { useEffect, useRef, useState } from 'react';
import type { Caster } from '../../shared/types';
import type { RtcViewer } from '../lib/rtcViewer';
import { IdentityCard } from './IdentityCard';
import { useVdo } from '../lib/vdo';
import { vdoViewUrl } from '../../shared/players';

/**
 * Camera feed with a branded card underneath. The video fades in only once
 * frames are actually playing, and fades back out on stall/error/disconnect.
 * Always muted: audio is delivered separately via /output/audio/:slot.
 */
export function Feed({ caster, viewer, size, showName, monitor }: {
  caster: Caster; viewer?: RtcViewer | null; size: 'lg' | 'md' | 'sm'; showName: boolean; monitor?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const { type, url } = caster.source;
  const vdo = useVdo();

  // WebRTC stream from the shared viewer (connection outlives this component).
  useEffect(() => {
    if (type !== 'webrtc' || !viewer) return;
    const v = ref.current!;
    return viewer.subscribe(caster.id, stream => {
      if (v.srcObject !== stream) v.srcObject = stream;
      if (!stream) return setPlaying(false);
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onmute = () => setPlaying(false); // publisher stalled or left
        track.onunmute = () => v.play().catch(() => {});
        track.onended = () => setPlaying(false);
      }
      v.play().catch(() => {});
    });
  }, [type, viewer, caster.id]);

  useEffect(() => {
    const v = ref.current!;
    if (type === 'url') {
      v.srcObject = null;
      if (url) { v.src = url; v.play().catch(() => {}); }
      else v.removeAttribute('src');
    }
    return () => { if (type === 'url') { v.removeAttribute('src'); v.load(); } };
  }, [type, url]);

  if (type === 'vdo') {
    const live = vdo.embeds && !monitor && !!caster.source.vdo;
    return (
      <>
        <IdentityCard caster={caster} size={size} showName={false} />
        {live && (
          <iframe src={vdoViewUrl({ vdo: caster.source.vdo }, vdo.password, '&cleanoutput&noaudio&cover')} title={`caster ${caster.id}`} allow="autoplay; fullscreen"
            className="absolute inset-0 h-full w-full border-0" style={{ background: 'transparent' }} />
        )}
        {monitor && (
          <div className="absolute right-3 top-3 rounded bg-black/70 px-2 py-1 font-sans text-[16px] font-semibold tracking-[0.14em] text-white/70">VDO.NINJA</div>
        )}
      </>
    );
  }

  return (
    <>
      {/* Base layer: branded card (mark only — the nameplate carries the name). */}
      <IdentityCard caster={caster} size={size} showName={false} />
      <video
        ref={ref}
        muted
        playsInline
        autoPlay
        loop={type === 'url'}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        style={{ opacity: playing ? 1 : 0 }}
        onPlaying={() => setPlaying(true)}
        onResize={() => ref.current && ref.current.videoWidth > 0 && !ref.current.paused && setPlaying(true)}
        onWaiting={() => { /* brief buffering: keep last frame */ }}
        onError={() => setPlaying(false)}
        onEmptied={() => setPlaying(false)}
      />
      {monitor && !playing && (
        <div className="absolute right-3 top-3 rounded bg-black/70 px-2 py-1 font-sans text-[18px] font-semibold tracking-[0.18em] text-[#ff6b6b]">
          NO SIGNAL
        </div>
      )}
    </>
  );
}

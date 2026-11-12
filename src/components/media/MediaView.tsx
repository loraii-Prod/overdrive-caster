/**
 * /output/media — Overdrive 2.0 media playback source. The server owns the playlist and the clock
 * (startedAt / pausedMs), so every copy of this source (OBS, Producer preview) shows the same frame.
 * The OBS source reports when an item ends; the server decides what plays next.
 */
import { useEffect, useRef } from 'react';
import type { MediaState } from '../../../shared/media';
import { isAudio, isVideo, mediaName } from '../../../shared/media';

export function MediaView({ media, skew, onEnded, preview = false }: { media: MediaState | null; skew: number; onEnded?: (seq: number) => void; preview?: boolean }) {
  const v = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const url = media && media.status !== 'stopped' ? media.playlist[media.index] : undefined;
  const now = () => Date.now() + skew;

  // Follow the server clock: play / pause / seek when the state changes, correct drift over 0.4 s.
  useEffect(() => {
    const el = v.current;
    if (!el || !media || !url) return;
    el.volume = media.volume;
    el.muted = preview || media.muted;
    const want = media.status === 'playing' && media.startedAt != null ? (now() - media.startedAt) / 1000 : media.pausedMs / 1000;
    const sync = () => {
      if (Number.isFinite(el.duration) && want > el.duration) return;
      if (Math.abs(el.currentTime - want) > 0.4) el.currentTime = Math.max(0, want);
      if (media.status === 'playing') el.play().catch(() => {}); else el.pause();
    };
    if (el.readyState >= 1) sync(); else el.onloadedmetadata = sync;
  }, [media?.seq, media?.status, media?.startedAt, media?.pausedMs, media?.volume, media?.muted, url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Images have no end: they hold until the producer moves on (auto-advance applies to video/audio).
  const ended = () => { if (media && !preview) onEnded?.(media.seq); };
  if (!url) return <div className="absolute inset-0" />;
  if (isVideo(url)) return <video key={url} ref={v} src={url} className="absolute inset-0 h-full w-full bg-black object-contain" playsInline onEnded={ended} />;
  if (isAudio(url)) return (
    <div className="absolute inset-0 grid place-items-center">
      <audio key={url} ref={v} src={url} onEnded={ended} />
      {preview && <div className="rounded bg-black/70 px-6 py-3 font-['Montserrat'] text-[28px] font-bold text-white">♪ {mediaName(url)}</div>}
    </div>
  );
  return <img key={url} src={url} alt="" className="absolute inset-0 h-full w-full object-contain" />;
}

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

  // A network error (server restarting, storage blip) must not leave a black source for the rest of the show:
  // reload the same file and re-sync to the server clock, backing off 1 s → 2 s → … → 10 s. A successful
  // playback resets the backoff.
  const tries = useRef(0), total = useRef(0), retry = useRef<number | null>(null);
  const live = useRef(media); live.current = media; // the retry must use the latest clock/status, not the one from when it failed
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);
  useEffect(() => { tries.current = 0; }, [url]);
  const failed = () => {
    const el = v.current;
    if (!el || !media || !url || retry.current) return;
    const wait = Math.min(10000, 1000 * 2 ** tries.current++);
    el.dataset.mediaRetries = String(++total.current); // visible in the OBS/CEF inspector
    retry.current = window.setTimeout(() => {
      retry.current = null;
      const e2 = v.current;
      if (!e2) return;
      e2.load();
      e2.onloadedmetadata = () => {
        const media = live.current;
        if (!media) return;
        const want = media.status === 'playing' && media.startedAt != null ? (now() - media.startedAt) / 1000 : media.pausedMs / 1000;
        if (Number.isFinite(e2.duration) && want < e2.duration) e2.currentTime = Math.max(0, want);
        if (media.status === 'playing') e2.play().catch(() => {});
      };
    }, wait);
  };
  const playing = () => { tries.current = 0; };
  // A stream that silently stops (connection dropped without an error event) counts as a failure after 6 s.
  useEffect(() => {
    if (!url || !isVideo(url) && !isAudio(url)) return;
    let last = -1, stuck = 0;
    const t = window.setInterval(() => {
      const el = v.current;
      if (!el || !media || media.status !== 'playing' || el.ended || el.paused && el.readyState >= 3) { stuck = 0; return; }
      if (el.currentTime === last) { if (++stuck >= 3) { stuck = 0; failed(); } } else stuck = 0;
      last = el.currentTime;
    }, 2000);
    return () => clearInterval(t);
  }, [url, media?.status, media?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Images have no end: they hold until the producer moves on (auto-advance applies to video/audio).
  const ended = () => { if (media && !preview) onEnded?.(media.seq); };
  if (!url) return <div className="absolute inset-0" />;
  if (isVideo(url)) return <video key={url} ref={v} src={url} className="absolute inset-0 h-full w-full bg-black object-contain" playsInline onEnded={ended} onError={failed} onPlaying={playing} />;
  if (isAudio(url)) return (
    <div className="absolute inset-0 grid place-items-center">
      <audio key={url} ref={v} src={url} onEnded={ended} onError={failed} onPlaying={playing} />
      {preview && <div className="rounded bg-black/70 px-6 py-3 font-['Montserrat'] text-[28px] font-bold text-white">♪ {mediaName(url)}</div>}
    </div>
  );
  return <img key={url} src={url} alt="" className="absolute inset-0 h-full w-full object-contain" />;
}

/**
 * Runtime services every broadcast output page gets (wired in useSocket for role "output"):
 *
 * Off-air suspension. When the producer enables it and OBS reports that this page's browser source is not showing
 * (not in Program, Preview or a projector), the server sends {t:'suspend', on:true}. The page then pauses its
 * looping file videos and CSS animations, so Chromium stops producing new frames and OBS stops uploading textures.
 * Nothing is unloaded: the last frame stays in the source, so a cut or a transition to it never shows a blank or
 * reloading source, and it resumes in place (videos continue from where they paused). Camera feeds (live
 * MediaStreams), one-shot stingers started while suspended, and the media player are never paused.
 *
 * Performance monitor. While on, the page samples requestAnimationFrame timing and <video> decode quality and
 * reports every 5 s (no sampling, no cost, while off).
 */
import type { Socket } from './socket';
import type { OutputPerf } from '../../shared/protocol';

let suspended = false;
const pausedByUs = new Set<HTMLVideoElement>();

/** Looping/background file videos only: never live camera streams, never anything marked data-od-nosuspend. */
const pausable = (v: HTMLVideoElement) => !v.srcObject && !v.closest('[data-od-nosuspend]') && (v.loop || v.closest('[data-od-bg]') !== null);

export function setSuspended(on: boolean) {
  if (on === suspended) return;
  suspended = on;
  document.documentElement.classList.toggle('od-suspended', on);
  if (on) {
    for (const v of document.querySelectorAll('video')) if (!v.paused && pausable(v)) { v.pause(); pausedByUs.add(v); }
  } else {
    for (const v of pausedByUs) if (v.isConnected) v.play().catch(() => {});
    pausedByUs.clear();
  }
}
export const isSuspended = () => suspended;

/** Frame timing sampler: runs only while the monitor is on. */
function sampler(send: (p: OutputPerf) => void, route: string) {
  let raf = 0, last = performance.now(), times: number[] = [], prevDropped = 0, prevDecoded = 0;
  const loop = (t: number) => { times.push(t - last); last = t; raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const tick = setInterval(() => {
    const ts = times.slice(1); times = [];
    const avg = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0;
    const sorted = [...ts].sort((a, b) => a - b);
    let dropped = 0, decoded = 0, playing = 0;
    for (const v of document.querySelectorAll('video')) {
      if (!v.paused) playing++;
      const q = v.getVideoPlaybackQuality?.();
      if (q) { dropped += q.droppedVideoFrames; decoded += q.totalVideoFrames; }
    }
    const canvas = document.querySelector('[data-od-canvas]') as HTMLElement | null;
    const [w, h] = (canvas?.dataset.odCanvas ?? `${innerWidth}x${innerHeight}`).split('x').map(Number);
    const mem = (performance as any).memory?.usedJSHeapSize;
    send({
      route, w, h, scale: Number(canvas?.dataset.odScale ?? 1), raster: canvas?.dataset.odRaster ?? 'none', suspended,
      fps: avg ? Math.round(10000 / avg) / 10 : 0, p95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
      long: ts.filter(x => x > 25).length, videos: playing, dropped: Math.max(0, dropped - prevDropped), decoded: Math.max(0, decoded - prevDecoded),
      fontsReady: canvas ? canvas.dataset.odReady === '1' : true, ...(mem ? { heapMB: Math.round(mem / 1e5) / 10 } : {}),
    });
    prevDropped = dropped; prevDecoded = decoded;
  }, 5000);
  return () => { cancelAnimationFrame(raf); clearInterval(tick); };
}

export function attachOutputRuntime(sock: Socket, route: string) {
  let stop: (() => void) | null = null;
  const off = sock.on(m => {
    if (m.t === 'suspend') setSuspended(!!m.on);
    else if (m.t === 'perf-mode') {
      if (m.on && !stop) stop = sampler(perf => sock.send({ t: 'out-perf', perf }), route);
      else if (!m.on && stop) { stop(); stop = null; }
    }
  });
  return () => { off(); stop?.(); setSuspended(false); };
}

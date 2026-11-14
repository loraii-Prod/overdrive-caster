/**
 * Off-air suspension + live performance monitor (server side).
 *
 * Which Overdrive pages are showing in OBS comes from OBS itself: for every browser source whose URL is an Overdrive
 * picture page, GetSourceActive says whether OBS is drawing it (Program, Studio-Mode Preview, a projector, or a
 * transition in progress). That covers nested scenes and hand-made sources without any scene list of our own.
 *
 * Suspension policy (only when the producer turns it on, OBS is connected, and the page's source was found):
 *   showing → awake at once; not showing for GRACE ms → suspend. Unknown pages, OBS offline, the media player and
 *   audio pages are never suspended. Nothing is unloaded and nothing in OBS is changed (read-only requests).
 */
import { routeOf } from '../shared/obsSetup';
import type { OutputPerf, PerfReport } from '../shared/protocol';

export const GRACE_MS = 3000;
const NEVER = /^(media|music|audio\/)/;

type Call = (req: string, data?: Record<string, any>) => Promise<any>;
export interface PerfDeps {
  call: () => Call | null;
  opts: () => { suspendOffAir: boolean; perfMonitor: boolean };
  /** Connected output pages: socket id + route (e.g. 'g/caster-desk', 'screen/brb'). */
  outputs: () => { id: string; route: string }[];
  send: (id: string, msg: { t: 'suspend'; on: boolean } | { t: 'perf-mode'; on: boolean }) => void;
  report: (r: PerfReport) => void;
}

/** Overdrive output route of a browser-source URL: '/output/screen/brb?x' → 'screen/brb', '/g/desk' → 'g/desk'. */
export function outputRouteOf(url: string): string | null {
  const r = routeOf(url);
  if (!r) return null;
  const path = r.split('?')[0];
  if (!/^\/(output|g)\//.test(path)) return null;
  return path.replace(/^\/output\//, '').replace(/^\//, '');
}

export function createPerf(d: PerfDeps) {
  const settings = new Map<string, { url: string; at: number }>();
  let showing = new Map<string, boolean>();      // route → showing (only routes with an OBS source)
  const lastShown = new Map<string, number>();
  const sentSuspend = new Map<string, boolean>(); // socket id → last suspend state sent
  const sentMode = new Map<string, boolean>();
  const perf = new Map<string, OutputPerf & { id: string; at: number }>();
  let obsStats: PerfReport['obs'] = null;
  let busy = false, again = false, kickT: NodeJS.Timeout | null = null, lastStats = 0;

  async function refresh() {
    const o = d.opts(), call = d.call();
    if (busy) { again = true; return; }
    if (!call || (!o.suspendOffAir && !o.perfMonitor)) { showing = new Map(); obsStats = null; apply(); return; }
    busy = true;
    try {
      const list = (await call('GetInputList', { inputKind: 'browser_source' })).inputs as { inputName: string }[];
      const now = Date.now();
      await Promise.all(list.map(async i => {
        const c = settings.get(i.inputName);
        if (c && now - c.at < 15000) return;
        try { const s = await call('GetInputSettings', { inputName: i.inputName }); settings.set(i.inputName, { url: String(s.inputSettings?.url ?? ''), at: now }); } catch { /* removed meanwhile */ }
      }));
      for (const k of settings.keys()) if (!list.some(i => i.inputName === k)) settings.delete(k);
      const next = new Map<string, boolean>();
      await Promise.all(list.map(async i => {
        const route = outputRouteOf(settings.get(i.inputName)?.url ?? '');
        if (!route) return;
        try { const a = await call('GetSourceActive', { sourceName: i.inputName }); next.set(route, (next.get(route) ?? false) || !!a.videoShowing || !!a.videoActive); } catch { /* ignore */ }
      }));
      showing = next;
      for (const [r, on] of next) if (on) lastShown.set(r, now);
      if (o.perfMonitor && now - lastStats > 1900) {
        lastStats = now;
        try {
          const s = await call('GetStats');
          obsStats = { fps: Math.round(s.activeFps * 10) / 10, renderMs: Math.round(s.averageFrameRenderTime * 100) / 100, renderSkipped: s.renderSkippedFrames, renderTotal: s.renderTotalFrames, outputSkipped: s.outputSkippedFrames, outputTotal: s.outputTotalFrames, cpu: Math.round(s.cpuUsage * 10) / 10, memMB: Math.round(s.memoryUsage) };
        } catch { obsStats = null; }
      }
    } catch { showing = new Map(); }
    finally { busy = false; }
    apply();
    if (again) { again = false; void refresh(); }
  }

  /** Decide and send suspend / monitor mode per connected output (only on change). */
  function apply() {
    const o = d.opts(), now = Date.now(), connected = !!d.call();
    const outs = d.outputs();
    for (const c of outs) {
      const known = showing.has(c.route);
      const want = o.suspendOffAir && connected && known && !NEVER.test(c.route) && !showing.get(c.route) && now - (lastShown.get(c.route) ?? 0) > GRACE_MS;
      if ((sentSuspend.get(c.id) ?? false) !== want) { sentSuspend.set(c.id, want); d.send(c.id, { t: 'suspend', on: want }); }
      if ((sentMode.get(c.id) ?? false) !== o.perfMonitor) { sentMode.set(c.id, o.perfMonitor); d.send(c.id, { t: 'perf-mode', on: o.perfMonitor }); }
    }
    for (const id of [...sentSuspend.keys()]) if (!outs.some(c => c.id === id)) { sentSuspend.delete(id); sentMode.delete(id); perf.delete(id); }
    if (o.perfMonitor || o.suspendOffAir) d.report(report());
  }

  function report(): PerfReport {
    const o = d.opts();
    return { on: o.perfMonitor, suspendOffAir: o.suspendOffAir, outputs: [...perf.values()].sort((a, b) => a.route.localeCompare(b.route)), obs: obsStats, showing: Object.fromEntries(showing) };
  }

  const timer = setInterval(() => void refresh(), 1000);
  return {
    /** OBS scene/preview/transition changed: re-check now (debounced). */
    kick() { if (kickT) return; kickT = setTimeout(() => { kickT = null; void refresh(); }, 30); },
    /** A new output connected: it starts awake; tell it the monitor mode. */
    joined() { apply(); },
    sample(id: string, p: OutputPerf) { perf.set(id, { ...p, id, at: Date.now() }); },
    report,
    stop() { clearInterval(timer); },
    /** for tests */
    _state: () => ({ showing, sentSuspend }),
  };
}
export type Perf = ReturnType<typeof createPerf>;

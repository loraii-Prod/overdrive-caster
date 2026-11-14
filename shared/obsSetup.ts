/**
 * OBS Scene Builder (Studio Mode → OBS Setup).
 *
 * Every Overdrive output becomes ITS OWN OBS scene holding ITS OWN full-canvas browser source (sized by the output profile:
 * 3840×2160 for 4K, 1920×1080 for 1080p):
 *  - every graphics-engine instance  → /g/<instance>
 *  - every registered scene source   → its /output/… route (legacy screens included)
 * Never one master scene, never a shared /output/program source. OBS keeps switching between these scenes;
 * the builder only creates, repairs and verifies them (it never changes the Program or Preview scene).
 */
import { pkgById, type GfxInstance } from './gfx';
import { REGISTRY } from './registry';
import { SCREEN_LABELS } from './defaults';
import type { ScreenId } from './types';
import { CANVAS, DEFAULT_PROFILE, profileOf, type OutputProfileId } from './layout';

export type TargetKind = 'gfx' | 'screen' | 'source' | 'support';

/** One Overdrive output = one OBS scene. */
export interface ObsTarget {
  /** 'g:<instance>' (graphics engine) or 's:<registry id>' (scene source) or 'support:audio'. */
  id: string;
  kind: TargetKind;
  name: string;
  /** Overdrive route of the browser source (no origin, no key). */
  route: string;
  scene: string;
  input: string;
  width: number;
  height: number;
  /** Scene-specific composition. */
  gameCapture: boolean;
  /** The browser source carries audio that belongs in the OBS mixer (media playback). */
  rerouteAudio: boolean;
  /** Nest the shared caster-audio / music scene. */
  audio: boolean;
  /** A graphics-engine instance renders the same scene: this legacy source is only built when asked. */
  supersededBy?: string;
  /** Legacy screen id, for the old screen → OBS scene mapping. */
  screen?: ScreenId;
}

export interface ObsSetupOptions {
  /** Nest "Overdrive · Caster audio" (remote mics + music) into every built scene (as the legacy builder did). */
  audio: boolean;
  /** Add a game capture under gameplay overlays when the scene has no capture yet. */
  gameCapture: boolean;
  /** Build All also builds legacy screens that a graphics-engine instance replaces. */
  legacy: boolean;
  /** Base URL OBS uses to reach Overdrive ('' = automatic). */
  baseUrl: string;
  /** Output resolution profile: the size of every picture browser source and the expected OBS canvas. */
  profile: OutputProfileId;
  /** Pause videos/loops in Overdrive pages OBS is not showing (Program/Preview/projector). Off by default. */
  suspendOffAir: boolean;
  /** Live performance monitor: outputs report frame timing, OBS reports render/encode stats. Off by default. */
  perfMonitor: boolean;
}

/** Persistent mapping: Overdrive output ↔ OBS objects. */
export interface ObsMapEntry {
  scene: string;
  sceneUuid?: string;
  input: string;
  inputUuid?: string;
  itemId?: number;
  url: string;
  at: number;
}

export interface ObsSetupStore {
  options: ObsSetupOptions;
  map: Record<string, ObsMapEntry>;
  results: Record<string, { at: number; ok: boolean; lines: string[] }>;
}

export type TargetStatus = 'ok' | 'missing' | 'incomplete' | 'outdated' | 'conflict' | 'error' | 'unknown';

export interface TargetReport {
  id: string;
  name: string;
  kind: TargetKind;
  scene: string;
  input: string;
  url: string;
  status: TargetStatus;
  issues: string[];
  /** Items in the scene that Overdrive does not manage (kept untouched). */
  unmanaged: string[];
  onAir: boolean;
  supersededBy?: string;
  /** Included by Build All. */
  inAll: boolean;
}

export type OpKind = 'create-scene' | 'create-input' | 'add-item' | 'set-settings' | 'transform' | 'enable' | 'order' | 'nest-audio' | 'add-capture' | 'mark';

export interface PlanOp {
  target: string;
  kind: OpKind;
  scene: string;
  detail: string;
  /** Touches an existing scene (not one the builder just created). */
  existing: boolean;
  /** The scene is OBS's Program right now: held back unless "allow on-air scene" is ticked. */
  onAir: boolean;
}

export interface ObsPlan {
  hash: string;
  mode: 'build' | 'repair';
  targets: string[];
  ops: PlanOp[];
  /** Targets that cannot be built (conflicts), with the reason. */
  blocked: { target: string; reason: string }[];
  at: number;
}

export interface ObsSetupState {
  options: ObsSetupOptions;
  baseUrl: string;
  baseReason: string;
  version?: { obs: string; ws: string; missing: string[] };
  /** OBS base canvas, plus the output (scaled) resolution and frame rate when OBS reports them. */
  canvas?: { w: number; h: number; ow?: number; oh?: number; fps?: number };
  targets: TargetReport[];
  plan: ObsPlan | null;
  busy: string | null;
  scannedAt: number;
  lastRun: { at: number; ok: boolean; summary: string; perTarget: Record<string, { ok: boolean; lines: string[] }> } | null;
  results: ObsSetupStore['results'];
  map: Record<string, ObsMapEntry>;
  /** OBS browser sources that load an Overdrive CONTROL page (must never be in a broadcast scene). */
  controllerLeaks: { input: string; url: string }[];
  /** Picture-quality findings (read-only): anything that makes OBS resample an Overdrive picture. */
  quality: QualityIssue[];
}

export interface QualityIssue { where: string; issue: string; fix: string }

/**
 * Native OBS browser-source size of an Overdrive page under an output profile: every picture output is the 1920×1080
 * logical canvas at the profile's scale (3840×2160 at 4K). `?controls` pages are 1920×1480 logical (picture + controls).
 * null = not a picture (audio, music, control pages).
 */
export function nativeSizeOf(route: string | null, profile: OutputProfileId = DEFAULT_PROFILE): { w: number; h: number } | null {
  if (!route) return null;
  const [path, q = ''] = route.split('?');
  if (!/^\/(output|g)\//.test(path) || /^\/output\/(audio|music)(\/|$)/.test(path)) return null;
  const k = profileOf(profile).scale;
  return new URLSearchParams(q).has('controls') ? { w: 1920 * k, h: 1480 * k } : { w: CANVAS.w * k, h: CANVAS.h * k };
}

/** How much OBS resizes a scene item when drawing it (1 = pixel for pixel). */
export function itemScale(tr: any, srcW: number, srcH: number): { x: number; y: number } {
  const sw = Number(tr?.sourceWidth) || srcW, sh = Number(tr?.sourceHeight) || srcH;
  if (tr?.boundsType && tr.boundsType !== 'OBS_BOUNDS_NONE') {
    const bx = (Number(tr.boundsWidth) || sw) / sw, by = (Number(tr.boundsHeight) || sh) / sh;
    if (tr.boundsType === 'OBS_BOUNDS_STRETCH') return { x: bx, y: by };
    const k = tr.boundsType === 'OBS_BOUNDS_SCALE_OUTER' ? Math.max(bx, by) : tr.boundsType === 'OBS_BOUNDS_MAX_ONLY' ? Math.min(1, bx, by) : Math.min(bx, by);
    return { x: k, y: k };
  }
  return { x: Number(tr?.scaleX) || 1, y: Number(tr?.scaleY) || 1 };
}

/** Quality findings for one Overdrive browser source and the scene items that show it. */
export function sourceQuality(input: string, route: string, settings: any, items: { scene: string; transform: any }[], profile: OutputProfileId = DEFAULT_PROFILE): QualityIssue[] {
  const n = nativeSizeOf(route, profile);
  const P = profileOf(profile);
  if (!n) return [];
  const out: QualityIssue[] = [];
  const w = Number(settings?.width) || 800, h = Number(settings?.height) || 600;
  if (w !== n.w || h !== n.h) {
    const k = Math.min(w / n.w, h / n.h);
    out.push({ where: input, issue: `browser source is ${w}×${h}: Overdrive draws its ${n.w}×${n.h} picture at ${Math.round(k * 100)}%${w / h !== n.w / n.h ? ' (letterboxed)' : ''}, then OBS resizes it again`, fix: `Set the source to ${n.w}×${n.h} (Properties → Width/Height), or Repair it from this page if Overdrive built it.` });
  }
  for (const it of items) {
    const s = itemScale(it.transform, w, h);
    if (Math.abs(s.x - 1) > 0.005 || Math.abs(s.y - 1) > 0.005) out.push({ where: `${input} in “${it.scene}”`, issue: `drawn at ${s.x === s.y ? `${Math.round(s.x * 1000) / 10}%` : `${Math.round(s.x * 1000) / 10}% × ${Math.round(s.y * 1000) / 10}%`} of its size, so OBS resamples every pixel`, fix: `Right-click the source → Transform → Reset Transform (it then fills a ${P.w}×${P.h} canvas 1:1).` });
  }
  return out;
}

/**
 * Quality findings for the OBS video settings, against the output profile. Under the 4K profile a 3840×2160 canvas with
 * a 1920×1080 output is a supported setup (4K graphics, 1080p broadcast: OBS downscales once, at the end).
 */
export function canvasQuality(v: { w: number; h: number; ow?: number; oh?: number; fps?: number }, profile: OutputProfileId = DEFAULT_PROFILE): QualityIssue[] {
  const out: QualityIssue[] = [];
  const P = profileOf(profile);
  if (v.w !== P.w || v.h !== P.h) {
    const other = profileOf(profile === 'uhd' ? 'fhd' : 'uhd');
    out.push({ where: 'OBS video settings', issue: `base canvas is ${v.w}×${v.h}: every ${P.w}×${P.h} Overdrive source (${P.label} profile) has to be resized to fit it`,
      fix: v.w === other.w && v.h === other.h ? `Either Settings → Video → Base (Canvas) Resolution: ${P.w}×${P.h}, or switch the output profile to ${other.label} in OBS Setup.` : `Settings → Video → Base (Canvas) Resolution: ${P.w}×${P.h}.` });
  }
  const fhdOut = profile === 'uhd' && v.ow === 1920 && v.oh === 1080;
  if (v.ow && v.oh && (v.ow < v.w || v.oh < v.h) && !fhdOut) out.push({ where: 'OBS video settings', issue: `output is scaled down to ${v.ow}×${v.oh}: the stream and recordings are below ${profile === 'uhd' ? '1080p' : 'the canvas'}`, fix: `Settings → Video → Output (Scaled) Resolution: ${profile === 'uhd' ? '3840×2160 for a 4K stream, or 1920×1080 for a 1080p stream' : '1920×1080 (same as the canvas)'}, if your upload allows it.` });
  if (v.fps && v.fps < 59) out.push({ where: 'OBS video settings', issue: `OBS runs at ${Math.round(v.fps * 100) / 100} fps: Overdrive animates at 60`, fix: 'Settings → Video → Common FPS Values: 60.' });
  return out;
}

export const AUDIO_SCENE = 'Overdrive · Caster audio';
export const GAME_CAPTURE = 'Overdrive Game capture';

export const defaultObsSetup = (): ObsSetupStore => ({ options: { audio: true, gameCapture: true, legacy: false, baseUrl: '', profile: DEFAULT_PROFILE, suspendOffAir: false, perfMonitor: false }, map: {}, results: {} });

export function sanitizeObsSetup(v: any): ObsSetupStore {
  const o = v?.options ?? {};
  const map: Record<string, ObsMapEntry> = {};
  for (const [k, e] of Object.entries(v?.map ?? {}) as [string, any][]) {
    if (typeof k !== 'string' || k.length > 80 || typeof e?.scene !== 'string' || typeof e?.input !== 'string') continue;
    map[k] = { scene: e.scene.slice(0, 200), input: e.input.slice(0, 200), url: typeof e.url === 'string' ? e.url.slice(0, 500) : '', at: Number(e.at) || 0,
      ...(typeof e.sceneUuid === 'string' ? { sceneUuid: e.sceneUuid.slice(0, 64) } : {}), ...(typeof e.inputUuid === 'string' ? { inputUuid: e.inputUuid.slice(0, 64) } : {}),
      ...(Number.isInteger(e.itemId) ? { itemId: e.itemId } : {}) };
  }
  const results: ObsSetupStore['results'] = {};
  for (const [k, r] of Object.entries(v?.results ?? {}) as [string, any][]) {
    if (Array.isArray(r?.lines)) results[k] = { at: Number(r.at) || 0, ok: r.ok === true, lines: r.lines.slice(0, 40).map((l: unknown) => String(l).slice(0, 300)) };
  }
  return {
    options: {
      audio: o.audio !== false, gameCapture: o.gameCapture !== false, legacy: o.legacy === true,
      baseUrl: typeof o.baseUrl === 'string' && /^https?:\/\/[^\s/?#]+$/i.test(o.baseUrl.trim().replace(/\/$/, '')) ? o.baseUrl.trim().replace(/\/$/, '') : '',
      profile: o.profile === 'uhd' ? 'uhd' : DEFAULT_PROFILE,
      suspendOffAir: o.suspendOffAir === true, perfMonitor: o.perfMonitor === true,
    },
    map, results,
  };
}

const GAMEPLAY_RENDERERS = new Set(['gameplay']);

/**
 * Every Overdrive output, discovered from the graphics engine and the registry (no hardcoded scene list).
 * Names are made unique across scenes AND inputs (OBS shares one namespace for both).
 */
export function discoverTargets(graphics: GfxInstance[], obsScenes: Partial<Record<ScreenId, string>>, opt: Pick<ObsSetupOptions, 'audio' | 'gameCapture'> & { profile?: OutputProfileId }): ObsTarget[] {
  const out: ObsTarget[] = [];
  const k = profileOf(opt.profile ?? DEFAULT_PROFILE).scale;
  const defaultInstance = (g: GfxInstance) => { const p = pkgById(g.pkg); return !!p && p.id.replace(/^od\./, '') === g.id; };
  for (const g of graphics) {
    const p = pkgById(g.pkg);
    if (!p) continue;
    out.push({
      id: `g:${g.id}`, kind: 'gfx', name: g.name, route: `/g/${g.id}`,
      scene: g.obsScene || `Overdrive · ${g.name}`, input: `Overdrive · ${g.name} · g/${g.id}`,
      width: p.resolution[0] * k, height: p.resolution[1] * k,
      gameCapture: opt.gameCapture && GAMEPLAY_RENDERERS.has(p.renderer), rerouteAudio: false, audio: opt.audio,
    });
  }
  for (const s of REGISTRY) {
    const by = graphics.find(g => g.id === s.id || (defaultInstance(g) && !!s.obsKey && pkgById(g.pkg)?.obsKey === s.obsKey));
    const label = s.screen ? SCREEN_LABELS[s.screen] : s.name;
    out.push({
      id: `s:${s.id}`, kind: s.screen ? 'screen' : 'source', name: s.name, route: s.route,
      scene: (s.screen && obsScenes[s.screen]) || `Overdrive · ${label}`, input: `Overdrive · ${label} overlay`,
      width: s.resolution[0] * k, height: s.resolution[1] * k,
      gameCapture: opt.gameCapture && s.id === 'gameplay', rerouteAudio: s.view === 'media', audio: opt.audio,
      ...(by ? { supersededBy: `g:${by.id}` } : {}), ...(s.screen ? { screen: s.screen } : {}),
    });
  }
  // unique names across scenes + inputs (earlier targets keep theirs; graphics-engine instances come first)
  const used = new Set<string>([AUDIO_SCENE, GAME_CAPTURE]);
  const uniq = (n: string, id: string) => { let x = n; if (used.has(x)) x = `${n} (${id.replace(/^\w+:/, '')})`; let i = 2; while (used.has(x)) x = `${n} (${i++})`; used.add(x); return x; };
  for (const t of out) { t.scene = uniq(t.scene, t.id); t.input = uniq(t.input, t.id); }
  return out;
}

/** The URL OBS loads: base + route + output key (keeps an existing query string intact). */
export function targetUrl(base: string, route: string, key: string): string {
  return `${base}${route}${key ? `${route.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : ''}`;
}

/** Path + query of a URL without origin and key (to recognise Overdrive's own sources wherever they point). */
export function routeOf(url: string): string | null {
  try {
    const u = new URL(url);
    u.searchParams.delete('key');
    const q = u.searchParams.toString();
    return u.pathname + (q ? `?${q}` : '');
  } catch { return null; }
}


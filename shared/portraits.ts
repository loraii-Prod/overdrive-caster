/**
 * Player portraits for the MVP package (and anything else that draws a player): one picture per player, linked to the
 * player's stable id (shared/playerIds.ts) through its nickname key, plus the producer's framing (crop / zoom /
 * position) so the same face sits the same way on every graphic.
 *
 * Native 4K: graphics are laid out on the 1920×1080 grid and rasterised at the output's device scale (2 at 3840×2160).
 * A picture is therefore never drawn larger than MAX_UP × its own pixels IN DEVICE PIXELS: a small file is drawn
 * smaller (and the Studio says which resolution it needs) instead of being stretched into a blurry 4K frame.
 */
import { normHandle } from './major';
import { playerIdOf } from './playerIds';

export interface PortraitFrame {
  /** 1 = the default fit (cut-outs: whole figure in the box; photos: the box filled). 0.5–3. */
  zoom: number;
  /** Horizontal / vertical offset in % of the box (−50…50). Positive = right / down. */
  x: number;
  y: number;
}
export const DEFAULT_FRAME: PortraitFrame = { zoom: 1, x: 0, y: 0 };
export const MAX_UP = 1.25;

export const portraitKey = (handle: string) => normHandle(handle);
/** The stable player id of a portrait key (null for a nickname that is not a Major player). */
export const portraitPlayerId = (handle: string) => playerIdOf(handle);

export function sanitizeFrame(v: any): PortraitFrame | null {
  if (!v || typeof v !== 'object') return null;
  const n = (x: unknown, lo: number, hi: number, d: number) => { const f = Number(x); return Number.isFinite(f) ? Math.round(Math.max(lo, Math.min(hi, f)) * 100) / 100 : d; };
  const f = { zoom: n(v.zoom, 0.5, 3, 1), x: n(v.x, -50, 50, 0), y: n(v.y, -50, 50, 0) };
  return f.zoom === 1 && f.x === 0 && f.y === 0 ? null : f; // the default is not stored
}
export function sanitizeFrames(v: any): Record<string, PortraitFrame> {
  const out: Record<string, PortraitFrame> = {};
  if (v && typeof v === 'object') for (const [k, f] of Object.entries(v).slice(0, 200)) { const s = sanitizeFrame(f); if (s) out[String(k).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)] = s; }
  return out;
}

export interface Source { w: number; h: number; /** transparent background (a cut-out figure) */ cutout: boolean }
export interface Fit {
  /** Drawn image size and position inside the box, in layout units (1920×1080 grid). */
  w: number; h: number; left: number; top: number;
  /** Framed photos only: the visible frame (smaller than the box when the file is too small to fill it). */
  frameW: number; frameH: number;
  /** Device pixels per source pixel actually used. */
  upscale: number;
  /** The producer's zoom (or the box) asked for more than the file has: drawn smaller instead of stretched. */
  capped: boolean;
}

/**
 * Where to draw a portrait in a box. Cut-outs are contained and stand on the bottom edge; framed photos cover the box
 * from the top (faces stay in). `deviceScale` is the output's (2 at 4K, 1 at 1080p and in previews).
 */
export function fitPortrait(src: Source, box: { w: number; h: number }, frame: PortraitFrame = DEFAULT_FRAME, deviceScale = 1, maxUp = MAX_UP): Fit {
  const base = src.cutout ? Math.min(box.w / src.w, box.h / src.h) : Math.max(box.w / src.w, box.h / src.h);
  let s = base * frame.zoom;
  const limit = maxUp / Math.max(1, deviceScale);
  const capped = s > limit + 1e-9;
  if (capped) s = limit;
  const w = src.w * s, h = src.h * s;
  const dx = (frame.x / 100) * box.w, dy = (frame.y / 100) * box.h;
  if (src.cutout) {
    return { w, h, left: (box.w - w) / 2 + dx, top: box.h - h + dy, frameW: box.w, frameH: box.h, upscale: s * deviceScale, capped };
  }
  // Framed: the visible frame is the box, or the picture itself when it cannot fill the box without stretching.
  const frameW = Math.min(box.w, w), frameH = Math.min(box.h, h);
  return { w, h, left: (frameW - w) / 2 + dx, top: dy, frameW, frameH, upscale: s * deviceScale, capped };
}

/** The size a portrait file needs to be drawn natively in a box at a device scale (no upscaling at all). */
export function neededSize(box: { w: number; h: number }, cutout: boolean, aspect: number, deviceScale = 2): { w: number; h: number } {
  // aspect = width / height of the file
  const bw = box.w * deviceScale, bh = box.h * deviceScale;
  if (cutout) return aspect > bw / bh ? { w: Math.ceil(bw), h: Math.ceil(bw / aspect) } : { w: Math.ceil(bh * aspect), h: Math.ceil(bh) };
  return aspect > bw / bh ? { w: Math.ceil(bh * aspect), h: Math.ceil(bh) } : { w: Math.ceil(bw), h: Math.ceil(bw / aspect) };
}

/** Where portraits are drawn on the MVP package (layout units), for the Studio's quality check. */
export const PORTRAIT_BOXES = {
  card: { w: 280, h: 340, label: 'Voting card' },
  cardPhoto: { w: 300, h: 360, label: 'Voting card (photo)' },
  hero: { w: 760, h: 980, label: 'Winner reveal' },
  compare: { w: 640, h: 830, label: 'Comparison' },
} as const;

export type PortraitGrade = 'native' | 'good' | 'small';
/** native: no upscaling at 4K · good: within MAX_UP · small: drawn smaller than its box at 4K. */
export function gradePortrait(src: Source, box: { w: number; h: number }, frame: PortraitFrame = DEFAULT_FRAME, deviceScale = 2): PortraitGrade {
  const f = fitPortrait(src, box, frame, deviceScale);
  return f.capped ? 'small' : f.upscale <= 1.0001 ? 'native' : 'good';
}

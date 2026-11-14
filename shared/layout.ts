import type { Caster, Composition, ForcedLayout, Rect, Scene, ThemeId, Tile, TileKind } from './types';

/**
 * The LOGICAL canvas every graphic is designed on (1 unit = 1 px at 1080p, 2 px at 4K). Positions, sizes and
 * fonts stay in these units; the output profile only decides how many device pixels each unit gets.
 */
export const CANVAS = { w: 1920, h: 1080 } as const;

/** Output resolution profiles. The picture is rendered natively at the profile size (never captured and stretched). */
export type OutputProfileId = 'uhd' | 'fhd';
export interface OutputProfile { id: OutputProfileId; label: string; w: number; h: number; /** device px per logical unit */ scale: number }
export const OUTPUT_PROFILES: Record<OutputProfileId, OutputProfile> = {
  uhd: { id: 'uhd', label: '4K UHD 3840×2160', w: 3840, h: 2160, scale: 2 },
  fhd: { id: 'fhd', label: '1080p 1920×1080', w: 1920, h: 1080, scale: 1 },
};
/** Existing setups keep 1080p until the producer switches. */
export const DEFAULT_PROFILE: OutputProfileId = 'fhd';
export const profileOf = (id: unknown): OutputProfile => OUTPUT_PROFILES[id === 'uhd' ? 'uhd' : 'fhd'];
/** Device size of a picture of `logical` size (e.g. a 1920×1080 graphic) under a profile. */
export const deviceSize = (logical: { w: number; h: number }, p: OutputProfile) => ({ w: Math.round(logical.w * p.scale), h: Math.round(logical.h * p.scale) });

/**
 * Device pixels per logical unit for a box of w×h device px. A value within 0.5 % of a whole number is snapped to it
 * (3840 → exactly 2), so text, borders and hairlines land on whole device pixels; anything else (a preview pane)
 * gets the exact fit.
 */
export function deviceScale(w: number, h: number): number {
  const s = Math.min(w / CANVAS.w, h / CANVAS.h);
  if (!(s > 0)) return 1;
  const r = Math.round(s);
  return r >= 1 && Math.abs(s - r) / r < 0.005 ? r : s;
}

/** 16:9 camera geometry for 1, 2 and 3 tiles on a 1920x1080 canvas. */
const VIDEO_RECTS: Record<number, Rect[]> = {
  1: [{ x: 288, y: 150, w: 1344, h: 756 }],
  2: [
    { x: 60, y: 290, w: 880, h: 495 },
    { x: 980, y: 290, w: 880, h: 495 },
  ],
  3: [
    { x: 48, y: 372, w: 592, h: 333 },
    { x: 664, y: 372, w: 592, h: 333 },
    { x: 1280, y: 372, w: 592, h: 333 },
  ],
};

/** Identity-card geometry for audio-only mode (no cameras on screen). */
const CARD_RECTS: Record<number, Rect[]> = {
  1: [{ x: 560, y: 320, w: 800, h: 440 }],
  2: [
    { x: 250, y: 330, w: 680, h: 420 },
    { x: 990, y: 330, w: 680, h: 420 },
  ],
  3: [
    { x: 105, y: 340, w: 540, h: 400 },
    { x: 690, y: 340, w: 540, h: 400 },
    { x: 1275, y: 340, w: 540, h: 400 },
  ],
};

/**
 * Boxed caster frames, measured from the original 2560x1440 templates
 * (×0.75): 7.5px black border, 66.75px name bar with 60px trophy box, and a
 * 190x42 grey tag hanging under the bar. Rect = border + camera + bar.
 */
export const BNL = { border: 7.5, bar: 66.75, trophy: 60, tagW: 190.5, tagH: 42 } as const;
const BNL_RECTS: Record<number, Rect[]> = {
  1: [{ x: 420, y: 156, w: 1080, h: 7.5 + 608 + 66.75 }],
  2: [
    { x: 66.75, y: 250.5, w: 879.75, h: 606.75 },
    { x: 974.25, y: 250.5, w: 879.75, h: 606.75 },
  ],
  3: [
    { x: 48, y: 250.5, w: 585.75, h: 606.75 },
    { x: 667.5, y: 250.5, w: 585.75, h: 606.75 },
    { x: 1286.25, y: 250.5, w: 585.75, h: 606.75 },
  ],
};

export function camRect(r: Rect, theme: ThemeId): Rect {
  if (theme !== 'bnl') return r;
  return { x: r.x + BNL.border, y: r.y + BNL.border, w: r.w - BNL.border * 2, h: r.h - BNL.border - BNL.bar };
}

const CAP: Record<string, number> = { solo: 1, duo: 2, trio: 3, auto: 3, mixed: 3, audio: 3 };

function tileKind(c: Caster, audio: boolean): TileKind {
  if (audio || !c.cameraOn) return 'card';
  switch (c.source.type) {
    case 'obs': return 'obs';
    case 'none': return 'card'; // camera "on" but nothing to show: branded card, never a black box
    default: return 'video';
  }
}

/** Casters that occupy a slot on screen, in order. */
export function visibleCasters(scene: Scene): Caster[] {
  const audio = scene.layout === 'audio';
  return scene.casters.filter(c => c.enabled && (audio || c.cameraOn || c.offMode === 'card'));
}

/**
 * Turn a scene into concrete tiles. `forced` comes from route-specific outputs
 * (/output/solo etc.) and caps the tile count; layouts always adapt downwards
 * so a disabled caster never leaves an empty box.
 */
export function compose(scene: Scene, forced?: ForcedLayout, theme: ThemeId = 'classic'): Composition {
  const audio = scene.layout === 'audio';
  const cap = Math.min(CAP[scene.layout] ?? 3, forced ? CAP[forced] : 3);
  const shown = visibleCasters(scene).slice(0, cap);
  const n = shown.length;
  const table = theme === 'bnl' ? BNL_RECTS : audio ? CARD_RECTS : VIDEO_RECTS;
  const rects = n === 0 ? [] : table[n];
  const tiles: Tile[] = shown.map((c, i) => ({
    casterId: c.id,
    kind: tileKind(c, audio),
    rect: rects[i],
    cam: camRect(rects[i], theme),
    showName: scene.showNames && c.showName,
  }));
  return {
    tiles,
    arrangement: n === 0 ? 'none' : n === 1 ? 'solo' : n === 2 ? 'duo' : 'trio',
    audioMode: audio,
    background: audio || scene.showBackground,
  };
}

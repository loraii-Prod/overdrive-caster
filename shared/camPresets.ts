/**
 * Overdrive 3.4 — Desk Camera Presets.
 *
 * Camera layout presets for the OBS-composited desk camera engine. Each preset defines where every
 * camera source sits in the 1920×1080 canvas, with optional crop and visibility. The camera engine
 * applies these as OBS scene-item transforms on the A/B desk scene pair.
 *
 * Built-in presets are derived from the skin's hole rects (the same geometry the browser-source
 * renderer uses for frame transparency). Custom presets are saved by the producer.
 */
import type { Rect } from './skins';
import type { TalentCrop } from './talent';
import type { MainKey } from './obsLayout';

// ---- Types ----

export interface DeskCamLayout {
  /** Talent seat (1–6). */
  seat: number;
  /** Camera rect in 1920×1080 canvas coordinates. */
  rect: Rect;
  /** Crop: zoom + offset. Reuses the existing TalentCrop shape. */
  crop?: TalentCrop;
  /** Visible in this preset (default true). */
  visible?: boolean;
  /** Z-order within the camera group (lower = further back). */
  zIndex?: number;
}

export interface CamEngineState {
  /** Which variant is Program: 'A' or 'B'. */
  program: 'A' | 'B';
  /** Current preset on Program (id). */
  programPreset: string | null;
  /** Prepared preset on Preview (id), null = same as Program. */
  previewPreset: string | null;
  /** Move Transition plugin detected. */
  hasMoveTransition: boolean;
  /** Animation in progress. */
  animating: boolean;
}

export interface DeskCamPreset {
  id: string;
  name: string;
  /** Which desk this applies to. */
  desk: MainKey;
  /** Per-camera layout. Only cameras listed here are visible; unlisted ones are hidden. */
  cameras: DeskCamLayout[];
  /** Animation duration in ms (default 500). */
  duration?: number;
  /** Easing (default 'ease-out'). */
  easing?: 'ease-out' | 'ease-in-out' | 'linear';
  /** System presets can't be deleted or renamed by the user. */
  builtin?: boolean;
  updatedAt: number;
}

// ---- Built-in preset generators ----

/** IDs for the system presets. */
export const BUILTIN_IDS = {
  'desk-trio': 'builtin:desk-trio',
  'desk-duo': 'builtin:desk-duo',
  'desk-solo': 'builtin:desk-solo',
  'panel-trio': 'builtin:panel-trio',
  'panel-duo': 'builtin:panel-duo',
  'panel-solo': 'builtin:panel-solo',
  'fullscreen': 'builtin:fullscreen',
} as const;

/**
 * Camera rects for the left-column "panel" mode (analyst desk with an analysis panel on the right).
 * Matches the browser-source deskLayout() in Desk.tsx.
 */
export function panelColumnRects(n: number): Rect[] {
  const w = n >= 3 ? 384 : n === 2 ? 600 : 900;
  const h = Math.round(w * 9 / 16);
  const gap = 16;
  const totalH = n * h + (n - 1) * gap;
  const startY = Math.round((1080 - totalH) / 2);
  const x = 80;
  return Array.from({ length: n }, (_, i) => ({
    x, y: startY + i * (h + gap), w, h,
  }));
}

/**
 * Generate the built-in presets for a desk, using the skin's hole rects.
 * Called once when the camera engine initializes (or when the skin changes).
 */
export function builtinPresets(desk: MainKey, holes: Record<'solo' | 'duo' | 'trio', Rect[]>): DeskCamPreset[] {
  const now = Date.now();
  const seats = desk === 'analyst-desk' ? [4, 5, 6] : [1, 2, 3];

  const makeFramePreset = (key: 'solo' | 'duo' | 'trio', id: string, name: string): DeskCamPreset => {
    const rects = holes[key];
    const count = key === 'solo' ? 1 : key === 'duo' ? 2 : 3;
    return {
      id, name, desk, builtin: true, updatedAt: now,
      cameras: seats.slice(0, count).map((seat, i) => ({ seat, rect: rects[i], visible: true })),
    };
  };

  const makePanelPreset = (n: number, id: string, name: string): DeskCamPreset => {
    const rects = panelColumnRects(n);
    return {
      id, name, desk, builtin: true, updatedAt: now,
      cameras: seats.slice(0, n).map((seat, i) => ({ seat, rect: rects[i], visible: true })),
    };
  };

  return [
    makeFramePreset('trio', BUILTIN_IDS['desk-trio'], 'Desk · Trio'),
    makeFramePreset('duo', BUILTIN_IDS['desk-duo'], 'Desk · Duo'),
    makeFramePreset('solo', BUILTIN_IDS['desk-solo'], 'Desk · Solo'),
    makePanelPreset(3, BUILTIN_IDS['panel-trio'], 'Panel · Trio'),
    makePanelPreset(2, BUILTIN_IDS['panel-duo'], 'Panel · Duo'),
    makePanelPreset(1, BUILTIN_IDS['panel-solo'], 'Panel · Solo'),
    {
      id: BUILTIN_IDS['fullscreen'], name: 'Fullscreen (no cameras)', desk, builtin: true, updatedAt: now,
      cameras: [], // All cameras hidden
    },
  ];
}

/**
 * Pick the right built-in preset for the current desk state.
 * Used by the hub to auto-select a camera layout when the desk panel or caster count changes.
 */
export function autoPresetId(mode: 'cams' | 'panel', casterCount: number): string {
  const n = Math.max(1, Math.min(3, casterCount));
  const key = n === 1 ? 'solo' : n === 2 ? 'duo' : 'trio';
  return mode === 'cams' ? BUILTIN_IDS[`desk-${key}`] : BUILTIN_IDS[`panel-${key}`];
}

/**
 * Validate a DeskCamLayout array: seats in range, rects within canvas, no duplicate seats.
 */
export function validateLayout(cameras: DeskCamLayout[]): string | null {
  const seen = new Set<number>();
  for (const cam of cameras) {
    if (cam.seat < 1 || cam.seat > 6) return `Invalid seat ${cam.seat}`;
    if (seen.has(cam.seat)) return `Duplicate seat ${cam.seat}`;
    seen.add(cam.seat);
    const { x, y, w, h } = cam.rect;
    if (w <= 0 || h <= 0) return `Camera ${cam.seat}: rect has no area`;
    if (x < -w || y < -h || x > 1920 || y > 1080) return `Camera ${cam.seat}: rect fully outside canvas`;
  }
  return null;
}

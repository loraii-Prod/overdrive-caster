/**
 * 4K asset replacements. A bundled Overdrive file (/brand/overdrive/<path>) with a higher-resolution version in
 * public/brand/overdrive/4k/<path>.<any ext> is swapped for it when the page renders at 4K (device scale ≥ 1.5).
 * 1080p outputs, the producer's previews and the server keep the original. Uploaded files are never touched.
 */
import { UHD_ASSETS } from './uhdAssets.generated';

let hi = false, scale = 1;
/** Set by the broadcast output canvas before the scene renders (on = 4K assets; s = device px per layout unit). */
export function setHiResAssets(on: boolean, s = on ? 2 : 1) { hi = on; scale = Number.isFinite(s) && s > 0 ? s : 1; }
export const hiResAssets = () => hi;
/** Device pixels per 1920×1080 layout unit on this broadcast output (2 at 3840×2160; 1 at 1080p and in previews). */
export const outputScale = () => scale;
const BASE = '/brand/overdrive/';
/** The 4K replacement of a bundled asset when rendering at 4K, else the URL unchanged. */
export function hiRes<T extends string | null | undefined>(url: T, table: Record<string, string> = UHD_ASSETS): T {
  if (!hi || !url || !url.startsWith(BASE) || url.startsWith(`${BASE}4k/`)) return url;
  const key = url.slice(BASE.length).split(/[?#]/)[0].replace(/\.[^./]+$/, '');
  return (table[key] ?? url) as T;
}
/** For tests. */
export const _resolve = (url: string, table: Record<string, string>, on: boolean) => { const prev = hi; hi = on; try { return hiRes(url, table); } finally { hi = prev; } };

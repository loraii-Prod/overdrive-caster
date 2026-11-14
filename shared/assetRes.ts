/**
 * 4K asset replacements. A bundled Overdrive file (/brand/overdrive/<path>) with a higher-resolution version in
 * public/brand/overdrive/4k/<path>.<any ext> is swapped for it when the page renders at 4K (device scale ≥ 1.5).
 * 1080p outputs, the producer's previews and the server keep the original. Uploaded files are never touched.
 */
import { UHD_ASSETS } from './uhdAssets.generated';

let hi = false;
/** Set by the broadcast output canvas before the scene renders. */
export function setHiResAssets(on: boolean) { hi = on; }
export const hiResAssets = () => hi;
const BASE = '/brand/overdrive/';
/** The 4K replacement of a bundled asset when rendering at 4K, else the URL unchanged. */
export function hiRes<T extends string | null | undefined>(url: T, table: Record<string, string> = UHD_ASSETS): T {
  if (!hi || !url || !url.startsWith(BASE) || url.startsWith(`${BASE}4k/`)) return url;
  const key = url.slice(BASE.length).split(/[?#]/)[0].replace(/\.[^./]+$/, '');
  return (table[key] ?? url) as T;
}
/** For tests. */
export const _resolve = (url: string, table: Record<string, string>, on: boolean) => { const prev = hi; hi = on; try { return hiRes(url, table); } finally { hi = prev; } };

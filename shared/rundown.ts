/**
 * Overdrive 2.0 — graphics rundown (shared by server and browser).
 * An item references ONE graphics instance and the data it should carry when taken: a saved preset of that
 * instance, a data snapshot taken when the item was added, or nothing (= whatever the instance has).
 * Taking an item acts inside that graphic's own browser source (IN / UPDATE / OUT). It never switches OBS.
 * The rundown is server state: every operator sees the same list, order and cue.
 */
export interface RundownItem {
  id: string;
  /** Graphics instance id (→ /g/<gfx>). */
  gfx: string;
  label: string;
  /** Name of a preset of that instance applied when taken, or null. */
  preset: string | null;
  /** Data snapshot (instance config) applied when taken, or null. Ignored when `preset` is set. */
  data: Record<string, string | number | boolean> | null;
  /** Last time the item was taken IN (for the operator), or null. */
  takenAt: number | null;
}

export interface Rundown {
  items: RundownItem[];
  /** The item that "Take next" will play, or null. */
  cue: string | null;
}

export const MAX_RUNDOWN = 80;
export const emptyRundown = (): Rundown => ({ items: [], cue: null });

const prim = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

export function sanitizeRundown(v: unknown): Rundown {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<Rundown>;
  const items: RundownItem[] = (Array.isArray(r.items) ? r.items : []).slice(0, MAX_RUNDOWN).flatMap((x: any) => {
    if (!x || typeof x.id !== 'string' || typeof x.gfx !== 'string') return [];
    const data = x.data && typeof x.data === 'object' ? Object.fromEntries(Object.entries(x.data).filter(([, w]) => prim(w))) as RundownItem['data'] : null;
    return [{ id: x.id.slice(0, 24), gfx: x.gfx.slice(0, 40), label: typeof x.label === 'string' ? x.label.slice(0, 80) : '', preset: typeof x.preset === 'string' ? x.preset.slice(0, 40) : null, data, takenAt: typeof x.takenAt === 'number' ? x.takenAt : null }];
  });
  const ids = new Set(items.map(i => i.id));
  const uniq = items.filter((i, k) => items.findIndex(j => j.id === i.id) === k);
  return { items: uniq, cue: typeof r.cue === 'string' && ids.has(r.cue) ? r.cue : null };
}

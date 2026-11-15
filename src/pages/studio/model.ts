/** Studio Mode 2.0: read-only helpers over the shared controller state (no state of their own). */
import type { ControllerState } from '../../../shared/types';
import { pkgById, type GfxInstance } from '../../../shared/gfx';
import { REGISTRY, AUD_SOURCES, outputRouteOf, type SourceDef } from '../../../shared/registry';
import { segmentIssues, segmentObsScene, readiness, type ObsLookup, type ReadyCtx, type Segment } from '../../../shared/showplan';
import { SEATS, type Seat } from '../../../shared/talent';
import { gfxCategory, sourceCategory, type Category } from '../producer/Library';

/** Producer selection key ('g:<id>' or '<source id>') ↔ show-plan target ('g:<id>' / 's:<id>'). */
export const selToTarget = (sel: string) => (sel.startsWith('g:') ? sel : `s:${sel}`);
export const targetToSel = (t: string) => (t.startsWith('g:') ? t : t.replace(/^s:/, ''));

export interface SceneEntry {
  key: string; // selection key
  target: string; // show-plan target
  name: string;
  kind: 'graphic' | 'scene';
  category: Category;
  route: string; // browser source path
  conns: number;
  gfx?: GfxInstance;
  src?: SourceDef;
}

export const conns = (st: ControllerState, route: string) => st.outputs.find(o => o.route === route)?.count ?? 0;

/** Every scene source and graphics instance the show can use (the Scene Library). */
export function sceneCatalogue(st: ControllerState): SceneEntry[] {
  const g = (st.graphics ?? []).map((x): SceneEntry => ({ key: `g:${x.id}`, target: `g:${x.id}`, name: x.name, kind: 'graphic', category: gfxCategory(x), route: `/g/${x.id}`, conns: conns(st, `g/${x.id}`), gfx: x }));
  const s = REGISTRY.map((x): SceneEntry => ({ key: x.id, target: `s:${x.id}`, name: x.name, kind: 'scene', category: sourceCategory(x), route: x.route, conns: conns(st, outputRouteOf(x)), src: x }));
  return [...g, ...s];
}

export function targetName(st: ControllerState, t: string | null): string {
  if (!t) return 'No scene';
  if (t.startsWith('g:')) return st.graphics?.find(g => g.id === t.slice(2))?.name ?? 'Deleted graphic';
  return REGISTRY.find(s => s.id === t.slice(2))?.name ?? 'Unknown scene';
}

export function obsLookup(st: ControllerState): ObsLookup {
  return {
    setupMap: (st.obsSetup?.map ?? {}) as ObsLookup['setupMap'],
    screenMap: st.showLive.obsScenes as Record<string, string | undefined>,
    graphics: st.graphics ?? [],
    registry: REGISTRY,
    scenes: st.obs.connected ? st.obs.scenes : [],
    pkgObsKey: p => pkgById(p)?.obsKey,
  };
}

export function readyCtx(st: ControllerState): ReadyCtx {
  const talent = st.talent ?? [];
  return {
    obs: obsLookup(st),
    obsConnected: st.obs.connected,
    conns: r => conns(st, r),
    seat: n => { const id = st.seats?.[n as Seat]; const t = talent.find(p => p.id === id); return t ? { name: t.name || t.id, live: t.mode === 'vdo' || t.publishing } : null; },
    playlist: st.media?.playlist ?? [],
  };
}

export function segReady(st: ControllerState, s: Segment) {
  const issues = segmentIssues(s, readyCtx(st));
  return { issues, level: readiness(issues), scene: segmentObsScene(s, obsLookup(st)) };
}

/** Everything that keeps the show from being ready, in one list (status bar + top bar). */
export function studioIssues(st: ControllerState): { level: 'error' | 'warn'; text: string; where: string }[] {
  const out: { level: 'error' | 'warn'; text: string; where: string }[] = [];
  if (!st.obs.connected) out.push({ level: st.obs.enabled ? 'error' : 'warn', text: st.obs.enabled ? `OBS offline${st.obs.error ? `: ${st.obs.error}` : ''}` : 'OBS is not set up', where: 'obs' });
  const unnamed = (st.talent ?? []).filter(t => t.seat && !t.name.trim()).length;
  if (unnamed) out.push({ level: 'warn', text: `${unnamed} seated talent need a name`, where: 'talent' });
  const offline = (st.talent ?? []).filter(t => t.seat && t.mode !== 'vdo' && !t.publishing).length;
  if (offline) out.push({ level: 'warn', text: `${offline} seated camera${offline === 1 ? '' : 's'} offline`, where: 'talent' });
  const bad = Object.values(st.gfxHealth ?? {}).filter(h => !h.ok).length;
  if (bad) out.push({ level: 'error', text: `${bad} graphic${bad === 1 ? '' : 's'} report an error`, where: 'obs' });
  for (const s of st.plan?.segments ?? []) {
    const r = segReady(st, s);
    if (r.level === 'error') out.push({ level: 'error', text: `${s.label}: ${r.issues.find(i => i.level === 'error')?.text}`, where: 'rundown' });
  }
  return out;
}

export const SEAT_GROUPS: { label: string; seats: Seat[] }[] = [
  { label: 'Caster desk', seats: [1, 2, 3] }, { label: 'Analyst desk', seats: [4, 5] }, { label: 'Interview', seats: [6] },
];
export { SEATS, AUD_SOURCES };

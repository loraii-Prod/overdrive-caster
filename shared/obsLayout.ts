/**
 * Overdrive 3.2 · SIMPLIFIED OBS LAYOUT (the "main scenes" layout of the Scene Builder).
 *
 * OBS gets nine broadcast scenes. Every other Overdrive output is a scene item (a "layer") inside one of them, using
 * the SAME browser source it always had (never a second copy, never a second WebRTC session):
 *  - base     the scene's own picture (Caster Desk → /g/caster-desk), always present;
 *  - panel    a full-screen alternative to the base (MVP views, brackets in Intermission, Map Veto in Gameplay…):
 *             showing one hides the base and the other panels of that scene;
 *  - overlay  drawn on top and toggled on its own (Scoreboard and Track Progression in Gameplay, QR in MVP…).
 *
 * Producer Mode switches layers with OBS scene-item visibility (SetSceneItemEnabled) and switches scenes with
 * Preview / Program, so a layer is prepared off-air in a scene that is not on Program and goes on air with TAKE.
 */
import { pkgById, type GfxInstance } from './gfx';

export type MainKey = 'starting' | 'gameplay' | 'caster-desk' | 'analyst-desk' | 'mvp' | 'intermission' | 'ending' | 'safe' | 'team-intro' | 'veto' | 'bracket' | 'matches';
/** 3.3: 'state' = a view drawn by the scene's own dynamic source (no OBS source of its own); 'pvw' = the scene's internal Preview identity. */
export type LayerRole = 'base' | 'panel' | 'overlay' | 'state' | 'pvw';
export type ObsLayoutMode = 'main' | 'per-output';

export interface MainSceneDef {
  key: MainKey;
  /** Scene name in OBS ("Overdrive · " + label). */
  label: string;
  /** Targets that can be the base, in order of preference (the first one that exists). */
  base: string[];
  /** Audio in this scene: caster mics + music, or music only (Safe: never a live mic). */
  audio: 'all' | 'music';
  /** Game capture under the base (Gameplay). */
  capture?: boolean;
  /** The base is another scene's base source, shared (Safe / BRB reuses the BRB card: no second browser source). */
  sharedBase?: boolean;
  /**
   * 3.3 unified renderer: ONE Program source draws every state of the scene; a second, internally managed Preview
   * identity (its own hidden-from-Producer OBS scene, muted) shows the prepared state in OBS Studio Mode Preview.
   */
  unified?: { gfx: string; preview: string };
}

/**
 * 3.3 Producer scene bank restructure: the nine Producer categories (Show Screens · Analyst Desk · Caster Desk ·
 * Team Introduction · Player MVP · Map Veto · Gameplay · Bracket · Matches) map onto these OBS main-scene keys.
 * Show Screens stays FOUR separate OBS scenes here (starting/intermission/safe/ending: different content, and
 * Safe is music-only audio with no mic) — the Producer groups them into one tile with a mode switcher, but the
 * underlying OBS scenes, audio routing and game-capture settings are unchanged. Map Veto, Bracket and Matches
 * are promoted from panels of Gameplay / Intermission to their own top-level main scenes (own OBS scene, own
 * base layer) so they can be dedicated Producer categories without adding a second browser source for each.
 */
export const MAIN_SCENES: MainSceneDef[] = [
  { key: 'starting', label: 'Starting Soon', base: ['s:starting'], audio: 'all' },
  { key: 'team-intro', label: 'Team Introduction', base: ['s:team-intro'], audio: 'all' },
  { key: 'caster-desk', label: 'Caster Desk', base: ['g:caster-desk', 's:caster-desk'], audio: 'all' },
  { key: 'analyst-desk', label: 'Analyst Desk', base: ['g:analyst-desk', 's:analyst-desk'], audio: 'all' },
  { key: 'gameplay', label: 'Gameplay', base: ['g:gameplay', 's:gameplay'], audio: 'all', capture: true },
  { key: 'mvp', label: 'MVP', base: ['g:mvp'], audio: 'all', unified: { gfx: 'mvp', preview: 'Overdrive · MVP (Preview identity)' } },
  { key: 'intermission', label: 'Intermission', base: ['s:brb'], audio: 'all' },
  { key: 'safe', label: 'Safe / BRB', base: ['s:brb'], audio: 'music', sharedBase: true },
  { key: 'ending', label: 'Ending', base: ['s:ending'], audio: 'all' },
  { key: 'veto', label: 'Map Veto', base: ['s:veto'], audio: 'all' },
  { key: 'bracket', label: 'Bracket', base: ['s:bracket'], audio: 'all' },
  { key: 'matches', label: 'Matches', base: ['s:matches'], audio: 'all' },
];
export const mainDef = (k: string) => MAIN_SCENES.find(m => m.key === k);
export const mainSceneName = (k: MainKey) => `Overdrive · ${mainDef(k)!.label}`;
/** Mapping / rundown target of a main scene itself (its base state). */
export const mainTarget = (k: MainKey) => `main:${k}`;
export const isMainTarget = (t: string) => /^main:/.test(t);

/** Where a scene source (registry id) lives. */
const SOURCE_PLACE: Record<string, { main: MainKey; role: LayerRole }> = {
  starting: { main: 'starting', role: 'base' },
  'team-intro': { main: 'team-intro', role: 'base' },
  'caster-desk': { main: 'caster-desk', role: 'base' },
  'analyst-desk': { main: 'analyst-desk', role: 'base' },
  gameplay: { main: 'gameplay', role: 'base' },
  brb: { main: 'intermission', role: 'base' },
  ending: { main: 'ending', role: 'base' },
  scoreboard: { main: 'gameplay', role: 'overlay' },
  veto: { main: 'veto', role: 'base' },
  interview: { main: 'caster-desk', role: 'panel' },
  // Upper / Lower are still fixed-view panels of the Bracket main scene (never two halves on one page).
  'bracket-upper': { main: 'bracket', role: 'panel' },
  standings: { main: 'bracket', role: 'panel' },
  bracket: { main: 'bracket', role: 'base' },
  matches: { main: 'matches', role: 'base' },
  media: { main: 'intermission', role: 'panel' },
  // 3.3: the five MVP views are STATES of the one /g/mvp Program source (no OBS source each)
  mvp: { main: 'mvp', role: 'state' },
  'mvp-closed': { main: 'mvp', role: 'state' },
  'mvp-winner': { main: 'mvp', role: 'state' },
  'mvp-desk': { main: 'mvp', role: 'state' },
  'mvp-compare': { main: 'mvp', role: 'state' },
};
/** Where a graphic lives, by its package renderer (custom instances follow their package). */
const RENDERER_PLACE: Record<string, { main: MainKey; role: LayerRole }> = {
  'caster-desk': { main: 'caster-desk', role: 'base' },
  'analyst-desk': { main: 'analyst-desk', role: 'base' },
  gameplay: { main: 'gameplay', role: 'base' },
  mvp: { main: 'mvp', role: 'base' },
  scoreboard: { main: 'gameplay', role: 'overlay' },
  track: { main: 'gameplay', role: 'overlay' },
  bracket: { main: 'bracket', role: 'base' },
  pickem: { main: 'caster-desk', role: 'overlay' },
  qr: { main: 'mvp', role: 'overlay' },
};

/**
 * The main scene and role of an output. A graphic is the base only when it is its package's default instance
 * (/g/caster-desk); another instance of the same package is a panel of that scene. Unknown outputs: Gameplay overlay.
 */
export function placeOf(id: string, graphics: Pick<GfxInstance, 'id' | 'pkg'>[]): { main: MainKey; role: LayerRole } {
  if (id.startsWith('s:')) return SOURCE_PLACE[id.slice(2)] ?? { main: 'gameplay', role: 'overlay' };
  const g = graphics.find(x => `g:${x.id}` === id);
  const p = g ? pkgById(g.pkg) : undefined;
  const pl = p ? RENDERER_PLACE[p.renderer] : undefined;
  if (!pl) return { main: 'gameplay', role: 'overlay' };
  if (pl.role === 'base' && p!.id.replace(/^od\./, '') !== g!.id) return { main: pl.main, role: 'panel' };
  return pl;
}

// ---- 3.4 Camera composition: persistent camera inputs and A/B scene pairs for desks ----

/** Desks that use OBS-composited cameras (caster-desk, analyst-desk). */
export const DESK_SCENES: MainKey[] = ['caster-desk', 'analyst-desk'];
export const isDeskScene = (k: MainKey) => DESK_SCENES.includes(k);

/** OBS input name for a persistent VDO.Ninja camera feed (one per talent seat, shared across all scenes). */
export const cameraInputName = (seat: number) => `Overdrive · Camera ${seat}`;
/** OBS scene name for the B variant of a desk scene (A/B pair for Preview/Program isolation). */
export const bSceneName = (k: MainKey) => `${mainSceneName(k)} (B)`;
/** Seats used by each desk. */
export const DESK_SEATS: Record<string, number[]> = {
  'caster-desk': [1, 2, 3],
  'analyst-desk': [4, 5, 6],
};

/** Which items of a main scene to show for a target: the target on; base/panels it replaces off; overlays untouched. */
export function layerSwitch(target: string, all: { target: string; role: LayerRole }[]): { on: string[]; off: string[] } {
  const items = all.filter(i => i.role === 'base' || i.role === 'panel' || i.role === 'overlay');
  const me = items.find(i => i.target === target);
  if (!me) return { on: [], off: [] };
  if (me.role === 'overlay') return { on: [target], off: [] };
  return { on: [target], off: items.filter(i => i.target !== target && i.role !== 'overlay').map(i => i.target) };
}

/**
 * Overdrive 3.0 · MAIN SCENES: the show's core scenes as one row of tiles in Producer Mode (Preview → TAKE / CUT /
 * AUTO), MVP included as a core scene. A tile is a Producer selection (what the 1920×1080 preview and the controls
 * show) plus a rundown / OBS target (what TAKE puts on Program, through the Scene Builder's mapping).
 *
 * MVP is ONE tile for its five views (Voting · Closed · Community reveal · Analyst reveal · Comparison): it follows
 * the MVP flow (the view the next step needs), and remembers the view the producer picked inside the MVP panel.
 */
import { REGISTRY } from './registry';
import { mvpStage, type MvpFlowIn, type MvpView } from './mvpFlow';

export interface MainSceneMode { id: string; label: string; sel: string; target: string }

export interface MainScene {
  id: string;
  label: string;
  /** Producer selection key ('g:<graphic>' or a scene source id). MVP: the selected / suggested view's source. */
  sel: string;
  /** Rundown / OBS target ('g:<id>' or 's:<id>'). */
  target: string;
  /**
   * 3.3: internal modes of one main scene (e.g. Show Screens' four cards). Each mode is its own existing
   * registry source / rundown target — no new OBS scene, no new top-level tile. The producer picks a mode in
   * the scene's context panel; the tile previews whichever mode was last picked (default: modes[0]).
   */
  modes?: MainSceneMode[];
}

/** Scene source of each MVP view (registry ids; 'mvp' keeps its 2.x id). */
export const MVP_SOURCE: Record<MvpView, string> = { voting: 'mvp', closed: 'mvp-closed', winner: 'mvp-winner', desk: 'mvp-desk', compare: 'mvp-compare' };
export const MVP_VIEW_LABEL: Record<MvpView, string> = { voting: 'Voting', closed: 'Closed', winner: 'Community reveal', desk: 'Analyst reveal', compare: 'Comparison' };
export const isMvpSel = (sel: string) => Object.values(MVP_SOURCE).includes(sel);
export const mvpViewOfSel = (sel: string): MvpView | null => (Object.entries(MVP_SOURCE).find(([, s]) => s === sel)?.[0] as MvpView) ?? null;

/** The MVP view the flow needs next (what the MVP tile opens on). */
export function suggestedMvpView(i: MvpFlowIn): MvpView {
  switch (mvpStage(i)) {
    case 'none': case 'prepared': case 'open': return 'voting';
    case 'closed': return 'closed';
    case 'ready': return 'winner';
    case 'community': return i.desk ? 'desk' : 'winner';
    case 'analyst': return 'compare';
    case 'compare': return 'compare';
  }
}

const S = (id: string, label: string, sel: string, target: string): MainScene => ({ id, label, sel, target });
const M = (id: string, label: string, sel: string, target: string): MainSceneMode => ({ id, label, sel, target });

/**
 * 3.3: the nine main-scene categories (Producer scene bank restructure). Each is still ONE existing registry
 * source / graphic — 'Show Screens' is the one category with internal modes, consolidating four scenes that
 * were previously four separate top-level tiles (Starting Soon, the BRB emergency hold, Intermission, Ending)
 * into one tile with a mode switcher in its context panel. No new OBS scene or browser source was added for
 * this restructure: every mode/category below maps to a source that already existed.
 */
export const SHOW_MODES: MainSceneMode[] = [
  M('starting', 'Starting Soon', 'starting', 's:starting'),
  M('safe', 'Be Right Back', 'main:safe', 'main:safe'),
  M('brb', 'Intermission', 'brb', 's:brb'),
  M('ending', 'Thanks for Watching', 'ending', 's:ending'),
];

/** In show order. MVP's sel / target are filled by mainScenes() from the MVP flow; Show Screens' from its mode. */
export const MAIN_SCENE_DEFS: MainScene[] = [
  { ...S('show', 'Show Screens', SHOW_MODES[0].sel, SHOW_MODES[0].target), modes: SHOW_MODES },
  S('analyst-desk', 'Analyst Desk', 'g:analyst-desk', 'g:analyst-desk'),
  S('caster-desk', 'Caster Desk', 'g:caster-desk', 'g:caster-desk'),
  S('team-intro', 'Team Introduction', 'team-intro', 's:team-intro'),
  S('mvp', 'Player MVP', MVP_SOURCE.voting, `s:${MVP_SOURCE.voting}`),
  S('veto', 'Map Veto', 'veto', 's:veto'),
  S('gameplay', 'Gameplay', 'g:gameplay', 'g:gameplay'),
  S('bracket', 'Bracket', 'bracket', 's:bracket'),
  S('matches', 'Matches', 'matches', 's:matches'),
];
/** What a selection draws (Safe / BRB draws the BRB card). */
export const drawKeyOf = (sel: string) => (sel === 'main:safe' ? 'brb' : sel);

/** The mode of 'show' whose sel matches (for the mode switcher's selected state); defaults to the first. */
export const showModeOfSel = (sel: string): MainSceneMode => SHOW_MODES.find(m => m.sel === sel) ?? SHOW_MODES[0];
export const isShowSel = (sel: string) => SHOW_MODES.some(m => m.sel === sel);

/**
 * The main scenes for this show: graphics that exist, MVP on the view the producer is on (else the flow's
 * next), Show Screens on the mode the producer last picked (else Starting Soon).
 */
export function mainScenes(graphics: { id: string }[], mvp: { flow: MvpFlowIn; selected: MvpView | null }, showMode?: string): MainScene[] {
  return MAIN_SCENE_DEFS.filter(s => !s.sel.startsWith('g:') || graphics.some(g => g.id === s.sel.slice(2)))
    .filter(s => s.sel.startsWith('g:') || s.sel.startsWith('main:') || s.id === 'mvp' || s.id === 'show' || REGISTRY.some(r => r.id === s.sel))
    .map(s => {
      if (s.id === 'mvp') {
        const view = mvp.selected ?? suggestedMvpView(mvp.flow);
        return { ...s, sel: MVP_SOURCE[view], target: `s:${MVP_SOURCE[view]}` };
      }
      if (s.id === 'show' && showMode) {
        const m = SHOW_MODES.find(x => x.id === showMode) ?? SHOW_MODES[0];
        return { ...s, sel: m.sel, target: m.target };
      }
      return s;
    });
}

/**
 * A MainScene-shaped lookup for a raw Producer selection, whether it's a top-level def's own sel or one of
 * Show Screens' mode sels (e.g. 'main:safe'). Used where code previously found 'safe' directly in
 * MAIN_SCENE_DEFS before Show Screens consolidated it into a mode.
 */
export function sceneOrModeOf(sel: string): MainScene | undefined {
  const top = MAIN_SCENE_DEFS.find(m => m.sel === sel);
  if (top) return top;
  const mode = SHOW_MODES.find(m => m.sel === sel);
  if (!mode) return undefined;
  const show = MAIN_SCENE_DEFS.find(s => s.id === 'show')!;
  return { ...show, sel: mode.sel, target: mode.target };
}

/** Which main scene a Producer selection belongs to (MVP: any of its views; Show Screens: any of its modes). */
export function mainSceneOf(sel: string, list: MainScene[]): MainScene | undefined {
  if (isMvpSel(sel)) return list.find(s => s.id === 'mvp');
  if (isShowSel(sel)) return list.find(s => s.id === 'show');
  return list.find(s => s.sel === sel);
}

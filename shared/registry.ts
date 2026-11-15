/**
 * Overdrive 2.0 Graphics Registry + Module Registry.
 *
 * Every broadcast scene is an independent full-canvas OBS browser source (its own URL), designed on the 1920×1080
 * logical grid and rendered at the output profile's size (3840×2160 at 4K). OBS does the final
 * switching and transitions; Overdrive controls what each source shows. The Producer Console previews the
 * selected source with the same components the source renders, and loads the scene's modules.
 *
 * Modules are reusable control panels; each scene lists its default modules, and Studio Mode can reorder,
 * hide, add or pin them per scene (saved on the server). All modules talk to the one production engine.
 */
import type { ScreenId } from './types';

export type ModuleId =
  | 'talent-casters' | 'talent-analysts' | 'talent-guest' | 'cameras' | 'scoreboard' | 'match' | 'predictions'
  | 'stats' | 'h2h' | 'media' | 'countdown' | 'graphics' | 'bracket' | 'music' | 'veto' | 'interview' | 'intro' | 'showcase'
  | 'pickems' | 'mvp' | 'qr';

export const MODULES: Record<ModuleId, { name: string; about: string }> = {
  'talent-casters': { name: 'Talent · Caster desk', about: '3 caster positions (left / center / right), Solo / Duo / Trio, assign any talent' },
  'talent-analysts': { name: 'Talent · Analyst desk', about: '2 analyst positions, Solo / Duo, a caster joining the desk' },
  'talent-guest': { name: 'Talent · Interview guest', about: 'Who is in the interview guest position' },
  cameras: { name: 'Camera manager', about: 'Camera on/off per position, connection health, re-sync a feed' },
  scoreboard: { name: 'Scoreboard', about: 'Scoreboard on/off, series score, matchup bar' },
  match: { name: 'Match manager', about: 'The match being cast (teams, logos, format) for every graphic' },
  predictions: { name: 'Predictions', about: "Talent predictions for the cast match and their badges" },
  stats: { name: 'Statistics', about: 'Analyst desk panel: player stats, Pick\'em, player in focus' },
  h2h: { name: 'Head-to-head', about: 'Head-to-head panel and VS strip on the analyst desk' },
  media: { name: 'Media player', about: 'Playlist, play / pause / stop, volume, auto-advance' },
  countdown: { name: 'Countdown', about: 'Start / extend / stop the "starts in" countdown' },
  graphics: { name: 'Graphics trigger', about: 'Map card, Replay / Highlights, clear popups, Champions' },
  pickems: { name: "Pick'ems", about: 'Public picks per match (lock / reopen), the desk picks, the reveal steps, the community record' },
  mvp: { name: 'Community MVP', about: 'Eligible players, open / close voting, private counts, the desk MVP, the winner reveal' },
  qr: { name: 'QR codes', about: 'Choose an approved link, preview it, position, show / hide' },
  bracket: { name: 'Tournament bracket', about: 'Upper / lower half on screen, auto switch, match states' },
  music: { name: 'Music & audio', about: "This scene's music bed, level, skip, master on/off" },
  veto: { name: 'Map veto', about: 'Pick / ban the maps in order, undo, reset, team PBs' },
  interview: { name: 'Interview', about: 'Player, host, title, question and lower third' },
  intro: { name: 'Team introduction', about: 'Play / stop the VS team intro' },
  showcase: { name: 'Player showcase', about: 'Which team / player the cards show and how long' },
};

export type SourceCategory = 'Desk' | 'Game' | 'Overlay' | 'Bracket' | 'Intermission' | 'Interview' | 'Media' | 'Audience' | 'MVP & Awards';

export interface SourceDef {
  id: string;
  name: string;
  category: SourceCategory;
  /** Scene component rendered by this source (screen sources). */
  screen?: ScreenId;
  /** Non-screen renderers (overlays / media). */
  view?: 'scoreboard' | 'media' | 'standings';
  /** Scene drawn by a graphics-engine instance (its browser source is /g/<gfx>; no second source is built). */
  gfx?: string;
  /** MVP & Awards scenes: the fixed view of the MVP graphic this scene shows (its source is /g/mvp?view=<view>). */
  gfxView?: import('./mvpFlow').GfxView;
  /** The independent OBS browser source (1920×1080). */
  route: string;
  /** OBS scene key in the scene mapping (Build scenes in OBS uses the screen ids). */
  obsKey?: string;
  /** LOGICAL size (1920×1080 grid units); the device size comes from the output profile (×2 at 4K). */
  resolution: [number, number];
  animations: string[];
  /** Default modules, in order (Studio Mode can change this per scene). */
  modules: ModuleId[];
  note?: string;
}

const MVPV = (id: string, name: string, view: import('./mvpFlow').MvpView, animations: string[], note: string): SourceDef =>
  ({ id, name, category: 'MVP & Awards', gfx: 'mvp', gfxView: view, route: `/g/mvp?view=${view}`, resolution: [1920, 1080], animations, modules: ['mvp', 'qr'], note });
const S = (id: string, name: string, category: SourceCategory, screen: ScreenId, modules: ModuleId[], animations: string[], note?: string): SourceDef =>
  ({ id, name, category, screen, route: `/output/screen/${screen}`, obsKey: screen, resolution: [1920, 1080], animations, modules, note });

export const REGISTRY: SourceDef[] = [
  S('caster-desk', 'Caster Desk', 'Desk', 'casters', ['talent-casters', 'cameras', 'predictions', 'match', 'countdown', 'music'], ['Layout crossfade', 'Name bars', 'Prediction badges']),
  S('analyst-desk', 'Analyst Desk', 'Desk', 'analysis', ['talent-analysts', 'cameras', 'stats', 'h2h', 'predictions', 'countdown', 'music'], ['Panel rise', 'Prediction rows', 'VS strip']),
  S('gameplay', 'Gameplay', 'Game', 'gameplay', ['match', 'scoreboard', 'graphics', 'music'], ['Map card', 'Replay / Highlights', 'Result popups']),
  { id: 'scoreboard', name: 'Scoreboard', category: 'Overlay', view: 'scoreboard', route: '/output/scoreboard', resolution: [1920, 1080], animations: ['Slide in / out', 'Score roll'], modules: ['scoreboard', 'match'] },
  S('team-intro', 'Team intro / Player showcase', 'Desk', 'warmup', ['intro', 'showcase', 'predictions', 'match', 'countdown', 'music'], ['VS intro', 'Player cards'], 'The "Player / team card" scene: team introduction and player showcase.'),
  S('veto', 'Map Veto', 'Game', 'veto', ['veto', 'match', 'music'], ['Pick / ban stamps', 'PB comparison']),
  S('interview', 'Interview', 'Interview', 'interview', ['interview', 'talent-guest', 'cameras', 'music'], ['Lower third', 'Question bar']),
  // Upper and lower bracket are separate scenes, each with its own browser source (fixed views of the bracket graphic):
  // never the two halves on one page. 'standings' keeps its id so saved rundowns open on the Lower Bracket.
  { id: 'bracket-upper', name: 'Upper Bracket', category: 'Bracket', gfx: 'bracket', gfxView: 'upper', route: '/g/bracket?view=upper', resolution: [1920, 1080], animations: ['Rows race in', 'Score pop'], modules: ['bracket', 'match', 'music'], note: 'Upper quarter-finals → semi-finals → upper final, and the grand final.' },
  { id: 'standings', name: 'Lower Bracket', category: 'Bracket', gfx: 'bracket', gfxView: 'lower', route: '/g/bracket?view=lower', resolution: [1920, 1080], animations: ['Rows race in', 'Score pop'], modules: ['bracket', 'match', 'music'], note: 'Lower round 1 → quarter-finals → semi-final → lower final, full width.' },
  S('bracket', 'Bracket (both halves)', 'Bracket', 'bracket', ['bracket', 'match', 'music'], ['Rows race in', 'Score pop']),
  S('matches', 'Matches', 'Bracket', 'matches', ['match', 'bracket', 'music'], ['Cards stagger in']),
  S('starting', 'Starting Soon', 'Intermission', 'starting', ['countdown', 'match', 'music'], ['Card build-in', 'Countdown']),
  S('brb', 'BRB', 'Intermission', 'brb', ['countdown', 'match', 'music'], ['Card build-in']),
  S('ending', 'Ending', 'Intermission', 'ending', ['countdown', 'graphics', 'music'], ['Card build-in', 'Champions']),
  { id: 'media', name: 'Media Playback', category: 'Media', view: 'media', route: '/output/media', resolution: [1920, 1080], animations: ['Fade between items'], modules: ['media'] },
  // MVP & Awards: five scenes, each a fixed view of the ONE MVP graphic (same data, same native-4K renderer, same
  // portraits and animations), each with its own OBS browser source /g/mvp?view=<view>. 'mvp' keeps its id so show
  // plans that used the MVP scene now open on Voting Open. The plain /g/mvp source still follows the MVP sequence.
  MVPV('mvp', 'Community MVP — Voting Open', 'voting', ['Voting cards', 'Live totals', 'QR / chat'], 'Candidates, QR (and Twitch chat command), countdown, optional live totals.'),
  MVPV('mvp-closed', 'Community MVP — Voting Closed', 'closed', ['Votes are in'], 'The voting graphic in its closed state: no result shown.'),
  MVPV('mvp-winner', 'Community MVP — Winner Reveal', 'winner', ['Award reveal (9 beats)'], 'Draws the winner only after the producer authorizes the reveal (TAKE / GO). Frozen result only.'),
  MVPV('mvp-desk', 'Analyst MVP — Winner Reveal', 'desk', ['Award reveal'], 'The analyst desk pick; drawn after the producer authorizes the reveal.'),
  MVPV('mvp-compare', 'Community vs Analyst MVP — Comparison', 'compare', ['Comparison'], 'Both winners side by side; drawn after the producer authorizes it.'),
];

/** Producer modules of the audience graphics (graphics-engine only: no scene source, not in the OBS builder). */
const AUD = (id: string, name: string, route: string, modules: ModuleId[]): SourceDef => ({ id, name, category: 'Overlay', route, resolution: [1920, 1080], animations: ['Step reveals'], modules });
export const AUD_SOURCES: Record<string, SourceDef> = {
  pickem: AUD('aud-pickem', "Pick'ems", '/g/pickem', ['pickems', 'predictions', 'qr']),
  mvp: AUD('aud-mvp', 'Community MVP', '/g/mvp', ['mvp', 'qr']),
  qr: AUD('aud-qr', 'Voting QR', '/g/qr', ['qr', 'pickems', 'mvp']),
};

export const sourceById = (id: string) => REGISTRY.find(s => s.id === id);

/** Studio Mode: per-scene module layout (order = shown order; pinned modules come first and stay expanded). */
/** The route a scene's browser source reports (connection counts): 'g/mvp?view=winner', 'g/scoreboard', 'screen/casters'. */
export function outputRouteOf(s: SourceDef): string {
  if (s.gfx) return `g/${s.gfx}${s.gfxView ? `?view=${s.gfxView}` : ''}`;
  return s.route.replace(/^\/output\//, '').split('?')[0];
}

export interface StudioScene { modules: ModuleId[]; pinned: ModuleId[] }
export type Studio = { scenes: Record<string, StudioScene> };

export function studioFor(studio: Studio | undefined, id: string): StudioScene {
  const def = sourceById(id)?.modules ?? [];
  const s = studio?.scenes[id];
  return s ? { modules: s.modules.filter(m => m in MODULES), pinned: s.pinned.filter(m => s.modules.includes(m)) } : { modules: def, pinned: [] };
}

export function sanitizeStudio(v: any): Studio {
  const scenes: Record<string, StudioScene> = {};
  const src = v?.scenes && typeof v.scenes === 'object' ? v.scenes : {};
  for (const s of REGISTRY) {
    const x = src[s.id];
    if (!x || !Array.isArray(x.modules)) continue;
    const modules = [...new Set(x.modules.filter((m: unknown): m is ModuleId => typeof m === 'string' && m in MODULES))] as ModuleId[];
    scenes[s.id] = { modules, pinned: Array.isArray(x.pinned) ? x.pinned.filter((m: ModuleId) => modules.includes(m)) : [] };
  }
  return { scenes };
}

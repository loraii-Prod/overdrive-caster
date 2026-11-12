/**
 * Overdrive 2.0 Graphics Registry + Module Registry.
 *
 * Every broadcast scene is an independent 1920×1080 OBS browser source (its own URL). OBS does the final
 * switching and transitions; Overdrive controls what each source shows. The Producer Console previews the
 * selected source with the same components the source renders, and loads the scene's modules.
 *
 * Modules are reusable control panels; each scene lists its default modules, and Studio Mode can reorder,
 * hide, add or pin them per scene (saved on the server). All modules talk to the one production engine.
 */
import type { ScreenId } from './types';

export type ModuleId =
  | 'talent-casters' | 'talent-analysts' | 'talent-guest' | 'cameras' | 'scoreboard' | 'match' | 'predictions'
  | 'stats' | 'h2h' | 'media' | 'countdown' | 'graphics' | 'bracket' | 'music' | 'veto' | 'interview' | 'intro' | 'showcase';

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
  bracket: { name: 'Tournament bracket', about: 'Upper / lower half on screen, auto switch, match states' },
  music: { name: 'Music & audio', about: "This scene's music bed, level, skip, master on/off" },
  veto: { name: 'Map veto', about: 'Pick / ban the maps in order, undo, reset, team PBs' },
  interview: { name: 'Interview', about: 'Player, host, title, question and lower third' },
  intro: { name: 'Team introduction', about: 'Play / stop the VS team intro' },
  showcase: { name: 'Player showcase', about: 'Which team / player the cards show and how long' },
};

export type SourceCategory = 'Desk' | 'Game' | 'Overlay' | 'Bracket' | 'Intermission' | 'Interview' | 'Media';

export interface SourceDef {
  id: string;
  name: string;
  category: SourceCategory;
  /** Scene component rendered by this source (screen sources). */
  screen?: ScreenId;
  /** Non-screen renderers (overlays / media). */
  view?: 'scoreboard' | 'media' | 'standings';
  /** The independent OBS browser source (1920×1080). */
  route: string;
  /** OBS scene key in the scene mapping (Build scenes in OBS uses the screen ids). */
  obsKey?: string;
  resolution: [number, number];
  animations: string[];
  /** Default modules, in order (Studio Mode can change this per scene). */
  modules: ModuleId[];
  note?: string;
}

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
  S('bracket', 'Bracket', 'Bracket', 'bracket', ['bracket', 'match', 'music'], ['Rows race in', 'Score pop']),
  { id: 'standings', name: 'Standings', category: 'Bracket', view: 'standings', route: '/output/major?part=2', resolution: [1920, 1080], animations: ['Rows race in'], modules: ['bracket', 'match'], note: 'Lower bracket + standings (bracket part 2) as its own source.' },
  S('matches', 'Matches', 'Bracket', 'matches', ['match', 'bracket', 'music'], ['Cards stagger in']),
  S('starting', 'Starting Soon', 'Intermission', 'starting', ['countdown', 'match', 'music'], ['Card build-in', 'Countdown']),
  S('brb', 'BRB', 'Intermission', 'brb', ['countdown', 'match', 'music'], ['Card build-in']),
  S('ending', 'Ending', 'Intermission', 'ending', ['countdown', 'graphics', 'music'], ['Card build-in', 'Champions']),
  { id: 'media', name: 'Media Playback', category: 'Media', view: 'media', route: '/output/media', resolution: [1920, 1080], animations: ['Fade between items'], modules: ['media'] },
];

export const sourceById = (id: string) => REGISTRY.find(s => s.id === id);

/** Studio Mode: per-scene module layout (order = shown order; pinned modules come first and stay expanded). */
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

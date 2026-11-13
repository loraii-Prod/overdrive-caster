/**
 * Overdrive Graphics Engine — package contract.
 *
 * A graphics PACKAGE declares what a graphic is (renderer id, resolution, typed properties, data bindings,
 * animations, assets, commands, defaults, permissions). An INSTANCE is one live copy of a package with its own
 * id, browser-source URL (/g/<instance id>), configuration, draft, animation state and health. Several instances
 * of the same package can run with different data. The operator controls (Inspector) are generated from the
 * package declaration; no producer page is written per graphic.
 *
 * This file is shared by the server (validation, persistence) and the browser (controls, rendering).
 * Renderers live in src/gfx (browser only) and are looked up by `renderer`.
 */
import { WC_IDS, matchName } from './wildcard';

export type PropType = 'text' | 'number' | 'boolean' | 'color' | 'select';
export interface PropDef {
  key: string;
  label: string;
  type: PropType;
  default: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number; max?: number;
  group?: string;
  help?: string;
}

/** Data the graphic reads from the shared show (not stored in the instance). */
export type Binding =
  | { kind: 'seats'; label: string; seats: number[] } // talent positions (live: assigning re-routes cameras)
  | { kind: 'match'; label: string } // the cast match (teams, logos, score)
  | { kind: 'predictions'; label: string; seats: number[] }
  | { kind: 'score'; label: string }
  | { kind: 'bracket'; label: string } // tournament results (match scores, sheet sync)
  | { kind: 'audience'; label: string; module: 'pickems' | 'mvp' | 'qr' }; // vote service (Pick'ems / MVP / QR)

export type AnimAction = 'in' | 'out' | 'update' | 'reset';
export interface AnimDef { action: AnimAction; label: string; ms: number; how: 'waapi' | 'css' | 'video' }

export type Permission = 'cameras' | 'talent' | 'match-data' | 'media';

export interface PackageDef {
  id: string;
  name: string;
  version: string;
  collection: string;
  category: 'Desk' | 'Game' | 'Overlay' | 'Bracket' | 'Intermission' | 'Interview' | 'Media' | 'Audience';
  description: string;
  renderer: string;
  resolution: [number, number];
  props: PropDef[];
  bindings: Binding[];
  animations: AnimDef[];
  assets: string[];
  /** Commands the package accepts (beyond its properties and animations). */
  commands: { id: string; label: string }[];
  permissions: Permission[];
  /** The OBS scene key used by "Build scenes in OBS" for this kind of graphic. */
  obsKey?: string;
}

export interface GfxInstance {
  id: string;
  pkg: string;
  name: string;
  /** Published configuration (what the browser source renders). */
  config: Record<string, string | number | boolean>;
  /** Prepared changes, applied by publish (null = nothing prepared). */
  draft: Record<string, string | number | boolean> | null;
  /** Animation lifecycle: the last command and its sequence number (renderers react to seq). */
  anim: { action: AnimAction; seq: number; at: number };
  /** Saved configurations of this instance. */
  presets: { name: string; config: Record<string, string | number | boolean> }[];
  /** OBS scene holding this graphic's browser source (Studio Mode mapping), or null = guess by name. */
  obsScene?: string | null;
}

/** Health reported by the browser sources of an instance. */
export interface GfxHealth { ok: boolean; error?: string; at: number }

// ============================================================ the official Overdrive collection

const IN_OUT: AnimDef[] = [
  { action: 'in', label: 'IN', ms: 450, how: 'waapi' },
  { action: 'update', label: 'UPDATE', ms: 350, how: 'css' },
  { action: 'out', label: 'OUT', ms: 400, how: 'waapi' },
  { action: 'reset', label: 'RESET', ms: 0, how: 'css' },
];

/** Internal transition used when content changes INSIDE the graphic (never an OBS transition). */
const MOTION = (kind: string, ms: number): PropDef[] => [
  { key: 'transition', label: 'Content transition', type: 'select', default: kind, group: 'Motion', options: [{ value: 'crossfade', label: 'Crossfade' }, { value: 'slide', label: 'Slide' }, { value: 'wipe', label: 'Wipe' }, { value: 'scale', label: 'Scale' }, { value: 'cut', label: 'Cut' }], help: 'How panels, layouts and frames change inside this graphic. Not an OBS transition.' },
  { key: 'transitionMs', label: 'Transition ms', type: 'number', default: ms, min: 0, max: 1000, group: 'Motion', help: '0–1000 ms (default ' + ms + ').' },
];

export const PACKAGES: PackageDef[] = [
  {
    id: 'od.caster-desk', name: 'Caster Desk', version: '2.0.0', collection: 'Overdrive Major', category: 'Desk', renderer: 'caster-desk', obsKey: 'casters',
    description: 'Three caster positions (left / center / right) with the approved Overdrive booth frames, names and prediction badges.',
    resolution: [1920, 1080],
    props: [
      { key: 'layout', label: 'Layout', type: 'select', default: 'auto', group: 'Layout', options: [{ value: 'auto', label: 'Auto (seated)' }, { value: 'solo', label: 'Solo' }, { value: 'duo', label: 'Duo' }, { value: 'trio', label: 'Trio' }], help: 'Auto shows every seated caster.' },
      { key: 'names', label: 'Name bars', type: 'boolean', default: true, group: 'Layout' },
      { key: 'matchup', label: 'Matchup bar', type: 'boolean', default: false, group: 'Graphics' },
      { key: 'picks', label: 'Prediction badges', type: 'boolean', default: false, group: 'Graphics' },
      { key: 'ticker', label: 'Ticker', type: 'boolean', default: true, group: 'Graphics' },
      { key: 'accent', label: 'Accent colour', type: 'color', default: '', group: 'Look', help: 'Empty = the Overdrive brand colour.' },
      ...MOTION('crossfade', 300),
    ],
    bindings: [{ kind: 'seats', label: 'Caster positions', seats: [1, 2, 3] }, { kind: 'match', label: 'Match' }, { kind: 'predictions', label: 'Caster predictions', seats: [1, 2, 3] }],
    animations: IN_OUT,
    assets: ['/brand/overdrive/frames (booth duo/trio, desk solo)', '/brand/overdrive/bg loop'],
    commands: [],
    permissions: ['cameras', 'talent', 'match-data'],
  },
  {
    id: 'od.analyst-desk', name: 'Analyst Desk', version: '2.0.0', collection: 'Overdrive Major', category: 'Desk', renderer: 'analyst-desk', obsKey: 'analysis',
    description: 'Two analyst positions (+ a caster joining), the desk panel (predictions, head-to-head, player stats, Pick\'em).',
    resolution: [1920, 1080],
    props: [
      { key: 'layout', label: 'Layout', type: 'select', default: 'duo', group: 'Layout', options: [{ value: 'solo', label: 'Solo' }, { value: 'duo', label: 'Duo' }] },
      { key: 'guest', label: 'Caster joins', type: 'select', default: 'none', group: 'Layout', options: [{ value: 'none', label: 'None' }, { value: '1', label: 'Caster 1' }, { value: '2', label: 'Caster 2' }, { value: '3', label: 'Caster 3' }] },
      { key: 'panel', label: 'Panel', type: 'select', default: 'cams', group: 'Panel', options: [{ value: 'cams', label: 'Cameras only' }, { value: 'picks', label: 'Predictions' }, { value: 'h2h', label: 'Head to head' }, { value: 'player', label: 'Player stats' }, { value: 'pickem', label: "Pick'em" }] },
      { key: 'strip', label: 'VS strip', type: 'boolean', default: false, group: 'Panel' },
      { key: 'clock', label: 'Countdown', type: 'boolean', default: false, group: 'Panel' },
      { key: 'names', label: 'Name bars', type: 'boolean', default: true, group: 'Layout' },
      { key: 'ticker', label: 'Ticker', type: 'boolean', default: true, group: 'Panel' },
      ...MOTION('slide', 350),
    ],
    bindings: [{ kind: 'seats', label: 'Analyst positions', seats: [4, 5] }, { kind: 'match', label: 'Match' }, { kind: 'predictions', label: 'Desk predictions', seats: [4, 5] }],
    animations: IN_OUT, assets: ['/brand/overdrive/frames (desk)'], commands: [], permissions: ['cameras', 'talent', 'match-data'],
  },
  {
    id: 'od.scoreboard', name: 'Scoreboard', version: '2.0.0', collection: 'Overdrive Major', category: 'Overlay', renderer: 'scoreboard',
    description: 'Series scoreboard of the cast match (teams, logos, score, game, best-of).',
    resolution: [1920, 1080],
    props: [{ key: 'map', label: 'Show map name', type: 'boolean', default: true, group: 'Content' }, ...MOTION('crossfade', 300)],
    bindings: [{ kind: 'match', label: 'Match' }, { kind: 'score', label: 'Series score' }],
    animations: IN_OUT, assets: [], commands: [], permissions: ['match-data'],
  },
  {
    id: 'od.gameplay', name: 'Gameplay overlay', version: '2.0.0', collection: 'Overdrive Major', category: 'Game', renderer: 'gameplay', obsKey: 'gameplay',
    description: 'Overlay on top of the game capture: scoreboard, caster cams, ticker, map card and replay badges.',
    resolution: [1920, 1080],
    props: [
      { key: 'scoreboard', label: 'Scoreboard', type: 'boolean', default: true, group: 'Content' },
      { key: 'cams', label: 'Caster cams', type: 'boolean', default: false, group: 'Content' },
      { key: 'ticker', label: 'Ticker', type: 'boolean', default: false, group: 'Content' },
      ...MOTION('crossfade', 300),
    ],
    bindings: [{ kind: 'match', label: 'Match' }, { kind: 'score', label: 'Series score' }],
    animations: IN_OUT, assets: ['/brand/overdrive/maps/*.jpg'], commands: [{ id: 'replay', label: 'Replay badge' }, { id: 'highlights', label: 'Highlights badge' }, { id: 'clear-badge', label: 'Clear badge' }],
    permissions: ['cameras', 'match-data'],
  },
  {
    id: 'od.bracket', name: 'Tournament Bracket', version: '2.1.0', collection: 'Overdrive Major', category: 'Bracket', renderer: 'bracket', obsKey: 'bracket',
    description: 'The approved Major bracket (upper bracket + grand final / lower bracket + standings) or the matches board, with automatic cycling.',
    resolution: [1920, 1080],
    props: [
      { key: 'view', label: 'Display', type: 'select', default: 'bracket', group: 'Display', options: [{ value: 'bracket', label: 'Bracket' }, { value: 'matches', label: 'Matches board' }] },
      { key: 'part', label: 'Bracket half', type: 'select', default: '1', group: 'Display', options: [{ value: '1', label: 'Upper + Grand Final' }, { value: '2', label: 'Lower + Standings' }], help: 'Ignored while cycling.' },
      { key: 'cycle', label: 'Cycle halves', type: 'boolean', default: false, group: 'Cycling' },
      { key: 'cycleSec', label: 'Cycle every (s)', type: 'number', default: 20, min: 5, max: 300, group: 'Cycling' },
      ...MOTION('crossfade', 350),
    ],
    bindings: [{ kind: 'bracket', label: 'Bracket results' }, { kind: 'match', label: 'Match' }],
    animations: IN_OUT, assets: ['/brand/overdrive/loop.webm'], commands: [], permissions: ['match-data'],
  },
];

// ------------------------------------------------------------ audience (Pick'ems + Community MVP)
const MATCH_OPTS = [{ value: '', label: 'Cast match' }, ...WC_IDS.map(id => ({ value: id, label: matchName(id) }))];
PACKAGES.push(
  {
    id: 'od.pickem', name: "Pick'ems: match prediction", version: '1.0.0', collection: 'Overdrive Major', category: 'Audience', renderer: 'pickem',
    description: "The desk's picks against the community's for one match. Each step is prepared, then taken: picks are revealed one by one, then the community split, then the verdict. Showing the community step on air also reveals it on the voting page.",
    resolution: [1920, 1080],
    props: [
      { key: 'match', label: 'Match', type: 'select', default: '', group: 'Content', options: MATCH_OPTS },
      { key: 'step', label: 'Reveal step', type: 'select', default: 'intro', group: 'Reveal', options: [
        { value: 'intro', label: 'Picks sealed' }, { value: 'd1', label: 'Desk pick 1' }, { value: 'd2', label: 'Desk picks 1–2' }, { value: 'd3', label: 'Desk picks 1–3' },
        { value: 'd4', label: 'Desk picks 1–4' }, { value: 'd5', label: 'Desk picks 1–5' }, { value: 'community', label: 'Community split' }, { value: 'verdict', label: 'Final comparison' }] },
      { key: 'title', label: 'Title', type: 'text', default: 'Who takes it?', group: 'Content' },
    ],
    bindings: [{ kind: 'audience', label: "Pick'ems", module: 'pickems' }, { kind: 'predictions', label: 'Desk picks', seats: [1, 2, 3, 4, 5] }, { kind: 'audience', label: 'QR', module: 'qr' }],
    animations: IN_OUT, assets: ['/brand/overdrive/loop.webm'], commands: [], permissions: ['match-data'],
  },
  {
    id: 'od.mvp', name: 'Community MVP', version: '1.0.0', collection: 'Overdrive Major', category: 'Audience', renderer: 'mvp',
    description: 'Community MVP of a finished match: voting open (players + QR), the winner reveal, and the community vs desk comparison. The winner shows only from the result frozen when voting closed; showing it on air also reveals it on the voting page.',
    resolution: [1920, 1080],
    props: [
      { key: 'match', label: 'Match', type: 'select', default: '', group: 'Content', options: MATCH_OPTS },
      { key: 'step', label: 'Show', type: 'select', default: 'voting', group: 'Reveal', options: [{ value: 'voting', label: 'Voting open' }, { value: 'winner', label: 'Community MVP reveal' }, { value: 'desk', label: 'Analyst MVP reveal' }, { value: 'compare', label: 'Community vs Analysts' }] },
    ],
    bindings: [{ kind: 'audience', label: 'Community MVP', module: 'mvp' }, { kind: 'audience', label: 'QR', module: 'qr' }],
    animations: IN_OUT, assets: ['/brand/overdrive/loop.webm'], commands: [], permissions: ['match-data'],
  },
  {
    id: 'od.qr', name: 'Voting QR', version: '1.0.0', collection: 'Overdrive Major', category: 'Audience', renderer: 'qr',
    description: 'A QR code from the QR Manager as a lower third, a gameplay corner or an analyst-desk element. Only approved https links are drawn; an expired or invalid link draws nothing.',
    resolution: [1920, 1080],
    props: [
      { key: 'qr', label: 'QR link', type: 'text', default: 'vote', group: 'Content', help: 'Id of a link in the QR Manager ("vote" = the voting page).' },
      { key: 'position', label: 'Position', type: 'select', default: 'lower-third', group: 'Content', options: [{ value: 'lower-third', label: 'Lower third' }, { value: 'corner', label: 'Gameplay corner' }, { value: 'desk', label: 'Analyst desk' }] },
      { key: 'title', label: 'Title', type: 'text', default: "Make your pick'ems", group: 'Content' },
      { key: 'showUrl', label: 'Show the address', type: 'boolean', default: true, group: 'Content' },
    ],
    bindings: [{ kind: 'audience', label: 'QR codes', module: 'qr' }],
    animations: IN_OUT, assets: [], commands: [], permissions: [],
  },
);

export const pkgById = (id: string) => PACKAGES.find(p => p.id === id);
export const defaultsOf = (p: PackageDef) => Object.fromEntries(p.props.map(d => [d.key, d.default])) as GfxInstance['config'];

/** Typed validation of one property value (server and browser). Returns the value or an error. */
export function checkProp(d: PropDef, v: unknown): { ok: true; value: string | number | boolean } | { ok: false; error: string } {
  switch (d.type) {
    case 'boolean': return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: `${d.label} must be on or off` };
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${d.label} must be a number` };
      if ((d.min != null && v < d.min) || (d.max != null && v > d.max)) return { ok: false, error: `${d.label} must be between ${d.min} and ${d.max}` };
      return { ok: true, value: v };
    }
    case 'select': return typeof v === 'string' && d.options!.some(o => o.value === v) ? { ok: true, value: v } : { ok: false, error: `${d.label}: choose one of ${d.options!.map(o => o.label).join(', ')}` };
    case 'color': return typeof v === 'string' && (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) ? { ok: true, value: v } : { ok: false, error: `${d.label} must be a colour like #ff4b2e` };
    case 'text': return typeof v === 'string' && v.length <= 200 ? { ok: true, value: v } : { ok: false, error: `${d.label} must be text (200 characters max)` };
  }
}

/** Keep only valid, declared properties; missing ones get the package default. */
export function sanitizeConfig(p: PackageDef, v: unknown): GfxInstance['config'] {
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(p.props.map(d => { const c = checkProp(d, src[d.key]); return [d.key, c.ok ? c.value : d.default]; }));
}

/** One default instance per package (stable ids = stable OBS URLs), plus any extra instances the operator made. */
export function sanitizeGraphics(v: unknown): GfxInstance[] {
  const list: any[] = Array.isArray(v) ? v : [];
  const out: GfxInstance[] = [];
  const add = (x: any, p: PackageDef, id: string) => out.push({
    id, pkg: p.id, name: typeof x?.name === 'string' && x.name.trim() ? x.name.slice(0, 60) : p.name,
    config: sanitizeConfig(p, x?.config), draft: x?.draft ? sanitizeConfig(p, { ...sanitizeConfig(p, x?.config), ...x.draft }) : null,
    anim: { action: 'in', seq: 0, at: 0 }, // a restarted server shows every graphic IN (its published state)
    presets: Array.isArray(x?.presets) ? x.presets.slice(0, 30).filter((q: any) => typeof q?.name === 'string').map((q: any) => ({ name: q.name.slice(0, 40), config: sanitizeConfig(p, q.config) })) : [],
    obsScene: typeof x?.obsScene === 'string' && x.obsScene ? x.obsScene.slice(0, 120) : null,
  });
  for (const p of PACKAGES) { const id = p.id.replace(/^od\./, ''); add(list.find(x => x?.id === id), p, id); }
  for (const x of list) { const p = pkgById(x?.pkg); if (p && typeof x.id === 'string' && /^[a-z0-9-]{3,40}$/.test(x.id) && !out.some(o => o.id === x.id)) add(x, p, x.id); }
  return out;
}

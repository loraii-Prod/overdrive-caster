/**
 * Overdrive 2.0 production engine: the typed contract between the Producer Console and the server.
 *
 * - Every producer action is a `ProducerCmd` sent in a `cmd` envelope with an id; the server answers
 *   with an `ack` (ok or a reason). Nothing is reported as done before the server applied it.
 * - The server keeps one authoritative Preview ("stage") shared by every operator. Preparing never
 *   touches Program; TAKE / CUT / AUTO copy Preview to Program atomically.
 * - "Live data" (scores, predictions) and "keyed graphics" (map card, replay badge, scoreboard bug)
 *   act on Program directly, the way a switcher's downstream keys do: they are marked `live` in the
 *   registry so the console shows they go straight to air.
 * - `version` increases on every engine change. A TAKE carries the version the operator saw; if
 *   another operator changed Preview in between, the TAKE is refused instead of airing a surprise.
 */
import type { ScreenId } from './types';
import type { WcDeskPanel } from './wildcard';

export type TransitionKind = 'stinger' | 'fade' | 'cut';
export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: 'stinger', label: 'Stinger' },
  { id: 'fade', label: 'Fade' },
  { id: 'cut', label: 'Cut' },
];

/** Graphics that sit on top of Program and fire straight to air. */
export type KeyGraphic = 'map-card' | 'replay' | 'highlights' | 'clear-badge';

/** Preview-side flags (TAKE sends them to Program with the scene). */
export type StageFlag = 'scoreboard' | 'matchup-screens' | 'matchup-casters' | 'ticker' | 'gameplay-cams' | 'gameplay-ticker' | 'names' | 'desk-strip' | 'desk-clock';

export type ProducerCmd =
  // ---- Preview (stage): never on air until TAKE
  | { c: 'stage-screen'; screen: ScreenId }
  | { c: 'stage-booth'; ids: number[] }
  | { c: 'stage-desk'; analysts?: number[]; guest?: number | null; panel?: WcDeskPanel }
  | { c: 'stage-flag'; flag: StageFlag; on: boolean }
  | { c: 'stage-reset' } // Preview = Program again
  // ---- Program
  | { c: 'take'; transition?: TransitionKind } // AUTO = default transition
  | { c: 'cut' }
  | { c: 'set-transition'; transition: TransitionKind }
  | { c: 'undo' }
  // ---- Live data + keyed graphics (Program directly)
  | { c: 'score'; side: 'a' | 'b'; delta: 1 | -1 }
  | { c: 'cast-match'; id: string | null }
  | { c: 'pick'; slot: number; team: string | null; score?: string }
  | { c: 'picks-show'; on: boolean }
  | { c: 'graphic'; g: KeyGraphic; map?: string }
  // ---- 2.0 independent sources: prepare → publish (no scene switch, no transition)
  | { c: 'publish' }
  | { c: 'revert' }
  /** Prepare a live-data change instead of airing it (scores, predictions); applied by publish. */
  | { c: 'draft'; cmd: DraftCmd }
  | { c: 'draft-drop'; index: number }
  // ---- Existing Major / quick operations through the engine (acks, priorities)
  | { c: 'op-wc'; op: import('./wildcard').WcOp }
  | { c: 'op-quick'; op: import('./protocol').QuickOp }
  // ---- Talent (10 profiles) and positions
  | { c: 'seat'; seat: number; talent: string | null }
  | { c: 'talent-edit'; id: string; name?: string; role?: 'caster' | 'analyst'; mode?: 'webrtc' | 'vdo' }
  | { c: 'talent-regen'; id: string }
  | { c: 'camera'; seat: number; on: boolean }
  | { c: 'feed-resync'; seat: number }
  // ---- OBS (explicit; OBS performs the transition)
  | { c: 'obs-switch'; scene: string; transition?: 'obs' | TransitionKind }
  // ---- Media playback (/output/media)
  | { c: 'media'; action: 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'goto'; index?: number }
  | { c: 'media-set'; playlist: string[] }
  | { c: 'media-opts'; volume?: number; muted?: boolean; auto?: boolean; loop?: boolean }
  // ---- Studio Mode
  | { c: 'studio-set'; scene: string; modules: string[]; pinned: string[] }
  // ---- Graphics engine (packages / instances)
  | { c: 'gfx-set'; id: string; patch: Record<string, string | number | boolean> }
  | { c: 'gfx-publish'; id: string }
  | { c: 'gfx-revert'; id: string }
  | { c: 'gfx-anim'; id: string; action: import('./gfx').AnimAction }
  | { c: 'gfx-create'; pkg: string; name: string }
  | { c: 'gfx-delete'; id: string }
  | { c: 'gfx-rename'; id: string; name: string }
  | { c: 'gfx-preset'; id: string; op: 'save' | 'load' | 'delete'; name: string }
  | { c: 'gfx-obs'; id: string; scene: string | null } // OBS scene that holds this graphic's browser source (tally / switch)
  // ---- OBS Scene Builder (Studio Mode → OBS Setup): one OBS scene per output; never switches OBS
  | { c: 'obs-setup'; action: 'scan' | 'verify' }
  | { c: 'obs-setup'; action: 'preview'; mode: 'build' | 'repair'; targets: string[] | 'all' }
  | { c: 'obs-setup'; action: 'apply'; hash: string; allowLive?: boolean }
  | { c: 'obs-setup'; action: 'cancel' }
  | { c: 'obs-setup'; action: 'options'; options: Partial<import('./obsSetup').ObsSetupOptions> }
  // ---- Graphics rundown (items act inside their graphic's own source; never switch OBS)
  | { c: 'rd-add'; gfx: string; preset?: string | null; snapshot?: boolean; label?: string; at?: number }
  | { c: 'rd-remove'; id: string }
  | { c: 'rd-move'; id: string; to: number }
  | { c: 'rd-edit'; id: string; label?: string; preset?: string | null }
  | { c: 'rd-cue'; id: string | null }
  | { c: 'rd-take'; id: string; action: 'in' | 'update' | 'out' }
  | { c: 'rd-next' } // take the cued item IN, cue the one after it
  | { c: 'rd-clear' }
  // ---- Recovery
  | { c: 'panic' } // clear every keyed graphic + popups, keep the scene
  | { c: 'safe' } // CUT Program to the BRB screen
  | { c: 'reload-outputs' } // every browser source reloads and resyncs
  | { c: 'automation'; hold: boolean };

export type CmdSource = 'manual' | 'auto';

/** Live-data commands that can be prepared and published later. */
export type DraftCmd = Extract<ProducerCmd, { c: 'score' } | { c: 'pick' } | { c: 'picks-show' }>;
export const DRAFTABLE = ['score', 'pick', 'picks-show'] as const;

/** Stage = the Preview bus beyond the scene/show (the desk and booth live in the Major state). */
export interface Stage {
  booth: number[];
  desk: { slots: number[]; guest: number | null; panel: WcDeskPanel; strip: boolean; clock: boolean };
}

export interface EngineState {
  version: number;
  stage: Stage;
  /** Preview differs from Program (scene, show flags or stage). */
  dirty: boolean;
  transition: TransitionKind;
  /** Automation (rundown, timers) may not change Program while held; manual always wins. */
  autoHold: boolean;
  /** Seconds left of the automatic hold after a manual Program change. */
  manualAt: number;
  undo: { label: string; at: number }[];
  /** Prepared live-data changes waiting for Publish. */
  draft: DraftCmd[];
  lastTake: { at: number; by: string; transition: TransitionKind; screen: ScreenId } | null;
}

export const MAX_UNDO = 25;
/** After a manual Program change, automation waits this long before acting. */
export const MANUAL_GRACE_MS = 8000;

export function sanitizeStage(v: any, fallback: Stage): Stage {
  const ids = (a: unknown, ok: (n: number) => boolean) => (Array.isArray(a) ? [...new Set(a.map(Number).filter(ok))].slice(0, 3) : []);
  const d = v?.desk ?? {};
  return {
    booth: Array.isArray(v?.booth) ? ids(v.booth, n => n >= 1 && n <= 6) : fallback.booth,
    desk: {
      slots: Array.isArray(d.slots) ? ids(d.slots, n => n >= 1 && n <= 6) : fallback.desk.slots,
      guest: typeof d.guest === 'number' && d.guest >= 1 && d.guest <= 6 ? d.guest : null,
      panel: ['cams', 'picks', 'h2h', 'player', 'pickem'].includes(d.panel) ? d.panel : fallback.desk.panel,
      strip: typeof d.strip === 'boolean' ? d.strip : fallback.desk.strip,
      clock: typeof d.clock === 'boolean' ? d.clock : fallback.desk.clock,
    },
  };
}

/**
 * What the sources will show once the draft is published: the same edits the engine makes, on copies.
 * Used by the Producer Console preview (the server stays the only place that changes real state).
 */
export function applyDraft<W extends import('./wildcard').WildcardState>(wc: W, show: import('./types').Show, draft: DraftCmd[]): { wc: W; show: import('./types').Show } {
  if (!draft.length) return { wc, show };
  const w: W = JSON.parse(JSON.stringify(wc)), sh: import('./types').Show = JSON.parse(JSON.stringify(show));
  const n = (v: string) => (/^\d+$/.test(v) ? Number(v) : 0);
  for (const d of draft) {
    if (d.c === 'score') {
      const delta = d.delta === -1 ? -1 : 1;
      const t = d.side === 'a' ? sh.teamA : sh.teamB;
      t.score = Math.max(0, Math.min(99, t.score + delta));
      if (w.cast && w.matches[w.cast]) { const m = w.matches[w.cast]; if (d.side === 'a') m.s1 = String(Math.max(0, n(m.s1) + delta)); else m.s2 = String(Math.max(0, n(m.s2) + delta)); }
    } else if (d.c === 'pick') {
      const picks = { ...w.intro.picks };
      if (d.team) picks[String(d.slot)] = { team: d.team, score: d.score ?? '' }; else delete picks[String(d.slot)];
      w.intro = { ...w.intro, picks };
    } else if (d.c === 'picks-show') w.intro = { ...w.intro, picksShow: d.on === true };
  }
  return { wc: w, show: sh };
}

export function draftLabel(d: DraftCmd): string {
  if (d.c === 'score') return `Score ${d.side === 'a' ? 'team A' : 'team B'} ${d.delta === -1 ? '−1' : '+1'}`;
  if (d.c === 'pick') return d.team ? `Prediction slot ${d.slot}: ${d.team} ${d.score ?? ''}` : `Prediction slot ${d.slot} cleared`;
  return `Prediction badges ${d.on ? 'on' : 'off'}`;
}

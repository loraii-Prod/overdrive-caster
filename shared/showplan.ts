/**
 * Overdrive Studio Mode 2.0: the SHOW PLAN (shared by server and browser).
 *
 * The show plan is built in Studio Mode and operated in Producer Mode. It sits above the graphics rundown
 * (shared/rundown.ts, which plays graphics IN / OUT inside their own sources) and describes the show:
 *
 *   segments    the show running order: which scene each part of the show uses, its OBS scene, its
 *               transition, the media it starts and how long it is expected to last.
 *   rules       automation: WHEN something happens (countdown ends, media ends, a segment's time is up,
 *               a clock time) THEN do a list of steps (prepare the next segment, notify the producer,
 *               wait for the producer's GO, GO, start media, start a countdown, take the next graphic,
 *               switch OBS).
 *   next        the segment that is prepared (GO takes it).
 *   onAir       the segment on air and when it started (server clock).
 *   pending     a GO the automation is waiting for. Only a producer's GO (or Cancel) resolves it.
 *
 * Safety: every step goes through the production engine with source 'auto', so the existing rules still
 * apply: automation never acts while it is held or right after a manual action, and an automatic GO that
 * is refused becomes a pending GO instead of being dropped. Manual always wins.
 */
import { mainDef } from './obsLayout';
import type { SourceDef } from './registry';

export type SegTransition = 'obs' | 'stinger' | 'fade' | 'cut';
export const SEG_TRANSITIONS: [SegTransition, string][] = [['obs', 'OBS default'], ['stinger', 'Stinger'], ['fade', 'Fade'], ['cut', 'Cut']];

export interface Segment {
  id: string;
  label: string;
  /** What is on screen: 's:<scene source id>' (registry) or 'g:<graphics instance id>'; null = not assigned yet. */
  target: string | null;
  /** OBS scene to switch to. null = the target's mapped OBS scene. */
  obsScene: string | null;
  /** Expected length in seconds (0 = open-ended). */
  dur: number;
  transition: SegTransition;
  /** Media file (/media/...) started when the segment goes on air, or null. */
  media: string | null;
  /** When its time is up, take the next segment automatically. */
  autoNext: boolean;
  /** Automation must ask the producer for GO before this segment goes on air. */
  confirm: boolean;
  notes: string;
}

export type Trigger =
  | { k: 'countdown-end' }
  | { k: 'media-end' }
  | { k: 'segment-end' }
  /** A clock time (server clock, epoch ms). Fires once. */
  | { k: 'clock'; at: number }
  /** The MVP vote closed (by hand or its countdown) and its result froze. */
  | { k: 'mvp-closed' }
  /** A match gets its result (Match Ends → MVP voting). */
  | { k: 'match-end' };

export type AutoAction =
  | { k: 'prepare'; seg: string } // segment id, or 'next' (the one after the segment on air)
  | { k: 'notify'; text: string }
  | { k: 'confirm' } // wait for the producer's GO, then run the remaining steps
  | { k: 'go' } // take the prepared segment
  | { k: 'media'; action: 'play' | 'stop' | 'next' }
  | { k: 'timer'; minutes: number }
  | { k: 'gfx-next' } // graphics rundown: TAKE NEXT
  | { k: 'obs'; scene: string; transition: SegTransition }
  /** MVP sequence. A reveal never runs without a frozen result, and stops for producer GO when the MVP graphic asks for confirmation. */
  | { k: 'mvp'; action: 'open' | 'close' | 'reveal'; step?: 'winner' | 'desk' | 'compare' };

export interface AutoRule {
  id: string;
  name: string;
  on: boolean;
  when: Trigger;
  /** Only while this segment is on air (null = any time). */
  during: string | null;
  then: AutoAction[];
  /** Last time it fired (clock rules fire once). */
  fired: number | null;
}

export interface Pending { id: string; rule: string | null; name: string; text: string; at: number; rest: AutoAction[]; seg: string | null }
export interface PlanNote { at: number; text: string; level: 'info' | 'warn' | 'go' }

export interface ShowPlan {
  segments: Segment[];
  rules: AutoRule[];
  next: string | null;
  onAir: { id: string; at: number } | null;
  pending: Pending | null;
  notes: PlanNote[];
  /** Mirror the segments to the crew / caster run of show (/crew, talent pages). */
  crewSync: boolean;
}

export const MAX_SEGMENTS = 60;
export const MAX_RULES = 40;
export const MAX_ACTIONS = 12;
export const MAX_NOTES = 30;

export const emptyPlan = (): ShowPlan => ({ segments: [], rules: [], next: null, onAir: null, pending: null, notes: [], crewSync: false });

const str = (v: unknown, n: number, d = '') => (typeof v === 'string' ? v.slice(0, n) : d);
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(v);
const targetOk = (v: unknown): v is string => typeof v === 'string' && /^[gs]:[A-Za-z0-9_.-]{1,40}$/.test(v);
const trOk = (v: unknown): v is SegTransition => v === 'obs' || v === 'stinger' || v === 'fade' || v === 'cut';
const mediaOk = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/media/') && !v.includes('..') && v.length < 300;

export function sanitizeSegment(x: any, id: string): Segment {
  return {
    id,
    label: str(x?.label, 80).trim() || 'Segment',
    target: targetOk(x?.target) ? x.target : null,
    obsScene: typeof x?.obsScene === 'string' && x.obsScene.trim() ? x.obsScene.slice(0, 120) : null,
    dur: Number.isFinite(Number(x?.dur)) ? Math.max(0, Math.min(6 * 3600, Math.round(Number(x.dur)))) : 0,
    transition: trOk(x?.transition) ? x.transition : 'obs',
    media: mediaOk(x?.media) ? x.media : null,
    autoNext: x?.autoNext === true,
    confirm: x?.confirm !== false,
    notes: str(x?.notes, 400),
  };
}

export function sanitizeTrigger(v: any): Trigger {
  if (v?.k === 'media-end' || v?.k === 'segment-end' || v?.k === 'countdown-end' || v?.k === 'mvp-closed' || v?.k === 'match-end') return { k: v.k };
  if (v?.k === 'clock' && Number.isFinite(Number(v.at))) return { k: 'clock', at: Number(v.at) };
  return { k: 'countdown-end' };
}

export function sanitizeAction(v: any): AutoAction | null {
  switch (v?.k) {
    case 'prepare': return { k: 'prepare', seg: v.seg === 'next' || idOk(v.seg) ? v.seg : 'next' };
    case 'notify': return { k: 'notify', text: str(v.text, 140).trim() || 'Automation step reached' };
    case 'confirm': case 'go': case 'gfx-next': return { k: v.k };
    case 'media': return { k: 'media', action: v.action === 'stop' || v.action === 'next' ? v.action : 'play' };
    case 'timer': return { k: 'timer', minutes: Math.max(0, Math.min(600, Math.round(Number(v.minutes) || 0))) };
    case 'mvp': return v.action === 'open' || v.action === 'close' ? { k: 'mvp', action: v.action } : v.action === 'reveal' ? { k: 'mvp', action: 'reveal', step: v.step === 'desk' || v.step === 'compare' ? v.step : 'winner' } : null;
    case 'obs': return typeof v.scene === 'string' && v.scene.trim() ? { k: 'obs', scene: v.scene.slice(0, 120), transition: trOk(v.transition) ? v.transition : 'obs' } : null;
  }
  return null;
}

export function sanitizeRule(x: any, id: string): AutoRule {
  return {
    id,
    name: str(x?.name, 80).trim() || 'Automation',
    on: x?.on !== false,
    when: sanitizeTrigger(x?.when),
    during: idOk(x?.during) ? x.during : null,
    then: (Array.isArray(x?.then) ? x.then : []).map(sanitizeAction).filter((a: AutoAction | null): a is AutoAction => !!a).slice(0, MAX_ACTIONS),
    fired: typeof x?.fired === 'number' ? x.fired : null,
  };
}

export function sanitizePlan(v: unknown): ShowPlan {
  const p = (v && typeof v === 'object' ? v : {}) as any;
  const seen = new Set<string>();
  const segments = (Array.isArray(p.segments) ? p.segments : []).flatMap((x: any) => (idOk(x?.id) && !seen.has(x.id) ? (seen.add(x.id), [sanitizeSegment(x, x.id)]) : [])).slice(0, MAX_SEGMENTS);
  const ids = new Set(segments.map((s: Segment) => s.id));
  const rseen = new Set<string>();
  const rules = (Array.isArray(p.rules) ? p.rules : []).flatMap((x: any) => (idOk(x?.id) && !rseen.has(x.id) ? (rseen.add(x.id), [sanitizeRule(x, x.id)]) : [])).slice(0, MAX_RULES)
    .map((r: AutoRule) => ({ ...r, during: r.during && ids.has(r.during) ? r.during : null }));
  const notes = (Array.isArray(p.notes) ? p.notes : []).filter((n: any) => n && typeof n.at === 'number' && typeof n.text === 'string')
    .map((n: any): PlanNote => ({ at: n.at, text: n.text.slice(0, 200), level: n.level === 'warn' || n.level === 'go' ? n.level : 'info' })).slice(0, MAX_NOTES);
  return {
    segments, rules,
    next: idOk(p.next) && ids.has(p.next) ? p.next : null,
    onAir: p.onAir && ids.has(p.onAir.id) && typeof p.onAir.at === 'number' ? { id: p.onAir.id, at: p.onAir.at } : null,
    // A wait for GO never survives a restart: the producer re-arms it on purpose.
    pending: null,
    notes,
    crewSync: p.crewSync === true,
  };
}

// --------------------------------------------------------------------------- descriptions (UI + acks)
export function triggerLabel(t: Trigger, seg?: (id: string) => string): string {
  void seg;
  if (t.k === 'countdown-end') return 'Countdown reaches zero';
  if (t.k === 'media-end') return 'Media playback ends';
  if (t.k === 'segment-end') return "On-air segment's time is up";
  if (t.k === 'mvp-closed') return 'MVP voting closes';
  if (t.k === 'match-end') return 'A match ends (result entered)';
  return `Clock reaches ${new Date(t.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

export function actionLabel(a: AutoAction, segName: (id: string) => string = id => id): string {
  switch (a.k) {
    case 'prepare': return a.seg === 'next' ? 'Prepare the next segment' : `Prepare ${segName(a.seg)}`;
    case 'notify': return `Notify producer: “${a.text}”`;
    case 'confirm': return 'Wait for producer GO';
    case 'go': return 'GO: take the prepared segment';
    case 'media': return a.action === 'play' ? 'Play media' : a.action === 'stop' ? 'Stop media' : 'Next media item';
    case 'timer': return a.minutes ? `Start a ${a.minutes} min countdown` : 'Stop the countdown';
    case 'gfx-next': return 'Graphics rundown: TAKE NEXT';
    case 'obs': return `Switch OBS → ${a.scene} (${a.transition === 'obs' ? 'OBS default' : a.transition})`;
    case 'mvp': return a.action === 'open' ? 'Open MVP voting' : a.action === 'close' ? 'Close MVP voting' : `Reveal ${a.step === 'desk' ? 'Analyst MVP' : a.step === 'compare' ? 'Community vs Analysts' : 'Community MVP'} (needs a frozen result)`;
  }
}

export const fmtDur = (s: number) => (s <= 0 ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export function parseDur(v: string): number {
  const t = v.trim();
  if (!t || t === '—') return 0;
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : 0; // a bare number = minutes
}

/** Total planned length of the show (open-ended segments count 0). */
export const planLength = (p: ShowPlan) => p.segments.reduce((a, s) => a + s.dur, 0);

// --------------------------------------------------------------------------- OBS scene resolution
export interface ObsLookup {
  /** OBS Scene Builder mapping: target ('s:<id>' / 'g:<id>' / screen ids) → scene name. */
  setupMap: Record<string, { scene?: string } | undefined>;
  /** Legacy screen → OBS scene mapping (Show → Integrations). */
  screenMap: Record<string, string | undefined>;
  graphics: { id: string; pkg: string; name: string; obsScene?: string | null }[];
  registry: SourceDef[];
  /** Scene names OBS reports (empty when offline). */
  scenes: string[];
  pkgObsKey: (pkg: string) => string | undefined;
}

/** OBS scene a segment switches to: its own choice, else the mapping of its target, else a scene with its name. */
export function segmentObsScene(seg: Pick<Segment, 'obsScene' | 'target'>, o: ObsLookup): string | null {
  if (seg.obsScene) return seg.obsScene;
  const t = seg.target;
  if (!t) return null;
  // Mappings may hold '' (not set): every step falls through on empty values, not only on missing ones.
  const fromSetup = o.setupMap[t]?.scene || o.setupMap[t.replace(/^s:/, '')]?.scene;
  if (fromSetup) return fromSetup;
  const byName = (n: string) => o.scenes.find(s => s.toLowerCase().includes(n.toLowerCase())) ?? null;
  if (t.startsWith('main:')) { const m = mainDef(t.slice(5)); return m ? o.scenes.find(n => n === `Overdrive · ${m.label}`) ?? null : null; }
  if (t.startsWith('g:')) {
    const g = o.graphics.find(x => x.id === t.slice(2));
    if (!g) return null;
    if (g.obsScene) return g.obsScene;
    const key = o.pkgObsKey(g.pkg);
    const src = key ? o.registry.find(s => s.obsKey === key) : undefined;
    const viaSrc = src?.obsKey ? o.screenMap[src.obsKey] : undefined;
    const asScene = o.registry.find(s => s.gfx === g.id && !s.gfxView);
    const legacy = g.id === 'mvp' ? 'Overdrive · MVP' : null; // the MVP graphic's own scene keeps its 2.0 name
    return viaSrc || (asScene ? o.scenes.find(n => n === `Overdrive · ${asScene.name}`) ?? null : null) || (legacy && o.scenes.includes(legacy) ? legacy : null) || (g.id === 'mvp' ? o.scenes.find(n => n === `Overdrive · ${g.name}`) ?? null : byName(g.name)); // MVP: exact names only (its views' scenes contain its name)
  }
  const src = o.registry.find(s => s.id === t.slice(2));
  if (!src) return null;
  // MVP & Awards scenes: their own scene ("Overdrive · Community MVP — Winner Reveal"), never the graphic's.
  if (src.gfxView) return o.scenes.find(n => n === `Overdrive · ${src.name}`) ?? byName(src.name);
  if (src.gfx) return segmentObsScene({ obsScene: null, target: `g:${src.gfx}` }, o); // a scene drawn by a graphic
  return (src.obsKey ? o.screenMap[src.obsKey] : undefined) || byName(src.name);
}

// --------------------------------------------------------------------------- readiness
export interface Issue { level: 'error' | 'warn'; text: string }
export interface ReadyCtx {
  obs: ObsLookup;
  obsConnected: boolean;
  /** Browser sources connected per route ('g/<id>' or the source route without '/output/'). */
  conns: (route: string) => number;
  /** Seats 1–6 → { name, publishing } of the talent seated there (or null). */
  seat: (n: number) => { name: string; live: boolean } | null;
  playlist: string[];
}

export function routeOfTarget(t: string, registry: SourceDef[]): string | null {
  if (t.startsWith('g:')) return `g/${t.slice(2)}`;
  const s = registry.find(x => x.id === t.slice(2));
  if (s?.gfx) return `g/${s.gfx}${s.gfxView ? `?view=${s.gfxView}` : ''}`;
  return s ? s.route.replace(/^\/output\//, '').split('?')[0] : null;
}

/** What could go wrong when this segment goes on air (missing dependencies first). */
export function segmentIssues(seg: Segment, c: ReadyCtx): Issue[] {
  const out: Issue[] = [];
  if (!seg.target) out.push({ level: 'warn', text: 'No scene assigned' });
  else {
    const exists = seg.target.startsWith('g:') ? c.obs.graphics.some(g => g.id === seg.target!.slice(2)) : c.obs.registry.some(s => s.id === seg.target!.slice(2));
    if (!exists) out.push({ level: 'error', text: 'Its scene no longer exists' });
    else {
      const route = routeOfTarget(seg.target, c.obs.registry);
      if (route && c.conns(route) === 0) out.push({ level: 'warn', text: 'Browser source not open in OBS' });
      const src = seg.target.startsWith('s:') ? seg.target.slice(2) : '';
      const seats = src === 'caster-desk' ? [1, 2, 3] : src === 'analyst-desk' ? [4, 5] : src === 'interview' ? [6] : [];
      if (seats.length) {
        const sat = seats.map(c.seat).filter(Boolean) as { name: string; live: boolean }[];
        if (!sat.length) out.push({ level: 'error', text: 'No talent in its positions' });
        else if (sat.some(s => !s.live)) out.push({ level: 'warn', text: `Camera offline: ${sat.filter(s => !s.live).map(s => s.name).join(', ')}` });
      }
    }
  }
  const scene = segmentObsScene(seg, c.obs);
  if (!scene) out.push({ level: 'warn', text: 'No OBS scene: GO will not switch OBS' });
  else if (c.obsConnected && !c.obs.scenes.includes(scene)) out.push({ level: 'error', text: `OBS has no scene “${scene}”` });
  if (seg.autoNext && seg.dur <= 0) out.push({ level: 'warn', text: 'Auto-advance needs a duration' });
  return out;
}

export const readiness = (issues: Issue[]): 'ready' | 'warn' | 'error' => (issues.some(i => i.level === 'error') ? 'error' : issues.length ? 'warn' : 'ready');

/** A starter show and the reference automation (Starting Soon countdown → Opening with producer GO). */
/**
 * MVP & Awards in the rundown: the five MVP scenes in order. Reveals need a producer GO (confirm), Voting Closed
 * closes voting when it goes on air, and nothing advances by itself past a reveal.
 */
export const MVP_SEQUENCE: { target: string; label: string; dur: number; transition: SegTransition; confirm: boolean }[] = [
  { target: 's:mvp', label: 'MVP · Voting open', dur: 120, transition: 'stinger', confirm: true },
  { target: 's:mvp-closed', label: 'MVP · Voting closed', dur: 15, transition: 'fade', confirm: false },
  { target: 's:mvp-winner', label: 'MVP · Community MVP reveal', dur: 30, transition: 'stinger', confirm: true },
  { target: 's:mvp-desk', label: 'MVP · Analyst MVP reveal', dur: 25, transition: 'stinger', confirm: true },
  { target: 's:mvp-compare', label: 'MVP · Community vs Analysts', dur: 20, transition: 'fade', confirm: true },
];
/**
 * MVP & Awards automation: Match ends → Voting Open prepared (GO) → voting opens; voting closes → Voting Closed on
 * air → each reveal prepared and waiting for the producer's GO → after the comparison, the next item is prepared.
 */
export const MVP_RULES = (ids: { voting?: string | null; closed?: string | null }): Partial<AutoRule>[] => [
  { name: 'Match ends → MVP voting', when: { k: 'match-end' }, during: null,
    then: [{ k: 'prepare', seg: ids.voting ?? 'next' }, { k: 'notify', text: 'Match finished: MVP voting is ready — press GO' }, { k: 'confirm' }, { k: 'go' }, { k: 'mvp', action: 'open' }, { k: 'prepare', seg: 'next' }] },
  { name: 'MVP voting closes → reveals (each with GO)', when: { k: 'mvp-closed' }, during: null,
    then: [{ k: 'prepare', seg: ids.closed ?? 'next' }, { k: 'go' }, { k: 'prepare', seg: 'next' }, { k: 'notify', text: 'MVP results ready: GO reveals the Community MVP' }, { k: 'confirm' }, { k: 'go' },
      { k: 'prepare', seg: 'next' }, { k: 'notify', text: 'GO reveals the Analyst MVP' }, { k: 'confirm' }, { k: 'go' },
      { k: 'prepare', seg: 'next' }, { k: 'notify', text: 'GO shows the comparison' }, { k: 'confirm' }, { k: 'go' }, { k: 'prepare', seg: 'next' }] },
];

export function starterPlan(mk: () => string): Pick<ShowPlan, 'segments' | 'rules'> {
  const seg = (label: string, target: string, dur: number, extra: Partial<Segment> = {}): Segment => sanitizeSegment({ label, target, dur, transition: 'stinger', confirm: true, ...extra }, mk());
  const segments = [
    seg('Starting Soon', 's:starting', 600, { transition: 'fade', confirm: false }),
    seg('Opening · Caster Desk', 's:caster-desk', 180),
    seg('Team Intro', 's:team-intro', 60),
    seg('Map Veto', 's:veto', 120),
    seg('Gameplay · Match 1', 's:gameplay', 0),
    seg('Analyst Desk', 's:analyst-desk', 300),
    ...MVP_SEQUENCE.map(x => seg(x.label, x.target, x.dur, { transition: x.transition, confirm: x.confirm })),
    seg('Intermission (BRB)', 's:brb', 300, { transition: 'fade' }),
    seg('Bracket', 's:bracket', 60),
    seg('Ending', 's:ending', 120, { transition: 'fade' }),
  ];
  const rules: AutoRule[] = [sanitizeRule({
    name: 'Starting Soon → Opening', on: true, when: { k: 'countdown-end' }, during: segments[0].id,
    then: [{ k: 'prepare', seg: 'next' }, { k: 'notify', text: 'Opening is ready: press GO' }, { k: 'confirm' }, { k: 'go' }, { k: 'prepare', seg: 'next' }],
  }, mk()), ...MVP_RULES({ voting: segments.find(s => s.target === 's:mvp')?.id, closed: segments.find(s => s.target === 's:mvp-closed')?.id }).map(r => sanitizeRule({ ...r, on: true }, mk()))];
  return { segments, rules };
}

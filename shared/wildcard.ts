import { MAJOR_TEAMS } from './major';
import { MAJOR_MAPS, isMapId } from './maps';

/**
 * OverDrive 2026 Major (21–22 Nov): 8-team double-elimination bracket with a Grand final.
 * (Built on the Wildcard overlay's engine: same score rules, popups and sheet merge; the state
 * lives on the server and reaches every output over the WebSocket. Internal names still say "wc".)
 *
 * The 8 first-round slots are set in the controller (Major tab → First round); empty = TBD.
 */

// ------------------------------------------------------------------ structure

/** A slot is a team name, "BYE", the winner of a match ({ w }), its loser ({ l }) or first-round slot n ({ s }). */
export type WcSlot = string | { w: string } | { l: string } | { s: number };

const W_ = (id: string) => ({ w: id }), L_ = (id: string) => ({ l: id }), S_ = (n: number) => ({ s: n });

export const WC_STRUCT: Record<string, [WcSlot, WcSlot]> = {
  R1_UB1: [S_(0), S_(1)], R1_UB2: [S_(2), S_(3)], R1_UB3: [S_(4), S_(5)], R1_UB4: [S_(6), S_(7)],
  R2_UB1: [W_('R1_UB1'), W_('R1_UB2')], R2_UB2: [W_('R1_UB3'), W_('R1_UB4')],
  R3_UB1: [W_('R2_UB1'), W_('R2_UB2')],
  R1_LB1: [L_('R1_UB1'), L_('R1_UB2')], R1_LB2: [L_('R1_UB3'), L_('R1_UB4')],
  // Crossed so teams don't meet again straight away.
  R2_LB1: [L_('R2_UB2'), W_('R1_LB1')], R2_LB2: [L_('R2_UB1'), W_('R1_LB2')],
  R3_LB1: [W_('R2_LB1'), W_('R2_LB2')],
  R4_LB1: [L_('R3_UB1'), W_('R3_LB1')],
  R5_GF1: [W_('R3_UB1'), W_('R4_LB1')],
};
export const WC_IDS = Object.keys(WC_STRUCT);
export const isWcId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(WC_STRUCT, id);
/** Bumped when the bracket changes shape: saved results of another bracket are dropped. */
export const WC_BRACKET = 'major26';
export const GRAND_FINAL = 'R5_GF1';

/** Default ticker lines for the Major. */
export const MAJOR_TICKER = ['OverDrive 2026 Major · 21–22 November · 8 teams, double elimination', 'Prize pool €13,600', 'Follow @OVERDRIVE_TM · twitch.tv/overdrive_tm', 'Join the community: discord.gg/tZV3Mu3Thb'];
/** The Wildcard's results sheet: never pulled into the Major bracket. */
export const WILDCARD_SHEET_ID = '1SgnXorS23IvBM2dbie_QOc756wnOTjqCvx3U2ensfi4';
/** The season sheet (tinySheet); off until its Major tab link is pasted in. */
export const SEASON_SHEET_ID = '1wvKS0QsGqGUXCM2upmuFVw4pKUPPwYGi-D1o21v62gU';

/** Team name → logo file (public/brand/overdrive/teams/<logo>.png); seed = order in the Major list (shown only if "Seeds" is on). */
export const WC_TEAMS: Record<string, { seed: number; logo: string }> = Object.fromEntries(MAJOR_TEAMS.map((t, i) => [t.name, { seed: i + 1, logo: t.logo }]));
export const wcLogo = (name: string | null | undefined): string => {
  const t = name ? WC_TEAMS[name] : undefined;
  return t ? `/brand/overdrive/teams/${t.logo}.png` : '';
};

/** No default times: they come from the sheet or the controller. */
export const defaultTime = (_id: string) => '';
/** "Sat 15:00" labels resolve to these dates when the sheet gives no full date. */
export const WC_EVENT_DAYS: Record<string, string> = { Sat: '2026-11-21', Sun: '2026-11-22' };
/** Matches whose winner takes the title. */
export const WC_QUALIFIERS = new Set([GRAND_FINAL]);
export const WINS_NEEDED = 3;

const ROUND_NAMES: Record<string, string> = {
  R1_UB: 'Upper quarter-final', R2_UB: 'Upper semi-final', R3_UB: 'Upper final',
  R1_LB: 'Lower round 1', R2_LB: 'Lower quarter-final', R3_LB: 'Lower semi-final', R4_LB: 'Lower final', R5_GF: 'Grand final',
};
export const matchName = (id: string) => {
  const pre = id.slice(0, 5), n = WC_IDS.filter(k => k.startsWith(pre)).length;
  const name = ROUND_NAMES[pre] ?? id;
  return n > 1 ? (/\d$/.test(name) ? `${name}, match ${id.slice(5)}` : `${name} ${id.slice(5)}`) : name;
};
/** "R2_UB1" → "R2 UB 1", "R5_GF1" → "GF" */
export const shortCode = (id: string) => id === GRAND_FINAL ? 'GF' : id.replace(/^R(\d)_(UB|LB)(\d)$/, 'R$1 $2 $3');

// ---------------------------------------------------------------------- parts

export interface WcColumn { name: string; x: number; w: number; ids: string[]; major?: boolean }
export interface WcPart { title: string; cols: WcColumn[]; top: number; step: number }
export const WC_PARTS: Record<1 | 2, WcPart> = {
  1: {
    title: 'Upper bracket', top: 236, step: 196,
    cols: [
      { name: 'Quarter-finals', x: 60, w: 420, ids: ['R1_UB1', 'R1_UB2', 'R1_UB3', 'R1_UB4'] },
      { name: 'Semi-finals', x: 520, w: 420, ids: ['R2_UB1', 'R2_UB2'] },
      { name: 'Upper final', x: 980, w: 420, ids: ['R3_UB1'] },
      { name: 'Grand final', x: 1440, w: 420, ids: [GRAND_FINAL], major: true },
    ],
  },
  2: {
    title: 'Lower bracket', top: 330, step: 250,
    cols: [
      { name: 'Lower round 1', x: 60, w: 360, ids: ['R1_LB1', 'R1_LB2'] },
      { name: 'Lower quarter-finals', x: 440, w: 360, ids: ['R2_LB1', 'R2_LB2'] },
      { name: 'Lower semi-final', x: 820, w: 360, ids: ['R3_LB1'] },
      { name: 'Lower final', x: 1200, w: 360, ids: ['R4_LB1'] },
    ],
  },
};
export const partOf = (id: string): 1 | 2 => (WC_PARTS[1].cols.some(c => c.ids.includes(id)) ? 1 : 2);

export interface WcPos { x: number; y: number; w: number; c: number }
/** Match box positions: column 1 evenly spaced, later columns centred between their feeders. */
export function wcLayout(part: 1 | 2): Record<string, WcPos> {
  const P = WC_PARTS[part], pos: Record<string, WcPos> = {};
  const first = P.cols[0];
  first.ids.forEach((id, i) => (pos[id] = { x: first.x, y: P.top + i * P.step, w: first.w, c: 0 }));
  P.cols.slice(1).forEach((col, ci) => {
    const prev = P.cols[ci];
    col.ids.forEach((id, i) => {
      const y = col.ids.length === prev.ids.length ? pos[prev.ids[i]].y : (pos[prev.ids[2 * i]].y + pos[prev.ids[2 * i + 1]].y) / 2;
      pos[id] = { x: col.x, y, w: col.w, c: ci + 1 };
    });
  });
  return pos;
}

// ---------------------------------------------------------------------- state

export interface WcMatch {
  /** Maps won ("0".."3"), "W" / "L" for a walkover, "FF" for a forfeit, "" = not started. */
  s1: string; s2: string;
  /** Display time, e.g. "Sat 15:00" (CET). */
  time: string;
  /** Start as a local date-time without zone ("2026-11-07T15:00"), read in the viewer's time zone (CET in OBS). */
  at: string | null;
  live: boolean;
}

export interface WcOpts {
  title: boolean; times: boolean; seeds: boolean;
  /** Dark backdrop behind the bracket (turns transparency off). */
  bg: boolean;
  /** Box opacity, 40-100. */
  opacity: number;
  /** Auto switch between Part 1 and Part 2 every rotateSec seconds (run by the server). */
  rotate: boolean; rotateSec: number;
  /** Where the wildcard graphics replace the generic ones inside /output/program. */
  inBracket: boolean; inIntermission: boolean; inCasters: boolean; inGameplay: boolean;
  /** Major player showcase on the Warm-up screen. */
  inWarmup: boolean;
}

/** Warm-up player showcase: photos per player, which players, how long each, and a held player. */
export interface WcShowcase {
  /** normHandle(player) → image URL (uploaded in the controller). */
  photos: Record<string, string>;
  /** Only this team's players ('' = every Major player). */
  team: string;
  /** Seconds per player. */
  seconds: number;
  /** Player held on screen (normHandle), or null to rotate. */
  pin: string | null;
}
/** Match intro (Warm-up screen): teams, optional label and road texts, seconds per player, start time (null = not playing). */
/** A caster's / analyst's prediction for the intro match: winner and series score ("3-1", winner first). */
export interface WcPick { team: string; score: string }
export const PICK_SCORES = ['3-0', '3-1', '3-2'];

export interface WcIntro {
  a: string; b: string; label: string; roadA: string; roadB: string; step: number; at: number | null;
  /** Caster predictions by slot ('1'..'3'); cleared when the teams change. */
  picks: Record<string, WcPick>;
  /** Locked: casters can no longer change their pick from their own page. */
  picksLocked: boolean;
  /** Show the picks on the Casters screen, the VS screen and the analyst desk. */
  picksShow: boolean;
  /** Warm-up when the intro isn't playing: the teams' VS screen (default) or the rotating player showcase. */
  idle: 'vs' | 'showcase';
}
export const defaultIntro = (): WcIntro => ({ a: '', b: '', label: '', roadA: '', roadB: '', step: 7, at: null, idle: 'vs', picks: {}, picksLocked: false, picksShow: false });
export function sanitizePick(v: any, teams: string[]): WcPick | null {
  if (!v || typeof v !== 'object' || typeof v.team !== 'string' || !teams.includes(v.team)) return null;
  return { team: v.team, score: PICK_SCORES.includes(v.score) ? v.score : '' };
}
export function sanitizeIntro(v: any): WcIntro {
  const d = defaultIntro(), s = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  if (!v || typeof v !== 'object') return d;
  return { a: s(v.a, 60), b: s(v.b, 60), label: s(v.label, 80), roadA: s(v.roadA, 120), roadB: s(v.roadB, 120),
    step: Math.max(4, Math.min(30, Math.round(Number(v.step) || d.step))), at: Number.isFinite(v.at) && v.at > 0 ? Number(v.at) : null,
    idle: v.idle === 'showcase' ? 'showcase' : 'vs',
    picks: Object.fromEntries(['1', '2', '3', '4', '5'].map(k => [k, sanitizePick(v.picks?.[k], [s(v.a, 60), s(v.b, 60)].filter(Boolean))]).filter(([, p]) => p)) as Record<string, WcPick>,
    picksLocked: v.picksLocked === true, picksShow: v.picksShow === true };
}
/** Analyst desk panels: caster predictions, the two intro teams head to head, or the player held in the showcase. */
/** 'cams' = the analyst desk frames (cameras side by side, like the casters booth); the others put a data panel beside smaller cameras. */
export type WcDeskPanel = 'cams' | 'picks' | 'h2h' | 'player' | 'pickem';
export const DESK_PANELS: WcDeskPanel[] = ['cams', 'picks', 'h2h', 'player', 'pickem'];

export const defaultShowcase = (): WcShowcase => ({ photos: {}, team: '', seconds: 12, pin: null });
export function sanitizeShowcase(v: any): WcShowcase {
  const d = defaultShowcase();
  if (!v || typeof v !== 'object') return d;
  const photos: Record<string, string> = {};
  if (v.photos && typeof v.photos === 'object') for (const [k, u] of Object.entries(v.photos)) {
    if (typeof u === 'string' && /^(\/uploads\/[\w.-]+|https:\/\/\S+)$/.test(u) && u.length < 400) photos[String(k).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)] = u;
  }
  return {
    photos,
    team: typeof v.team === 'string' ? v.team.slice(0, 60) : '',
    seconds: Math.max(5, Math.min(120, Math.round(Number(v.seconds) || d.seconds))),
    pin: typeof v.pin === 'string' && v.pin ? v.pin.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) : null,
  };
}

export interface WildcardState {
  /** Use the wildcard graphics for this event (program screens + /output/bracket). The /output/wildcard… routes always work. */
  enabled: boolean;
  matches: Record<string, WcMatch>;
  opts: WcOpts;
  /** Part on air. */
  air: 1 | 2;
  /** Match the casters are covering (bracket id), or null. */
  cast: string | null;
  /** Take scores, live flags and times from the event's Google Sheet on every sync. */
  sheetAuto: boolean;
  /** Last values seen on the sheet per match: only fields that change on the sheet overwrite manual edits. */
  sheetSeen: Record<string, Partial<WcMatch>>;
  /** When each match got its result (ordering for "Latest result" on the waiting screen). */
  done: Record<string, number>;
  /** Warm-up player showcase. */
  showcase: WcShowcase;
  /** Match intro. */
  intro: WcIntro;
  /** Analyst desk: what the analysis panel shows. */
  /** Casters (slots 1–3) on the Casters screen and the other camera screens; empty = every caster in the show. */
  booth: number[];
  /** Map veto: the order of steps and what has been called so far. */
  veto: WcVeto;
  /** Team PBs per map, entered by the producer: map id → team name → best time + who set it. */
  pbs: Record<string, Record<string, WcPb>>;
  /** Interview screen (online, RLCS style): the player (profile handle), the host (camera slot), title, question, layout. */
  interview: WcInterview;
  /** Pick'em: the picks each person made, kept per finished match (scored against the result). */
  pickem: Record<string, Record<string, WcPick>>;
  /** Champions takeover on screen (once the Grand final has a winner). */
  champ: boolean;
  /** Map switch card: the map being played and when the card was triggered (server ms). */
  map: { id: string | null; at: number | null };
  /** Uploaded photo per map id (replaces the drawn artwork on the card). */
  mapPhotos: Record<string, string>;
  /** Which bracket the saved results belong to (WC_BRACKET). */
  bracket: string;
  /** The 8 first-round teams (Upper quarter-final 1 = slots 0–1, …); '' = TBD. */
  teams: string[];
  desk: { panel: WcDeskPanel; /** normHandle of the player in focus, or null = first player of team A */ player: string | null; /** Analyst slots (4–5) at the desk; empty = every analyst in the show */ slots: number[]; /** A caster (slot 1–3) joining the desk, or null */ guest: number | null; /** Match strip (teams) on the desk */ strip: boolean; /** "Starts in" countdown on the desk */ clock: boolean };
  /** Server time of the last change. */
  rev: number;
}

export const defaultWcOpts = (): WcOpts => ({ title: true, times: true, seeds: false, bg: false, opacity: 100, rotate: false, rotateSec: 20, inBracket: true, inIntermission: true, inCasters: false, inGameplay: true, inWarmup: true });

export function defaultWildcard(enabled = false): WildcardState {
  const matches: Record<string, WcMatch> = {};
  for (const id of WC_IDS) matches[id] = { s1: '', s2: '', time: defaultTime(id), at: null, live: false };
  return { enabled, pbs: {}, veto: defaultVeto(), interview: defaultInterview(), pickem: {}, champ: false, booth: [], map: { id: null, at: null }, mapPhotos: {}, bracket: WC_BRACKET, matches, teams: Array(8).fill(''), opts: defaultWcOpts(), air: 1, cast: null, sheetAuto: true, sheetSeen: {}, done: {}, showcase: defaultShowcase(), intro: defaultIntro(), desk: { panel: 'cams', player: null, slots: [], guest: null, strip: false, clock: false }, rev: 0 };
}

const score = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase().slice(0, 3) : typeof v === 'number' && Number.isFinite(v) ? String(Math.max(0, Math.round(v))) : '');
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export function sanitizeWcMatch(v: any, id: string): WcMatch {
  return {
    s1: score(v?.s1), s2: score(v?.s2),
    time: typeof v?.time === 'string' ? v.time.slice(0, 24) : defaultTime(id),
    at: typeof v?.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.at) ? v.at : null,
    live: v?.live === true,
  };
}

export function sanitizeWildcard(v: any, enabledDefault = false): WildcardState {
  const d = defaultWildcard(enabledDefault);
  if (!v || typeof v !== 'object') return d;
  // On the switch, the on-screen extras also start hidden (turned on as the match gets closer).
  if (v.bracket !== WC_BRACKET) v = { ...v, matches: {}, sheetSeen: {}, done: {}, cast: null, teams: [], opts: { ...(v.opts ?? {}), inCasters: false, seeds: false }, intro: { ...(v.intro ?? {}), picksShow: false }, desk: { ...(v.desk ?? {}), strip: false, clock: false } };
  const o = v.opts && typeof v.opts === 'object' ? v.opts : {};
  const b = (k: keyof WcOpts) => (typeof o[k] === 'boolean' ? o[k] : d.opts[k]) as boolean;
  // Results saved for another bracket (the Wildcard) don't belong to this one.
  const matches: Record<string, WcMatch> = {};
  for (const id of WC_IDS) matches[id] = v.matches?.[id] ? sanitizeWcMatch(v.matches[id], id) : d.matches[id];
  const seen: Record<string, Partial<WcMatch>> = {};
  for (const id of WC_IDS) if (v.sheetSeen?.[id] && typeof v.sheetSeen[id] === 'object') {
    // Keep only the fields the sheet actually gave, so a later sheet value still counts as a change.
    const s = v.sheetSeen[id], x: Partial<WcMatch> = {};
    if (typeof s.s1 === 'string') x.s1 = str(s.s1, 3);
    if (typeof s.s2 === 'string') x.s2 = str(s.s2, 3);
    if (typeof s.time === 'string') x.time = str(s.time, 24);
    if (typeof s.at === 'string') x.at = s.at.slice(0, 16);
    if (typeof s.live === 'boolean') x.live = s.live;
    seen[id] = x;
  }
  const done: Record<string, number> = {};
  for (const id of WC_IDS) if (Number.isFinite(v.done?.[id])) done[id] = Number(v.done[id]);
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : enabledDefault,
    matches,
    opts: {
      title: b('title'), times: b('times'), seeds: b('seeds'), bg: b('bg'), rotate: b('rotate'),
      opacity: Math.max(40, Math.min(100, Math.round(Number(o.opacity) || d.opts.opacity))),
      rotateSec: Math.max(5, Math.min(300, Math.round(Number(o.rotateSec) || d.opts.rotateSec))),
      inBracket: b('inBracket'), inIntermission: b('inIntermission'), inCasters: b('inCasters'), inGameplay: b('inGameplay'), inWarmup: b('inWarmup'),
    },
    air: v.air === 2 ? 2 : 1,
    veto: sanitizeVeto(v.veto),
    pbs: Object.fromEntries(Object.entries(v.pbs ?? {}).filter(([m, t]) => isMapId(m) && t && typeof t === 'object').map(([m, t]) => [m, Object.fromEntries(Object.entries(t as Record<string, any>).slice(0, 16).map(([team, pb]) => [team.slice(0, 60), sanitizePb(pb)]).filter(([, pb]) => pb))])),
    interview: sanitizeInterview(v.interview),
    pickem: Object.fromEntries(Object.entries(v.pickem ?? {}).filter(([id, p]) => isWcId(id) && p && typeof p === 'object').map(([id, p]) => [id, Object.fromEntries(Object.entries(p as Record<string, any>).filter(([k, x]) => /^[1-5]$/.test(k) && x && typeof x.team === 'string').map(([k, x]) => [k, { team: String(x.team).slice(0, 60), score: PICK_SCORES.includes(x.score) ? x.score : '' }]))])),
    champ: v.champ === true,
    booth: Array.isArray(v.booth) ? [...new Set<number>(v.booth.filter((n: unknown) => n === 1 || n === 2 || n === 3))] : [],
    map: { id: isMapId(v.map?.id) ? v.map.id : null, at: Number.isFinite(v.map?.at) ? Number(v.map.at) : null },
    mapPhotos: Object.fromEntries(Object.entries(v.mapPhotos ?? {}).filter(([k, u]) => isMapId(k) && typeof u === 'string' && /^(\/|https?:)/.test(u as string)).map(([k, u]) => [k, (u as string).slice(0, 500)])),
    bracket: WC_BRACKET,
    teams: Array.from({ length: 8 }, (_, i) => (typeof v.teams?.[i] === 'string' ? v.teams[i].slice(0, 60) : '')),
    cast: isWcId(v.cast) ? v.cast : null,
    sheetAuto: typeof v.sheetAuto === 'boolean' ? v.sheetAuto : true,
    sheetSeen: seen,
    done,
    showcase: sanitizeShowcase(v.showcase),
    intro: sanitizeIntro(v.intro),
    desk: { panel: DESK_PANELS.includes(v.desk?.panel) ? v.desk.panel : 'cams', player: typeof v.desk?.player === 'string' && v.desk.player ? v.desk.player.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) : null,
      // Analysts are slots 4–5; a caster (1–3) at the desk is the guest (older saves listed casters in slots).
      slots: Array.isArray(v.desk?.slots) ? [...new Set<number>(v.desk.slots.filter((n: unknown) => n === 4 || n === 5))].sort() : [],
      guest: [1, 2, 3].includes(v.desk?.guest) ? v.desk.guest : Array.isArray(v.desk?.slots) ? (v.desk.slots.find((n: unknown) => n === 1 || n === 2 || n === 3) ?? null) : null,
      strip: v.desk?.strip === true, clock: v.desk?.clock === true },
    rev: Number(v.rev) || 0,
  };
}

// ----------------------------------------------------------------- resolution

export interface WcResolved {
  t1: string | null; t2: string | null;
  /** "Winner R1 UB 2" style placeholders for empty slots. */
  hints: [string, string];
  winner: string | null; loser: string | null;
}

export const realTeam = (n: string | null | undefined): n is string => !!n && n !== 'BYE';

/** Who plays where and who won, from the scores alone (BYE advances, W/L/FF walkovers, first to 3). */
export function wcResolve(matches: Record<string, WcMatch>, teams: string[] = []): Record<string, WcResolved> {
  const out: Record<string, WcResolved> = {};
  const get = (id: string): WcResolved => {
    if (out[id]) return out[id];
    const slots = WC_STRUCT[id];
    const [a, b] = slots.map(s => (typeof s === 'string' ? s : 's' in s ? teams[s.s] || null : 'w' in s ? get(s.w).winner : get(s.l).loser)) as [string | null, string | null];
    const hints = slots.map(s => {
      if (typeof s === 'string' || 's' in s) return '';
      const src = 'w' in s ? s.w : s.l;
      return `${'w' in s ? 'Winner' : 'Loser'} ${matchName(src).replace(/^Upper |^Lower /, m => m.toLowerCase())}`;
    }) as [string, string];
    const st = matches[id] ?? { s1: '', s2: '' };
    let winner: string | null = null, loser: string | null = null;
    const n1 = parseInt(st.s1, 10), n2 = parseInt(st.s2, 10);
    if (a === 'BYE' && b && b !== 'BYE') { winner = b; loser = 'BYE'; }
    else if (b === 'BYE' && a && a !== 'BYE') { winner = a; loser = 'BYE'; }
    else if (a && b) {
      const lost = (v: string) => v === 'FF' || v === 'L';
      if (st.s1 === 'W' || (lost(st.s2) && !lost(st.s1)) || (n1 >= WINS_NEEDED && !(n2 >= n1))) { winner = a; loser = b; }
      else if (st.s2 === 'W' || (lost(st.s1) && !lost(st.s2)) || (n2 >= WINS_NEEDED && !(n1 >= n2))) { winner = b; loser = a; }
    }
    return (out[id] = { t1: a, t2: b, hints, winner, loser });
  };
  WC_IDS.forEach(get);
  return out;
}

/** Match a team goes to next: the winner's (kind 'w') or the loser's (kind 'l') next match. */
export const nextFrom = (id: string, kind: 'w' | 'l') => WC_IDS.find(k => WC_STRUCT[k].some(s => typeof s === 'object' && (s as any)[kind] === id));

/** The cast match, unless it is already finished. `pin` (an output's ?cast=) overrides the controller's pick. */
export function castId(wc: WildcardState, R: Record<string, WcResolved>, pin?: string | null): string | null {
  const id = pin ? pin.toUpperCase() : wc.cast;
  if (!id || !isWcId(id)) return null;
  return R[id].winner ? null : id;
}

const DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
export const timeKey = (t: string) => { const m = /^(\w{3})\s+(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (DAY[m[1]] || 9) * 1440 + +m[2] * 60 + +m[3] : 99999; };

/** Cast match, else live matches first, then the earliest ready one. */
export function nextMatchId(wc: WildcardState, R: Record<string, WcResolved>, pin?: string | null): string | undefined {
  const c = castId(wc, R, pin);
  if (c) return c;
  const ready = (id: string) => !R[id].winner && realTeam(R[id].t1) && realTeam(R[id].t2);
  return WC_IDS.filter(ready).sort((a, b) =>
    (Number(wc.matches[b].live) - Number(wc.matches[a].live)) || (timeKey(wc.matches[a].time) - timeKey(wc.matches[b].time)) || (WC_IDS.indexOf(a) - WC_IDS.indexOf(b)))[0];
}

/** Start time of a match in local epoch ms (the viewer's clock zone), or null. */
export function matchStart(m: WcMatch): number | null {
  if (m.at) { const t = new Date(m.at).getTime(); return Number.isFinite(t) ? t : null; }
  const x = /^(\w{3})\s+(\d{1,2}):(\d{2})/.exec(m.time || '');
  return x && WC_EVENT_DAYS[x[1]] ? new Date(`${WC_EVENT_DAYS[x[1]]}T${x[2].padStart(2, '0')}:${x[3]}`).getTime() : null;
}

export const STARTING_SOON = 'Starting soon';
export function countdownText(at: number | null, now: number): string {
  if (at == null) return '';
  const ms = at - now;
  if (ms <= 0) return STARTING_SOON;
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`; // days away: no 251:59:01
  return (h ? `${h}:${String(mm).padStart(2, '0')}` : String(mm).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
}

/** All time labels in a column, if they agree. */
export const colTime = (wc: WildcardState, ids: string[]) => { const t = new Set(ids.map(id => wc.matches[id].time)); return t.size === 1 ? [...t][0] : ''; };

// ---------------------------------------------------------------------- ops

export type WcOp =
  | { k: 'score'; id: string; side: 1 | 2; delta: 1 | -1 }
  | { k: 'wo'; id: string; side: 1 | 2 }
  | { k: 'clear'; id: string }
  | { k: 'live'; id: string; on?: boolean }
  | { k: 'time'; id: string; time: string }
  | { k: 'air'; part: 1 | 2 }
  | { k: 'opts'; patch: Partial<WcOpts> }
  | { k: 'enabled'; on: boolean }
  | { k: 'cast'; id: string | null }
  | { k: 'sheet-auto'; on: boolean }
  | { k: 'pull' }
  | { k: 'reset' }
  | { k: 'restore'; data: unknown }
  | { k: 'test'; kind: 'map' | 'match' }
  | { k: 'replay' }
  | { k: 'showcase'; patch: Partial<Omit<WcShowcase, 'photos'>> }
  | { k: 'photo'; player: string; url: string | null }
  | { k: 'intro'; patch: Partial<Omit<WcIntro, 'at' | 'picks'>> }
  | { k: 'pick'; slot: number; pick: WcPick | null }
  | { k: 'booth'; slots: number[] }
  | { k: 'champ'; on: boolean }
  | { k: 'interview'; patch: Partial<WcInterview> }
  | { k: 'veto'; map: string }
  | { k: 'pb'; map: string; team: string; pb: WcPb | null }
  | { k: 'pb-show'; map: string | null }
  | { k: 'veto-undo' }
  | { k: 'veto-reset' }
  | { k: 'veto-order'; order: VetoStep[] }
  | { k: 'pickem-reset' }
  | { k: 'teams'; teams: string[] }
  | { k: 'map'; id: string | null }
  | { k: 'map-photo'; id: string; url: string | null }
  | { k: 'desk'; panel?: WcDeskPanel; player?: string | null; slots?: number[]; guest?: number | null; strip?: boolean; clock?: boolean }
  | { k: 'intro-play' }
  | { k: 'intro-stop' };

/** Score edits from the controller (same rules as the old controller: + caps at 3, − on a walkover clears it). */
export function applyMatchOp(wc: WildcardState, op: WcOp): boolean {
  if (!('id' in op) || !isWcId(op.id)) return false;
  const st = wc.matches[op.id];
  switch (op.k) {
    case 'score': {
      const k = op.side === 1 ? 's1' : 's2', other = op.side === 1 ? 's2' : 's1';
      if (op.delta > 0) {
        if (st.s1 === 'W' || st.s1 === 'L') st.s1 = st.s2 = '';
        const n = parseInt(st[k], 10) || 0;
        if (n < WINS_NEEDED && !(parseInt(st[other], 10) >= WINS_NEEDED)) st[k] = String(n + 1);
        if (st[other] === '') st[other] = '0';
        if (st[k] === String(WINS_NEEDED)) st.live = false;
      } else if (st.s1 === 'W' || st.s1 === 'L') st.s1 = st.s2 = '';
      else { const n = parseInt(st[k], 10) || 0; st[k] = n > 0 ? String(n - 1) : '0'; }
      return true;
    }
    case 'wo': if (op.side === 1) { st.s1 = 'W'; st.s2 = 'L'; } else { st.s1 = 'L'; st.s2 = 'W'; } st.live = false; return true;
    case 'clear': st.s1 = st.s2 = ''; st.live = false; return true;
    case 'live': st.live = typeof op.on === 'boolean' ? op.on : !st.live; return true;
    case 'time': st.time = String(op.time ?? '').slice(0, 24); st.at = null; return true;
  }
  return false;
}

// ------------------------------------------------------------- sheet merge

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "11/7/2026 15:00" (m/d/y) or "07.11.2026 15:00" (d.m.y) → { at: "2026-11-07T15:00", time: "Sat 15:00" }. */
export function sheetWhen(raw: string): { at: string; time: string } | null {
  let y: number, mo: number, d: number, h: string, mi: string;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; h = m[4]; mi = m[5]; }
  else {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/.exec(raw.trim());
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3]; h = m[4]; mi = m[5];
  }
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { at: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${h.padStart(2, '0')}:${mi}`, time: `${DAYS[day]} ${h.padStart(2, '0')}:${mi}` };
}

export interface WcSheetRow { bracket: string; s1: string; s2: string; status: string; when: string }

/** Values the sheet gives for one match (only the fields it actually has). */
export function sheetValues(r: WcSheetRow): Partial<WcMatch> {
  const v: Partial<WcMatch> = { s1: r.s1.trim().toUpperCase(), s2: r.s2.trim().toUpperCase() };
  if (/live|ongoing|in.?progress|playing/i.test(r.status)) v.live = true; else if (/completed/i.test(r.status)) v.live = false;
  const w = sheetWhen(r.when || '');
  if (w) { v.at = w.at; v.time = w.time; }
  return v;
}

/**
 * Merge sheet rows into the state. A field is written when the sheet's value changed since the last
 * pull (or `force`), so a manual correction stays until the sheet itself changes. Returns true if anything changed.
 */
export function mergeSheet(wc: WildcardState, rows: WcSheetRow[], force = false): boolean {
  let changed = false;
  for (const r of rows) {
    if (!isWcId(r.bracket)) continue;
    const v = sheetValues(r), seen = wc.sheetSeen[r.bracket] ?? {}, st = wc.matches[r.bracket];
    for (const k of Object.keys(v) as (keyof WcMatch)[]) {
      if (!force && seen[k] === v[k]) continue;
      if (st[k] !== v[k]) { (st as any)[k] = v[k]; changed = true; }
    }
    wc.sheetSeen[r.bracket] = { ...seen, ...v };
  }
  return changed;
}

// ------------------------------------------------------------ events (popups)

export interface WcSnap { s1: string; s2: string; t1: string | null; t2: string | null; w: string | null }
export function wcSnapshot(wc: WildcardState): Record<string, WcSnap> {
  const R = wcResolve(wc.matches, wc.teams), out: Record<string, WcSnap> = {};
  for (const id of WC_IDS) out[id] = { s1: wc.matches[id].s1, s2: wc.matches[id].s2, t1: R[id].t1, t2: R[id].t2, w: R[id].winner };
  return out;
}

/** A popup for the gameplay scene, with the values it shows frozen at the moment it happened. */
export interface WcPop {
  seq: number;
  /** 'clear' = producer panic: drop the queue and take the current popup out */
  kind: 'map' | 'match' | 'clear';
  id: string;
  /** map: 1 or 2 = who won the map, 0 = both changed (score update) */
  side: 0 | 1 | 2;
  /** maps added at once (>1 = "score update") */
  jump: number;
  t1: string; t2: string; s1: string; s2: string;
  winner: string | null; loser: string | null;
  test?: boolean;
}

/** Map wins and match results between two snapshots (slots that just got filled in are not results). */
export function diffEvents(prev: Record<string, WcSnap>, now: Record<string, WcSnap>): Omit<WcPop, 'seq'>[] {
  const ev: Omit<WcPop, 'seq'>[] = [];
  for (const id of WC_IDS) {
    const a = prev[id], b = now[id];
    if (!a || !realTeam(b.t1) || !realTeam(b.t2)) continue;
    if (a.t1 !== b.t1 || a.t2 !== b.t2) continue;
    const base = { id, t1: b.t1, t2: b.t2, s1: b.s1, s2: b.s2 };
    if (b.w && !a.w) { ev.push({ ...base, kind: 'match', side: 0, jump: 0, winner: b.w, loser: b.w === b.t1 ? b.t2 : b.t1 }); continue; }
    if (b.w) continue;
    const n = (k: 's1' | 's2') => parseInt(b[k], 10) || 0, o = (k: 's1' | 's2') => parseInt(a[k], 10) || 0;
    const up1 = n('s1') > o('s1'), up2 = n('s2') > o('s2');
    if (up1 || up2) ev.push({ ...base, kind: 'map', side: up1 && up2 ? 0 : up1 ? 1 : 2, jump: n('s1') + n('s2') - (o('s1') + o('s2')), winner: null, loser: null });
  }
  return ev;
}

/** A made-up popup on the first match that can be played (Test buttons). */
export function demoEvent(wc: WildcardState, kind: 'map' | 'match'): Omit<WcPop, 'seq'> {
  const R = wcResolve(wc.matches, wc.teams);
  const id = WC_IDS.find(k => realTeam(R[k].t1) && realTeam(R[k].t2) && !R[k].winner) ?? 'R1_UB1';
  const t1 = R[id].t1 ?? 'BIG', t2 = R[id].t2 ?? 'Ragnarok';
  return kind === 'map'
    ? { kind, id, side: 1, jump: 1, t1, t2, s1: '2', s2: '1', winner: null, loser: null, test: true }
    : { kind, id, side: 0, jump: 0, t1, t2, s1: '3', s2: '1', winner: t1, loser: t2, test: true };
}

/** Keep `done` in step with the results: first time each match has a real result. */
export function updateDone(wc: WildcardState, now = Date.now()): boolean {
  const R = wcResolve(wc.matches, wc.teams), first = !Object.keys(wc.done).length;
  let changed = false;
  WC_IDS.forEach((id, i) => {
    const r = R[id];
    if (r.winner && r.loser !== 'BYE' && realTeam(r.t1) && realTeam(r.t2)) { if (!wc.done[id]) { wc.done[id] = first ? i + 1 : now; changed = true; } }
    else if (wc.done[id]) { delete wc.done[id]; changed = true; }
  });
  return changed;
}

/** Results newest first. */
export const doneList = (wc: WildcardState) => Object.keys(wc.done).filter(isWcId).sort((a, b) => wc.done[b] - wc.done[a]);

/** Shown in /api/v1/state and the restore check. */
export function isWcBackup(v: any): boolean {
  return !!v && typeof v === 'object' && !!v.matches && typeof v.matches === 'object' && WC_IDS.some(id => v.matches[id]);
}


// ------------------------------------------------------------------ pick'em

/** Points for one pick: 1 for the right winner, 3 for the right winner and exact score, 0 otherwise. */
export function pickPoints(pick: WcPick, m: WcMatch, r: WcResolved): number {
  if (!r.winner || pick.team !== r.winner) return 0;
  const a = Number(m.s1), b = Number(m.s2);
  const exact = Number.isFinite(a) && Number.isFinite(b) && pick.score === `${Math.max(a, b)}-${Math.min(a, b)}`;
  return exact ? 3 : 1;
}

export interface PickemRow { slot: string; points: number; right: number; exact: number; played: number }

/** Standings over every finished match with picks, best first. */
export function pickemTable(wc: WildcardState): PickemRow[] {
  const R = wcResolve(wc.matches, wc.teams), rows: Record<string, PickemRow> = {};
  for (const [id, picks] of Object.entries(wc.pickem)) {
    if (!R[id]?.winner) continue;
    for (const [slot, p] of Object.entries(picks)) {
      const row = rows[slot] ??= { slot, points: 0, right: 0, exact: 0, played: 0 };
      const pts = pickPoints(p, wc.matches[id], R[id]);
      row.played++; row.points += pts; if (pts) row.right++; if (pts === 3) row.exact++;
    }
  }
  return Object.values(rows).sort((x, y) => y.points - x.points || y.exact - x.exact || Number(x.slot) - Number(y.slot));
}


// ------------------------------------------------------------------ interview

export const INTERVIEW_TITLES = ['Post-match interview', 'Pre-match interview', 'Champion interview', 'Player interview'] as const;
export interface WcInterview {
  /** normHandle of the player (Major profile), or '' = use the guest camera's name. */
  player: string;
  /** Camera slot of the host (1–5), or null = guest only. */
  host: number | null;
  title: string;
  /** Question shown in the banner (when showQ). */
  question: string;
  showQ: boolean;
  /** Lower third with the player's name, team and country. */
  lower: boolean;
}
export const defaultInterview = (): WcInterview => ({ player: '', host: 3, title: INTERVIEW_TITLES[0], question: '', showQ: false, lower: true });
export function sanitizeInterview(v: any): WcInterview {
  const d = defaultInterview();
  if (!v || typeof v !== 'object') return d;
  return {
    player: typeof v.player === 'string' ? v.player.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) : '',
    host: v.host === null ? null : [1, 2, 3, 4, 5].includes(v.host) ? v.host : d.host,
    title: typeof v.title === 'string' && v.title.trim() ? v.title.slice(0, 60) : d.title,
    question: typeof v.question === 'string' ? v.question.slice(0, 160) : '',
    showQ: v.showQ === true,
    lower: v.lower !== false,
  };
}


// ------------------------------------------------------------------ map veto

/** One veto step: who acts (team A, team B, or the decider = the map left over) and what they do. */
export interface VetoStep { by: 'a' | 'b' | 'd'; act: 'pick' | 'ban' }
export interface WcVeto {
  order: VetoStep[];
  /** Map id per step already called, in order. */
  done: string[];
  /** When the last step was called (server ms): animates the new stamp. */
  at: number | null;
  /** PB comparison on the veto screen: shown while map is set (from the controls), until hidden. */
  pb: { map: string | null; at: number | null };
}
const P = (by: VetoStep['by'], act: VetoStep['act'] = 'pick'): VetoStep => ({ by, act });
export const VETO_PRESETS: { id: string; label: string; order: VetoStep[] }[] = [
  { id: 'picks', label: 'Pick order · Bo5 (A, B, A, B, decider)', order: [P('a'), P('b'), P('a'), P('b'), P('d')] },
  { id: 'bans-bo3', label: 'Ban, ban, pick, pick, decider · Bo3', order: [P('a', 'ban'), P('b', 'ban'), P('a'), P('b'), P('d')] },
  { id: 'bans-bo1', label: 'Ban ×4 · Bo1 decider', order: [P('a', 'ban'), P('b', 'ban'), P('a', 'ban'), P('b', 'ban'), P('d')] },
];
export const defaultVeto = (): WcVeto => ({ order: VETO_PRESETS[0].order, done: [], at: null, pb: { map: null, at: null } });
export function sanitizeVeto(v: any): WcVeto {
  const d = defaultVeto();
  if (!v || typeof v !== 'object') return d;
  const order = Array.isArray(v.order) ? v.order.filter((x: any) => x && ['a', 'b', 'd'].includes(x.by) && ['pick', 'ban'].includes(x.act)).slice(0, MAJOR_MAPS.length).map((x: any) => ({ by: x.by, act: x.by === 'd' ? 'pick' : x.act })) : d.order;
  const done: string[] = [];
  for (const m of Array.isArray(v.done) ? v.done : []) if (isMapId(m) && !done.includes(m) && done.length < order.length) done.push(m);
  return { order: order.length ? order : d.order, done, at: Number.isFinite(v.at) ? Number(v.at) : null,
    pb: { map: isMapId(v.pb?.map) ? v.pb.map : null, at: Number.isFinite(v.pb?.at) ? Number(v.pb.at) : null } };
}

/** Call the next step on a map; the decider is filled in automatically when one map is left. */
export function vetoApply(v: WcVeto, map: string, now: number): WcVeto {
  if (!isMapId(map) || v.done.includes(map) || v.done.length >= v.order.length) return v;
  const done = [...v.done, map];
  const left = MAJOR_MAPS.map(m => m.id).filter(id => !done.includes(id));
  if (v.order[done.length]?.by === 'd' && left.length === 1) done.push(left[0]);
  return { ...v, done, at: now };
}

export interface VetoRow { map: string; step: VetoStep; n: number; mapNo: number | null }
/** Called steps with their play order ("Map 2") for picks and the decider. */
export function vetoRows(v: WcVeto): VetoRow[] {
  let k = 0;
  return v.done.map((map, i) => ({ map, step: v.order[i], n: i + 1, mapNo: v.order[i].act === 'pick' ? ++k : null }));
}


// ------------------------------------------------------------------ PBs

export interface WcPb { time: string; player: string }
export function sanitizePb(v: any): WcPb | null {
  if (!v || typeof v !== 'object') return null;
  const time = typeof v.time === 'string' ? v.time.trim().slice(0, 12) : '';
  if (!time || pbMs(time) == null) return null;
  return { time, player: typeof v.player === 'string' ? v.player.slice(0, 40) : '' };
}
/** "43.512", "0:43.512", "1:02.3" → milliseconds; null if it isn't a time. */
export function pbMs(t: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(t.trim());
  if (!m) return null;
  const ms = (m[3] ?? '0').padEnd(3, '0');
  return (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 + Number(ms);
}
/** 43512 → "43.512", 62345 → "1:02.345" */
export function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000), f = String(ms % 1000).padStart(3, '0');
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${f}` : `${s}.${f}`;
}

/**
 * Overdrive 3.1 · TRACK PROGRESSION (round-by-round story of one track / map of a Duos match).
 *
 * Integrated from the "broadcast_overlays" Track Progression overlay: same data (the sheet's 28-column round rows:
 * `db_rounds_flat` queried by match + track, or the Control tab `out_track_progression`), same reading of the
 * rounds (cumulative points, Ace = a 3–0 round, Draw = 1–1, the point threshold, overtime), drawn as an Overdrive
 * graphic. Teams and maps resolve to Overdrive's own (logos, map shots), so nothing is duplicated.
 *
 * The data lives in the event's wildcard state (`wc.track`): every console, the graphic and its OBS source read
 * the same thing. Two sources: the Google Sheet (loaded by the server, optional auto refresh) or rounds entered in
 * Overdrive (works with no sheet). Never invents results: a demo map is only shown when asked for, labelled DEMO.
 */
import { MAJOR_MAPS } from './maps';
import { MAJOR_PROFILES, MAJOR_TEAMS } from './major';
import { hiRes } from './assetRes';

export interface TrackTeam {
  /** Display name (an Overdrive team name when it is one of ours). */
  name: string;
  /** Short tag (BIG, NAVI…), shown when space is short. */
  tag: string;
  /** "Player & Player". */
  roster: string;
  /** Logo file stem in /brand/overdrive/teams ('' = none: the tag badge is drawn). */
  logo: string;
}
export interface TrackRound { round: number; ptsA: number; ptsB: number; comboA: string; comboB: string }
export interface TrackMapData {
  matchId: string;
  /** Track number in the series (1-based), null = unknown. */
  mapNumber: number | null;
  /** Track name as given ("OverDrive India 2026", "India"…). */
  track: string;
  /** Overdrive map id (MAJOR_MAPS) when the name matches one, else ''. */
  mapId: string;
  /** "BIG PICK", "DECIDER"… */
  pickedBy: string;
  pointLimit: number;
  teamA: TrackTeam;
  teamB: TrackTeam;
  rounds: TrackRound[];
  fastest: { player: string; timeMs: number; round: string } | null;
  /** Custom key takeaway (sheet column AB, or typed); '' = written from the rounds. */
  narrative: string;
}
export interface TrackSrc {
  mode: 'sheet' | 'manual';
  /** Google Sheet id ('' = the event's sheet from Data / Sheet sync). */
  sheetId: string;
  /** Control tab read when no match is given. */
  tab: string;
  /** Sheet match id (match_0006) for a direct query of `db_rounds_flat`; '' = the Control tab. */
  match: string;
  track: number;
  /** Reload from the sheet every few seconds. */
  auto: boolean;
}
export interface TrackLive { src: TrackSrc; data: TrackMapData | null; at: number; error: string; demo: boolean }

export const TRACK_FLAT_TAB = 'db_rounds_flat';
export const TRACK_CONTROL_TAB = 'out_track_progression';
/** The overlay package's sheet (where db_rounds_flat lives). */
export const TRACK_DEFAULT_SHEET = '1ZlhvryIJDmUXrCaDgLme9SP_gAv6azwIt7ErNT7Ej1w';
export const TRACK_POINT_LIMIT = 10;
/** Round results of a Duos round (positions of the two players of each team): 1-2 → 3–0, 1-3 → 2–1, 1-4 → 1–1. */
export const ROUND_RESULTS: [number, number, string][] = [[3, 0, '1-2'], [2, 1, '1-3'], [1, 1, '1-4'], [1, 2, '2-4'], [0, 3, '3-4']];
const COMBO: Record<string, [string, string]> = { '3-0': ['1-2', '3-4'], '2-1': ['1-3', '2-4'], '1-1': ['1-4', '2-3'], '1-2': ['2-4', '1-3'], '0-3': ['3-4', '1-2'] };

export const defaultTrackSrc = (): TrackSrc => ({ mode: 'manual', sheetId: '', tab: TRACK_CONTROL_TAB, match: '', track: 1, auto: false });
export const emptyTrack = (): TrackLive => ({ src: defaultTrackSrc(), data: null, at: 0, error: '', demo: false });

// ------------------------------------------------------------------ teams & maps → Overdrive

/** Team logo files in /brand/overdrive/teams (the overlay package's logos are the same files). */
export const TEAM_LOGOS = ['abyssal', 'ag', 'airwalkers', 'big', 'bombo', 'brothers', 'cook', 'dyslexai', 'grassboyz', 'navixjoel', 'nyxar', 'nyxbar', 'onic', 'piwo', 'ragnarok', 'rnboi', 'tmtas', 'weiboxfut', 'wings'];
const norm = (s: string) => s.toLowerCase().replace(/\.(png|svg|jpe?g|webp)$/, '').replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string> = { navi: 'Natus Vincere', natusvincere: 'Natus Vincere', navixjoel: 'Natus Vincere', fut: 'FUT Esports', weiboxfut: 'FUT Esports', futesports: 'FUT Esports', agg: 'All Gamers Global', ag: 'All Gamers Global', allgamersglobal: 'All Gamers Global' };

/** A team from the sheet (tag, name, logo slug) → its Overdrive identity (Major name + logo) when we know it. */
export function resolveTeam(t: { name?: string; tag?: string; roster?: string; logo?: string }): TrackTeam {
  const name = (t.name || t.tag || '').trim(), tag = (t.tag || '').trim();
  const keys = [name, tag, t.logo ?? ''].map(norm).filter(Boolean);
  const major = MAJOR_TEAMS.find(m => keys.some(k => k === norm(m.name) || k === m.logo || ALIASES[k] === m.name));
  const logo = major?.logo ?? keys.find(k => TEAM_LOGOS.includes(k)) ?? '';
  const roster = (t.roster || '').trim() || (major ? MAJOR_PROFILES.filter(p => p.team === major.name).map(p => p.handle).join(' & ') : '');
  // no tag given: our team's name, else the first word of the name ("Nyxar Competitive" → "Nyxar")
  return { name: major?.name ?? (name || 'Team'), tag: (tag || major?.name || name.split(/\s+/)[0] || 'TBD').slice(0, 12), roster, logo };
}
export const teamLogoUrl = (t: TrackTeam) => (t.logo && TEAM_LOGOS.includes(t.logo) ? hiRes(`/brand/overdrive/teams/${t.logo}.png`) : '');

/** "OverDrive India 2026", "india", "Czech Republic" → Overdrive map id. */
export function resolveMapId(track: string): string {
  const k = norm(track);
  if (!k) return '';
  return MAJOR_MAPS.find(m => k === m.id || k === norm(m.country) || k === norm(m.title) || k.includes(norm(m.country)))?.id ?? '';
}

// ------------------------------------------------------------------ the sheet's round rows

const int = (s: string | undefined, d = 0) => { const n = Number(String(s ?? '').trim()); return Number.isFinite(n) ? Math.round(n) : d; };

/**
 * The 28-column rows of `db_rounds_flat` / `out_track_progression` (header row first):
 * A match_id · B track_number · C round_number · D track_id · E p1_team_id · F team_a_id · G team_b_id · H pts_a · I pts_b ·
 * J combo_a · K combo_b · L track_name · M picked_by · N point_limit · O team_a_tag · P team_a_name · Q team_a_roster ·
 * R team_a_color · S team_a_logo_slug · T team_b_tag · U team_b_name · V team_b_roster · W team_b_color ·
 * X team_b_logo_slug · Y fastest_player · Z fastest_time_ms · AA fastest_round · AB custom_takeaway
 */
export function parseTrackRows(rows: string[][]): TrackMapData {
  // gviz detects the header row by itself; a tab that is not a round table (gviz answers a missing tab with the
  // FIRST tab of the sheet) must not be read as rounds.
  const h = (rows[0] ?? []).map(c => c.toLowerCase());
  const looksData = (r: string[] | undefined) => !!r && (r[0] ?? '').trim() !== '' && /^\d+$/.test((r[2] ?? '').trim()) && /^\d+$/.test((r[7] ?? '').trim()) && /^\d+$/.test((r[8] ?? '').trim());
  const header = h[0]?.includes('match') && h[2]?.includes('round');
  if (!header && !looksData(rows[0])) throw new Error(`Not a round table (expected match_id, track_number, round_number… in A–C): check the tab name`);
  const data = (header ? rows.slice(1) : rows).filter(r => (r[0] ?? '').trim() && (r[2] ?? '').trim() !== '' && Number.isFinite(Number(r[2])));
  if (!data.length) throw new Error(rows.length > 1 ? 'No round rows for that match / track yet' : 'The tab is empty');
  const meta = data.find(r => int(r[2]) === 1 || (r[11] ?? '').trim()) ?? data[0];
  const g = (i: number) => (meta[i] ?? '').trim();
  const track = g(11) || g(3) || 'Track';
  const rounds: TrackRound[] = data.map(c => ({ round: int(c[2]), ptsA: clampPts(int(c[7])), ptsB: clampPts(int(c[8])), comboA: (c[9] ?? '').trim() || '-', comboB: (c[10] ?? '').trim() || '-' }))
    .filter(r => r.round > 0).sort((a, b) => a.round - b.round)
    .filter((r, i, a) => i === 0 || a[i - 1].round !== r.round); // one row per round
  const ft = int(g(25));
  return {
    matchId: g(0), mapNumber: int(g(1)) || null, track, mapId: resolveMapId(track), pickedBy: g(12).toUpperCase(), pointLimit: int(g(13)) || TRACK_POINT_LIMIT,
    // the id columns (team_011) are internal ids, never a display tag
    teamA: resolveTeam({ tag: g(14) || notId(g(5)), name: g(15), roster: g(16), logo: g(18) }),
    teamB: resolveTeam({ tag: g(19) || notId(g(6)), name: g(20), roster: g(21), logo: g(23) }),
    rounds, fastest: g(24) && ft > 0 ? { player: g(24), timeMs: ft, round: g(26) } : null, narrative: g(27),
  };
}
const notId = (v: string) => (/^team[_-]?\d+$/i.test(v) ? '' : v);
const clampPts = (n: number) => Math.max(0, Math.min(3, n));

/** gviz CSV URL of the track rows: direct query (match + track) or the Control tab. */
export function trackSheetUrl(sheetId: string, src: Pick<TrackSrc, 'match' | 'track' | 'tab'>): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv`;
  const m = src.match.trim().replace(/'/g, '');
  if (m) return `${base}&sheet=${TRACK_FLAT_TAB}&tq=${encodeURIComponent(`SELECT * WHERE A = '${m}' AND B = ${Math.max(1, Math.round(src.track) || 1)} ORDER BY C ASC`)}`;
  return `${base}&sheet=${encodeURIComponent(src.tab || TRACK_CONTROL_TAB)}`;
}

// ------------------------------------------------------------------ the story of the track

export interface TrackStep extends TrackRound { cumA: number; cumB: number; outcome: 'ACE' | 'WIN' | 'DRAW'; winner: 'a' | 'b' | null }
export interface TrackStory {
  steps: TrackStep[];
  scoreA: number;
  scoreB: number;
  /** Leader now ('a' / 'b' / null when level). */
  leader: 'a' | 'b' | null;
  /** The track is over: someone reached the threshold and leads. */
  done: boolean;
  /** Winner of the track (only when done). */
  winner: 'a' | 'b' | null;
  /** Overtime: both teams reached the threshold. */
  overtime: boolean;
  acesA: number; acesB: number; draws: number;
  /** Largest deficit the leader came back from. */
  comeback: number;
  /** Key takeaway (custom, else written from the rounds). */
  narrative: string;
}

export function trackStory(d: TrackMapData): TrackStory {
  let a = 0, b = 0, acesA = 0, acesB = 0, draws = 0;
  const steps: TrackStep[] = d.rounds.map(r => {
    a += r.ptsA; b += r.ptsB;
    const ace = r.ptsA === 3 || r.ptsB === 3, draw = r.ptsA === r.ptsB;
    if (r.ptsA === 3) acesA++; if (r.ptsB === 3) acesB++; if (draw) draws++;
    return { ...r, cumA: a, cumB: b, outcome: ace ? 'ACE' : draw ? 'DRAW' : 'WIN', winner: r.ptsA > r.ptsB ? 'a' : r.ptsB > r.ptsA ? 'b' : null };
  });
  const leader = a > b ? 'a' : b > a ? 'b' : null;
  const done = !!leader && Math.max(a, b) >= d.pointLimit;
  const winner = done ? leader : null;
  let comeback = 0;
  if (leader) for (const s of steps) comeback = Math.max(comeback, leader === 'a' ? s.cumB - s.cumA : s.cumA - s.cumB);
  const overtime = Math.min(a, b) >= d.pointLimit;
  const story = { steps, scoreA: a, scoreB: b, leader, done, winner, overtime, acesA, acesB, draws, comeback, narrative: '' } as TrackStory;
  story.narrative = d.narrative.trim() || autoNarrative(d, story);
  return story;
}

function autoNarrative(d: TrackMapData, s: TrackStory): string {
  const n = s.steps.length;
  if (!n) return 'Waiting for the first round.';
  const lead = s.leader === 'a' ? d.teamA : s.leader === 'b' ? d.teamB : null;
  const W = (lead?.name ?? '').toUpperCase(), hi = Math.max(s.scoreA, s.scoreB), lo = Math.min(s.scoreA, s.scoreB);
  if (!s.done) {
    if (!lead) return `Level at ${s.scoreA}–${s.scoreB} after ${n} round${n === 1 ? '' : 's'}: first to ${d.pointLimit} with the lead takes the track.`;
    return `${W} lead ${hi}–${lo} after ${n} round${n === 1 ? '' : 's'}${hi >= d.pointLimit ? ': one round from the track' : `, ${d.pointLimit - hi} point${d.pointLimit - hi === 1 ? '' : 's'} from the threshold`}.`;
  }
  const aces = s.winner === 'a' ? s.acesA : s.acesB;
  if (s.overtime) return `Overtime thriller: level past the ${d.pointLimit}-point threshold before ${W} clinched it ${hi}–${lo}.`;
  if (s.comeback >= 4) return `${W} erased a ${s.comeback}-point deficit to take the track in ${n} rounds.`;
  if (aces >= 3) return `${W} dominated the pace with ${aces} clean 1-2 aces (${aces * 3} points from lockouts alone).`;
  if (s.draws >= 3) return `Tactical stalemate: ${s.draws} of ${n} rounds ended 1–1 before ${W} broke away.`;
  return `${W} controlled the pace across ${n} rounds to take the track ${hi}–${lo}.`;
}

export function lapTime(ms: number): string {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = String(ms % 1000).padStart(3, '0');
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${x}` : `${s}.${x}`;
}

// ------------------------------------------------------------------ entered in Overdrive (no sheet needed)

export type TrackOp =
  | { k: 'track-src'; patch: Partial<TrackSrc> }
  /** Start a track: teams, map, number, picked by (rounds cleared). */
  | { k: 'track-new'; teamA: string; teamB: string; mapId: string; mapNumber: number | null; pickedBy: string; pointLimit?: number; matchId?: string }
  | { k: 'track-round'; ptsA: number; ptsB: number }
  | { k: 'track-undo' }
  | { k: 'track-meta'; patch: { pickedBy?: string; pointLimit?: number; narrative?: string; fastest?: TrackMapData['fastest'] } }
  /** Load the sheet now (server). */
  | { k: 'track-load' }
  /** Demo map (clearly labelled), for rehearsal / layout checks. */
  | { k: 'track-demo' }
  | { k: 'track-clear' };

const RESULT_OK = (a: number, b: number) => ROUND_RESULTS.some(([x, y]) => x === a && y === b);

/** Apply an operator op to the track state (pure; 'track-load' is the server's). Returns an error or null. */
export function applyTrackOp(t: TrackLive, op: TrackOp, now: number): string | null {
  switch (op.k) {
    case 'track-src': {
      const p = op.patch ?? {};
      t.src = sanitizeTrackSrc({ ...t.src, ...p });
      return null;
    }
    case 'track-new': {
      const map = MAJOR_MAPS.find(m => m.id === op.mapId);
      t.data = {
        matchId: String(op.matchId ?? '').slice(0, 40), mapNumber: op.mapNumber && op.mapNumber > 0 ? Math.min(9, Math.round(op.mapNumber)) : null,
        track: map?.title ?? 'Track', mapId: map?.id ?? '', pickedBy: String(op.pickedBy ?? '').toUpperCase().slice(0, 30),
        pointLimit: clampLimit(op.pointLimit), teamA: resolveTeam({ name: op.teamA }), teamB: resolveTeam({ name: op.teamB }), rounds: [], fastest: null, narrative: '',
      };
      t.demo = false; t.at = now; t.error = '';
      if (t.src.mode !== 'manual') t.src = { ...t.src, mode: 'manual', auto: false };
      return null;
    }
    case 'track-round': {
      if (!t.data) return 'Start a track first';
      if (!RESULT_OK(op.ptsA, op.ptsB)) return 'A round ends 3–0, 2–1, 1–1, 1–2 or 0–3';
      if (t.data.rounds.length >= 40) return 'Too many rounds';
      const [ca, cb] = COMBO[`${op.ptsA}-${op.ptsB}`];
      t.data.rounds.push({ round: t.data.rounds.length + 1, ptsA: op.ptsA, ptsB: op.ptsB, comboA: ca, comboB: cb });
      t.at = now; t.demo = false;
      if (t.src.mode !== 'manual') t.src = { ...t.src, mode: 'manual', auto: false };
      return null;
    }
    case 'track-undo': {
      if (!t.data?.rounds.length) return 'No round to undo';
      t.data.rounds.pop(); t.at = now; return null;
    }
    case 'track-meta': {
      if (!t.data) return 'Start a track first';
      const p = op.patch ?? {};
      if (typeof p.pickedBy === 'string') t.data.pickedBy = p.pickedBy.toUpperCase().slice(0, 30);
      if (p.pointLimit != null) t.data.pointLimit = clampLimit(p.pointLimit);
      if (typeof p.narrative === 'string') t.data.narrative = p.narrative.slice(0, 200);
      if (p.fastest !== undefined) t.data.fastest = p.fastest && p.fastest.player && p.fastest.timeMs > 0 ? { player: String(p.fastest.player).slice(0, 40), timeMs: Math.round(p.fastest.timeMs), round: String(p.fastest.round ?? '').slice(0, 4) } : null;
      t.at = now; return null;
    }
    case 'track-demo': t.data = demoTrack(); t.demo = true; t.at = now; t.error = ''; if (t.src.mode === 'sheet') t.src = { ...t.src, auto: false }; return null;
    case 'track-clear': t.data = null; t.demo = false; t.at = now; t.error = ''; return null;
    case 'track-load': return null;
  }
  return 'Unknown track operation';
}
const clampLimit = (n: unknown) => Math.max(3, Math.min(30, Math.round(Number(n) || TRACK_POINT_LIMIT)));

/** Demo: the overlay's "overtime" story with two of our teams, labelled DEMO on the graphic. */
export function demoTrack(): TrackMapData {
  const r: [number, number][] = [[0, 3], [1, 2], [3, 0], [2, 1], [0, 3], [3, 0], [1, 1], [1, 1], [2, 1]];
  return {
    matchId: 'demo', mapNumber: 2, track: 'OverDrive India 2026', mapId: 'india', pickedBy: 'BIG PICK', pointLimit: 10,
    teamA: resolveTeam({ name: 'BIG' }), teamB: resolveTeam({ name: 'FUT Esports' }),
    rounds: r.map(([a, b], i) => ({ round: i + 1, ptsA: a, ptsB: b, comboA: COMBO[`${a}-${b}`][0], comboB: COMBO[`${a}-${b}`][1] })),
    fastest: { player: 'Massa', timeMs: 41237, round: '6' }, narrative: '',
  };
}

// ------------------------------------------------------------------ sanitize (saved state)

export function sanitizeTrackSrc(v: any): TrackSrc {
  const d = defaultTrackSrc();
  return {
    mode: v?.mode === 'sheet' ? 'sheet' : 'manual',
    sheetId: typeof v?.sheetId === 'string' ? v.sheetId.trim().replace(/[^\w-]/g, '').slice(0, 80) : d.sheetId,
    tab: typeof v?.tab === 'string' && v.tab.trim() ? v.tab.trim().slice(0, 60) : d.tab,
    match: typeof v?.match === 'string' ? v.match.trim().replace(/[^\w.-]/g, '').slice(0, 40) : '',
    track: Math.max(1, Math.min(9, Math.round(Number(v?.track) || 1))),
    auto: v?.auto === true,
  };
}
function sanitizeTeam(v: any): TrackTeam {
  const s = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  return { name: s(v?.name, 60) || 'Team', tag: s(v?.tag, 12), roster: s(v?.roster, 120), logo: TEAM_LOGOS.includes(v?.logo) ? v.logo : '' };
}
export function sanitizeTrackData(v: any): TrackMapData | null {
  if (!v || typeof v !== 'object' || !Array.isArray(v.rounds)) return null;
  const s = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  return {
    matchId: s(v.matchId, 40), mapNumber: Number(v.mapNumber) > 0 ? Math.min(9, Math.round(Number(v.mapNumber))) : null, track: s(v.track, 80) || 'Track',
    mapId: MAJOR_MAPS.some(m => m.id === v.mapId) ? v.mapId : '', pickedBy: s(v.pickedBy, 30), pointLimit: clampLimit(v.pointLimit),
    teamA: sanitizeTeam(v.teamA), teamB: sanitizeTeam(v.teamB),
    rounds: v.rounds.slice(0, 40).map((r: any, i: number) => ({ round: Math.max(1, Math.round(Number(r?.round) || i + 1)), ptsA: clampPts(Math.round(Number(r?.ptsA) || 0)), ptsB: clampPts(Math.round(Number(r?.ptsB) || 0)), comboA: s(r?.comboA, 8) || '-', comboB: s(r?.comboB, 8) || '-' })),
    fastest: v.fastest && typeof v.fastest.player === 'string' && Number(v.fastest.timeMs) > 0 ? { player: s(v.fastest.player, 40), timeMs: Math.round(Number(v.fastest.timeMs)), round: s(String(v.fastest.round ?? ''), 4) } : null,
    narrative: s(v.narrative, 200),
  };
}
export function sanitizeTrack(v: any): TrackLive {
  return { src: sanitizeTrackSrc(v?.src), data: sanitizeTrackData(v?.data), at: Number(v?.at) || 0, error: typeof v?.error === 'string' ? v.error.slice(0, 200) : '', demo: v?.demo === true };
}

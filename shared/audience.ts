/**
 * Audience interaction (Pick'ems + Community MVP): types shared by the vote service (vote/), the broadcast server
 * (server/audience.ts) and the browser (public page, Producer modules, graphics).
 *
 * The vote service owns viewers' picks and votes (Postgres). The broadcast server owns the bracket, the results and
 * the desk's picks, and is the only thing that talks to OBS. Graphics only ever draw FROZEN results (a poll that is
 * closed, a match that is locked), never live counts.
 */
import { MAJOR_PROFILES, MAJOR_TEAMS, normHandle } from './major';

export const PICK_SCORES_BO5 = ['3-0', '3-1', '3-2'] as const;

/** What the broadcast server tells the vote service about one bracket match (only when both teams are known). */
export interface AudMatchIn {
  id: string;
  label: string;
  a: string; b: string;
  bestOf: number;
  /** Being played (picks lock). */
  live: boolean;
  /** Producer locked picks for this match. */
  locked: boolean;
  winner: string | null;
  /** "3-1" from the winner's side, once final. */
  score: string | null;
}
export interface AudSessionIn {
  session: string;
  name: string;
  matches: AudMatchIn[];
  /** Champion picks stay open until this is true (first match starts, or the producer locks them). */
  championLocked: boolean;
}

export type AudMatchStatus = 'open' | 'locked' | 'final';
export const matchStatus = (m: Pick<AudMatchIn, 'live' | 'locked' | 'winner'>): AudMatchStatus => (m.winner ? 'final' : m.live || m.locked ? 'locked' : 'open');

export type PollStatus = 'draft' | 'open' | 'closed' | 'revealed';
export interface AudPlayer { handle: string; team: string }
export interface AudFrozen { total: number; counts: Record<string, number>; at: number; hash: string }
export interface AudPoll {
  id: string;
  match: string;
  label: string;
  /** Final score line, e.g. "BIG 3–1 FUT Esports". */
  result: string;
  players: AudPlayer[];
  status: PollStatus;
  openedAt: number | null;
  closedAt: number | null;
  /** Live counts: PRIVATE (producer only, never on air, never public). */
  total?: number;
  counts?: Record<string, number>;
  /** Frozen at close: the only result graphics and the public page may show. */
  frozen: AudFrozen | null;
}

export interface AudMatchTotals {
  id: string;
  status: AudMatchStatus;
  total: number;
  byTeam: Record<string, number>;
  /** "BIG 3-1" style keys. */
  byScore: Record<string, number>;
  /** Shown on air (or the match is final): the public page may show the split. */
  revealed: boolean;
}

/** The community's record: its majority pick per final match, scored with the Overdrive rule (1 winner, 3 exact). */
export interface AudAccuracy { played: number; right: number; exact: number; points: number; marks: ('y' | 'n')[] }

/** GET /internal/summary (broadcast server only). */
export interface AudSummary {
  at: number;
  session: string;
  matches: AudMatchTotals[];
  champion: { total: number; byTeam: Record<string, number>; locked: boolean };
  polls: AudPoll[];
  accuracy: AudAccuracy;
  leaderboard: { name: string; points: number; right: number; exact: number; played: number }[];
  viewers: number;
}

/** What every broadcast client gets (outputs included): frozen data only, no live counts. */
export interface AudPublic {
  /** Vote service reachable (false = voting offline, last confirmed data kept). */
  online: boolean;
  /** When the data below was last confirmed by the vote service. */
  at: number;
  error: string | null;
  /** Public address of the voting page (for QR codes). */
  url: string;
  /** Locked or final matches: their community split. */
  matches: AudMatchTotals[];
  champion: { total: number; byTeam: Record<string, number>; locked: boolean } | null;
  /** Polls without live counts; frozen result once closed. */
  polls: AudPoll[];
  accuracy: AudAccuracy | null;
  leaderboard: AudSummary['leaderboard'];
}
export const emptyAudPublic = (url = ''): AudPublic => ({ online: false, at: 0, error: null, url, matches: [], champion: null, polls: [], accuracy: null, leaderboard: [] });

/** Producer → broadcast server. */
export type AudOp =
  | { k: 'lock-match'; match: string; locked: boolean }
  | { k: 'lock-champion'; locked: boolean }
  | { k: 'mvp-prepare'; match: string; players: string[] }
  | { k: 'mvp-open'; poll: string }
  | { k: 'mvp-close'; poll: string }
  | { k: 'staff-mvp'; match: string; slot: number; player: string | null; reason?: string }
  | { k: 'qr-set'; qr: QrLink[] };

/** The desk's own MVP per match (broadcast server state). slot = talent position 1–5. */
export type StaffMvp = Record<string, Record<string, { player: string; reason: string }>>;

// ------------------------------------------------------------------ QR manager

export interface QrLink { id: string; label: string; url: string; /** ms epoch, 0 = never */ expires: number }
/** Hosts a QR code may point to (the vote service + hosts the producer approved in Studio). */
export function qrUrlOk(url: string, hosts: string[]): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'Not a valid address'; }
  if (u.protocol !== 'https:') return 'Only https:// addresses';
  if (u.username || u.password) return 'No passwords in the address';
  const h = u.hostname.toLowerCase();
  if (!hosts.some(x => h === x || h.endsWith('.' + x))) return `${h} is not an approved host`;
  if (url.length > 300) return 'Address too long for a scannable code';
  return null;
}

// ------------------------------------------------------------------ verified data

/** Eligible players of a team: the verified Major profiles (Liquipedia), never typed in. */
export const teamRoster = (team: string): AudPlayer[] => MAJOR_PROFILES.filter(p => p.team === team).map(p => ({ handle: p.handle, team }));
export const isMajorTeam = (t: string) => MAJOR_TEAMS.some(x => x.name === t);
export const playerKey = (handle: string) => normHandle(handle);

/** Community majority pick of one match ("BIG 3-1" → team BIG, score 3-1). */
export function communityPick(t: Pick<AudMatchTotals, 'byTeam' | 'byScore'>): { team: string; score: string } | null {
  const teams = Object.entries(t.byTeam).sort((x, y) => y[1] - x[1]);
  if (!teams.length || (teams[1] && teams[1][1] === teams[0][1])) return null;
  const team = teams[0][0];
  const sc = Object.entries(t.byScore).filter(([k]) => k.startsWith(team + ' ')).sort((x, y) => y[1] - x[1])[0];
  return { team, score: sc ? sc[0].slice(team.length + 1) : '' };
}
/** Overdrive rule: 1 point for the winner, 3 for the exact score. */
export const pickScore = (pick: { team: string; score: string }, winner: string, score: string) => (pick.team !== winner ? 0 : pick.score && pick.score === score ? 3 : 1);

export const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
/** Percentages that add up to 100 (largest remainder). */
export function pcts(counts: number[]): number[] {
  const t = counts.reduce((a, b) => a + b, 0);
  if (!t) return counts.map(() => 0);
  const raw = counts.map(c => (c / t) * 100), fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - fl[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
  return fl;
}

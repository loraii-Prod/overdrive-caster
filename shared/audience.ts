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
export interface AudPlayer { handle: string; team: string; /** Portrait for the public voting page (absolute https URL), when one was uploaded. */ photo?: string }
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
  /** Voting closes automatically at this time (ms epoch; votes after it are refused). null = closed by hand. */
  closesAt?: number | null;
  /** Ways this vote accepts votes (missing = website only, the 1.x behaviour). */
  web?: boolean;
  chat?: boolean;
  /** Chat command and channel shown to viewers ("!vote", "overdrive_tm"). */
  chatCmd?: string;
  chatChannel?: string;
  /** PRIVATE: how many of the votes came from chat / the website. */
  bySource?: { web: number; chat: number };
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
  /** Twitch chat voting: sign-in, channel, command, voting methods (server answers like any other command). */
  | { k: 'chat'; op: import('./twitchChat').ChatOp }
  | { k: 'mvp-open'; poll: string; /** Countdown: voting closes by itself after this many seconds (optional). */ seconds?: number }
  | { k: 'mvp-close'; poll: string }
  /** Change or clear the countdown of an open vote. */
  | { k: 'mvp-timer'; poll: string; seconds: number | null }
  /** Live totals on air while voting is open (off by default: totals are private until the reveal). */
  | { k: 'mvp-totals'; poll: string; on: boolean }
  /** Reveal card extras for one player of one match: up to 4 stats and 3 achievements. */
  | { k: 'mvp-card'; match: string; player: string; card: MvpCard | null }
  /** Archive a match's MVP session (results kept, the module moves on to the next match). */
  | { k: 'mvp-archive'; match: string; on: boolean }
  /** Public voting page address used for the QR codes (Studio). '' = the VOTE_PUBLIC_URL setting. */
  | { k: 'vote-url'; url: string }
  | { k: 'staff-mvp'; match: string; slot: number; player: string | null; reason?: string }
  | { k: 'qr-set'; qr: QrLink[] };

export interface MvpCard { stats: { label: string; value: string }[]; achievements: string[] }
/** match → player handle → reveal extras. */
export type MvpCards = Record<string, Record<string, MvpCard>>;
export const MVP_STATS = 4, MVP_ACHIEVEMENTS = 3;
export function sanitizeMvpCard(v: any): MvpCard | null {
  if (!v || typeof v !== 'object') return null;
  const t = (x: unknown, n: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const stats = (Array.isArray(v.stats) ? v.stats : []).map((x: any) => ({ label: t(x?.label, 24), value: t(x?.value, 16) })).filter((x: any) => x.label && x.value).slice(0, MVP_STATS);
  const achievements = (Array.isArray(v.achievements) ? v.achievements : []).map((x: unknown) => t(x, 60)).filter(Boolean).slice(0, MVP_ACHIEVEMENTS);
  return stats.length || achievements.length ? { stats, achievements } : null;
}
/** Live totals the producer chose to show on air (only while that vote is open). */
export type AudLiveTotals = Record<string, { total: number; counts: Record<string, number> }>;
/** A public voting address the Studio may set: https, no credentials, short enough for a scannable code. */
export function voteUrlOk(url: string): string | null {
  if (url === '') return null;
  let u: URL;
  try { u = new URL(url); } catch { return 'Not a valid address'; }
  if (u.protocol !== 'https:') return 'Only https:// addresses';
  if (u.username || u.password) return 'No passwords in the address';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return 'Use a public host name';
  if (url.length > 120) return 'Address too long for a scannable code';
  return null;
}

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

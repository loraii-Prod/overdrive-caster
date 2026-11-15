/**
 * Staff pick'em (internal): every caster / staff member picks the winner and the series score of each Major match
 * on their own phone or PC, from one private link. Points: 1 for the right winner, 3 for the right winner and the
 * exact score (same scoring as the desk pick'em). Picks lock when the match starts; until then each person sees
 * only their own picks (and who has picked), after it everyone's.
 */
import { GRAND_FINAL, PICK_SCORES, WC_IDS, matchName, matchStart, pickPoints, wcResolve, type WcPick, type WildcardState } from './wildcard';

/** Staff list (sheet "staff" + Max and Babz). Editable in Studio. */
export const DEFAULT_STAFF = ['Boney', 'GGeek', 'Legion2k', 'NuaLaoch', 'Padster', 'The_Toble', 'Turbo', 'Orion', 'Max', 'Babz'];

export interface StaffPicks {
  roster: string[];
  /** match id → staff name → pick */
  picks: Record<string, Record<string, WcPick>>;
  /** Producer override per match: true = locked, false = open even past its start time (a result always locks). */
  locks: Record<string, boolean>;
  /** Secret of the staff link (/staff-picks?key=…). */
  key: string;
}
export const emptyStaffPicks = (key: string): StaffPicks => ({ roster: [...DEFAULT_STAFF], picks: {}, locks: {}, key });

export const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function sanitizeStaffPicks(v: any, key: string): StaffPicks {
  if (!v || typeof v !== 'object') return emptyStaffPicks(key);
  const roster: string[] = [];
  for (const n of Array.isArray(v.roster) ? v.roster : DEFAULT_STAFF) { const c = cleanName(n); if (c && !roster.some(r => sameName(r, c)) && roster.length < 60) roster.push(c); }
  const picks: StaffPicks['picks'] = {};
  for (const [id, byName] of Object.entries(v.picks ?? {})) {
    if (!WC_IDS.includes(id) || !byName || typeof byName !== 'object') continue;
    const out: Record<string, WcPick> = {};
    for (const [n, p] of Object.entries(byName as Record<string, any>)) {
      const c = cleanName(n);
      if (c && p && typeof p.team === 'string' && p.team) out[c] = { team: String(p.team).slice(0, 60), score: PICK_SCORES.includes(p.score) ? p.score : '' };
    }
    if (Object.keys(out).length) picks[id] = out;
  }
  const locks: StaffPicks['locks'] = {};
  for (const [id, on] of Object.entries(v.locks ?? {})) if (WC_IDS.includes(id) && typeof on === 'boolean') locks[id] = on;
  return { roster, picks, locks, key: typeof v.key === 'string' && v.key.length >= 12 ? v.key.slice(0, 64) : key };
}

/** Has the match started (or ended)? A result or a score locks it; so does its start time, unless the producer opened it. */
export function staffLocked(sp: StaffPicks, wc: WildcardState, id: string, now = Date.now()): boolean {
  const R = wcResolve(wc.matches, wc.teams)[id], m = wc.matches[id];
  if (!R || !m) return true;
  if (R.winner) return true;
  if (sp.locks[id] === true) return true;
  if (sp.locks[id] === false) return false;
  if (m.live || (m.s1 !== '' && m.s1 !== '0') || (m.s2 !== '' && m.s2 !== '0')) return true;
  const t = matchStart(m);
  return t != null && t <= now;
}

export interface StaffMatch {
  id: string; label: string; t1: string | null; t2: string | null; start: number | null;
  /** Both teams known (and no BYE): picks can be made. */
  ready: boolean; locked: boolean;
  result: { winner: string; score: string } | null;
  /** Names that have picked (always shown). */
  pickedBy: string[];
  /** Everyone's picks: only once locked (no copying before the start). */
  picks: Record<string, WcPick & { points: number | null }> | null;
}
export interface StaffRow { name: string; points: number; right: number; exact: number; played: number }

export function staffTable(sp: StaffPicks, wc: WildcardState): StaffRow[] {
  const R = wcResolve(wc.matches, wc.teams);
  const rows = new Map<string, StaffRow>(sp.roster.map(n => [n.toLowerCase(), { name: n, points: 0, right: 0, exact: 0, played: 0 }]));
  for (const [id, byName] of Object.entries(sp.picks)) {
    if (!R[id]?.winner || R[id].winner === 'BYE') continue;
    for (const [n, p] of Object.entries(byName)) {
      const row = rows.get(n.toLowerCase()) ?? { name: n, points: 0, right: 0, exact: 0, played: 0 };
      rows.set(n.toLowerCase(), row);
      const pts = pickPoints(p, wc.matches[id], R[id]);
      row.played++; row.points += pts; if (pts) row.right++; if (pts === 3) row.exact++;
    }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
}

/** What the staff page shows. `me` = the name chosen on that device: their own open picks are included. */
export function staffBoard(sp: StaffPicks, wc: WildcardState, me: string | null, now = Date.now()) {
  const R = wcResolve(wc.matches, wc.teams);
  const matches: StaffMatch[] = WC_IDS.map(id => {
    const r = R[id], m = wc.matches[id], locked = staffLocked(sp, wc, id, now), by = sp.picks[id] ?? {};
    const a = Number(m.s1), b = Number(m.s2);
    const result = r.winner && r.winner !== 'BYE' ? { winner: r.winner, score: Number.isFinite(a) && Number.isFinite(b) && m.s1 !== '' ? `${Math.max(a, b)}-${Math.min(a, b)}` : '' } : null;
    return {
      id, label: id === GRAND_FINAL ? 'Grand final' : matchName(id), t1: r.t1 || null, t2: r.t2 || null, start: matchStart(m),
      ready: !!r.t1 && !!r.t2 && r.t1 !== 'BYE' && r.t2 !== 'BYE', locked, result, pickedBy: Object.keys(by),
      picks: locked ? Object.fromEntries(Object.entries(by).map(([n, p]) => [n, { ...p, points: result ? pickPoints(p, m, r) : null }])) : null,
    };
  });
  const mine: Record<string, WcPick> = {};
  if (me) for (const [id, by] of Object.entries(sp.picks)) { const k = Object.keys(by).find(n => sameName(n, me)); if (k) mine[id] = by[k]; }
  return { roster: sp.roster, matches, mine, table: staffTable(sp, wc), scoring: '1 point for the right winner, 3 for the right winner and the exact score' };
}
export type StaffBoard = ReturnType<typeof staffBoard>;

/** A staff member's pick (from the staff page). Returns an error, or null when saved. */
export function staffPick(sp: StaffPicks, wc: WildcardState, name: string, id: string, pick: { team: string; score: string } | null, now = Date.now()): string | null {
  const who = sp.roster.find(n => sameName(n, cleanName(name)));
  if (!who) return 'Pick your name from the staff list';
  if (!WC_IDS.includes(id)) return 'Unknown match';
  const r = wcResolve(wc.matches, wc.teams)[id];
  if (!r.t1 || !r.t2 || r.t1 === 'BYE' || r.t2 === 'BYE') return 'The teams of this match are not known yet';
  if (staffLocked(sp, wc, id, now)) return 'This match has started: picks are locked';
  const by = { ...(sp.picks[id] ?? {}) };
  for (const k of Object.keys(by)) if (sameName(k, who)) delete by[k];
  if (pick) {
    if (pick.team !== r.t1 && pick.team !== r.t2) return 'Pick one of the two teams';
    if (!PICK_SCORES.includes(pick.score)) return 'Pick the series score (3-0, 3-1 or 3-2)';
    by[who] = { team: pick.team, score: pick.score };
  }
  sp.picks = { ...sp.picks, [id]: by };
  return null;
}

/** Producer actions (Studio). */
export type StaffOp =
  | { k: 'roster'; names: string[] }
  | { k: 'lock'; match: string; state: 'auto' | 'locked' | 'open' }
  | { k: 'remove'; match: string; name: string }
  | { k: 'reset' }
  | { k: 'new-key' };

export function staffOp(sp: StaffPicks, op: StaffOp, newKey: () => string): string | null {
  switch (op?.k) {
    case 'roster': {
      if (!Array.isArray(op.names)) return 'Invalid staff list';
      const roster: string[] = [];
      for (const n of op.names) { const c = cleanName(n); if (c && !roster.some(r => sameName(r, c))) roster.push(c); }
      if (!roster.length) return 'The staff list cannot be empty';
      sp.roster = roster.slice(0, 60);
      return null; // picks of a removed name are kept (put the name back to see them again)
    }
    case 'lock': {
      if (!WC_IDS.includes(op.match)) return 'Unknown match';
      const locks = { ...sp.locks };
      if (op.state === 'auto') delete locks[op.match]; else locks[op.match] = op.state === 'locked';
      sp.locks = locks; return null;
    }
    case 'remove': {
      const by = { ...(sp.picks[op.match] ?? {}) };
      for (const k of Object.keys(by)) if (sameName(k, op.name)) delete by[k];
      sp.picks = { ...sp.picks, [op.match]: by }; return null;
    }
    case 'reset': sp.picks = {}; sp.locks = {}; return null;
    case 'new-key': sp.key = newKey(); return null;
    default: return 'Unknown staff pick\'em action';
  }
}

// Tournament model + bracket engine (single / double elimination).
// Results are derived: who plays where is always recomputed from scores,
// so fixing a result instantly re-flows the whole bracket.

export type Side = 'UB' | 'LB' | 'GF';
export type SlotRef = { k: 'seed'; seed: number } | { k: 'win'; m: string } | { k: 'lose'; m: string };
export type MatchStatus = 'upcoming' | 'live' | 'done';
export type Format = 'single' | 'double';

export interface TTeam { id: string; name: string; tag: string; logo: string }

export interface BMatch {
  id: string;
  side: Side;
  round: number;
  index: number;
  label: string;
  a: SlotRef;
  b: SlotRef;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  status: MatchStatus;
  /** Free text, e.g. "18:30" or "SAT 14:00". */
  time: string;
  /** Where it's played/streamed, e.g. "Main stream". */
  stream: string;
  doneAt: number | null;
}

export interface Tournament {
  name: string;
  format: Format;
  size: number;
  gfReset: boolean;
  teams: TTeam[];
  matches: BMatch[];
  /** Match the broadcast is covering: drives scoreboard + team names. */
  featured: string | null;
  updatedAt: number;
}

export const BYE = 'BYE' as const;
export type Slot = TTeam | typeof BYE | null; // null = TBD

export interface Resolved {
  a: Slot;
  b: Slot;
  /** Winning side once decided (byes decide automatically). */
  winner: 'A' | 'B' | null;
  /** Decided by a bye: never shown as a played match. */
  auto: boolean;
  /** GF reset that turned out unnecessary. */
  skipped: boolean;
}

export const MAX_TEAMS = 16;
export const SIZES = [2, 4, 8, 16];

/** Standard seeding order: 1v16, 8v9, 5v12, 4v13 … so top seeds meet last. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap(s => [s, n + 1 - s]);
  }
  return order;
}

const mk = (id: string, side: Side, round: number, index: number, label: string, a: SlotRef, b: SlotRef, bestOf: number): BMatch =>
  ({ id, side, round, index, label, a, b, scoreA: 0, scoreB: 0, bestOf, status: 'upcoming', time: '', stream: '', doneAt: null });

function ubLabel(r: number, R: number, format: Format) {
  const fromEnd = R - r;
  if (format === 'single') return fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'Semifinals' : fromEnd === 2 ? 'Quarterfinals' : `Round of ${2 ** (fromEnd + 1)}`;
  return fromEnd === 0 ? 'Upper Final' : fromEnd === 1 ? 'Upper Semifinals' : fromEnd === 2 ? 'Upper Quarterfinals' : `Upper Round ${r}`;
}

export function generate(format: Format, size: number, bestOf = 3, finalBestOf = 5, gfReset = true): BMatch[] {
  const R = Math.log2(size);
  if (format === 'double' && size < 4) format = 'single';
  const out: BMatch[] = [];
  const order = seedOrder(size);
  // Upper bracket (= the whole bracket in single elimination)
  for (let r = 1; r <= R; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      const a: SlotRef = r === 1 ? { k: 'seed', seed: order[2 * i] } : { k: 'win', m: `UB-${r - 1}-${2 * i}` };
      const b: SlotRef = r === 1 ? { k: 'seed', seed: order[2 * i + 1] } : { k: 'win', m: `UB-${r - 1}-${2 * i + 1}` };
      out.push(mk(`UB-${r}-${i}`, 'UB', r, i, ubLabel(r, R, format), a, b, r === R && format === 'single' ? finalBestOf : bestOf));
    }
  }
  if (format === 'single') return out;

  // Lower bracket: 2(R-1) rounds, alternating "drop-in" and consolidation rounds.
  const lbRounds = 2 * (R - 1);
  const lbLabel = (k: number) => (k === lbRounds ? 'Lower Final' : k === lbRounds - 1 ? 'Lower Semifinal' : `Lower Round ${k}`);
  let k = 1;
  for (let i = 0; i < size / 4; i++) out.push(mk(`LB-1-${i}`, 'LB', 1, i, lbLabel(1), { k: 'lose', m: `UB-1-${2 * i}` }, { k: 'lose', m: `UB-1-${2 * i + 1}` }, bestOf));
  for (let j = 2; j <= R; j++) {
    const count = size / 2 ** j;
    const prev = k;
    k++;
    for (let i = 0; i < count; i++) {
      // Losers dropping from the upper bracket are crossed over on alternate rounds to avoid early rematches.
      const ui = j % 2 === 0 ? count - 1 - i : i;
      out.push(mk(`LB-${k}-${i}`, 'LB', k, i, lbLabel(k), { k: 'win', m: `LB-${prev}-${i}` }, { k: 'lose', m: `UB-${j}-${ui}` }, bestOf));
    }
    if (j < R) {
      const prev2 = k;
      k++;
      for (let i = 0; i < count / 2; i++) out.push(mk(`LB-${k}-${i}`, 'LB', k, i, lbLabel(k), { k: 'win', m: `LB-${prev2}-${2 * i}` }, { k: 'win', m: `LB-${prev2}-${2 * i + 1}` }, bestOf));
    }
  }
  out.push(mk('GF-1', 'GF', 1, 0, 'Grand Final', { k: 'win', m: `UB-${R}-0` }, { k: 'win', m: `LB-${lbRounds}-0` }, finalBestOf));
  if (gfReset) out.push(mk('GF-2', 'GF', 2, 0, 'Grand Final Reset', { k: 'win', m: 'GF-1' }, { k: 'lose', m: 'GF-1' }, finalBestOf));
  return out;
}

export function resolve(t: Tournament): Map<string, Resolved> {
  const byId = new Map(t.matches.map(m => [m.id, m]));
  const memo = new Map<string, Resolved>();

  const slot = (ref: SlotRef): Slot => {
    if (ref.k === 'seed') return t.teams[ref.seed - 1] ?? BYE;
    const r = get(ref.m);
    if (!r || !r.winner || r.skipped) return r?.skipped ? BYE : null;
    const win = r.winner === 'A' ? r.a : r.b;
    const lose = r.winner === 'A' ? r.b : r.a;
    return ref.k === 'win' ? win : lose;
  };

  function get(id: string): Resolved | undefined {
    if (memo.has(id)) return memo.get(id);
    const m = byId.get(id);
    if (!m) return undefined;
    const a = slot(m.a), b = slot(m.b);
    let winner: 'A' | 'B' | null = null, auto = false, skipped = false;
    if (a === BYE && b === BYE) { winner = 'A'; auto = true; }
    else if (a === BYE && b) { winner = 'B'; auto = true; }
    else if (b === BYE && a) { winner = 'A'; auto = true; }
    else if (m.status === 'done' && a && b && m.scoreA !== m.scoreB) winner = m.scoreA > m.scoreB ? 'A' : 'B';
    if (m.id === 'GF-2') {
      // Only played if the lower-bracket team won the first grand final.
      const gf1 = get('GF-1');
      if (gf1?.winner === 'A') { skipped = true; winner = 'A'; }
    }
    const r: Resolved = { a, b, winner, auto, skipped };
    memo.set(id, r);
    return r;
  }

  for (const m of t.matches) get(m.id);
  return memo;
}

export function champion(t: Tournament, res = resolve(t)): TTeam | null {
  const finalId = t.format === 'double' ? (t.matches.some(m => m.id === 'GF-2') ? 'GF-2' : 'GF-1') : `UB-${Math.log2(t.size)}-0`;
  let r = res.get(finalId);
  if (finalId === 'GF-2' && r?.skipped) r = res.get('GF-1');
  if (!r?.winner) return null;
  const w = r.winner === 'A' ? r.a : r.b;
  return w && w !== BYE ? w : null;
}

export const isTeam = (s: Slot): s is TTeam => !!s && s !== BYE;

/** Matches still to be played, in bracket order (time first when given). */
export function upcoming(t: Tournament, res = resolve(t), limit = 6) {
  return t.matches
    .map((m, order) => ({ m, r: res.get(m.id)!, order }))
    .filter(x => x.m.status !== 'done' && !x.r.auto && !x.r.skipped && x.r.a !== BYE && x.r.b !== BYE && (isTeam(x.r.a) || isTeam(x.r.b)))
    .sort((x, y) => (x.m.status === 'live' ? -1 : 0) - (y.m.status === 'live' ? -1 : 0) || timeKey(x.m.time) - timeKey(y.m.time) || x.order - y.order)
    .slice(0, limit);
}

export function results(t: Tournament, res = resolve(t), limit = 6) {
  return t.matches
    .map(m => ({ m, r: res.get(m.id)! }))
    .filter(x => x.m.status === 'done' && x.r.winner && !x.r.auto && !x.r.skipped)
    .sort((x, y) => (y.m.doneAt ?? 0) - (x.m.doneAt ?? 0))
    .slice(0, limit);
}

function timeKey(s: string) {
  const m = /(\d{1,2})[:h.](\d{2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 1e9;
}

// ---------- defaults & validation ----------

export function defaultTournament(): Tournament {
  const names = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Team Echo', 'Team Foxtrot', 'Team Golf', 'Team Hotel'];
  const teams = names.map((n, i) => ({ id: `t${i + 1}`, name: n, tag: n.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase(), logo: '' }));
  return { name: 'OVERDRIVE LEAGUE', format: 'double', size: 8, gfReset: true, teams, matches: generate('double', 8), featured: null, updatedAt: Date.now() };
}

export const nextSize = (n: number) => SIZES.find(s => s >= n) ?? MAX_TEAMS;

const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

export function sanitizeTeams(v: unknown): TTeam[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.slice(0, MAX_TEAMS).map((x: any, i) => {
    let id = str(x?.id, 40) || `t${Date.now().toString(36)}${i}`;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    const logo = str(x?.logo, 2000);
    return { id, name: str(x?.name, 40, `Team ${i + 1}`), tag: str(x?.tag, 6).toUpperCase(), logo: /^(https?:\/\/|\/)/.test(logo) ? logo : '' };
  });
}

export function sanitizeTournament(v: any): Tournament {
  const d = defaultTournament();
  if (!v || typeof v !== 'object') return d;
  const format: Format = v.format === 'single' ? 'single' : 'double';
  const size = SIZES.includes(v.size) ? v.size : d.size;
  const shape = generate(format, size, 3, 5, v.gfReset !== false);
  const saved = new Map<string, any>((Array.isArray(v.matches) ? v.matches : []).map((m: any) => [String(m?.id), m]));
  // Structure always comes from the generator; only results/times are taken from storage.
  const matches = shape.map(m => {
    const s = saved.get(m.id);
    return s ? patchMatch(m, s) : m;
  });
  return {
    name: str(v.name, 60, d.name),
    format, size,
    gfReset: v.gfReset !== false,
    teams: sanitizeTeams(v.teams),
    matches,
    featured: typeof v.featured === 'string' && matches.some(m => m.id === v.featured) ? v.featured : null,
    updatedAt: Number(v.updatedAt) || Date.now(),
  };
}

export function patchMatch(m: BMatch, p: any): BMatch {
  const status: MatchStatus = ['upcoming', 'live', 'done'].includes(p?.status) ? p.status : m.status;
  return {
    ...m,
    scoreA: int(p?.scoreA, 0, 99, m.scoreA),
    scoreB: int(p?.scoreB, 0, 99, m.scoreB),
    bestOf: int(p?.bestOf, 1, 9, m.bestOf),
    status,
    time: p?.time !== undefined ? str(p.time, 24) : m.time,
    stream: p?.stream !== undefined ? str(p.stream, 40) : m.stream,
    doneAt: status === 'done' ? (m.status === 'done' ? (typeof p?.doneAt === 'number' ? p.doneAt : m.doneAt) ?? Date.now() : Date.now()) : null,
  };
}

/** Admin operations (WebSocket + HTTP API). */
export type TournamentOp =
  | { k: 'meta'; name?: string }
  | { k: 'teams'; teams: TTeam[] }
  | { k: 'generate'; format: Format; size?: number; gfReset?: boolean; bestOf?: number; finalBestOf?: number }
  | { k: 'match'; id: string; patch: Partial<Pick<BMatch, 'scoreA' | 'scoreB' | 'bestOf' | 'status' | 'time' | 'stream'>> }
  | { k: 'feature'; id: string | null }
  | { k: 'reset-results' };

export function applyOp(t: Tournament, op: TournamentOp): Tournament {
  const next: Tournament = { ...t, updatedAt: Date.now() };
  switch (op.k) {
    case 'meta':
      next.name = str(op.name, 60, t.name);
      break;
    case 'teams':
      next.teams = sanitizeTeams(op.teams);
      break;
    case 'generate': {
      const format: Format = op.format === 'single' ? 'single' : 'double';
      const size = SIZES.includes(op.size as number) ? op.size! : nextSize(Math.max(2, t.teams.length));
      next.format = format;
      next.size = Math.max(size, format === 'double' ? 4 : 2);
      next.gfReset = op.gfReset !== false;
      next.matches = generate(format, next.size, int(op.bestOf, 1, 9, 3), int(op.finalBestOf, 1, 9, 5), next.gfReset);
      next.featured = null;
      break;
    }
    case 'match':
      next.matches = t.matches.map(m => (m.id === op.id ? patchMatch(m, op.patch ?? {}) : m));
      break;
    case 'feature':
      next.featured = op.id && t.matches.some(m => m.id === op.id) ? op.id : null;
      break;
    case 'reset-results':
      next.matches = t.matches.map(m => ({ ...m, scoreA: 0, scoreB: 0, status: 'upcoming', doneAt: null }));
      break;
  }
  return next;
}

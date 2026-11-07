// Benelux Pro League competition rules (rulebook S1): Reverse Cup scoring,
// league-phase standings and the 4-player playoff bracket.

import { matchPlayer, type Player } from './players';

// ---------------------------------------------------------------- Reverse Cup

/** Points LOST per finishing position, by number of players still in (rulebook "Points Repartition"). */
export const RC_REPARTITION: Record<number, number[]> = { 4: [0, 4, 7, 10], 3: [2, 6, 10], 2: [4, 8], 1: [0] };
export const RC_DNF = 12;
export const RC_ROUNDS_PER_MAP = 4;
export const DEFAULT_MAPS = ['Map A', 'Map B', 'Map C', 'Map D', 'Map E'];

export interface RcPlayer {
  id: string; // player db id ('' = empty slot)
  name: string;
  points: number;
  /** Final place in this match once decided (1-4), else null. */
  place: number | null;
  /** Points lost in the last round (for the "-7" animation). */
  delta: number | null;
  /** Points before the last round (tiebreak: "more points in the previous round"). */
  prev: number;
}

export interface ReverseCup {
  /** Use the 4-player Reverse Cup scoreboard instead of the team scoreboard. */
  enabled: boolean;
  title: string;
  start: number;
  /** Play until this many players remain (league 1, playoffs 2, grand final 1). */
  winners: number;
  maps: string[];
  mapIndex: number;
  round: number;
  players: RcPlayer[];
  finished: boolean;
  roundAt: number;
  /** Where the result gets saved. */
  source: { kind: 'league'; div: 'd1' | 'd2'; match: number } | { kind: 'playoff'; id: string } | null;
  history: { players: RcPlayer[]; mapIndex: number; round: number; finished: boolean }[];
}

export const emptyRcPlayer = (): RcPlayer => ({ id: '', name: '', points: 100, place: null, delta: null, prev: 100 });

export function defaultRc(): ReverseCup {
  return {
    // Off by default: Overdrive is a 2v2 team league (best-of match scoreboard),
    // not the 4-player individual point-ladder this Reverse Cup mode is for.
    enabled: false, title: 'DIVISION 1 · MATCH 1', start: 100, winners: 1, maps: [...DEFAULT_MAPS], mapIndex: 0, round: 1,
    players: [0, 1, 2, 3].map(() => emptyRcPlayer()), finished: false, roundAt: 0, source: null, history: [],
  };
}

const alive = (p: RcPlayer) => !!p.id && p.place === null;

/** Rank players for final placement: more points first, then more points in the previous round. */
const better = (a: RcPlayer, b: RcPlayer) => b.points - a.points || b.prev - a.prev;

/**
 * Apply one round. `finish` = ids of still-alive players in finishing order;
 * any alive player not listed (or listed in `dnf`) is a DNF and loses 12.
 */
export function applyRound(rc: ReverseCup, finish: string[], dnf: string[] = []): ReverseCup {
  if (rc.finished) return rc;
  const snapshot = { players: rc.players.map(p => ({ ...p })), mapIndex: rc.mapIndex, round: rc.round, finished: rc.finished };
  const inPlay = rc.players.filter(alive);
  const rep = RC_REPARTITION[inPlay.length] ?? [];
  const order = finish.filter(id => inPlay.some(p => p.id === id) && !dnf.includes(id));
  const players = rc.players.map(p => {
    if (!alive(p)) return { ...p, delta: null };
    const i = order.indexOf(p.id);
    const lost = i >= 0 ? rep[i] ?? rep[rep.length - 1] ?? 0 : RC_DNF;
    return { ...p, prev: p.points, points: p.points - lost, delta: lost };
  });

  // Eliminations: anyone at 0 or below. Places fill from the bottom.
  let remaining = players.filter(alive);
  const out = remaining.filter(p => p.points <= 0).sort(better);
  let survivors = remaining.filter(p => p.points > 0);
  let finished = false;
  if (survivors.length <= rc.winners) {
    // Match decided: everyone left (survivors + just eliminated) is ranked by points.
    const ranked = [...survivors, ...out].sort(better);
    ranked.forEach((p, i) => { p.place = i + 1; });
    finished = true;
  } else {
    let place = survivors.length + out.length;
    for (const p of [...out].reverse()) p.place = place--;
  }
  remaining = players.filter(alive);
  survivors = remaining;

  let { mapIndex, round } = rc;
  if (!finished) {
    round++;
    if (round > RC_ROUNDS_PER_MAP) { round = 1; mapIndex++; }
    if (mapIndex >= rc.maps.length) {
      // Out of maps: rank whoever is left by points.
      [...survivors].sort(better).forEach((p, i) => { p.place = i + 1; });
      finished = true;
      mapIndex = rc.maps.length - 1;
    }
  }
  return { ...rc, players, mapIndex, round, finished, roundAt: Date.now(), history: [...rc.history, snapshot].slice(-60) };
}

export function undoRound(rc: ReverseCup): ReverseCup {
  const last = rc.history[rc.history.length - 1];
  if (!last) return rc;
  return { ...rc, ...last, roundAt: Date.now(), history: rc.history.slice(0, -1) };
}

export function resetRc(rc: ReverseCup, start = rc.start): ReverseCup {
  return { ...rc, start, mapIndex: 0, round: 1, finished: false, history: [], roundAt: Date.now(),
    players: rc.players.map(p => ({ ...p, points: start, prev: start, place: null, delta: null })) };
}

/** Final order of a finished match (ids, 1st → last). */
export const rcOrder = (rc: ReverseCup) => rc.players.filter(p => p.id && p.place).sort((a, b) => a.place! - b.place!).map(p => p.id);

// --------------------------------------------------------------------- League

export interface LeagueRow {
  player: string; // player db id
  /** Points per league match (4/3/2/1/0), null = not played yet. */
  results: (number | null)[];
  /** Manual tiebreak rank (head-to-head), lower first; 0 = none. */
  tb: number;
}

export interface Division { id: 'd1' | 'd2'; name: string; rows: LeagueRow[]; /** Top N qualify for playoffs. */ qualify: number }

export interface League { name: string; matches: number; divisions: Division[] }

export const LEAGUE_POINTS = [4, 3, 2, 1]; // 1st..4th, no-show 0

export interface StandingRow { pos: number; player: string; name: string; total: number; played: number; results: (number | null)[]; seed: number }

export function standings(div: Division, players: Player[]): StandingRow[] {
  const byId = new Map(players.map(p => [p.id, p]));
  return div.rows
    .map((r, seed) => ({ r, seed, total: r.results.reduce<number>((a, b) => a + (b ?? 0), 0), played: r.results.filter(x => x != null).length }))
    .sort((a, b) => b.total - a.total || (a.r.tb || 999) - (b.r.tb || 999) || a.seed - b.seed)
    .map((x, i) => ({ pos: i + 1, player: x.r.player, name: byId.get(x.r.player)?.name ?? x.r.player, total: x.total, played: x.played, results: x.r.results, seed: x.seed + 1 }));
}

// ------------------------------------------------------------------- Playoffs

export type PRef = { k: 'seed'; n: number } | { k: 'place'; m: string; p: number };
export interface PlayoffDef { id: string; div: 'd1' | 'd2'; label: string; short: string; refs: PRef[]; start: number; winners: number; side: 'upper' | 'lower' | 'final' | 'promo' }

const S = (n: number): PRef => ({ k: 'seed', n });
const P = (m: string, p: number): PRef => ({ k: 'place', m, p });

/** Division 1: double elimination, no reset. Top 2 of each 4-player match go up, bottom 2 go down / out. */
export const PLAYOFF_DEFS: PlayoffDef[] = [
  { id: 'USF-A', div: 'd1', label: 'Upper Semi-final A', short: 'USF A', refs: [S(1), S(4), S(5), S(8)], start: 120, winners: 2, side: 'upper' },
  { id: 'USF-B', div: 'd1', label: 'Upper Semi-final B', short: 'USF B', refs: [S(2), S(3), S(6), S(7)], start: 120, winners: 2, side: 'upper' },
  { id: 'UF', div: 'd1', label: 'Upper Final', short: 'UF', refs: [P('USF-A', 1), P('USF-A', 2), P('USF-B', 1), P('USF-B', 2)], start: 120, winners: 2, side: 'upper' },
  { id: 'LSF', div: 'd1', label: 'Lower Semi-final', short: 'LSF', refs: [P('USF-A', 3), P('USF-A', 4), P('USF-B', 3), P('USF-B', 4)], start: 120, winners: 2, side: 'lower' },
  { id: 'LF', div: 'd1', label: 'Lower Final', short: 'LF', refs: [P('UF', 3), P('UF', 4), P('LSF', 1), P('LSF', 2)], start: 120, winners: 2, side: 'lower' },
  { id: 'GF', div: 'd1', label: 'Grand Final', short: 'GF', refs: [P('UF', 1), P('UF', 2), P('LF', 1), P('LF', 2)], start: 140, winners: 1, side: 'final' },
  { id: 'PROMO', div: 'd2', label: 'Division 2 Promotion', short: 'D2', refs: [S(1), S(2), S(3), S(4)], start: 120, winners: 1, side: 'promo' },
];

export interface PlayoffResult {
  /** Player ids in finishing order (1st → 4th). */
  order: string[];
  /** Points left at the end (negative = eliminated place, like eCircuitMania). */
  points: Record<string, number>;
  status: 'upcoming' | 'live' | 'done';
  time: string;
}

export interface Playoffs { d1Seeds: string[]; d2Seeds: string[]; results: Record<string, PlayoffResult> }

export function playoffPlayers(po: Playoffs, def: PlayoffDef): (string | null)[] {
  return def.refs.map(ref => {
    if (ref.k === 'seed') return (def.div === 'd1' ? po.d1Seeds : po.d2Seeds)[ref.n - 1] || null;
    const r = po.results[ref.m];
    return r && r.status === 'done' ? r.order[ref.p - 1] ?? null : null;
  });
}

/** Final Division 1 placements 1-8 (null until decided). */
export function playoffPlacements(po: Playoffs): (string | null)[] {
  const done = (id: string) => (po.results[id]?.status === 'done' ? po.results[id].order : []);
  const gf = done('GF'), lf = done('LF'), lsf = done('LSF');
  return [gf[0], gf[1], gf[2], gf[3], lf[2], lf[3], lsf[2], lsf[3]].map(x => x ?? null);
}

// -------------------------------------------------------- Season 1 (2026) data
// Source: eCircuitMania, Benelux Pro League S1 (League Phase + Playoffs).

const S1_D1: [string, number[]][] = [
  ['Alex-w', [4, 4, 4, 4, 4]], ['Poepboer', [4, 4, 4, 4, 3]], ['JussyDr', [3, 3, 3, 3, 4]], ['Jan', [4, 2, 3, 3, 4]],
  ['Timmys', [2, 4, 4, 3, 2]], ['DaniiiTM.', [3, 3, 2, 4, 3]], ['Paardenvechter', [3, 2, 4, 2, 3]], ['Mitra-17', [3, 3, 3, 3, 2]],
  ['astronauttm', [2, 4, 2, 4, 1]], ['Tommie', [2, 2, 2, 2, 2]], ['Javas..', [1, 2, 3, 2, 1]], ['Tarpor', [1, 1, 1, 1, 4]],
  ['Snappie', [4, 3, 0, 0, 0]], ['ThijnHD', [2, 1, 2, 1, 1]], ['Javzo', [1, 1, 1, 2, 2]], ['pedrobuddytm', [1, 1, 1, 1, 3]],
];
const S1_D2: [string, number[]][] = [
  ['Pug_TM', [4, 4, 4, 3, 4]], ['Luckyboi61', [4, 4, 4, 4, 3]], ['Nieqtv', [3, 4, 3, 4, 4]], ['Jortim', [3, 4, 3, 4, 3]],
  ['ChiliConArne.', [4, 3, 2, 4, 4]], ['EAtiFY', [4, 3, 2, 3, 2]], ['DazzleAlec', [1, 3, 4, 2, 3]], ['OwlsAreVeryCool', [2, 3, 1, 3, 4]],
  ['Denniss..', [3, 2, 3, 3, 2]], ['FootFungusTM', [1, 1, 4, 2, 2]], ['Delet3..', [3, 2, 2, 2, 1]], ['Steeghos', [2, 2, 1, 1, 2]],
  ['Zeemuis', [2, 1, 2, 2, 1]], ['Gooddutchie', [1, 2, 3, 1, 1]], ['Yoshy-.', [2, 1, 1, 1, 3]], ['CannonTM', [1, 1, 1, 1, 1]],
];
const S1_PLAYOFFS: Record<string, { time: string; res: [string, number][] }> = {
  'USF-A': { time: '14:00', res: [['Alex-w', 61], ['Jan', 15], ['Mitra-17', -3], ['Timmys', -4]] },
  'USF-B': { time: '14:00', res: [['Poepboer', 58], ['JussyDr', 9], ['Paardenvechter', -3], ['DaniiiTM.', -4]] },
  UF: { time: '15:00', res: [['Jan', 19], ['Alex-w', 16], ['Poepboer', -3], ['JussyDr', -4]] },
  LSF: { time: '15:00', res: [['Mitra-17', 23], ['Paardenvechter', 21], ['DaniiiTM.', -3], ['Timmys', -4]] },
  LF: { time: '16:00', res: [['Poepboer', 0], ['JussyDr', 0], ['Paardenvechter', -3], ['Mitra-17', -4]] },
  GF: { time: '18:00', res: [['Alex-w', 2], ['Jan', -2], ['Poepboer', -3], ['JussyDr', -4]] },
  PROMO: { time: '17:00', res: [['Pug_TM', 39], ['Nieqtv', -2], ['Luckyboi61', -3], ['ChiliConArne.', -4]] },
};

/** Season 1 league + playoffs, with names resolved against the player database. */
export function season1(players: Player[]): { league: League; playoffs: Playoffs } {
  const id = (name: string) => matchPlayer(players, name)?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const rows = (list: [string, number[]][]): LeagueRow[] => list.map(([n, r], i) => ({ player: id(n), results: r, tb: i + 1 }));
  const league: League = {
    name: 'SEASON 1', matches: 5,
    divisions: [
      { id: 'd1', name: 'Division 1', rows: rows(S1_D1), qualify: 8 },
      { id: 'd2', name: 'Division 2', rows: rows(S1_D2), qualify: 4 },
    ],
  };
  const results: Record<string, PlayoffResult> = {};
  for (const [m, { time, res }] of Object.entries(S1_PLAYOFFS)) {
    results[m] = { order: res.map(([n]) => id(n)), points: Object.fromEntries(res.map(([n, p]) => [id(n), p])), status: 'done', time };
  }
  return {
    league,
    playoffs: {
      d1Seeds: S1_D1.slice(0, 8).map(([n]) => id(n)),
      d2Seeds: ['Pug_TM', 'Luckyboi61', 'Nieqtv', 'ChiliConArne.'].map(id), // Jortim's spot went to the next eligible player
      results,
    },
  };
}

// ---------------------------------------------------------------- validation

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

export function sanitizeLeague(v: any, fallback: League): League {
  if (!v || typeof v !== 'object' || !Array.isArray(v.divisions)) return fallback;
  const matches = num(v.matches, 1, 20, 5);
  const div = (d: any, base: Division): Division => ({
    id: base.id,
    name: str(d?.name, 40) || base.name,
    qualify: num(d?.qualify, 0, 32, base.qualify),
    rows: (Array.isArray(d?.rows) ? d.rows : []).slice(0, 64).map((r: any) => ({
      player: str(r?.player, 60),
      results: Array.from({ length: matches }, (_, i) => (typeof r?.results?.[i] === 'number' ? num(r.results[i], 0, 4, 0) : null)),
      tb: num(r?.tb, 0, 999, 0),
    })).filter((r: LeagueRow) => r.player),
  });
  return {
    name: str(v.name, 40) || fallback.name, matches,
    divisions: [div(v.divisions.find((d: any) => d?.id === 'd1'), fallback.divisions[0]), div(v.divisions.find((d: any) => d?.id === 'd2'), fallback.divisions[1])],
  };
}

export function sanitizePlayoffs(v: any, fallback: Playoffs): Playoffs {
  if (!v || typeof v !== 'object') return fallback;
  const ids = (a: unknown, n: number) => Array.from({ length: n }, (_, i) => str((a as any)?.[i], 60));
  const results: Record<string, PlayoffResult> = {};
  for (const def of PLAYOFF_DEFS) {
    const r = v.results?.[def.id];
    if (!r) continue;
    results[def.id] = {
      order: (Array.isArray(r.order) ? r.order : []).slice(0, 4).map((x: unknown) => str(x, 60)),
      points: Object.fromEntries(Object.entries(r.points ?? {}).slice(0, 4).map(([k, p]) => [k.slice(0, 60), num(p, -10, 999, 0)])),
      status: ['upcoming', 'live', 'done'].includes(r.status) ? r.status : 'upcoming',
      time: str(r.time, 20),
    };
  }
  return { d1Seeds: ids(v.d1Seeds, 8), d2Seeds: ids(v.d2Seeds, 4), results };
}

export function sanitizeRc(v: any): ReverseCup {
  const d = defaultRc();
  if (!v || typeof v !== 'object') return d;
  const pl = (p: any): RcPlayer => ({
    id: str(p?.id, 60), name: str(p?.name, 60), points: num(p?.points, -999, 999, 100),
    place: typeof p?.place === 'number' ? num(p.place, 1, 4, 1) : null, delta: typeof p?.delta === 'number' ? num(p.delta, 0, 99, 0) : null, prev: num(p?.prev, -999, 999, 100),
  });
  const src = v.source;
  return {
    enabled: v.enabled !== false,
    title: str(v.title, 60) || d.title,
    start: num(v.start, 1, 999, 100),
    winners: num(v.winners, 1, 3, 1),
    maps: Array.isArray(v.maps) && v.maps.length ? v.maps.slice(0, 10).map((m: unknown) => str(m, 40)) : d.maps,
    mapIndex: num(v.mapIndex, 0, 9, 0),
    round: num(v.round, 1, RC_ROUNDS_PER_MAP, 1),
    players: [0, 1, 2, 3].map(i => pl(v.players?.[i])),
    finished: !!v.finished,
    roundAt: Number(v.roundAt) || 0,
    source: src?.kind === 'league' && (src.div === 'd1' || src.div === 'd2') ? { kind: 'league', div: src.div, match: num(src.match, 0, 19, 0) }
      : src?.kind === 'playoff' && PLAYOFF_DEFS.some(p => p.id === src.id) ? { kind: 'playoff', id: src.id } : null,
    history: Array.isArray(v.history) ? v.history.slice(-60).map((h: any) => ({ players: [0, 1, 2, 3].map(i => pl(h?.players?.[i])), mapIndex: num(h?.mapIndex, 0, 9, 0), round: num(h?.round, 1, 4, 1), finished: !!h?.finished })) : [],
  };
}

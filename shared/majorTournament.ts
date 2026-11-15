/**
 * The Major bracket (wildcard data: teams, scores, walkovers, live match) shown with the tournament admin's bracket
 * view. Who plays whom, winners and walkovers come from the Major's own rules (wcResolve); this only re-expresses
 * them in the shape the admin view draws (ids UB-r-i / LB-r-i / GF-1, labels, scores, best-of).
 */
import { BYE, type BMatch, type Resolved, type Slot, type SlotRef, type TTeam, type Tournament } from './tournament';
import { WC_IDS, WC_STRUCT, wcLogo, wcResolve, type WcSlot, type WildcardState } from './wildcard';

/** Major match id → admin-view id (side, round, index), label. */
const MAP: Record<string, { id: string; side: 'UB' | 'LB' | 'GF'; round: number; index: number; label: string }> = {
  R1_UB1: { id: 'UB-1-0', side: 'UB', round: 1, index: 0, label: 'Upper Quarterfinals' }, R1_UB2: { id: 'UB-1-1', side: 'UB', round: 1, index: 1, label: 'Upper Quarterfinals' },
  R1_UB3: { id: 'UB-1-2', side: 'UB', round: 1, index: 2, label: 'Upper Quarterfinals' }, R1_UB4: { id: 'UB-1-3', side: 'UB', round: 1, index: 3, label: 'Upper Quarterfinals' },
  R2_UB1: { id: 'UB-2-0', side: 'UB', round: 2, index: 0, label: 'Upper Semifinals' }, R2_UB2: { id: 'UB-2-1', side: 'UB', round: 2, index: 1, label: 'Upper Semifinals' },
  R3_UB1: { id: 'UB-3-0', side: 'UB', round: 3, index: 0, label: 'Upper Final' },
  R1_LB1: { id: 'LB-1-0', side: 'LB', round: 1, index: 0, label: 'Lower Round 1' }, R1_LB2: { id: 'LB-1-1', side: 'LB', round: 1, index: 1, label: 'Lower Round 1' },
  R2_LB1: { id: 'LB-2-0', side: 'LB', round: 2, index: 0, label: 'Lower Quarterfinals' }, R2_LB2: { id: 'LB-2-1', side: 'LB', round: 2, index: 1, label: 'Lower Quarterfinals' },
  R3_LB1: { id: 'LB-3-0', side: 'LB', round: 3, index: 0, label: 'Lower Semifinal' },
  R4_LB1: { id: 'LB-4-0', side: 'LB', round: 4, index: 0, label: 'Lower Final' },
  R5_GF1: { id: 'GF-1', side: 'GF', round: 1, index: 0, label: 'Grand Final' },
};
export const majorIdOf = (wcId: string) => MAP[wcId]?.id ?? null;

const team = (name: string): TTeam => ({ id: name, name, tag: name.slice(0, 4).toUpperCase(), logo: wcLogo(name) });
const slotOf = (name: string | null | undefined): Slot => (!name ? null : name === 'BYE' ? BYE : team(name));
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : 0);

export function majorAsTournament(wc: WildcardState, name = 'OverDrive 2026 Major'): { t: Tournament; res: Map<string, Resolved> } {
  const R = wcResolve(wc.matches, wc.teams);
  const matches: BMatch[] = [];
  const res = new Map<string, Resolved>();
  for (const id of WC_IDS) {
    const p = MAP[id]; if (!p) continue;
    const m = wc.matches[id], r = R[id];
    const ref = (s: WcSlot): SlotRef => {
      if (typeof s === 'object' && 'w' in s && MAP[s.w]) return { k: 'win', m: MAP[s.w].id };
      if (typeof s === 'object' && 'l' in s && MAP[s.l]) return { k: 'lose', m: MAP[s.l].id };
      return { k: 'seed', seed: typeof s === 'object' && 's' in s ? s.s + 1 : 0 };
    };
    const [fa, fb] = WC_STRUCT[id];
    const a = slotOf(r.t1), b = slotOf(r.t2);
    // Walkovers / forfeits: the winner gets the higher number so the view highlights the right side.
    let scoreA = num(m.s1), scoreB = num(m.s2);
    if (r.winner && scoreA === scoreB) { if (r.winner === r.t1) scoreA = scoreB + 1; else scoreB = scoreA + 1; }
    const done = !!r.winner && r.winner !== 'BYE';
    matches.push({
      id: p.id, side: p.side, round: p.round, index: p.index, label: p.label, a: ref(fa), b: ref(fb), scoreA, scoreB, bestOf: 5,
      status: done ? 'done' : m.live ? 'live' : 'upcoming', time: m.time || '', stream: '', doneAt: null,
    });
    const auto = (a === BYE || b === BYE) && !!r.winner;
    res.set(p.id, { a, b, winner: r.winner ? (r.winner === r.t1 ? 'A' : 'B') : null, auto, skipped: false });
  }
  const t: Tournament = { name, format: 'double', size: 8, gfReset: false, teams: [], matches, featured: wc.cast ? majorIdOf(wc.cast) : null, updatedAt: wc.rev ?? 0 };
  return { t, res };
}

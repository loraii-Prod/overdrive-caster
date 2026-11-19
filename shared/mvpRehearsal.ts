/**
 * 3.0 MVP rehearsal: a demo bracket with clearly fictional teams and players, loaded as its own event profile
 * ("MVP rehearsal · demo data") so the REAL MVP workflow runs end to end without touching the real event:
 * results, votes, MVP choices and analyst picks of the real event are never read or written while it is active.
 * Votes stay on this server (never the online vote service) and real Twitch chat is ignored.
 */
import { defaultWildcard, type WildcardState } from './wildcard';

export const REHEARSAL_ID = 'mvp-rehearsal';
export const REHEARSAL_NAME = 'MVP rehearsal · demo data';
/** Fictional teams (upper quarter-finals 1 and 2) and their players. Every name says DEMO. */
export const DEMO_ROSTERS: Record<string, string[]> = {
  'DEMO Falcons': ['Falk (demo)', 'Ryzo (demo)'],
  'DEMO Comets': ['Nova (demo)', 'Kite (demo)'],
  'DEMO Rockets': ['Brix (demo)', 'Tamo (demo)'],
  'DEMO Wolves': ['Lumi (demo)', 'Zed (demo)'],
};
/** The demo matches, in the order "Finish demo match" ends them. */
export const DEMO_MATCHES = ['R1_UB1', 'R1_UB2'];

/** Demo bracket: match 1 live at 2–1 and cast, match 2 live at 1–1. Nothing finished yet: finishing one is the test. */
export function demoWildcard(): WildcardState {
  const wc = defaultWildcard(true);
  wc.teams = ['DEMO Falcons', 'DEMO Comets', 'DEMO Rockets', 'DEMO Wolves', '', '', '', ''];
  wc.rosters = { ...DEMO_ROSTERS };
  wc.rehearsal = true;
  wc.sheetAuto = false; // never takes results from the real event's sheet
  wc.matches.R1_UB1 = { ...wc.matches.R1_UB1, s1: '2', s2: '1', live: true };
  wc.matches.R1_UB2 = { ...wc.matches.R1_UB2, s1: '1', s2: '1', live: true };
  wc.cast = 'R1_UB1';
  wc.rev = Date.now();
  return wc;
}

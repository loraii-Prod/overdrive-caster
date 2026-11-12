import { MAJOR_PROFILES } from './major';
import { pbMs } from './wildcard';

/**
 * Player PBs on the Major maps, from the 2026 Split 3 campaign leaderboards on trackmania.io
 * (read 10 Nov 2026). Only players who drove the campaign are listed: the BIG, FUT Esports, Airwalkers
 * and COOK players have no time there yet (except Massa on Egypt); enter those in the Major tab.
 * Keyed by map id, then by the player's handle as in MAJOR_PROFILES.
 */
export const PLAYER_PBS: Record<string, Record<string, string>> = {
  india: { eLconn21: '1:04.068', Melioo: '1:04.075', Epos: '1:04.151', Gwen: '1:04.240', Mime: '1:04.263', Nabla: '1:04.281', Binkss: '1:04.288', Walegen: '1:04.298' },
  czech: { Melioo: '59.848', Binkss: '59.898', Epos: '59.976', Nabla: '59.985', Mime: '59.988', eLconn21: '1:00.007', Gwen: '1:00.034', Walegen: '1:00.382' },
  egypt: { Epos: '1:09.493', Gwen: '1:09.545', Nabla: '1:10.267', Walegen: '1:10.385', Binkss: '1:10.518', Massa: '1:10.632', Melioo: '1:11.282' },
  uk: { Nabla: '1:08.891', eLconn21: '1:09.281', Mime: '1:09.353', Gwen: '1:09.457', Walegen: '1:09.521', Melioo: '1:09.557', Binkss: '1:09.657', Epos: '1:09.697' },
  nz: { Melioo: '1:01.370', Mime: '1:01.422', Epos: '1:01.452', eLconn21: '1:01.537', Binkss: '1:01.588', Gwen: '1:01.645', Walegen: '1:01.804', Nabla: '1:01.958' },
};
export const PB_SOURCE = 'trackmania.io · 2026 Split 3 campaign';

/** Each player of a team with their PB on a map (fastest first; players without a time last). */
export function teamPlayerPbs(map: string, team: string): { handle: string; time: string | null }[] {
  return MAJOR_PROFILES.filter(p => p.team === team)
    .map(p => ({ handle: p.handle, time: PLAYER_PBS[map]?.[p.handle] ?? null }))
    .sort((a, b) => (a.time ? pbMs(a.time)! : Infinity) - (b.time ? pbMs(b.time)! : Infinity));
}

/** A team's PB from the leaderboard: its fastest player's time. */
export function seedTeamPb(map: string, team: string): { time: string; player: string } | null {
  const best = teamPlayerPbs(map, team)[0];
  return best?.time ? { time: best.time, player: best.handle } : null;
}

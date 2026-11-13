/**
 * Stable player IDs for the Major players: the IDs of the verified season dataset (public/season/overdrive-2026.json,
 * matched by exact name, one record each). Nicknames stay as aliases so every existing association (portraits keyed
 * by nickname) keeps working. Nothing here merges records.
 */
import { MAJOR_PROFILES, normHandle } from './major';

export const MAJOR_PLAYER_IDS: Record<string, string> = {
  massa: 'P_massa', granady: 'P_granady', heav: 'P_heav', nayko: 'P_nayko', whizzy: 'P_whizzy', stufts: 'P_stufts',
  l1ngo: 'P_l1ngo', scrapie: 'P_scrapie', melioo: 'P_melioo', epos: 'P_epos', mime: 'P_mime', elconn21: 'P_elconn21',
  nabla: 'P_nabla', walegen: 'P_walegen', gwen: 'P_gwen', binkss: 'P_binkss',
};
/** IDs not backed by a verified dataset record (owner decision 13 Nov 2026): kept separate, never merged. */
export const PROVISIONAL_PLAYER_IDS: Record<string, string> = { P_nabla: 'Nabla (rnboi) has no record in the verified season dataset: Major-only, unconfirmed' };

export const playerIdOf = (handle: string): string | null => MAJOR_PLAYER_IDS[normHandle(handle)] ?? null;
export const handlesOf = (id: string): string[] => MAJOR_PROFILES.filter(p => playerIdOf(p.handle) === id).map(p => p.handle);
export const isProvisional = (id: string) => id in PROVISIONAL_PLAYER_IDS;

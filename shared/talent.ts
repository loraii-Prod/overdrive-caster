/**
 * Overdrive 2.0 talent: 10 permanent profiles (the registered pool) and the broadcast positions they sit in.
 * Positions are the existing camera slots, so the approved layouts are unchanged:
 *   1 Caster 1 (left) · 2 Caster 2 (center) · 3 Caster 3 (right) · 4 Analyst 1 (left) · 5 Analyst 2 (right)
 *   6 Interview guest (kept from the Major version).
 * A talent connects once with their personal link; moving them between positions re-routes their camera on
 * the server, so they never have to reconnect.
 */
export type TalentRole = 'caster' | 'analyst';
export type TalentMode = 'webrtc' | 'vdo';

export interface TalentProfile {
  /** Persistent id: t1 … t10 */
  id: string;
  /** Display name ('' = not set yet: needs confirmation by the producer) */
  name: string;
  role: TalentRole;
  /** How their camera reaches the show: this app's WebRTC (default) or VDO.Ninja (their personal push ID). */
  mode: TalentMode;
  /** Secret of their personal link (server + producer only). */
  key: string;
  /** Personal VDO.Ninja stream ID. */
  vdoId: string;
}

export const TALENT_COUNT = 10;
export const SEATS = [1, 2, 3, 4, 5, 6] as const;
export type Seat = (typeof SEATS)[number];
export const SEAT_LABELS: Record<Seat, string> = { 1: 'Caster 1 · Left', 2: 'Caster 2 · Center', 3: 'Caster 3 · Right', 4: 'Analyst 1 · Left', 5: 'Analyst 2 · Right', 6: 'Interview guest' };
export const CASTER_SEATS: Seat[] = [1, 2, 3];
export const ANALYST_SEATS: Seat[] = [4, 5];
export type Seats = Record<Seat, string | null>;
export const emptySeats = (): Seats => ({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: null });

/** Names the Major setup ships with: these are slot labels, not real people. */
export const isPlaceholderName = (n: string) => !n.trim() || /^(caster|analyst|guest|talent)\s*\d*$/i.test(n.trim());

export function talentLabel(t: TalentProfile | undefined | null): string {
  if (!t) return '—';
  return t.name.trim() || `Talent ${t.id.slice(1)} (name needed)`;
}

export function sanitizeTalent(v: unknown, mkKey: () => string, mkVdo: () => string): TalentProfile[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: TALENT_COUNT }, (_, i) => {
    const id = `t${i + 1}`;
    const x = arr.find((p: any) => p && p.id === id) ?? {};
    return {
      id,
      name: typeof x.name === 'string' ? x.name.slice(0, 40) : '',
      role: x.role === 'analyst' ? 'analyst' : 'caster',
      mode: x.mode === 'vdo' ? 'vdo' : 'webrtc',
      key: typeof x.key === 'string' && x.key.length >= 16 ? x.key : mkKey(),
      vdoId: typeof x.vdoId === 'string' && /^[A-Za-z0-9_]{6,40}$/.test(x.vdoId) ? x.vdoId : mkVdo(),
    };
  });
}

export function sanitizeSeats(v: unknown, talent: TalentProfile[]): Seats {
  const s = emptySeats(), used = new Set<string>();
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  for (const seat of SEATS) {
    const t = src[String(seat)];
    if (typeof t === 'string' && talent.some(p => p.id === t) && !used.has(t)) { s[seat] = t; used.add(t); }
  }
  return s;
}

export const seatOf = (seats: Seats, talentId: string): Seat | null => (SEATS.find(s => seats[s] === talentId) ?? null);

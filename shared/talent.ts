/**
 * Overdrive 2.0 talent: 10 permanent profiles (the registered pool) and the broadcast positions they sit in.
 * Positions are the existing camera slots, so the approved layouts are unchanged:
 *   1 Caster 1 (left) · 2 Caster 2 (center) · 3 Caster 3 (right) · 4 Analyst 1 (left) · 5 Analyst 2 (right)
 *   6 Interview guest (kept from the Major version).
 * A talent connects once with their personal link; moving them between positions re-routes their camera on
 * the server, so they never have to reconnect.
 */
export type TalentRole = 'caster' | 'analyst' | 'host' | 'guest';
export const TALENT_ROLES: { id: TalentRole; label: string }[] = [{ id: 'caster', label: 'Caster' }, { id: 'analyst', label: 'Analyst' }, { id: 'host', label: 'Host' }, { id: 'guest', label: 'Guest' }];
export type TalentMode = 'webrtc' | 'vdo';

/**
 * Where a person's voice reaches the show (3.0). One audio path per person, independent of the scenes:
 *  - 'feed': the audio of their camera link (Overdrive app or VDO.Ninja), played by the position's dedicated
 *    "Overdrive Caster N audio" source in OBS (/output/audio/N), which never reloads when scenes change;
 *  - 'obs':  an OBS input that already exists (a Discord / desktop capture, a mic, an audio interface or mixer
 *    channel). Their camera link's audio is then silenced so the voice is never heard twice;
 *  - 'none': no audio from this person (video only).
 */
export type AudioSource = 'feed' | 'obs' | 'none';
export interface TalentAudio {
  source: AudioSource;
  /** OBS input name when source = 'obs'. */
  input: string;
  /** Fader in dB (OBS input volume): -60 … +12, 0 = unity. */
  volumeDb: number;
  muted: boolean;
  /** OBS audio sync offset in ms (-950 … 20000): delays the voice to match a late picture. */
  syncMs: number;
  /** OBS audio monitoring (the producer hears this person on the PC's monitoring device). */
  monitor: boolean;
}
export const defaultAudio = (): TalentAudio => ({ source: 'feed', input: '', volumeDb: 0, muted: false, syncMs: 0, monitor: false });
export function sanitizeAudio(v: any): TalentAudio {
  const d = defaultAudio(), n = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def);
  return {
    source: v?.source === 'obs' || v?.source === 'none' ? v.source : 'feed',
    input: typeof v?.input === 'string' ? v.input.slice(0, 120) : d.input,
    volumeDb: Math.round(n(v?.volumeDb, -60, 12, 0) * 10) / 10,
    muted: v?.muted === true,
    syncMs: Math.round(n(v?.syncMs, -950, 20000, 0)),
    monitor: v?.monitor === true,
  };
}

/** Camera framing inside every tile that shows this person (crop and position, applied by the renderer). */
export interface TalentCrop { zoom: number; x: number; y: number }
export const defaultCrop = (): TalentCrop => ({ zoom: 1, x: 0, y: 0 });
export function sanitizeCrop(v: any): TalentCrop {
  const n = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def);
  return { zoom: Math.round(n(v?.zoom, 1, 3, 1) * 100) / 100, x: Math.round(n(v?.x, -50, 50, 0)), y: Math.round(n(v?.y, -50, 50, 0)) };
}
/** CSS for a framed camera: zoom around the centre, then pan (x / y in % of the tile, clamped so no edge shows). */
export function cropStyle(c: TalentCrop | undefined): { transform?: string; transformOrigin?: string } {
  if (!c || (c.zoom === 1 && !c.x && !c.y)) return {};
  const lim = ((c.zoom - 1) / c.zoom) * 50; // furthest pan (in % of the scaled element) that keeps the tile covered
  const x = Math.max(-lim, Math.min(lim, (c.x / 50) * lim)), y = Math.max(-lim, Math.min(lim, (c.y / 50) * lim));
  return { transform: `scale(${c.zoom}) translate(${-x}%, ${-y}%)`, transformOrigin: '50% 50%' };
}

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
  /** Camera resolution the producer wants from this person (both camera paths). 720p is the stable default. */
  camQuality: CamQuality;
  /** 3.0: the producer pasted / confirmed their VDO.Ninja stream (the generated id is only a suggestion). */
  vdoSet: boolean;
  /** Profile picture (asset URL), used on cards and the Green Room when the camera is off. */
  photo: string;
  /** Producer's ready check before going live (Green Room). */
  ready: boolean;
  audio: TalentAudio;
  crop: TalentCrop;
  /** Producer notes (pronunciation, socials, setup remarks). Never on air. */
  notes: string;
}

/**
 * Caster camera quality. 720p30 is the default (light on the talent's CPU and upload). 1080p30 is the sharper option
 * for 4K shows: it doubles the pixels and roughly doubles the bitrate. A camera feed is never native 4K: the graphics
 * around it are.
 */
export type CamQuality = '720p' | '1080p';
export const CAM_QUALITIES: Record<CamQuality, { label: string; width: number; height: number; fps: number; /** WebRTC send bitrate */ bitrate: number; /** VDO.Ninja push parameters */ vdoPush: string; /** VDO.Ninja view parameters (OBS outputs) */ vdoView: string }> = {
  '720p': { label: '720p30 (default)', width: 1280, height: 720, fps: 30, bitrate: 3_000_000, vdoPush: '&quality=1', vdoView: '' },
  '1080p': { label: '1080p30', width: 1920, height: 1080, fps: 30, bitrate: 6_000_000, vdoPush: '&quality=0&maxframerate=30', vdoView: '&bitrate=6000' },
};
export const DEFAULT_CAM_QUALITY: CamQuality = '720p';
export const camQualityOf = (v: unknown): CamQuality => (v === '1080p' ? '1080p' : DEFAULT_CAM_QUALITY);

/** Profiles t1…t10 always exist (their links may already be out); Add Talent creates up to TALENT_MAX. */
export const TALENT_COUNT = 10;
export const TALENT_MAX = 24;
/** A profile is in use when it has a name, a position or a pasted VDO.Ninja stream. */
export const inUse = (t: Pick<TalentProfile, 'name' | 'vdoSet'>, seated: boolean) => !!t.name.trim() || seated || t.vdoSet;
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

export const talentNum = (id: string) => Number(/^t(\d{1,2})$/.exec(id)?.[1] ?? 0);
export function blankTalent(id: string, mkKey: () => string, mkVdo: () => string): TalentProfile {
  return { id, name: '', role: 'caster', mode: 'webrtc', key: mkKey(), vdoId: mkVdo(), camQuality: DEFAULT_CAM_QUALITY, vdoSet: false, photo: '', ready: false, audio: defaultAudio(), crop: defaultCrop(), notes: '' };
}
export function sanitizeTalent(v: unknown, mkKey: () => string, mkVdo: () => string): TalentProfile[] {
  const arr = Array.isArray(v) ? v : [];
  // t1…t10 always; t11…t24 when they were added (Add Talent)
  const ids = new Set(Array.from({ length: TALENT_COUNT }, (_, i) => `t${i + 1}`));
  for (const p of arr) { const n = talentNum(p?.id); if (n > TALENT_COUNT && n <= TALENT_MAX) ids.add(`t${n}`); }
  return [...ids].sort((a, b) => talentNum(a) - talentNum(b)).map(id => {
    const x = arr.find((p: any) => p && p.id === id) ?? {};
    const vdoId = typeof x.vdoId === 'string' && /^[A-Za-z0-9_]{6,40}$/.test(x.vdoId) ? x.vdoId : null;
    return {
      id,
      name: typeof x.name === 'string' ? x.name.slice(0, 40) : '',
      role: (['analyst', 'host', 'guest'] as const).includes(x.role) ? x.role : 'caster',
      mode: x.mode === 'vdo' ? 'vdo' : 'webrtc',
      key: typeof x.key === 'string' && x.key.length >= 16 ? x.key : mkKey(),
      vdoId: vdoId ?? mkVdo(),
      camQuality: camQualityOf(x.camQuality),
      // 2.x files: a talent already in VDO.Ninja mode was set up by the producer (pasted link) → keep it as set
      vdoSet: typeof x.vdoSet === 'boolean' ? x.vdoSet && !!vdoId : x.mode === 'vdo' && !!vdoId,
      photo: typeof x.photo === 'string' && /^(\/|https?:\/\/)[^\s"'<>]{0,400}$/.test(x.photo) ? x.photo : '',
      ready: x.ready === true,
      audio: sanitizeAudio(x.audio),
      crop: sanitizeCrop(x.crop),
      notes: typeof x.notes === 'string' ? x.notes.slice(0, 500) : '',
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

/**
 * Stream ID from a pasted VDO.Ninja link (…?push=ID, …?view=ID, &push=ID) or a bare ID. null when it holds none.
 * The room, password and quality parameters of a pasted link are ignored: the show's own settings apply.
 */
export function parseVdoId(v: string): string | null {
  const t = v.trim();
  if (/^[A-Za-z0-9_]{6,40}$/.test(t)) return t;
  const m = /[?&#](?:push|view|streamid|permaid)=([A-Za-z0-9_]{6,40})(?:[&#]|$)/i.exec(t);
  return m ? m[1] : null;
}

/**
 * What a pasted VDO.Ninja text is, for the Add Talent form (shown while typing) and the setup checks.
 * ok = a stream ID could be read. `problem` explains a link that cannot work; `note` is advice for a usable one.
 */
export interface VdoLinkInfo { ok: boolean; id: string | null; kind: 'empty' | 'bare' | 'push' | 'view' | 'room' | 'director' | 'scene' | 'invalid'; problem?: string; note?: string }
export function describeVdoLink(v: string): VdoLinkInfo {
  const t = v.trim();
  if (!t) return { ok: false, id: null, kind: 'empty' };
  const id = parseVdoId(t);
  if (/^[A-Za-z0-9_]{6,40}$/.test(t)) return { ok: true, id, kind: 'bare', note: 'Stream ID only: the show\'s VDO.Ninja password and room are used.' };
  if (/^[A-Za-z0-9_-]{1,5}$/.test(t)) return { ok: false, id: null, kind: 'invalid', problem: 'Too short for a VDO.Ninja stream ID (6–40 letters, digits or _).' };
  let host = '';
  try { host = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`).hostname; } catch { return { ok: false, id: null, kind: 'invalid', problem: 'Not a link or a stream ID.' }; }
  const vdoHost = /(^|\.)(vdo\.ninja|obs\.ninja|vdo\.socialstream\.ninja)$/i.test(host);
  if (/[?&#]director=/i.test(t) && !id) return { ok: false, id: null, kind: 'director', problem: 'This is a director link (it controls the room). Paste the guest\'s own link: the one with push= or view=.' };
  if (/[?&#]scene(=|&|$)/i.test(t) && !id) return { ok: false, id: null, kind: 'scene', problem: 'This is a room scene link (all guests together). Paste one guest\'s link with push= or view=.' };
  if (/[?&#]room=/i.test(t) && !id) return { ok: false, id: null, kind: 'room', problem: 'This room link has no stream ID. Ask the guest for their link with push=… (or copy their view= link).' };
  if (!id) return { ok: false, id: null, kind: 'invalid', problem: vdoHost ? 'No push= or view= stream ID in this VDO.Ninja link.' : 'Not a VDO.Ninja link: it needs push=… or view=….' };
  const kind = /[?&#](push|permaid)=/i.test(t) ? 'push' : 'view';
  const note = !vdoHost ? `Not on vdo.ninja (${host}): only the stream ID ${id} is used, on the show's VDO.Ninja.` : /[?&#]password=/i.test(t) ? 'The link\'s own password is ignored: the show\'s VDO.Ninja password applies.' : undefined;
  return { ok: true, id, kind, note };
}

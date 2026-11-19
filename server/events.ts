import crypto from 'node:crypto';
import { db, save } from './store';
import { clone, defaultPresets, defaultRos, defaultScene, defaultShow, emptyBrand, sanitizeRos, sanitizeScene, sanitizeShow } from '../shared/defaults';
import { ensureStreamIds, sanitizePlayers, sanitizeStories } from '../shared/players';
import { defaultTournament, sanitizeTournament } from '../shared/tournament';
import type { ThemeId } from '../shared/types';
import { majorSheet, sanitizeSheet } from '../shared/sheet';
import { MAJOR_TICKER, defaultWildcard, sanitizeWildcard } from '../shared/wildcard';
import { sanitizeAudStore } from './audience';
import { REHEARSAL_ID, REHEARSAL_NAME } from '../shared/mvpRehearsal';
import type { WildcardState } from '../shared/wildcard';

/** Everything that belongs to one event (production). Logins, keys, OBS and API settings stay global. */
// 3.0: 'audience' (MVP votes, MVP choices, analyst picks, archives) belongs to the event too: every event uses the
// same bracket slots (R1_UB1…), so a shared store would carry one event's votes and reveals into another.
const KEYS = ['preview', 'live', 'showPreview', 'showLive', 'players', 'stories', 'tournament', 'ros', 'presets', 'sheet', 'wildcard', 'audience'] as const;

const snapshot = () => clone(Object.fromEntries(KEYS.map(k => [k, (db as any)[k]])));

function apply(data: any) {
  const d = data ?? {};
  db.preview = sanitizeScene(d.preview);
  db.live = sanitizeScene(d.live);
  db.showPreview = sanitizeShow(d.showPreview);
  db.showLive = sanitizeShow(d.showLive);
  db.players = Array.isArray(d.players) ? ensureStreamIds(sanitizePlayers(d.players)) : [];
  db.stories = Array.isArray(d.stories) ? sanitizeStories(d.stories) : [];
  db.tournament = d.tournament ? sanitizeTournament(d.tournament) : defaultTournament();
  db.ros = d.ros ? sanitizeRos(d.ros) : defaultRos();
  db.presets = Array.isArray(d.presets) ? d.presets : defaultPresets(db.preview);
  db.sheet = sanitizeSheet(d.sheet);
  db.wildcard = d.wildcard ? sanitizeWildcard(d.wildcard) : defaultWildcard(false);
  db.audience = sanitizeAudStore(d.audience); // an event saved before 3.0 starts with no MVP votes of its own
}

function blankData(name: string, theme: ThemeId) {
  const scene = defaultScene();
  const show = defaultShow();
  Object.assign(show, {
    theme, tournament: name.toUpperCase(), stage: '', schedule: [], socials: [], sponsors: [],
    ticker: { ...show.ticker, items: [`Welcome to ${name}`] },
    prize: { ...show.prize, enabled: false, raised: 0 },
    lineup: [], activePlayer: null, spotlight: null,
    brand: { ...emptyBrand(), name },
  });
  const t = defaultTournament();
  return {
    preview: scene, live: clone(scene), showPreview: show, showLive: clone(show), players: [], stories: [],
    tournament: { ...t, name: name.toUpperCase(), teams: [] }, ros: defaultRos(), presets: defaultPresets(scene),
    wildcard: defaultWildcard(false),
  };
}

export function listEvents() {
  return { events: db.events, active: db.activeEvent };
}

export function createEvent(name: string, from: 'copy' | 'blank' | 'overdrive', theme: ThemeId): string {
  const n = name.trim().slice(0, 60) || 'New event';
  const id = `${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'event'}-${crypto.randomBytes(3).toString('hex')}`;
  db.events.push({ id, name: n, createdAt: Date.now() });
  const data: any = from === 'copy' ? snapshot() : from === 'overdrive' ? overdriveData(n) : blankData(n, theme);
  if (from === 'copy') {
    data.showPreview.brand = { ...data.showPreview.brand, name: n }; data.showLive.brand = { ...data.showLive.brand, name: n };
    // a copied event keeps the voting settings, never the votes / MVP choices / analyst picks of the original
    const a = sanitizeAudStore(data.audience), e = sanitizeAudStore(null);
    data.audience = { ...e, publicUrl: a.publicUrl, qr: a.qr, qrHosts: a.qrHosts, voteMode: a.voteMode, mvpAuto: a.mvpAuto };
  }
  db.eventData[id] = data;
  save();
  return id;
}

/** Make another event the active one: its graphics, players, standings… go live at once. */
export function switchEvent(id: string): boolean {
  if (id === db.activeEvent || !db.events.some(e => e.id === id) || !db.eventData[id]) return false;
  db.eventData[db.activeEvent] = snapshot();
  const next = db.eventData[id];
  delete db.eventData[id];
  apply(next);
  db.activeEvent = id;
  db.liveVersion++;
  db.liveAt = Date.now();
  save();
  return true;
}

export function renameEvent(id: string, name: string) {
  const e = db.events.find(x => x.id === id);
  if (e) { e.name = name.trim().slice(0, 60) || e.name; save(); }
}

export function deleteEvent(id: string): boolean {
  if (id === db.activeEvent || db.events.length <= 1) return false;
  db.events = db.events.filter(e => e.id !== id);
  delete db.eventData[id];
  save();
  return true;
}

/** Overdrive Racing League package: video skin, brand, socials and the master sheet (read-only). */
function overdriveData(name: string) {
  const d = blankData(name, 'bnl');
  const brand = { ...emptyBrand(), name, logo: '/brand/overdrive/logo.png', mark: '/brand/overdrive/mark.png', accent: '#ff3b1f', font: 'russo' as const, skin: 'overdrive' };
  const scene = { ...d.preview, casters: d.preview.casters.map((c, i) => ({ ...c, enabled: i < 2 })) as typeof d.preview.casters };
  for (const show of [d.showPreview, d.showLive]) {
    Object.assign(show, {
      brand, tournament: 'OVERDRIVE GRAND LEAGUE', stage: '26S3 MAJOR',
      socials: [{ platform: 'twitch', handle: 'twitch.tv/overdrive_tm' }, { platform: 'discord', handle: 'discord.gg/tZV3Mu3Thb' }, { platform: 'x', handle: '@OVERDRIVE_TM' }],
      ticker: { ...show.ticker, enabled: true, onScreens: true, items: [...MAJOR_TICKER] },
      bestOf: 5, showMatchupOnScreens: false, showMatchupOnCasters: false, showScoreboard: false,
      nextMatch: { ...show.nextMatch, enabled: true, corner: 'tr' },
      timer: { ...show.timer, label: 'STREAM STARTING IN' },
    });
  }
  return { ...d, preview: scene, live: clone(scene), wildcard: defaultWildcard(true), sheet: majorSheet() };
}

/**
 * 3.0 MVP rehearsal: (re)write the rehearsal event: the active event's look (scenes, brand, casters, rundown) with the
 * demo bracket, a fresh vote store counting on this server only, and no Google Sheet. `from` = the event to go back to.
 */
export function putRehearsal(wc: WildcardState, from: string) {
  const data: any = snapshot();
  data.sheet = sanitizeSheet({ ...data.sheet, enabled: false });
  data.wildcard = wc;
  const a = sanitizeAudStore(data.audience);
  data.audience = { ...sanitizeAudStore(null), voteMode: 'local', mvpAuto: a.mvpAuto };
  let e = db.events.find(x => x.id === REHEARSAL_ID);
  if (!e) db.events.push(e = { id: REHEARSAL_ID, name: REHEARSAL_NAME, createdAt: Date.now() });
  if (from !== REHEARSAL_ID) e.from = from;
  if (db.activeEvent === REHEARSAL_ID) { apply(data); db.liveVersion++; db.liveAt = Date.now(); }
  else db.eventData[REHEARSAL_ID] = data;
  save();
}
/** Where "Leave rehearsal" goes: the event the rehearsal was started from (else the first other event). */
export function rehearsalReturn(): string | null {
  const e = db.events.find(x => x.id === REHEARSAL_ID);
  const ok = (id?: string) => !!id && id !== REHEARSAL_ID && db.events.some(x => x.id === id);
  return ok(e?.from) ? e!.from! : db.events.find(x => x.id !== REHEARSAL_ID)?.id ?? null;
}

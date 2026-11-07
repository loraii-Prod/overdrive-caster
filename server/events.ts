import crypto from 'node:crypto';
import { db, save } from './store';
import { clone, defaultPresets, defaultRos, defaultScene, defaultShow, emptyBrand, sanitizeRos, sanitizeScene, sanitizeShow } from '../shared/defaults';
import { ensureStreamIds, sanitizePlayers, sanitizeStories } from '../shared/players';
import { defaultTournament, sanitizeTournament } from '../shared/tournament';
import type { ThemeId } from '../shared/types';
import { emptySheet, sanitizeSheet } from '../shared/sheet';

/** Everything that belongs to one event (production). Logins, keys, OBS and API settings stay global. */
const KEYS = ['preview', 'live', 'showPreview', 'showLive', 'players', 'stories', 'tournament', 'ros', 'presets', 'sheet'] as const;

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
  };
}

export function listEvents() {
  return { events: db.events, active: db.activeEvent };
}

export function createEvent(name: string, from: 'copy' | 'blank' | 'overdrive', theme: ThemeId): string {
  const n = name.trim().slice(0, 60) || 'New event';
  const id = `${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'event'}-${crypto.randomBytes(3).toString('hex')}`;
  db.events.push({ id, name: n, createdAt: Date.now() });
  const data = from === 'copy' ? snapshot() : from === 'overdrive' ? overdriveData(n) : blankData(n, theme);
  if (from === 'copy') { data.showPreview.brand = { ...data.showPreview.brand, name: n }; data.showLive.brand = { ...data.showLive.brand, name: n }; }
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
      brand, tournament: 'OVERDRIVE GRAND LEAGUE', stage: '26S3 WILDCARD',
      socials: [{ platform: 'twitch', handle: 'twitch.tv/overdrive_tm' }, { platform: 'discord', handle: 'discord.gg/tZV3Mu3Thb' }, { platform: 'x', handle: '@OVERDRIVE_TM' }],
      ticker: { ...show.ticker, enabled: true, onScreens: true, items: ['2026 OverDrive Wildcard: top 4 qualify for the OverDrive Major', 'Live bracket & schedule: lavaaval.github.io/2026_overdrive_wildcard', 'Follow @OVERDRIVE_TM · twitch.tv/overdrive_tm', 'Join the community: discord.gg/tZV3Mu3Thb'] },
      bestOf: 5, showMatchupOnScreens: true,
      nextMatch: { ...show.nextMatch, enabled: true, corner: 'tr' },
      timer: { ...show.timer, label: 'STREAM STARTING IN' },
    });
  }
  return { ...d, preview: scene, live: clone(scene), sheet: { ...emptySheet(), id: '1SgnXorS23IvBM2dbie_QOc756wnOTjqCvx3U2ensfi4', gid: '1222783107', enabled: true, title: 'WILDCARD' } };
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { clone, defaultPresets, defaultRos, defaultScene, defaultShow, emptyBrand, sanitizeRos, sanitizeScene, sanitizeShow } from '../shared/defaults';
import type { CasterId, FollowSettings, Preset, RunOfShow, Scene, Show } from '../shared/types';
import { sanitizeLeague, sanitizePlayoffs, type League, type Playoffs } from '../shared/bnl';
import { ensureStreamIds, sanitizePlayers, sanitizeStories, type Player, type Story } from '../shared/players';
import { defaultTournament, sanitizeTournament, type Tournament } from '../shared/tournament';
import { emptySheet, sanitizeSheet, type SheetState } from '../shared/sheet';

export interface Persisted {
  preview: Scene;
  live: Scene;
  showPreview: Show;
  showLive: Show;
  apiToken: string;
  crewKey: string;
  ros: RunOfShow;
  players: Player[];
  stories: Story[];
  follow: FollowSettings;
  league: League;
  playoffs: Playoffs;
  liveVersion: number;
  liveAt: number;
  instant: boolean;
  presets: Preset[];
  contributorKeys: Record<CasterId, string>;
  sessions: Record<string, { exp: number; role: 'producer' | 'admin' }>;
  tournament: Tournament;
  generatedAdminPassword?: string;
  /** Read-only Google Sheet source of the active event. */
  sheet: SheetState;
  /** Events (productions). The active one's data lives in the top-level fields. */
  events: { id: string; name: string; createdAt: number }[];
  activeEvent: string;
  /** Stored data of the inactive events. */
  eventData: Record<string, any>;
  obsUrl?: string;
  obsPassword?: string;
  passwordHash?: string;
  generatedPassword?: string;
}

export const newKey = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

const FILE = () => path.join(config.dataDir, 'state.json');

/** This is a standalone, single-purpose install: Overdrive Racing League is the
 * one and only production. There's no Benelux event here and nothing BNL-themed
 * ships in its data — a fresh install boots straight into Overdrive. */
function freshOverdrive() {
  const scene = defaultScene();
  const casters = { ...scene, casters: scene.casters.map((c, i) => ({ ...c, enabled: i < 2 })) as typeof scene.casters };
  const show = defaultShow();
  const brand = { ...emptyBrand(), name: 'Overdrive Grand League', logo: '/brand/overdrive/logo.png', mark: '/brand/overdrive/mark.png', accent: '#ff3b1f', font: 'russo' as const, skin: 'overdrive' };
  Object.assign(show, {
    brand, tournament: 'OVERDRIVE GRAND LEAGUE', stage: '26S3 WILDCARD',
    socials: [{ platform: 'twitch', handle: 'twitch.tv/overdrive_tm' }, { platform: 'discord', handle: 'discord.gg/tZV3Mu3Thb' }, { platform: 'x', handle: '@OVERDRIVE_TM' }],
    ticker: { ...show.ticker, enabled: true, onScreens: true, items: ['2026 OverDrive Wildcard: top 4 qualify for the OverDrive Major', 'Live bracket & schedule: lavaaval.github.io/2026_overdrive_wildcard', 'Follow @OVERDRIVE_TM · twitch.tv/overdrive_tm', 'Join the community: discord.gg/tZV3Mu3Thb'] },
    bestOf: 5, showMatchupOnScreens: true,
    nextMatch: { ...show.nextMatch, enabled: true, corner: 'tr' },
    timer: { ...show.timer, label: 'STREAM STARTING IN' },
  });
  return { scene: casters, show, sheet: { ...emptySheet(), id: '1SgnXorS23IvBM2dbie_QOc756wnOTjqCvx3U2ensfi4', gid: '1222783107', enabled: true, title: 'WILDCARD' } };
}

function fresh(): Persisted {
  const od = freshOverdrive();
  return {
    preview: clone(od.scene),
    live: clone(od.scene),
    showPreview: clone(od.show),
    showLive: clone(od.show),
    apiToken: newKey(18),
    crewKey: newKey(12),
    ros: defaultRos(),
    players: [],
    league: { name: '', matches: 5, divisions: [] },
    playoffs: { d1Seeds: [], d2Seeds: [], results: {} },
    stories: [],
    follow: { enabled: true, delayMs: 300, keepLast: true },
    liveVersion: 1,
    liveAt: Date.now(),
    instant: false,
    presets: defaultPresets(od.scene),
    contributorKeys: { 1: newKey(), 2: newKey(), 3: newKey() },
    sessions: {},
    tournament: defaultTournament(),
    sheet: od.sheet,
    events: [{ id: 'overdrive', name: 'Overdrive Grand League', createdAt: Date.now() }],
    activeEvent: 'overdrive',
    eventData: {},
  };
}

export function sanitizeFollow(v: any): FollowSettings {
  return {
    enabled: v?.enabled !== false,
    delayMs: typeof v?.delayMs === 'number' ? Math.max(0, Math.min(3000, Math.round(v.delayMs))) : 300,
    keepLast: v?.keepLast !== false,
  };
}

/** No-op here: this standalone install has no legacy GLACIAL/Benelux saves to
 * migrate demo text out of. Kept as a passthrough so load() below doesn't need
 * to change shape. */
function migrateShow(s: Show): Show {
  return s;
}

function load(): Persisted {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const base = fresh();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return {
      ...base,
      ...raw,
      preview: sanitizeScene(raw.preview),
      live: sanitizeScene(raw.live),
      showPreview: migrateShow(sanitizeShow(raw.showPreview)),
      showLive: migrateShow(sanitizeShow(raw.showLive)),
      apiToken: typeof raw.apiToken === 'string' && raw.apiToken ? raw.apiToken : base.apiToken,
      crewKey: typeof raw.crewKey === 'string' && raw.crewKey ? raw.crewKey : base.crewKey,
      ros: raw.ros ? sanitizeRos(raw.ros) : base.ros,
      players: Array.isArray(raw.players) ? ensureStreamIds(sanitizePlayers(raw.players)) : base.players,
      follow: sanitizeFollow(raw.follow),
      league: sanitizeLeague(raw.league, base.league),
      playoffs: sanitizePlayoffs(raw.playoffs, base.playoffs),
      stories: Array.isArray(raw.stories) ? sanitizeStories(raw.stories) : base.stories,
      presets: Array.isArray(raw.presets)
        ? raw.presets.map((p: any) => ({ id: String(p.id), name: String(p.name).slice(0, 48), updatedAt: Number(p.updatedAt) || Date.now(), identity: p.identity === true, scene: sanitizeScene(p.scene) }))
        : base.presets,
      contributorKeys: { ...base.contributorKeys, ...(raw.contributorKeys ?? {}) },
      sheet: sanitizeSheet(raw.sheet),
      events: Array.isArray(raw.events) && raw.events.length ? raw.events.map((e: any) => ({ id: String(e.id).replace(/[^\w-]/g, '').slice(0, 40), name: String(e.name ?? 'Event').slice(0, 60), createdAt: Number(e.createdAt) || Date.now() })) : base.events,
      activeEvent: typeof raw.activeEvent === 'string' ? raw.activeEvent : base.activeEvent,
      eventData: raw.eventData && typeof raw.eventData === 'object' ? raw.eventData : {},
      sessions: Object.fromEntries(Object.entries(raw.sessions ?? {}).map(([k, v]: [string, any]) => [k, typeof v === 'number' ? { exp: v, role: 'producer' } : v])) as Persisted['sessions'],
      tournament: raw.tournament && raw.tournament.name !== 'GLACIAL CUP' ? sanitizeTournament(raw.tournament) : base.tournament,
    };
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      // Keep the corrupt file for inspection, then start clean rather than refusing to boot mid-show.
      const bad = FILE() + '.corrupt-' + Date.now();
      try { fs.renameSync(FILE(), bad); } catch {}
      console.error(`[store] could not read state (${e.message}); moved to ${bad}`);
    }
    return base;
  }
}

export const db: Persisted = load();

let timer: NodeJS.Timeout | null = null;

/** Atomic write (tmp + rename) so a crash mid-write never corrupts the live config. */
export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  const now = Date.now();
  for (const [t, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[t];
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE());
}

export function save() {
  if (!timer) timer = setTimeout(flush, 150);
}

flush();

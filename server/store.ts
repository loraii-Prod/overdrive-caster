import { emptyRundown, sanitizeRundown, type Rundown } from '../shared/rundown';
import { defaultObsSetup, sanitizeObsSetup, type ObsSetupStore } from '../shared/obsSetup';
import { sanitizeGraphics, type GfxInstance } from '../shared/gfx';
import { emptySeats, isPlaceholderName, sanitizeSeats, sanitizeTalent, type Seats, type TalentProfile } from '../shared/talent';
import { defaultMedia, sanitizeMedia, type MediaState } from '../shared/media';
import { sanitizeStudio, type Studio } from '../shared/registry';
import { sanitizeStage, type Stage, type TransitionKind } from '../shared/engine';
import { defaultGameFeed, sanitizeGameFeed, type GameFeedSettings } from '../shared/gamefeed';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { clone, defaultPresets, defaultRos, defaultScene, defaultShow, emptyBrand, sanitizeRos, sanitizeScene, sanitizeShow } from '../shared/defaults';
import type { CasterId, FollowSettings, Preset, RunOfShow, Scene, Show } from '../shared/types';
import { ensureStreamIds, sanitizePlayers, sanitizeStories, type Player, type Story } from '../shared/players';
import { defaultTournament, sanitizeTournament, type Tournament } from '../shared/tournament';
import { majorSheet, sanitizeSheet, type SheetState } from '../shared/sheet';
import { MAJOR_TICKER, WC_BRACKET, WILDCARD_SHEET_ID, defaultWildcard, sanitizeWildcard, type WildcardState } from '../shared/wildcard';
import { emptyTwitchStore, sanitizeTwitchStore, type TwitchStore } from './twitch';
import { emptyAudStore, sanitizeAudStore, type AudStore } from './audience';
import { onSaved } from './durable';
import { emptyAssets, sanitizeAssets, type AssetsStore } from './assets';

export interface Persisted {
  /** 2.0: 10 permanent talent profiles and who sits in which position. */
  talent: TalentProfile[];
  seats: Seats;
  /** 2.0: media playback source. */
  media: MediaState;
  /** 2.0: Studio Mode module layout per scene. */
  studio?: Studio;
  /** Graphics engine instances (packages from shared/gfx.ts). */
  graphics: GfxInstance[];
  /** Graphics rundown (items referencing instances + their data or preset). */
  rundown: Rundown;
  /** OBS Scene Builder: options + Overdrive output ↔ OBS scene/source mapping. */
  obsSetup: ObsSetupStore;
  /** Overdrive 2.0 engine: staged Preview (desk/booth) and default transition. */
  engine?: { stage?: Stage; touched?: boolean; transition?: TransitionKind };
  /** Transition of the TAKE being broadcast (not meaningful at rest). */
  liveTransition?: TransitionKind;
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
  /** Settings version: 2 = every scoreboard starts off (one-time reset of older saves). */
  ui?: number;
  /** OverDrive Wildcard bracket of the active event. */
  wildcard: WildcardState;
  /** Twitch connection (global, tokens never leave the server). */
  twitch: TwitchStore;
  /** Audience interaction (Pick'ems + Community MVP): producer-side state; votes live in the vote service. */
  audience: AudStore;
  /** Asset registry (portraits, logos, media, music): durable copies live in the storage bucket. */
  assets: AssetsStore;
  /** Game feed for casters (stream server WHEP + caster login). */
  gameFeed: GameFeedSettings;
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
/** Personal VDO.Ninja stream id (letters/digits only, hard to guess). */
export const newVdoId = () => 'od' + crypto.randomBytes(9).toString('hex');

const FILE = () => path.join(config.dataDir, 'state.json');

/** This is a standalone, single-purpose install: Overdrive Racing League is the
 * one and only production. Nothing from another league ships in its data,
 * ships in its data — a fresh install boots straight into Overdrive. */
function freshOverdrive() {
  const scene = defaultScene();
  const casters = { ...scene, casters: scene.casters.map((c, i) => ({ ...c, enabled: i < 2 })) as typeof scene.casters };
  const show = defaultShow();
  const brand = { ...emptyBrand(), name: 'Overdrive Grand League', logo: '/brand/overdrive/logo.png', mark: '/brand/overdrive/mark.png', accent: '#ff3b1f', font: 'russo' as const, skin: 'overdrive' };
  Object.assign(show, {
    brand, tournament: 'OVERDRIVE GRAND LEAGUE', stage: '26S3 MAJOR',
    socials: [{ platform: 'twitch', handle: 'twitch.tv/overdrive_tm' }, { platform: 'discord', handle: 'discord.gg/tZV3Mu3Thb' }, { platform: 'x', handle: '@OVERDRIVE_TM' }],
    ticker: { ...show.ticker, enabled: true, onScreens: true, items: [...MAJOR_TICKER] },
    bestOf: 5, showMatchupOnScreens: false, showMatchupOnCasters: false, showScoreboard: false,
    nextMatch: { ...show.nextMatch, enabled: true, corner: 'tr' },
    timer: { ...show.timer, label: 'STREAM STARTING IN' },
  });
  return { scene: casters, show, sheet: majorSheet() };
}

function fresh(): Persisted {
  const od = freshOverdrive();
  return { ui: 3, talent: sanitizeTalent([], () => newKey(), newVdoId), seats: emptySeats(), media: defaultMedia(), graphics: sanitizeGraphics([]), rundown: emptyRundown(), obsSetup: defaultObsSetup(),
    preview: clone(od.scene),
    live: clone(od.scene),
    showPreview: clone(od.show),
    showLive: clone(od.show),
    apiToken: newKey(18),
    crewKey: newKey(12),
    ros: defaultRos(),
    players: [],
    stories: [],
    follow: { enabled: true, delayMs: 300, keepLast: true },
    liveVersion: 1,
    liveAt: Date.now(),
    instant: false, // 2.0: preparing never airs by itself; Instant is an explicit producer choice
    presets: defaultPresets(od.scene),
    contributorKeys: { 1: newKey(), 2: newKey(), 3: newKey(), 4: newKey(), 5: newKey(), 6: newKey() },
    sessions: {},
    tournament: defaultTournament(),
    sheet: od.sheet,
    wildcard: defaultWildcard(true),
    twitch: emptyTwitchStore(),
    audience: emptyAudStore(),
    assets: emptyAssets(),
    gameFeed: defaultGameFeed(),
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

/** No-op here: this standalone install has no legacy saves from other leagues to
 * migrate demo text out of. Kept as a passthrough so load() below doesn't need
 * to change shape. */
function migrateShow(s: Show): Show {
  return s;
}

/** One-time switch from the Wildcard to the Major: stage name, ticker lines and the casters' match strip (off until needed). */
function toMajor(s: Show): Show {
  if (/wild ?card/i.test(s.stage)) s.stage = s.stage.replace(/wild ?card/i, 'MAJOR');
  const kept = s.ticker.items.filter(t => !/wild ?card/i.test(t) && !MAJOR_TICKER.includes(t));
  if (kept.length !== s.ticker.items.length) s.ticker.items = [...MAJOR_TICKER.slice(0, 2), ...kept];
  s.showMatchupOnCasters = false;
  return s;
}

function load(): Persisted {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const base = fresh();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    const major = raw.wildcard?.bracket !== WC_BRACKET; // first start after the switch to the Major
    const scoresOff = (raw.ui ?? 0) < 2; // first start after "scoreboards off by default"
    const off = (s: Show) => { if (scoresOff) { s.showScoreboard = false; s.showMatchupOnScreens = false; s.showMatchupOnCasters = false; s.nextMatch = { ...s.nextMatch, enabled: false }; } return s; };
    const mig = (s: Show) => off(major ? toMajor(migrateShow(s)) : migrateShow(s));
    const sheet = sanitizeSheet(raw.sheet);
    return {
      ...base,
      ...raw,
      preview: sanitizeScene(raw.preview),
      live: sanitizeScene(raw.live),
      showPreview: mig(sanitizeShow(raw.showPreview)),
      showLive: mig(sanitizeShow(raw.showLive)),
      ui: 3,
      // Overdrive 2.0 engine: staged Preview survives restarts (validated); a transition is never "in flight" at boot.
      engine: raw.engine && typeof raw.engine === 'object' ? {
        stage: raw.engine.stage ? sanitizeStage(raw.engine.stage, { booth: [], desk: { slots: [], guest: null, panel: 'cams', strip: false, clock: false } }) : undefined,
        touched: raw.engine.touched === true,
        transition: ['stinger', 'fade', 'cut'].includes(raw.engine.transition) ? raw.engine.transition : 'stinger',
      } : undefined,
      liveTransition: undefined,
      ...seedTalent(raw),
      media: sanitizeMedia(raw.media),
      studio: sanitizeStudio(raw.studio),
      graphics: sanitizeGraphics(raw.graphics),
      rundown: sanitizeRundown(raw.rundown),
      obsSetup: sanitizeObsSetup(raw.obsSetup),
      instant: !!raw.instant,
      apiToken: typeof raw.apiToken === 'string' && raw.apiToken ? raw.apiToken : base.apiToken,
      crewKey: typeof raw.crewKey === 'string' && raw.crewKey ? raw.crewKey : base.crewKey,
      ros: raw.ros ? sanitizeRos(raw.ros) : base.ros,
      players: Array.isArray(raw.players) ? ensureStreamIds(sanitizePlayers(raw.players)) : base.players,
      follow: sanitizeFollow(raw.follow),
      stories: Array.isArray(raw.stories) ? sanitizeStories(raw.stories) : base.stories,
      presets: Array.isArray(raw.presets)
        ? raw.presets.map((p: any) => ({ id: String(p.id), name: String(p.name).slice(0, 48), updatedAt: Number(p.updatedAt) || Date.now(), identity: p.identity === true, scene: sanitizeScene(p.scene) }))
        : base.presets,
      contributorKeys: { ...base.contributorKeys, ...(raw.contributorKeys ?? {}) },
      // The Wildcard's results sheet would write its scores into the Major bracket: swap in the season sheet (off).
      sheet: sheet.id === WILDCARD_SHEET_ID ? majorSheet() : sheet,
      // This install is Overdrive's: an upgraded state.json gets the wildcard switched on.
      wildcard: sanitizeWildcard(raw.wildcard, true),
      twitch: sanitizeTwitchStore(raw.twitch),
      audience: sanitizeAudStore(raw.audience),
      assets: sanitizeAssets(raw.assets),
      gameFeed: sanitizeGameFeed(raw.gameFeed),
      events: Array.isArray(raw.events) && raw.events.length ? raw.events.map((e: any) => ({ id: String(e.id).replace(/[^\w-]/g, '').slice(0, 40), name: String(e.name ?? 'Event').slice(0, 60), createdAt: Number(e.createdAt) || Date.now() })) : base.events,
      activeEvent: typeof raw.activeEvent === 'string' ? raw.activeEvent : base.activeEvent,
      eventData: raw.eventData && typeof raw.eventData === 'object' ? raw.eventData : {},
      sessions: Object.fromEntries(Object.entries(raw.sessions ?? {}).map(([k, v]: [string, any]) => [k, typeof v === 'number' ? { exp: v, role: 'producer' } : v])) as Persisted['sessions'],
      tournament: raw.tournament && raw.tournament.name !== defaultTournament().name ? sanitizeTournament(raw.tournament) : base.tournament,
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
let frozen = false;
/** Stop writing (a restored state is about to be loaded by a restart: the old in-memory one must not overwrite it). */
export function freeze() { frozen = true; if (timer) { clearTimeout(timer); timer = null; } }

/** Atomic write (tmp + rename) so a crash mid-write never corrupts the live config. */
export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (frozen) return;
  const now = Date.now();
  for (const [t, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[t];
  const tmp = FILE() + '.tmp', json = JSON.stringify(db, null, 2);
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, FILE());
  onSaved(json); // durable copy (database mirror / snapshots), never blocks the local save
}

export function save() {
  if (!timer) timer = setTimeout(flush, 150);
}

flush();

/**
 * 2.0 talent: keep saved profiles; on the first 2.0 start, take the real names already in this show's camera
 * slots (never invent names) and seat each person where they were. Unknown names stay empty ("name needed").
 */
function seedTalent(raw: any): { talent: TalentProfile[]; seats: Seats } {
  if (Array.isArray(raw.talent)) { const talent = sanitizeTalent(raw.talent, () => newKey(), newVdoId); return { talent, seats: sanitizeSeats(raw.seats, talent) }; }
  const talent = sanitizeTalent([], () => newKey(), newVdoId), seats = emptySeats();
  const casters: any[] = Array.isArray(raw.live?.casters) ? raw.live.casters : [];
  let i = 0;
  for (const c of casters) {
    const slot = Number(c?.id);
    if (!(slot >= 1 && slot <= 5) || typeof c.name !== 'string' || isPlaceholderName(c.name) || i >= talent.length) continue;
    talent[i] = { ...talent[i], name: c.name.slice(0, 40), role: slot >= 4 ? 'analyst' : 'caster' };
    seats[slot as 1 | 2 | 3 | 4 | 5] = talent[i].id;
    i++;
  }
  return { talent, seats };
}

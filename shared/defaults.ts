import { DEFAULT_LEVELS, MUSIC_SECTIONS } from './music';
import type { Caster, CasterId, LayoutMode, Preset, RosItem, RunOfShow, Scene, ScreenId, Show, Social, SocialPlatform, SourceType, Team } from './types';

export const ROLE_SUGGESTIONS = ['HOST', 'PLAY-BY-PLAY', 'ANALYST', 'COLOR', 'GUEST', 'INTERVIEWER'];

export function defaultCaster(id: CasterId): Caster {
  return {
    id,
    enabled: true,
    name: `Caster ${id}`,
    role: id === 1 ? 'PLAY-BY-PLAY' : id === 2 ? 'ANALYST' : 'HOST',
    cameraOn: true,
    showName: true,
    offMode: 'card',
    source: { type: 'webrtc', url: '', obsScene: '', obsSource: '', vdo: '' },
  };
}

export function defaultScene(): Scene {
  return {
    layout: 'auto',
    casters: [defaultCaster(1), defaultCaster(2), defaultCaster(3)],
    showBranding: true,
    showNames: true,
    showBackground: false,
    screen: 'casters',
  };
}

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  x: 'X', twitch: 'TWITCH', youtube: 'YOUTUBE', discord: 'DISCORD', instagram: 'INSTAGRAM', tiktok: 'TIKTOK', kick: 'KICK', web: 'WEB',
};

export const SCREEN_LABELS: Record<ScreenId, string> = {
  casters: 'Casters', warmup: 'Warm-up', gameplay: 'Gameplay', starting: 'Starting soon', brb: 'Be right back', ending: 'Thanks for watching', bracket: 'Bracket', matches: 'Matches',
};

export function defaultShow(): Show {
  return {
    tournament: 'OVERDRIVE LEAGUE',
    stage: 'SEASON 1',
    teamA: { name: 'Team Alpha', tag: 'ALP', logo: '', score: 0 },
    teamB: { name: 'Team Bravo', tag: 'BRV', logo: '', score: 0 },
    bestOf: 5,
    game: 1,
    mapName: '',
    showScoreboard: true,
    showMatchupOnCasters: true,
    showMatchupOnScreens: true,
    timer: { target: null, label: 'BROADCAST STARTS IN', endText: 'STARTING NOW', showOn: { starting: true, brb: true, ending: false } },
    screens: {
      starting: { title: 'STARTING SOON', subtitle: 'The broadcast will begin shortly' },
      brb: { title: 'BE RIGHT BACK', subtitle: 'Short break — stay tuned' },
      ending: { title: 'THANKS FOR WATCHING', subtitle: 'See you at the next broadcast' },
    },
    schedule: BNL_SCHEDULE(),
    socials: BNL_SOCIALS(),
    sponsors: [],
    sponsorSeconds: 8,
    ticker: { enabled: true, items: BNL_TICKER(), speed: 90, onScreens: true },
    obsScenes: { casters: '', warmup: '', gameplay: '', starting: '', brb: '', ending: '', bracket: '', matches: '' },
    prize: defaultPrize(),
    brand: emptyBrand(),
    music: { enabled: true, volume: 0.6, levels: { ...DEFAULT_LEVELS }, skip: 0, fadeMs: 2500 },
    nextMatch: { enabled: false, corner: 'tr', label: '', time: '' },
    badge: { kind: 'none', at: 0 },
    gameplay: { cams: false, corner: 'right', ticker: false },
    theme: 'bnl',
    spotlight: null,
    activePlayer: null,
    playerCam: { enabled: true, corner: 'right', size: 'md', mode: 'single' },
    vdo: { password: '', params: '&cleanoutput&noaudio&cover' },
    lineup: [],
    scheduleFromBracket: false,
  };
}

/** Build a preset scene on top of an existing one, keeping names/sources. */
function variant(base: Scene, layout: LayoutMode, on: [boolean, boolean, boolean], cams: [boolean, boolean, boolean], extra?: Partial<Scene>): Scene {
  const s = clone(base);
  s.layout = layout;
  s.casters.forEach((c, i) => { c.enabled = on[i]; c.cameraOn = cams[i]; });
  return { ...s, ...extra };
}

export function defaultPresets(base: Scene = defaultScene()): Preset[] {
  const t = Date.now();
  const p = (id: string, name: string, scene: Scene): Preset => ({ id, name, scene, updatedAt: t });
  const interview = variant(base, 'duo', [true, true, false], [true, true, false]);
  return [
    p('pre-show', 'Pre-show', variant(base, 'trio', [true, true, true], [true, true, true], { showBackground: true })),
    p('match', 'Match commentary', variant(base, 'duo', [true, true, false], [true, true, false])),
    p('analysis', 'Analysis desk', variant(base, 'trio', [true, true, true], [true, true, true])),
    p('interview', 'Interview', interview),
    p('audio', 'Audio-only', variant(base, 'audio', [true, true, true], [false, false, false])),
    p('post-match', 'Post-match', variant(base, 'solo', [true, false, false], [true, false, false])),
  ];
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function sameScene(a: Scene, b: Scene): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------- validation (server trusts nothing from the wire) ----------

const SCREENS: ScreenId[] = ['starting', 'casters', 'warmup', 'gameplay', 'brb', 'bracket', 'matches', 'ending'];
const PLATFORMS = Object.keys(SOCIAL_LABELS) as SocialPlatform[];
const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : d);

const LAYOUTS: LayoutMode[] = ['auto', 'solo', 'duo', 'trio', 'mixed', 'audio'];
const SOURCES: SourceType[] = ['none', 'webrtc', 'vdo', 'url', 'obs'];

const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

function safeUrl(v: unknown): string {
  const s = str(v, 2000).trim();
  if (!s) return '';
  try {
    const u = new URL(s, 'http://local/');
    return ['http:', 'https:'].includes(u.protocol) || s.startsWith('/') ? s : '';
  } catch {
    return '';
  }
}

export function sanitizeCaster(v: any, id: CasterId): Caster {
  const d = defaultCaster(id);
  if (!v || typeof v !== 'object') return d;
  const src = v.source && typeof v.source === 'object' ? v.source : {};
  return {
    id,
    enabled: bool(v.enabled, d.enabled),
    name: str(v.name, 48, d.name),
    role: str(v.role, 32, d.role),
    cameraOn: bool(v.cameraOn, d.cameraOn),
    showName: bool(v.showName, d.showName),
    offMode: v.offMode === 'remove' ? 'remove' : 'card',
    source: {
      type: SOURCES.includes(src.type) ? src.type : d.source.type,
      url: safeUrl(src.url),
      obsScene: str(src.obsScene, 128),
      obsSource: str(src.obsSource, 128),
      vdo: typeof src.vdo === 'string' ? src.vdo.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) : '',
    },
  };
}

export function sanitizeScene(v: any): Scene {
  const d = defaultScene();
  if (!v || typeof v !== 'object') return d;
  const cs = Array.isArray(v.casters) ? v.casters : [];
  return {
    layout: LAYOUTS.includes(v.layout) ? v.layout : d.layout,
    casters: [sanitizeCaster(cs[0], 1), sanitizeCaster(cs[1], 2), sanitizeCaster(cs[2], 3)],
    showBranding: bool(v.showBranding, d.showBranding),
    showNames: bool(v.showNames, d.showNames),
    showBackground: bool(v.showBackground, d.showBackground),
    screen: SCREENS.includes(v.screen) ? v.screen : d.screen,
  };
}

function sanitizeTeam(v: any, d: Team): Team {
  if (!v || typeof v !== 'object') return d;
  return { name: str(v.name, 40, d.name), tag: str(v.tag, 6, d.tag), logo: safeUrl(v.logo), score: int(v.score, 0, 99, 0) };
}

function sanitizeSpotlight(v: any): Show['spotlight'] {
  if (!v || typeof v !== 'object' || (v.kind !== 'player' && v.kind !== 'story')) return null;
  const data: Record<string, string> = {};
  for (const [k, x] of Object.entries(v.data ?? {}).slice(0, 20)) if (typeof x === 'string') data[k.slice(0, 20)] = x.slice(0, 300);
  return { kind: v.kind, id: str(v.id, 60), until: typeof v.until === 'number' ? v.until : null, at: Number(v.at) || Date.now(), data };
}

export function sanitizeShow(v: any): Show {
  const d = defaultShow();
  if (!v || typeof v !== 'object') return d;
  const t = v.timer ?? {};
  const sc = v.screens ?? {};
  const text = (x: any, dd: { title: string; subtitle: string }) => ({ title: str(x?.title, 60, dd.title), subtitle: str(x?.subtitle, 120, dd.subtitle) });
  const so = t.showOn ?? {};
  return {
    tournament: str(v.tournament, 60, d.tournament),
    stage: str(v.stage, 60, d.stage),
    teamA: sanitizeTeam(v.teamA, d.teamA),
    teamB: sanitizeTeam(v.teamB, d.teamB),
    bestOf: int(v.bestOf, 1, 9, d.bestOf),
    game: int(v.game, 1, 9, d.game),
    mapName: str(v.mapName, 40),
    showScoreboard: bool(v.showScoreboard, d.showScoreboard),
    showMatchupOnCasters: bool(v.showMatchupOnCasters, d.showMatchupOnCasters),
    showMatchupOnScreens: bool(v.showMatchupOnScreens, d.showMatchupOnScreens),
    timer: {
      target: typeof t.target === 'number' && Number.isFinite(t.target) ? t.target : null,
      label: str(t.label, 40, d.timer.label),
      endText: str(t.endText, 40, d.timer.endText),
      showOn: { starting: bool(so.starting, true), brb: bool(so.brb, true), ending: bool(so.ending, false) },
    },
    screens: { starting: text(sc.starting, d.screens.starting), brb: text(sc.brb, d.screens.brb), ending: text(sc.ending, d.screens.ending) },
    schedule: (Array.isArray(v.schedule) ? v.schedule : d.schedule).slice(0, 6).map((x: any) => ({ time: str(x?.time, 12), label: str(x?.label, 48) })),
    socials: (Array.isArray(v.socials) ? v.socials : d.socials).slice(0, 6)
      .filter((x: any) => PLATFORMS.includes(x?.platform))
      .map((x: any): Social => ({ platform: x.platform, handle: str(x.handle, 48) })),
    sponsors: (Array.isArray(v.sponsors) ? v.sponsors : []).slice(0, 12).map(safeUrl).filter(Boolean),
    sponsorSeconds: int(v.sponsorSeconds, 3, 60, d.sponsorSeconds),
    ticker: {
      enabled: bool(v.ticker?.enabled, d.ticker.enabled),
      items: (Array.isArray(v.ticker?.items) ? v.ticker.items : d.ticker.items).slice(0, 12).map((x: any) => str(x, 160)).filter(Boolean),
      speed: int(v.ticker?.speed, 30, 300, d.ticker.speed),
      onScreens: bool(v.ticker?.onScreens, d.ticker.onScreens),
    },
    scheduleFromBracket: bool(v.scheduleFromBracket, d.scheduleFromBracket),
    prize: sanitizePrize(v.prize),
    brand: sanitizeBrand(v.brand),
    music: {
      enabled: bool(v.music?.enabled, true),
      volume: num01(v.music?.volume, 0.6),
      levels: Object.fromEntries(MUSIC_SECTIONS.map(s => [s, num01(v.music?.levels?.[s], DEFAULT_LEVELS[s])])) as Show['music']['levels'],
      skip: Number.isFinite(v.music?.skip) ? Number(v.music.skip) : 0,
      fadeMs: Math.max(0, Math.min(10000, Number(v.music?.fadeMs) || 2500)),
    },
    nextMatch: {
      enabled: bool(v.nextMatch?.enabled, false),
      corner: ['tl', 'tr', 'bl', 'br'].includes(v.nextMatch?.corner) ? v.nextMatch.corner : 'tr',
      label: str(v.nextMatch?.label, 60),
      time: /^\d{1,2}:\d{2}$/.test(String(v.nextMatch?.time ?? '')) ? String(v.nextMatch.time) : '',
    },
    theme: v.theme === 'glacial' ? 'glacial' : 'bnl',
    spotlight: sanitizeSpotlight(v.spotlight),
    activePlayer: v.activePlayer && typeof v.activePlayer.id === 'string'
      ? { id: str(v.activePlayer.id, 60), name: str(v.activePlayer.name, 60), tag: str(v.activePlayer.tag, 40), vdo: str(v.activePlayer.vdo, 60), at: Number(v.activePlayer.at) || Date.now(), via: v.activePlayer.via === 'game' ? 'game' : 'manual' }
      : null,
    playerCam: {
      enabled: bool(v.playerCam?.enabled, d.playerCam.enabled),
      corner: v.playerCam?.corner === 'left' ? 'left' : 'right',
      size: ['sm', 'md', 'lg'].includes(v.playerCam?.size) ? v.playerCam.size : d.playerCam.size,
      mode: v.playerCam?.mode === 'strip' ? 'strip' : 'single',
    },
    vdo: { password: str(v.vdo?.password, 60), params: typeof v.vdo?.params === 'string' ? v.vdo.params.slice(0, 300) : d.vdo.params },
    lineup: Array.isArray(v.lineup) ? v.lineup.filter((x: any) => x && typeof x.id === 'string').slice(0, 32).map((x: any) => ({ id: str(x.id, 60), vdo: str(x.vdo, 60) })) : [],
    badge: { kind: ['replay', 'highlights'].includes(v.badge?.kind) ? v.badge.kind : 'none', at: Number(v.badge?.at) || 0 },
    gameplay: {
      cams: bool(v.gameplay?.cams, d.gameplay.cams),
      corner: v.gameplay?.corner === 'left' ? 'left' : 'right',
      ticker: bool(v.gameplay?.ticker, d.gameplay.ticker),
    },
    obsScenes: Object.fromEntries(SCREENS.map(s => [s, str(v.obsScenes?.[s], 128)])) as Show['obsScenes'],
  };
}

// ---------- run of show ----------

export const ROS_MESSAGES = ['Stand by', '30 seconds', 'Wrap up', 'Stretch', 'Throw to break', 'Throw to gameplay', "You're live", 'Check your mic'];

export function defaultRos(): RunOfShow {
  const it = (id: string, time: string, title: string, minutes: number, who = '', notes = ''): RosItem => ({ id, time, title, minutes, who, notes });
  return {
    items: [
      it('r1', '18:00', 'Starting soon', 10, '', 'Countdown on screen'),
      it('r2', '18:10', 'Pre-show: welcome & predictions', 15, 'All casters'),
      it('r3', '18:25', 'Match 1: Game 1', 0, 'Play-by-play + analyst'),
      it('r4', '', 'Break', 5, '', 'BRB screen'),
      it('r5', '', 'Match 1: Game 2', 0, 'Play-by-play + analyst'),
      it('r6', '', 'Post-match & interview', 10, 'Host + guest'),
      it('r7', '', 'Thanks for watching', 2),
    ],
    current: null,
    startedAt: null,
    message: null,
  };
}

export function sanitizeRos(v: any): RunOfShow {
  const d = defaultRos();
  if (!v || typeof v !== 'object') return d;
  const items: RosItem[] = (Array.isArray(v.items) ? v.items : d.items).slice(0, 60).map((x: any, i: number) => ({
    id: str(x?.id, 40) || `r${Date.now().toString(36)}${i}`,
    time: str(x?.time, 16),
    title: str(x?.title, 80),
    minutes: int(x?.minutes, 0, 600, 0),
    who: str(x?.who, 80),
    notes: str(x?.notes, 300),
  }));
  const cur = typeof v.current === 'number' && v.current >= 0 && v.current < items.length ? Math.round(v.current) : null;
  const m = v.message && typeof v.message.text === 'string' && v.message.text ? { text: str(v.message.text, 140), at: Number(v.message.at) || Date.now() } : null;
  return { items, current: cur, startedAt: cur == null ? null : Number(v.startedAt) || Date.now(), message: m };
}

// ---------- prizepool ----------
export function defaultPrize(): Show['prize'] {
  return {
    enabled: false, raised: 0, currency: '€', link: '',
    splits: [
      { place: '1st', pct: 40 }, { place: '2nd', pct: 25 }, { place: '3rd', pct: 15 }, { place: '4th', pct: 10 },
      { place: '5th–8th', pct: 2.5 },
    ],
    goals: [],
  };
}

function sanitizePrize(v: any): Show['prize'] {
  const d = defaultPrize();
  if (!v || typeof v !== 'object') return d;
  const n = (x: unknown, dd = 0) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1e7, x)) : dd);
  return {
    enabled: v.enabled !== false,
    raised: n(v.raised),
    currency: str(v.currency, 4) || '€',
    link: str(v.link, 120),
    splits: Array.isArray(v.splits) ? v.splits.slice(0, 12).map((x: any) => ({ place: str(x?.place, 20), pct: n(x?.pct) })) : d.splits,
    goals: Array.isArray(v.goals) ? v.goals.slice(0, 12).map((x: any) => ({ amount: n(x?.amount), label: str(x?.label, 80) })) : d.goals,
  };
}

// ---------- default placeholder info ----------
export const BNL_SOCIALS = (): Social[] => [];
export const BNL_TICKER = (): string[] => [
  'Welcome to the Overdrive Circuit',
];
export const BNL_SCHEDULE = () => [];

export const emptyBrand = (): import('./types').BrandKit => ({ name: '', logo: '', mark: '', accent: '', font: '', bg: '', bgKind: '', skin: '', desk: false });
const assetUrl = (v: unknown) => (typeof v === 'string' && /^(\/uploads\/[\w.-]+|\/brand\/[\w./-]+|https:\/\/[^\s"'<>]+)$/.test(v) ? v.slice(0, 500) : '');
export function sanitizeBrand(v: any): import('./types').BrandKit {
  const b = v ?? {};
  return {
    name: str(b.name, 60),
    logo: assetUrl(b.logo),
    mark: assetUrl(b.mark),
    accent: typeof b.accent === 'string' && /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : '',
    font: ['bebas', 'barlow', 'sora', 'inter', 'russo', 'montserrat'].includes(b.font) ? b.font : '',
    bg: assetUrl(b.bg),
    bgKind: b.bgKind === 'video' || b.bgKind === 'image' ? b.bgKind : '',
    skin: typeof b.skin === 'string' && /^[a-z0-9-]{0,40}$/.test(b.skin) ? b.skin : '',
    desk: b.desk === true,
  };
}

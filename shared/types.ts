// Shared model used by the server, the controller and every OBS output.

export type CasterId = 1 | 2 | 3;
export const CASTER_IDS: CasterId[] = [1, 2, 3];

export type SourceType = 'none' | 'webrtc' | 'vdo' | 'url' | 'obs';

export interface CameraSource {
  type: SourceType;
  /** Browser-playable video URL (mp4/webm/HLS-in-Safari). Test/fallback use. */
  url: string;
  /** OBS scene that contains the camera source (OBS WebSocket module). */
  obsScene: string;
  /** OBS input/source name of the camera inside obsScene. */
  obsSource: string;
  /** VDO.Ninja stream ID (type 'vdo'). */
  vdo: string;
}

/** What happens to a caster whose camera is OFF. */
export type CameraOffMode = 'card' | 'remove';

export interface Caster {
  id: CasterId;
  enabled: boolean;
  name: string;
  role: string;
  cameraOn: boolean;
  showName: boolean;
  offMode: CameraOffMode;
  source: CameraSource;
}

export type LayoutMode = 'auto' | 'solo' | 'duo' | 'trio' | 'mixed' | 'audio';

/** Full-screen scene shown on /output/program. */
export type ScreenId = 'starting' | 'casters' | 'warmup' | 'gameplay' | 'brb' | 'bracket' | 'matches' | 'ending';
export const SCREEN_IDS: ScreenId[] = ['starting', 'casters', 'warmup', 'gameplay', 'brb', 'bracket', 'matches', 'ending'];

// 'bnl' is a legacy internal id for the boxed/ticker layout (vs. 'glacial' for
// the original pattern-background look) — purely a layout bucket now. Any
// event with its own video skin and brand kit (which Overdrive always has)
// renders through Skin.tsx and never touches this layout at all.
export type ThemeId = 'glacial' | 'bnl';
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'bnl', label: 'Boxed / ticker' },
  { id: 'glacial', label: 'Classic' },
];

/** Player spotlight / story card currently on screen (resolved data, so outputs need no database). */
export interface SpotlightState {
  kind: 'player' | 'story';
  id: string;
  until: number | null;
  at: number;
  data: Record<string, string>;
}

export interface Team {
  name: string;
  tag: string;
  /** Image URL (uploaded via the controller or external). */
  logo: string;
  score: number;
}

export interface ScreenText { title: string; subtitle: string }

export type SocialPlatform = 'x' | 'twitch' | 'youtube' | 'discord' | 'instagram' | 'tiktok' | 'kick' | 'web';

export interface Social { platform: SocialPlatform; handle: string }

export type BrandFont = '' | 'bebas' | 'barlow' | 'sora' | 'inter' | 'russo' | 'montserrat';
export interface BrandKit {
  /** Event name used in the logo lock-up when no logo image is set. */
  name: string;
  /** Full logo (wide) and mark (square-ish icon) image URLs. */
  logo: string;
  mark: string;
  /** Accent colour (live badges, highlights). */
  accent: string;
  font: BrandFont;
  /** Background behind every screen: an uploaded video or image. */
  bg: string;
  bgKind: '' | 'video' | 'image';
  /** Animated graphics package (see shared/skins.ts), '' = none. */
  skin: string;
  /** Skin caster frames: casters booth or analyst desk look. */
  desk: boolean;
}

export interface ScheduleItem { time: string; label: string }

/** Broadcast data shared by every graphic (match, timer, ticker…). */
export interface Show {
  tournament: string;
  stage: string;
  teamA: Team;
  teamB: Team;
  bestOf: number;
  /** Current game/map number (1-based). */
  game: number;
  /** Optional map / mode label, e.g. "Ascent" or "Search & Destroy". */
  mapName: string;
  showScoreboard: boolean;
  showMatchupOnCasters: boolean;
  showMatchupOnScreens: boolean;
  timer: {
    /** Epoch ms the countdown ends, or null when stopped. */
    target: number | null;
    label: string;
    endText: string;
    showOn: { starting: boolean; brb: boolean; ending: boolean };
  };
  screens: Record<'starting' | 'brb' | 'ending', ScreenText>;
  schedule: ScheduleItem[];
  socials: Social[];
  sponsors: string[];
  sponsorSeconds: number;
  ticker: { enabled: boolean; items: string[]; speed: number; onScreens: boolean };
  /** Optional OBS scene to switch to when a screen goes live. */
  obsScenes: Record<ScreenId, string>;
  theme: ThemeId;
  spotlight: SpotlightState | null;
  /** Player whose camera is shown (follows the in-game spectator target). Instant. */
  activePlayer: { id: string; name: string; tag: string; vdo: string; at: number; via: 'game' | 'manual' } | null;
  /** "Next match" countdown: auto from playoff times / schedule, or a manual override. */
  nextMatch: { enabled: boolean; corner: 'tl' | 'tr' | 'bl' | 'br'; label: string; time: string };
  /** Event brand kit: overrides the base look (theme). Empty fields keep the theme's own asset. */
  brand: BrandKit;
  /** Built-in music beds per section (played by /output/music). */
  music: { enabled: boolean; volume: number; levels: Record<import('./music').MusicSection, number>; skip: number; fadeMs: number };
  playerCam: { enabled: boolean; corner: 'left' | 'right'; size: 'sm' | 'md' | 'lg'; /** Gameplay: one spectated cam, or a strip with every lobby cam. */ mode: 'single' | 'strip' };
  /** Prizepool + donation goals (Matcherino). */
  prize: { enabled: boolean; raised: number; currency: string; link: string; splits: { place: string; pct: number }[]; goals: { amount: number; label: string }[] };
  /** VDO.Ninja settings for player cams. */
  vdo: { password: string; params: string };
  /** Player ids in the current match: their cams are preloaded for instant switching. */
  lineup: { id: string; vdo: string }[];
  /** Gameplay screen: transparent over the game capture. */
  /** Gameplay overlay badge (skin replay / highlights packages). */
  badge: { kind: 'none' | 'replay' | 'highlights'; at: number };
  gameplay: { cams: boolean; corner: 'left' | 'right'; ticker: boolean };
  /** Starting Soon shows the bracket's upcoming matches instead of the manual schedule. */
  scheduleFromBracket: boolean;
}

export interface Scene {
  layout: LayoutMode;
  casters: [Caster, Caster, Caster];
  showBranding: boolean;
  /** Master nameplate switch (AND-ed with each caster's showName). */
  showNames: boolean;
  /** Animated Glacial background behind the camera layout. Audio mode always shows it. */
  showBackground: boolean;
  /** Which full-screen scene /output/program shows. */
  screen: ScreenId;
}

/** Run of show (rundown) shared with casters and crew. */
export interface RosItem {
  id: string;
  /** Planned start, free text ("18:30"). */
  time: string;
  title: string;
  /** Planned length in minutes (0 = open-ended). */
  minutes: number;
  /** Who's on, e.g. "Frosty + Nordic". */
  who: string;
  notes: string;
}

export interface RunOfShow {
  items: RosItem[];
  current: number | null;
  /** When the current segment was started (server clock). */
  startedAt: number | null;
  /** Producer → casters message. */
  message: { text: string; at: number } | null;
}

export interface FollowSettings {
  /** Switch the player cam when the game's spectator target changes. */
  enabled: boolean;
  /** Wait this long for the target to settle (avoids flicker while cycling). */
  delayMs: number;
  /** Keep the last cam when the game isn't spectating anyone (free cam, menus). */
  keepLast: boolean;
}

export interface Preset {
  id: string;
  name: string;
  scene: Scene;
  updatedAt: number;
  /** If true, recalling also restores names, roles and camera sources. */
  identity?: boolean;
}

export interface ContributorStatus {
  online: boolean;
  publishing: boolean;
  hasAudio: boolean;
  viewers: number;
  label?: string;
}

export interface ObsStatus {
  enabled: boolean;
  connected: boolean;
  error?: string;
  /** WebSocket URL in use (the password is never sent to browsers). */
  url?: string;
  hasPassword?: boolean;
  /** Last "Build scenes in OBS" report. */
  build?: { at: number; ok: boolean; lines: string[] };
  scenes: string[];
  currentScene?: string;
}

/** Everything a controller sees. Never sent to output clients. */
export interface ControllerState {
  preview: Scene;
  live: Scene;
  showPreview: Show;
  showLive: Show;
  liveVersion: number;
  liveAt: number;
  instant: boolean;
  presets: Preset[];
  contributorKeys: Record<CasterId, string>;
  contributors: Record<CasterId, ContributorStatus>;
  outputs: { route: string; count: number }[];
  obs: ObsStatus;
  /** Appended to output URLs when the server requires one. */
  outputKey: string;
  /** Productions: the active one is on air. */
  events: { id: string; name: string; createdAt: number }[];
  activeEvent: string;
  /** Token for the HTTP control API (Stream Deck / Companion). */
  apiToken: string;
  players: import('./players').Player[];
  follow: FollowSettings;
  lastGame: { name: string; login: string; at: number; matched: string | null } | null;
  stories: import('./players').Story[];
  /** Key for the read-only crew / run-of-show page. */
  crewKey: string;
  ros: RunOfShow;
  /** This machine's addresses on the local network, e.g. http://192.168.1.20:8787 */
  lanUrls: string[];
}

/** Tile placement in the 1920x1080 canvas. */
export interface Rect { x: number; y: number; w: number; h: number }

export type TileKind = 'video' | 'card' | 'obs';

export interface Tile {
  casterId: CasterId;
  kind: TileKind;
  /** Whole tile incl. frame/name bar. */
  rect: Rect;
  /** Camera picture area inside the frame. */
  cam: Rect;
  showName: boolean;
}

export type ForcedLayout = 'solo' | 'duo' | 'trio' | undefined;

export interface Composition {
  tiles: Tile[];
  /** Effective arrangement name, used to trigger the logo sting on major changes. */
  arrangement: 'none' | 'solo' | 'duo' | 'trio';
  audioMode: boolean;
  background: boolean;
}

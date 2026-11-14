import type { CmdSource, ProducerCmd, TransitionKind } from './engine';
import type { CasterId, ControllerState, FollowSettings, RosItem, RunOfShow, Scene, Show } from './types';
import type { Tournament, TournamentOp } from './tournament';
import type { Player, Story } from './players';
import type { WcOp, WcPop, WildcardState } from './wildcard';
import type { TwOp, TwitchPublic } from './twitch';

export type Role = 'controller' | 'output' | 'contributor' | 'admin' | 'crew';

export interface WatchRequest {
  slot: CasterId;
  /** 'hq' for broadcast outputs, 'lq' for the controller preview monitors. */
  quality: 'hq' | 'lq';
  video: boolean;
  audio: boolean;
}

/** Client -> server */
export type ClientMsg =
  | { t: 'hello'; role: Role; route?: string; slot?: CasterId; key?: string; /** 2.0 personal talent link (t1…t10) */ talent?: string }
  /** A media browser source finished the current item (seq = the play it belongs to). */
  | { t: 'media-ended'; seq: number }
  /** A graphics browser source reports whether its renderer works (per-graphic isolation). */
  | { t: 'gfx-health'; id: string; ok: boolean; error?: string }
  | { t: 'out-perf'; perf: OutputPerf }
  /** Overdrive 2.0 production command: always answered with an `ack` carrying the same id. */
  | { t: 'cmd'; id: string; cmd: ProducerCmd; source?: CmdSource; /** engine version the operator saw */ base?: number }
  | { t: 'ping' }
  // controller only
  | { t: 'set-preview'; scene: Scene }
  | { t: 'take' }
  | { t: 'ros-items'; items: RosItem[] }
  | { t: 'ros-go'; index: number | null }
  | { t: 'ros-message'; text: string }
  | { t: 'regen-crew-key' }
  | { t: 'follow-set'; follow: FollowSettings }
  | { t: 'players-set'; players: Player[] }
  | { t: 'stories-set'; stories: Story[] }
  | { t: 't-op'; op: TournamentOp }
  | { t: 'set-show'; show: Show }
  /** Instant ops: apply to preview AND program immediately (scores, timer). */
  | { t: 'quick'; op: QuickOp }
  | { t: 'screen'; screen: Scene['screen']; take?: boolean }
  | { t: 'set-instant'; on: boolean }
  | { t: 'reset-preview' }
  | { t: 'reset-show' }
  | { t: 'regen-api-token' }
  | { t: 'preset-save'; name: string; id?: string; identity?: boolean }
  | { t: 'preset-recall'; id: string; take?: boolean }
  | { t: 'preset-delete'; id: string }
  | { t: 'regen-key'; slot: CasterId }
  | { t: 'obs-scene'; name: string }
  | { t: 'obs-sync' }
  | { t: 'obs-connect'; url: string; password?: string }
  | { t: 'event-create'; name: string; from: 'copy' | 'blank' | 'overdrive'; theme: 'bnl' | 'classic'; activate?: boolean }
  | { t: 'event-switch'; id: string }
  | { t: 'sheet-set'; url: string; enabled: boolean }
  | { t: 'sheet-sync' }
  | { t: 'sheet-feature'; id: string | null }
  | { t: 'badge'; kind: 'none' | 'replay' | 'highlights' }
  /** OverDrive Wildcard bracket: scores, part on air, cast match, options, popups. */
  | { t: 'wc'; op: WcOp }
  /** Twitch predictions & polls (controller). */
  | { t: 'tw'; op: TwOp }
  /** A caster's own prediction, from their camera link page. */
  | { t: 'caster-pick'; pick: import('./wildcard').WcPick | null }
  | { t: 'event-rename'; id: string; name: string }
  | { t: 'event-delete'; id: string }
  | { t: 'obs-build'; gameCapture: boolean; audio: boolean }
  // WebRTC signaling
  | ({ t: 'rtc-watch' } & WatchRequest)
  | { t: 'rtc-unwatch'; slot: CasterId }
  | { t: 'rtc-signal'; to: string; data: RtcSignal }
  | { t: 'rtc-publish-state'; publishing: boolean; hasAudio: boolean; label?: string };

export type QuickOp =
  | { k: 'score'; team: 'A' | 'B'; delta?: number; value?: number }
  | { k: 'swap' }
  | { k: 'reset-scores' }
  | { k: 'game'; value: number }
  | { k: 'timer-start'; minutes: number }
  | { k: 'timer-add'; minutes: number }
  | { k: 'timer-until'; target: number }
  | { k: 'timer-stop' }
  | { k: 'spotlight'; kind: 'player' | 'story'; id: string; seconds: number | null }
  | { k: 'spotlight-hide' }
  | { k: 'active-player'; id: string | null; via?: 'game' | 'manual' }
  | { k: 'lineup'; ids: string[] }
  | { k: 'music'; patch: Partial<import('./types').Show['music']> }
  | { k: 'next-match'; patch: Partial<import('./types').Show['nextMatch']> }
  | { k: 'matchup-casters'; on: boolean }
  /** On-air switches from the scene dock (straight to air, like the other quick ops). */
  | { k: 'flag'; key: 'scoreboard' | 'ticker' | 'gameplay-ticker' | 'gameplay-cams'; on: boolean };

/** Public player card data (from the player sheet) for warm-up / cam graphics. */
export interface PlayerCard { name: string; vdo: string; input: string; style: string; age: string; funFact: string; rival: string; photo: string }

/** Bundle of player-roster + schedule-sheet data sent to every client. */
export interface MatchData { names: Record<string, string>; info: Record<string, PlayerCard>; sheet: import('./sheet').SheetState }

export type RtcSignal =
  | { kind: 'offer' | 'answer'; sdp: string; pcId: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null; pcId: string };

/** Server -> client */
export type ServerMsg =
  | { t: 'welcome'; id: string; role: Role; iceServers: RTCIceServer[]; slot?: CasterId; name?: string }
  | { t: 'live'; scene: Scene; show: Show; version: number; now: number; /** set only on the broadcast of a TAKE / CUT */ transition?: TransitionKind }
  | { t: 'ack'; id: string; ok: boolean; version: number; error?: string; note?: string }
  | { t: 'media'; media: import('./media').MediaState; now: number }
  | { t: 'gfx'; graphics: import('./gfx').GfxInstance[]; now: number }
  /** Producer recovery: browser sources reload themselves and resync. */
  | { t: 'reload' }
  /** This output's OBS source is off air (not in Program/Preview): pause its videos and loops. Off = resume. */
  | { t: 'suspend'; on: boolean }
  /** Producer turned the live performance monitor on/off: outputs sample their frame timing while on. */
  | { t: 'perf-mode'; on: boolean }
  | { t: 'perf'; perf: PerfReport }
  | { t: 'state'; state: ControllerState }
  | { t: 'tournament'; tournament: Tournament }
  | { t: 'ros'; ros: RunOfShow; now: number }
  | ({ t: 'match-data' } & MatchData)
  | { t: 'wildcard'; wc: WildcardState }
  /** A map was won or a match ended (gameplay popups). Only sent live, never replayed on connect. */
  | { t: 'wc-pop'; pop: WcPop }
  | { t: 'twitch'; tw: TwitchPublic }
  | { t: 'caster-info'; name: string; role: string; cameraVisible: boolean; /** 2.0 talent page: their current position (null = not seated) */ seat?: number | null; /** Camera sent through VDO.Ninja: the push stream ID and the VDO password (only to this caster). */ vdo: { id: string; password: string; room: string } | null; /** Names of everyone in the show (for the picks on the caster page). */ talent?: { id: number; name: string }[] }
  | { t: 'rtc-viewer-join'; viewerId: string; req: WatchRequest }
  | { t: 'rtc-viewer-leave'; viewerId: string }
  | { t: 'rtc-signal'; from: string; slot: CasterId; data: RtcSignal }
  | { t: 'rtc-publisher'; slot: CasterId; online: boolean }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

/** One output page's rendering health (sent every 5 s while the performance monitor is on). */
export interface OutputPerf {
  route: string;
  /** Browser source size in device px, device px per logical unit, scaling backend. */
  w: number; h: number; scale: number; raster: string;
  suspended: boolean;
  /** rAF frame rate over the last window, its 95th-percentile frame time and frames over 25 ms (main thread). */
  fps: number; p95: number; long: number;
  /** <video> elements: playing now, and decoder frames dropped / decoded since the last report. */
  videos: number; dropped: number; decoded: number;
  fontsReady: boolean;
  heapMB?: number;
}
export interface PerfReport {
  on: boolean;
  suspendOffAir: boolean;
  outputs: (OutputPerf & { id: string; at: number })[];
  /** OBS GetStats (render/encode health) while connected. */
  obs: { fps: number; renderMs: number; renderSkipped: number; renderTotal: number; outputSkipped: number; outputTotal: number; cpu: number; memMB: number } | null;
  /** route → showing in OBS (Program/Preview/projector), when known. */
  showing: Record<string, boolean>;
}

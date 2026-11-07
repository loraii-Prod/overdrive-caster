import type { CasterId, ControllerState, FollowSettings, RosItem, RunOfShow, Scene, Show } from './types';
import type { Tournament, TournamentOp } from './tournament';
import type { Player, Story } from './players';
import type { League, Playoffs, ReverseCup } from './bnl';

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
  | { t: 'hello'; role: Role; route?: string; slot?: CasterId; key?: string }
  | { t: 'ping' }
  // controller only
  | { t: 'set-preview'; scene: Scene }
  | { t: 'take' }
  | { t: 'ros-items'; items: RosItem[] }
  | { t: 'ros-go'; index: number | null }
  | { t: 'ros-message'; text: string }
  | { t: 'regen-crew-key' }
  | { t: 'follow-set'; follow: FollowSettings }
  | { t: 'league-set'; league: League }
  | { t: 'playoffs-set'; playoffs: Playoffs }
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
  | { t: 'event-create'; name: string; from: 'copy' | 'blank' | 'overdrive'; theme: 'bnl' | 'glacial'; activate?: boolean }
  | { t: 'event-switch'; id: string }
  | { t: 'sheet-set'; url: string; enabled: boolean }
  | { t: 'sheet-sync' }
  | { t: 'sheet-feature'; id: string | null }
  | { t: 'badge'; kind: 'none' | 'replay' | 'highlights' }
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
  | { k: 'rc'; op: RcOp };

/** Public player card data (from the player sheet) for warm-up / cam graphics. */
export interface PlayerCard { name: string; vdo: string; input: string; style: string; age: string; funFact: string; rival: string; photo: string }

export type RcOp =
  | { a: 'round'; finish: string[]; dnf: string[] }
  | { a: 'undo' }
  | { a: 'reset'; start?: number }
  | { a: 'set'; patch: Partial<Pick<ReverseCup, 'enabled' | 'title' | 'start' | 'winners' | 'maps' | 'mapIndex' | 'round'>> }
  | { a: 'player'; i: number; id: string | null; points?: number }
  | { a: 'load-playoff'; id: string }
  | { a: 'load-league'; div: 'd1' | 'd2'; match: number }
  | { a: 'save' };

export type RtcSignal =
  | { kind: 'offer' | 'answer'; sdp: string; pcId: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null; pcId: string };

/** Server -> client */
export type ServerMsg =
  | { t: 'welcome'; id: string; role: Role; iceServers: RTCIceServer[]; slot?: CasterId; name?: string }
  | { t: 'live'; scene: Scene; show: Show; version: number; now: number }
  | { t: 'state'; state: ControllerState }
  | { t: 'tournament'; tournament: Tournament }
  | { t: 'ros'; ros: RunOfShow; now: number }
  | { t: 'bnl'; league: League; playoffs: Playoffs; names: Record<string, string>; info: Record<string, PlayerCard>; sheet: import('./sheet').SheetState }
  | { t: 'caster-info'; name: string; role: string; cameraVisible: boolean }
  | { t: 'rtc-viewer-join'; viewerId: string; req: WatchRequest }
  | { t: 'rtc-viewer-leave'; viewerId: string }
  | { t: 'rtc-signal'; from: string; slot: CasterId; data: RtcSignal }
  | { t: 'rtc-publisher'; slot: CasterId; online: boolean }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

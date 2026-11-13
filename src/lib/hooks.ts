import type { TransitionKind } from '../../shared/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Socket, type ConnState } from './socket';
import { RtcViewer } from './rtcViewer';
import type { Role } from '../../shared/protocol';
import type { CasterId, RunOfShow, Scene, Show } from '../../shared/types';
import type { Tournament } from '../../shared/tournament';
import type { MatchData } from '../../shared/protocol';
import type { WcPop, WildcardState } from '../../shared/wildcard';
import type { TwitchPublic } from '../../shared/twitch';

export function useSocket(hello: { role: Role; route?: string; slot?: CasterId; key?: string; talent?: string }) {
  const sock = useMemo(() => new Socket(hello), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sock.close(), [sock]);
  // Producer recovery: every browser source reloads (and resyncs from the server) on request.
  useEffect(() => (hello.role === 'output' ? sock.on(m => { if (m.t === 'reload') window.location.reload(); }) : undefined), [sock]); // eslint-disable-line react-hooks/exhaustive-deps
  return sock;
}

export function useConnState(sock: Socket) {
  const [s, setS] = useState<ConnState>(sock.state);
  useEffect(() => sock.onState(setS), [sock]);
  return s;
}

export interface LiveState { scene: Scene; show: Show; version: number; /** server clock − local clock (ms) */ skew: number; /** set on a TAKE / CUT broadcast */ transition?: TransitionKind }

export function useLive(sock: Socket) {
  const [live, setLive] = useState<LiveState | null>(null);
  useEffect(() => sock.on(m => {
    if (m.t === 'live') setLive({ scene: m.scene, show: m.show, version: m.version, skew: m.now - Date.now(), transition: m.transition });
  }), [sock]);
  return live;
}

/** Server-synchronised clock, ticking every `ms`. */
export function useNow(skew: number, ms = 250) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    setNow(Date.now() + skew);
    const t = setInterval(() => setNow(Date.now() + skew), ms);
    return () => clearInterval(t);
  }, [skew, ms]);
  return now;
}

export function useViewer(sock: Socket, quality: 'hq' | 'lq') {
  const v = useMemo(() => new RtcViewer(sock, quality), [sock, quality]);
  useEffect(() => () => v.destroy(), [v]);
  return v;
}

/** Subscribe to remote cameras for every enabled caster whose source is WebRTC. */
export function useWantedCameras(viewer: RtcViewer, scenes: (Scene | null | undefined)[], enabled = true) {
  const key = scenes
    .map(s => s?.casters.filter(c => c.enabled && c.source.type === 'webrtc').map(c => c.id).join(',') ?? '')
    .join('|');
  useEffect(() => {
    const ids = new Set<CasterId>();
    if (enabled) key.split(/[|,]/).filter(Boolean).forEach(i => ids.add(Number(i) as CasterId));
    viewer.setWanted(new Map([...ids].map(id => [id, { video: true, audio: false }])));
  }, [viewer, key, enabled]);
}

export function useTournament(sock: Socket) {
  const [t, setT] = useState<Tournament | null>(null);
  useEffect(() => sock.on(m => { if (m.t === 'tournament') setT(m.tournament); }), [sock]);
  return t;
}

export function useRos(sock: Socket) {
  const [r, setR] = useState<{ ros: RunOfShow; skew: number } | null>(null);
  useEffect(() => sock.on(m => { if (m.t === 'ros') setR({ ros: m.ros, skew: m.now - Date.now() }); }), [sock]);
  return r;
}

export function useMatchData(sock: Socket) {
  const [d, setD] = useState<MatchData | null>(null);
  useEffect(() => sock.on(m => { if (m.t === 'match-data') setD({ names: m.names, info: m.info ?? {}, sheet: m.sheet }); }), [sock]);
  return d;
}

/** OverDrive Wildcard bracket state + the latest popup event received live (null until one arrives). */
export interface WcLive { state: WildcardState; pop: WcPop | null; /** Twitch predictions & polls */ tw: TwitchPublic | null }

export function useWildcard(sock: Socket) {
  const [d, setD] = useState<WcLive | null>(null);
  // Twitch state can arrive before the wildcard state: keep it until then.
  const pendingTw = useRef<TwitchPublic | null>(null);
  useEffect(() => sock.on(m => {
    if (m.t === 'wildcard') setD(p => ({ state: m.wc, pop: p?.pop ?? null, tw: p?.tw ?? pendingTw.current }));
    else if (m.t === 'wc-pop') setD(p => (p ? { ...p, pop: m.pop } : p));
    else if (m.t === 'twitch') { pendingTw.current = m.tw; setD(p => (p ? { ...p, tw: m.tw } : p)); }
  }), [sock]);
  return d;
}

export const query = () => new URLSearchParams(location.search);

/** 2.0 media playback state (server clock). */
export function useMedia(sock: Socket) {
  const [m, setM] = useState<{ media: import('../../shared/media').MediaState; skew: number } | null>(null);
  useEffect(() => sock.on(msg => { if (msg.t === 'media') setM({ media: msg.media, skew: msg.now - Date.now() }); }), [sock]);
  return m;
}

/** Graphics engine instances (published config, drafts, animation state). */
export function useGraphics(sock: Socket) {
  const [g, setG] = useState<import('../../shared/gfx').GfxInstance[] | null>(null);
  useEffect(() => sock.on(msg => { if (msg.t === 'gfx') setG(msg.graphics); }), [sock]);
  return g;
}

/** Audience results everyone may draw (frozen only) + desk MVPs + approved QR links. */
export type AudLive = Extract<import('../../shared/protocol').ServerMsg, { t: 'aud' }>['aud'];
export function useAudience(sock: Socket) {
  const [a, setA] = useState<AudLive | null>(null);
  useEffect(() => sock.on(m => { if (m.t === 'aud') setA(m.aud); }), [sock]);
  return a;
}
/** Producer only: live counts, vote-service health. */
export function useAudPrivate(sock: Socket) {
  const [a, setA] = useState<import('../../shared/protocol').AudPrivate | null>(null);
  useEffect(() => sock.on(m => { if (m.t === 'aud-private') setA(m.aud); }), [sock]);
  return a;
}

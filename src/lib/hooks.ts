import { useEffect, useMemo, useState } from 'react';
import { Socket, type ConnState } from './socket';
import { RtcViewer } from './rtcViewer';
import type { Role } from '../../shared/protocol';
import type { CasterId, RunOfShow, Scene, Show } from '../../shared/types';
import type { Tournament } from '../../shared/tournament';
import type { BnlData } from '../components/show/BnlGraphics';

export function useSocket(hello: { role: Role; route?: string; slot?: CasterId; key?: string }) {
  const sock = useMemo(() => new Socket(hello), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sock.close(), [sock]);
  return sock;
}

export function useConnState(sock: Socket) {
  const [s, setS] = useState<ConnState>(sock.state);
  useEffect(() => sock.onState(setS), [sock]);
  return s;
}

export interface LiveState { scene: Scene; show: Show; version: number; /** server clock − local clock (ms) */ skew: number }

export function useLive(sock: Socket) {
  const [live, setLive] = useState<LiveState | null>(null);
  useEffect(() => sock.on(m => {
    if (m.t === 'live') setLive({ scene: m.scene, show: m.show, version: m.version, skew: m.now - Date.now() });
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

export function useBnl(sock: Socket) {
  const [d, setD] = useState<BnlData | null>(null);
  useEffect(() => sock.on(m => { if (m.t === 'bnl') setD({ league: m.league, playoffs: m.playoffs, names: m.names, info: m.info ?? {}, sheet: m.sheet }); }), [sock]);
  return d;
}

export const query = () => new URLSearchParams(location.search);

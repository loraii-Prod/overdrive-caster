/** 3.0 talent audio meters (server 'meters' messages, ~10 per second), shared by the producer pages without prop drilling. */
import { useSyncExternalStore } from 'react';
import type { Socket } from './socket';

let cur: Record<string, number> = {};
let at = 0;
const subs = new Set<() => void>();
export function feedMeters(sock: Socket) {
  const off = sock.on(m => { if (m.t === 'meters') { cur = { ...cur, ...m.m }; at = Date.now(); subs.forEach(f => f()); } });
  // levels decay to silence when OBS stops sending (disconnect, nobody talking on a muted input)
  const t = setInterval(() => { if (at && Date.now() - at > 600 && Object.keys(cur).length) { cur = {}; at = 0; subs.forEach(f => f()); } }, 300);
  return () => { off(); clearInterval(t); };
}
/** dBFS peak of a talent's voice (−60 = silence), or null when OBS sends no level for them. */
export const useMeter = (id: string) => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur[id] ?? null);

/** Latest live performance report (server 'perf' messages), shared by the producer pages without prop drilling. */
import { useSyncExternalStore } from 'react';
import type { PerfReport } from '../../shared/protocol';
import type { Socket } from './socket';

let cur: PerfReport | null = null;
const subs = new Set<() => void>();
export function feedPerf(sock: Socket) { return sock.on(m => { if (m.t === 'perf') { cur = m.perf; subs.forEach(f => f()); } }); }
export const usePerfReport = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);

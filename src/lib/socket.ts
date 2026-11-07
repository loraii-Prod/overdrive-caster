import type { ClientMsg, Role, ServerMsg } from '../../shared/protocol';
import type { CasterId } from '../../shared/types';

export type ConnState = 'connecting' | 'open' | 'closed' | 'denied';

type Listener = (m: ServerMsg) => void;

/**
 * WebSocket client that never gives up: exponential backoff (0.5s → 5s),
 * application-level ping to detect dead links, hello re-sent on every
 * reconnect so OBS browser sources heal themselves without a refresh.
 */
export class Socket {
  state: ConnState = 'connecting';
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private backoff = 500;
  private lastMsg = Date.now();
  private pinger: number | undefined;
  private reconnectTimer: number | undefined;
  private stopped = false;

  constructor(private hello: { role: Role; route?: string; slot?: CasterId; key?: string }) {
    this.connect();
    this.pinger = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastMsg > 15_000) this.ws.close(); // half-open link
        else this.send({ t: 'ping' });
      }
    }, 5000);
  }

  private setState(s: ConnState) {
    this.state = s;
    this.stateListeners.forEach(l => l(s));
  }

  private connect() {
    if (this.stopped) return;
    this.setState('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.lastMsg = Date.now();
      ws.send(JSON.stringify({ t: 'hello', ...this.hello }));
      this.setState('open');
    };
    ws.onmessage = e => {
      this.lastMsg = Date.now();
      let m: ServerMsg;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'error' && (m.code === 'auth' || m.code === 'replaced')) this.setState('denied');
      this.listeners.forEach(l => l(m));
    };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4003 || e.code === 4001) { this.setState('denied'); return; }
      this.setState('closed');
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
    ws.onerror = () => ws.close();
  }

  /** Try again after a 'denied' (e.g. new key, or after login). */
  retry() {
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.backoff = 500;
    this.connect();
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  onState(l: (s: ConnState) => void) { this.stateListeners.add(l); return () => { this.stateListeners.delete(l); }; }

  close() {
    this.stopped = true;
    clearInterval(this.pinger);
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

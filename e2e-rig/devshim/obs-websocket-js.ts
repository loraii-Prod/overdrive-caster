// Sandbox shim of obs-websocket-js v5 (JSON subprotocol only): Hello/Identify/auth, requests, events. Not shipped.
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export const EventSubscription = { All: 2047, InputVolumeMeters: 1 << 16, InputActiveStateChanged: 1 << 17, InputShowStateChanged: 1 << 18, SceneItemTransformChanged: 1 << 19 } as const;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('base64');

export class OBSWebSocketError extends Error { constructor(public code: number, message: string) { super(message); } }

export class OBSWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { res: (v: any) => void; rej: (e: Error) => void }>();
  private n = 0;
  identified = false;
  async connect(url: string, password?: string, ident: { eventSubscriptions?: number } = {}) {
    if (this.ws) await this.disconnect();
    return new Promise<{ negotiatedRpcVersion: number }>((resolve, reject) => {
      const ws = new WebSocket(url, 'obswebsocket.json');
      this.ws = ws;
      let done = false;
      const fail = (e: Error) => { if (!done) { done = true; reject(e); } };
      ws.on('error', e => fail(e as Error));
      ws.on('close', (code, reason) => {
        const was = this.identified; this.identified = false; this.ws = null;
        for (const p of this.pending.values()) p.rej(new Error('Socket closed')); this.pending.clear();
        fail(new OBSWebSocketError(code, String(reason) || 'connection closed'));
        if (was) this.emit('ConnectionClosed', new OBSWebSocketError(code, String(reason)));
      });
      ws.on('message', raw => {
        const m = JSON.parse(String(raw));
        if (m.op === 0) {
          const auth = m.d.authentication ? sha(sha((password ?? '') + m.d.authentication.salt) + m.d.authentication.challenge) : undefined;
          ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication: auth, eventSubscriptions: ident.eventSubscriptions ?? 1023 } }));
        } else if (m.op === 2) { this.identified = true; done = true; this.emit('ConnectionOpened'); this.emit('Identified', m.d); resolve(m.d); }
        else if (m.op === 5) this.emit(m.d.eventType, m.d.eventData ?? {});
        else if (m.op === 7) {
          const p = this.pending.get(m.d.requestId); if (!p) return; this.pending.delete(m.d.requestId);
          if (m.d.requestStatus?.result) p.res(m.d.responseData ?? {}); else p.rej(new OBSWebSocketError(m.d.requestStatus?.code ?? 0, m.d.requestStatus?.comment ?? 'request failed'));
        }
      });
    });
  }
  async disconnect() { const ws = this.ws; if (!ws) return; await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); setTimeout(r, 500); }); }
  call(requestType: string, requestData?: unknown): Promise<any> {
    const ws = this.ws;
    if (!ws || !this.identified) return Promise.reject(new OBSWebSocketError(-1, 'Not connected'));
    const requestId = String(++this.n);
    return new Promise((res, rej) => { this.pending.set(requestId, { res, rej }); ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } })); });
  }
  async callBatch(reqs: { requestType: string; requestData?: unknown }[]) { const out = []; for (const r of reqs) { try { out.push({ requestStatus: { result: true }, responseData: await this.call(r.requestType, r.requestData) }); } catch (e: any) { out.push({ requestStatus: { result: false, comment: e.message } }); } } return out; }
}
export default OBSWebSocket;

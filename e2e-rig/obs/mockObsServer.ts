/**
 * obs-websocket v5 protocol server around tests/mockObs.ts, so the REAL ObsBridge (obs-websocket-js, JSON
 * subprotocol, Hello/Identify/auth, requests, events) talks to it exactly as it would to OBS.
 * Not real OBS. Usage: npx tsx e2e-rig/obs/mockObsServer.ts [port] [password]
 * HTTP side-channel on port+1: GET /state (scenes/inputs/log), POST /reset, POST /program?scene=…, POST /drop.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import http from 'node:http';
import crypto from 'node:crypto';
import { MockObs } from '../../tests/mockObs';
import { encode, decode } from '@msgpack/msgpack';

const port = Number(process.argv[2] ?? 4455);
const password = process.argv[3] ?? '';
let obs = new MockObs();
const socks = new Set<WebSocket>();
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('base64');

// both encodings obs-websocket offers: obs-websocket-js uses msgpack in Node, JSON in browsers
const wss = new WebSocketServer({ port, handleProtocols: p => (p.has('obswebsocket.msgpack') ? 'obswebsocket.msgpack' : p.has('obswebsocket.json') ? 'obswebsocket.json' : false) });
const out = (ws: WebSocket, m: any) => ws.send(ws.protocol === 'obswebsocket.msgpack' ? encode(m) : JSON.stringify(m));
const emit = (eventType: string, eventData: any = {}) => { for (const s of socks) out(s, { op: 5, d: { eventType, eventIntent: 1, eventData } }); };
wss.on('connection', ws => {
  const salt = crypto.randomBytes(16).toString('base64'), challenge = crypto.randomBytes(16).toString('base64');
  out(ws, ({ op: 0, d: { obsWebSocketVersion: '5.5.0 (mock)', rpcVersion: 1, ...(password ? { authentication: { salt, challenge } } : {}) } }));
  let identified = false;
  ws.on('message', async raw => {
    const m: any = ws.protocol === 'obswebsocket.msgpack' ? decode(raw as Buffer) : JSON.parse(String(raw));
    if (m.op === 1) {
      if (password && m.d.authentication !== sha(sha(password + salt) + challenge)) return ws.close(4009, 'Authentication failed.');
      identified = true; socks.add(ws);
      return out(ws, { op: 2, d: { negotiatedRpcVersion: 1 } });
    }
    if (m.op === 6 && identified) {
      const { requestType, requestId, requestData } = m.d;
      const before = obs.scenes.size;
      try {
        const responseData = await obs.call(requestType, requestData);
        out(ws, { op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } });
        if (obs.scenes.size !== before) emit('SceneListChanged', { scenes: [] });
        if (requestType === 'CreateSceneItem' || requestType === 'CreateInput') emit('SceneItemCreated', { sceneName: requestData.sceneName });
      } catch (e: any) {
        out(ws, { op: 7, d: { requestType, requestId, requestStatus: { result: false, code: e.code ?? 500, comment: e.message } } });
        if (!obs.connected) { ws.terminate(); obs.connected = true; }
      }
    }
  });
  ws.on('close', () => socks.delete(ws));
});

http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  const j = (v: any) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
  if (u.pathname === '/state') return j({ program: obs.program, scenes: [...obs.scenes].map(([n, s]) => ({ name: n, uuid: s.uuid, items: s.items })), inputs: [...obs.inputs].map(([n, i]) => ({ name: n, ...i })), log: obs.log });
  if (u.pathname === '/reset') { obs = new MockObs(); return j({ ok: true }); }
  if (u.pathname === '/program') { obs.program = u.searchParams.get('scene') ?? obs.program; emit('CurrentProgramSceneChanged', { sceneName: obs.program }); return j({ ok: true }); }
  if (u.pathname === '/studio-off') { obs.studioMode = false; emit('StudioModeStateChanged', { studioModeEnabled: false }); return j({ ok: true }); }
  if (u.pathname === '/preview') { obs.studioMode = true; obs.preview = u.searchParams.get('scene') ?? obs.preview; emit('StudioModeStateChanged', { studioModeEnabled: true }); emit('CurrentPreviewSceneChanged', { sceneName: obs.preview }); return j({ ok: true }); }
  if (u.pathname === '/add-browser') { obs.addInput(u.searchParams.get('scene')!, u.searchParams.get('name')!, 'browser_source', { url: u.searchParams.get('url'), width: 1920, height: 1480 }); return j({ ok: true }); }
  if (u.pathname === '/break-url') { const i = obs.inputs.get(u.searchParams.get('input') ?? ''); if (i) i.settings.url = 'http://wrong:1/nothing'; return j({ ok: !!i }); }
  if (u.pathname === '/add-picture') { const q = u.searchParams; obs.addInput(q.get('scene')!, q.get('name')!, 'browser_source', { url: q.get('url')!, width: Number(q.get('w')), height: Number(q.get('h')) }); const it = obs.scenes.get(q.get('scene')!)!.items.at(-1)!; const k = Number(q.get('scale') || 1); it.transform = { ...it.transform, scaleX: k, scaleY: k }; return j({ ok: true }); }
  if (u.pathname === '/video') { const q = u.searchParams; obs.video = { ...obs.video, ...(q.get('ow') ? { outputWidth: Number(q.get('ow')), outputHeight: Number(q.get('oh')) } : {}), ...(q.get('bw') ? { baseWidth: Number(q.get('bw')), baseHeight: Number(q.get('bh')) } : {}) }; return j(obs.video); }
  if (u.pathname === '/add-manual') { obs.addInput(u.searchParams.get('scene')!, u.searchParams.get('name')!, 'image_source', { file: 'logo.png' }); return j({ ok: true }); }
  if (u.pathname === '/drop') { for (const s of socks) s.terminate(); return j({ ok: true }); }
  res.statusCode = 404; res.end();
}).listen(port + 1);
console.log(`[mock-obs] ws://127.0.0.1:${port}${password ? ' (password)' : ''} · control http://127.0.0.1:${port + 1}`);

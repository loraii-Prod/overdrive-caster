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
        if (requestType === 'SetCurrentProgramScene') emit('CurrentProgramSceneChanged', { sceneName: obs.program });
      } catch (e: any) {
        out(ws, { op: 7, d: { requestType, requestId, requestStatus: { result: false, code: e.code ?? 500, comment: e.message } } });
        if (!obs.connected) { ws.terminate(); obs.connected = true; }
      }
    }
  });
  ws.on('close', () => socks.delete(ws));
});

// 3.0 audio: OBS raises InputMuteStateChanged for every mute change; InputVolumeMeters every 50 ms (here 100 ms)
// for every input with audio: a talking voice is simulated on unmuted inputs (levels only, no sound).
const wire = () => { obs.onEvent = (type, data) => emit(type, data); };
wire();
let tick = 0;
setInterval(() => {
  tick++;
  const inputs = [...obs.inputs].filter(([, i]) => i.audio || /audio|capture|wasapi|pulse|dshow/.test(i.kind) || /audio/i.test(String(i.settings?.url ?? ''))).map(([n, i], k) => {
    const live = !i.audio?.muted, talk = 0.5 + 0.5 * Math.sin(tick / 4 + k * 1.7);
    const mag = live ? 0.04 + 0.4 * talk * talk : 0;
    return { inputName: n, inputLevelsMul: [[mag, Math.min(1, mag * 1.3), Math.min(1, mag * 1.3)], [mag * 0.9, Math.min(1, mag * 1.2), Math.min(1, mag * 1.2)]] };
  });
  if (inputs.length) emit('InputVolumeMeters', { inputs });
}, 100);

http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  const j = (v: any) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
  if (u.pathname === '/state') return j({ program: obs.program, scenes: [...obs.scenes].map(([n, s]) => ({ name: n, uuid: s.uuid, items: s.items })), inputs: [...obs.inputs].map(([n, i]) => ({ name: n, ...i })), log: obs.log });
  if (u.pathname === '/reset') { obs = new MockObs(); wire(); return j({ ok: true }); }
  if (u.pathname === '/add-audio') { const q = u.searchParams; if (!obs.scenes.has(q.get('scene') ?? 'Scene')) obs.addScene(q.get('scene')!); obs.addInput(q.get('scene') ?? 'Scene', q.get('name')!, q.get('kind') ?? 'wasapi_input_capture', q.get('url') ? { url: q.get('url') } : {}); emit('InputCreated', { inputName: q.get('name') }); return j({ ok: true }); }
  if (u.pathname === '/mute') { obs.setMute(u.searchParams.get('input')!, u.searchParams.get('on') !== '0'); return j({ ok: true }); }
  if (u.pathname === '/studio-mode') { obs.call('SetStudioModeEnabled', { studioModeEnabled: u.searchParams.get('on') !== '0' }); return j({ ok: true }); }
  if (u.pathname === '/scenes') return j({ scenes: [...obs.scenes.keys()] });
  if (u.pathname === '/program') return j({ program: obs.program, preview: obs.studioMode ? obs.preview : null, transition: obs.transition, studioMode: obs.studioMode });
  if (u.pathname === '/audio') return j(Object.fromEntries([...obs.inputs].filter(([, i]) => i.audio).map(([n, i]) => [n, i.audio])));
  if (u.pathname === '/scenes') return j({ scenes: [...obs.scenes.keys()] });
  if (u.pathname === '/program') { obs.program = u.searchParams.get('scene') ?? obs.program; emit('CurrentProgramSceneChanged', { sceneName: obs.program }); return j({ ok: true }); }
  if (u.pathname === '/project') { const n = u.searchParams.get('source') ?? ''; if (u.searchParams.get('on') === '0') obs.projected.delete(n); else obs.projected.add(n); return j({ ok: true }); }
  if (u.pathname === '/studio-off') { obs.studioMode = false; emit('StudioModeStateChanged', { studioModeEnabled: false }); return j({ ok: true }); }
  if (u.pathname === '/preview') { obs.studioMode = true; obs.preview = u.searchParams.get('scene') ?? obs.preview; emit('StudioModeStateChanged', { studioModeEnabled: true }); emit('CurrentPreviewSceneChanged', { sceneName: obs.preview }); return j({ ok: true }); }
  if (u.pathname === '/add-scene') { const n = u.searchParams.get('scene') ?? 'Scene'; if (!obs.scenes.has(n)) obs.scenes.set(n, { uuid: `scene-${n}`, items: [], nextId: 1 }); return j({ ok: true }); }
  if (u.pathname === '/add-browser') { obs.addInput(u.searchParams.get('scene')!, u.searchParams.get('name')!, 'browser_source', { url: u.searchParams.get('url'), width: 1920, height: 1480 }); return j({ ok: true }); }
  if (u.pathname === '/break-url') { const i = obs.inputs.get(u.searchParams.get('input') ?? ''); if (i) i.settings.url = 'http://wrong:1/nothing'; return j({ ok: !!i }); }
  if (u.pathname === '/add-picture') { const q = u.searchParams; obs.addInput(q.get('scene')!, q.get('name')!, 'browser_source', { url: q.get('url')!, width: Number(q.get('w')), height: Number(q.get('h')) }); const it = obs.scenes.get(q.get('scene')!)!.items.at(-1)!; const k = Number(q.get('scale') || 1); it.transform = { ...it.transform, scaleX: k, scaleY: k }; return j({ ok: true }); }
  if (u.pathname === '/video') { const q = u.searchParams; obs.video = { ...obs.video, ...(q.get('ow') ? { outputWidth: Number(q.get('ow')), outputHeight: Number(q.get('oh')) } : {}), ...(q.get('bw') ? { baseWidth: Number(q.get('bw')), baseHeight: Number(q.get('bh')) } : {}) }; return j(obs.video); }
  if (u.pathname === '/add-manual') { obs.addInput(u.searchParams.get('scene')!, u.searchParams.get('name')!, 'image_source', { file: 'logo.png' }); return j({ ok: true }); }
  if (u.pathname === '/drop') { for (const s of socks) s.terminate(); return j({ ok: true }); }
  res.statusCode = 404; res.end();
}).listen(port + 1);
console.log(`[mock-obs] ws://127.0.0.1:${port}${password ? ' (password)' : ''} · control http://127.0.0.1:${port + 1}`);

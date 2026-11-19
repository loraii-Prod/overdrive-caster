// Build every Overdrive scene in the (mock) OBS through the real Scene Builder: preview → apply (what the Studio does).
// Usage: node e2e-rig/mvp3/obs-build.mjs [http://localhost:8787] [password]
import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const WebSocket = require('ws');
const B = process.argv[2] ?? 'http://localhost:8787', pw = process.argv[3] ?? 'testpw';
const r = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
const ws = new WebSocket(B.replace(/^http/, 'ws') + '/ws', { headers: { cookie } });
let st = null, n = 0;
const acks = new Map();
ws.on('message', raw => { const m = JSON.parse(String(raw)); if (m.t === 'state') st = m.state; if (m.t === 'ack') acks.get(m.id)?.(m); });
const cmd = c => new Promise(res => { const id = `b${++n}`; acks.set(id, res); ws.send(JSON.stringify({ t: 'cmd', id, cmd: c, base: st?.engine?.version })); });
await new Promise(res => ws.on('open', res));
ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
for (let i = 0; i < 50 && !st; i++) await new Promise(r => setTimeout(r, 100));
console.log('preview:', JSON.stringify(await cmd({ c: 'obs-setup', action: 'preview', mode: 'build', targets: 'all' })));
await new Promise(r => setTimeout(r, 500));
const hash = st?.obsSetup?.plan?.hash;
console.log('apply:', JSON.stringify(await cmd({ c: 'obs-setup', action: 'apply', hash, allowLive: true })));
await new Promise(r => setTimeout(r, 1500));
console.log('scenes:', (st?.obs?.scenes ?? []).join(' | '));
ws.close();

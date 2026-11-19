// Send controller messages (as the Producer does) and print the acks / final state bits.
// Usage: node e2e-rig/mvp3/ctl.mjs '<json array of messages>' [http://localhost:8787] [password]
//   e.g. '[{"t":"wc","op":{"k":"score","id":"R1_UB1","side":1,"delta":1}}]'
import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const WebSocket = require('ws');
const msgs = JSON.parse(process.argv[2] ?? '[]'), B = process.argv[3] ?? 'http://localhost:8787', pw = process.argv[4] ?? 'testpw';
const r = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
const ws = new WebSocket(B.replace(/^http/, 'ws') + '/ws', { headers: { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] } });
let st = null, n = 0; const acks = new Map();
ws.on('message', raw => { const m = JSON.parse(String(raw)); if (m.t === 'state') st = m.state; if ((m.t === 'ack' || m.t === 'aud-ack') && acks.has(m.id)) acks.get(m.id)(m); });
await new Promise(res => ws.on('open', res));
ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
for (let i = 0; i < 50 && !st; i++) await new Promise(r => setTimeout(r, 100));
for (const m of msgs) {
  const id = `c${++n}`;
  const p = new Promise(res => { acks.set(id, res); setTimeout(() => res({ timeout: true }), 3000); });
  ws.send(JSON.stringify({ ...m, id, ...(m.t === 'cmd' ? { base: st?.engine?.version } : {}) }));
  const a = await p; if (m.t === 'cmd' || m.t === 'aud') console.log(JSON.stringify(a));
  await new Promise(r => setTimeout(r, 120));
}
await new Promise(r => setTimeout(r, 400));
ws.close();

// Send controller messages (as the Producer / controller do) and print the acks, then the MVP state every console reads:
// the MVP graphic's match/step/revealed, the MVP vote of that match, the producer notice, rehearsal flag, event.
// Usage: node e2e-rig/mvp4/probe.mjs '<json array of messages>' [http://localhost:8787] [password]
// A message {"wait": ms} just waits.
import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const WebSocket = require('ws');
const msgs = JSON.parse(process.argv[2] ?? '[]'), B = process.argv[3] ?? 'http://localhost:8787', pw = process.argv[4] ?? 'testpw';
const r = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
const ws = new WebSocket(B.replace(/^http/, 'ws') + '/ws', { headers: { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] } });
let st = null, priv = null, wc = null, n = 0; const acks = new Map();
ws.on('message', raw => { const m = JSON.parse(String(raw));
  if (m.t === 'state') st = m.state; if (m.t === 'aud-private') priv = m.aud; if (m.t === 'wildcard') wc = m.wc;
  if (m.t === 'gfx' && st) st.graphics = m.graphics ?? st.graphics;
  if ((m.t === 'ack' || m.t === 'aud-ack') && acks.has(m.id)) acks.get(m.id)(m); });
await new Promise(res => ws.on('open', res));
ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
for (let i = 0; i < 50 && !st; i++) await new Promise(r => setTimeout(r, 100));
const out = { acks: [] };
for (const m of msgs) {
  if (m.wait) { await new Promise(r => setTimeout(r, m.wait)); continue; }
  // OBS Scene Builder: apply the plan the previous preview made (its hash comes from the state, as in the Studio)
  if (m.apply) { await new Promise(r => setTimeout(r, 500)); Object.assign(m, { t: 'cmd', cmd: { c: 'obs-setup', action: 'apply', hash: st?.obsSetup?.plan?.hash, allowLive: true } }); delete m.apply; }
  const id = `c${++n}`;
  const p = new Promise(res => { acks.set(id, res); setTimeout(() => res({ timeout: true }), 4000); });
  ws.send(JSON.stringify({ ...m, id, ...(m.t === 'cmd' ? { base: st?.engine?.version } : {}) }));
  if (m.t === 'cmd' || m.t === 'aud') out.acks.push(await p); else await new Promise(r => setTimeout(r, 150));
  await new Promise(r => setTimeout(r, 150));
}
await new Promise(r => setTimeout(r, 900));
const g = st?.graphics?.find(x => x.id === 'mvp');
const match = String(g?.config.match ?? '');
const poll = (priv?.summary?.polls ?? []).filter(p => p.match === match).pop() ?? null;
Object.assign(out, { obsSetup: { verify: st?.obsSetup?.verify ?? null }, event: st?.activeEvent ?? st?.events?.active, mvp: { match, step: g?.config.step, revealed: g?.config.revealed, qr: g?.config.qr, prepared: g?.prepared ?? null },
  poll: poll && { id: poll.id, status: poll.status, players: poll.players.map(p => p.handle), total: poll.total, bySource: poll.bySource, frozen: poll.frozen && { total: poll.frozen.total, manual: poll.frozen.manual, counts: poll.frozen.counts } },
  polls: (priv?.summary?.polls ?? []).map(p => `${p.match}:${p.status}`), notice: priv?.mvpNotice, rehearsal: priv?.rehearsal, mode: priv?.mode, auto: priv?.mvpAuto,
  segs: (st?.plan?.segments ?? []).map(x => ({ id: x.id, target: x.target, label: x.label })), onAirSeg: st?.plan?.onAir?.id ?? null,
  cast: wc?.cast, teams: wc?.teams?.slice(0, 4), obsProgram: st?.obs?.currentScene, obsPreview: st?.obs?.previewScene });
console.log(JSON.stringify(out, null, 1));
ws.close();

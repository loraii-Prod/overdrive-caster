// Overdrive 3.3 · MVP unified renderer — REAL OBS acceptance test (voting → winner reveal, Preview/Program isolation).
//
// Needs: OBS Studio 30+ with obs-websocket enabled, on a TEST scene collection (Scene Collection → Duplicate, switch to
// the copy), Overdrive running and connected to that OBS (settings.bat OBS_WS_URL / OBS_WS_PASSWORD), and the project's
// npm packages installed (run from the repository folder):
//
//   set OVERDRIVE_URL=http://localhost:8787
//   set OVERDRIVE_PW=<controller password>
//   set OBS_URL=ws://127.0.0.1:4455
//   set OBS_PW=<obs websocket password>
//   set CONFIRM_TEST_COLLECTION=1
//   node e2e-rig/obs/realMvp.mjs
//
// It uses the REHEARSAL demo match (fictional DEMO teams; the real event and its votes are not touched) and simulated
// votes. It builds the scenes (Build All, main layout), switches Program in OBS (on the test collection), turns on Studio
// Mode, and saves OBS's own rendered frames (GetSourceScreenshot) to ./mvp-real-obs/ as evidence. It removes nothing.
import fs from 'node:fs';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import OBSWebSocket from 'obs-websocket-js';

if (process.env.CONFIRM_TEST_COLLECTION !== '1') { console.log('Use a TEST scene collection in OBS, then set CONFIRM_TEST_COLLECTION=1.'); process.exit(2); }
const B = (process.env.OVERDRIVE_URL ?? 'http://localhost:8787').replace(/\/$/, ''), PW = process.env.OVERDRIVE_PW ?? '';
const OUT = 'mvp-real-obs'; fs.mkdirSync(OUT, { recursive: true });
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? `  ${typeof x === 'string' ? x : JSON.stringify(x)}` : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Overdrive (the same commands Producer Mode sends)
const login = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PW }) });
const ws = new WebSocket(B.replace(/^http/, 'ws') + '/ws', { headers: { cookie: (login.headers.get('set-cookie') ?? '').split(';')[0] } });
let st = null, priv = null, n = 0; const acks = new Map();
ws.on('message', raw => { const m = JSON.parse(String(raw)); if (m.t === 'state') st = m.state; if (m.t === 'aud-private') priv = m.aud; if (m.t === 'gfx' && st) st.graphics = m.graphics ?? st.graphics; if ((m.t === 'ack' || m.t === 'aud-ack') && acks.has(m.id)) acks.get(m.id)(m); });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
for (let i = 0; i < 50 && !st; i++) await sleep(100);
const send = (msg) => new Promise(res => { const id = `r${++n}`; acks.set(id, res); setTimeout(() => res({ ok: false, error: 'timeout' }), 15000); ws.send(JSON.stringify({ ...msg, id, ...(msg.t === 'cmd' ? { base: st?.engine?.version } : {}) })); });
const cmd = c => send({ t: 'cmd', cmd: c });
const aud = op => send({ t: 'aud', op });
const mvpG = () => st?.graphics?.find(g => g.id === 'mvp');
check('Overdrive: connected, and its OBS connection is up', !!st && st.obs?.connected, st?.obs?.error ?? '');
if (!st?.obs?.connected) process.exit(1);

// ---- OBS (read-only checks + the frames it renders)
const obs = new OBSWebSocket();
await obs.connect(process.env.OBS_URL ?? 'ws://127.0.0.1:4455', process.env.OBS_PW || undefined);
const v = await obs.call('GetVersion');
console.log(`   REAL OBS ${v.obsVersion} · obs-websocket ${v.obsWebSocketVersion} · ${v.platform}`);
const scenes = async () => obs.call('GetSceneList');
const shot = async (source, file) => {
  const r = await obs.call('GetSourceScreenshot', { sourceName: source, imageFormat: 'png', imageWidth: 960 });
  const buf = Buffer.from(String(r.imageData).replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync(`${OUT}/${file}`, buf);
  return crypto.createHash('sha1').update(buf).digest('hex');
};

// 1. Build the main scenes (preview → confirm, as in Studio)
await cmd({ c: 'obs-setup', action: 'options', options: { layout: 'main' } });
await cmd({ c: 'obs-setup', action: 'preview', mode: 'build', targets: 'all' }); await sleep(800);
const ap = await cmd({ c: 'obs-setup', action: 'apply', hash: st.obsSetup?.plan?.hash ?? '', allowLive: false });
check('Build (main layout) applied or nothing to do', ap.ok || /out of date|Nothing/.test(ap.error ?? ''), ap.error ?? ap.note);
await sleep(1500);
const map = st.obsSetup.map;
const MVP = map['main:mvp']?.scene, PVW = map['pvw:mvp']?.scene, PVW_IN = map['pvw:mvp']?.input, PGM_IN = map['g:mvp']?.input;
const DESK = map['main:caster-desk']?.scene;
check('OBS has the MVP scene, its Program source and the internal Preview identity', !!(MVP && PVW && PVW_IN && PGM_IN) && (await scenes()).scenes.some(s => s.sceneName === PVW), { MVP, PVW });
const mvpItems = (await obs.call('GetSceneItemList', { sceneName: MVP })).sceneItems;
check('the MVP scene holds ONE MVP browser source (all five views inside it)', mvpItems.filter(i => i.sourceName === PGM_IN).length === 1 && !mvpItems.some(i => /MVP — /.test(i.sourceName)), mvpItems.map(i => i.sourceName));
check('Preview identity is muted in OBS (no Preview audio leak)', (await obs.call('GetInputMute', { inputName: PVW_IN })).inputMuted === true);
if (!(await obs.call('GetStudioModeEnabled')).studioModeEnabled) { await obs.call('SetStudioModeEnabled', { studioModeEnabled: true }); await sleep(600); }

// 2. Caster Desk on Program; rehearsal demo match finished, voting with simulated votes
await cmd({ c: 'scene-take', target: 'g:caster-desk', transition: 'cut' }); await sleep(1200);
check('Program = Caster Desk', (await scenes()).currentProgramSceneName === DESK);
await cmd({ c: 'mvp-demo', action: 'load' }); await sleep(1500);
await cmd({ c: 'mvp-demo', action: 'finish' }); await sleep(2500);
const poll = () => (priv?.summary?.polls ?? []).filter(p => p.match === String(mvpG()?.config.match ?? '')).pop();
check('rehearsal: demo match finished, MVP vote prepared', !!poll(), mvpG()?.config.match);
await aud({ k: 'mvp-open', poll: poll().id }); await sleep(800);
await aud({ k: 'mvp-sim', poll: poll().id, votes: 200 }); await sleep(1500);

// 3. Prepare voting (Preview), TAKE with a fade
await cmd({ c: 'obs-preview', scene: MVP, target: 's:mvp' }); await sleep(800);
let sl = await scenes();
check('select MVP voting: OBS Preview = Preview identity, Program untouched', sl.currentPreviewSceneName === PVW && sl.currentProgramSceneName === DESK, [sl.currentProgramSceneName, sl.currentPreviewSceneName]);
const t1 = await cmd({ c: 'mvp-take', view: 'voting', transition: 'fade' }); await sleep(2500);
sl = await scenes();
check('TAKE voting (fade): Program = MVP scene', t1.ok && sl.currentProgramSceneName === MVP, t1.error ?? sl.currentProgramSceneName);
const hVoting = await shot(MVP, '1-program-voting.png');

// 4. Close voting, prepare the winner off-air — the voting picture stays on Program
await aud({ k: 'mvp-close', poll: poll().id }); await sleep(1500);
await cmd({ c: 'obs-preview', scene: MVP, target: 's:mvp-winner' }); await sleep(3500);
sl = await scenes();
check('prepare winner: OBS Preview = Preview identity, Program still the MVP scene', sl.currentPreviewSceneName === PVW && sl.currentProgramSceneName === MVP, [sl.currentProgramSceneName, sl.currentPreviewSceneName]);
check('…the Program source is still on the voting step (not revealed)', mvpG()?.config.step === 'voting' && mvpG()?.prepared === 'winner', [mvpG()?.config.step, mvpG()?.prepared]);
const hPvw = await shot(PVW, '2-preview-winner-prepared.png');
const hPgm2 = await shot(MVP, '2-program-still-voting.png');
check('OBS renders DIFFERENT pictures in Preview (winner) and Program (voting)', hPvw !== hPgm2);

// 5. TAKE the reveal: the one Program source moves from voting to winner (no source switch, no OBS scene change)
const t2 = await cmd({ c: 'mvp-take', view: 'winner' }); await sleep(5000);
sl = await scenes();
check('TAKE reveal: Program still the MVP scene, source now on the winner step', t2.ok && sl.currentProgramSceneName === MVP && mvpG()?.config.step === 'winner' && !mvpG()?.prepared, t2.error ?? [sl.currentProgramSceneName, mvpG()?.config.step]);
const hWin = await shot(MVP, '3-program-winner.png');
check('OBS Program picture changed from voting to the winner', hWin !== hVoting);
check('Preview identity still muted after the reveal', (await obs.call('GetInputMute', { inputName: PVW_IN })).inputMuted === true);

// 6. back to the real event (rehearsal left), Caster Desk
await cmd({ c: 'mvp-demo', action: 'leave' }); await sleep(1200);
await cmd({ c: 'scene-take', target: 'g:caster-desk', transition: 'cut' }); await sleep(800);
console.log(`\nFrames OBS rendered are in ./${OUT}/ (check that 2-preview shows the winner while 2-program shows voting).`);
console.log(`${ok} passed, ${bad} failed — REAL OBS ${v.obsVersion}`);
await obs.disconnect(); ws.close();
process.exit(bad ? 1 : 0);

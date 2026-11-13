/**
 * The Scene Builder against a REAL OBS Studio (30.0.2, obs-websocket 5.3.4, Linux, headless under Xvfb), through
 * Overdrive's own ObsBridge (obs-websocket-js, password auth).
 *
 * LIMITATION: the Linux distribution build of OBS has no Browser Source (CEF is not packaged). A shim creates
 * the builder's browser sources as Color Sources (which also have width/height) and reports them back as
 * browser_source. Everything else — scenes, scene items, transforms, ordering, settings incl. the Overdrive
 * marker, name rules, errors, Program scene — is real OBS. Rendering of the /g/ pages inside OBS is NOT tested.
 *   OBS_URL=ws://127.0.0.1:4455 OBS_PW=odtest123 npx tsx e2e-rig/obs/realObs.test.ts
 */
import { ObsBridge } from '../../server/obs';
import { createObsSetup, FORBIDDEN, type ObsCall } from '../../server/obsSetup';
import { AUDIO_SCENE, defaultObsSetup, targetUrl } from '../../shared/obsSetup';
import { sanitizeGraphics } from '../../shared/gfx';
import { defaultShow } from '../../shared/defaults';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  const bridge = new ObsBridge(() => {}, { url: process.env.OBS_URL ?? 'ws://127.0.0.1:4455', password: process.env.OBS_PW ?? 'odtest123' });
  for (let i = 0; i < 40 && !bridge.status.connected; i++) await sleep(250);
  check('real OBS: ObsBridge connects with password auth', bridge.status.connected, bridge.status.error ?? '');
  if (!bridge.status.connected) process.exit(1);
  const real: ObsCall = bridge.request;
  const v = await real('GetVersion');
  console.log(`   OBS ${v.obsVersion} · obs-websocket ${v.obsWebSocketVersion} · platform ${v.platform}`);

  // ---- clean slate: remove what an earlier run left (harness only; the builder itself never removes anything)
  const sl0 = await real('GetSceneList');
  for (const s of sl0.scenes) if (String(s.sceneName) !== 'Scene') await real('RemoveScene', { sceneName: s.sceneName });
  for (const i of (await real('GetInputList')).inputs) if (String(i.inputName).startsWith('Overdrive') || String(i.inputName).startsWith('My ')) await real('RemoveInput', { inputName: i.inputName }).catch(() => {});
  await real('SetCurrentProgramScene', { sceneName: 'Scene' });
  await real('CreateInput', { sceneName: 'Scene', inputName: 'My logo', inputKind: 'color_source_v3', inputSettings: { color: 4278190335, width: 300, height: 100 } });

  // ---- shim: Browser Source → Color Source (see LIMITATION), everything else passes through untouched
  const fake = new Set<string>();
  const log: string[] = [];
  let breakShimFor = '';
  const shimmed: ObsCall = async (req, data = {}) => {
    log.push(req);
    if (req === 'CreateInput' && data.inputKind === 'browser_source' && data.inputName !== breakShimFor) { fake.add(data.inputName); return real(req, { ...data, inputKind: 'color_source_v3', inputSettings: { color: 4281545523, ...data.inputSettings } }); }
    const r = await real(req, data);
    if (req === 'GetInputKindList') return { ...r, inputKinds: [...r.inputKinds, 'browser_source'] };
    if (req === 'GetInputList') return { ...r, inputs: r.inputs.map((i: any) => fake.has(i.inputName) ? { ...i, inputKind: 'browser_source', unversionedInputKind: 'browser_source' } : i) };
    if (req === 'GetSceneItemList') return { ...r, sceneItems: r.sceneItems.map((i: any) => fake.has(i.sourceName) ? { ...i, inputKind: 'browser_source' } : i) };
    return r;
  };

  const db = { graphics: sanitizeGraphics([]), show: defaultShow(), store: defaultObsSetup() };
  const b = createObsSetup({
    call: () => (bridge.status.connected ? shimmed : null), connected: () => bridge.status.connected, obsUrl: () => 'ws://127.0.0.1:4455',
    graphics: () => db.graphics, obsScenes: () => db.show.obsScenes, store: () => db.store, outputKey: '', port: 8787, lanUrls: () => [], publicUrl: () => '',
    save() {}, onChange() {}, applyMapping: built => { for (const { target, scene } of built) { const g = db.graphics.find(x => `g:${x.id}` === target.id); if (g) g.obsScene = scene; } },
  });
  const build = async (mode: 'build' | 'repair', ids: string[] | 'all', allowLive = false) => {
    const p = await b.preview(mode, ids); if (typeof p === 'string') return p;
    return b.apply(p.hash, allowLive);
  };
  const all = b.targets().filter(t => !t.supersededBy);

  // 1 build into a collection holding only OBS's default scene
  const r1 = await build('build', 'all');
  check('1 real OBS: build all', typeof r1 !== 'string' && r1.ok, typeof r1 === 'string' ? r1 : r1.summary);
  const sl = await real('GetSceneList');
  const names = new Set<string>(sl.scenes.map((s: any) => String(s.sceneName)));
  check('1 real OBS: one scene per output + shared audio scene', all.every(t => names.has(t.scene)) && names.has(AUDIO_SCENE) && names.size === all.length + 2, `${names.size} scenes`);
  let own = true, sizes = true, fill = true, marker = true;
  for (const t of all) {
    const items = (await real('GetSceneItemList', { sceneName: t.scene })).sceneItems;
    const mine = items.filter((i: any) => fake.has(i.sourceName));
    if (mine.length !== 1 || mine[0].sourceName !== t.input) own = false;
    const st = (await real('GetInputSettings', { inputName: t.input })).inputSettings;
    if (st.width !== 1920 || st.height !== 1080) sizes = false;
    if (st.overdrive_id !== t.id || st.url !== targetUrl('http://localhost:8787', t.route, '')) marker = false;
    const tr = mine[0]?.sceneItemTransform;
    if (!tr || tr.boundsType !== 'OBS_BOUNDS_STRETCH' || tr.boundsWidth !== 1920 || tr.boundsHeight !== 1080 || tr.positionX !== 0 || tr.positionY !== 0) fill = false;
  }
  check('1 real OBS: each scene holds exactly its own source', own);
  check('9 real OBS: every source 1920×1080', sizes);
  check('9 real OBS: every source stretched over the 1920×1080 canvas (real transform read back)', fill);
  check('real OBS keeps the Overdrive marker + URL in the source settings (ownership survives)', marker);
  check('real OBS (Linux, no Game Capture): gameplay scenes report the missing capture instead of failing', (b.state().targets.find(t => t.id === 'g:gameplay')?.issues ?? []).some(i => i.includes('Game Capture')));

  // 2 twice
  const p2 = await b.preview('repair', 'all');
  check('2 real OBS: second run has nothing to change', typeof p2 !== 'string' && p2.ops.length === 0, typeof p2 === 'string' ? p2 : p2.ops.map(o => o.detail).slice(0, 3).join(' | '));
  const v1 = await b.verify();
  const notOk = b.state().targets.filter(t => t.inAll && t.status !== 'ok');
  check('verify on real OBS: all correct except gameplay, flagged for its missing capture (Linux)', typeof v1 !== 'string' && v1.bad === 1 && notOk.length === 1 && notOk[0].id === 'g:gameplay', JSON.stringify(v1) + ' ' + notOk.map(t => t.id + ': ' + t.issues.join(';')).join(' | '));

  // 3/7 repair one scene after a wrong URL + size, keep a manual item
  const veto = all.find(t => t.id === 's:veto')!;
  await real('SetInputSettings', { inputName: veto.input, inputSettings: { url: 'http://wrong/', width: 1280 }, overlay: true });
  await real('CreateInput', { sceneName: veto.scene, inputName: 'My sponsor', inputKind: 'color_source_v3', inputSettings: { width: 200, height: 200 } });
  await b.scan();
  check('7 real OBS: wrong URL and size detected', b.state().targets.find(t => t.id === veto.id)?.status === 'outdated');
  await build('repair', [veto.id]);
  const vs = (await real('GetInputSettings', { inputName: veto.input })).inputSettings;
  const vi = (await real('GetSceneItemList', { sceneName: veto.scene })).sceneItems.map((i: any) => i.sourceName);
  check('3 real OBS: Repair Selected fixed URL + size', vs.url === targetUrl('http://localhost:8787', veto.route, '') && vs.width === 1920);
  check('5 real OBS: manually added item kept', vi.includes('My sponsor'));

  // 10 renamed by hand (obs-websocket 5.3 has no uuids: found through the scene holding our source)
  const cd = all.find(t => t.id === 'g:caster-desk')!;
  await real('SetSceneName', { sceneName: cd.scene, newSceneName: 'Desk renamed by hand' });
  const pr = await b.preview('build', [cd.id]);
  check('10 real OBS: a scene renamed by hand is recognised, no duplicate created', typeof pr !== 'string' && pr.ops.length === 0 && b.state().targets.find(t => t.id === cd.id)?.scene === 'Desk renamed by hand', typeof pr === 'string' ? pr : pr.ops.map(o => o.detail).join(' | '));

  // on air: Program scene is protected
  const inter = all.find(t => t.id === 's:interview')!;
  await real('SetCurrentProgramScene', { sceneName: inter.scene }); await sleep(300);
  await real('SetInputSettings', { inputName: inter.input, inputSettings: { url: 'http://old/' }, overlay: true });
  const held = await build('repair', [inter.id]);
  const after = (await real('GetInputSettings', { inputName: inter.input })).inputSettings.url;
  check('on air (real OBS): repair of the Program scene held back', after === 'http://old/' && typeof held !== 'string' && held.perTarget[inter.id].lines.some(l => l.startsWith('Held')));
  const pgm = (await real('GetSceneList')).currentProgramSceneName;
  check('11 real OBS: Program scene never changed by the builder', pgm === inter.scene);

  // 8 a REAL OBS error on one scene (Browser Source kind unavailable here, shim off for that one)
  const g2 = sanitizeGraphics([{ id: 'score-b', pkg: 'od.scoreboard', name: 'Scoreboard B' }]);
  db.graphics = g2;
  breakShimFor = b.targets().find(t => t.id === 'g:score-b')!.input;
  const r8 = await build('build', ['g:score-b', 's:matches']);
  check('8 real OBS error on one scene is reported, the others still run', typeof r8 !== 'string' && !r8.perTarget['g:score-b'].ok && r8.perTarget['s:matches'].ok, typeof r8 === 'string' ? r8 : r8.perTarget['g:score-b'].lines.join(' | '));
  const mine = (await real('GetSceneList')).scenes.filter((s: any) => String(s.sceneName) === b.targets().find(t => t.id === 'g:score-b')!.scene).length;
  check('8 the scene of the failed source exists once (repairable with Build Selected)', mine === 1);

  check('12 no transition / switch / delete request sent by the builder', !log.some(r => FORBIDDEN.includes(r)), log.filter(r => FORBIDDEN.includes(r)).join(','));
  { // picture quality: real GetVideoSettings feeds the read-only check (this OBS: 1920×1080 canvas and output, 60 fps)
    const w0 = log.filter(l => !l.startsWith('Get')).length; await b.verify(); const st = b.state();
    check('13 real OBS: quality check reads canvas, output and fps; a 1080p60 OBS has no canvas warning; no write', st.canvas?.w === 1920 && st.canvas?.ow === 1920 && st.canvas?.oh === 1080 && st.canvas?.fps === 60 && !st.quality.some(q => q.where === 'OBS video settings') && log.filter(l => !l.startsWith('Get')).length === w0, JSON.stringify(st.canvas));
  }
  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();

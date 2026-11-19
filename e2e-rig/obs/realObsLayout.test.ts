/**
 * 3.2 main-scenes layout against a REAL OBS Studio (obs-websocket 5.x), through Overdrive's own ObsBridge.
 * Run it on a TEST scene collection (OBS → Scene Collection → Duplicate, then switch to the copy) with Overdrive running:
 *
 *   OBS_URL=ws://127.0.0.1:4455 OBS_PW=yourpassword OVERDRIVE_URL=http://localhost:8787 CONFIRM_TEST_COLLECTION=1 \
 *     npx tsx e2e-rig/obs/realObsLayout.test.ts
 *
 * What it does: Build All (main scenes) → checks the nine scenes, one browser source per output, no duplicates →
 * Build again (must be a no-op) → shows / hides layers in a scene that is NOT on Program and checks Program never
 * changed → prepares OBS Preview (Studio Mode) → prints the dry-run cleanup report. It removes NOTHING unless you also
 * set ALLOW_REMOVE=1 (then only the scenes the report classes "consolidate", after the same checks as the UI).
 * It never switches Program. Browser sources load OVERDRIVE_URL: start Overdrive first so the pages render.
 */
import { ObsBridge } from '../../server/obs';
import { createObsSetup, CLEANUP_CONFIRM, FORBIDDEN, type ObsCall } from '../../server/obsSetup';
import { defaultObsSetup } from '../../shared/obsSetup';
import { MAIN_SCENES, mainSceneName } from '../../shared/obsLayout';
import { sanitizeGraphics } from '../../shared/gfx';
import { defaultShow } from '../../shared/defaults';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  if (process.env.CONFIRM_TEST_COLLECTION !== '1') {
    console.log('Refusing to run: use a TEST scene collection in OBS (Scene Collection → Duplicate), then set CONFIRM_TEST_COLLECTION=1.');
    process.exit(2);
  }
  const bridge = new ObsBridge(() => {}, { url: process.env.OBS_URL ?? 'ws://127.0.0.1:4455', password: process.env.OBS_PW ?? '' });
  for (let i = 0; i < 40 && !bridge.status.connected; i++) await sleep(250);
  check('real OBS: connected', bridge.status.connected, bridge.status.error ?? '');
  if (!bridge.status.connected) process.exit(1);
  const real: ObsCall = bridge.request;
  const sent: string[] = [];
  const call: ObsCall = async (req, data) => { sent.push(req); return real(req, data); };
  const v = await real('GetVersion');
  console.log(`   OBS ${v.obsVersion} · obs-websocket ${v.obsWebSocketVersion} · ${v.platform}`);
  const vs = await real('GetVideoSettings');
  console.log(`   canvas ${vs.baseWidth}×${vs.baseHeight}, output ${vs.outputWidth}×${vs.outputHeight}`);

  const store = defaultObsSetup();
  store.options.layout = 'main';
  store.options.baseUrl = (process.env.OVERDRIVE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
  if (vs.baseWidth === 3840) store.options.profile = 'uhd';
  const graphics = sanitizeGraphics([]);
  const show = defaultShow();
  const b = createObsSetup({
    call: () => call, connected: () => bridge.status.connected, obsUrl: () => process.env.OBS_URL ?? 'ws://127.0.0.1:4455',
    graphics: () => graphics, obsScenes: () => show.obsScenes, store: () => store, outputKey: process.env.OUTPUT_KEY ?? '', port: 8787,
    lanUrls: () => [], publicUrl: () => '', save() {}, onChange() {}, applyMapping() {},
  });
  const sceneNames = async () => ((await real('GetSceneList')).scenes as any[]).map(s => String(s.sceneName));
  const items = async (scene: string) => ((await real('GetSceneItemList', { sceneName: scene })).sceneItems as any[]);
  const before = await sceneNames();
  const prog0 = String((await real('GetSceneList')).currentProgramSceneName);

  // ---- Build All
  const p = await b.preview('build', 'all');
  check('preview (dry run) returns a plan', typeof p !== 'string', typeof p === 'string' ? p : `${p.ops.length} ops`);
  if (typeof p === 'string') process.exit(1);
  const r = await b.apply(p.hash, false);
  check('Build All succeeds', typeof r !== 'string' && r.ok, typeof r === 'string' ? r : r.summary);
  const after = await sceneNames();
  check('the nine main scenes exist', MAIN_SCENES.every(m => after.includes(store.map[`main:${m.key}`]?.scene ?? mainSceneName(m.key))), MAIN_SCENES.filter(m => !after.includes(mainSceneName(m.key))).map(m => m.label).join(', '));
  check('no scene that existed before was removed or renamed', before.every(n => after.includes(n)));
  const extra = after.filter(n => !before.includes(n));
  check('only main scenes were added', extra.every(n => MAIN_SCENES.some(m => mainSceneName(m.key) === n)), extra.join(', '));
  const inputs = ((await real('GetInputList', { inputKind: 'browser_source' })).inputs as any[]);
  const marks = new Map<string, number>();
  for (const i of inputs) { const s = (await real('GetInputSettings', { inputName: i.inputName })).inputSettings; if (typeof s.overdrive_id === 'string') marks.set(s.overdrive_id, (marks.get(s.overdrive_id) ?? 0) + 1); }
  check('one browser source per Overdrive output (no duplicates)', [...marks.values()].every(n => n === 1), [...marks].filter(([, n]) => n > 1).map(([k]) => k).join(', '));
  const targets = b.targets().filter(t => !t.supersededBy);
  let placed = 0;
  for (const t of targets) { const e = store.map[t.id]; if (e && (await items(e.scene)).some((i: any) => i.sourceName === e.input)) placed++; }
  check('every output is a scene item of its main scene', placed === targets.length, `${placed}/${targets.length}`);
  check('Build never sent a forbidden request (no switch, no removal, no rename)', !sent.some(x => FORBIDDEN.includes(x)), sent.filter(x => FORBIDDEN.includes(x)).join(','));

  // ---- idempotent
  const p2 = await b.preview('build', 'all');
  check('Build again: nothing to do', typeof p2 !== 'string' && p2.ops.length === 0, typeof p2 !== 'string' ? p2.ops.map(o => o.detail).slice(0, 3).join(' / ') : p2);
  const v2 = await b.verify();
  check('Verify: all correct', typeof v2 !== 'string' && v2.bad === 0, typeof v2 === 'string' ? v2 : `${v2.ok} ok / ${v2.bad} to fix`);

  // ---- layers in an OFF-AIR scene
  const off = MAIN_SCENES.map(m => store.map[`main:${m.key}`]?.scene).find(n => n && n !== prog0 && (n === mainSceneName('gameplay') || n === mainSceneName('mvp')));
  if (off) {
    const tgt = off === mainSceneName('gameplay') ? 'g:track' : 's:mvp-winner';
    const e = store.map[tgt];
    await b.layer(tgt, true);
    const it = (await items(off)).find((i: any) => i.sourceName === e.input);
    check(`layer shown off-air (${tgt} in "${off}")`, !!it?.sceneItemEnabled);
    await b.layer(`main:${store.map[tgt].main}`, true);
    const it2 = (await items(off)).find((i: any) => i.sourceName === e.input);
    check('back to the scene\'s base', tgt === 'g:track' ? !!it2?.sceneItemEnabled === true : !it2?.sceneItemEnabled);
    if (tgt === 'g:track') { await b.layer(tgt, false); check('overlay hidden', !(await items(off)).find((i: any) => i.sourceName === e.input)?.sceneItemEnabled); }
    const sm = await real('GetStudioModeEnabled');
    if (sm.studioModeEnabled) { await bridge.setPreview(off); await sleep(300); check('Studio Mode: the scene is in OBS Preview', String((await real('GetSceneList')).currentPreviewSceneName) === off); }
    else console.log('   (Studio Mode is off: Preview step skipped)');
  } else console.log('   (no off-air Gameplay / MVP scene to test layers in)');
  check('Program never changed', String((await real('GetSceneList')).currentProgramSceneName) === prog0);

  // ---- cleanup report (dry run)
  const scenesBefore = JSON.stringify(await sceneNames());
  const rep = await b.cleanupScan();
  check('cleanup report changes nothing', typeof rep !== 'string' && JSON.stringify(await sceneNames()) === scenesBefore, typeof rep === 'string' ? rep : '');
  if (typeof rep !== 'string') {
    for (const s of rep.scenes) console.log(`   [${s.cls}] ${s.scene} — ${s.reasons.join(' ')}`);
    if (process.env.ALLOW_REMOVE === '1') {
      const cons = rep.scenes.filter(x => x.cls === 'consolidate').map(x => x.scene);
      const rr = await b.cleanupApply(rep.hash, cons, rep.nestedAudio, CLEANUP_CONFIRM);
      check('cleanup (ALLOW_REMOVE=1): applied', typeof rr !== 'string', typeof rr === 'string' ? rr : rr.lines.join(' / '));
      const v3 = await b.verify();
      check('Verify after cleanup: all correct', typeof v3 !== 'string' && v3.bad === 0);
    }
  }
  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();

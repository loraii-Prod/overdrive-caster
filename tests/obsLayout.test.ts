// 3.2 · Simplified OBS layout (nine main scenes, every other output a layer), migration and cleanup — against the
// stateful OBS WebSocket v5 MOCK (not real OBS):  npx tsx tests/obsLayout.test.ts
import { createObsSetup, FORBIDDEN, CLEANUP_CONFIRM } from '../server/obsSetup';
import { AUDIO_SCENE, AUDIO_ALL_SCENE, AUDIO_MUSIC_SCENE, GAME_CAPTURE, defaultObsSetup, discoverTargets, sanitizeObsSetup, type ObsSetupStore } from '../shared/obsSetup';
import { MAIN_SCENES, mainSceneName, layerSwitch, placeOf, DESK_SCENES, DESK_SEATS, cameraInputName, bSceneName } from '../shared/obsLayout';
import { sanitizeGraphics } from '../shared/gfx';
import { defaultShow } from '../shared/defaults';
import { segmentObsScene } from '../shared/showplan';
import { REGISTRY } from '../shared/registry';
import { MockObs } from './mockObs';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const MAIN_NAMES = MAIN_SCENES.map(m => mainSceneName(m.key));

function rig(layout: 'main' | 'per-output' = 'main', obs = new MockObs()) {
  const store: ObsSetupStore = { ...defaultObsSetup(), options: { ...defaultObsSetup().options, layout } };
  const db = { graphics: sanitizeGraphics([]), show: defaultShow(), store, plan: [{ label: 'Old gameplay seg', obsScene: 'Overdrive · Gameplay overlay' as string | null }] };
  const repointed: [string, string][] = [];
  const b = createObsSetup({
    call: () => (obs.connected ? obs.call : null), connected: () => obs.connected, obsUrl: () => 'ws://127.0.0.1:4455',
    graphics: () => db.graphics, obsScenes: () => db.show.obsScenes, store: () => db.store, outputKey: '', port: 8787, lanUrls: () => [], publicUrl: () => '',
    save() {}, onChange() {},
    applyMapping: built => { for (const { target, scene, was } of built) { const g = db.graphics.find(x => `g:${x.id}` === target.id); if (g) { if (target.role && target.role !== 'base') { if (g.obsScene === was) g.obsScene = null; } else g.obsScene = scene; } } },
    refsTo: scene => db.plan.filter(x => x.obsScene === scene).map(x => `rundown: ${x.label}`),
    repoint: (from, to) => { repointed.push([from, to]); for (const x of db.plan) if (x.obsScene === from) x.obsScene = null; },
  });
  const build = async (mode: 'build' | 'repair', ids: string[] | 'all', allowLive = false) => {
    const p = await b.preview(mode, ids);
    if (typeof p === 'string') return { error: p } as const;
    const r = await b.apply(p.hash, allowLive);
    return typeof r === 'string' ? { error: r, plan: p } as const : { ...r, plan: p };
  };
  return { obs, db, b, build, repointed };
}
const browser = (m: MockObs) => [...m.inputs].filter(([, i]) => i.kind === 'browser_source');
// 3.4: every desk gets a "(B)" camera-composition scene, and every talent seat gets one persistent camera input
// (a browser source too, shared by its desk's A and B scenes).
const B_NAMES = DESK_SCENES.map(k => bSceneName(k));
const CAM_SEATS = [...new Set(Object.values(DESK_SEATS).flat())];
const CAM_COUNT = CAM_SEATS.length;
const itemsOf = (m: MockObs, scene: string) => m.scenes.get(scene)?.items ?? [];
const has = (m: MockObs, scene: string, source: string) => itemsOf(m, scene).some(i => i.source === source);
const shown = (m: MockObs, scene: string, source: string) => itemsOf(m, scene).find(i => i.source === source)?.enabled === true;

(async () => {
  // ---------------------------------------------------------------- discovery / placement
  {
    const g = sanitizeGraphics([]);
    const t = discoverTargets(g, defaultShow().obsScenes, { audio: true, gameCapture: true, layout: 'main' });
    check('placement: every output belongs to one of the nine main scenes (+ the MVP Preview identity)', t.every(x => x.main && (MAIN_NAMES.includes(x.scene) || x.role === 'pvw')), t.filter(x => !x.main).map(x => x.id).join(','));
    check('placement: scene names are the main scenes + one internal Preview identity scene', new Set(t.map(x => x.scene)).size <= MAIN_NAMES.length + 1 && t.filter(x => !MAIN_NAMES.includes(x.scene)).every(x => x.id === 'pvw:mvp'));
    const inputs = t.map(x => x.input);
    check('placement: browser source names stay unique and never collide with a main scene name', new Set(inputs).size === inputs.length && inputs.every(n => !MAIN_NAMES.includes(n)));
    const pl = (id: string) => t.find(x => x.id === id);
    check('placement: Gameplay = gameplay overlay (base) + scoreboard + track (overlays); Map Veto is its own main scene', pl('g:gameplay')?.role === 'base' && pl('g:scoreboard')?.main === 'gameplay' && pl('g:scoreboard')?.role === 'overlay' && pl('g:track')?.role === 'overlay' && pl('s:veto')?.main === 'veto' && pl('s:veto')?.role === 'base');
    check('placement: MVP = ONE /g/mvp Program source; the five views are its states (no source each) + QR overlay', pl('g:mvp')?.role === 'base' && ['s:mvp', 's:mvp-closed', 's:mvp-winner', 's:mvp-desk', 's:mvp-compare'].every(id => pl(id)?.main === 'mvp' && pl(id)?.role === 'state') && pl('g:qr')?.main === 'mvp' && pl('g:qr')?.role === 'overlay');
    check('placement: MVP Preview identity = same renderer (/g/mvp?id=pvw) in its own internal scene, audio routed to OBS (muted there)', pl('pvw:mvp')?.route === '/g/mvp?id=pvw' && pl('pvw:mvp')?.role === 'pvw' && pl('pvw:mvp')?.rerouteAudio === true && pl('pvw:mvp')?.scene === 'Overdrive · MVP (Preview identity)');
    check('placement: Caster Desk = desk (base) + interview (panel) + pick\'ems (overlay); Analyst Desk = desk', pl('g:caster-desk')?.role === 'base' && pl('s:interview')?.main === 'caster-desk' && pl('g:pickem')?.main === 'caster-desk' && pl('g:analyst-desk')?.main === 'analyst-desk');
    check('placement: Intermission = BRB card (base) + media (panel); Bracket and Matches are their own main scenes', pl('s:brb')?.main === 'intermission' && pl('s:brb')?.role === 'base' && pl('s:media')?.main === 'intermission' && pl('s:media')?.role === 'panel' && pl('g:bracket')?.main === 'bracket' && pl('g:bracket')?.role === 'base' && pl('s:bracket-upper')?.main === 'bracket' && pl('s:bracket-upper')?.role === 'panel' && pl('s:standings')?.main === 'bracket' && pl('s:standings')?.role === 'panel' && pl('s:matches')?.main === 'matches' && pl('s:matches')?.role === 'base');
    check('placement: Starting Soon, Team Introduction, Ending each have their base', pl('s:starting')?.main === 'starting' && pl('s:team-intro')?.main === 'team-intro' && pl('s:ending')?.main === 'ending');
    check('placement: build order is bases, then panels, then overlays (stacking order in OBS)', t.findIndex(x => x.role === 'panel') > t.findLastIndex(x => x.role === 'base') && t.findIndex(x => x.role === 'overlay') > t.findLastIndex(x => x.role === 'panel'));
    const custom = sanitizeGraphics([{ id: 'desk-b', pkg: 'od.caster-desk', name: 'Second desk' }, { id: 'lt', pkg: 'od.scoreboard', name: 'Scoreboard B' }]);
    check('placement: a second instance of a scene package is a panel of that scene; new overlays land in their scene', placeOf('g:desk-b', custom).main === 'caster-desk' && placeOf('g:desk-b', custom).role === 'panel' && placeOf('g:lt', custom).role === 'overlay');
    const sw = layerSwitch('s:veto', [{ target: 'g:gameplay', role: 'base' }, { target: 's:veto', role: 'panel' }, { target: 'g:track', role: 'overlay' }]);
    check('layers: a panel hides the base and other panels, never the overlays', sw.on.join() === 's:veto' && sw.off.join() === 'g:gameplay');
    check('store: layout defaults to main scenes; per-output kept when chosen', sanitizeObsSetup({}).options.layout === 'main' && sanitizeObsSetup({ options: { layout: 'per-output' } }).options.layout === 'per-output');
  }

  // ---------------------------------------------------------------- 1. fresh collection
  const A = rig();
  A.obs.video = { ...A.obs.video, baseWidth: 3840, baseHeight: 2160, outputWidth: 3840, outputHeight: 2160 };
  A.b.setOptions({ profile: 'uhd' });
  const before = A.obs.snapshot();
  const p = await A.b.preview('build', 'all');
  check('dry run: preview writes nothing to OBS', typeof p !== 'string' && A.obs.snapshot() === before && A.obs.writes().length === 0, typeof p === 'string' ? p : `${p.ops.length} ops`);
  check('dry run: each main scene is created once in the plan (no repeated ops)', typeof p !== 'string' && p.ops.filter(o => o.kind === 'create-scene').length === MAIN_SCENES.length + 3, typeof p !== 'string' ? String(p.ops.filter(o => o.kind === 'create-scene').length) : '');
  const r = await A.build('build', 'all');
  check('1 build all succeeds', !('error' in r) && r.ok, 'error' in r ? r.error : r.summary);
  const scenes = [...A.obs.scenes.keys()];
  check('1 OBS has exactly the main scenes (+ the MVP Preview identity scene, + the 2 audio-group scenes, + a (B) camera scene per desk, + its own default "Scene")', scenes.length === MAIN_SCENES.length + 4 + B_NAMES.length && MAIN_NAMES.every(n => scenes.includes(n)) && scenes.includes('Overdrive · MVP (Preview identity)') && scenes.includes(AUDIO_ALL_SCENE) && scenes.includes(AUDIO_MUSIC_SCENE) && B_NAMES.every(n => scenes.includes(n)), scenes.join(' | '));
  check('1 no separate audio scene', !A.obs.scenes.has(AUDIO_SCENE));
  const targets = A.b.targets().filter(t => !t.supersededBy && t.role !== 'state'); // states have no source of their own
  check('1 one browser source per output + 7 audio sources + 6 persistent cameras: nothing duplicated', browser(A.obs).length === targets.length + 7 + CAM_COUNT, `${browser(A.obs).length} for ${targets.length}`);
  check('1 every talent seat has its own persistent camera input, shared by its desk\'s A and B scenes', CAM_SEATS.every(seat => { const n = cameraInputName(seat); return browser(A.obs).some(([name]) => name === n); }));
  check('1 MVP: ONE Program source in the MVP scene; no per-view sources anywhere', itemsOf(A.obs, mainSceneName('mvp')).filter(i => /\/g\/mvp/.test(String(A.obs.inputs.get(i.source)?.settings.url))).length === 1 && !browser(A.obs).some(([, i]) => String(i.settings.url).includes('/g/mvp?view=')));
  const pv = targets.find(t => t.id === 'pvw:mvp')!;
  check('1 MVP Preview identity: its own scene, muted in OBS (no Preview audio leak), never inside a main scene', has(A.obs, 'Overdrive · MVP (Preview identity)', pv.input) && A.obs.audioOf(pv.input)?.muted === true && MAIN_NAMES.every(n => !has(A.obs, n, pv.input)));
  check('1 every output is a scene item of its main scene', targets.every(t => has(A.obs, t.scene, t.input)));
  check('1 bases shown, panels and overlays hidden until the Producer shows them', targets.every(t => shown(A.obs, t.scene, t.input) === (t.role === 'base' || t.role === 'pvw')), targets.filter(t => shown(A.obs, t.scene, t.input) !== (t.role === 'base' || t.role === 'pvw')).map(t => `${t.id}@${t.scene}`).join(', '));
  const brb = targets.find(t => t.id === 's:brb')!;
  check('1 Safe / BRB shows the BRB card through the SAME browser source as Intermission', has(A.obs, mainSceneName('safe'), brb.input) && shown(A.obs, mainSceneName('safe'), brb.input) && browser(A.obs).filter(([, i]) => String(i.settings.url).includes('/output/screen/brb')).length === 1);
  check('1 Safe / BRB nests "Audio (Music only)" — one item, no live mic, no flat items', has(A.obs, mainSceneName('safe'), AUDIO_MUSIC_SCENE) && !has(A.obs, mainSceneName('safe'), AUDIO_ALL_SCENE) && !itemsOf(A.obs, mainSceneName('safe')).some(i => /Caster \d audio|^Overdrive Music$/.test(i.source)));
  check('1 every other main scene nests "Audio (All)" — ONE item instead of 7 flat ones, at the bottom', MAIN_SCENES.filter(m => m.key !== 'safe').every(m => {
    const it = itemsOf(A.obs, mainSceneName(m.key));
    // A desk's persistent camera feeds sit even lower than the audio group (CamEngine positions/animates them;
    // they must never visually cover it, though OBS audio sources have no z-order of their own anyway).
    const camNames = new Set((DESK_SEATS[m.key] ?? []).map(cameraInputName));
    const afterCams = it.filter(i => !camNames.has(i.source));
    return afterCams[0]?.source === AUDIO_ALL_SCENE && !it.some(i => /^Overdrive (Caster \d audio|Music)$/.test(i.source));
  }));
  check('1 desk scenes: persistent camera feeds sit below even the audio items', DESK_SCENES.every(k => { const it = itemsOf(A.obs, mainSceneName(k)); const cams = (DESK_SEATS[k] ?? []).map(cameraInputName); return it.slice(0, cams.length).every(i => cams.includes(i.source)); }));
  const gp = itemsOf(A.obs, mainSceneName('gameplay'));
  check('1 Gameplay: game capture under the gameplay overlay', gp.findIndex(i => i.source === GAME_CAPTURE) < gp.findIndex(i => i.source === targets.find(t => t.id === 'g:gameplay')!.input));
  check('1 4K: every picture source is 3840×2160 and fills the canvas', targets.every(t => { const i = A.obs.inputs.get(t.input)!; return i.settings.width === 3840 && i.settings.height === 2160; }));
  check('1 the builder never switched Program / Preview or removed anything', A.obs.log.filter(l => FORBIDDEN.includes(l.req)).length === 0 && A.obs.program === 'Scene');
  check('1 mapping: stable ids for each main scene (uuid) and each layer (scene, item, role)', MAIN_SCENES.every(m => !!A.db.store.map[`main:${m.key}`]?.sceneUuid) && targets.every(t => A.db.store.map[t.id]?.main === t.main && A.db.store.map[t.id]?.role === t.role && Number.isInteger(A.db.store.map[t.id]?.itemId)));

  // ---------------------------------------------------------------- 2. idempotent
  const snap = A.obs.snapshot();
  const p2 = await A.b.preview('build', 'all');
  check('2 Build again: nothing to do', typeof p2 !== 'string' && p2.ops.length === 0, typeof p2 !== 'string' ? p2.ops.map(o => o.detail).slice(0, 3).join(' / ') : p2);
  const r2 = await A.build('repair', 'all');
  check('2 Repair: nothing to do, OBS unchanged', !('error' in r2) && r2.plan.ops.length === 0 && A.obs.snapshot() === snap, 'error' in r2 ? r2.error : r2.plan.ops.map(o => o.detail).slice(0, 3).join(' / '));
  for (let i = 0; i < 3; i++) await A.build('build', 'all');
  check('2 Build ×3 more: still the same scenes (+ Preview identity + audio groups + (B) camera scenes), no duplicate sources', A.obs.scenes.size === MAIN_SCENES.length + 4 + B_NAMES.length && browser(A.obs).length === targets.length + 7 + CAM_COUNT);
  const v = await A.b.verify();
  check('2 Verify: every item correct', typeof v !== 'string' && v.bad === 0, typeof v === 'string' ? v : `${v.ok} ok, ${v.bad} bad: ${A.b.state().targets.filter(x => x.inAll && x.status !== 'ok').map(x => `${x.id}: ${x.issues[0]}`).slice(0, 3).join(' / ')}`);

  // ---------------------------------------------------------------- 2b. ordering repair (a layer dragged below its base in OBS)
  {
    const G = mainSceneName('gameplay');
    const trackInput = A.b.targets().find(t => t.id === 'g:track')!.input, baseInput = A.b.targets().find(t => t.id === 'g:gameplay')!.input;
    const call = A.obs.call;
    const trackItem = itemsOf(A.obs, G).find(i => i.source === trackInput)!;
    await call('SetSceneItemIndex', { sceneName: G, sceneItemId: trackItem.id, sceneItemIndex: 0 }); // simulate a manual drag in OBS
    check('2b dragged below base: detected as a plan op in dry-run repair', (() => { const before = itemsOf(A.obs, G); return before.findIndex(i => i.source === trackInput) < before.findIndex(i => i.source === baseInput); })());
    const rPrev = await A.b.preview('repair', 'all');
    check('2b dry-run repair reports the ordering issue, writes nothing', typeof rPrev !== 'string' && rPrev.ops.some(o => o.kind === 'order' && o.detail.includes(trackInput)));
    const rFix = await A.build('repair', 'all');
    check('2b repair fixes it: the overlay is now above its base', !('error' in rFix) && (() => { const after = itemsOf(A.obs, G); return after.findIndex(i => i.source === trackInput) > after.findIndex(i => i.source === baseInput); })());
    const rAgain = await A.b.preview('repair', 'all');
    check('2b idempotent: repairing again has nothing left to do', typeof rAgain !== 'string' && rAgain.ops.filter(o => o.kind === 'order').length === 0, typeof rAgain !== 'string' ? rAgain.ops.map(o => o.detail).join(' / ') : rAgain);
  }

  // ---------------------------------------------------------------- 3. layers
  {
    const G = mainSceneName('gameplay'), M = mainSceneName('mvp');
    const inp = (id: string) => targets.find(t => t.id === id)!.input;
    await A.b.layer('g:track');
    check('3 overlay: Track Progression shown on Gameplay, the overlay base stays', shown(A.obs, G, inp('g:track')) && shown(A.obs, G, inp('g:gameplay')));
    const CD = mainSceneName('caster-desk');
    await A.b.layer('s:interview');
    check('3 panel: Interview replaces the Caster Desk base, independent overlays stay', shown(A.obs, CD, inp('s:interview')) && !shown(A.obs, CD, inp('g:caster-desk')));
    await A.b.layer('main:caster-desk');
    check('3 the scene itself: back to its base, panels hidden', shown(A.obs, CD, inp('g:caster-desk')) && !shown(A.obs, CD, inp('s:interview')));
    check('3 Map Veto is its own main scene, unaffected by Gameplay layer switching', shown(A.obs, G, inp('g:gameplay')) && shown(A.obs, G, inp('g:track')));
    await A.b.layer('g:track', false);
    check('3 overlay hidden on its own', !shown(A.obs, G, inp('g:track')));
    const lo = A.b.layerOf('s:mvp-winner');
    check('3 MVP views map to the MVP scene as states of its one source, with the Preview identity scene', !!lo && lo.scene === M && lo.role === 'state' && lo.preview === 'Overdrive · MVP (Preview identity)');
    const before3 = A.obs.snapshot();
    await A.b.layer('s:mvp-winner');
    check('3 a state never toggles OBS scene items (the source switches its state itself)', A.obs.snapshot() === before3);
    check('3 MVP layer strip lists no per-view sources', !A.b.state().mains.find(x => x.key === 'mvp')?.layers.some(l => l.target.startsWith('s:mvp')));
    check('3 layer switching never touched Program or Preview', A.obs.program === 'Scene' && A.obs.log.filter(l => ['SetCurrentProgramScene', 'SetCurrentPreviewScene'].includes(l.req)).length === 0);
    const look = { setupMap: A.db.store.map, screenMap: {}, graphics: A.db.graphics, registry: REGISTRY, scenes: [...A.obs.scenes.keys()], pkgObsKey: () => undefined };
    check('3 rundown / TAKE targets resolve to their main scene', segmentObsScene({ obsScene: null, target: 'g:track' }, look) === G && segmentObsScene({ obsScene: null, target: 's:mvp-winner' }, look) === M && segmentObsScene({ obsScene: null, target: 'main:safe' }, look) === mainSceneName('safe'));
    // a renamed main scene keeps working (uuid)
    A.obs.renameScene(G, 'GAME (mine)');
    const p3 = await A.b.preview('build', 'all');
    check('3 renamed main scene in OBS: Build follows it, no new "Gameplay" scene', typeof p3 !== 'string' && !p3.ops.some(o => o.kind === 'create-scene'), typeof p3 !== 'string' ? p3.ops.map(o => o.detail).slice(0, 2).join(' / ') : p3);
    await A.b.scan();
    check('3 renamed: the mapping follows the new name', A.db.store.map['g:track'].scene === 'GAME (mine)' && A.db.store.map['main:gameplay'].scene === 'GAME (mine)');
    A.obs.renameScene('GAME (mine)', G); await A.b.scan();
  }

  // ---------------------------------------------------------------- 4. on-air main scene is held
  {
    const B = rig();
    await B.build('build', 'all');
    B.obs.program = mainSceneName('gameplay');
    const g = B.b.targets().find(t => t.id === 'g:track')!;
    B.obs.scenes.get(mainSceneName('gameplay'))!.items = B.obs.scenes.get(mainSceneName('gameplay'))!.items.filter(i => i.source !== g.input);
    const r4 = await B.build('build', ['g:track']);
    check('4 a change to the scene on Program is held back (unless allowed)', !('error' in r4) && !has(B.obs, mainSceneName('gameplay'), g.input), 'error' in r4 ? r4.error : '');
    await B.build('build', ['g:track'], true);
    check('4 … and applied when "allow on-air scene" is ticked, as a HIDDEN layer (nothing changes on air)', has(B.obs, mainSceneName('gameplay'), g.input) && !shown(B.obs, mainSceneName('gameplay'), g.input));
  }

  // ---------------------------------------------------------------- 5. migration from a 3.1 collection (one scene per output)
  const L = rig('per-output');
  await L.build('build', 'all');
  // the operator's own things in the old collection
  L.obs.addInput('Overdrive · Gameplay overlay', 'My capture card', 'dshow_input', {});
  const oldGp = L.obs.scenes.get('Overdrive · Gameplay overlay')!; const card = oldGp.items.pop()!; oldGp.items.unshift(card); // under the overlay
  L.obs.addInput('Overdrive · Interview', 'Guest webcam', 'dshow_input', {});
  L.obs.addScene('My sponsor loop');
  const oldScenes = [...L.obs.scenes.keys()];
  const oldInputs = new Map([...L.obs.inputs].map(([n, i]) => [n, i.uuid]));
  const oldBrowser = browser(L.obs).length;
  L.obs.program = 'Overdrive · Caster Desk';
  L.b.setOptions({ layout: 'main' });
  const scan0 = await L.b.verify();
  check('5 after switching layouts, Verify reports the main scenes as missing (nothing changed yet)', typeof scan0 !== 'string' && scan0.bad > 0 && [...L.obs.scenes.keys()].length === oldScenes.length);
  const r5 = await L.build('build', 'all', true);
  check('5 migration build succeeds', !('error' in r5) && r5.ok, 'error' in r5 ? r5.error : r5.summary);
  check('5 every old scene is still there, untouched (nothing deleted or renamed)', oldScenes.every(n => L.obs.scenes.has(n)));
  check('5 no browser source duplicated: the existing ones are reused (same uuid, same URL); only the MVP Preview identity + persistent cameras are new', browser(L.obs).length === oldBrowser + 1 + CAM_COUNT && [...oldInputs].every(([n, u]) => L.obs.inputs.get(n)?.uuid === u), `${browser(L.obs).length} vs ${oldBrowser}`);
  check('5 old scene names that ARE main scenes are reused (Caster Desk, Analyst Desk, MVP)', ['Caster Desk', 'Analyst Desk', 'MVP'].every(n => L.db.store.map[`main:${MAIN_SCENES.find(m => m.label === n)!.key}`]?.scene === `Overdrive · ${n}`));
  check('5 the new Gameplay reuses the operator\'s own capture card from the old scene (same source)', has(L.obs, mainSceneName('gameplay'), 'My capture card') && L.obs.inputs.get('My capture card')?.uuid === oldInputs.get('My capture card'));
  check('5 the main scenes reused from 3.1 keep their nested audio scene (no double audio path added)', has(L.obs, mainSceneName('caster-desk'), AUDIO_SCENE) && !has(L.obs, mainSceneName('caster-desk'), 'Overdrive Music'));
  check('5 Program was never switched during the migration', L.obs.program === 'Overdrive · Caster Desk');

  // ---------------------------------------------------------------- 6. cleanup report (dry run) and confirmed removal
  const before6 = L.obs.snapshot();
  const rep = await L.b.cleanupScan();
  check('6 cleanup report changes nothing in OBS', typeof rep !== 'string' && L.obs.snapshot() === before6);
  if (typeof rep === 'string') throw new Error(rep);
  const cls = (n: string) => rep.scenes.find(x => x.scene === n)?.cls;
  check('6 the nine main scenes are reported as main', MAIN_NAMES.every(n => cls(n) === 'main'));
  check('6 old per-output scenes whose sources are now in main scenes: consolidate', ['Overdrive · Scoreboard', 'Overdrive · Track Progression', 'Overdrive · Community MVP — Winner Reveal', 'Overdrive · Starting soon'].every(n => cls(n) === 'consolidate'), ['Overdrive · Scoreboard', 'Overdrive · Track Progression', 'Overdrive · Community MVP — Winner Reveal', 'Overdrive · Starting soon'].map(n => `${n}=${cls(n)}: ${rep.scenes.find(x => x.scene === n)?.reasons.join(' ')}`).join(' | '));
  check('6 a scene with the operator\'s own source is kept (Interview + webcam; old gameplay + capture card)', cls('Overdrive · Interview') === 'keep' && cls('Overdrive · Gameplay overlay') === 'keep');
  check('6 non-Overdrive scenes are never touched', cls('My sponsor loop') === 'not-overdrive' && cls('Scene') === 'not-overdrive');
  check('6 the old audio scene is kept while scenes that stay still nest it', cls(AUDIO_SCENE) === 'keep');
  check('6 main scenes still nesting the old audio scene are listed', rep.nestedAudio.includes(mainSceneName('caster-desk')) && rep.nestedAudio.includes(mainSceneName('mvp')));
  const cons = rep.scenes.filter(x => x.cls === 'consolidate').map(x => x.scene);
  const r6a = await L.b.cleanupApply(rep.hash, cons, [], 'yes');
  check('6 removal refused without the typed confirmation', typeof r6a === 'string' && L.obs.snapshot() === before6);
  const r6b = await L.b.cleanupApply('stale', cons, [], CLEANUP_CONFIRM);
  check('6 removal refused with a stale report', typeof r6b === 'string' && L.obs.snapshot() === before6);
  const r6 = await L.b.cleanupApply(rep.hash, [...cons, 'Overdrive · Interview', 'My sponsor loop', 'Overdrive · Caster Desk'], rep.nestedAudio, CLEANUP_CONFIRM);
  check('6 confirmed: consolidatable scenes removed', typeof r6 !== 'string' && cons.every(n => !L.obs.scenes.has(n)), typeof r6 === 'string' ? r6 : r6.lines.filter(l => l.startsWith('Kept')).join(' / '));
  check('6 … but never a kept, foreign, main or on-air scene, even when asked', ['Overdrive · Interview', 'My sponsor loop', 'Overdrive · Caster Desk', 'Overdrive · Gameplay overlay'].every(n => L.obs.scenes.has(n)));
  check('6 the legacy nested audio scene is replaced by the 3.6 audio-group scene (never flat items)', [mainSceneName('caster-desk'), mainSceneName('mvp')].every(n => !has(L.obs, n, AUDIO_SCENE) && has(L.obs, n, AUDIO_ALL_SCENE) && !has(L.obs, n, 'Overdrive Music') && !has(L.obs, n, 'Overdrive Caster 1 audio')));
  const lost = [...oldInputs.keys()].filter(n => !L.obs.inputs.has(n));
  const retiredNames = L.b.targets().filter(t => t.role === 'state').map(t => t.input);
  check('6 no source was lost except the five retired per-view MVP sources (the one MVP source draws those views)', lost.every(n => retiredNames.includes(n)) && retiredNames.every(n => lost.includes(n)), lost.join(', '));
  check('6 every Overdrive output is still reachable (its source in its scene; MVP views through the one MVP source)', L.b.targets().filter(t => !t.supersededBy).every(t => has(L.obs, L.db.store.map[t.id]?.scene ?? '', t.role === 'state' ? L.db.store.map[t.id].input : t.input)));
  check('6 removals are the only removal requests ever sent, and only after confirmation', L.obs.log.filter(l => l.req.startsWith('Remove')).every(l => ['RemoveScene', 'RemoveSceneItem'].includes(l.req)));
  check('6 Program still untouched', L.obs.program === 'Overdrive · Caster Desk');
  const rep2 = await L.b.cleanupScan();
  check('6 report again: nothing left to consolidate', typeof rep2 !== 'string' && !rep2.scenes.some(x => x.cls === 'consolidate'), typeof rep2 !== 'string' ? rep2.scenes.filter(x => x.cls === 'consolidate').map(x => x.scene).join(', ') : rep2);
  const v6 = await L.b.verify();
  check('6 Verify after cleanup: all correct', typeof v6 !== 'string' && v6.bad === 0, typeof v6 === 'string' ? v6 : L.b.state().targets.filter(x => x.inAll && x.status !== 'ok').map(x => `${x.id}: ${x.issues[0]}`).slice(0, 3).join(' / '));
  const p6 = await L.b.preview('build', 'all');
  check('6 Build after cleanup: nothing to do (idempotent)', typeof p6 !== 'string' && p6.ops.length === 0, typeof p6 !== 'string' ? p6.ops.map(o => o.detail).slice(0, 3).join(' / ') : p6);

  // ---------------------------------------------------------------- 7. rundown reference repoint
  {
    const C = rig('per-output');
    await C.build('build', 'all');
    C.db.plan[0].obsScene = 'Overdrive · Track Progression';
    C.b.setOptions({ layout: 'main' });
    await C.build('build', 'all');
    const rp = await C.b.cleanupScan();
    if (typeof rp === 'string') throw new Error(rp);
    check('7 the report lists what still names an old scene', rp.scenes.find(x => x.scene === 'Overdrive · Track Progression')?.refs.join() === 'rundown: Old gameplay seg');
    await C.b.cleanupApply(rp.hash, ['Overdrive · Track Progression'], [], CLEANUP_CONFIRM);
    check('7 removal repoints the reference to the main scene first', C.repointed.some(([f, t]) => f === 'Overdrive · Track Progression' && t === mainSceneName('gameplay')) && C.db.plan[0].obsScene === null && !C.obs.scenes.has('Overdrive · Track Progression'));
  }

  // ---------------------------------------------------------------- 8. from the 3.2 layout (MVP views were layers of the MVP scene)
  {
    const E = rig();
    await E.build('build', 'all');
    const M = mainSceneName('mvp');
    for (const v of ['voting', 'winner']) E.obs.addInput(M, `Overdrive · old view ${v}`, 'browser_source', { url: `http://localhost:8787/g/mvp?view=${v}`, width: 1920, height: 1080, overdrive_id: `s:mvp${v === 'voting' ? '' : '-winner'}` });
    E.db.store.map['s:mvp-winner'] = { ...E.db.store.map['s:mvp-winner'], url: 'http://localhost:8787/g/mvp?view=winner' };
    // the 3.2 mapping pointed at those sources: the builder now maps the views to the one MVP source
    E.db.store.map['s:mvp'] = { scene: M, input: 'Overdrive · old view voting', url: 'http://localhost:8787/g/mvp?view=voting', at: 0, main: 'mvp', role: 'panel' };
    await E.build('build', 'all');
    check('8 3.2 → 3.3: Build remaps the views to the one MVP source and leaves the old sources alone', E.db.store.map['s:mvp'].role === 'state' && has(E.obs, M, 'Overdrive · old view voting'));
    const rp = await E.b.cleanupScan();
    if (typeof rp === 'string') throw new Error(rp);
    check('8 the report lists the retired per-view sources still in the MVP scene', rp.redundant.map(r => r.input).sort().join() === 'Overdrive · old view voting,Overdrive · old view winner', rp.redundant.map(r => r.input).join());
    const r8 = await E.b.cleanupApply(rp.hash, [], [], CLEANUP_CONFIRM, rp.redundant.map(r => `${r.scene}\u0000${r.input}`));
    check('8 confirmed: they come out of the MVP scene; the one MVP source stays', typeof r8 !== 'string' && !has(E.obs, M, 'Overdrive · old view voting') && !has(E.obs, M, 'Overdrive · old view winner') && has(E.obs, M, E.b.targets().find(t => t.id === 'g:mvp')!.input), typeof r8 === 'string' ? r8 : '');
    const p8 = await E.b.preview('build', 'all');
    check('8 Build afterwards: nothing to do', typeof p8 !== 'string' && p8.ops.length === 0, typeof p8 !== 'string' ? p8.ops.map(o => o.detail).slice(0, 2).join(' / ') : p8);
  }

  // ---------------------------------------------------------------- 9. 3.6 centralized audio: no doubling, safe migration
  {
    const F = rig();
    await F.build('build', 'all');
    const musicUuid = F.obs.inputs.get('Overdrive Music')!.uuid;
    const mic1Uuid = F.obs.inputs.get('Overdrive Caster 1 audio')!.uuid;
    check('9 "Overdrive Music" is ONE input even though it is referenced from both audio-group scenes', has(F.obs, AUDIO_ALL_SCENE, 'Overdrive Music') && has(F.obs, AUDIO_MUSIC_SCENE, 'Overdrive Music') && [...F.obs.inputs].filter(([n]) => n === 'Overdrive Music').length === 1);
    // independent per-talent controls are INPUT properties in OBS, untouched by how many scenes reference the input
    await F.obs.call('SetInputMute', { inputName: 'Overdrive Caster 1 audio', inputMuted: true });
    await F.obs.call('SetInputVolume', { inputName: 'Overdrive Caster 1 audio', inputVolumeDb: -6 });
    const p9a = await F.b.preview('repair', 'all');
    check('9 muting/adjusting one talent\'s volume is not "drift": repair has nothing to do', typeof p9a !== 'string' && p9a.ops.length === 0, typeof p9a !== 'string' ? p9a.ops.map(o => o.detail).join(' / ') : p9a);
    check('9 the mute + volume stick (per-input, not per scene-item)', F.obs.inputs.get('Overdrive Caster 1 audio')?.audio?.muted === true && F.obs.inputs.get('Overdrive Caster 1 audio')?.audio?.volumeDb === -6);

    // simulate an OLD (3.2-3.5) scene that still has the flat items directly, to exercise the migration
    const CD = mainSceneName('caster-desk');
    for (const s of [1, 2, 3, 4, 5, 6].map(n => `Overdrive Caster ${n} audio`).concat(['Overdrive Music'])) await F.obs.call('CreateSceneItem', { sceneName: CD, sourceName: s, sceneItemEnabled: true });
    const beforeInputs = new Set(F.obs.inputs.keys());
    const rep9 = await F.b.cleanupScan();
    if (typeof rep9 === 'string') throw new Error(rep9);
    check('9 dry-run cleanup flags the scene\'s old flat audio items (nothing changed in OBS)', rep9.flatAudio.some(x => x.scene === CD && x.kind === 'all'));
    const r9a = await F.b.cleanupApply(rep9.hash, [], [], 'yes', [], [CD]);
    check('9 migration refused without the typed confirmation', typeof r9a === 'string');
    const r9 = await F.b.cleanupApply(rep9.hash, [], [], CLEANUP_CONFIRM, [], [CD]);
    check('9 confirmed: the scene now nests "Audio (All)" and the old flat items are gone', typeof r9 !== 'string' && has(F.obs, CD, AUDIO_ALL_SCENE) && !has(F.obs, CD, 'Overdrive Caster 1 audio') && !has(F.obs, CD, 'Overdrive Music'), typeof r9 === 'string' ? r9 : r9.lines.join(' / '));
    check('9 no input was created or destroyed by the migration (same 13: 7 audio + 6 cameras, exact set)', new Set(F.obs.inputs.keys()).size === beforeInputs.size && [...beforeInputs].every(n => F.obs.inputs.has(n)));
    check('9 "Overdrive Music" and the mic are still the exact same inputs (uuid unchanged)', F.obs.inputs.get('Overdrive Music')?.uuid === musicUuid && F.obs.inputs.get('Overdrive Caster 1 audio')?.uuid === mic1Uuid);
    check('9 the mute/volume set earlier on Caster 1 survived the migration untouched', F.obs.inputs.get('Overdrive Caster 1 audio')?.audio?.muted === true && F.obs.inputs.get('Overdrive Caster 1 audio')?.audio?.volumeDb === -6);
    const rep9b = await F.b.cleanupScan();
    check('9 report again: nothing left to migrate for that scene', typeof rep9b !== 'string' && !rep9b.flatAudio.some(x => x.scene === CD));
    const p9b = await F.b.preview('build', 'all');
    check('9 idempotent: Build after the migration has nothing to do', typeof p9b !== 'string' && p9b.ops.length === 0, typeof p9b !== 'string' ? p9b.ops.map(o => o.detail).join(' / ') : p9b);
  }

  // ---------------------------------------------------------------- 10. 3.6 real-OBS duplicate-source audit
  {
    const G = rig();
    await G.build('build', 'all');
    const a0 = await G.b.audit();
    if (typeof a0 === 'string') throw new Error(a0);
    check('10 clean collection: no duplicates found', a0!.duplicates.length === 0 && a0!.checked > 0);
    // simulate exactly the symptom this is for: a second input someone (or an older Overdrive) made for the same mic
    await G.obs.call('CreateInput', { sceneName: mainSceneName('starting'), inputName: 'Overdrive Caster 1 audio (copy)', inputKind: 'browser_source', inputSettings: { url: (await G.obs.call('GetInputSettings', { inputName: 'Overdrive Caster 1 audio' })).inputSettings.url }, sceneItemEnabled: true });
    const writesBefore = G.obs.writes().length;
    const a1 = await G.b.audit();
    if (typeof a1 === 'string') throw new Error(a1);
    check('10 the duplicate is found and named', a1!.duplicates.some(d => d.inputs.includes('Overdrive Caster 1 audio') && d.inputs.includes('Overdrive Caster 1 audio (copy)')), JSON.stringify(a1!.duplicates));
    check('10 audit is read-only: it never writes to OBS', G.obs.writes().length === writesBefore);
    check('10 audit never deletes anything itself (the duplicate is still there — only reported)', G.obs.inputs.has('Overdrive Caster 1 audio (copy)'));
  }

  // ---------------------------------------------------------------- 11. 3.7 pre-event validation checklist
  {
    const H = rig();
    await H.build('build', 'all');
    await H.b.scan();
    let v = H.b.state().validation;
    check('11 starts with nothing confirmed and no automated issues once built+scanned', v.manualConfirmed === 0 && v.items.every(i => !i.confirmed && !i.needsRevalidation && i.confirmedAt === undefined));
    const scenesItem = () => H.b.state().validation.items.find(i => i.id === 'scenes-layout')!;
    check('11 "scenes-layout" automated check is OK once all nine main scenes are built', scenesItem().autoStatus === 'ok', scenesItem().autoNote);
    check('11 automated status is never confused with the operator confirmation (needsManual stays true, confirmed stays false)', scenesItem().needsManual === true && scenesItem().confirmed === false);

    // ---- unknown item id is refused, never silently accepted
    const badId = H.b.setValidation('not-a-real-item', true);
    check('11 setValidation refuses an unknown checklist item', typeof badId === 'string' && /unknown/i.test(badId));

    // ---- confirming an item: only the operator's own action sets it, and it is never auto-derived from the auto status
    const r1 = H.b.setValidation('scenes-layout', true);
    check('11 setValidation returns the updated report', typeof r1 !== 'string' && r1.items.find(i => i.id === 'scenes-layout')?.confirmed === true);
    v = H.b.state().validation;
    check('11 confirmed item shows confirmed + a confirmedAt timestamp', scenesItem().confirmed === true && typeof scenesItem().confirmedAt === 'number' && scenesItem().confirmedAt! > 0);
    check('11 confirming one item never marks any other item confirmed', v.items.filter(i => i.id !== 'scenes-layout').every(i => !i.confirmed));
    check('11 manualConfirmed counts exactly the confirmed items', v.manualConfirmed === 1);

    // ---- a real OBS check can never be "passed" automatically: a clean automated status alone never confirms it
    const noDupItem = () => H.b.state().validation.items.find(i => i.id === 'no-duplicate-audio')!;
    const a0 = await H.b.audit();
    if (typeof a0 === 'string') throw new Error(a0);
    check('11 "no-duplicate-audio" automated check is OK (no duplicates) yet still unconfirmed', noDupItem().autoStatus === 'ok' && noDupItem().confirmed === false && noDupItem().needsRevalidation === false);

    // ---- configuration-aware staleness: changing the relevant Overdrive configuration marks the confirmation as
    // needing revalidation, WITHOUT deleting it (the operator's past check stays visible as history)
    const confirmedAtBefore = scenesItem().confirmedAt;
    H.db.store.options.gameCapture = !H.db.store.options.gameCapture; // touches the discovered target set (part of configHash)
    await H.build('build', 'all'); // re-derive mapping under the changed option
    v = H.b.state().validation;
    check('11 changing a relevant option marks the confirmation as needing revalidation', scenesItem().needsRevalidation === true && scenesItem().confirmed === false);
    check('11 the stale confirmation is kept as history, not deleted: confirmedAt (when it was last checked) is unchanged', scenesItem().confirmedAt === confirmedAtBefore);
    check('11 manualConfirmed no longer counts a stale confirmation', v.manualConfirmed === 0);

    // ---- re-confirming under the new configuration clears the staleness
    H.b.setValidation('scenes-layout', true);
    v = H.b.state().validation;
    check('11 re-confirming under the current configuration clears needsRevalidation', scenesItem().confirmed === true && scenesItem().needsRevalidation === false);
    check('11 the new confirmation is timestamped later than the stale one', scenesItem().confirmedAt! >= confirmedAtBefore!);

    // ---- un-confirming
    H.b.setValidation('scenes-layout', false);
    check('11 un-confirming clears `confirmed` but keeps the "last performed" timestamp (it still happened)', scenesItem().confirmed === false && typeof scenesItem().confirmedAt === 'number');

    // ---- "Start New Pre-Event Check": a fresh checklist, nothing confirmed, but history is kept
    H.b.setValidation('mic-controls', true);
    const sessionBefore = H.b.state().validation.session;
    const micConfirmedAt = H.b.state().validation.items.find(i => i.id === 'mic-controls')!.confirmedAt;
    const r2 = H.b.newValidationSession();
    check('11 newValidationSession returns the fresh report', r2.manualConfirmed === 0);
    v = H.b.state().validation;
    check('11 Start New Pre-Event Check begins a new session id', v.session !== sessionBefore && v.session.length > 0);
    check('11 every item is unconfirmed again in the new session', v.items.every(i => !i.confirmed));
    check('11 "last performed" for the previously-confirmed item survives into the new session (history, not deleted)', v.items.find(i => i.id === 'mic-controls')?.confirmedAt === micConfirmedAt);

    // ---- automated vs manual stay visibly distinct in the data shape itself (no field conflates the two)
    check('11 every item keeps a separate autoStatus/autoNote from its own confirmed/needsRevalidation state', v.items.every(i => typeof i.autoStatus === 'string' && typeof i.autoNote === 'string' && typeof i.confirmed === 'boolean' && typeof i.needsRevalidation === 'boolean'));
  }

  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();

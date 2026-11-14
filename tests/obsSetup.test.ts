// OBS Scene Builder tests against a stateful OBS WebSocket v5 MOCK (not real OBS): npx tsx tests/obsSetup.test.ts
import { createObsSetup, FORBIDDEN } from '../server/obsSetup';
import { AUDIO_SCENE, GAME_CAPTURE, defaultObsSetup, discoverTargets, sanitizeObsSetup, targetUrl, nativeSizeOf, itemScale, sourceQuality, canvasQuality } from '../shared/obsSetup';
import { sanitizeGraphics } from '../shared/gfx';
import { defaultShow } from '../shared/defaults';
import { MockObs } from './mockObs';
import { dockEntries, dockInstallerPs1, dockInstallerSh, isControllerRoute, controllerPath } from '../shared/obsDocks';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

function rig(o: { obsUrl?: string; lan?: string[]; key?: string; pub?: string } = {}) {
  const obs = new MockObs();
  const db = { graphics: sanitizeGraphics([]), show: defaultShow(), store: defaultObsSetup() };
  const mapped: { id: string; scene: string }[] = [];
  const b = createObsSetup({
    call: () => (obs.connected ? obs.call : null), connected: () => obs.connected, obsUrl: () => o.obsUrl ?? 'ws://127.0.0.1:4455',
    graphics: () => db.graphics, obsScenes: () => db.show.obsScenes, store: () => db.store, outputKey: o.key ?? '', port: 8787, lanUrls: () => o.lan ?? [], publicUrl: () => o.pub ?? '',
    save() {}, onChange() {},
    applyMapping: built => { for (const { target, scene } of built) { mapped.push({ id: target.id, scene }); const g = db.graphics.find(x => `g:${x.id}` === target.id); if (g) g.obsScene = scene; } },
  });
  /** Preview then confirm (what the Studio Mode buttons do). */
  const build = async (mode: 'build' | 'repair', ids: string[] | 'all', allowLive = false) => {
    const p = await b.preview(mode, ids);
    if (typeof p === 'string') return { error: p } as const;
    const r = await b.apply(p.hash, allowLive);
    return typeof r === 'string' ? { error: r, plan: p } as const : { ...r, plan: p };
  };
  return { obs, db, b, build, mapped };
}
const forbidden = (m: MockObs) => m.log.filter(l => FORBIDDEN.includes(l.req));
const browserInputs = (m: MockObs) => [...m.inputs].filter(([, i]) => i.kind === 'browser_source');

(async () => {
  // ---------------------------------------------------------------- discovery
  {
    const t = discoverTargets(sanitizeGraphics([]), defaultShow().obsScenes, { audio: true, gameCapture: true });
    const names = [...t.map(x => x.scene), ...t.map(x => x.input)];
    check('discovery: every graphics instance and every registry source is a target', t.filter(x => x.kind === 'gfx').length === sanitizeGraphics([]).length && t.filter(x => x.kind !== 'gfx').length === 14, `${t.length} targets`);
    check('discovery: scene + source names unique across OBS name space', new Set(names).size === names.length);
    check('discovery: no target uses /output/program', t.every(x => !x.route.includes('/output/program')));
    check('discovery: legacy screens replaced by an engine graphic are marked (caster desk, analyst desk, gameplay, bracket, scoreboard)', ['s:caster-desk', 's:analyst-desk', 's:gameplay', 's:bracket', 's:scoreboard'].every(id => t.find(x => x.id === id)?.supersededBy));
    check('discovery: a new graphics instance becomes a target automatically', discoverTargets(sanitizeGraphics([{ id: 'lower-third-2', pkg: 'od.scoreboard', name: 'Scoreboard B' }]), defaultShow().obsScenes, { audio: true, gameCapture: true }).some(x => x.id === 'g:lower-third-2' && x.route === '/g/lower-third-2'));
    check('url: key appended without breaking an existing query', targetUrl('http://h:1', '/output/major?part=2', 'k k') === 'http://h:1/output/major?part=2&key=k%20k' && targetUrl('http://h:1', '/g/x', '') === 'http://h:1/g/x');
    check('store: sanitizer drops a base URL with a path', sanitizeObsSetup({ options: { baseUrl: 'http://x:1/evil' } }).options.baseUrl === '' && sanitizeObsSetup({ options: { baseUrl: 'http://192.168.1.5:8787/' } }).options.baseUrl === 'http://192.168.1.5:8787');
  }

  // ---------------------------------------------------------------- 1. empty collection
  const A = rig();
  const before = A.obs.snapshot();
  const p1 = await A.b.preview('build', 'all');
  check('dry run: preview changes nothing in OBS', typeof p1 !== 'string' && A.obs.snapshot() === before && A.obs.writes().length === 0, typeof p1 === 'string' ? p1 : `${p1.ops.length} ops`);
  const r1 = await A.build('build', 'all');
  const all = A.b.targets().filter(t => !t.supersededBy);
  check('1 empty collection: build all succeeds', !('error' in r1) && r1.ok, 'error' in r1 ? r1.error : r1.summary);
  check('1 one OBS scene per output (+ shared audio scene, + OBS default "Scene")', A.obs.scenes.size === all.length + 2, `${A.obs.scenes.size} scenes for ${all.length} outputs`);
  const oneEach = all.every(t => { const s = A.obs.scenes.get(t.scene)!; const own = s?.items.filter(i => A.obs.inputs.get(i.source)?.kind === 'browser_source'); return own?.length === 1 && own[0].source === t.input && A.obs.inputs.get(t.input)!.settings.url === targetUrl('http://localhost:8787', t.route, ''); });
  check('1 every scene holds exactly its OWN browser source with its own URL', oneEach);
  check('1 no master scene: no scene contains two Overdrive outputs', [...A.obs.scenes.values()].every(s => s.items.filter(i => String(A.obs.inputs.get(i.source)?.settings.overdrive_id ?? '').startsWith('g:') || String(A.obs.inputs.get(i.source)?.settings.overdrive_id ?? '').startsWith('s:')).length <= 1));
  check('1 no /output/program source anywhere', browserInputs(A.obs).every(([, i]) => !String(i.settings.url).includes('/output/program')));
  const gp = A.obs.scenes.get(all.find(t => t.id === 'g:gameplay')!.scene)!;
  check('1 gameplay: game capture at the bottom, overlay above it', gp.items[0].source === GAME_CAPTURE && gp.items.findIndex(i => i.source === all.find(t => t.id === 'g:gameplay')!.input) > 0);
  check('1 shared audio scene built once with 6 mics + music, nested everywhere', A.obs.scenes.get(AUDIO_SCENE)!.items.length === 7 && all.every(t => A.obs.scenes.get(t.scene)!.items.filter(i => i.source === AUDIO_SCENE).length === 1));
  check('1 media playback routes its audio to the OBS mixer', A.obs.inputs.get(all.find(t => t.id === 's:media')!.input)!.settings.reroute_audio === true);

  // ---------------------------------------------------------------- 9. dimensions + transforms
  check('9 every output browser source is 1920×1080', all.every(t => { const s = A.obs.inputs.get(t.input)!.settings; return s.width === 1920 && s.height === 1080; }));
  check('9 every output fills the canvas (stretch to 1920×1080 at 0,0)', all.every(t => { const it = A.obs.scenes.get(t.scene)!.items.find(i => i.source === t.input)!; return it.transform.boundsType === 'OBS_BOUNDS_STRETCH' && it.transform.boundsWidth === 1920 && it.transform.boundsHeight === 1080 && it.transform.positionX === 0 && it.enabled; }));

  // ---------------------------------------------------------------- 2. idempotent
  const snap1 = A.obs.snapshot();
  const p2 = await A.b.preview('build', 'all');
  const p2r = await A.b.preview('repair', 'all');
  check('2 second build: nothing to do (build and repair)', typeof p2 !== 'string' && p2.ops.length === 0 && typeof p2r !== 'string' && p2r.ops.length === 0, typeof p2r === 'string' ? p2r : p2r.ops.map(o => o.detail).join(' | '));
  await A.build('build', 'all');
  check('2 running again creates no duplicate scene or source', A.obs.snapshot() === snap1);
  check('verify: all correct after build', JSON.stringify(await A.b.verify()) === JSON.stringify({ ok: all.length + 1, bad: 0, leaks: 0, quality: 0 }));

  // ---------------------------------------------------------------- 10. mapping + tally
  const cd = all.find(t => t.id === 'g:caster-desk')!;
  const me = A.db.store.map['g:caster-desk'];
  check('10 mapping stored: scene, source, uuids, scene item id', !!me && me.scene === cd.scene && me.input === cd.input && me.sceneUuid === A.obs.scenes.get(cd.scene)!.uuid && me.inputUuid === A.obs.inputs.get(cd.input)!.uuid && me.itemId === A.obs.scenes.get(cd.scene)!.items.find(i => i.source === cd.input)!.id);
  check('10 tally mapping: graphic → its OBS scene', A.db.graphics.find(g => g.id === 'caster-desk')!.obsScene === cd.scene);
  A.obs.renameScene(cd.scene, 'Desk (renamed by hand)');
  await A.b.scan();
  const rep = A.b.state().targets.find(t => t.id === 'g:caster-desk')!;
  check('10 a scene renamed in OBS is still found through its uuid (no duplicate)', rep.scene === 'Desk (renamed by hand)' && rep.status === 'ok', `${rep.scene} ${rep.status}`);
  const pr = await A.b.preview('build', ['g:caster-desk']);
  check('10 …and building it again creates nothing', typeof pr !== 'string' && pr.ops.length === 0);

  // ---------------------------------------------------------------- 3 / 7. update + invalid URL, independent repair
  const veto = all.find(t => t.id === 's:veto')!;
  A.obs.inputs.get(veto.input)!.settings.url = 'not a url';
  A.obs.inputs.get(veto.input)!.settings.width = 1280;
  const bracket = all.find(t => t.id === 'g:bracket')!;
  A.obs.inputs.get(bracket.input)!.settings.url = '';
  await A.b.scan();
  const vr = A.b.state().targets.find(t => t.id === 's:veto')!, br = A.b.state().targets.find(t => t.id === 'g:bracket')!;
  check('7 invalid / empty URLs and wrong size are reported per scene', vr.status === 'outdated' && vr.issues.some(i => i.includes('URL')) && vr.issues.some(i => i.includes('1280')) && br.status === 'outdated', vr.issues.join(' | '));
  const bOnly = await A.b.preview('build', ['s:veto']);
  check('3 Build does not overwrite an existing source (repair is separate)', typeof bOnly !== 'string' && bOnly.ops.length === 0);
  A.obs.log = [];
  const rr = await A.build('repair', ['s:veto']);
  const touched = new Set(A.obs.writes().map(w => w.data.sceneName ?? w.data.inputName));
  check('3 Repair Selected fixes that scene only', !('error' in rr) && A.obs.inputs.get(veto.input)!.settings.url === targetUrl('http://localhost:8787', veto.route, '') && A.obs.inputs.get(veto.input)!.settings.width === 1920 && [...touched].every(n => n === veto.input || n === veto.scene), [...touched].join(','));
  check('3 …the other broken scene is still broken (independent)', A.obs.inputs.get(bracket.input)!.settings.url === '');
  await A.build('repair', ['g:bracket']);
  check('7 repair fixes an empty URL', A.obs.inputs.get(bracket.input)!.settings.url === targetUrl('http://localhost:8787', bracket.route, ''));

  // ---------------------------------------------------------------- 5. manual items kept
  A.obs.addInput(veto.scene, 'My webcam', 'dshow_input');
  A.obs.scenes.get(veto.scene)!.items.find(i => i.source === veto.input)!.enabled = false;
  A.obs.scenes.get(veto.scene)!.items.find(i => i.source === veto.input)!.transform.positionX = 300;
  await A.b.scan();
  check('5 manually added scene item reported as unmanaged', A.b.state().targets.find(t => t.id === 's:veto')!.unmanaged.includes('My webcam'));
  await A.build('repair', ['s:veto']);
  const vs = A.obs.scenes.get(veto.scene)!;
  check('5 repair keeps the manual item and fixes transform + visibility', vs.items.some(i => i.source === 'My webcam') && vs.items.find(i => i.source === veto.input)!.enabled && vs.items.find(i => i.source === veto.input)!.transform.positionX === 0);

  // ---------------------------------------------------------------- 11 / 12. never switches, never transitions
  check('11 builder never switched Program/Preview, never sent a transition or a delete', forbidden(A.obs).length === 0 && A.obs.program === 'Scene', forbidden(A.obs).map(l => l.req).join(','));

  // ---------------------------------------------------------------- on-air protection
  const B = rig();
  await B.build('build', 'all');
  const inter = B.b.targets().find(t => t.id === 's:interview')!;
  B.obs.program = inter.scene;
  B.obs.inputs.get(inter.input)!.settings.url = 'http://old:1/output/screen/interview';
  const held = await B.build('repair', [inter.id]);
  check('on air: repair of the Program scene is held back by default', !('error' in held) && B.obs.inputs.get(inter.input)!.settings.url === 'http://old:1/output/screen/interview' && held.perTarget[inter.id].lines.some(l => l.startsWith('Held')));
  await B.build('repair', [inter.id], true);
  check('on air: …and applied only when explicitly allowed (Program stays where it is)', B.obs.inputs.get(inter.input)!.settings.url.startsWith('http://localhost:8787') && B.obs.program === inter.scene);

  // ---------------------------------------------------------------- 4. unrelated scenes + adoption + conflicts
  const C = rig();
  C.obs.addScene('My intro'); C.obs.addInput('My intro', 'Intro video', 'ffmpeg_source', { local_file: 'C:/intro.mp4' });
  C.obs.addScene('Overdrive · Map veto'); C.obs.addInput('Overdrive · Map veto', 'Overdrive · Map veto overlay', 'browser_source', { url: 'http://localhost:8787/output/screen/veto', width: 1920, height: 1080 });
  const mic = 'Overdrive Caster 1 audio';
  C.obs.addInput('Scene', 'Mic/Aux', 'wasapi_input_capture');
  C.obs.addScene('Overdrive · Interview'); C.obs.addInput('Overdrive · Interview', 'Overdrive · Interview overlay', 'image_source', { file: 'x.png' });
  const unrelated = JSON.stringify([...C.obs.scenes].filter(([n]) => n === 'My intro'));
  const rc = await C.build('build', 'all');
  check('4 unrelated scenes and sources untouched', JSON.stringify([...C.obs.scenes].filter(([n]) => n === 'My intro')) === unrelated && JSON.stringify(C.obs.inputs.get('Intro video')!.settings) === JSON.stringify({ local_file: 'C:/intro.mp4' }));
  check('4 legacy "Overdrive · …" source from an earlier build is adopted, not duplicated', [...C.obs.inputs.keys()].filter(n => n.startsWith('Overdrive · Map veto')).length === 1 && C.obs.scenes.get('Overdrive · Map veto')!.items.filter(i => i.source.startsWith('Overdrive · Map veto')).length === 1);
  check('conflict: a non-Overdrive source with the same name is never overwritten', C.obs.inputs.get('Overdrive · Interview overlay')!.kind === 'image_source' && !('error' in rc) && rc.perTarget['s:interview'] && !rc.perTarget['s:interview'].ok, !('error' in rc) ? rc.perTarget['s:interview']?.lines.join(' | ') : '');
  check('audio: existing mic devices are never touched or duplicated', C.obs.inputs.get('Mic/Aux')!.kind === 'wasapi_input_capture' && [...C.obs.inputs.keys()].filter(n => n === mic).length === 1);
  await C.b.scan();
  check('conflict is shown in the scene list with the reason', C.b.state().targets.find(t => t.id === 's:interview')!.status === 'conflict');

  // ---------------------------------------------------------------- 8. partial failure
  const D = rig();
  const fail = D.b.targets().find(t => t.id === 's:matches')!;
  D.obs.failOn = (req, d) => req === 'CreateInput' && d.inputName === fail.input ? 'Mock failure: source could not be created' : null;
  const rd = await D.build('build', 'all');
  check('8 partial failure: one scene fails, every other scene is built', !('error' in rd) && !rd.ok && !rd.perTarget[fail.id].ok && Object.entries(rd.perTarget).filter(([k]) => k !== fail.id).every(([, v]) => v.ok), !('error' in rd) ? rd.summary : rd.error);
  check('8 report names the failed scene and the reason', !('error' in rd) && rd.perTarget[fail.id].lines.some(l => l.includes('Mock failure')));
  D.obs.failOn = null;
  await D.b.scan();
  check('8 the failed scene shows as incomplete with a repair path', D.b.state().targets.find(t => t.id === fail.id)!.status === 'incomplete');
  await D.build('build', [fail.id]);
  check('8 Build Selected completes it, without duplicating the scene it already made', D.obs.scenes.get(fail.scene)!.items.filter(i => i.source === fail.input).length === 1 && [...D.obs.scenes.keys()].filter(n => n === fail.scene).length === 1);

  // ---------------------------------------------------------------- 6. disconnection
  const E = rig();
  const e0 = await E.b.preview('build', 'all');
  E.obs.dropAfter = 40;
  const re = typeof e0 === 'string' ? e0 : await E.b.apply(e0.hash, false);
  check('6 disconnect during build: stops cleanly with per-scene results', typeof re !== 'string' && !re.ok && Object.values(re.perTarget).some(v => v.lines.some(l => l.startsWith('Not attempted'))), typeof re === 'string' ? re : re.summary);
  check('6 while disconnected every action reports "not connected"', (await E.b.scan()) === 'OBS is not connected.' && (await E.b.preview('build', 'all')) === 'OBS is not connected.');
  E.obs.connected = true; E.obs.dropAfter = null;
  const re2 = await E.build('build', 'all');
  const dup = [...E.obs.scenes.values()].some(s => new Set(s.items.map(i => i.source)).size !== s.items.length);
  check('6 after reconnect the build completes with no duplicates', !('error' in re2) && re2.ok && !dup, 'error' in re2 ? re2.error : re2.summary);

  // ---------------------------------------------------------------- stale preview, single scene, remote OBS, options
  const F = rig({ obsUrl: 'ws://192.168.1.40:4455', lan: ['http://10.0.0.5:8787', 'http://192.168.1.20:8787'], key: 'abc' });
  check('remote OBS: base URL is this computer\'s LAN address on the same network (not localhost)', F.b.state().baseUrl === 'http://192.168.1.20:8787', F.b.state().baseUrl);
  const f1 = await F.b.preview('build', ['g:analyst-desk']);
  F.obs.addScene('Overdrive · Analyst Desk');
  const f2 = typeof f1 === 'string' ? f1 : await F.b.apply(f1.hash, false);
  check('stale preview: OBS changed after the preview → refused, new preview shown', f2 === 'OBS changed since the preview. The preview has been updated: check it and confirm again.' && F.b.state().plan?.ops.some(o => o.existing));
  const f3 = await F.build('build', ['g:analyst-desk']);
  const ad = F.b.targets().find(t => t.id === 'g:analyst-desk')!;
  check('Build Selected: only that scene is built', !('error' in f3) && F.obs.scenes.size === 3 /* Scene + the analyst desk scene (reused) + shared audio */ && F.obs.inputs.get(ad.input)!.settings.url === 'http://192.168.1.20:8787/g/analyst-desk?key=abc', `${F.obs.scenes.size} scenes`);
  const G = rig({ obsUrl: 'ws://0.tcp.ngrok.io:12345', lan: ['http://10.1.2.3:8787'], pub: 'https://overdrive.example.com' });
  check('cloud-hosted Overdrive + tunnelled OBS: base URL is the public address, never localhost/LAN', G.b.state().baseUrl === 'https://overdrive.example.com', G.b.state().baseUrl);
  const H = rig({ obsUrl: 'ws://0.tcp.ngrok.io:12345' });
  check('…public address unknown: says so and asks for a base URL', /set the base URL/.test(H.b.state().baseReason));
  check('options: an invalid base URL is refused', F.b.setOptions({ baseUrl: 'http://x/y' }) !== null && F.b.setOptions({ baseUrl: 'http://203.0.113.9:8787' }) === null && F.b.state().baseUrl === 'http://203.0.113.9:8787');
  await F.b.scan();
  const st = F.b.state();
  check('scan lists legacy duplicates with "not in Build All"', st.targets.some(t => t.id === 's:caster-desk' && t.supersededBy === 'g:caster-desk' && !t.inAll) && st.version?.obs.includes('mock') === true);
  check('12 no stinger / transition request in any run', [A, B, C, D, E, F].every(r => forbidden(r.obs).length === 0), [A, B, C, D, E, F].flatMap(r => forbidden(r.obs)).map(l => l.req).join(','));

  // ---------------------------------------------------------------- controllers (docks), never in a broadcast source
  check('controllers: no broadcast target loads a control page', A.b.targets().every(t => !isControllerRoute(t.route)));
  const docks = dockEntries('http://192.168.1.20:8787', A.b.state().targets);
  check('controllers: one dock per Build-All scene + a Follow-OBS dock, unique titles', docks.length === all.length + 1 && new Set(docks.map(d => d.title)).size === docks.length && docks.every(d => d.url.startsWith('http://192.168.1.20:8787/producer/scene/')), `${docks.length} docks`);
  check('controllers: dock URL per scene', docks.some(d => d.url === 'http://192.168.1.20:8787' + controllerPath('g:caster-desk')));
  check('installer scripts contain every dock URL and refuse while OBS runs', docks.every(d => dockInstallerPs1(docks).includes(d.url) && dockInstallerSh(docks).includes(d.url)) && dockInstallerPs1(docks).includes('Get-Process') && dockInstallerSh(docks).includes('pgrep'));
  A.obs.addInput(veto.scene, 'Oops controller', 'browser_source', { url: 'http://localhost:8787/producer/scene/s:veto', width: 1920, height: 1480 });
  const lv = await A.b.verify();
  check('verify flags a controller page put into a broadcast scene (and never removes it)', typeof lv !== 'string' && lv.leaks === 1 && A.b.state().controllerLeaks[0].input === 'Oops controller' && A.obs.inputs.has('Oops controller'));


  // ---------------------------------------------------------------- picture quality (read-only)
  check('quality: picture routes are native 1920×1080, ?controls 1920×1480, audio/music/control pages are not pictures',
    nativeSizeOf('/g/caster-desk')?.w === 1920 && nativeSizeOf('/output/screen/brb')?.h === 1080 && nativeSizeOf('/output/casters?controls&token=x')?.h === 1480
    && nativeSizeOf('/output/audio/1') === null && nativeSizeOf('/output/music') === null && nativeSizeOf('/producer/scene/g:x') === null && nativeSizeOf(null) === null);
  check('quality: item scale from scale and from bounds', itemScale({ scaleX: 1, scaleY: 1 }, 1920, 1080).x === 1 && itemScale({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1280, boundsHeight: 720 }, 1920, 1080).x === 2 / 3 && itemScale({ scaleX: 1.5, scaleY: 1.5 }, 1280, 720).y === 1.5);
  check('quality: a 1:1 1920×1080 source in a 1920×1080 canvas has no findings', A.b.state().quality.length === 0, JSON.stringify(A.b.state().quality));
  check('quality: mis-sized source = double scaling', sourceQuality('X', '/g/caster-desk', { width: 1280, height: 720 }, [{ scene: 'S', transform: { scaleX: 1.5, scaleY: 1.5 } }]).length === 2
    && /67%/.test(sourceQuality('X', '/g/caster-desk', { width: 1280, height: 720 }, [])[0].issue) && /letterboxed/.test(sourceQuality('X', '/g/x', {}, [])[0].issue));
  check('quality: canvas + scaled output reported', canvasQuality({ w: 1920, h: 1080, ow: 1280, oh: 720 }).length === 1 && canvasQuality({ w: 1280, h: 720 }).length === 1 && canvasQuality({ w: 1920, h: 1080, ow: 1920, oh: 1080 }).length === 0);
  {
    const writes0 = A.obs.log.filter(l => !l.req.startsWith('Get')).length;
    A.obs.addInput('Scene', 'Old caster overlay', 'browser_source', { url: 'http://localhost:8787/output/casters', width: 1280, height: 720 });
    const sc = A.obs.scenes.get('Scene')!; const it = sc.items.find(i => i.source === 'Old caster overlay')!; it.transform = { ...it.transform, scaleX: 1.5, scaleY: 1.5 };
    A.obs.video = { ...A.obs.video, outputWidth: 1280, outputHeight: 720 };
    const writes1 = A.obs.log.filter(l => !l.req.startsWith('Get')).length;
    const v = await A.b.verify();
    const q = A.b.state().quality;
    check('verify reports the hand-made 1280×720 Overdrive source (size + 150% scale) and the 720p output', typeof v !== 'string' && v.quality === 3 && q.some(x => x.where === 'Old caster overlay' && /1280×720/.test(x.issue)) && q.some(x => /150%/.test(x.issue)) && q.some(x => /1280×720: the stream/.test(x.issue)), JSON.stringify(q.map(x => x.issue)));
    check('quality check is read-only (no OBS write while verifying)', A.obs.log.filter(l => !l.req.startsWith('Get')).length === writes1 && writes1 >= writes0 && A.b.state().canvas?.ow === 1280);
  }

  // ---- output resolution profiles (4K native) ----
  {
    check('profiles: 1080p stays the default for existing setups', defaultObsSetup().options.profile === 'fhd' && sanitizeObsSetup({ options: { audio: true } }).options.profile === 'fhd' && sanitizeObsSetup({ options: { profile: 'uhd' } }).options.profile === 'uhd' && sanitizeObsSetup({ options: { profile: '8k' } }).options.profile === 'fhd');
    const t4 = discoverTargets(sanitizeGraphics([]), defaultShow().obsScenes, { audio: true, gameCapture: true, profile: 'uhd' });
    check('profiles: under 4K every picture target is 3840×2160 (same routes, same scenes)', t4.length > 10 && t4.every(t => t.width === 3840 && t.height === 2160)
      && JSON.stringify(t4.map(t => [t.id, t.route, t.scene])) === JSON.stringify(discoverTargets(sanitizeGraphics([]), defaultShow().obsScenes, { audio: true, gameCapture: true }).map(t => [t.id, t.route, t.scene])));
    check('profiles: native sizes ×2 under 4K, controls pages too', nativeSizeOf('/g/caster-desk', 'uhd')?.w === 3840 && nativeSizeOf('/output/screen/brb', 'uhd')?.h === 2160 && nativeSizeOf('/output/casters?controls&token=x', 'uhd')?.h === 2960 && nativeSizeOf('/output/music', 'uhd') === null);
    check('profiles: 4K canvas + 1080p output is a supported setup; 4K canvas under the 1080p profile is reported with both fixes',
      canvasQuality({ w: 3840, h: 2160, ow: 1920, oh: 1080, fps: 60 }, 'uhd').length === 0 && canvasQuality({ w: 3840, h: 2160, ow: 3840, oh: 2160, fps: 60 }, 'uhd').length === 0
      && canvasQuality({ w: 1920, h: 1080 }, 'uhd').length === 1 && /switch the output profile/.test(canvasQuality({ w: 3840, h: 2160 }, 'fhd')[0]?.fix ?? '')
      && canvasQuality({ w: 3840, h: 2160, ow: 1280, oh: 720 }, 'uhd').length === 1 && canvasQuality({ w: 1920, h: 1080, fps: 30 }).length === 1);
    check('profiles: a 1920×1080 source under the 4K profile is reported (OBS would upscale it)', sourceQuality('x', '/g/caster-desk', { width: 1920, height: 1080 }, [], 'uhd').length === 1 && sourceQuality('x', '/g/caster-desk', { width: 3840, height: 2160 }, [], 'uhd').length === 0);
    // switching a built 1080p setup to 4K: verify shows each scene outdated (wrong size), repair resizes, nothing else changes
    const P = rig(); P.obs.video = { ...P.obs.video, baseWidth: 3840, baseHeight: 2160, outputWidth: 1920, outputHeight: 1080 };
    await P.build('build', 'all');
    await P.b.scan(); const before = P.b.state().targets; const okBefore = before.filter(x => x.inAll && x.kind !== 'support' && x.status === 'ok').length;
    const w0 = P.obs.log.filter(l => !l.req.startsWith('Get')).length;
    P.b.setOptions({ profile: 'uhd' });
    const w1 = P.obs.log.filter(l => !l.req.startsWith('Get')).length;
    await P.b.scan(); const after = P.b.state().targets;
    const out4 = after.filter(x => x.inAll && x.status === 'outdated');
    check('profiles: switching to 4K writes nothing to OBS by itself', w1 === w0);
    check('profiles: after switching, every built scene reports the 1920×1080 size as outdated', out4.length === okBefore && out4.every(x => x.issues.some(i => /3840×2160/.test(i))), `${out4.length}/${okBefore} ${JSON.stringify(after.filter(x => x.inAll && x.status !== 'outdated').map(x => [x.id, x.status, x.issues]))}`);
    const rep = await P.build('repair', 'all');
    const inputs = [...P.obs.inputs.values()].filter((i: any) => i.kind === 'browser_source' && /\/(g|output)\//.test(i.settings?.url ?? '') && !/\/output\/(audio|music)/.test(i.settings?.url));
    await P.b.scan(); const again = P.b.state().targets;
    check('profiles: Repair resizes the sources to 3840×2160 (only after confirming the plan)', !('error' in rep) && inputs.length > 0 && inputs.every((i: any) => i.settings.width === 3840 && i.settings.height === 2160) && again.filter(x => x.inAll).every(x => x.status === 'ok'), JSON.stringify(inputs.slice(0, 2).map((i: any) => [i.settings.width, i.settings.height])));
    check('profiles: 4K canvas + 4K sources = no quality findings', (await P.b.verify(), P.b.state().quality.length === 0), JSON.stringify(P.b.state().quality));
  }

  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();

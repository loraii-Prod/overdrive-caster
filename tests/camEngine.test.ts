/**
 * Tests for the Desk Camera Engine (Overdrive 3.4).
 * Verifies A/B scene isolation, preset management, animation strategies,
 * and OBS WebSocket interactions against a mock.
 */
import assert from 'node:assert/strict';
import { CamEngine, cameraInputName, abSceneName, type CamEngineObs, type CamSceneNames } from '../server/camEngine';
import type { DeskCamLayout } from '../shared/camPresets';
import { builtinPresets, BUILTIN_IDS, autoPresetId } from '../shared/camPresets';
import type { Rect } from '../shared/skins';

// ---- Mock OBS ----

interface MockCall {
  req: string;
  data?: Record<string, any>;
}

function createMockObs() {
  const calls: MockCall[] = [];
  let connected = true;
  const base = { w: 1920, h: 1080 };

  const items = new Map<string, number>();
  let nextItemId = 100;

  const transitions: { transitionName: string; transitionKind: string }[] = [
    { transitionName: 'Cut', transitionKind: 'cut_transition' },
    { transitionName: 'Fade', transitionKind: 'fade_transition' },
  ];

  function addItem(scene: string, source: string): number {
    const id = nextItemId++;
    items.set(`${scene}\0${source}`, id);
    return id;
  }

  const callFn = (req: string, data?: Record<string, any>): Promise<any> => {
    calls.push({ req, data });
    if (req === 'GetSceneItemId') {
      const key = `${data?.sceneName}\0${data?.sourceName}`;
      const id = items.get(key);
      if (id == null) return Promise.reject(new Error(`Item not found: ${key}`));
      return Promise.resolve({ sceneItemId: id });
    }
    if (req === 'GetSceneTransitionList') {
      return Promise.resolve({ transitions });
    }
    if (req === 'GetVideoSettings') {
      return Promise.resolve({ baseWidth: base.w, baseHeight: base.h });
    }
    return Promise.resolve({});
  };

  const obs: CamEngineObs = {
    call: () => connected ? callFn : null,
    connected: () => connected,
    base: () => base,
  };

  return {
    obs,
    calls,
    addItem,
    transitions,
    setConnected(v: boolean) { connected = v; },
    clearCalls() { calls.length = 0; },
  };
}

// ---- Helpers ----

const ANALYST_HOLES: Record<'solo' | 'duo' | 'trio', Rect[]> = {
  solo: [{ x: 427, y: 207, w: 1067, h: 600 }],
  duo: [{ x: 177, y: 308, w: 730, h: 408 }, { x: 1013, y: 308, w: 730, h: 408 }],
  trio: [{ x: 73, y: 309, w: 564, h: 407 }, { x: 678, y: 309, w: 564, h: 407 }, { x: 1283, y: 309, w: 564, h: 407 }],
};

const SCENES: CamSceneNames = { a: 'Analyst Desk', b: 'Analyst Desk (B)' };
const SEATS = [4, 5, 6];

// Shorthand for the actual builtin IDs
const TRIO = BUILTIN_IDS['desk-trio'];
const DUO = BUILTIN_IDS['desk-duo'];
const SOLO = BUILTIN_IDS['desk-solo'];
const P_TRIO = BUILTIN_IDS['panel-trio'];

function createEngine(mock: ReturnType<typeof createMockObs>) {
  let changed = 0;
  const engine = new CamEngine({
    obs: mock.obs,
    desk: 'analyst-desk',
    scenes: SCENES,
    seats: SEATS,
    holes: ANALYST_HOLES,
    onChange: () => { changed++; },
  });
  // Set up items in both scenes
  for (const seat of SEATS) {
    mock.addItem(SCENES.a, cameraInputName(seat));
    mock.addItem(SCENES.b, cameraInputName(seat));
  }
  return { engine, getChanged: () => changed };
}

// ---- Tests ----

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    pass++;
  } catch (e: any) {
    console.error(`FAIL ${name}: ${e.message}`);
    fail++;
  }
}

await test('cameraInputName returns correct format', () => {
  assert.equal(cameraInputName(4), 'Overdrive · Camera 4');
  assert.equal(cameraInputName(1), 'Overdrive · Camera 1');
});

await test('abSceneName generates B variant', () => {
  // abSceneName (re-exported from shared/obsLayout.bSceneName) takes a MainKey, not a label, so the
  // naming is derived from the single shared definition the Scene Builder itself uses.
  assert.equal(abSceneName('analyst-desk'), 'Overdrive · Analyst Desk (B)');
  assert.equal(abSceneName('caster-desk'), 'Overdrive · Caster Desk (B)');
});

await test('builtin presets are generated', () => {
  const presets = builtinPresets('analyst-desk', ANALYST_HOLES);
  assert.ok(presets.length >= 6, 'Should have at least 6 builtins');
  assert.ok(presets.every(p => p.builtin === true));
  const solo = presets.find(p => p.id === SOLO);
  assert.ok(solo, `Should have ${SOLO}`);
  assert.equal(solo!.cameras.length, 1);
  assert.deepEqual(solo!.cameras[0].rect, ANALYST_HOLES.solo[0]);
});

await test('autoPresetId returns correct builtin IDs', () => {
  assert.equal(autoPresetId('cams', 3), TRIO);
  assert.equal(autoPresetId('cams', 2), DUO);
  assert.equal(autoPresetId('cams', 1), SOLO);
  assert.equal(autoPresetId('panel', 3), P_TRIO);
});

await test('engine initializes with correct state', () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  assert.equal(engine.state.program, 'A');
  assert.equal(engine.state.programPreset, null);
  assert.equal(engine.state.previewPreset, null);
  assert.equal(engine.state.animating, false);
  assert.equal(engine.state.hasMoveTransition, false);
});

await test('discoverItems finds item IDs in both scenes', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  const getItemCalls = mock.calls.filter(c => c.req === 'GetSceneItemId');
  assert.equal(getItemCalls.length, SEATS.length * 2);
});

await test('detectMoveTransition returns false when plugin missing', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  const result = await engine.detectMoveTransition();
  assert.equal(result, false);
  assert.equal(engine.state.hasMoveTransition, false);
});

await test('detectMoveTransition returns true when plugin present', async () => {
  const mock = createMockObs();
  mock.transitions.push({ transitionName: 'Move', transitionKind: 'move_transition' });
  const { engine } = createEngine(mock);
  const result = await engine.detectMoveTransition();
  assert.equal(result, true);
  assert.equal(engine.state.hasMoveTransition, true);
});

await test('prepare applies layout to B scene (Preview)', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  mock.clearCalls();

  const err = await engine.prepare(TRIO);
  assert.equal(err, null);
  assert.equal(engine.state.previewPreset, TRIO);

  // Should have called SetSceneItemTransform and SetSceneItemEnabled on the B scene
  const transforms = mock.calls.filter(c => c.req === 'SetSceneItemTransform');
  const enables = mock.calls.filter(c => c.req === 'SetSceneItemEnabled');
  assert.ok(transforms.length > 0, 'Should set transforms');
  assert.ok(enables.length > 0, 'Should set enable state');
  for (const t of transforms) {
    assert.equal(t.data?.sceneName, SCENES.b, 'Transforms should target B scene');
  }
});

await test('prepare with invalid preset returns error', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  const err = await engine.prepare('nonexistent');
  assert.ok(err?.includes('not found'));
});

await test('snap applies layout to both scenes', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  mock.clearCalls();

  const err = await engine.snap(DUO);
  assert.equal(err, null);
  assert.equal(engine.state.programPreset, DUO);

  const transforms = mock.calls.filter(c => c.req === 'SetSceneItemTransform');
  const scenesUsed = new Set(transforms.map(t => t.data?.sceneName));
  assert.ok(scenesUsed.has(SCENES.a), 'Should set transforms on A');
  assert.ok(scenesUsed.has(SCENES.b), 'Should set transforms on B');
});

await test('take without prepare returns error', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  const err = await engine.take();
  assert.ok(err?.includes('Nothing prepared'));
});

await test('take swaps A/B roles', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();

  assert.equal(engine.state.program, 'A');

  // Prepare on B
  await engine.prepare(TRIO);
  assert.equal(engine.state.previewPreset, TRIO);

  // Take: transitions B to Program
  const err = await engine.take(50);
  assert.equal(err, null);
  assert.equal(engine.state.program, 'B', 'Program should now be B');
  assert.equal(engine.state.programPreset, TRIO);
  assert.equal(engine.state.previewPreset, null, 'Preview cleared after TAKE');
  assert.equal(engine.state.animating, false, 'Animation should be done');

  const switchCalls = mock.calls.filter(c => c.req === 'SetCurrentProgramScene');
  assert.ok(switchCalls.length > 0, 'Should have switched OBS program');
  assert.equal(switchCalls[switchCalls.length - 1].data?.sceneName, SCENES.b);
});

await test('take uses fallback interpolation with transforms then Cut', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();

  // Snap a starting layout so there's something to interpolate from
  await engine.snap(TRIO);
  await engine.prepare(DUO);
  mock.clearCalls();

  await engine.take(50);

  // Should have multiple SetSceneItemTransform calls (interpolation frames) on the target scene
  const transforms = mock.calls.filter(c => c.req === 'SetSceneItemTransform');
  assert.ok(transforms.length > 3, `Should have interpolation frames, got ${transforms.length}`);

  // Should end with SetCurrentProgramScene
  const switchCalls = mock.calls.filter(c => c.req === 'SetCurrentProgramScene');
  assert.ok(switchCalls.length > 0);
});

await test('take with Move Transition sets it as current transition', async () => {
  const mock = createMockObs();
  mock.transitions.push({ transitionName: 'Move', transitionKind: 'move_transition' });
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  await engine.detectMoveTransition();

  await engine.snap(TRIO);
  await engine.prepare(DUO);
  mock.clearCalls();
  await engine.take(50);

  const setTransition = mock.calls.filter(c => c.req === 'SetCurrentSceneTransition');
  assert.ok(setTransition.some(c => c.data?.transitionName === 'Move'), 'Move Transition should be set');
});

await test('take when OBS disconnected returns error', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  await engine.prepare(TRIO);

  mock.setConnected(false);
  const err = await engine.take();
  assert.ok(err?.includes('not connected'), `Expected 'not connected', got: ${err}`);
});

await test('savePreset creates a custom preset', () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);

  const layout: DeskCamLayout[] = [
    { seat: 4, rect: { x: 100, y: 100, w: 800, h: 450 } },
    { seat: 5, rect: { x: 1000, y: 100, w: 800, h: 450 } },
  ];
  const p = engine.savePreset('My Layout', layout);
  assert.ok(p.id.startsWith('custom:'));
  assert.equal(p.name, 'My Layout');
  assert.equal(p.builtin, undefined);
  assert.deepEqual(p.cameras, layout);
  assert.ok(engine.presets.find(x => x.id === p.id));
});

await test('deletePreset removes custom but not builtin', () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);

  const builtin = engine.presets.find(p => p.builtin);
  assert.ok(builtin);
  assert.equal(engine.deletePreset(builtin!.id), false);

  const layout: DeskCamLayout[] = [{ seat: 4, rect: { x: 0, y: 0, w: 100, h: 100 } }];
  const p = engine.savePreset('Temp', layout);
  assert.equal(engine.deletePreset(p.id), true);
  assert.equal(engine.presets.find(x => x.id === p.id), undefined);
});

await test('customPresets filters out builtins', () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  const layout: DeskCamLayout[] = [{ seat: 4, rect: { x: 0, y: 0, w: 100, h: 100 } }];
  engine.savePreset('Custom 1', layout);
  engine.savePreset('Custom 2', layout);

  const customs = engine.customPresets();
  assert.equal(customs.length, 2);
  assert.ok(customs.every(p => !p.builtin));
});

await test('loadCustomPresets replaces customs, keeps builtins', () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  const builtinCount = engine.presets.filter(p => p.builtin).length;

  const saved = [{
    id: 'custom:saved1', name: 'Saved', desk: 'analyst-desk' as const,
    cameras: [{ seat: 4, rect: { x: 0, y: 0, w: 100, h: 100 } }],
    updatedAt: Date.now(),
  }];
  engine.loadCustomPresets(saved);
  assert.equal(engine.presets.filter(p => p.builtin).length, builtinCount);
  assert.equal(engine.presets.find(p => p.id === 'custom:saved1')?.name, 'Saved');
});

await test('autoPreset returns correct preset ID for desk mode', () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  assert.equal(engine.autoPreset('cams', 3), TRIO);
  assert.equal(engine.autoPreset('cams', 2), DUO);
  assert.equal(engine.autoPreset('cams', 1), SOLO);
  assert.equal(engine.autoPreset('panel', 3), P_TRIO);
});

await test('sync updates program scene layout', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  mock.clearCalls();

  const holeRects: Rect[] = [
    { x: 73, y: 309, w: 564, h: 407 },
    { x: 678, y: 309, w: 564, h: 407 },
    { x: 1283, y: 309, w: 564, h: 407 },
  ];
  await engine.sync(holeRects, [4, 5, 6]);

  const transforms = mock.calls.filter(c => c.req === 'SetSceneItemTransform');
  assert.ok(transforms.length >= 3);
  for (const t of transforms) {
    assert.equal(t.data?.sceneName, SCENES.a, 'Sync should target Program scene');
  }
});

await test('prepare with custom layout array works', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();

  const layout: DeskCamLayout[] = [
    { seat: 4, rect: { x: 100, y: 100, w: 800, h: 450 }, visible: true },
    { seat: 5, rect: { x: 1020, y: 100, w: 800, h: 450 }, visible: true },
    { seat: 6, rect: { x: 560, y: 540, w: 800, h: 450 }, visible: false },
  ];
  const err = await engine.prepare(layout);
  assert.equal(err, null);
  assert.equal(engine.state.previewPreset, null, 'Custom layout has no preset ID');
});

await test('full workflow: snap → prepare → take → prepare → take flips A/B/A', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();

  // Snap trio to both scenes
  await engine.snap(TRIO);
  assert.equal(engine.state.program, 'A');

  // Prepare duo on B, take → Program becomes B
  await engine.prepare(DUO);
  await engine.take(10);
  assert.equal(engine.state.program, 'B');

  // Prepare solo on A (now Preview), take → Program becomes A
  await engine.prepare(SOLO);
  await engine.take(10);
  assert.equal(engine.state.program, 'A');
  assert.equal(engine.state.programPreset, SOLO);
});

await test('visibility: cameras not in layout are hidden', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);
  await engine.discoverItems();
  mock.clearCalls();

  // Solo layout: only seat 4 is visible
  await engine.snap(SOLO);

  const enables = mock.calls.filter(c => c.req === 'SetSceneItemEnabled');
  // Should have 6 enable calls (3 seats × 2 scenes)
  assert.equal(enables.length, 6);
  // For the SOLO preset, only 1 seat is in the layout → 1 visible per scene
  const visibleCalls = enables.filter(c => c.data?.sceneItemEnabled === true);
  const hiddenCalls = enables.filter(c => c.data?.sceneItemEnabled === false);
  assert.equal(visibleCalls.length, 2, 'One visible per scene');
  assert.equal(hiddenCalls.length, 4, 'Two hidden per scene');
});

await test('validateLayout rejects invalid layouts', async () => {
  const mock = createMockObs();
  const { engine } = createEngine(mock);

  // Duplicate seats
  const err = await engine.prepare([
    { seat: 4, rect: { x: 0, y: 0, w: 100, h: 100 } },
    { seat: 4, rect: { x: 200, y: 0, w: 100, h: 100 } },
  ]);
  assert.ok(err?.includes('Duplicate'));

  // Seat out of range
  const err2 = await engine.prepare([
    { seat: 0, rect: { x: 0, y: 0, w: 100, h: 100 } },
  ]);
  assert.ok(err2?.includes('Invalid seat'));

  // No area
  const err3 = await engine.prepare([
    { seat: 4, rect: { x: 0, y: 0, w: 0, h: 100 } },
  ]);
  assert.ok(err3?.includes('no area'));
});

// ---- Summary ----
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

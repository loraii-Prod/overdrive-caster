/**
 * A stateful OBS WebSocket v5 mock (requests, response shapes and error rules modelled on obs-websocket 5.x):
 * scenes and inputs share one name space, scene items are ordered (index 0 = bottom), input settings merge
 * with `overlay: true`, scenes can be nested as scene items, GetInputSettings returns what was set.
 * This is NOT real OBS: it cannot prove OBS itself behaves the same.
 */
let uid = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uid).padStart(12, '0')}`;

interface MItem { id: number; source: string; enabled: boolean; transform: Record<string, any> }
interface MScene { uuid: string; items: MItem[]; nextId: number }
interface MInput { uuid: string; kind: string; settings: Record<string, any> }

export class MockObs {
  scenes = new Map<string, MScene>();
  inputs = new Map<string, MInput>();
  program = 'Scene';
  preview = 'Scene';
  studioMode = false;
  connected = true;
  log: { req: string; data?: any }[] = [];
  /** Fail a request (returns an error message) — partial failure tests. */
  failOn: ((req: string, data: any) => string | null) | null = null;
  /** Disconnect after this many more requests. */
  dropAfter: number | null = null;
  video = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 };
  kinds = ['browser_source', 'game_capture', 'window_capture', 'monitor_capture', 'dshow_input', 'wasapi_input_capture', 'ffmpeg_source', 'image_source'];

  constructor() { this.scenes.set('Scene', { uuid: uuid(), items: [], nextId: 1 }); }

  private err(code: number, msg: string): never { const e: any = new Error(msg); e.code = code; throw e; }
  private name(n: any): string { if (typeof n !== 'string' || !n) this.err(300, 'Missing name'); return n; }
  private scene(n: any): MScene { const s = this.scenes.get(this.name(n)); if (!s) this.err(600, `No source was found by the name of \`${n}\`.`); return s; }
  private taken(n: string) { return this.scenes.has(n) || this.inputs.has(n); }

  call = async (req: string, data: any = {}): Promise<any> => {
    if (!this.connected) this.err(-1, 'Not connected');
    if (this.dropAfter != null) { if (this.dropAfter <= 0) { this.connected = false; this.err(-1, 'Socket closed'); } this.dropAfter--; }
    this.log.push({ req, data: JSON.parse(JSON.stringify(data ?? {})) });
    const f = this.failOn?.(req, data);
    if (f) this.err(702, f);
    switch (req) {
      case 'GetVersion': return { obsVersion: '31.0.0 (mock)', obsWebSocketVersion: '5.5.0 (mock)', rpcVersion: 1, availableRequests: ['GetVersion', 'GetVideoSettings', 'GetSceneList', 'GetInputList', 'GetInputKindList', 'GetSceneItemList', 'GetInputSettings', 'CreateScene', 'CreateInput', 'SetInputSettings', 'CreateSceneItem', 'SetSceneItemTransform', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'SetCurrentProgramScene'] };
      case 'GetVideoSettings': return { ...this.video };
      case 'GetSceneList': return { currentProgramSceneName: this.program, currentPreviewSceneName: this.studioMode ? this.preview : null,
        scenes: [...this.scenes].map(([n, s], i) => ({ sceneName: n, sceneUuid: s.uuid, sceneIndex: this.scenes.size - 1 - i })).reverse() };
      case 'GetInputList': return { inputs: [...this.inputs].map(([n, i]) => ({ inputName: n, inputUuid: i.uuid, inputKind: i.kind, unversionedInputKind: i.kind })) };
      case 'GetInputKindList': return { inputKinds: this.kinds };
      case 'GetSceneItemList': {
        const s = this.scene(data.sceneName);
        return { sceneItems: s.items.map((it, idx) => {
          const inp = this.inputs.get(it.source);
          return { sceneItemId: it.id, sceneItemIndex: idx, sourceName: it.source, sourceUuid: inp?.uuid ?? this.scenes.get(it.source)?.uuid, sourceType: inp ? 'OBS_SOURCE_TYPE_INPUT' : 'OBS_SOURCE_TYPE_SCENE',
            inputKind: inp?.kind ?? null, isGroup: false, sceneItemEnabled: it.enabled,
            sceneItemTransform: { ...it.transform, sourceWidth: inp?.settings.width ?? 1920, sourceHeight: inp?.settings.height ?? 1080 } };
        }) };
      }
      case 'GetInputSettings': { const i = this.inputs.get(this.name(data.inputName)); if (!i) this.err(600, 'No input'); return { inputKind: i.kind, inputSettings: { ...i.settings } }; }
      case 'CreateScene': { const n = this.name(data.sceneName); if (this.taken(n)) this.err(601, `A source already exists by that scene name.`); const u = uuid(); this.scenes.set(n, { uuid: u, items: [], nextId: 1 }); return { sceneUuid: u }; }
      case 'CreateInput': {
        const n = this.name(data.inputName), s = this.scene(data.sceneName);
        if (this.taken(n)) this.err(601, 'A source already exists by that input name.');
        if (!this.kinds.includes(data.inputKind)) this.err(605, `Input kind \`${data.inputKind}\` not found.`);
        const u = uuid(); this.inputs.set(n, { uuid: u, kind: data.inputKind, settings: { ...(data.inputSettings ?? {}) } });
        const id = s.nextId++; s.items.push({ id, source: n, enabled: data.sceneItemEnabled !== false, transform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0 } });
        return { inputUuid: u, sceneItemId: id };
      }
      case 'CreateSceneItem': {
        const s = this.scene(data.sceneName), src = this.name(data.sourceName);
        if (!this.taken(src)) this.err(600, 'No source');
        if (src === data.sceneName) this.err(400, 'A scene cannot contain itself');
        const id = s.nextId++; s.items.push({ id, source: src, enabled: data.sceneItemEnabled !== false, transform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE' } });
        return { sceneItemId: id };
      }
      case 'SetInputSettings': { const i = this.inputs.get(this.name(data.inputName)); if (!i) this.err(600, 'No input'); i.settings = data.overlay === false ? { ...data.inputSettings } : { ...i.settings, ...data.inputSettings }; return {}; }
      case 'SetSceneItemTransform': { const it = this.item(data); it.transform = { ...it.transform, ...data.sceneItemTransform }; return {}; }
      case 'SetSceneItemEnabled': { this.item(data).enabled = !!data.sceneItemEnabled; return {}; }
      case 'SetSceneItemIndex': { const s = this.scene(data.sceneName); const it = this.item(data); s.items.splice(s.items.indexOf(it), 1); s.items.splice(Math.max(0, Math.min(s.items.length, data.sceneItemIndex)), 0, it); return {}; }
      case 'GetSceneItemId': { const it = this.scene(data.sceneName).items.find(i => i.source === data.sourceName); if (!it) this.err(600, 'No item'); return { sceneItemId: it.id }; }
      case 'GetStudioModeEnabled': return { studioModeEnabled: this.studioMode };
      case 'SetCurrentProgramScene': this.scene(data.sceneName); this.program = data.sceneName; return {};
      default: this.err(204, `Unknown request ${req}`);
    }
  };
  private item(data: any): MItem { const it = this.scene(data.sceneName).items.find(i => i.id === data.sceneItemId); if (!it) this.err(600, 'No scene item'); return it; }

  // ----- test helpers (what a person would do by hand in OBS)
  addScene(n: string) { this.scenes.set(n, { uuid: uuid(), items: [], nextId: 1 }); }
  addInput(scene: string, n: string, kind: string, settings: Record<string, any> = {}) {
    this.inputs.set(n, { uuid: uuid(), kind, settings });
    const s = this.scenes.get(scene)!; s.items.push({ id: s.nextId++, source: n, enabled: true, transform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE' } });
  }
  renameScene(from: string, to: string) { const s = this.scenes.get(from)!; this.scenes.delete(from); this.scenes.set(to, s); for (const x of this.scenes.values()) for (const i of x.items) if (i.source === from) i.source = to; if (this.program === from) this.program = to; }
  snapshot() { return JSON.stringify({ s: [...this.scenes], i: [...this.inputs], p: this.program, v: this.preview }); }
  writes() { return this.log.filter(l => !l.req.startsWith('Get')); }
}

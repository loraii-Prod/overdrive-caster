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
interface MInput { uuid: string; kind: string; settings: Record<string, any>; audio?: { muted: boolean; volumeDb: number; sync: number; monitor: string } }

export class MockObs {
  scenes = new Map<string, MScene>();
  inputs = new Map<string, MInput>();
  program = 'Scene';
  preview = 'Scene';
  studioMode = false;
  /** Current scene transition (by name). */
  transition = 'Fade';
  projected = new Set<string>();
  /** Is source `n` drawn when scene `scene` is drawn (enabled items, nested scenes)? */
  reaches(scene: string, n: string, seen = new Set<string>()): boolean {
    if (scene === n) return true;
    const sc = this.scenes.get(scene); if (!sc || seen.has(scene)) return false; seen.add(scene);
    return sc.items.some(i => i.enabled !== false && (i.source === n || this.reaches(i.source, n, seen)));
  }
  connected = true;
  log: { req: string; data?: any }[] = [];
  /** Fail a request (returns an error message) — partial failure tests. */
  failOn: ((req: string, data: any) => string | null) | null = null;
  /** Disconnect after this many more requests. */
  dropAfter: number | null = null;
  video = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 };
  kinds = ['browser_source', 'game_capture', 'window_capture', 'monitor_capture', 'dshow_input', 'wasapi_input_capture', 'wasapi_output_capture', 'wasapi_process_output_capture', 'ffmpeg_source', 'image_source'];
  /** Audio events the mock raises (InputMuteStateChanged…), for the protocol server. */
  onEvent: ((type: string, data: any) => void) | null = null;
  private au(n: any) { const i = this.inputs.get(this.name(n)); if (!i) this.err(600, `No source was found by the name of \`${n}\`.`); if (/^(image_source|color_source|game_capture|monitor_capture|window_capture)/.test(i.kind)) this.err(604, 'The specified input does not support audio.'); return (i.audio ??= { muted: false, volumeDb: 0, sync: 0, monitor: 'OBS_MONITORING_TYPE_NONE' }); }

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
      case 'GetVersion': return { obsVersion: '31.0.0 (mock)', obsWebSocketVersion: '5.5.0 (mock)', rpcVersion: 1, availableRequests: ['GetVersion', 'GetVideoSettings', 'GetSceneList', 'GetInputList', 'GetInputKindList', 'GetSceneItemList', 'GetInputSettings', 'CreateScene', 'CreateInput', 'SetInputSettings', 'CreateSceneItem', 'SetSceneItemTransform', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'SetCurrentProgramScene', 'GetSourceActive', 'GetStats', 'RemoveScene', 'RemoveSceneItem'] };
      case 'GetVideoSettings': return { ...this.video };
      case 'GetSceneList': return { currentProgramSceneName: this.program, currentPreviewSceneName: this.studioMode ? this.preview : null,
        scenes: [...this.scenes].map(([n, s], i) => ({ sceneName: n, sceneUuid: s.uuid, sceneIndex: this.scenes.size - 1 - i })).reverse() };
      case 'GetInputList': return { inputs: [...this.inputs].filter(([, i]) => !data?.inputKind || i.kind === data.inputKind).map(([n, i]) => ({ inputName: n, inputUuid: i.uuid, inputKind: i.kind, unversionedInputKind: i.kind })) };
      // OBS semantics: active = drawn in Program (nested scenes included, enabled items only); showing = active or in
      // the Studio-Mode Preview (or a projector: `projected`).
      case 'GetSourceActive': { const n = this.name(data.sourceName); const active = this.reaches(this.program, n); return { videoActive: active, videoShowing: active || (this.studioMode && this.reaches(this.preview, n)) || this.projected.has(n) }; }
      case 'GetStats': return { cpuUsage: 7.5, memoryUsage: 812.4, availableDiskSpace: 1e5, activeFps: 60, averageFrameRenderTime: 3.21, renderSkippedFrames: 0, renderTotalFrames: 36000, outputSkippedFrames: 0, outputTotalFrames: 36000, webSocketSessionIncomingMessages: 0, webSocketSessionOutgoingMessages: 0 };
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
      case 'SetSceneItemEnabled': { const it = this.item(data); it.enabled = !!data.sceneItemEnabled; this.onEvent?.('SceneItemEnableStateChanged', { sceneName: data.sceneName, sceneItemId: it.id, sceneItemEnabled: it.enabled }); return {}; }
      // ---- removals (OBS semantics: removing a scene removes it from every scene that nests it; an input no scene
      // references any more is released with it)
      case 'RemoveScene': {
        const n = this.name(data.sceneName); this.scene(n);
        if (n === this.program) this.err(702, 'Cannot remove the current program scene');
        this.scenes.delete(n);
        for (const x of this.scenes.values()) x.items = x.items.filter(i => i.source !== n);
        this.gc(); this.onEvent?.('SceneRemoved', { sceneName: n }); this.onEvent?.('SceneListChanged', {}); return {};
      }
      case 'RemoveSceneItem': { const s = this.scene(data.sceneName); const it = this.item(data); s.items.splice(s.items.indexOf(it), 1); this.gc(); this.onEvent?.('SceneItemRemoved', { sceneName: data.sceneName, sceneItemId: it.id }); return {}; }
      case 'SetSceneItemIndex': { const s = this.scene(data.sceneName); const it = this.item(data); s.items.splice(s.items.indexOf(it), 1); s.items.splice(Math.max(0, Math.min(s.items.length, data.sceneItemIndex)), 0, it); return {}; }
      case 'GetSceneItemId': { const it = this.scene(data.sceneName).items.find(i => i.source === data.sourceName); if (!it) this.err(600, 'No item'); return { sceneItemId: it.id }; }
      case 'GetStudioModeEnabled': return { studioModeEnabled: this.studioMode };
      // a mock cannot render: the "screenshot" is the scene's visible composition (enough to tell two scenes apart)
      case 'GetSourceScreenshot': { const sc = this.scene(data.sourceName); return { imageData: 'data:image/png;base64,' + Buffer.from(JSON.stringify(sc.items.filter(i => i.enabled).map(i => [i.source, this.inputs.get(i.source)?.settings.url]))).toString('base64') }; }
      // ---- audio (obs-websocket 5.x request and field names)
      case 'GetInputMute': return { inputMuted: this.au(data.inputName).muted };
      case 'SetInputMute': { const a = this.au(data.inputName); a.muted = !!data.inputMuted; this.onEvent?.('InputMuteStateChanged', { inputName: data.inputName, inputMuted: a.muted }); return {}; }
      case 'GetInputVolume': { const a = this.au(data.inputName); return { inputVolumeDb: a.volumeDb, inputVolumeMul: Math.pow(10, a.volumeDb / 20) }; }
      case 'SetInputVolume': { const a = this.au(data.inputName); if (typeof data.inputVolumeDb !== 'number' || data.inputVolumeDb < -100 || data.inputVolumeDb > 26) this.err(402, 'inputVolumeDb out of range'); a.volumeDb = data.inputVolumeDb; return {}; }
      case 'GetInputAudioSyncOffset': return { inputAudioSyncOffset: this.au(data.inputName).sync };
      case 'SetInputAudioSyncOffset': { const a = this.au(data.inputName); if (data.inputAudioSyncOffset < -950 || data.inputAudioSyncOffset > 20000) this.err(402, 'offset out of range'); a.sync = data.inputAudioSyncOffset; return {}; }
      case 'GetInputAudioMonitorType': return { monitorType: this.au(data.inputName).monitor };
      case 'SetInputAudioMonitorType': { const a = this.au(data.inputName); if (!/^OBS_MONITORING_TYPE_(NONE|MONITOR_ONLY|MONITOR_AND_OUTPUT)$/.test(data.monitorType)) this.err(402, 'bad monitorType'); a.monitor = data.monitorType; return {}; }
      case 'SetCurrentProgramScene': this.scene(data.sceneName); this.program = data.sceneName; this.onEvent?.('CurrentProgramSceneChanged', { sceneName: data.sceneName }); return {};
      // ---- transitions and Studio Mode (3.0 main scenes)
      case 'GetSceneTransitionList': return { currentSceneTransitionName: this.transition, transitions: [{ transitionName: 'Fade', transitionKind: 'fade_transition' }, { transitionName: 'Cut', transitionKind: 'cut_transition' }, { transitionName: 'Overdrive Sting', transitionKind: 'obs_stinger_transition' }] };
      case 'SetCurrentSceneTransition': if (!['Fade', 'Cut', 'Overdrive Sting'].includes(data.transitionName)) this.err(600, 'No transition'); this.transition = data.transitionName; return {};
      case 'SetStudioModeEnabled': this.studioMode = !!data.studioModeEnabled; this.onEvent?.('StudioModeStateChanged', { studioModeEnabled: this.studioMode }); return {};
      case 'SetCurrentPreviewScene': if (!this.studioMode) this.err(506, 'Studio mode is not active.'); this.scene(data.sceneName); this.preview = data.sceneName; this.onEvent?.('CurrentPreviewSceneChanged', { sceneName: data.sceneName }); return {};
      default: this.err(204, `Unknown request ${req}`);
    }
  };
  /** Inputs no scene uses any more are released (OBS frees a source with its last reference). */
  private gc() { const used = new Set<string>(); for (const x of this.scenes.values()) for (const i of x.items) used.add(i.source); for (const n of [...this.inputs.keys()]) if (!used.has(n)) this.inputs.delete(n); }
  private item(data: any): MItem { const it = this.scene(data.sceneName).items.find(i => i.id === data.sceneItemId); if (!it) this.err(600, 'No scene item'); return it; }

  // ----- test helpers (what a person would do by hand in OBS)
  addScene(n: string) { this.scenes.set(n, { uuid: uuid(), items: [], nextId: 1 }); }
  addInput(scene: string, n: string, kind: string, settings: Record<string, any> = {}) {
    this.inputs.set(n, { uuid: uuid(), kind, settings });
    const s = this.scenes.get(scene)!; s.items.push({ id: s.nextId++, source: n, enabled: true, transform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE' } });
  }
  renameScene(from: string, to: string) { const s = this.scenes.get(from)!; this.scenes.delete(from); this.scenes.set(to, s); for (const x of this.scenes.values()) for (const i of x.items) if (i.source === from) i.source = to; if (this.program === from) this.program = to; }
  /** By hand in OBS: mute / unmute an input (raises the event like OBS does). */
  setMute(n: string, muted: boolean) { this.au(n).muted = muted; this.onEvent?.('InputMuteStateChanged', { inputName: n, inputMuted: muted }); }
  audioOf(n: string) { return this.inputs.get(n)?.audio; }
  snapshot() { return JSON.stringify({ s: [...this.scenes], i: [...this.inputs], p: this.program, v: this.preview }); }
  writes() { return this.log.filter(l => !l.req.startsWith('Get')); }
}

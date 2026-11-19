/**
 * OBS Scene Builder: discovers every Overdrive output and keeps ONE OBS scene per output, each holding its own
 * 1920×1080 browser source. Runs over the existing OBS WebSocket connection (ObsBridge.call).
 *
 * Safety rules (enforced here, covered by tests/obsSetup.test.ts):
 *  - never deletes a scene, source or scene item;
 *  - never switches the Program or Preview scene, never triggers a transition (so no stinger);
 *  - never overwrites a source it cannot prove is Overdrive's (marker, mapping uuid, or a legacy
 *    "Overdrive …" browser source already pointing at the same Overdrive route);
 *  - never touches capture / audio devices it did not create; never duplicates the shared audio scene;
 *  - every change is shown as a plan first and applied only with that plan's hash (dry run = preview);
 *  - scenes that are OBS's Program are held back unless explicitly allowed;
 *  - one target failing does not stop the others (per-target report).
 */
import crypto from 'node:crypto';
import {
  AUDIO_SCENE, AUDIO_ALL_SCENE, AUDIO_MUSIC_SCENE, GAME_CAPTURE, discoverTargets, routeOf, targetUrl, nativeSizeOf, sourceQuality, canvasQuality,
  type ObsMapEntry, type ObsPlan, type ObsSetupOptions, type ObsSetupState, type ObsSetupStore, type ObsTarget, type OpKind, type PlanOp, type TargetReport, type TargetStatus,
  type MainSceneReport, type CleanupReport, type CleanupScene, type CleanupClass, type ValidationReport, type ValidationItem, type ValidationAutoStatus,
  newValidationSessionId, MAX_VALIDATION_HISTORY,
} from '../shared/obsSetup';
import { MAIN_SCENES, layerSwitch, mainSceneName, mainDef, type MainKey, type MainSceneDef, DESK_SCENES, DESK_SEATS, cameraInputName, bSceneName } from '../shared/obsLayout';
import type { GfxInstance } from '../shared/gfx';
import { isControllerRoute } from '../shared/obsDocks';
import type { ScreenId } from '../shared/types';

export type ObsCall = (request: string, data?: Record<string, any>) => Promise<any>;

export interface ObsSetupDeps {
  /** The existing OBS connection (null while disconnected). */
  call: () => ObsCall | null;
  connected: () => boolean;
  obsUrl: () => string;
  graphics: () => GfxInstance[];
  obsScenes: () => Partial<Record<ScreenId, string>>;
  store: () => ObsSetupStore;
  outputKey: string;
  port: number;
  lanUrls: () => string[];
  /** Overdrive's public address when it is hosted remotely (PUBLIC_URL / RENDER_EXTERNAL_URL / the producer's page). */
  publicUrl: () => string;
  save: () => void;
  onChange: () => void;
  /** After a build: write the new scene mapping into the show / graphics (tally, explicit switching). */
  applyMapping: (built: { target: ObsTarget; scene: string; was?: string }[]) => void;
  /** Cleanup: what in Overdrive still names an OBS scene (rundown segments, screen mapping, graphics, cameras). */
  refsTo?: (scene: string) => string[];
  /** Cleanup: point those references at another scene (the main scene that now holds the output). */
  repoint?: (from: string, to: string) => void;
}

/** Requests the builder needs (checked against GetVersion.availableRequests). */
export const REQUIRED = ['GetSceneList', 'GetInputList', 'GetSceneItemList', 'GetInputSettings', 'CreateScene', 'CreateInput', 'SetInputSettings', 'CreateSceneItem', 'SetSceneItemTransform', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'GetVideoSettings'];
/** Requests the builder must NEVER send (tests assert this). */
export const FORBIDDEN = ['SetCurrentProgramScene', 'SetCurrentPreviewScene', 'TriggerStudioModeTransition', 'RemoveScene', 'RemoveInput', 'RemoveSceneItem', 'SetCurrentSceneTransition', 'SetSceneName', 'SetInputName'];
/** The only removals Overdrive ever sends, and only from a confirmed cleanup (never from Build / Repair / Verify). */
export const CLEANUP_REQUESTS = ['RemoveScene', 'RemoveSceneItem'];
/** Typed confirmation the cleanup needs before it removes anything. */
export const CLEANUP_CONFIRM = 'REMOVE';

const CAPTURE_KINDS = /^(game_capture|window_capture|monitor_capture|display_capture|screen_capture|dshow_input|av_capture_input|v4l2_input|decklink-input|ndi_source|xcomposite_input|pipewire|macos-screen|screen_capture_kit|aja_source)/;
const CSS = 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }';

interface Item { sceneItemId: number; sourceName: string; sourceUuid?: string; inputKind?: string | null; sceneItemIndex: number; sceneItemEnabled: boolean; sourceType?: string; isGroup?: boolean; sceneItemTransform?: any }

const ALL_CAMERA_NAMES = new Set(Object.values(DESK_SEATS).flat().map(cameraInputName));
/**
 * 3.4: a desk's persistent camera inputs are the true bottom layer (below even the audio sources, so they never
 * visually cover anything, though audio has no picture of its own anyway). Every place that inserts an audio
 * item "at the bottom" must insert it just ABOVE any camera items already there, not at literal index 0 — else
 * a later audio insertion (a fresh build, or cleanup's nest-removal) silently pushes the cameras up a layer.
 */
function audioBottomIndex(items: Item[]): number {
  let n = 0;
  while (n < items.length && ALL_CAMERA_NAMES.has(items[n].sourceName)) n++;
  return n;
}

/** OBS as the builder sees it (fetched lazily, updated as the builder creates things). */
class Snapshot {
  scenes = new Map<string, { uuid?: string }>();
  inputs = new Map<string, { kind: string; uuid?: string }>();
  private items = new Map<string, Item[]>();
  private settings = new Map<string, any>();
  program = '';
  preview = '';
  canvas: { w: number; h: number; ow?: number; oh?: number; fps?: number } = { w: 1920, h: 1080 };
  inputKinds: Set<string> | null = null;
  constructor(private call: ObsCall) {}
  async load() {
    const v = await this.call('GetVideoSettings');
    const fps = Number(v.fpsNumerator) / (Number(v.fpsDenominator) || 1);
    this.canvas = { w: Number(v.baseWidth) || 1920, h: Number(v.baseHeight) || 1080, ...(Number(v.outputWidth) ? { ow: Number(v.outputWidth), oh: Number(v.outputHeight) } : {}), ...(fps > 0 ? { fps: Math.round(fps * 100) / 100 } : {}) };
    const sl = await this.call('GetSceneList');
    this.program = String(sl.currentProgramSceneName ?? '');
    this.preview = String(sl.currentPreviewSceneName ?? '');
    for (const s of sl.scenes ?? []) this.scenes.set(String(s.sceneName), { uuid: s.sceneUuid ? String(s.sceneUuid) : undefined });
    const il = await this.call('GetInputList');
    for (const i of il.inputs ?? []) this.inputs.set(String(i.inputName), { kind: String(i.unversionedInputKind ?? i.inputKind ?? ''), uuid: i.inputUuid ? String(i.inputUuid) : undefined });
    try { this.inputKinds = new Set(((await this.call('GetInputKindList', { unversioned: true })).inputKinds ?? []).map(String)); } catch { this.inputKinds = null; }
  }
  sceneByUuid(uuid?: string) { if (!uuid) return null; for (const [n, s] of this.scenes) if (s.uuid === uuid) return n; return null; }
  inputByUuid(uuid?: string) { if (!uuid) return null; for (const [n, s] of this.inputs) if (s.uuid === uuid) return n; return null; }
  async itemsOf(scene: string): Promise<Item[]> {
    if (!this.scenes.has(scene)) return [];
    if (!this.items.has(scene)) this.items.set(scene, ((await this.call('GetSceneItemList', { sceneName: scene })).sceneItems ?? []) as Item[]);
    return this.items.get(scene)!;
  }
  forget(scene: string) { this.items.delete(scene); }
  async settingsOf(input: string): Promise<any> {
    if (!this.settings.has(input)) this.settings.set(input, (await this.call('GetInputSettings', { inputName: input })).inputSettings ?? {});
    return this.settings.get(input);
  }
  setSettings(input: string, s: any) { this.settings.set(input, { ...(this.settings.get(input) ?? {}), ...s }); }
  // ---- dry run: what a planned op would leave behind, so the next targets plan against it (one plan, no repeats)
  simScene(n: string) { if (!this.scenes.has(n)) { this.scenes.set(n, {}); this.items.set(n, []); } }
  simInput(n: string, kind: string, settings: any) { if (!this.inputs.has(n)) { this.inputs.set(n, { kind }); this.settings.set(n, settings); } }
  simItem(scene: string, source: string, enabled: boolean, kind?: string) { const l = this.items.get(scene) ?? []; l.push({ sceneItemId: -1 - l.length, sourceName: source, inputKind: kind ?? this.inputs.get(source)?.kind ?? null, sceneItemIndex: l.length, sceneItemEnabled: enabled }); this.items.set(scene, l); }
}

interface SyncResult { ops: PlanOp[]; blocked?: string; issues: string[]; unmanaged: string[]; lines: string[]; scene: string; input: string; url: string; onAir: boolean; entry?: ObsMapEntry; created: boolean; inputMissing: boolean; sceneMissing: boolean }

export function createObsSetup(d: ObsSetupDeps) {
  let busy: string | null = null;
  let plan: ObsPlan | null = null;
  let reports: TargetReport[] = [];
  let scannedAt = 0;
  let version: ObsSetupState['version'];
  let canvas: ObsSetupState['canvas'];
  let lastRun: ObsSetupState['lastRun'] = null;
  let leaks: ObsSetupState['controllerLeaks'] = [];
  let quality: ObsSetupState['quality'] = [];

  const opts = (): ObsSetupOptions => d.store().options;
  const targets = () => discoverTargets(d.graphics(), d.obsScenes(), opts());

  /** Where OBS reaches Overdrive: an explicit base, this computer when OBS is local, else this computer's LAN address. */
  function base(): { url: string; reason: string } {
    if (opts().baseUrl) return { url: opts().baseUrl, reason: 'Set by you.' };
    let host = '';
    try { host = new URL(d.obsUrl()).hostname; } catch {}
    const local = `http://localhost:${d.port}`;
    if (!host || /^(localhost|127\.|::1|\[::1\])/.test(host)) return { url: local, reason: 'OBS runs on this computer.' };
    const lanHost = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)|\.local$/.test(host) || !host.includes('.');
    if (!lanHost) {
      // OBS reached through a public address or tunnel: Overdrive is hosted remotely, so OBS must load its public URL
      const pub = d.publicUrl();
      if (pub) return { url: pub, reason: `OBS is reached over the internet (${host}): using Overdrive's public address.` };
      return { url: local, reason: `OBS is reached over the internet (${host}) but Overdrive's public address is unknown: set the base URL (e.g. https://your-overdrive.example).` };
    }
    const lan = d.lanUrls();
    const same = lan.find(u => { try { return new URL(u).hostname.split('.').slice(0, 3).join('.') === host.split('.').slice(0, 3).join('.'); } catch { return false; } });
    if (same ?? lan[0]) return { url: (same ?? lan[0])!, reason: `OBS is on another computer (${host}): using this computer's network address.` };
    return { url: local, reason: `OBS is on ${host} but this computer has no network address: set the base URL OBS should use.` };
  }

  const browserSettings = (t: ObsTarget, url: string) => ({
    url, width: t.width, height: t.height, fps_custom: true, fps: 60, css: CSS, shutdown: false, restart_when_active: false,
    reroute_audio: t.rerouteAudio, overdrive_id: t.id,
  });

  /** Does an item cover the whole canvas with no rotation or crop? */
  function fills(tr: any, w: number, h: number, cw: number, ch: number): boolean {
    if (!tr) return false;
    const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
    if (!near(Number(tr.positionX) || 0, 0) || !near(Number(tr.positionY) || 0, 0) || (Number(tr.rotation) || 0) !== 0) return false;
    if ((tr.cropLeft || tr.cropRight || tr.cropTop || tr.cropBottom)) return false;
    if (tr.alignment != null && tr.alignment !== 5) return false;
    if (tr.boundsType && tr.boundsType !== 'OBS_BOUNDS_NONE') return near(tr.boundsWidth, cw) && near(tr.boundsHeight, ch);
    return near((Number(tr.scaleX) || 1) * (Number(tr.sourceWidth) || w), cw) && near((Number(tr.scaleY) || 1) * (Number(tr.sourceHeight) || h), ch);
  }
  /** A transform read from OBS, without the read-only fields (to copy an item to another scene as it was). */
  const transformOf = (tr: any) => { const { sourceWidth: _w, sourceHeight: _h, width: _x, height: _y, ...rest } = tr ?? {}; return rest; };
  const FILL = (cw: number, ch: number) => ({ positionX: 0, positionY: 0, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_STRETCH', boundsAlignment: 0, boundsWidth: cw, boundsHeight: ch, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 });

  /** Is this existing OBS input Overdrive's source for target t? */
  async function ownership(snap: Snapshot, t: ObsTarget, name: string, entry?: ObsMapEntry): Promise<'owned' | 'adopt' | string> {
    const inp = snap.inputs.get(name)!;
    if (entry?.inputUuid && inp.uuid && entry.inputUuid === inp.uuid) return 'owned';
    if (inp.kind !== 'browser_source') return `An OBS source named "${name}" already exists and is not a browser source.`;
    const s = await snap.settingsOf(name);
    if (typeof s.overdrive_id === 'string') return s.overdrive_id === t.id ? 'owned' : `"${name}" belongs to another Overdrive output (${s.overdrive_id}).`;
    if (entry && entry.input === name) return 'owned';
    const r = typeof s.url === 'string' ? routeOf(s.url) : null;
    if (name.startsWith('Overdrive') && r === t.route) return 'adopt'; // built by an earlier Overdrive version
    return `An OBS source named "${name}" already exists and is not Overdrive's (it shows ${s.url ? `“${s.url}”` : 'no URL'}). Rename it in OBS or rename this graphic.`;
  }

  /**
   * One target: computes the operations (dry run) or performs them (exec). The SAME code path does both, so
   * the preview is exactly what apply does.
   */
  /** Main-scenes layout: the OBS name of a main scene (followed by uuid when it was renamed in OBS). */
  function mainScene(snap: Snapshot, key: MainKey): string {
    const e = d.store().map[`main:${key}`];
    return snap.sceneByUuid(e?.sceneUuid) ?? mainSceneName(key);
  }
  /**
   * 3.6: the name of the "all talent audio" nested scene (main layout). Deliberately a NEW, dedicated name rather
   * than reusing the legacy per-output "Overdrive · Caster audio" scene: that scene, if still around from a 3.1
   * install, stays exactly what the existing migration/cleanup flow already understands it to be (a leftover to
   * consolidate once nothing nests it) — keeping the two migrations independent and each one's behaviour predictable.
   */
  function allAudioScene(_snap: Snapshot): string { return AUDIO_ALL_SCENE; }
  /** Inputs of every built Overdrive output (to tell Overdrive's items from the operator's own). */
  function knownInputs(snap: Snapshot): Set<string> {
    const out = new Set<string>(SUPPORT.map(x => x.name).concat([GAME_CAPTURE, AUDIO_SCENE, AUDIO_ALL_SCENE, AUDIO_MUSIC_SCENE]));
    for (const t of targets()) { const e = d.store().map[t.id]; out.add(snap.inputByUuid(e?.inputUuid) ?? t.input); if (t.role === 'state') out.add(t.input); /* 3.3 retired per-view source */ }
    for (const e of Object.values(d.store().map)) if (e.input) out.add(e.input);
    // 3.4: persistent camera inputs (one per talent seat)
    for (const seats of Object.values(DESK_SEATS)) for (const seat of seats) out.add(cameraInputName(seat));
    return out;
  }

  /**
   * One target: computes the operations (dry run) or performs them (exec). The SAME code path does both, so
   * the preview is exactly what apply does.
   */
  async function sync(snap: Snapshot, call: ObsCall, t: ObsTarget, mode: 'build' | 'repair', exec: boolean, allowLive: boolean, url: string): Promise<SyncResult> {
    const store = d.store();
    const entry = store.map[t.id];
    const main = !!t.main;
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [], unmanaged: string[] = [];
    const input = snap.inputByUuid(entry?.inputUuid) ?? t.input;
    // 3.3: a Preview identity lives in its own internal scene (followed by uuid), never in a main scene
    let scene = t.role === 'pvw' ? snap.sceneByUuid(entry?.sceneUuid) ?? t.scene : main ? mainScene(snap, t.main!) : snap.sceneByUuid(entry?.sceneUuid) ?? t.scene;
    // Renamed in OBS by hand and no uuids (obs-websocket < 5.5): the scene that still holds our own source is it.
    if (!main && !snap.scenes.has(scene) && entry && snap.inputs.has(input)) {
      for (const n of snap.scenes.keys()) if (n === entry.scene || (await snap.itemsOf(n)).some(i => i.sourceName === input)) { scene = n; break; }
    }
    const res: SyncResult = { ops, issues, lines, unmanaged, scene, input, url, onAir: false, created: false, inputMissing: false, sceneMissing: false };
    // 3.3 unified scene: a view is a STATE of the scene's one Program source, not an OBS source of its own
    if (t.role === 'state') {
      const bt = targets().find(x => x.main === t.main && x.role === 'base');
      const binput = bt ? snap.inputByUuid(store.map[bt.id]?.inputUuid) ?? bt.input : '';
      res.input = binput; res.url = '';
      res.sceneMissing = !snap.scenes.has(scene);
      if (!res.sceneMissing && !(await snap.itemsOf(scene)).some(i => i.sourceName === binput)) issues.push(`drawn by "${binput}", which is not in "${scene}" yet`);
      if (exec) res.entry = { scene, sceneUuid: snap.scenes.get(scene)?.uuid, input: binput, inputUuid: snap.inputs.get(binput)?.uuid, url: '', at: Date.now(), main: t.main, role: 'state' };
      return res;
    }
    if (snap.inputs.has(scene)) return { ...res, blocked: `The scene name "${scene}" is already used by an OBS source.` };
    if (snap.scenes.has(input)) return { ...res, blocked: `The source name "${input}" is already used by an OBS scene.` };
    const sceneExists = snap.scenes.has(scene);
    res.sceneMissing = !sceneExists;
    const onAir = sceneExists && scene === snap.program;
    res.onAir = onAir;
    let own: 'owned' | 'adopt' | string | null = null;
    if (snap.inputs.has(input)) {
      own = await ownership(snap, t, input, entry);
      if (own !== 'owned' && own !== 'adopt') return { ...res, blocked: own };
    }
    const op = (kind: OpKind, detail: string, existing = sceneExists) => { const o: PlanOp = { target: t.id, kind, scene, detail, existing, onAir: existing && onAir }; ops.push(o); return o; };
    /** Run fn now (exec) unless the op is held back because its scene is on air; in a dry run, record what it leaves. */
    const act = async (o: PlanOp, fn: () => Promise<void>, sim?: () => void) => {
      if (!exec) { sim?.(); return; }
      if (o.onAir && !allowLive) { lines.push(`Held (scene is on air in OBS): ${o.detail}`); return; }
      await fn();
      lines.push(o.detail);
    };
    // main layout: a layer is created hidden (Producer shows it); the base is shown
    const visible = !main || t.role === 'base' || t.role === 'pvw';

    if (!sceneExists) {
      const o = op('create-scene', `Create scene "${scene}"`, false);
      await act(o, async () => { const r = await call('CreateScene', { sceneName: scene }); snap.scenes.set(scene, { uuid: r?.sceneUuid }); res.created = true; }, () => snap.simScene(scene));
    }
    let items = await snap.itemsOf(scene);
    const mine = () => items.find(i => i.sourceName === input);
    const where = main ? `${t.role === 'base' ? 'base' : t.role} layer${visible ? '' : ', hidden until Producer shows it'}` : 'full canvas';

    if (!snap.inputs.has(input)) {
      res.inputMissing = true;
      const o = op('create-input', `Create browser source "${input}" (${t.width}×${t.height}) → ${url}${main ? ` in "${scene}" (${where})` : ''}`);
      await act(o, async () => {
        const r = await call('CreateInput', { sceneName: scene, inputName: input, inputKind: 'browser_source', inputSettings: browserSettings(t, url), sceneItemEnabled: visible });
        snap.inputs.set(input, { kind: 'browser_source', uuid: r?.inputUuid });
        if (t.role === 'pvw') await call('SetInputMute', { inputName: input, inputMuted: true }); // audio isolation: Preview is never heard
        snap.setSettings(input, browserSettings(t, url));
        await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
        snap.forget(scene); items = await snap.itemsOf(scene);
      }, () => { snap.simInput(input, 'browser_source', browserSettings(t, url)); snap.simItem(scene, input, visible); });
    } else {
      if (!mine()) {
        res.inputMissing = true;
        // the existing source is added (same browser source, same page, same WebRTC session: never a copy)
        const o = op('add-item', `Add "${input}" to "${scene}" (${where})`);
        await act(o, async () => {
          const r = await call('CreateSceneItem', { sceneName: scene, sourceName: input, sceneItemEnabled: visible });
          await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
          snap.forget(scene); items = await snap.itemsOf(scene);
        }, () => snap.simItem(scene, input, visible));
      }
      // drift on an existing Overdrive source
      const s = await snap.settingsOf(input);
      const drift: string[] = [];
      if (s.url !== url) drift.push(`URL is ${s.url ? `“${s.url}”` : 'empty'}, should be ${url}`);
      if ((s.width ?? 800) !== t.width || (s.height ?? 600) !== t.height) drift.push(`size is ${s.width ?? 800}×${s.height ?? 600}, should be ${t.width}×${t.height}`);
      if (!!s.reroute_audio !== t.rerouteAudio) drift.push(t.rerouteAudio ? 'audio is not controlled by OBS' : 'audio is routed to the OBS mixer');
      if (own === 'adopt') drift.push('not marked as Overdrive-managed yet (built by an earlier version)');
      if (drift.length) {
        if (mode === 'repair') {
          const o = op('set-settings', `Repair "${input}": ${drift.join('; ')}`);
          await act(o, async () => { const v = browserSettings(t, url); await call('SetInputSettings', { inputName: input, inputSettings: v, overlay: true }); snap.setSettings(input, v); });
        } else issues.push(...drift);
      }
    }
    // 3.3 Preview identity: always muted (no Preview audio can leak into the mix)
    if (t.role === 'pvw' && snap.inputs.has(input) && !res.inputMissing) {
      let muted = true;
      try { muted = !!(await call('GetInputMute', { inputName: input })).inputMuted; } catch {}
      if (!muted) { const o = op('mute', `Mute "${input}" (Preview identity: never heard)`); await act(o, async () => { await call('SetInputMute', { inputName: input, inputMuted: true }); }); }
    }
    // the item: full canvas (visibility belongs to the Producer in the main layout)
    const it = mine();
    if (it && !res.inputMissing && it.sceneItemId > 0) {
      if (!fills(it.sceneItemTransform, t.width, t.height, snap.canvas.w, snap.canvas.h)) {
        if (mode === 'repair') { const o = op('transform', `Fit "${input}" to the full ${snap.canvas.w}×${snap.canvas.h} canvas`); await act(o, async () => { await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: it.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) }); }); }
        else issues.push('not fitted to the full canvas');
      }
      if (!main && !it.sceneItemEnabled) {
        if (mode === 'repair') { const o = op('enable', `Show "${input}" (it is hidden in OBS)`); await act(o, async () => { await call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: it.sceneItemId, sceneItemEnabled: true }); }); }
        else issues.push('hidden in OBS');
      }
    }
    // 3.5 layer ordering: a panel or overlay must render ABOVE its scene's base (else a manually-dragged item in
    // OBS silently hides under the base and the operator sees nothing change when they switch to it in Producer).
    if (main && it && !res.inputMissing && it.sceneItemId > 0 && (t.role === 'panel' || t.role === 'overlay')) {
      const bt = targets().find(x => x.main === t.main && x.role === 'base');
      const be = bt ? d.store().map[bt.id] : undefined;
      const baseInput = bt ? snap.inputByUuid(be?.inputUuid) ?? bt.input : '';
      const baseItem = baseInput ? items.find(i => i.sourceName === baseInput) : undefined;
      if (baseItem && it.sceneItemIndex < baseItem.sceneItemIndex) {
        if (mode === 'repair') {
          const o = op('order', `Move "${input}" above the base "${baseInput}" in "${scene}" (it was drawn underneath, so it never showed)`);
          await act(o, async () => { await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: it.sceneItemId, sceneItemIndex: items.length - 1 }); snap.forget(scene); items = await snap.itemsOf(scene); });
        } else issues.push(`drawn below the base "${baseInput}": it will never be visible until re-ordered`);
      }
    }
    // composition: gameplay capture under the overlay
    if (t.gameCapture) {
      const isCap = (i: Item) => i.sourceName !== input && CAPTURE_KINDS.test(String(i.inputKind ?? snap.inputs.get(i.sourceName)?.kind ?? ''));
      const caps = items.filter(isCap);
      if (!caps.length) {
        // main layout: reuse the capture the old per-output scene already had (the operator's own game feed)
        const old = main && entry?.scene && entry.scene !== scene ? (snap.sceneByUuid(entry.sceneUuid) ?? entry.scene) : null;
        const oldCaps = old && snap.scenes.has(old) ? (await snap.itemsOf(old)).filter(isCap) : [];
        const avail = !snap.inputKinds || snap.inputKinds.has('game_capture');
        if (oldCaps.length) {
          for (const c of oldCaps) {
            const o = op('add-capture', `Add the existing capture "${c.sourceName}" from "${old}" under the overlay (same source, settings and transform kept)`);
            await act(o, async () => {
              const id = (await call('CreateSceneItem', { sceneName: scene, sourceName: c.sourceName, sceneItemEnabled: c.sceneItemEnabled })).sceneItemId;
              if (c.sceneItemTransform) await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: id, sceneItemTransform: transformOf(c.sceneItemTransform) });
              await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
              snap.forget(scene); items = await snap.itemsOf(scene);
            }, () => snap.simItem(scene, c.sourceName, true, String(c.inputKind ?? '')));
          }
        } else if (!avail && !snap.inputs.has(GAME_CAPTURE)) issues.push('no game capture in the scene, and this OBS has no Game Capture source (Windows only): add your capture or video feed under the overlay');
        else {
          const o = op('add-capture', snap.inputs.has(GAME_CAPTURE) ? `Add the existing "${GAME_CAPTURE}" under the overlay (its settings are not changed)` : `Create "${GAME_CAPTURE}" (any fullscreen game) under the overlay`);
          await act(o, async () => {
            let id: number;
            if (snap.inputs.has(GAME_CAPTURE)) id = (await call('CreateSceneItem', { sceneName: scene, sourceName: GAME_CAPTURE, sceneItemEnabled: true })).sceneItemId;
            else { const r = await call('CreateInput', { sceneName: scene, inputName: GAME_CAPTURE, inputKind: 'game_capture', inputSettings: { capture_mode: 'any_fullscreen', capture_cursor: false }, sceneItemEnabled: true }); snap.inputs.set(GAME_CAPTURE, { kind: 'game_capture', uuid: r?.inputUuid }); id = r.sceneItemId; }
            await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
            snap.forget(scene); items = await snap.itemsOf(scene);
          }, () => { snap.simInput(GAME_CAPTURE, 'game_capture', {}); snap.simItem(scene, GAME_CAPTURE, true, 'game_capture'); });
        }
      } else {
        const ov = mine();
        const top = Math.max(...caps.map(c => c.sceneItemIndex));
        if (ov && ov.sceneItemId > 0 && ov.sceneItemIndex < top) {
          if (mode === 'repair') { const o = op('order', `Move "${input}" above the capture "${caps.find(c => c.sceneItemIndex === top)!.sourceName}"`); await act(o, async () => { await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: ov.sceneItemId, sceneItemIndex: top }); snap.forget(scene); items = await snap.itemsOf(scene); }); }
          else issues.push('the overlay is below the game capture');
        }
      }
    }
    // composition: the shared caster-audio / music scene (per-output layout; the main layout adds the audio per scene)
    if (!main && t.audio && !items.some(i => i.sourceName === AUDIO_SCENE)) {
      const o = op('nest-audio', `Add the shared "${AUDIO_SCENE}" scene (caster mics + music)`);
      await act(o, async () => { await call('CreateSceneItem', { sceneName: scene, sourceName: AUDIO_SCENE, sceneItemEnabled: true }); snap.forget(scene); items = await snap.itemsOf(scene); });
    }
    // report what Overdrive does not manage (kept as is)
    const others = d.store();
    if (!main || t.role === 'base') {
      const known = main ? knownInputs(snap) : null;
      for (const i of items) {
        if (i.sourceName === input || i.sourceName === AUDIO_SCENE) continue;
        if (t.gameCapture && CAPTURE_KINDS.test(String(i.inputKind ?? snap.inputs.get(i.sourceName)?.kind ?? ''))) continue;
        if (known?.has(i.sourceName)) continue;
        const foreign = Object.entries(others.map).find(([k, e]) => k !== t.id && e.input === i.sourceName);
        unmanaged.push(foreign ? `${i.sourceName} (another Overdrive output: ${foreign[0]})` : i.sourceName);
      }
    }
    if (exec) {
      const it2 = (await snap.itemsOf(scene)).find(i => i.sourceName === input);
      res.entry = { scene, sceneUuid: snap.scenes.get(scene)?.uuid, input, inputUuid: snap.inputs.get(input)?.uuid, itemId: it2?.sceneItemId, url, at: Date.now(), ...(main ? { main: t.main, role: t.role } : {}) };
    }
    return res;
  }

  /**
   * Main-scenes layout, per scene: the scene itself, Safe / BRB's shared base, and the audio sources (the same caster
   * mic and music sources in every scene, at the bottom; music only in Safe / BRB). Runs after the outputs.
   */
  async function syncMain(snap: Snapshot, call: ObsCall, m: MainSceneDef, phase: 'scene' | 'finish', exec: boolean, allowLive: boolean): Promise<SyncResult> {
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [];
    const scene = mainScene(snap, m.key);
    const res: SyncResult = { ops, issues, lines, unmanaged: [], scene, input: '', url: '', onAir: false, created: false, inputMissing: false, sceneMissing: !snap.scenes.has(scene) };
    if (snap.inputs.has(scene)) return { ...res, blocked: `The scene name "${scene}" is already used by an OBS source.` };
    const exists = snap.scenes.has(scene);
    res.onAir = exists && scene === snap.program;
    const op = (kind: OpKind, detail: string, existing = exists) => { const o: PlanOp = { target: `main:${m.key}`, kind, scene, detail, existing, onAir: existing && res.onAir }; ops.push(o); return o; };
    const act = async (o: PlanOp, fn: () => Promise<void>, sim?: () => void) => {
      if (!exec) { sim?.(); return; }
      if (o.onAir && !allowLive) { lines.push(`Held (scene is on air in OBS): ${o.detail}`); return; }
      await fn(); lines.push(o.detail);
    };
    if (phase === 'scene') {
      if (!exists) await act(op('create-scene', `Create scene "${scene}"`, false), async () => { const r = await call('CreateScene', { sceneName: scene }); snap.scenes.set(scene, { uuid: r?.sceneUuid }); res.created = true; }, () => snap.simScene(scene));
      return res;
    }
    let items = await snap.itemsOf(scene);
    if (m.sharedBase) {
      const t = targets().find(x => m.base.includes(x.id));
      const e = t ? d.store().map[t.id] : undefined;
      const input = t ? snap.inputByUuid(e?.inputUuid) ?? t.input : '';
      if (!t || !snap.inputs.has(input)) issues.push(`its picture (${m.base.join(' / ')}) is not built yet`);
      else if (!items.some(i => i.sourceName === input)) {
        await act(op('add-item', `Add "${input}" to "${scene}" (shared with ${mainSceneName(t.main!)}: the same browser source)`), async () => {
          const r = await call('CreateSceneItem', { sceneName: scene, sourceName: input, sceneItemEnabled: true });
          await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
          snap.forget(scene); items = await snap.itemsOf(scene);
        }, () => snap.simItem(scene, input, true));
      }
    }
    if (opts().audio) {
      // 3.6: one nested "audio group" scene item instead of 7 flat ones (same underlying sources either way).
      const groupName = m.audio === 'music' ? AUDIO_MUSIC_SCENE : allAudioScene(snap);
      const hasOldLegacy = items.some(i => i.sourceName === AUDIO_SCENE) && groupName !== AUDIO_SCENE;
      const hasOldFlat = SUPPORT.some(a => (m.audio === 'all' || a.route === '/output/music') && items.some(i => i.sourceName === a.name));
      if (hasOldLegacy) issues.push(`still nests the old "${AUDIO_SCENE}" scene directly: run the Scene Builder's audio migration (Cleanup report) to switch to "${groupName}"`);
      else if (hasOldFlat) issues.push(`still has the old flat audio items (one per mic + music) instead of the single "${groupName}" scene: run the Scene Builder's audio migration (Cleanup report)`);
      else if (!snap.scenes.has(groupName) && !snap.inputs.has(groupName)) issues.push(`its audio group "${groupName}" is not built yet`);
      else if (snap.inputs.has(groupName)) issues.push(`"${groupName}" is the name of an OBS source, not a scene`);
      else if (!items.some(i => i.sourceName === groupName)) {
        await act(op('add-item', `Add "${groupName}" to "${scene}" (nested scene: same audio sources as every other scene)`), async () => {
          const r = await call('CreateSceneItem', { sceneName: scene, sourceName: groupName, sceneItemEnabled: true });
          await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemIndex: audioBottomIndex(items) });
          snap.forget(scene); items = await snap.itemsOf(scene);
        }, () => snap.simItem(scene, groupName, true));
      }
    }
    if (exec && phase === 'finish') {
      const t = targets().find(x => m.base.includes(x.id) && (m.sharedBase || x.main === m.key));
      const e = t ? d.store().map[t.id] : undefined;
      const input = t ? snap.inputByUuid(e?.inputUuid) ?? t.input : '';
      const it = (await snap.itemsOf(scene)).find(i => i.sourceName === input);
      res.entry = { scene, sceneUuid: snap.scenes.get(scene)?.uuid, input, inputUuid: snap.inputs.get(input)?.uuid, itemId: it?.sceneItemId, url: '', at: Date.now(), main: m.key, role: 'base' };
    }
    return res;
  }

  /** The shared audio scene: 6 remote-caster mic sources + music, created once. */
  const SUPPORT: { name: string; route: string }[] = [1, 2, 3, 4, 5, 6].map(n => ({ name: `Overdrive Caster ${n} audio`, route: `/output/audio/${n}` })).concat([{ name: 'Overdrive Music', route: '/output/music' }]);
  /**
   * The audio sources: 6 remote-caster mics + music, created once. Per-output layout: inside the shared
   * "Overdrive · Caster audio" scene. 3.6 main layout: inside "Audio (All)" (nested as ONE item into every main
   * scene by syncMain, instead of 7 flat items) — and the music source is ALSO referenced once more from a small
   * "Audio (Music only)" scene, for Safe/BRB. Same input either way: never a second "Overdrive Music" source.
   */
  async function syncAudio(snap: Snapshot, call: ObsCall, mode: 'build' | 'repair', exec: boolean, b: string): Promise<SyncResult> {
    const main = opts().layout === 'main';
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [];
    const home = main ? allAudioScene(snap) : AUDIO_SCENE;
    const res: SyncResult = { ops, issues, lines, unmanaged: [], scene: home, input: '', url: '', onAir: false, created: false, inputMissing: false, sceneMissing: false };
    if (snap.inputs.has(home)) return { ...res, blocked: `"${home}" is the name of an OBS source, not a scene.` };
    if (main && snap.inputs.has(AUDIO_MUSIC_SCENE)) return { ...res, blocked: `"${AUDIO_MUSIC_SCENE}" is the name of an OBS source, not a scene.` };
    const exists = snap.scenes.has(home);
    res.sceneMissing = !exists;
    const op = (kind: OpKind, detail: string, scene = home, existing?: boolean) => { const ex = existing ?? snap.scenes.has(scene); const o: PlanOp = { target: 'support:audio', kind, scene, detail, existing: ex, onAir: ex && scene === snap.program }; ops.push(o); return o; };
    const act = async (o: PlanOp, fn: () => Promise<void>, sim?: () => void) => { if (exec) { await fn(); lines.push(o.detail); } else sim?.(); };
    if (!exists) await act(op('create-scene', `Create scene "${home}"${main ? ' (nested once into every main scene)' : ''}`, home, false), async () => { const r = await call('CreateScene', { sceneName: home }); snap.scenes.set(home, { uuid: r?.sceneUuid }); }, () => snap.simScene(home));
    let items = snap.scenes.has(home) ? await snap.itemsOf(home) : [];
    for (const s of SUPPORT) {
      const url = targetUrl(b, s.route, d.outputKey);
      const settings = { url, width: 320, height: 180, reroute_audio: true, shutdown: false, restart_when_active: false, overdrive_id: `support:${s.route}` };
      if (!snap.inputs.has(s.name)) {
        res.inputMissing = true;
        await act(op('create-input', `Create audio source "${s.name}" → ${url} (in "${home}"${main ? ', nested into every scene' : ''})`), async () => { const r = await call('CreateInput', { sceneName: home, inputName: s.name, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true }); snap.inputs.set(s.name, { kind: 'browser_source', uuid: r?.inputUuid }); snap.setSettings(s.name, settings); snap.forget(home); items = await snap.itemsOf(home); },
          () => { snap.simInput(s.name, 'browser_source', settings); snap.simItem(home, s.name, true); });
        continue;
      }
      const kind = snap.inputs.get(s.name)!.kind;
      const cur = kind === 'browser_source' ? await snap.settingsOf(s.name) : null;
      const r = cur && typeof cur.url === 'string' ? routeOf(cur.url) : null;
      const mineMark = cur?.overdrive_id === `support:${s.route}`;
      if (!cur || (!mineMark && r !== s.route)) { issues.push(`"${s.name}" exists but is not Overdrive's audio source: left untouched`); continue; }
      if (!items.some(i => i.sourceName === s.name)) { res.inputMissing = true; await act(op('add-item', `Add "${s.name}" to "${home}"`), async () => { await call('CreateSceneItem', { sceneName: home, sourceName: s.name, sceneItemEnabled: true }); snap.forget(home); items = await snap.itemsOf(home); }); }
      const drift = cur.url !== url || cur.reroute_audio !== true || !mineMark;
      if (drift) {
        if (mode === 'repair') await act(op('set-settings', `Repair "${s.name}" (URL ${url}, audio controlled by OBS)`), async () => { await call('SetInputSettings', { inputName: s.name, inputSettings: settings, overlay: true }); snap.setSettings(s.name, settings); });
        else issues.push(`"${s.name}" needs repair (URL or audio routing)`);
      }
    }
    // 3.6: "Audio (Music only)" — the SAME "Overdrive Music" input, referenced a second time from its own small
    // scene, so Safe/BRB can nest just the music without the 6 mics.
    if (main) {
      const musicExists = snap.scenes.has(AUDIO_MUSIC_SCENE);
      if (!musicExists) await act(op('create-scene', `Create scene "${AUDIO_MUSIC_SCENE}" (music only, nested into Safe / BRB)`, AUDIO_MUSIC_SCENE, false), async () => { const r = await call('CreateScene', { sceneName: AUDIO_MUSIC_SCENE }); snap.scenes.set(AUDIO_MUSIC_SCENE, { uuid: r?.sceneUuid }); }, () => snap.simScene(AUDIO_MUSIC_SCENE));
      if (!snap.inputs.has('Overdrive Music')) issues.push('"Overdrive Music" is not built yet (built above on this same run, or run Build again)');
      else {
        const mItems = snap.scenes.has(AUDIO_MUSIC_SCENE) ? await snap.itemsOf(AUDIO_MUSIC_SCENE) : [];
        if (!mItems.some(i => i.sourceName === 'Overdrive Music')) {
          await act(op('add-item', `Add "Overdrive Music" to "${AUDIO_MUSIC_SCENE}" (same source as "${home}")`, AUDIO_MUSIC_SCENE), async () => { await call('CreateSceneItem', { sceneName: AUDIO_MUSIC_SCENE, sourceName: 'Overdrive Music', sceneItemEnabled: true }); snap.forget(AUDIO_MUSIC_SCENE); }, () => snap.simItem(AUDIO_MUSIC_SCENE, 'Overdrive Music', true));
        }
      }
    }
    if (exec) { snap.forget(home); if (main) snap.forget(AUDIO_MUSIC_SCENE); }
    return res;
  }

  // ------------------------------------------------------------------ 3.4 Camera composition: persistent inputs + B scenes
  /**
   * Camera inputs: one persistent VDO.Ninja browser source per talent seat (1-6), shared across all scenes.
   * Created once, never duplicated — OBS reuses the same input (same WebRTC session) in every scene.
   */
  async function syncCameraInputs(snap: Snapshot, call: ObsCall, mode: 'build' | 'repair', exec: boolean, b: string): Promise<SyncResult> {
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [];
    // Each seat's camera input is CREATED directly in its own desk's A scene (OBS's CreateInput forces a
    // sceneName and adds a scene item there as a side effect — there is no "create with no scene" request).
    // A shared fallback scene is used only if that seat's own desk isn't built yet; removing the lone scene-item
    // reference afterwards is not an option, since OBS releases an input nothing references any more (as real
    // OBS does — the mock's gc() mirrors this), so routing each seat to the RIGHT scene up front is the fix,
    // not a cleanup pass after the fact.
    const fallbackKey = DESK_SCENES.find(k => snap.scenes.has(mainScene(snap, k))) ?? 'starting';
    const home = mainScene(snap, fallbackKey); // only used for the report's `scene` field and as a last resort
    const res: SyncResult = { ops, issues, lines, unmanaged: [], scene: home, input: '', url: '', onAir: false, created: false, inputMissing: false, sceneMissing: !snap.scenes.has(home) };
    if (res.sceneMissing) return { ...res, issues: ['No desk scene built yet — run Build first.'] };
    const onAir = (s: string) => s === snap.program;
    const op = (scene: string, kind: OpKind, detail: string) => { const o: PlanOp = { target: 'support:cameras', kind, scene, detail, existing: snap.scenes.has(scene), onAir: snap.scenes.has(scene) && onAir(scene) }; ops.push(o); return o; };
    const act = async (o: PlanOp, fn: () => Promise<void>, sim?: () => void) => { if (exec) { await fn(); lines.push(o.detail); } else sim?.(); };

    // All 6 seats' camera inputs (desks share from this pool)
    const allSeats = [...new Set(Object.values(DESK_SEATS).flat())].sort();
    for (const seat of allSeats) {
      const name = cameraInputName(seat);
      const ownDesk = DESK_SCENES.find(k => (DESK_SEATS[k] ?? []).includes(seat) && snap.scenes.has(mainScene(snap, k)));
      const target = ownDesk ? mainScene(snap, ownDesk) : home;
      if (snap.inputs.has(name)) {
        // Already exists — check ownership
        const inp = snap.inputs.get(name)!;
        if (inp.kind !== 'browser_source') { issues.push(`"${name}" exists but is not a browser source — left untouched`); continue; }
        const s = await snap.settingsOf(name);
        const mark = s.overdrive_id === `cam:${seat}`;
        // Repair if needed
        if (!mark && mode === 'repair') {
          await act(op(target, 'set-settings', `Mark "${name}" as Overdrive-managed`), async () => {
            await call('SetInputSettings', { inputName: name, inputSettings: { overdrive_id: `cam:${seat}` }, overlay: true });
            snap.setSettings(name, { ...s, overdrive_id: `cam:${seat}` });
          });
        }
        continue;
      }
      // Create the camera input — it's a browser source for VDO.Ninja (URL set later by the producer). Created
      // directly in the seat's own desk (the CreateInput side effect IS the correct placement there, so syncDeskB
      // finds it already present and simply leaves it — no cross-desk scene ever gets a seat it doesn't own).
      res.inputMissing = true;
      const settings = { url: '', width: 1920, height: 1080, fps_custom: true, fps: 60, css: CSS, shutdown: false, restart_when_active: false, reroute_audio: false, overdrive_id: `cam:${seat}` };
      await act(op(target, 'cam-input', `Create camera input "${name}" (persistent VDO.Ninja feed, seat ${seat}) in "${target}"`), async () => {
        const r = await call('CreateInput', { sceneName: target, inputName: name, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: false });
        snap.inputs.set(name, { kind: 'browser_source', uuid: r?.inputUuid });
        snap.setSettings(name, settings);
        // Mute audio on the camera input (audio is handled separately by audioMix)
        try { await call('SetInputMute', { inputName: name, inputMuted: true }); } catch {}
        // Same bottom-of-stack placement syncDeskB gives every other scene's copy of this camera (below graphics).
        await call('SetSceneItemIndex', { sceneName: target, sceneItemId: r.sceneItemId, sceneItemIndex: 0 });
        snap.forget(target);
      }, () => { snap.simInput(name, 'browser_source', settings); snap.simItem(target, name, false); });
    }

    if (exec) {
      res.entry = { scene: home, sceneUuid: snap.scenes.get(home)?.uuid, input: '', url: '', at: Date.now() };
    }
    return res;
  }

  /**
   * B scenes: for each desk, create a "(B)" variant that holds the SAME camera inputs + graphics source.
   * The A scene is the main scene itself. OBS allows the same input in multiple scenes with independent
   * per-scene transforms — this is what makes Preview/Program isolation work for cameras.
   *
   * Audio: camera inputs are muted globally (audio handled by audioMix). The B scene has no audio sources
   * (never heard, even in OBS monitoring), so Preview stays silent.
   */
  async function syncDeskB(snap: Snapshot, call: ObsCall, m: MainSceneDef, mode: 'build' | 'repair', exec: boolean, allowLive: boolean): Promise<SyncResult> {
    const scene = bSceneName(m.key);
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [];
    const res: SyncResult = { ops, issues, lines, unmanaged: [], scene, input: '', url: '', onAir: false, created: false, inputMissing: false, sceneMissing: !snap.scenes.has(scene) };

    if (snap.inputs.has(scene)) return { ...res, blocked: `The scene name "${scene}" is already used by an OBS source.` };
    const exists = snap.scenes.has(scene);
    res.sceneMissing = !exists;
    const onAir = exists && scene === snap.program;
    res.onAir = onAir;

    const op = (kind: OpKind, detail: string, existing = exists) => { const o: PlanOp = { target: `cam-b:${m.key}`, kind, scene, detail, existing, onAir: existing && onAir }; ops.push(o); return o; };
    const act = async (o: PlanOp, fn: () => Promise<void>, sim?: () => void) => {
      if (!exec) { sim?.(); return; }
      if (o.onAir && !allowLive) { lines.push(`Held (scene is on air in OBS): ${o.detail}`); return; }
      await fn(); lines.push(o.detail);
    };

    // Create the B scene
    if (!exists) {
      await act(op('cam-scene', `Create B scene "${scene}" (desk camera composition Preview)`, false), async () => {
        const r = await call('CreateScene', { sceneName: scene });
        snap.scenes.set(scene, { uuid: r?.sceneUuid }); res.created = true;
      }, () => snap.simScene(scene));
    }

    let items = await snap.itemsOf(scene);
    const seats = DESK_SEATS[m.key] ?? [];

    // Add camera inputs to B scene (same input as in A, independent transforms)
    for (const seat of seats) {
      const camName = cameraInputName(seat);
      if (!snap.inputs.has(camName)) { issues.push(`Camera input "${camName}" not built yet — run Build.`); continue; }
      if (items.some(i => i.sourceName === camName)) continue;
      res.inputMissing = true;
      await act(op('add-item', `Add "${camName}" to "${scene}" (same input, independent transform)`), async () => {
        const r = await call('CreateSceneItem', { sceneName: scene, sourceName: camName, sceneItemEnabled: false });
        // Position at centre, hidden — CamEngine positions them when preparing
        await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
        snap.forget(scene); items = await snap.itemsOf(scene);
      }, () => snap.simItem(scene, camName, false));
    }

    // Add the graphics base source to B scene (same browser source as the A scene)
    const store = d.store();
    const baseTarget = targets().find(t => t.main === m.key && t.role === 'base');
    if (baseTarget) {
      const baseEntry = store.map[baseTarget.id];
      const baseInput = baseEntry ? (snap.inputByUuid(baseEntry.inputUuid) ?? baseTarget.input) : baseTarget.input;
      if (snap.inputs.has(baseInput) && !items.some(i => i.sourceName === baseInput)) {
        res.inputMissing = true;
        await act(op('add-item', `Add "${baseInput}" to "${scene}" (graphics overlay, same source as A)`), async () => {
          const r = await call('CreateSceneItem', { sceneName: scene, sourceName: baseInput, sceneItemEnabled: true });
          await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
          snap.forget(scene); items = await snap.itemsOf(scene);
        }, () => snap.simItem(scene, baseInput, true));
      }
    }

    // Also add camera inputs to the A scene (the main scene), if not already there. A seat whose own desk
    // IS this A scene was already placed here by syncCameraInputs's CreateInput — but that ran before this
    // scene's own audio sources were added (syncMain's 'finish' phase, which re-asserts index 0 for each of
    // the 7 audio items), so the camera may now sit above the audio instead of below it. Re-index it: cameras
    // stay the bottommost layer (below audio, below graphics) in every desk scene, on every build.
    const aScene = mainScene(snap, m.key);
    if (snap.scenes.has(aScene)) {
      let aItems = await snap.itemsOf(aScene);
      // All of a desk's cameras share the bottom block (indices 0..seats.length-1) — only one can literally be
      // at index 0, so membership in that block is the right test, not an exact index.
      const atBottom = (n: string) => aItems.slice(0, seats.length).some(i => i.sourceName === n);
      for (const seat of seats) {
        const camName = cameraInputName(seat);
        if (!snap.inputs.has(camName)) continue;
        const existing = aItems.find(i => i.sourceName === camName);
        if (existing) {
          if (!atBottom(camName)) {
            await act(op('order', `Move "${camName}" back to the bottom of "${aScene}" (below audio)`), async () => {
              await call('SetSceneItemIndex', { sceneName: aScene, sceneItemId: existing.sceneItemId, sceneItemIndex: 0 });
              snap.forget(aScene); aItems = await snap.itemsOf(aScene);
            }, () => {});
          }
          continue;
        }
        await act(op('add-item', `Add "${camName}" to "${aScene}" (same input, A scene)`), async () => {
          // Add cameras BELOW the graphics (index 0 = bottom of the stack)
          const r = await call('CreateSceneItem', { sceneName: aScene, sourceName: camName, sceneItemEnabled: false });
          await call('SetSceneItemIndex', { sceneName: aScene, sceneItemId: r.sceneItemId, sceneItemIndex: 0 });
          snap.forget(aScene); aItems = await snap.itemsOf(aScene);
        }, () => snap.simItem(aScene, camName, false));
      }
    }

    if (exec) {
      res.entry = { scene, sceneUuid: snap.scenes.get(scene)?.uuid, input: '', url: '', at: Date.now(), main: m.key, role: 'base' };
    }
    return res;
  }

  const statusOf = (r: SyncResult): TargetStatus => r.blocked ? 'conflict' : r.sceneMissing ? 'missing' : r.inputMissing ? 'incomplete' : r.ops.length || r.issues.length ? 'outdated' : 'ok';

  function ready(): { call: ObsCall } | string {
    const call = d.call();
    if (!d.connected() || !call) return 'OBS is not connected.';
    if (busy) return `OBS Setup is busy (${busy}).`;
    return { call };
  }

  async function loadSnap(call: ObsCall) {
    const snap = new Snapshot(call);
    await snap.load();
    canvas = snap.canvas;
    try {
      const v = await call('GetVersion');
      const avail = new Set<string>((v.availableRequests ?? []).map(String));
      version = { obs: String(v.obsVersion ?? '?'), ws: String(v.obsWebSocketVersion ?? '?'), missing: avail.size ? REQUIRED.filter(r => !avail.has(r)) : [] };
    } catch { version = undefined; }
    return snap;
  }

  const isMain = () => opts().layout === 'main';
  /** Main scenes a set of outputs needs (Safe / BRB comes with Intermission's BRB card). */
  function mainsFor(list: ObsTarget[], all: boolean): MainSceneDef[] {
    if (!isMain()) return [];
    if (all) return MAIN_SCENES.filter(m => m.base.some(b => targets().some(t => t.id === b)));
    return MAIN_SCENES.filter(m => list.some(t => t.main === m.key || (m.sharedBase && m.base.includes(t.id))));
  }

  type RunOut = { id: string; target?: ObsTarget; main?: MainSceneDef; r: SyncResult };
  /**
   * The ONE ordered pass used by scan, preview and apply (dry run = same code, no OBS writes):
   * main scenes → audio sources → outputs (bases, panels, overlays) → per-scene finish (shared base, audio items).
   */
  async function runAll(snap: Snapshot, call: ObsCall, mode: 'build' | 'repair', list: ObsTarget[], mains: MainSceneDef[], exec: boolean, allowLive: boolean, onEach?: (o: RunOut) => void, onError?: (id: string, e: any) => boolean): Promise<RunOut[]> {
    const b = base().url;
    const out: RunOut[] = [];
    const step = async (id: string, f: () => Promise<RunOut>) => {
      try { const o = await f(); out.push(o); onEach?.(o); }
      catch (e) { if (!onError || !onError(id, e)) throw e; }
    };
    for (const m of mains) await step(`main:${m.key}`, async () => ({ id: `main:${m.key}`, main: m, r: await syncMain(snap, call, m, 'scene', exec, allowLive) }));
    if (list.some(t => t.audio) || (isMain() && opts().audio && mains.length)) await step('support:audio', async () => ({ id: 'support:audio', r: await syncAudio(snap, call, mode, exec, b) }));
    // 3.4 Camera composition: persistent camera inputs (created once, shared across desk scenes)
    if (isMain() && mains.some(m => DESK_SCENES.includes(m.key))) {
      await step('support:cameras', async () => ({ id: 'support:cameras', r: await syncCameraInputs(snap, call, mode, exec, b) }));
    }
    for (const t of list) await step(t.id, async () => ({ id: t.id, target: t, r: await sync(snap, call, t, mode, exec, allowLive, targetUrl(b, t.route, d.outputKey)) }));
    for (const m of mains) await step(`main:${m.key}`, async () => ({ id: `main:${m.key}`, main: m, r: await syncMain(snap, call, m, 'finish', exec, allowLive) }));
    // 3.4 Camera composition: B scenes for desk A/B pairs (after outputs, so the graphics base input is built).
    // Deliberately NOT tagged with `main: m` — that would make apply()'s bookkeeping (which persists o.r.entry
    // under store.map[`main:${o.main.key}`] for any RunOut carrying `main`) overwrite the real A-scene mapping
    // with the B scene's entry. The cam-b id carries its own result; it doesn't need a stable-uuid store entry yet.
    if (isMain()) {
      for (const m of mains.filter(m => DESK_SCENES.includes(m.key))) {
        await step(`cam-b:${m.key}`, async () => ({ id: `cam-b:${m.key}`, r: await syncDeskB(snap, call, m, mode, exec, allowLive) }));
      }
    }
    return out;
  }

  /** Dry run over every target (repair mode) = the health of each OBS scene. */
  async function scanWith(call: ObsCall) {
    const s = await loadSnap(call);
    const sim = new Snapshot(call); await sim.load();
    // stable identifiers: a scene renamed in OBS keeps its mapping (followed by uuid)
    const store = d.store();
    let renamed = false;
    for (const e of Object.values(store.map)) { const n = s.sceneByUuid(e.sceneUuid); if (n && n !== e.scene) { e.scene = n; renamed = true; } const i = s.inputByUuid(e.inputUuid); if (i && i !== e.input) { e.input = i; renamed = true; } }
    if (renamed) d.save();
    const all = targets();
    const list = all.filter(t => !t.supersededBy || opts().legacy);
    const out: TargetReport[] = [];
    const inAll = (t: ObsTarget) => !t.supersededBy || opts().legacy;
    const runs = await runAll(sim, call, 'repair', all, mainsFor(list, true), false, false, undefined, (id, e) => { out.push({ id, name: id, kind: 'support', scene: '', input: '', url: '', status: 'error', issues: [String(e?.message ?? e)], unmanaged: [], onAir: false, inAll: true }); return true; });
    const merged = new Map<string, SyncResult>();
    for (const o of runs) {
      const prev = merged.get(o.id);
      if (prev) { prev.ops.push(...o.r.ops); prev.issues.push(...o.r.issues); prev.sceneMissing ||= o.r.sceneMissing; prev.inputMissing ||= o.r.inputMissing; }
      else merged.set(o.id, { ...o.r, ops: [...o.r.ops], issues: [...o.r.issues] });
    }
    for (const [id, r] of merged) {
      const t = all.find(x => x.id === id);
      const m = MAIN_SCENES.find(x => `main:${x.key}` === id);
      const issues = [...(r.blocked ? [r.blocked] : []), ...r.ops.map(o => o.detail), ...r.issues];
      if (id === 'support:audio') out.push({ id, name: 'Caster audio + music (shared)', kind: 'support', scene: r.scene, input: '7 audio browser sources', url: '', status: statusOf(r), issues, unmanaged: [], onAir: false, inAll: true });
      else if (id === 'support:cameras') out.push({ id, name: 'Camera inputs (persistent VDO.Ninja)', kind: 'support', scene: r.scene, input: `${Object.values(DESK_SEATS).flat().length} camera sources`, url: '', status: statusOf(r), issues, unmanaged: [], onAir: false, inAll: true });
      else if (id.startsWith('cam-b:')) { const mk = id.slice(6) as MainKey; const md = MAIN_SCENES.find(x => x.key === mk); if (md) out.push({ id, name: `${md.label} (B) · camera composition`, kind: 'support', scene: r.scene, input: '', url: '', status: statusOf(r), issues, unmanaged: [], onAir: r.onAir, inAll: true, main: mk, role: 'base' }); }
      else if (m) out.push({ id, name: `${m.label} (scene)`, kind: 'support', scene: r.scene, input: '', url: '', status: statusOf(r), issues, unmanaged: [], onAir: r.onAir, inAll: true, main: m.key, role: 'base' });
      else if (t) out.push({ id, name: t.name, kind: t.kind, scene: r.scene, input: r.input, url: r.url, status: statusOf(r), issues, unmanaged: r.unmanaged, onAir: r.onAir, supersededBy: t.supersededBy, inAll: inAll(t), ...(t.main ? { main: t.main, role: t.role } : {}) });
    }
    reports = out;
    scannedAt = Date.now();
    // a controller page inside a broadcast source would put the control UI on air: report it (never auto-removed)
    leaks = [];
    const pictures: { name: string; route: string; st: any }[] = [];
    for (const [name, inp] of s.inputs) {
      if (inp.kind !== 'browser_source') continue;
      try {
        const st = await s.settingsOf(name); const r = typeof st.url === 'string' ? routeOf(st.url) : null;
        if (isControllerRoute(r)) leaks.push({ input: name, url: String(st.url) });
        else if (nativeSizeOf(r, opts().profile)) pictures.push({ name, route: r!, st });
      } catch {}
    }
    // picture quality (read-only): OBS canvas/output, and every Overdrive picture source wherever it is used
    quality = canvasQuality(s.canvas, opts().profile);
    if (pictures.length) {
      const uses = new Map<string, { scene: string; transform: any }[]>();
      for (const scene of s.scenes.keys()) {
        try { for (const it of await s.itemsOf(scene)) if (pictures.some(p => p.name === it.sourceName)) { const l = uses.get(it.sourceName) ?? []; l.push({ scene, transform: it.sceneItemTransform }); uses.set(it.sourceName, l); } } catch {}
      }
      for (const p of pictures) quality.push(...sourceQuality(p.name, p.route, p.st, uses.get(p.name) ?? [], opts().profile));
    }
    // orphans: mapped outputs that no longer exist (never deleted from OBS)
    for (const [k, e] of Object.entries(d.store().map)) if (k !== 'support:audio' && !k.startsWith('main:') && !all.some(t => t.id === k)) reports.push({ id: k, name: `${k} (removed from Overdrive)`, kind: k.startsWith('g:') ? 'gfx' : 'source', scene: e.scene, input: e.input, url: e.url, status: 'unknown', issues: ['This output no longer exists in Overdrive. Its OBS scene is kept: delete it in OBS if you no longer need it.'], unmanaged: [], onAir: e.scene === s.program, inAll: false });
    await layersFrom(s);
    return reports;
  }

  function pick(ids: string[] | 'all'): ObsTarget[] {
    const all = targets();
    if (ids === 'all') return all.filter(t => !t.supersededBy || opts().legacy);
    return all.filter(t => ids.includes(t.id));
  }

  async function computePlan(call: ObsCall, mode: 'build' | 'repair', ids: string[] | 'all', snap: Snapshot): Promise<ObsPlan> {
    const list = pick(ids);
    const ops: PlanOp[] = [], blocked: ObsPlan['blocked'] = [];
    for (const o of await runAll(snap, call, mode, list, mainsFor(list, ids === 'all'), false, false)) {
      if (o.r.blocked) { if (!blocked.some(x => x.target === o.id)) blocked.push({ target: o.id, reason: o.r.blocked }); }
      else ops.push(...o.r.ops);
    }
    const ids2 = list.map(t => t.id);
    const hash = crypto.createHash('sha1').update(JSON.stringify({ mode, ids2, ops, blocked, b: base().url, layout: opts().layout })).digest('hex').slice(0, 16);
    return { hash, mode, targets: ids2, ops, blocked, at: Date.now() };
  }

  async function guarded<T>(label: string, fn: (call: ObsCall) => Promise<T>): Promise<T | string> {
    const r = ready();
    if (typeof r === 'string') return r;
    busy = label; d.onChange();
    try { return await fn(r.call); }
    catch (e: any) { return `OBS: ${e?.message ?? e}`; }
    finally { busy = null; d.onChange(); }
  }

  // ------------------------------------------------------------------ layers (main layout): what OBS shows, and switching
  let mains: MainSceneReport[] = [];
  async function layersFrom(s: Snapshot) {
    const out: MainSceneReport[] = [];
    if (isMain()) {
      const map = d.store().map;
      for (const m of MAIN_SCENES) {
        const scene = mainScene(s, m.key);
        const exists = s.scenes.has(scene);
        const items = exists ? await s.itemsOf(scene).catch(() => [] as Item[]) : [];
        const layers = Object.entries(map).filter(([k, e]) => !k.startsWith('main:') && e.main === m.key && (e.role === 'base' || e.role === 'panel' || e.role === 'overlay')).map(([k, e]) => {
          const it = items.find(i => i.sourceName === e.input);
          return { target: k, name: targets().find(t => t.id === k)?.name ?? k, input: e.input, role: e.role as 'base' | 'panel' | 'overlay', itemId: it?.sceneItemId, on: !!it?.sceneItemEnabled };
        });
        if (m.sharedBase) { const e = map[`main:${m.key}`]; const it = items.find(i => i.sourceName === e?.input); if (e?.input) layers.unshift({ target: `main:${m.key}`, name: m.label, input: e.input, role: 'base', itemId: it?.sceneItemId, on: !!it?.sceneItemEnabled }); }
        const rank = { base: 0, panel: 1, overlay: 2 } as const;
        layers.sort((a, b) => rank[a.role] - rank[b.role]);
        out.push({ key: m.key, label: m.label, scene, exists, onAir: exists && s.program === scene, preview: exists && s.preview === scene, layers });
      }
    }
    mains = out;
  }
  async function refreshLayers(call: ObsCall) { const s = new Snapshot(call); await s.load(); await layersFrom(s); d.onChange(); }

  /**
   * Main layout: show the layer of `target` in its main scene (and hide the base / panels it replaces; overlays are
   * independent). Returns the scene, or null when the target is not a layer (then the caller switches scenes as before).
   * Off-air preparation is the caller's choice: it only calls this for a scene that is not on Program unless TAKE.
   */
  async function showLayer(call: ObsCall, target: string, on = true): Promise<{ scene: string; changed: number } | null> {
    const map = d.store().map;
    const e = map[target];
    if (!e?.main) return null;
    const scene = e.scene;
    const items = ((await call('GetSceneItemList', { sceneName: scene })).sceneItems ?? []) as Item[];
    const layers = Object.entries(map).filter(([k, x]) => !k.startsWith('main:') && x.main === e.main && (x.role === 'base' || x.role === 'panel' || x.role === 'overlay')).map(([k, x]) => ({ target: k, role: x.role!, input: x.input }));
    const idOf = (input: string) => items.find(i => i.sourceName === input);
    let changed = 0;
    const set = async (input: string, en: boolean) => { const it = idOf(input); if (it && it.sceneItemEnabled !== en) { await call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: it.sceneItemId, sceneItemEnabled: en }); changed++; } };
    if (target.startsWith('main:')) {
      // the scene itself: its base on, panels off (overlays as they are)
      await set(e.input, true);
      for (const l of layers) if (l.role !== 'overlay' && l.input !== e.input) await set(l.input, false);
    } else if (!on) await set(e.input, false);
    else {
      const sw = layerSwitch(target, layers);
      for (const t of sw.off) await set(layers.find(l => l.target === t)!.input, false);
      await set(e.input, true);
    }
    return { scene, changed };
  }

  // ------------------------------------------------------------------ 3.6 real-OBS duplicate-source audit (read-only)
  let audit: ObsSetupState['audit'] = null;
  async function auditDuplicates(call: ObsCall): Promise<ObsSetupState['audit']> {
    const snap = await loadSnap(call);
    const known = knownInputs(snap);
    const byRoute = new Map<string, string[]>();
    const foreign: string[] = [];
    let checked = 0;
    for (const [name, inp] of snap.inputs) {
      if (inp.kind !== 'browser_source') continue;
      checked++;
      const st = await snap.settingsOf(name).catch(() => ({} as any));
      const url = typeof st.url === 'string' ? st.url : '';
      const route = (url ? routeOf(url) : null) ?? (typeof st.overdrive_id === 'string' ? `id:${st.overdrive_id}` : null);
      if (route) { const l = byRoute.get(route) ?? []; l.push(name); byRoute.set(route, l); }
      if (/^Overdrive/.test(name) && !known.has(name) && !route) foreign.push(name);
    }
    const duplicates = [...byRoute].filter(([, names]) => names.length > 1).map(([route, inputs]) => ({ route, inputs }));
    return { at: Date.now(), checked, duplicates, foreignManagedLooking: foreign };
  }

  // ------------------------------------------------------------------ cleanup (dry run first, removal only when confirmed)
  let cleanup: CleanupReport | null = null;
  async function cleanupScan(call: ObsCall): Promise<CleanupReport> {
    const s = await loadSnap(call);
    const mainNames = new Map<string, MainKey>(MAIN_SCENES.map(m => [mainScene(s, m.key), m.key] as [string, MainKey]).filter(([n]) => s.scenes.has(n)));
    const known = knownInputs(s);
    const inMain = new Map<string, string>(); // input → main scene that holds it
    for (const n of mainNames.keys()) for (const it of await s.itemsOf(n)) if (!inMain.has(it.sourceName)) inMain.set(it.sourceName, n);
    const nestedAudio: string[] = [];
    for (const n of mainNames.keys()) if ((await s.itemsOf(n)).some(i => i.sourceName === AUDIO_SCENE)) nestedAudio.push(n);
    // 3.3: sources RETIRED by a unified scene (the old per-view MVP sources): drawn by the scene's one source now
    const retired = new Map<string, string>(); // input → main scene that draws it now
    const stateT = targets().filter(t => t.role === 'state');
    if (stateT.length) for (const [nm, inp] of s.inputs) {
      if (inp.kind !== 'browser_source') continue;
      const st = await s.settingsOf(nm).catch(() => ({} as any));
      const r = typeof st.url === 'string' ? routeOf(st.url) : null;
      const t = stateT.find(x => st.overdrive_id === x.id || r === x.route || nm === x.input);
      if (t) retired.set(nm, mainScene(s, t.main!));
    }
    // the internal Preview identity scenes are Overdrive's own (never offered for removal)
    const pvwNames = new Set(targets().filter(t => t.role === 'pvw').map(t => s.sceneByUuid(d.store().map[t.id]?.sceneUuid) ?? t.scene).filter(n => s.scenes.has(n)));
    // 3.4: a desk's "(B)" camera-composition scene is Overdrive's own infrastructure (never offered for removal).
    // It is NOT in mainNames (no main:<key> entry — see runAll()'s comment on why cam-b never writes one), and
    // every item it holds is ALSO in its A scene (same inputs, independent transforms), so without this guard the
    // generic classifier below would read "everything in it is already in a main scene" and mark it consolidatable.
    const bNames = new Set(DESK_SCENES.map(k => bSceneName(k)).filter(n => s.scenes.has(n)));
    // 3.6: the audio-group scenes are Overdrive's own infrastructure too (never offered for removal). Under the
    // main layout, a reused legacy AUDIO_SCENE counts as one of these (it already IS this install's "Audio (All)").
    const audioGroupNames = new Set<string>([AUDIO_ALL_SCENE, AUDIO_MUSIC_SCENE].filter(n => s.scenes.has(n)));
    // retired sources still sitting in a main scene: removable items (the scene's one source draws them)
    const redundant: CleanupReport['redundant'] = [];
    for (const n of mainNames.keys()) for (const it of await s.itemsOf(n)) if (retired.has(it.sourceName)) redundant.push({ scene: n, input: it.sourceName, itemId: it.sceneItemId, reason: `Retired: "${n}" draws this view with its one dynamic source.` });
    // 3.6: main scenes still carrying the OLD flat audio items directly instead of the one nested audio-group scene.
    const flatAudio: CleanupReport['flatAudio'] = [];
    if (isMain()) for (const [n, key] of mainNames) {
      const m = mainDef(key)!;
      const it = await s.itemsOf(n);
      if (SUPPORT.some(a => (m.audio === 'all' || a.route === '/output/music') && it.some(i => i.sourceName === a.name))) flatAudio.push({ scene: n, kind: m.audio });
    }
    const mapScenes = new Set(Object.entries(d.store().map).filter(([k]) => !k.startsWith('main:')).map(([, e]) => s.sceneByUuid(e.sceneUuid) ?? e.scene));
    const scenes: CleanupScene[] = [];
    for (const name of s.scenes.keys()) {
      const onAir = name === s.program || (!!s.preview && name === s.preview);
      if (mainNames.has(name)) { scenes.push({ scene: name, cls: 'main', reasons: ['One of the nine main scenes: managed by Overdrive.'], moved: [], unmanaged: [], refs: [], onAir }); continue; }
      if (pvwNames.has(name)) { scenes.push({ scene: name, cls: 'main', reasons: ['Internal Preview identity of a unified scene (Studio Mode Preview): managed by Overdrive.'], moved: [], unmanaged: [], refs: [], onAir }); continue; }
      if (bNames.has(name)) { scenes.push({ scene: name, cls: 'main', reasons: ["Camera composition (B) companion of the desk's main scene: managed by Overdrive."], moved: [], unmanaged: [], refs: [], onAir }); continue; }
      if (audioGroupNames.has(name)) { scenes.push({ scene: name, cls: 'main', reasons: ['Shared talent-audio composition, nested once into every main scene: managed by Overdrive.'], moved: [], unmanaged: [], refs: [], onAir }); continue; }
      const items = await s.itemsOf(name);
      const ours = items.filter(i => known.has(i.sourceName) || i.sourceName === AUDIO_SCENE);
      const unmanaged = items.filter(i => !ours.includes(i)).map(i => i.sourceName);
      const isAudio = name === AUDIO_SCENE;
      const managed = isAudio || mapScenes.has(name) || ours.length > 0;
      if (!managed) { scenes.push({ scene: name, cls: 'not-overdrive', reasons: ['Not an Overdrive scene: never touched.'], moved: [], unmanaged, refs: [], onAir }); continue; }
      const reasons: string[] = [];
      const moved: CleanupScene['moved'] = [];
      for (const it of ours) {
        if (it.sourceName === AUDIO_SCENE) continue;
        const to = inMain.get(it.sourceName) ?? retired.get(it.sourceName);
        if (to) moved.push({ input: it.sourceName, to }); else reasons.push(`"${it.sourceName}" is not in a main scene yet: run Build first.`);
      }
      if (isAudio && nestedAudio.length) reasons.push(`Still nested in ${nestedAudio.map(n => `"${n}"`).join(', ')}: replace it with direct audio sources first.`);
      if (unmanaged.length) reasons.push(`Contains ${unmanaged.length} source${unmanaged.length === 1 ? '' : 's'} Overdrive does not manage (${unmanaged.slice(0, 4).join(', ')}${unmanaged.length > 4 ? '…' : ''}): kept so nothing of yours is lost.`);
      if (onAir) reasons.push(name === s.program ? 'It is on Program in OBS right now.' : 'It is in OBS Preview right now.');
      const nestedIn: string[] = [];
      for (const n of s.scenes.keys()) if (n !== name && (await s.itemsOf(n)).some(i => i.sourceName === name)) nestedIn.push(n);
      if (nestedIn.length && !isAudio) reasons.push(`Used inside ${nestedIn.map(n => `"${n}"`).join(', ')}.`);
      const refs = d.refsTo?.(name) ?? [];
      const cls: CleanupClass = reasons.length ? 'keep' : 'consolidate';
      if (cls === 'consolidate') reasons.push(isAudio ? 'Its audio sources are in every main scene directly: this extra scene is no longer needed.' : `Everything in it is now inside ${[...new Set(moved.map(m => `"${m.to}"`))].join(', ') || 'the main scenes'}.`);
      scenes.push({ scene: name, cls, reasons, moved, unmanaged, refs, onAir });
    }
    // the old audio scene goes only together with every scene that still nests it (else those would lose their audio)
    const au = scenes.find(x => x.scene === AUDIO_SCENE);
    if (au?.cls === 'consolidate') {
      const holders: string[] = [];
      for (const n of s.scenes.keys()) if (n !== AUDIO_SCENE && (await s.itemsOf(n)).some(i => i.sourceName === AUDIO_SCENE) && scenes.find(x => x.scene === n)?.cls !== 'consolidate') holders.push(n);
      if (holders.length) { au.cls = 'keep'; au.reasons = [`Still used by ${holders.map(n => `"${n}"`).join(', ')}, which ${holders.length === 1 ? 'is' : 'are'} kept.`]; }
      else au.reasons.push('Remove it together with (or after) the old scenes that nest it.');
    }
    const order = { main: 0, consolidate: 1, keep: 2, 'not-overdrive': 3 } as const;
    scenes.sort((a, b) => order[a.cls] - order[b.cls]);
    const hash = crypto.createHash('sha1').update(JSON.stringify({ scenes: scenes.map(x => [x.scene, x.cls, x.moved, x.unmanaged]), nestedAudio, redundant, flatAudio })).digest('hex').slice(0, 16);
    cleanup = { hash, at: Date.now(), scenes, nestedAudio, redundant, flatAudio };
    return cleanup;
  }

  // ------------------------------------------------------------------ 3.7 pre-event validation checklist
  // Every item Overdrive itself can compute right now ('auto') is computed fresh from the same scan/quality/audit
  // data the rest of this page already shows — never a guess, never carried over from an earlier mock test run.
  // Every item that genuinely needs a human looking at real OBS picture/sound ('needsManual') stays unconfirmed
  // until the operator ticks it, here, after actually checking — Overdrive never ticks these on its own.
  const VALIDATION_DEFS: { id: string; category: string; label: string; detail: string; steps: string[] }[] = [
    { id: 'scenes-layout', category: 'Scene layouts', label: 'All nine main scenes and their source layouts', detail: 'Every main scene exists, with the layers it should have, in the right stacking order.',
      steps: ['Open OBS and click through all nine main scenes (Show Screens, Analyst Desk, Caster Desk, Team Introduction, Player MVP, Map Veto, Gameplay, Bracket, Matches).', 'For each, confirm nothing is missing, nothing unexpected is visible, and overlays sit above cameras/backgrounds, not below.'] },
    { id: 'camera-alignment', category: 'Camera alignment', label: 'Cameras line up with Overdrive’s graphics frames', detail: 'Each talent camera sits precisely behind its Overdrive camera-frame graphic (position, crop, scale) with no gap or overlap.',
      steps: ['Bring each desk scene (Analyst Desk, Caster Desk, Team Introduction) to Preview.', 'Confirm every camera fills its frame exactly, with no sliver of background or double border.'] },
    { id: 'mic-controls', category: 'Independent microphone controls', label: 'Each talent’s mute/volume/monitoring is independent', detail: 'Muting, changing volume, or changing the monitoring mode on one talent’s mic must not affect any other talent’s mic.',
      steps: ['In the OBS Audio Mixer, mute one talent and confirm the others keep passing audio.', 'Change that talent’s volume and monitoring mode, then confirm the others are unchanged.', 'Repeat for at least one other talent.'] },
    { id: 'audio-continuity', category: 'Audio continuity during scene changes', label: 'No dropout when switching Program between main scenes', detail: 'Talent audio should keep playing without a gap, click or restart as Program moves between scenes that nest the shared audio composition.',
      steps: ['With talent speaking (or a tone playing), switch Program across several main scenes in sequence.', 'Listen for any drop, restart or glitch exactly at the cut.', 'Pay particular attention to any scene using "Overdrive · Audio (Music only)": confirm the shared "Overdrive Music" input keeps playing in sync when you cut into and out of it.'] },
    { id: 'no-duplicate-audio', category: 'No duplicate audio during transitions', label: 'Never two copies of the same mic or music during a transition', detail: 'A stinger/transition must not briefly play both the outgoing and incoming scene’s copy of the same talent or music audio.',
      steps: ['Trigger a transition between two main scenes that both nest "Overdrive · Audio (All)" (same shared composition, referenced twice).', 'Listen closely during the transition itself for a doubled, phased or louder moment on any mic or on the music.', 'This is the case the shared composition design is meant to prevent structurally (each input mixes once no matter how many scenes reference it) — confirm it holds on your hardware.'] },
    { id: 'preview-program', category: 'Preview/Program isolation', label: 'Preview never leaks onto the broadcast', detail: 'Changing Preview, or building/repairing a scene, must never affect what Program is currently showing or sending.',
      steps: ['Put a scene on Preview that is different from Program.', 'Run Scan, and if comfortable, Repair on a non-Program target, while watching the stream/recording output.', 'Confirm Program never changes and no stinger/transition fires on its own.'] },
    { id: 'native-4k', category: 'Correct native 4K source dimensions', label: 'Browser sources are sized to match, not scaled by OBS', detail: 'Every Overdrive picture source should be created at its native resolution for the active profile, so OBS draws it 1:1 instead of resampling.',
      steps: ['Spot-check one scaled frame on screen — text and logos should look crisp, not soft.', 'If the automated check at right flags issues, open each one’s Properties and confirm width/height after Repair.'] },
    { id: 'repair-rollback', category: 'Scene Builder Repair and rollback', label: 'Repair fixes real drift; cleanup rollback is safe', detail: 'Repair should detect and fix a scene you deliberately mess up in OBS; a cleanup dry-run should preview changes with nothing applied until you type the confirmation.',
      steps: ['In OBS, manually drag a layer below its scene’s base, or resize/move a source.', 'Run Scan (should flag it), then Repair, then Scan again (should be clean).', 'Open the Cleanup report, confirm it previews only — nothing is removed until you check boxes and type the confirmation word.'] },
  ];

  /**
   * A fingerprint of everything a validation confirmation should be invalidated by: the OBS scene collection as
   * Overdrive has mapped it (source mapping), the audio-routing / layout options, and the discovered target set
   * (what Overdrive thinks should exist and where). Any change here means a prior "I checked this on real OBS"
   * confirmation is no longer about the setup the operator is now looking at.
   */
  function configHash(): string {
    const map = Object.entries(d.store().map).sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => [k, e.scene, e.input, e.main ?? '', e.role ?? '']);
    const o = opts();
    const t = targets().map(x => [x.id, x.scene, x.main ?? '', x.role ?? '', x.audio]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return crypto.createHash('sha1').update(JSON.stringify({ map, layout: o.layout, audio: o.audio, profile: o.profile, gameCapture: o.gameCapture, t })).digest('hex').slice(0, 16);
  }

  function validationReport(): ValidationReport {
    const autoOf = (id: string): { status: ValidationAutoStatus; note: string } => {
      switch (id) {
        case 'scenes-layout': {
          if (!mains.length) return { status: 'n/a', note: 'Run Scan first to check the nine main scenes.' };
          const missing = mains.filter(m => !m.exists).map(m => m.label);
          return missing.length ? { status: 'issue', note: `Missing in OBS: ${missing.join(', ')}.` } : { status: 'ok', note: 'All nine main scenes exist in OBS.' };
        }
        case 'native-4k': {
          const sizing = quality.filter(q => /resizes it again|resamples every pixel/.test(q.issue));
          if (!quality.length && !mains.length) return { status: 'n/a', note: 'Run Scan first to check source sizing.' };
          return sizing.length ? { status: 'issue', note: `${sizing.length} sizing issue${sizing.length === 1 ? '' : 's'} found — see Picture quality.` } : { status: 'ok', note: 'No source-sizing issues found.' };
        }
        case 'no-duplicate-audio': {
          if (!audit && !cleanup) return { status: 'n/a', note: 'Run "Audit OBS…" or the Cleanup report first.' };
          const dupes = audit?.duplicates.length ?? 0;
          const flat = cleanup?.flatAudio.length ?? 0;
          if (dupes) return { status: 'issue', note: `${dupes} duplicate source group${dupes === 1 ? '' : 's'} found by the real-OBS audit.` };
          if (flat) return { status: 'issue', note: `${flat} scene${flat === 1 ? '' : 's'} still use the old flat audio items (migrate via Cleanup).` };
          return { status: 'ok', note: 'No duplicate sources found; no scenes left on the old flat audio layout.' };
        }
        case 'repair-rollback': {
          return { status: 'ok', note: 'Structural guarantee: Apply always re-checks the plan hash against live OBS and refuses if OBS changed; Cleanup never removes anything without the typed confirmation.' };
        }
        case 'preview-program':
          return { status: 'ok', note: 'Structural guarantee: the builder never sends SetCurrentProgramScene, SetCurrentPreviewScene or a transition trigger (enforced by the FORBIDDEN request list).' };
        default:
          return { status: 'n/a', note: 'No automated check for this — real OBS/audio only.' };
      }
    };
    const store = d.store().validation;
    const cfg = configHash();
    const items: ValidationItem[] = VALIDATION_DEFS.map(def => {
      const a = autoOf(def.id);
      const cur = store.items[def.id];
      // "Last performed, ever" — even a stale or earlier-session confirmation still answers "when did I last check this",
      // which is why it is shown separately from `confirmed` (this session, current configuration).
      const lastEver = Math.max(cur?.at ?? 0, ...store.history.filter(h => h.id === def.id && h.checked).map(h => h.at));
      const confirmed = cur?.checked === true && cur.configHash === cfg;
      const needsRevalidation = cur?.checked === true && cur.configHash !== cfg;
      return {
        id: def.id, category: def.category, label: def.label, detail: def.detail, steps: def.steps,
        autoStatus: a.status, autoNote: a.note, needsManual: true, confirmed, needsRevalidation,
        ...(lastEver > 0 ? { confirmedAt: lastEver } : {}),
      };
    });
    return { at: Date.now(), items, autoIssues: items.filter(i => i.autoStatus === 'issue').length, manualTotal: items.length, manualConfirmed: items.filter(i => i.confirmed).length, session: store.session, sessionAt: store.sessionAt };
  }

  return {
    state(): ObsSetupState {
      const b = base();
      return { options: opts(), baseUrl: b.url, baseReason: b.reason, version, canvas, targets: reports, plan, busy, scannedAt, lastRun, results: d.store().results, map: d.store().map, controllerLeaks: leaks, quality, mains, cleanup, audit, validation: validationReport() };
    },
    /** Read-only, whole-collection duplicate-source audit against the real OBS connection — no terminal needed. */
    async audit(): Promise<ObsSetupState['audit'] | string> { return guarded('audit', async c => { audit = await auditDuplicates(c); return audit; }); },
    targets,
    async scan(): Promise<string | null> {
      const r = await guarded('scan', c => scanWith(c));
      return typeof r === 'string' ? r : null;
    },
    /** Dry run: the plan for some targets (shown before anything changes). */
    async preview(mode: 'build' | 'repair', ids: string[] | 'all'): Promise<ObsPlan | string> {
      if (ids !== 'all' && !ids.length) return 'Choose a scene first.';
      return guarded('preview', async c => { const snap = await loadSnap(c); plan = await computePlan(c, mode, ids, snap); await scanWith(c); return plan; });
    },
    /** Apply the previewed plan. Refused when OBS changed since the preview (a fresh preview is stored). */
    async apply(hash: string, allowLive: boolean): Promise<{ ok: boolean; summary: string; perTarget: Record<string, { ok: boolean; lines: string[] }> } | string> {
      if (!plan || plan.hash !== hash) return 'This preview is out of date: preview again.';
      const want = plan;
      return guarded('apply', async call => {
        const snap = await loadSnap(call);
        const again = await computePlan(call, want.mode, want.targets, snap);
        if (again.hash !== want.hash) { plan = again; return 'OBS changed since the preview. The preview has been updated: check it and confirm again.'; }
        const fresh = new Snapshot(call); await fresh.load();
        const list = pick(want.targets);
        const allIds = pick('all').map(t => t.id);
        const isAll = allIds.length === want.targets.length && allIds.every(i => want.targets.includes(i));
        const perTarget: Record<string, { ok: boolean; lines: string[] }> = {};
        const built: { target: ObsTarget; scene: string; was?: string }[] = [];
        const store = d.store();
        let stopped = '';
        const blockedIds = new Set(want.blocked.map(x => x.target));
        const listOk = list.filter(t => !blockedIds.has(t.id));
        for (const t of list) if (blockedIds.has(t.id)) perTarget[t.id] = { ok: false, lines: [want.blocked.find(x => x.target === t.id)!.reason] };
        const mainsOk = mainsFor(list, isAll).filter(m => !blockedIds.has(`main:${m.key}`));
        for (const m of mainsFor(list, isAll)) if (blockedIds.has(`main:${m.key}`)) perTarget[`main:${m.key}`] = { ok: false, lines: [want.blocked.find(x => x.target === `main:${m.key}`)!.reason] };
        const add = (id: string, ok: boolean, lines: string[]) => { const p = perTarget[id] ?? (perTarget[id] = { ok: true, lines: [] }); p.ok = p.ok && ok; p.lines.push(...lines); };
        await runAll(fresh, call, want.mode, listOk, mainsOk, true, allowLive, o => {
          add(o.id, true, o.r.lines);
          if (o.target && o.r.entry) { built.push({ target: o.target, scene: o.r.entry.scene, was: store.map[o.target.id]?.scene }); store.map[o.target.id] = o.r.entry; }
          if (o.main && o.r.entry) store.map[`main:${o.main.key}`] = o.r.entry;
          else if (o.main && !store.map[`main:${o.main.key}`] && fresh.scenes.get(o.r.scene)?.uuid) store.map[`main:${o.main.key}`] = { scene: o.r.scene, sceneUuid: fresh.scenes.get(o.r.scene)?.uuid, input: '', url: '', at: Date.now(), main: o.main.key, role: 'base' };
          if (o.id === 'support:audio' && !isMain()) store.map['support:audio'] = { scene: AUDIO_SCENE, sceneUuid: fresh.scenes.get(AUDIO_SCENE)?.uuid, input: '', url: '', at: Date.now() };
        }, (id, e) => {
          if (stopped) { add(id, false, [`Not attempted: ${stopped}`]); return true; }
          add(id, false, [`Failed: ${e?.message ?? e}`]);
          if (!d.connected()) stopped = 'OBS disconnected during the build.';
          return true;
        });
        for (const [id, p] of Object.entries(perTarget)) { if (p.ok && !p.lines.length) p.lines.push('Already correct: nothing changed.'); store.results[id] = { at: Date.now(), ...p }; }
        d.applyMapping(built);
        d.save();
        plan = null;
        if (d.connected()) { try { await scanWith(call); } catch {} }
        const n = Object.values(perTarget), good = n.filter(x => x.ok).length;
        const summary = `${good}/${n.length} ${isMain() ? 'item' : 'scene'}${n.length === 1 ? '' : 's'} ${want.mode === 'build' ? 'built' : 'repaired'}${stopped ? ` · ${stopped}` : ''}`;
        lastRun = { at: Date.now(), ok: good === n.length, summary, perTarget };
        return lastRun;
      });
    },
    async verify(): Promise<{ ok: number; bad: number; leaks: number; quality: number } | string> {
      return guarded('verify', async c => { const r = await scanWith(c); const rel = r.filter(x => x.inAll); return { ok: rel.filter(x => x.status === 'ok').length, bad: rel.filter(x => x.status !== 'ok').length, leaks: leaks.length, quality: quality.length }; });
    },
    /** Main layout: show a layer (and hide what it replaces) — or a main scene's base state for 'main:<key>'. */
    async layer(target: string, on = true): Promise<{ scene: string; changed: number } | null | string> {
      const call = d.call();
      if (!d.connected() || !call) return 'OBS is not connected.';
      try { const r = await showLayer(call, target, on); if (r?.changed) await refreshLayers(call).catch(() => {}); return r; }
      catch (e: any) { return `OBS: ${e?.message ?? e}`; }
    },
    /** The mapped layer of a target (main layout), without touching OBS. */
    layerOf(target: string): { scene: string; main: MainKey; role: string; on: boolean; /** 3.3: the Preview identity's scene */ preview?: string } | null {
      const e = d.store().map[target];
      if (!e?.main) return null;
      const m = mains.find(x => x.key === e.main);
      const pv = d.store().map[`pvw:${e.main}`];
      return { scene: e.scene, main: e.main, role: e.role ?? 'base', on: e.role === 'state' || !!m?.layers.find(l => l.target === target)?.on, ...(pv?.scene ? { preview: pv.scene } : {}) };
    },
    async refreshLayers(): Promise<void> { const call = d.call(); if (d.connected() && call && isMain()) { try { await refreshLayers(call); } catch {} } },
    /** Dry-run cleanup report (removes nothing). */
    async cleanupScan(): Promise<CleanupReport | string> { return guarded('cleanup report', c => cleanupScan(c)); },
    /**
     * Remove the chosen scenes the report classed "consolidate" (and replace a nested audio scene by direct audio
     * sources in the chosen main scenes). Needs the report's hash and the typed confirmation; re-checks OBS first.
     */
    async cleanupApply(hash: string, remove: string[], unnest: string[], confirm: string, drop: string[] = [], nestAudio: string[] = []): Promise<{ removed: string[]; unnested: string[]; nested: string[]; lines: string[] } | string> {
      if (confirm !== CLEANUP_CONFIRM) return `Type ${CLEANUP_CONFIRM} to confirm: nothing was removed.`;
      if (!cleanup || cleanup.hash !== hash) return 'This cleanup report is out of date: run the report again.';
      if (!remove.length && !unnest.length && !drop.length && !nestAudio.length) return 'Nothing selected.';
      return guarded('cleanup', async call => {
        const want = cleanup!;
        const again = await cleanupScan(call);
        if (again.hash !== want.hash) return 'OBS changed since the report. The report has been updated: check it and confirm again.';
        const lines: string[] = [], removed: string[] = [], unnested: string[] = [], nested: string[] = [];
        const s = await loadSnap(call);
        // 1c) 3.6 audio migration: the old flat items (one per mic + music) → the single reusable audio-group
        // scene, nested once. The group scene and its items are never recreated — only the flat duplicates in
        // THIS main scene are removed, and only after the nested item is confirmed present.
        for (const n of nestAudio) {
          const want2 = want.flatAudio.find(x => x.scene === n);
          if (!want2) { lines.push(`Skipped "${n}": it has no old flat audio items to migrate.`); continue; }
          const groupName = want2.kind === 'music' ? AUDIO_MUSIC_SCENE : allAudioScene(s);
          if (!s.scenes.has(groupName)) { lines.push(`Skipped "${n}": "${groupName}" is not built yet (run Build first).`); continue; }
          let items = await s.itemsOf(n);
          if (!items.some(i => i.sourceName === groupName)) {
            const r = await call('CreateSceneItem', { sceneName: n, sourceName: groupName, sceneItemEnabled: true });
            await call('SetSceneItemIndex', { sceneName: n, sceneItemId: r.sceneItemId, sceneItemIndex: audioBottomIndex(items) });
            s.forget(n); items = await s.itemsOf(n);
          }
          for (const a of SUPPORT) {
            if (want2.kind === 'music' && a.route !== '/output/music') continue;
            const it = items.find(i => i.sourceName === a.name);
            if (it) await call('RemoveSceneItem', { sceneName: n, sceneItemId: it.sceneItemId });
          }
          s.forget(n);
          nested.push(n); lines.push(`"${n}": now nests "${groupName}" instead of ${want2.kind === 'music' ? 'the music item' : 'the 6 mics + music'} directly.`);
        }
        // 1) legacy nested "Caster audio" scene (3.1) → the 3.6 audio-group scene (never the old flat items —
        // those were themselves only ever an intermediate 3.2-3.5 shape, already superseded by 1c above).
        for (const n of unnest) {
          if (!want.nestedAudio.includes(n)) { lines.push(`Skipped "${n}": it does not nest "${AUDIO_SCENE}".`); continue; }
          const m = MAIN_SCENES.find(x => mainScene(s, x.key) === n);
          if (!m) continue;
          const groupName = m.audio === 'music' ? AUDIO_MUSIC_SCENE : allAudioScene(s);
          if (!s.scenes.has(groupName)) { lines.push(`Skipped "${n}": "${groupName}" is not built yet (run Build first).`); continue; }
          let items = await s.itemsOf(n);
          if (!items.some(i => i.sourceName === groupName)) {
            const r = await call('CreateSceneItem', { sceneName: n, sourceName: groupName, sceneItemEnabled: true });
            // Keep this desk's persistent camera inputs below even the freshly-added audio group (3.4).
            await call('SetSceneItemIndex', { sceneName: n, sceneItemId: r.sceneItemId, sceneItemIndex: audioBottomIndex(items) });
            s.forget(n); items = await s.itemsOf(n);
          }
          for (const it of items.filter(i => i.sourceName === AUDIO_SCENE)) await call('RemoveSceneItem', { sceneName: n, sceneItemId: it.sceneItemId });
          s.forget(n);
          unnested.push(n); lines.push(`"${n}": now nests "${groupName}"; the old "${AUDIO_SCENE}" was removed from it.`);
        }
        // 1b) retired sources in main scenes (3.3 unified scenes): remove their items ("scene\u0000input")
        for (const k of drop) {
          const [sc, inp] = k.split('\u0000');
          const r = want.redundant.find(x => x.scene === sc && x.input === inp);
          if (!r) { lines.push(`Kept "${inp}" in "${sc}": not a retired source.`); continue; }
          const it = (await s.itemsOf(sc)).find(i => i.sourceName === inp);
          if (it) { await call('RemoveSceneItem', { sceneName: sc, sceneItemId: it.sceneItemId }); s.forget(sc); lines.push(`Removed the retired "${inp}" from "${sc}".`); }
        }
        // 2) scene removal: only "consolidate", never Program / Preview; references repointed first
        if (remove.length) {
          const fresh = unnested.length || drop.length || nested.length ? await cleanupScan(call) : again;
          for (const n of remove) {
            const c = fresh.scenes.find(x => x.scene === n);
            if (!c || c.cls !== 'consolidate') { lines.push(`Kept "${n}": ${c ? c.reasons.join(' ') : 'no longer in OBS.'}`); continue; }
            if (c.onAir) { lines.push(`Kept "${n}": it is on Program or Preview.`); continue; }
            const to = c.moved[0]?.to;
            if (to && c.refs.length) { d.repoint?.(n, to); lines.push(`Repointed ${c.refs.length} reference${c.refs.length === 1 ? '' : 's'} from "${n}" to "${to}".`); }
            await call('RemoveScene', { sceneName: n });
            removed.push(n); lines.push(`Removed "${n}".`);
          }
          for (const e of Object.entries(d.store().map)) if (removed.includes(e[1].scene) && !e[0].startsWith('main:') && e[0] !== 'support:audio') delete d.store().map[e[0]];
          if (removed.includes(AUDIO_SCENE)) delete d.store().map['support:audio'];
        }
        d.save();
        await cleanupScan(call);
        try { await scanWith(call); } catch {}
        return { removed, unnested, nested, lines };
      });
    },
    setOptions(o: Partial<ObsSetupOptions>) {
      const cur = d.store().options;
      if (typeof o.audio === 'boolean') cur.audio = o.audio;
      if (typeof o.gameCapture === 'boolean') cur.gameCapture = o.gameCapture;
      if (typeof o.legacy === 'boolean') cur.legacy = o.legacy;
      if (o.profile === 'uhd' || o.profile === 'fhd') cur.profile = o.profile;
      if (typeof o.suspendOffAir === 'boolean') cur.suspendOffAir = o.suspendOffAir;
      if (typeof o.perfMonitor === 'boolean') cur.perfMonitor = o.perfMonitor;
      if (o.layout === 'main' || o.layout === 'per-output') cur.layout = o.layout;
      if (typeof o.baseUrl === 'string') {
        const v = o.baseUrl.trim().replace(/\/$/, '');
        if (v && !/^https?:\/\/[^\s/?#]+$/i.test(v)) return 'The base URL must look like http://192.168.1.20:8787 (no path).';
        cur.baseUrl = v;
      }
      plan = null;
      d.save(); d.onChange();
      return null;
    },
    clearPlan() { plan = null; },
    /**
     * 3.7: operator confirms (or un-confirms) one manual validation item against REAL OBS. Overdrive never sets
     * this itself — it only records the operator's own check, pinned to the Overdrive configuration at that
     * moment, and logs the event to history (kept even if the item is later un-confirmed, re-confirmed, made
     * stale by a config change, or the session is rotated by "Start New Pre-Event Check").
     */
    setValidation(id: string, checked: boolean): ValidationReport | string {
      if (!VALIDATION_DEFS.some(v => v.id === id)) return 'Unknown checklist item.';
      const store = d.store().validation;
      const cfg = configHash();
      const at = Date.now();
      if (checked) store.items[id] = { checked: true, at, configHash: cfg }; else delete store.items[id];
      store.history.push({ id, at, checked, session: store.session, configHash: cfg });
      if (store.history.length > MAX_VALIDATION_HISTORY) store.history.splice(0, store.history.length - MAX_VALIDATION_HISTORY);
      d.save(); d.onChange();
      return validationReport();
    },
    /**
     * 3.7: a fresh pre-event checklist. Every item starts unconfirmed again for this new session, but nothing is
     * deleted — every past confirmation stays in `history` (and still answers "when was this last checked").
     */
    newValidationSession(): ValidationReport {
      const store = d.store().validation;
      store.session = newValidationSessionId(); store.sessionAt = Date.now(); store.items = {};
      d.save(); d.onChange();
      return validationReport();
    },
  };
}
export type ObsSetup = ReturnType<typeof createObsSetup>;

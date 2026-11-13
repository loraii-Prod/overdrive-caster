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
  AUDIO_SCENE, GAME_CAPTURE, discoverTargets, routeOf, targetUrl, nativeSizeOf, sourceQuality, canvasQuality,
  type ObsMapEntry, type ObsPlan, type ObsSetupOptions, type ObsSetupState, type ObsSetupStore, type ObsTarget, type OpKind, type PlanOp, type TargetReport, type TargetStatus,
} from '../shared/obsSetup';
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
  applyMapping: (built: { target: ObsTarget; scene: string }[]) => void;
}

/** Requests the builder needs (checked against GetVersion.availableRequests). */
export const REQUIRED = ['GetSceneList', 'GetInputList', 'GetSceneItemList', 'GetInputSettings', 'CreateScene', 'CreateInput', 'SetInputSettings', 'CreateSceneItem', 'SetSceneItemTransform', 'SetSceneItemEnabled', 'SetSceneItemIndex', 'GetVideoSettings'];
/** Requests the builder must NEVER send (tests assert this). */
export const FORBIDDEN = ['SetCurrentProgramScene', 'SetCurrentPreviewScene', 'TriggerStudioModeTransition', 'RemoveScene', 'RemoveInput', 'RemoveSceneItem', 'SetCurrentSceneTransition', 'SetSceneName', 'SetInputName'];

const CAPTURE_KINDS = /^(game_capture|window_capture|monitor_capture|display_capture|screen_capture|dshow_input|av_capture_input|v4l2_input|decklink-input|ndi_source|xcomposite_input|pipewire|macos-screen|screen_capture_kit|aja_source)/;
const CSS = 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }';

interface Item { sceneItemId: number; sourceName: string; sourceUuid?: string; inputKind?: string | null; sceneItemIndex: number; sceneItemEnabled: boolean; sourceType?: string; isGroup?: boolean; sceneItemTransform?: any }

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
  async function sync(snap: Snapshot, call: ObsCall, t: ObsTarget, mode: 'build' | 'repair', exec: boolean, allowLive: boolean, url: string): Promise<SyncResult> {
    const store = d.store();
    const entry = store.map[t.id];
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [], unmanaged: string[] = [];
    const input = snap.inputByUuid(entry?.inputUuid) ?? t.input;
    let scene = snap.sceneByUuid(entry?.sceneUuid) ?? t.scene;
    // Renamed in OBS by hand and no uuids (obs-websocket < 5.5): the scene that still holds our own source is it.
    if (!snap.scenes.has(scene) && entry && snap.inputs.has(input)) {
      for (const n of snap.scenes.keys()) if (n === entry.scene || (await snap.itemsOf(n)).some(i => i.sourceName === input)) { scene = n; break; }
    }
    const res: SyncResult = { ops, issues, lines, unmanaged, scene, input, url, onAir: false, created: false, inputMissing: false, sceneMissing: false };
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
    /** Run fn now (exec) unless the op is held back because its scene is on air. */
    const act = async (o: PlanOp, fn: () => Promise<void>) => {
      if (!exec) return;
      if (o.onAir && !allowLive) { lines.push(`Held (scene is on air in OBS): ${o.detail}`); return; }
      await fn();
      lines.push(o.detail);
    };

    if (!sceneExists) {
      const o = op('create-scene', `Create scene "${scene}"`, false);
      await act(o, async () => { const r = await call('CreateScene', { sceneName: scene }); snap.scenes.set(scene, { uuid: r?.sceneUuid }); res.created = true; });
    }
    let items = await snap.itemsOf(scene);
    const mine = () => items.find(i => i.sourceName === input);

    if (!snap.inputs.has(input)) {
      res.inputMissing = true;
      const o = op('create-input', `Create browser source "${input}" (${t.width}×${t.height}) → ${url}`);
      await act(o, async () => {
        const r = await call('CreateInput', { sceneName: scene, inputName: input, inputKind: 'browser_source', inputSettings: browserSettings(t, url), sceneItemEnabled: true });
        snap.inputs.set(input, { kind: 'browser_source', uuid: r?.inputUuid });
        snap.setSettings(input, browserSettings(t, url));
        await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
        snap.forget(scene); items = await snap.itemsOf(scene);
      });
    } else {
      if (!mine()) {
        res.inputMissing = true;
        const o = op('add-item', `Add "${input}" to "${scene}" (full canvas)`);
        await act(o, async () => {
          const r = await call('CreateSceneItem', { sceneName: scene, sourceName: input, sceneItemEnabled: true });
          await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) });
          snap.forget(scene); items = await snap.itemsOf(scene);
        });
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
    // the item: full canvas, visible
    const it = mine();
    if (it && !res.inputMissing) {
      if (!fills(it.sceneItemTransform, t.width, t.height, snap.canvas.w, snap.canvas.h)) {
        if (mode === 'repair') { const o = op('transform', `Fit "${input}" to the full ${snap.canvas.w}×${snap.canvas.h} canvas`); await act(o, async () => { await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: it.sceneItemId, sceneItemTransform: FILL(snap.canvas.w, snap.canvas.h) }); }); }
        else issues.push('not fitted to the full canvas');
      }
      if (!it.sceneItemEnabled) {
        if (mode === 'repair') { const o = op('enable', `Show "${input}" (it is hidden in OBS)`); await act(o, async () => { await call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: it.sceneItemId, sceneItemEnabled: true }); }); }
        else issues.push('hidden in OBS');
      }
    }
    // composition: gameplay capture under the overlay
    if (t.gameCapture) {
      const caps = items.filter(i => i.sourceName !== input && CAPTURE_KINDS.test(String(i.inputKind ?? snap.inputs.get(i.sourceName)?.kind ?? '')));
      if (!caps.length) {
        const avail = !snap.inputKinds || snap.inputKinds.has('game_capture');
        if (!avail && !snap.inputs.has(GAME_CAPTURE)) issues.push('no game capture in the scene, and this OBS has no Game Capture source (Windows only): add your capture or video feed under the overlay');
        else {
          const o = op('add-capture', snap.inputs.has(GAME_CAPTURE) ? `Add the existing "${GAME_CAPTURE}" under the overlay (its settings are not changed)` : `Create "${GAME_CAPTURE}" (any fullscreen game) under the overlay`);
          await act(o, async () => {
            let id: number;
            if (snap.inputs.has(GAME_CAPTURE)) id = (await call('CreateSceneItem', { sceneName: scene, sourceName: GAME_CAPTURE, sceneItemEnabled: true })).sceneItemId;
            else { const r = await call('CreateInput', { sceneName: scene, inputName: GAME_CAPTURE, inputKind: 'game_capture', inputSettings: { capture_mode: 'any_fullscreen', capture_cursor: false }, sceneItemEnabled: true }); snap.inputs.set(GAME_CAPTURE, { kind: 'game_capture', uuid: r?.inputUuid }); id = r.sceneItemId; }
            await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: id, sceneItemIndex: 0 });
            snap.forget(scene); items = await snap.itemsOf(scene);
          });
        }
      } else {
        const ov = mine();
        const top = Math.max(...caps.map(c => c.sceneItemIndex));
        if (ov && ov.sceneItemIndex < top) {
          if (mode === 'repair') { const o = op('order', `Move "${input}" above the capture "${caps.find(c => c.sceneItemIndex === top)!.sourceName}"`); await act(o, async () => { await call('SetSceneItemIndex', { sceneName: scene, sceneItemId: ov.sceneItemId, sceneItemIndex: top }); snap.forget(scene); items = await snap.itemsOf(scene); }); }
          else issues.push('the overlay is below the game capture');
        }
      }
    }
    // composition: the shared caster-audio / music scene (one instance, nested, never duplicated)
    if (t.audio && !items.some(i => i.sourceName === AUDIO_SCENE)) {
      const o = op('nest-audio', `Add the shared "${AUDIO_SCENE}" scene (caster mics + music)`);
      await act(o, async () => { await call('CreateSceneItem', { sceneName: scene, sourceName: AUDIO_SCENE, sceneItemEnabled: true }); snap.forget(scene); items = await snap.itemsOf(scene); });
    }
    // report what Overdrive does not manage (kept as is)
    const others = d.store();
    for (const i of items) {
      if (i.sourceName === input || i.sourceName === AUDIO_SCENE) continue;
      if (t.gameCapture && CAPTURE_KINDS.test(String(i.inputKind ?? snap.inputs.get(i.sourceName)?.kind ?? ''))) continue;
      const foreign = Object.entries(others.map).find(([k, e]) => k !== t.id && e.input === i.sourceName);
      unmanaged.push(foreign ? `${i.sourceName} (another Overdrive output: ${foreign[0]})` : i.sourceName);
    }
    if (exec) {
      const it2 = (await snap.itemsOf(scene)).find(i => i.sourceName === input);
      res.entry = { scene, sceneUuid: snap.scenes.get(scene)?.uuid, input, inputUuid: snap.inputs.get(input)?.uuid, itemId: it2?.sceneItemId, url, at: Date.now() };
    }
    return res;
  }

  /** The shared audio scene: 6 remote-caster mic sources + music, created once. */
  const SUPPORT: { name: string; route: string }[] = [1, 2, 3, 4, 5, 6].map(n => ({ name: `Overdrive Caster ${n} audio`, route: `/output/audio/${n}` })).concat([{ name: 'Overdrive Music', route: '/output/music' }]);
  async function syncAudio(snap: Snapshot, call: ObsCall, mode: 'build' | 'repair', exec: boolean, b: string): Promise<SyncResult> {
    const ops: PlanOp[] = [], issues: string[] = [], lines: string[] = [];
    const res: SyncResult = { ops, issues, lines, unmanaged: [], scene: AUDIO_SCENE, input: '', url: '', onAir: false, created: false, inputMissing: false, sceneMissing: false };
    if (snap.inputs.has(AUDIO_SCENE)) return { ...res, blocked: `"${AUDIO_SCENE}" is the name of an OBS source, not a scene.` };
    const exists = snap.scenes.has(AUDIO_SCENE);
    res.sceneMissing = !exists;
    const onAir = AUDIO_SCENE === snap.program;
    const op = (kind: OpKind, detail: string, existing = exists) => { const o: PlanOp = { target: 'support:audio', kind, scene: AUDIO_SCENE, detail, existing, onAir: existing && onAir }; ops.push(o); return o; };
    const act = async (o: PlanOp, fn: () => Promise<void>) => { if (exec) { await fn(); lines.push(o.detail); } };
    if (!exists) await act(op('create-scene', `Create scene "${AUDIO_SCENE}"`, false), async () => { const r = await call('CreateScene', { sceneName: AUDIO_SCENE }); snap.scenes.set(AUDIO_SCENE, { uuid: r?.sceneUuid }); });
    const items = await snap.itemsOf(AUDIO_SCENE);
    for (const s of SUPPORT) {
      const url = targetUrl(b, s.route, d.outputKey);
      const settings = { url, width: 320, height: 180, reroute_audio: true, shutdown: false, restart_when_active: false, overdrive_id: `support:${s.route}` };
      if (!snap.inputs.has(s.name)) {
        res.inputMissing = true;
        await act(op('create-input', `Create audio source "${s.name}" → ${url}`), async () => { const r = await call('CreateInput', { sceneName: AUDIO_SCENE, inputName: s.name, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true }); snap.inputs.set(s.name, { kind: 'browser_source', uuid: r?.inputUuid }); snap.setSettings(s.name, settings); });
        continue;
      }
      const kind = snap.inputs.get(s.name)!.kind;
      const cur = kind === 'browser_source' ? await snap.settingsOf(s.name) : null;
      const r = cur && typeof cur.url === 'string' ? routeOf(cur.url) : null;
      const mineMark = cur?.overdrive_id === `support:${s.route}`;
      if (!cur || (!mineMark && r !== s.route)) { issues.push(`"${s.name}" exists but is not Overdrive's audio source: left untouched`); continue; }
      if (!items.some(i => i.sourceName === s.name)) { res.inputMissing = true; await act(op('add-item', `Add "${s.name}" to "${AUDIO_SCENE}"`), async () => { await call('CreateSceneItem', { sceneName: AUDIO_SCENE, sourceName: s.name, sceneItemEnabled: true }); }); }
      const drift = cur.url !== url || cur.reroute_audio !== true || !mineMark;
      if (drift) {
        if (mode === 'repair') await act(op('set-settings', `Repair "${s.name}" (URL ${url}, audio controlled by OBS)`), async () => { await call('SetInputSettings', { inputName: s.name, inputSettings: settings, overlay: true }); snap.setSettings(s.name, settings); });
        else issues.push(`"${s.name}" needs repair (URL or audio routing)`);
      }
    }
    if (exec) snap.forget(AUDIO_SCENE);
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

  /** Dry run over every target (repair mode) = the health of each OBS scene. */
  async function scanWith(call: ObsCall, snap?: Snapshot) {
    const s = snap ?? await loadSnap(call);
    const b = base().url;
    const all = targets();
    const out: TargetReport[] = [];
    const inAll = (t: ObsTarget) => !t.supersededBy || opts().legacy;
    if (all.some(t => t.audio)) {
      const r = await syncAudio(s, call, 'repair', false, b);
      out.push({ id: 'support:audio', name: 'Caster audio + music (shared)', kind: 'support', scene: AUDIO_SCENE, input: '7 audio browser sources', url: '', status: statusOf(r), issues: [...(r.blocked ? [r.blocked] : []), ...r.ops.map(o => o.detail), ...r.issues], unmanaged: [], onAir: false, inAll: true });
    }
    for (const t of all) {
      const url = targetUrl(b, t.route, d.outputKey);
      try {
        const r = await sync(s, call, t, 'repair', false, false, url);
        out.push({ id: t.id, name: t.name, kind: t.kind, scene: r.scene, input: r.input, url, status: statusOf(r), issues: [...(r.blocked ? [r.blocked] : []), ...r.ops.map(o => o.detail), ...r.issues], unmanaged: r.unmanaged, onAir: r.onAir, supersededBy: t.supersededBy, inAll: inAll(t) });
      } catch (e: any) {
        out.push({ id: t.id, name: t.name, kind: t.kind, scene: t.scene, input: t.input, url, status: 'error', issues: [String(e?.message ?? e)], unmanaged: [], onAir: false, supersededBy: t.supersededBy, inAll: inAll(t) });
      }
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
        else if (nativeSizeOf(r)) pictures.push({ name, route: r!, st });
      } catch {}
    }
    // picture quality (read-only): OBS canvas/output, and every Overdrive picture source wherever it is used
    quality = canvasQuality(s.canvas);
    if (pictures.length) {
      const uses = new Map<string, { scene: string; transform: any }[]>();
      for (const scene of s.scenes.keys()) {
        try { for (const it of await s.itemsOf(scene)) if (pictures.some(p => p.name === it.sourceName)) { const l = uses.get(it.sourceName) ?? []; l.push({ scene, transform: it.sceneItemTransform }); uses.set(it.sourceName, l); } } catch {}
      }
      for (const p of pictures) quality.push(...sourceQuality(p.name, p.route, p.st, uses.get(p.name) ?? []));
    }
    // orphans: mapped outputs that no longer exist (never deleted from OBS)
    for (const [k, e] of Object.entries(d.store().map)) if (k !== 'support:audio' && !all.some(t => t.id === k)) reports.push({ id: k, name: `${k} (removed from Overdrive)`, kind: k.startsWith('g:') ? 'gfx' : 'source', scene: e.scene, input: e.input, url: e.url, status: 'unknown', issues: ['This output no longer exists in Overdrive. Its OBS scene is kept: delete it in OBS if you no longer need it.'], unmanaged: [], onAir: e.scene === s.program, inAll: false });
    return reports;
  }

  function pick(ids: string[] | 'all'): ObsTarget[] {
    const all = targets();
    if (ids === 'all') return all.filter(t => !t.supersededBy || opts().legacy);
    return all.filter(t => ids.includes(t.id));
  }

  async function computePlan(call: ObsCall, mode: 'build' | 'repair', ids: string[] | 'all', snap: Snapshot): Promise<ObsPlan> {
    const b = base().url;
    const list = pick(ids);
    const ops: PlanOp[] = [], blocked: ObsPlan['blocked'] = [];
    if (list.some(t => t.audio)) {
      const r = await syncAudio(snap, call, mode, false, b);
      if (r.blocked) blocked.push({ target: 'support:audio', reason: r.blocked });
      ops.push(...r.ops);
    }
    for (const t of list) {
      const r = await sync(snap, call, t, mode, false, false, targetUrl(b, t.route, d.outputKey));
      if (r.blocked) blocked.push({ target: t.id, reason: r.blocked }); else ops.push(...r.ops);
    }
    const ids2 = list.map(t => t.id);
    const hash = crypto.createHash('sha1').update(JSON.stringify({ mode, ids2, ops, blocked, b })).digest('hex').slice(0, 16);
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

  return {
    state(): ObsSetupState {
      const b = base();
      return { options: opts(), baseUrl: b.url, baseReason: b.reason, version, canvas, targets: reports, plan, busy, scannedAt, lastRun, results: d.store().results, map: d.store().map, controllerLeaks: leaks, quality };
    },
    targets,
    async scan(): Promise<string | null> {
      const r = await guarded('scan', c => scanWith(c));
      return typeof r === 'string' ? r : null;
    },
    /** Dry run: the plan for some targets (shown before anything changes). */
    async preview(mode: 'build' | 'repair', ids: string[] | 'all'): Promise<ObsPlan | string> {
      if (ids !== 'all' && !ids.length) return 'Choose a scene first.';
      return guarded('preview', async c => { const snap = await loadSnap(c); plan = await computePlan(c, mode, ids, snap); await scanWith(c, snap); return plan; });
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
        const b = base().url;
        const list = pick(want.targets);
        const perTarget: Record<string, { ok: boolean; lines: string[] }> = {};
        const built: { target: ObsTarget; scene: string }[] = [];
        const store = d.store();
        let stopped = '';
        const order: ('audio' | ObsTarget)[] = [...(list.some(t => t.audio) ? ['audio' as const] : []), ...list];
        for (const t of order) {
          const id = t === 'audio' ? 'support:audio' : t.id;
          if (want.blocked.some(x => x.target === id)) { perTarget[id] = { ok: false, lines: [want.blocked.find(x => x.target === id)!.reason] }; continue; }
          if (stopped) { perTarget[id] = { ok: false, lines: [`Not attempted: ${stopped}`] }; continue; }
          const lines: string[] = [];
          try {
            const r = t === 'audio' ? await syncAudio(fresh, call, want.mode, true, b) : await sync(fresh, call, t, want.mode, true, allowLive, targetUrl(b, t.route, d.outputKey));
            lines.push(...r.lines);
            if (!r.lines.length) lines.push('Already correct: nothing changed.');
            if (r.entry && t !== 'audio') { store.map[t.id] = r.entry; built.push({ target: t, scene: r.entry.scene }); }
            if (t === 'audio') store.map['support:audio'] = { scene: AUDIO_SCENE, sceneUuid: fresh.scenes.get(AUDIO_SCENE)?.uuid, input: '', url: '', at: Date.now() };
            perTarget[id] = { ok: true, lines };
          } catch (e: any) {
            lines.push(`Failed: ${e?.message ?? e}`);
            perTarget[id] = { ok: false, lines };
            if (!d.connected()) stopped = 'OBS disconnected during the build.';
          }
          store.results[id] = { at: Date.now(), ...perTarget[id] };
        }
        d.applyMapping(built);
        d.save();
        plan = null;
        if (d.connected()) { try { await scanWith(call); } catch {} }
        const n = Object.values(perTarget), good = n.filter(x => x.ok).length;
        const summary = `${good}/${n.length} scene${n.length === 1 ? '' : 's'} ${want.mode === 'build' ? 'built' : 'repaired'}${stopped ? ` · ${stopped}` : ''}`;
        lastRun = { at: Date.now(), ok: good === n.length, summary, perTarget };
        return lastRun;
      });
    },
    async verify(): Promise<{ ok: number; bad: number; leaks: number; quality: number } | string> {
      return guarded('verify', async c => { const r = await scanWith(c); const rel = r.filter(x => x.inAll); return { ok: rel.filter(x => x.status === 'ok').length, bad: rel.filter(x => x.status !== 'ok').length, leaks: leaks.length, quality: quality.length }; });
    },
    setOptions(o: Partial<ObsSetupOptions>) {
      const cur = d.store().options;
      if (typeof o.audio === 'boolean') cur.audio = o.audio;
      if (typeof o.gameCapture === 'boolean') cur.gameCapture = o.gameCapture;
      if (typeof o.legacy === 'boolean') cur.legacy = o.legacy;
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
  };
}
export type ObsSetup = ReturnType<typeof createObsSetup>;

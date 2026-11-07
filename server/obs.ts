import { OBSWebSocket } from 'obs-websocket-js';
import { config } from './config';
import { compose, CANVAS } from '../shared/layout';
import type { ObsStatus, Scene, ThemeId } from '../shared/types';

/**
 * Optional OBS WebSocket (v5) module.
 *  - Lists scenes / switches the program scene from the controller.
 *  - For casters whose camera source type is "obs", it shows/hides the OBS
 *    camera source and moves/resizes it to the tile rect of /output/casters,
 *    so a local capture card or NDI/SRT source lines up with the browser
 *    overlay (frames + nameplates) placed above it.
 * Credentials stay server-side; the browser never sees them.
 */
export class ObsBridge {
  status: ObsStatus = { enabled: false, connected: false, scenes: [] };
  private url = '';
  private password = '';
  private obs = new OBSWebSocket();
  private base: { w: number; h: number } = { w: CANVAS.w, h: CANVAS.h };
  private itemIds = new Map<string, number>();
  private lastScene: Scene | null = null;
  private lastTheme: ThemeId = 'glacial';
  private retry: NodeJS.Timeout | null = null;

  constructor(private onChange: () => void, saved?: { url?: string; password?: string }) {
    this.obs.on('ConnectionClosed', () => {
      if (this.status.connected) console.log('[obs] disconnected');
      this.status = { ...this.status, connected: false };
      this.itemIds.clear();
      this.onChange();
      if (this.url) this.schedule();
    });
    this.obs.on('CurrentProgramSceneChanged', e => { this.status.currentScene = e.sceneName; this.onChange(); });
    this.obs.on('SceneListChanged', () => this.refreshScenes());
    this.obs.on('SceneItemCreated', () => this.itemIds.clear());
    this.obs.on('SceneItemRemoved', () => this.itemIds.clear());
    const url = config.obsUrl || saved?.url || '';
    const pw = config.obsUrl ? config.obsPassword : saved?.password ?? '';
    if (url) this.configure(url, pw);
  }

  /** (Re)connect to an OBS WebSocket. Empty URL disconnects. */
  configure(url: string, password: string) {
    this.url = url.trim();
    this.password = password;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.status = { ...this.status, enabled: !!this.url, url: this.url || undefined, hasPassword: !!password, error: undefined };
    this.onChange();
    this.obs.disconnect().catch(() => {}).finally(() => { if (this.url) this.connect(); });
  }

  private schedule() {
    if (this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 3000);
  }

  private async connect() {
    try {
      if (!this.url) return;
      await this.obs.connect(this.url, this.password || undefined);
      const v = await this.obs.call('GetVideoSettings');
      this.base = { w: v.baseWidth, h: v.baseHeight };
      this.status = { ...this.status, connected: true, error: undefined };
      console.log(`[obs] connected (${v.baseWidth}x${v.baseHeight})`);
      await this.refreshScenes();
      if (this.lastScene) await this.apply(this.lastScene, this.lastTheme);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.status = { ...this.status, connected: false, error: /auth/i.test(msg) ? 'Wrong OBS WebSocket password.' : /ECONNREFUSED|connect/i.test(msg) ? 'OBS not reachable: is OBS open with Tools → WebSocket Server Settings → Enable turned on?' : msg };
      this.onChange();
      if (this.url) this.schedule();
    }
  }

  private async refreshScenes() {
    try {
      const r = await this.obs.call('GetSceneList');
      this.status.scenes = (r.scenes as any[]).map(s => String(s.sceneName)).reverse();
      this.status.currentScene = r.currentProgramSceneName;
      this.onChange();
    } catch {}
  }

  async setScene(name: string) {
    if (!this.status.connected) return;
    try { await this.obs.call('SetCurrentProgramScene', { sceneName: name }); }
    catch (e: any) { this.status.error = e.message; this.onChange(); }
  }

  private async itemId(scene: string, source: string): Promise<number | null> {
    const k = `${scene}\u0000${source}`;
    if (this.itemIds.has(k)) return this.itemIds.get(k)!;
    try {
      const r = await this.obs.call('GetSceneItemId', { sceneName: scene, sourceName: source });
      this.itemIds.set(k, r.sceneItemId);
      return r.sceneItemId;
    } catch {
      return null;
    }
  }

  /** Mirror the live composition onto OBS camera sources. */
  async apply(scene: Scene, theme: ThemeId = 'glacial') {
    this.lastScene = scene;
    this.lastTheme = theme;
    if (!this.status.connected) return;
    const comp = compose(scene, undefined, theme);
    const sx = this.base.w / CANVAS.w, sy = this.base.h / CANVAS.h;
    const errors: string[] = [];
    for (const c of scene.casters) {
      if (c.source.type !== 'obs' || !c.source.obsScene || !c.source.obsSource) continue;
      const id = await this.itemId(c.source.obsScene, c.source.obsSource);
      if (id == null) { errors.push(`"${c.source.obsSource}" not found in "${c.source.obsScene}"`); continue; }
      const tile = comp.tiles.find(t => t.casterId === c.id && t.kind === 'obs');
      try {
        if (tile) {
          await this.obs.call('SetSceneItemTransform', {
            sceneName: c.source.obsScene,
            sceneItemId: id,
            sceneItemTransform: {
              positionX: tile.cam.x * sx,
              positionY: tile.cam.y * sy,
              alignment: 5, // top-left
              boundsType: 'OBS_BOUNDS_SCALE_OUTER',
              boundsAlignment: 0,
              boundsWidth: tile.cam.w * sx,
              boundsHeight: tile.cam.h * sy,
              cropToBounds: true,
            },
          });
        }
        await this.obs.call('SetSceneItemEnabled', { sceneName: c.source.obsScene, sceneItemId: id, sceneItemEnabled: !!tile });
      } catch (e: any) {
        errors.push(e.message);
      }
    }
    this.status.error = errors.length ? errors.join('; ') : undefined;
    this.onChange();
  }

  /**
   * Create a ready-to-go BNL scene collection inside the current OBS profile:
   * one scene per broadcast screen, all sharing one "BNL Overlay" browser source
   * (/output/program), a nested caster-audio scene, and a game capture under
   * the gameplay overlay. Safe to run again: existing scenes/sources are reused.
   * Returns the screen → OBS scene mapping.
   */
  async build(o: { base: string; key: string; screens: { id: string; label: string }[]; gameCapture: boolean; audio: boolean }): Promise<Record<string, string> | null> {
    const lines: string[] = [];
    const done = (ok: boolean) => { this.status.build = { at: Date.now(), ok, lines }; this.onChange(); };
    if (!this.status.connected) { lines.push('OBS is not connected.'); done(false); return null; }
    const q = (path: string) => `${o.base}${path}${o.key ? `?key=${encodeURIComponent(o.key)}` : ''}`;
    const OVERLAY = 'BNL Overlay', AUDIO_SCENE = 'BNL · Caster audio', GAME = 'BNL Game capture';
    const css = 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }';
    try {
      const v = await this.obs.call('GetVideoSettings');
      this.base = { w: v.baseWidth, h: v.baseHeight };
      const inputs = new Set(((await this.obs.call('GetInputList')).inputs as any[]).map(i => String(i.inputName)));
      const scenes = new Set(((await this.obs.call('GetSceneList')).scenes as any[]).map(s => String(s.sceneName)));
      const ensureScene = async (name: string) => {
        if (scenes.has(name)) return false;
        await this.obs.call('CreateScene', { sceneName: name }); scenes.add(name); return true;
      };
      const hasItem = async (scene: string, source: string) => {
        try { await this.obs.call('GetSceneItemId', { sceneName: scene, sourceName: source }); return true; } catch { return false; }
      };
      const fill = async (scene: string, source: string) => {
        const { sceneItemId } = await this.obs.call('GetSceneItemId', { sceneName: scene, sourceName: source });
        await this.obs.call('SetSceneItemTransform', { sceneName: scene, sceneItemId, sceneItemTransform: { positionX: 0, positionY: 0, alignment: 5, boundsType: 'OBS_BOUNDS_STRETCH', boundsAlignment: 0, boundsWidth: this.base.w, boundsHeight: this.base.h } });
      };
      /** Put an input in a scene: create it the first time, reuse it afterwards. */
      const place = async (scene: string, name: string, kind: string, settings: Record<string, any>) => {
        if (!inputs.has(name)) {
          await this.obs.call('CreateInput', { sceneName: scene, inputName: name, inputKind: kind, inputSettings: settings as any });
          inputs.add(name); return 'created';
        }
        if (await hasItem(scene, name)) return 'kept';
        await this.obs.call('CreateSceneItem', { sceneName: scene, sourceName: name }); return 'added';
      };

      // Caster audio (remote casters' mics, controlled in the OBS audio mixer)
      if (o.audio) {
        if (await ensureScene(AUDIO_SCENE)) lines.push(`Created scene "${AUDIO_SCENE}"`);
        for (const n of [1, 2, 3]) {
          const r = await place(AUDIO_SCENE, `BNL Caster ${n} audio`, 'browser_source', { url: q(`/output/audio/${n}`), width: 320, height: 180, reroute_audio: true, shutdown: false, restart_when_active: false });
          if (r === 'created') lines.push(`Created "BNL Caster ${n} audio" (mic of caster ${n})`);
        }
        const mr = await place(AUDIO_SCENE, 'BNL Music', 'browser_source', { url: q('/output/music'), width: 320, height: 180, reroute_audio: true, shutdown: false, restart_when_active: false });
        if (mr === 'created') lines.push('Created "BNL Music" (music beds, own fader in the audio mixer)');
      }
      const map: Record<string, string> = {};
      for (const s of o.screens) {
        const name = `BNL · ${s.label}`;
        map[s.id] = name;
        const made = await ensureScene(name);
        if (s.id === 'gameplay' && o.gameCapture) {
          try {
            const r = await place(name, GAME, 'game_capture', { capture_mode: 'any_fullscreen', capture_cursor: false });
            if (r === 'created') lines.push(`Created "${GAME}" (any fullscreen game) under the gameplay overlay`);
          } catch (e: any) { lines.push(`Game capture skipped: ${e.message}`); }
        }
        const r = await place(name, OVERLAY, 'browser_source', { url: q('/output/program'), width: 1920, height: 1080, fps_custom: true, fps: 60, css, shutdown: false, restart_when_active: false, reroute_audio: false });
        if (r !== 'kept') await fill(name, OVERLAY);
        if (r === 'created') lines.push(`Created "${OVERLAY}" → ${q('/output/program')}`);
        if (o.audio && !(await hasItem(name, AUDIO_SCENE))) await this.obs.call('CreateSceneItem', { sceneName: name, sourceName: AUDIO_SCENE });
        lines.push(`${made ? 'Created' : 'Updated'} scene "${name}"`);
      }
      // keep the overlay URL current (port / output key may have changed)
      await this.obs.call('SetInputSettings', { inputName: OVERLAY, inputSettings: { url: q('/output/program') } });
      await this.refreshScenes();
      lines.push('Scene switching is linked: GO / TAKE LIVE on a screen now also switches OBS.');
      done(true);
      return map;
    } catch (e: any) {
      lines.push(`Stopped: ${e?.message ?? e}`);
      done(false);
      return null;
    }
  }
}

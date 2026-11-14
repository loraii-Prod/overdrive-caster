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
  private lastTheme: ThemeId = 'classic';
  private retry: NodeJS.Timeout | null = null;

  constructor(private onChange: () => void, saved?: { url?: string; password?: string }, private onConnected?: () => void) {
    this.obs.on('ConnectionClosed', () => {
      if (this.status.connected) console.log('[obs] disconnected');
      this.status = { ...this.status, connected: false };
      this.itemIds.clear();
      this.onChange();
      if (this.url) this.schedule();
    });
    this.obs.on('CurrentProgramSceneChanged', e => { this.status.currentScene = e.sceneName; this.onChange(); });
    // Studio Mode awareness: OBS's own Preview is separate from Overdrive's draft.
    this.obs.on('StudioModeStateChanged', e => { this.status.studioMode = e.studioModeEnabled; if (!e.studioModeEnabled) this.status.previewScene = undefined; this.onChange(); });
    this.obs.on('CurrentPreviewSceneChanged', e => { this.status.previewScene = e.sceneName; this.onChange(); });
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
      this.onConnected?.();
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
      try { const sm = await this.obs.call('GetStudioModeEnabled'); this.status.studioMode = !!sm.studioModeEnabled; this.status.previewScene = sm.studioModeEnabled ? (r as any).currentPreviewSceneName ?? undefined : undefined; } catch {}
      this.onChange();
    } catch {}
  }

  /**
   * Switch OBS Program. With `transition`, OBS performs that transition (found by type, so it works whatever
   * the transitions are called in the user's OBS language). Returns false if OBS refused.
   */
  async setScene(name: string, transition?: 'stinger' | 'fade' | 'cut'): Promise<boolean> {
    if (!this.status.connected) return false;
    if (transition) {
      const kind = { stinger: 'obs_stinger_transition', fade: 'fade_transition', cut: 'cut_transition' }[transition];
      try {
        const r = await this.obs.call('GetSceneTransitionList');
        const t = (r.transitions as any[]).find(x => x.transitionKind === kind);
        if (t) await this.obs.call('SetCurrentSceneTransition', { transitionName: String(t.transitionName) });
        else { this.status.error = `OBS has no ${transition} transition (add one under Scene Transitions); used OBS's current transition.`; this.onChange(); }
      } catch (e: any) { this.status.error = `Could not set the OBS transition: ${e.message}`; this.onChange(); }
    }
    try { await this.obs.call('SetCurrentProgramScene', { sceneName: name }); return true; }
    catch (e: any) { this.status.error = e.message; this.onChange(); return false; }
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
  async apply(scene: Scene, theme: ThemeId = 'classic') {
    this.lastScene = scene;
    this.lastTheme = theme;
    if (!this.status.connected) return;
    const comp = compose(scene, undefined, theme);
    // Re-read the canvas: it may have been switched (e.g. 1080p → 4K in OBS → Settings → Video) while connected.
    try { const v = await this.obs.call('GetVideoSettings'); if (v.baseWidth && v.baseHeight) this.base = { w: v.baseWidth, h: v.baseHeight }; } catch { /* keep the last known size */ }
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
   * Raw OBS WebSocket v5 request over THIS connection (the scene builder uses it: one OBS connection only).
   * The old build() lives in server/obsSetup.ts now: one OBS scene per Overdrive output, dry run first.
   */
  request = (req: string, data?: Record<string, any>): Promise<any> => this.obs.call(req as any, data as any) as Promise<any>;
}

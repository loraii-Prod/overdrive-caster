/**
 * Overdrive 3.4 — OBS-Composited Desk Camera Engine.
 *
 * Controls local VDO.Ninja / capture-card camera sources in OBS via WebSocket, with:
 *  - Animated transitions (OBS Move Transition plugin, or a software fallback).
 *  - A/B scene pairs for Preview/Program isolation.
 *  - Reusable camera layout presets.
 *  - Synchronized timing with the graphics browser source.
 *
 * The engine does NOT manage audio (that stays in audioMix.ts) or the graphics browser source
 * content (that stays in the existing renderers). It only positions, sizes, crops and shows/hides
 * camera scene items in OBS.
 */
import type { DeskCamLayout, DeskCamPreset, CamEngineState } from '../shared/camPresets';
import { validateLayout, builtinPresets, autoPresetId } from '../shared/camPresets';
import type { Rect } from '../shared/skins';
import { type MainKey, cameraInputName as sharedCameraInputName, bSceneName } from '../shared/obsLayout';
import { CANVAS } from '../shared/layout';
import { DEFAULT_GFX_TRANSITION_MS } from '../shared/gfx';

// ---- Types ----

export type { CamEngineState };

export interface CamEngineObs {
  /** OBS WebSocket call (null when disconnected). */
  call: () => ((req: string, data?: Record<string, any>) => Promise<any>) | null;
  connected: () => boolean;
  /** OBS canvas size. */
  base: () => { w: number; h: number };
}

export interface CamSceneNames {
  /** The A scene name in OBS. */
  a: string;
  /** The B scene name in OBS. */
  b: string;
}

interface CamSourceInfo {
  /** Talent seat (1-6). */
  seat: number;
  /** OBS input name, e.g. "Overdrive · Camera 4". */
  inputName: string;
  /** Scene item ID in scene A. */
  itemIdA: number | null;
  /** Scene item ID in scene B. */
  itemIdB: number | null;
}

// ---- Constants ----

export const cameraInputName = sharedCameraInputName;
export const abSceneName = bSceneName;

/**
 * 3.4: default TAKE duration, in ms, when the caller (ProducerCmd / dock) doesn't name one. Matches
 * DEFAULT_GFX_TRANSITION_MS — the same fixed crossfade the desk's own graphics (SkinCasters / SkinAnalystDesk,
 * via the primary /output/screen/* route) run on any layout change — so an un-timed camera TAKE lands together
 * with the frame/nameplate animation instead of finishing early or late against it.
 */
const DEFAULT_DURATION = DEFAULT_GFX_TRANSITION_MS;
/** Fallback interpolation frame rate. */
const FALLBACK_FPS = 30;

// ---- Easing functions ----

type EasingFn = (t: number) => number;

const EASINGS: Record<string, EasingFn> = {
  'ease-out': (t) => {
    // cubic-bezier(0.22, 1, 0.36, 1) approximation
    return 1 - Math.pow(1 - t, 3);
  },
  'ease-in-out': (t) => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  'linear': (t) => t,
};

// ---- Camera Engine ----

export interface CamEngineConfig {
  obs: CamEngineObs;
  desk: MainKey;
  scenes: CamSceneNames;
  /** Seats used by this desk (e.g. [4,5,6] for analyst, [1,2,3] for casters). */
  seats: number[];
  /** Skin hole rects for built-in presets. */
  holes: Record<'solo' | 'duo' | 'trio', Rect[]>;
  onChange: () => void;
}

export class CamEngine {
  readonly desk: MainKey;
  readonly scenes: CamSceneNames;
  readonly seats: number[];

  state: CamEngineState = {
    program: 'A',
    programPreset: null,
    previewPreset: null,
    hasMoveTransition: false,
    animating: false,
  };

  /** All presets (builtins + custom). */
  presets: DeskCamPreset[];

  private obs: CamEngineObs;
  private onChange: () => void;
  private sources: CamSourceInfo[] = [];
  /** The layout currently applied on Program (A or B, whichever is live). */
  private programLayout: DeskCamLayout[] = [];
  /** The layout prepared on Preview (the other scene). */
  private previewLayout: DeskCamLayout[] | null = null;

  constructor(config: CamEngineConfig) {
    this.obs = config.obs;
    this.desk = config.desk;
    this.scenes = config.scenes;
    this.seats = config.seats;
    this.onChange = config.onChange;
    this.presets = builtinPresets(config.desk, config.holes);
    // Initialize sources
    this.sources = config.seats.map(seat => ({
      seat,
      inputName: cameraInputName(seat),
      itemIdA: null,
      itemIdB: null,
    }));
  }

  // ---- Public API ----

  /** Detect OBS Move Transition plugin. Call after OBS connects. */
  async detectMoveTransition(): Promise<boolean> {
    const call = this.obs.call();
    if (!call) return false;
    try {
      const r = await call('GetSceneTransitionList');
      const transitions = r.transitions as any[];
      this.state.hasMoveTransition = transitions.some(
        t => t.transitionKind === 'move_transition' || t.transitionKind === 'obs_move_transition'
      );
    } catch {
      this.state.hasMoveTransition = false;
    }
    this.onChange();
    return this.state.hasMoveTransition;
  }

  /** Discover scene item IDs for camera sources in both A and B scenes. */
  async discoverItems(): Promise<void> {
    const call = this.obs.call();
    if (!call) return;
    for (const src of this.sources) {
      src.itemIdA = await this.findItemId(call, this.scenes.a, src.inputName);
      src.itemIdB = await this.findItemId(call, this.scenes.b, src.inputName);
    }
  }

  /**
   * Prepare a camera layout on the Preview scene (does NOT touch Program).
   * Returns an error string on failure, null on success.
   */
  async prepare(presetOrLayout: string | DeskCamLayout[]): Promise<string | null> {
    let layout: DeskCamLayout[];
    if (typeof presetOrLayout === 'string') {
      const preset = this.presets.find(p => p.id === presetOrLayout);
      if (!preset) return `Preset "${presetOrLayout}" not found`;
      layout = preset.cameras;
      this.state.previewPreset = preset.id;
    } else {
      const err = validateLayout(presetOrLayout);
      if (err) return err;
      layout = presetOrLayout;
      this.state.previewPreset = null;
    }
    this.previewLayout = layout;

    // Apply to the Preview scene (whichever is NOT Program)
    const previewScene = this.state.program === 'A' ? this.scenes.b : this.scenes.a;
    const err = await this.applyLayout(previewScene, layout);
    this.onChange();
    return err;
  }

  /**
   * TAKE: transition the prepared layout to Program.
   *
   * With Move Transition: OBS transitions A→B with animated camera moves.
   * Without: Overdrive runs a software interpolation on the Preview scene, then cuts.
   */
  async take(duration: number = DEFAULT_DURATION, easing: string = 'ease-out'): Promise<string | null> {
    if (this.state.animating) return 'Animation already in progress';
    if (!this.previewLayout) return 'Nothing prepared';

    const call = this.obs.call();
    if (!call) return 'OBS not connected';

    this.state.animating = true;
    this.onChange();

    const previewScene = this.state.program === 'A' ? this.scenes.b : this.scenes.a;

    try {
      if (this.state.hasMoveTransition) {
        // Tier 1: OBS Move Transition handles the animation
        await this.switchWithMoveTransition(call, previewScene, duration);
      } else {
        // Tier 2: software interpolation on the preview scene, then cut
        await this.switchWithFallback(call, previewScene, duration, easing);
      }

      // Swap roles
      this.programLayout = this.previewLayout;
      this.state.programPreset = this.state.previewPreset;
      this.state.program = this.state.program === 'A' ? 'B' : 'A';
      this.previewLayout = null;
      this.state.previewPreset = null;
    } catch (e: any) {
      return e.message ?? String(e);
    } finally {
      this.state.animating = false;
      this.onChange();
    }

    return null;
  }

  /**
   * Snap: immediately apply a layout to BOTH scenes (no animation, no A/B swap).
   * Used for initial setup or when animation isn't needed.
   */
  async snap(presetOrLayout: string | DeskCamLayout[]): Promise<string | null> {
    let layout: DeskCamLayout[];
    let presetId: string | null = null;

    if (typeof presetOrLayout === 'string') {
      const preset = this.presets.find(p => p.id === presetOrLayout);
      if (!preset) return `Preset "${presetOrLayout}" not found`;
      layout = preset.cameras;
      presetId = preset.id;
    } else {
      const err = validateLayout(presetOrLayout);
      if (err) return err;
      layout = presetOrLayout;
    }

    const errA = await this.applyLayout(this.scenes.a, layout);
    const errB = await this.applyLayout(this.scenes.b, layout);
    this.programLayout = layout;
    this.state.programPreset = presetId;
    this.previewLayout = null;
    this.state.previewPreset = null;
    this.onChange();
    return errA ?? errB;
  }

  /**
   * Sync camera positions with the graphics source's current hole rects.
   * Called when the graphics source reports its layout (desk-layout message).
   */
  async sync(holeRects: Rect[], casterSeats: number[]): Promise<void> {
    // Map hole rects to the seated casters
    const layout: DeskCamLayout[] = casterSeats.map((seat, i) => ({
      seat,
      rect: holeRects[i] ?? holeRects[0],
      visible: i < holeRects.length,
    }));
    // Apply to the current Program scene
    const programScene = this.state.program === 'A' ? this.scenes.a : this.scenes.b;
    await this.applyLayout(programScene, layout);
    this.programLayout = layout;
  }

  /**
   * Auto-select the matching built-in preset for the current desk state.
   * Returns the preset ID.
   */
  autoPreset(mode: 'cams' | 'panel', casterCount: number): string {
    return autoPresetId(mode, casterCount);
  }

  // ---- Preset management ----

  savePreset(name: string, cameras: DeskCamLayout[], id?: string): DeskCamPreset {
    const existing = id ? this.presets.find(p => p.id === id && !p.builtin) : undefined;
    if (existing) {
      existing.name = name;
      existing.cameras = cameras;
      existing.updatedAt = Date.now();
      return existing;
    }
    const preset: DeskCamPreset = {
      id: `custom:${Date.now().toString(36)}`,
      name,
      desk: this.desk,
      cameras,
      updatedAt: Date.now(),
    };
    this.presets.push(preset);
    return preset;
  }

  deletePreset(id: string): boolean {
    const idx = this.presets.findIndex(p => p.id === id);
    if (idx < 0 || this.presets[idx].builtin) return false;
    this.presets.splice(idx, 1);
    return true;
  }

  /** Serializable preset list (for the store). */
  customPresets(): DeskCamPreset[] {
    return this.presets.filter(p => !p.builtin);
  }

  /** Load custom presets from the store. */
  loadCustomPresets(saved: DeskCamPreset[]): void {
    // Keep builtins, replace customs
    this.presets = this.presets.filter(p => p.builtin).concat(saved);
  }

  // ---- OBS interaction ----

  private async findItemId(call: (req: string, data?: any) => Promise<any>, scene: string, source: string): Promise<number | null> {
    try {
      const r = await call('GetSceneItemId', { sceneName: scene, sourceName: source });
      return r.sceneItemId;
    } catch {
      return null;
    }
  }

  /**
   * Apply a camera layout to a single OBS scene.
   * Sets transform + visibility for each camera source in the scene.
   */
  private async applyLayout(scene: string, layout: DeskCamLayout[]): Promise<string | null> {
    const call = this.obs.call();
    if (!call) return 'OBS not connected';

    const base = this.obs.base();
    const sx = base.w / CANVAS.w;
    const sy = base.h / CANVAS.h;
    const errors: string[] = [];

    for (const src of this.sources) {
      const itemId = scene === this.scenes.a ? src.itemIdA : src.itemIdB;
      if (itemId == null) continue;

      const cam = layout.find(c => c.seat === src.seat);
      const visible = cam?.visible !== false && !!cam;

      try {
        if (cam) {
          const { x, y, w, h } = cam.rect;
          const transform: Record<string, any> = {
            positionX: x * sx,
            positionY: y * sy,
            alignment: 5, // top-left
            boundsType: 'OBS_BOUNDS_SCALE_OUTER',
            boundsAlignment: 0,
            boundsWidth: w * sx,
            boundsHeight: h * sy,
            cropToBounds: true,
          };
          // Apply crop if specified
          if (cam.crop) {
            const zoom = cam.crop.zoom ?? 1;
            if (zoom > 1) {
              // Crop is applied as source-level crop percentages
              // The zoom factor determines how much of the source is visible
              const cropFraction = 1 - 1 / zoom;
              const offsetX = (cam.crop.x ?? 0) * cropFraction;
              const offsetY = (cam.crop.y ?? 0) * cropFraction;
              // OBS crops are in source pixels; we approximate with percentage-based values
              // (actual pixel values depend on the source resolution, which we query on first use)
              transform.cropLeft = Math.round(offsetX * 1920);
              transform.cropTop = Math.round(offsetY * 1080);
              transform.cropRight = Math.round((cropFraction - offsetX) * 1920);
              transform.cropBottom = Math.round((cropFraction - offsetY) * 1080);
            }
          }
          await call('SetSceneItemTransform', { sceneName: scene, sceneItemId: itemId, sceneItemTransform: transform });
        }
        await call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: itemId, sceneItemEnabled: visible });
      } catch (e: any) {
        errors.push(`${src.inputName}: ${e.message}`);
      }
    }

    return errors.length ? errors.join('; ') : null;
  }

  /**
   * Tier 1: Switch using OBS Move Transition.
   * Move Transition automatically animates matched sources between scenes.
   */
  private async switchWithMoveTransition(
    call: (req: string, data?: any) => Promise<any>,
    targetScene: string,
    duration: number,
  ): Promise<void> {
    // Set Move Transition as the current transition
    try {
      const r = await call('GetSceneTransitionList');
      const transitions = r.transitions as any[];
      const move = transitions.find(t =>
        t.transitionKind === 'move_transition' || t.transitionKind === 'obs_move_transition'
      );
      if (move) {
        await call('SetCurrentSceneTransition', { transitionName: move.transitionName });
        // Configure duration
        await call('SetCurrentSceneTransitionDuration', { transitionDuration: duration });
      }
    } catch {
      // If we can't set the transition, fall through to the scene switch anyway
    }

    // Switch Program to the target scene (OBS performs the Move Transition)
    await call('SetCurrentProgramScene', { sceneName: targetScene });

    // Wait for the transition to complete
    await this.sleep(duration + 50);
  }

  /**
   * Tier 2: Software interpolation fallback.
   * Animate transforms on the preview scene at ~30fps, then cut to it.
   */
  private async switchWithFallback(
    call: (req: string, data?: any) => Promise<any>,
    targetScene: string,
    duration: number,
    easingName: string,
  ): Promise<void> {
    const easing = EASINGS[easingName] ?? EASINGS['ease-out'];
    const frames = Math.max(2, Math.round(duration / 1000 * FALLBACK_FPS));
    const frameMs = duration / frames;

    // Gather current transforms from the PROGRAM scene and target transforms from the PREVIEW scene
    const fromLayouts = this.programLayout;
    const toLayouts = this.previewLayout ?? fromLayouts;

    // Build interpolation plan for each source
    type AnimPlan = { itemId: number; from: Rect; to: Rect; fromVisible: boolean; toVisible: boolean };
    const plans: AnimPlan[] = [];

    for (const src of this.sources) {
      const itemId = targetScene === this.scenes.a ? src.itemIdA : src.itemIdB;
      if (itemId == null) continue;

      const fromCam = fromLayouts.find(c => c.seat === src.seat);
      const toCam = toLayouts.find(c => c.seat === src.seat);
      const fromRect = fromCam?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
      const toRect = toCam?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
      const fromVisible = !!fromCam && fromCam.visible !== false;
      const toVisible = !!toCam && toCam.visible !== false;

      if (fromVisible || toVisible) {
        plans.push({ itemId, from: fromRect, to: toRect, fromVisible, toVisible });
      }
    }

    // Animate on the TARGET scene (which is in Preview / not on air)
    // Start by showing all sources that will be visible at the end
    const base = this.obs.base();
    const sx = base.w / CANVAS.w;
    const sy = base.h / CANVAS.h;

    for (let f = 0; f <= frames; f++) {
      const t = easing(f / frames);

      for (const plan of plans) {
        const x = plan.from.x + (plan.to.x - plan.from.x) * t;
        const y = plan.from.y + (plan.to.y - plan.from.y) * t;
        const w = plan.from.w + (plan.to.w - plan.from.w) * t;
        const h = plan.from.h + (plan.to.h - plan.from.h) * t;

        try {
          await call('SetSceneItemTransform', {
            sceneName: targetScene,
            sceneItemId: plan.itemId,
            sceneItemTransform: {
              positionX: x * sx, positionY: y * sy,
              alignment: 5,
              boundsType: 'OBS_BOUNDS_SCALE_OUTER',
              boundsAlignment: 0,
              boundsWidth: w * sx, boundsHeight: h * sy,
              cropToBounds: true,
            },
          });
        } catch { /* continue animating other sources */ }
      }

      if (f < frames) await this.sleep(frameMs);
    }

    // Set final visibility
    for (const plan of plans) {
      try {
        await call('SetSceneItemEnabled', {
          sceneName: targetScene,
          sceneItemId: plan.itemId,
          sceneItemEnabled: plan.toVisible,
        });
      } catch {}
    }

    // Cut to the target scene (animation was already done on it)
    try {
      // Use cut transition for the actual switch
      const r = await call('GetSceneTransitionList');
      const transitions = r.transitions as any[];
      const cut = transitions.find(t => t.transitionKind === 'cut_transition');
      if (cut) {
        await call('SetCurrentSceneTransition', { transitionName: cut.transitionName });
      }
    } catch {}

    await call('SetCurrentProgramScene', { sceneName: targetScene });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

# OVERDRIVE 3.4 — OBS-COMPOSITED DESK CAMERA ENGINE

## Status: Phase 3a COMPLETE — core engine + types + engine commands + tests (26 pass)

---

## 1. Goal

Move camera composition from the browser-source renderer (`SkinCasters`, `SkinAnalystDesk`) to **native OBS sources** controlled via OBS WebSocket, so that:

- Camera feeds are persistent local OBS sources (VDO.Ninja browser sources or capture cards) — one connection per talent, never duplicated.
- Camera positions, sizes, crops and visibility are controlled by Overdrive via `SetSceneItemTransform` / `SetSceneItemEnabled`.
- Transitions between layouts are **animated** (OBS Move Transition plugin, with a software fallback).
- Graphics remain in a single dynamic browser source per scene (the existing `/g/analyst-desk`, `/g/caster-desk`).
- **Preview/Program isolation** is preserved: preparing a camera layout never mutates on-air scene items.
- Camera layouts are **reusable presets**, controlled from Producer and OBS docks.
- Audio stays independent (one path per talent, never duplicated).

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  OBS Scene: "Overdrive · Analyst Desk"                  │
│                                                          │
│  Layer stack (bottom → top):                             │
│    [0] Game capture (if any)                             │
│    [1] Camera: Talent 4 (VDO.Ninja browser src)         │
│    [2] Camera: Talent 5 (VDO.Ninja browser src)         │
│    [3] Camera: Talent 6 (VDO.Ninja browser src)         │
│    [4] Graphics: /g/analyst-desk (browser source)        │
│    [5] Overlays (scoreboard, etc.)                       │
│                                                          │
│  Camera sources are PERSISTENT inputs shared across      │
│  A/B scenes. Graphics layer has transparent holes.       │
└─────────────────────────────────────────────────────────┘
```

### Key design decisions

**A. A/B Scene Pairs for Preview/Program Isolation**

Each desk gets TWO OBS scenes that share the SAME sources:
- `Overdrive · Analyst Desk` (Program copy)
- `Overdrive · Analyst Desk (B)` (Preview copy)

Both scenes reference the same camera inputs and graphics browser source. When preparing a new layout:
1. The B scene's camera transforms are changed (the A scene on Program is untouched).
2. OBS Studio Mode Preview shows the B scene.
3. On TAKE, OBS transitions from A → B. The roles swap: B becomes Program, A becomes the next Preview.

This guarantees **no on-air mutation** while preparing.

**B. Camera Sources as Persistent OBS Inputs**

The Scene Builder creates one browser source per talent camera:
- `Overdrive · Camera 1` through `Overdrive · Camera 6`
- Input kind: `browser_source`
- URL: the talent's VDO.Ninja view URL (`https://vdo.ninja/?view=<id>&...`)
- These are **inputs** (global to OBS), added as scene items to both A and B desk scenes.
- Never deleted or recreated during a show — only the URL changes if the talent changes.

For `type === 'obs'` casters (local capture cards, NDI), the existing OBS source is used as-is.

**C. Animation Strategy (two tiers)**

**Tier 1 — OBS Move Transition plugin (preferred):**
- At connect time, check `GetSourceFilterList` or `GetSceneTransitionList` for `move_transition` / `obs_move_transition`.
- If available: set Move Transition as the transition between A↔B scenes, with matched-source rules (same source name in both scenes = animated move).
- The Move Transition handles position, size, crop and opacity interpolation natively at OBS's framerate.

**Tier 2 — Overdrive interpolation engine (fallback):**
- When Move Transition is not installed, Overdrive animates camera transforms itself:
  - `SetSceneItemTransform` at ~30 fps over a configured duration (default 500ms).
  - Easing: cubic-bezier(0.22, 1, 0.36, 1) — the same `EASE_OUT` the browser-source renderer uses.
  - Runs in the **Preview scene only** (B), then a cut transition to B when animation completes.
  - On Program (A), items stay frozen until the cut.

**D. Graphics Browser Source Changes**

The browser sources (`/g/analyst-desk`, `/g/caster-desk`) currently render cameras internally. With OBS-composited cameras:

- The graphics source renders **everything except camera feeds**: frame videos, name bars, prediction badges, analysis panels, VS strips, backgrounds.
- Camera holes in the frame videos remain transparent — OBS places the camera sources behind (lower z-order than) the graphics source.
- The graphics source communicates its current layout to the server (which camera holes are where), so the server can position OBS camera sources to match.
- A new message `desk-layout` from the graphics source tells the server the current hole rects and transition timing.

**E. Desk Camera Presets**

```typescript
interface DeskCamPreset {
  id: string;
  name: string;
  /** Which desk this applies to ('analyst-desk' | 'caster-desk') */
  desk: MainKey;
  /** Per-camera layout: position, size, crop, visibility */
  cameras: DeskCamLayout[];
  /** Animation duration in ms (default 500) */
  duration?: number;
  /** Easing function name */
  easing?: 'ease-out' | 'ease-in-out' | 'linear';
  updatedAt: number;
}

interface DeskCamLayout {
  /** Talent position (1-6) or 'any' for relative assignment */
  seat: number | 'any';
  /** Camera rect in 1920×1080 canvas coordinates */
  rect: { x: number; y: number; w: number; h: number };
  /** Crop: zoom + offset (reuses TalentCrop) */
  crop?: { zoom: number; x: number; y: number };
  /** Visible in this preset */
  visible: boolean;
  /** Z-order within the camera group */
  zIndex?: number;
}
```

Built-in presets (created by Scene Builder, not deletable):
- `desk-trio` — three cameras in the skin's trio holes
- `desk-duo` — two cameras in the skin's duo holes  
- `desk-solo` — one camera in the skin's solo hole
- `desk-panel-trio` — three cameras in left column (panel mode)
- `desk-panel-duo` — two cameras in left column
- `desk-panel-solo` — one camera in left column
- `desk-split` — prediction split screen (cameras left, panel right)
- `desk-fullscreen` — no cameras visible (fullscreen graphic)

Custom presets saved/recalled from Producer and docks.

---

## 3. Server-Side Changes

### 3.1 `server/camEngine.ts` (new file)

The camera composition engine. Responsibilities:
- Maintains the current camera layout state per desk scene.
- Applies transforms to OBS via `SetSceneItemTransform` / `SetSceneItemEnabled`.
- Handles A/B scene swapping for Preview/Program isolation.
- Runs the fallback interpolation engine when Move Transition is unavailable.
- Synchronizes with graphics-source animation timing.

```typescript
interface CamEngineState {
  /** Which scene variant is currently Program (true = A, false = B) */
  aIsProgram: boolean;
  /** Current layout on Program */
  programLayout: DeskCamLayout[];
  /** Prepared layout on Preview (null = same as Program) */
  previewLayout: DeskCamLayout[] | null;
  /** Move Transition detected */
  hasMoveTransition: boolean;
  /** Interpolation in progress */
  animating: boolean;
}
```

Key methods:
- `prepare(preset: DeskCamPreset)` — apply a layout to the Preview (B) scene without touching Program.
- `take(duration?: number)` — commit: transition OBS from A→B (Move Transition or animated fallback + cut).
- `snap(preset: DeskCamPreset)` — immediate: apply to both A and B (for non-animated changes).
- `sync(holeRects: Rect[])` — receive hole positions from the graphics source and position cameras to match.

### 3.2 `server/obs.ts` changes

Extend `ObsBridge`:
- `detectMoveTransition(): Promise<boolean>` — check if the plugin is available.
- `setMoveTransition(sceneA: string, sceneB: string, settings: MoveSettings): Promise<void>` — configure Move Transition between A/B scenes.
- `animateTransform(scene: string, itemId: number, from: Transform, to: Transform, duration: number, easing: EasingFn): Promise<void>` — the fallback interpolation engine (runs a requestAnimationFrame-like loop of `SetSceneItemTransform` calls).

The existing `apply()` method continues to work for non-desk scenes. Desk scenes delegate to `CamEngine`.

### 3.3 `server/obsSetup.ts` changes

The Scene Builder learns to create:
- Camera input sources (`Overdrive · Camera N`) — VDO.Ninja browser sources.
- A/B scene pairs for desk scenes (the B scene is a copy with the same sources).
- Move Transition configuration between A/B pairs (when available).
- Proper z-ordering: cameras below graphics, graphics below overlays.

New plan ops:
- `create-camera-input` — create a persistent camera browser source.
- `create-ab-scene` — create the B variant of a desk scene.
- `configure-move-transition` — set up Move Transition between A/B.
- `add-camera-to-scene` — add a camera input to both A and B scenes.

### 3.4 `server/hub.ts` changes

New engine commands:
```typescript
| { c: 'cam-preset-save'; preset: Partial<DeskCamPreset> }
| { c: 'cam-preset-recall'; id: string; take?: boolean }
| { c: 'cam-preset-delete'; id: string }
| { c: 'cam-prepare'; desk: MainKey; layout: DeskCamLayout[] }
| { c: 'cam-take'; duration?: number }
| { c: 'cam-snap'; desk: MainKey; layout: DeskCamLayout[] }
```

The existing `obs.apply()` calls for desk scenes route through `CamEngine` instead.

### 3.5 `server/audioMix.ts` — no changes

Audio is already independent per talent. Camera visibility changes do NOT affect audio routing. The existing audio system continues to manage mute/unmute/volume/monitoring separately.

---

## 4. Client-Side Changes

### 4.1 Graphics Browser Sources

**`/g/analyst-desk` and `/g/caster-desk`:**
- Add a `mode` prop or URL param: `?cameras=obs` (cameras handled by OBS) vs `?cameras=internal` (current behavior, fallback).
- In OBS mode: render frames, names, panels, badges, strips — but NOT camera `<Feed>` elements.
- Emit `desk-layout` messages to the server with the current hole rects and transition state, so the server positions OBS cameras to match.
- The transparent holes in frame videos remain as-is (OBS cameras show through from behind).

**Backward compatibility:** Without the `?cameras=obs` param, everything works as today (cameras inside the browser source). This is important for:
- The Overdrive preview in the Producer UI (which renders in-browser, not in OBS).
- Monitor outputs that don't go through OBS.
- Testing without OBS connected.

### 4.2 Producer UI

**Camera Preset Panel** (new section in the desk dock):
- Dropdown to select a preset → `cam-preset-recall`.
- Save current layout as preset → `cam-preset-save`.
- Per-camera controls: position (drag), size (resize handles), crop (zoom/pan), visibility toggle.
- "Prepare" button (applies to Preview only) and "Take" button (transitions to air).

### 4.3 OBS Dock: `/dock/cameras`

A lightweight OBS custom dock page (browser panel in OBS) for camera operators:
- Shows the current desk and its camera layout.
- Quick-recall buttons for each preset.
- Per-camera crop/zoom sliders (useful for adjusting a camera without changing the layout).
- Take/Prepare buttons.

---

## 5. Transition Choreography

The key challenge: when switching from "three-person desk" to "predictions panel", BOTH the graphics and the cameras must animate in sync.

### Sequence for a desk-mode change (e.g., Cameras → Predictions):

```
1. Producer clicks "Predictions" in the desk panel
2. Server receives `stage-desk { panel: 'picks' }`
3. Server prepares:
   a. Graphics: tells /g/analyst-desk to prepare panel mode (the bar loop starts decoding)
   b. Cameras: applies `desk-panel-trio` preset to the B scene (cameras move to left-column positions)
4. When both are ready (graphics reports ready, camera transforms applied):
   a. Server sends `take` to the graphics source (it starts its crossfade animation)
   b. Simultaneously: OBS transitions A→B (Move Transition animates cameras)
   c. Duration matches: both use the same ms (default 500ms, configurable)
5. After transition completes:
   a. A becomes the new Preview, B is now Program
   b. Graphics source confirms the transition is done
```

### Sequence for TAKE (scene switch to/from the desk):

```
1. Producer TAKEs from Gameplay → Analyst Desk
2. OBS transitions to the Analyst Desk scene (stinger/fade/cut)
3. Camera sources are already in position (they were prepared when the desk was last used)
4. The stinger covers the moment — no camera animation needed during a scene switch
5. After the stinger: cameras and graphics are both in their target state
```

---

## 6. Preview/Program Isolation — Detailed

### The A/B Scene Approach

```
State 1: A is Program, B is Preview
  - Program viewers see scene A (cameras at layout X)
  - Producer prepares layout Y → applied to scene B only
  - OBS Studio Mode Preview shows scene B with layout Y

State 2: Producer TAKEs → OBS transitions A→B
  - B becomes Program (cameras at layout Y)
  - A becomes Preview for the next change

State 3: B is Program, A is Preview  
  - Producer prepares layout Z → applied to scene A only
  - OBS Studio Mode Preview shows scene A with layout Z

State 4: Producer TAKEs → OBS transitions B→A
  - Back to State 1 pattern
```

### Shared sources, independent transforms

Both A and B scenes reference the SAME camera inputs (e.g., `Overdrive · Camera 4`). OBS allows the same input to appear in multiple scenes with DIFFERENT transforms per scene. This is the key mechanism:
- In scene A: Camera 4 is at position (73, 309) with size 564×407 (trio hole 1)
- In scene B: Camera 4 is at position (80, 190) with size 384×216 (panel column top)
- Changing B's transform does NOT affect A's transform.

### The graphics browser source

The graphics source (`/g/analyst-desk`) is also shared between A and B. It draws the same content in both — the frame video, the panel content, etc. Since it's one source, it can't show different content in A vs B simultaneously.

**Solution:** The graphics source shows the PREPARED state (what Preview will look like). On TAKE:
1. The graphics source commits its prepared state as the new live state.
2. OBS switches A↔B (cameras move to match).
3. The timing is synchronized so cameras and graphics animate together.

This matches the existing unified-MVP approach: one source, prepared state → committed state on TAKE.

---

## 7. Scene Builder Integration

### New items in the main-scene build plan

For `analyst-desk` and `caster-desk`:

```
Scene: "Overdrive · Analyst Desk"
  [0] Game capture (if capture: true)
  [1] Overdrive · Camera 4 (browser_source, VDO.Ninja)
  [2] Overdrive · Camera 5 (browser_source, VDO.Ninja)  
  [3] Overdrive · Camera 6 (browser_source, VDO.Ninja)
  [4] Overdrive · analyst-desk (browser_source, /g/analyst-desk?cameras=obs)
  [5..] Overlays (existing)

Scene: "Overdrive · Analyst Desk (B)"
  — same items, same sources, different sceneItemId (independent transforms)
```

For `caster-desk`:
```
Scene: "Overdrive · Caster Desk"
  [1] Overdrive · Camera 1
  [2] Overdrive · Camera 2
  [3] Overdrive · Camera 3
  [4] Overdrive · caster-desk (browser_source, /g/caster-desk?cameras=obs)

Scene: "Overdrive · Caster Desk (B)"
  — same items
```

### Camera source URL management

When a talent's VDO.Ninja ID changes (talent-edit, talent-regen):
- `SetInputSettings` updates the browser source URL.
- The browser source reloads — but since it's ONE source shared across scenes, the reconnect happens once.
- The camera stays in position (transform is per-scene-item, not per-input).

---

## 8. Data Flow

```
Producer UI ──cmd──▶ Hub ──▶ CamEngine ──ws──▶ OBS
                       │                          │
                       ├──▶ /g/analyst-desk ◀─────┘ (hole rects via ws)
                       │    (browser source)
                       │
                       └──▶ AudioMix (unchanged)
```

### Hub integration points

1. **On scene change** (`obs.apply` called): if the scene is a desk, delegate to `CamEngine.sync()` instead of the old snap transform.
2. **On desk panel change** (`stage-desk`): `CamEngine.prepare()` the matching preset.
3. **On TAKE** (`obsSwitch`): `CamEngine.take()` handles the A/B swap + animation.
4. **On talent camera change**: `CamEngine.updateSource()` updates the OBS input URL.
5. **On preset commands**: `CamEngine` manages the preset store.

---

## 9. Fallback & Degradation

| Condition | Behavior |
|---|---|
| OBS not connected | Cameras render inside browser source (current behavior) |
| Move Transition not installed | Overdrive interpolation engine (30fps SetSceneItemTransform) |
| OBS Studio Mode off | A/B swap via SetCurrentProgramScene (no Preview); prepare still safe (B is off-air) |
| Camera source missing in OBS | Error logged; that camera slot shows the browser-source fallback |
| `?cameras=obs` not in URL | Full backward compat: cameras inside browser source |

---

## 10. Engine Commands (new)

```typescript
// In shared/engine.ts — added to ProducerCmd union:
| { c: 'cam-preset-save'; name: string; desk: MainKey; cameras?: DeskCamLayout[] }
| { c: 'cam-preset-recall'; id: string; take?: boolean; duration?: number }
| { c: 'cam-preset-delete'; id: string }
| { c: 'cam-prepare'; desk: MainKey; preset?: string; layout?: DeskCamLayout[] }
| { c: 'cam-take'; duration?: number; easing?: string }
| { c: 'cam-snap'; desk: MainKey; preset?: string; layout?: DeskCamLayout[] }
```

---

## 11. Testing Strategy

### Mock OBS tests (in this sandbox)
- A/B scene creation and camera source setup (obsSetup dry-run plans).
- Preset save/recall/delete cycle.
- CamEngine state machine: prepare → take → swap roles.
- Fallback interpolation engine: generates correct SetSceneItemTransform calls.
- Synchronized transition: graphics source and camera engine receive coordinated cues.
- Audio independence: cam visibility changes do not trigger audio changes.

### Real OBS tests (user must run)
- `e2e-rig/obs/realCamEngine.mjs`:
  - Creates camera inputs and A/B scenes.
  - Applies presets with Move Transition.
  - Verifies transforms per-scene (A vs B differ).
  - Runs a prepare → take → verify cycle.
  - Checks Move Transition detection and fallback.

**⚠ Real OBS is not available in this sandbox.** All tests here run against the mock. The user must run `realCamEngine.mjs` with a real OBS instance to verify.

---

## 12. Implementation Phases

### Phase 3a: Camera Engine Core
- [ ] `DeskCamPreset` and `DeskCamLayout` types in `shared/types.ts`
- [ ] `server/camEngine.ts` — state machine, A/B tracking, transform application
- [ ] Extend `ObsBridge` — Move Transition detection, fallback interpolation
- [ ] Built-in presets derived from skin hole rects
- [ ] Engine commands in `shared/engine.ts`
- [ ] Hub integration: route desk `obs.apply()` through CamEngine

### Phase 3b: Scene Builder Integration
- [ ] Camera input creation in `obsSetup.ts` plan ops
- [ ] A/B scene pairs for desk scenes
- [ ] Move Transition configuration
- [ ] Camera z-ordering (below graphics, above game capture)
- [ ] `?cameras=obs` URL param on desk browser sources

### Phase 3c: Graphics Source Adaptation
- [ ] `SkinAnalystDesk` / `SkinCasters`: skip `<Feed>` rendering in OBS mode
- [ ] Emit `desk-layout` messages with hole rects and timing
- [ ] `desk-layout` handler in hub.ts → CamEngine.sync()
- [ ] Backward compat: `?cameras=internal` default

### Phase 3d: Synchronized Transitions
- [ ] Coordinated prepare/take sequence (graphics + cameras)
- [ ] Duration matching between graphics crossfade and camera move
- [ ] Scene-switch choreography (stinger covers camera state)

### Phase 3e: Producer & Dock UI
- [ ] Camera preset panel in SceneDock (desk controls)
- [ ] `/dock/cameras` OBS dock page
- [ ] Per-camera crop/zoom controls
- [ ] Preset management UI (save/rename/delete)

### Phase 3f: Testing
- [ ] Unit tests for CamEngine state machine
- [ ] obsSetup dry-run tests for camera sources and A/B scenes
- [ ] e2e mock tests for the full prepare→take cycle
- [ ] `realCamEngine.mjs` for real-OBS verification

---

## 13. Files to Create / Modify

### New files
- `shared/camPresets.ts` — DeskCamPreset, DeskCamLayout types, built-in presets, preset utilities
- `server/camEngine.ts` — the camera composition engine
- `src/pages/controller/CamDock.tsx` — camera preset dock controls (embedded in SceneDock for desk screens)
- `src/pages/dock/Cameras.tsx` — standalone OBS dock page for camera operators
- `e2e-rig/obs/realCamEngine.mjs` — real-OBS acceptance test

### Modified files
- `shared/engine.ts` — new ProducerCmd variants for cam-preset-* and cam-prepare/take/snap
- `shared/types.ts` — DeskCamPreset in the store
- `shared/obsLayout.ts` — A/B scene definitions for desk scenes
- `server/obs.ts` — Move Transition detection, fallback interpolation, extended apply()
- `server/obsSetup.ts` — camera input creation, A/B scene pairs, z-ordering
- `server/hub.ts` — cam engine integration, new command handlers
- `src/components/show/AnalystDesk.tsx` — OBS-mode rendering (skip cameras, emit hole rects)
- `src/components/show/Skin.tsx` — OBS-mode rendering for SkinCasters
- `src/pages/controller/SceneDock.tsx` — camera preset controls for desk screens

---

## 14. What This Does NOT Change

- **Audio routing** — stays in `audioMix.ts`, independent of camera visibility.
- **Non-desk scenes** — Gameplay, MVP, Intermission, etc. are unchanged.
- **The existing preset system** — Scene presets (`Preset` in types.ts) continue to work. Camera presets are a new, separate system.
- **The browser-source preview** — Producer's in-browser preview continues to show cameras internally (no OBS needed for preview).
- **Monitor outputs** — `/output/monitor` etc. render cameras internally.
- **VDO.Ninja connections** — one per talent, managed by existing talent system. Camera engine only positions the OBS source; it doesn't manage the WebRTC connection.

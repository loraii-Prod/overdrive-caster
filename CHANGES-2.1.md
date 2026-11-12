# Overdrive 2.1: Graphics Workstation, seamless transitions, console geometry

**Date:** 12 November 2026 · builds on the 2.0 handover (its rules in sections 1–3 still apply).
Install as before: unzip over the folder (keeps `data/`), then `start.cmd rebuild`.

## What changed

### 1. Black flashes removed (internal graphic transitions)
**Cause found** (measured frame by frame, not guessed):
- **Analyst Desk, Cameras only ↔ a panel**: two different React trees. The skin frame video (`SkinDesk`) was unmounted and a new background `<video>` (`bar.webm`) was mounted. A new video draws nothing until its first frame decodes, so the source was transparent (black in OBS) for ~50–260 ms. The worst case was back to Cameras only: 100 % of the frame was empty.
- **Solo / Duo / Trio** (caster booth and desk): `AnimatePresence mode="wait"` faded the old layout to nothing before the new one existed, and the frame video was remounted. Result: ~300–350 ms of empty frame each time.
- **Panel → panel** (Predictions → H2H…): the panel box was keyed by the panel, so it was destroyed and re-entered (the box vanished).

**Fix** (`src/gfx/transition.tsx`, used by `Skin.tsx` → `SkinCasters`, the new `AnalystDesk.tsx`, `Desk.tsx` → `DeskPanel`, `Graphic.tsx`):
- `useStaged`: the incoming videos are mounted hidden and decoded first; the layout changes in one commit. The outgoing frame stays fully visible under the incoming one until its crossfade ends. Mount order is stable, because moving a `<video>` in the DOM cancels its CSS transition (that was a bug found during the work). The Analyst Desk keeps the other mode's video decoded and paused (warm) so switches start at once.
- Cameras are persistent elements that **move** (frame holes ↔ desk column); hole backing covers the holes while they travel. No feed remount on panel changes (verified: same `<video>` elements, still playing).
- `Swap`: content swap that waits until the incoming layer can draw, then crossfade / slide / wipe / scale / cut; rapid changes settle on the latest.
- Per-graphic **Motion** properties on every package: `transition` (crossfade/slide/wipe/scale/cut) and `transitionMs` (0–1000).
- IN waits until the graphic's videos can draw before animating.

### 2. Producer Console → Graphics Workstation (`src/pages/producer/`)
- `Producer.tsx` (shell), `ws.tsx` (atoms: state badges, buttons, splitters, uniform fit), `Library.tsx`, `RundownPanel.tsx`, `Studio.tsx`, `Inspector.tsx` (rewritten, still generated from packages).
- Live graphics mode: Library (by category) · Preview (clean 1920×1080) · Inspector · Rundown · Publish/OBS/Recovery/acks. Studio mode: Packages · Instances & OBS · Talent · Data bindings · Control modules · Assets · Show file.
- Keyboard: F2 IN · F3 UPDATE · F4 OUT · F8 take next · Ctrl+Enter publish all · Ctrl+Z undo · Alt+↑/↓ · Alt+1/2 · D · G · ?.
- Test hooks of 2.0 kept (`data-preview`, `data-gfx-row`, `data-inspector`, `data-prop`, `data-anims`, `data-binding`, `data-seat`, `data-module(s)`, `data-talent-dashboard`, `data-rundown(-row)`, `data-package(s)`, `data-studio(-module)`, `data-draft-list`, `data-log`, aria-labels). New: `data-console-canvas`, `data-controls`, `data-header`, `data-library`, `data-source-row`, `data-gfx-quick`, `data-rd-add/next/in/out`, `data-studio-tab`, `data-instance`, `data-view-toggle`, `data-publish-all`, `data-desk-mode`, `data-desk-panel`, `data-cam`.

### 3. Console geometry
The old canvas was top-left aligned (unused space at any other window size), had status labels and a 6 px tally border painted over the preview, and the scene-module strip overflowed horizontally. Now: one scale factor for both axes, centred; preview exactly 1920×1080 and controls exactly 1920×400 at 1920×1480; no page scroll; no horizontal overflow in any panel.

### 4. Engine (all acked, tested)
- **Rundown** (`shared/rundown.ts`, persisted, in controller state): `rd-add {gfx, preset?|snapshot?, label?, at?}`, `rd-remove`, `rd-move`, `rd-edit`, `rd-cue`, `rd-take {id, action in|update|out}`, `rd-next`, `rd-clear`. Taking applies the item's preset or snapshot to that graphic (replacing its draft, with a note), animates inside its own source, and never switches OBS. Deleting a graphic removes its items.
- `gfx-obs {id, scene}`: OBS scene mapping per graphic (`obsScene` on the instance), used by tallies and the switch button.
- Automation priority now also covers `gfx-publish`, `gfx-anim`, `rd-take`, `rd-next` (on-air graphics actions). `gfx-set` with no patch is refused.
- New package **Tournament Bracket** `od.bracket` → `/g/bracket` (approved bracket / matches board, half selection, cycling from the synced clock).

## Verified here (honest list)
| Check | Result |
|---|---|
| Clean `npm install` + `tsc --noEmit` (real `@types/react`) + `vite build` + server bundle | pass, 0 type errors |
| `npx tsx tests/engine.test.ts` | **88/88** (was 61; +rundown, OBS mapping, priority, bracket) |
| Frame capture (CDP screencast ~30 fps, transparent pixels counted per frame), original build | panels up to 100 % empty; Analyst Solo/Duo 100 % empty ~300 ms; booth Solo/Duo/Trio 100 % empty ~350 ms |
| Same captures, this build | **0 empty frames** in every scenario: panels, desk Solo/Duo, booth Solo/Duo/Trio, bracket half/view, scoreboard score changes |
| With live WebRTC test cameras (fake device, real talent links) | 0 empty frames; desk panel changes keep the same camera `<video>` elements, still playing |
| 34 changes 120 ms apart | 0 empty frames, settles on the last command |
| Desk switch after the warm video sat paused 25 s | 0 empty frames |
| Console geometry at 1920×1480, 1600×900, 2560×1440, 1920×1080, 1280×720, 1440×1480, 1536×1184 @125 % | exact rects, uniform scale, centred, no scroll, no horizontal overflow |
| Workstation end to end (2 operators, real `/g/analyst-desk` source) | **23/23** (selection never animates, drafts, Draft/Live preview, publish, F2/F4/F8, rundown, Ctrl+Enter, source refresh, Studio rename, no OBS switch, no stinger) |
| Runtime error sweep: 19 library entries, 7 Studio tabs, 5 `/g/` sources, `/controller`, docks, `/output/*` | no errors |

Scripts: `e2e-rig/2.1/` (Python + Playwright, headless Chrome; paths `/tmp/oddata`, `localhost:8787`, Chrome at `/usr/bin/google-chrome`: adapt).

## Not verified (do not assume)
- **Real OBS** (only offline/not-set-up states seen here); the OBS scene mapping UI was exercised without an OBS scene list.
- **VDO.Ninja cameras** during transitions (the iframe is now not remounted by panel changes, but no real VDO feed was tested), remote/NAT talent (TURN).
- **Windows / Node 20** (built on Linux, Node 22).
- Frame captures were in headless Chrome; OBS uses CEF (Chromium) and should behave the same, but check once in OBS (e.g. record the source and step through frames).
- Graphics renderer fault injection (error boundary still not crash-tested).
- Transition *look* was judged from frame sheets, not by you: tune `transitionMs` / kind per graphic in the Inspector (Motion).

## Next steps
1. Smoke test on the show PC: `start.cmd rebuild`, OBS connected, `/g/caster-desk`, `/g/analyst-desk`, `/g/scoreboard`, `/g/gameplay`, `/g/bracket` as browser sources, map them in Studio → Instances & OBS, one real talent + one VDO.Ninja talent, record the Analyst Desk switching panels.
2. "Build scenes in OBS" for graphics instances (use `obsScene`).
3. Migrate the remaining scene sources to packages (Veto, Team intro / Showcase, Interview, Matches, Starting / BRB / Ending, Media), each with `Swap`/`useStaged` where content changes.
4. Rundown automation (timed items, media-end triggers) using `source:'auto'`.

# 4K performance test on the production PC

Goal: measure, on the real PC with real OBS and its GPU, whether native 3840×2160 Overdrive output runs at a steady
60 fps, how much GPU and video decoding it costs, whether off-air pausing helps, and whether any animation shows GPU
scaling artifacts. Everything here runs on a **rehearsal** Overdrive instance (`feature/native-4k` build on the PC or the
LAN). Production is not involved. Plan about 3 hours. Results go into the record sheet at the end.

Headless numbers from the build machine (no GPU, software rendering, so they are **not** a prediction): at 4K the Caster
Desk page ran at 22 fps and dropped about half its background-video frames, against 60 fps at 1080p. The PC's GPU should
do far better. This test finds out by how much.

## 0. Before you start

- OBS: **Settings → Advanced → Sources → Enable Browser Source Hardware Acceleration** must be on (restart OBS after
  changing it). Note the OBS version, GPU model and driver version on the record sheet.
- Close other GPU-heavy apps. Game capture: use the real game, as on a show day.
- Overdrive: run the `feature/native-4k` build (`npm run build && npm start`), open Studio → OBS Setup and check that
  OBS shows as connected.
- Windows Task Manager → Performance → GPU: keep it open (graphs **3D**, **Video Decode**, **Dedicated GPU memory**).
- OBS: **Docks → Stats** (render lag, frames skipped by the encoder, average frame render time).

## 1. Baseline at 1080p (today's setup)

1. OBS Setup → Output **1080p**. OBS → Settings → Video: Base 1920×1080, Output 1920×1080, 60 fps.
2. Turn on **Performance monitor** (OBS Setup). Leave **Pause off-air sources** off.
3. Let it run for 10 minutes on a typical rotation (Starting soon → Casters → Gameplay with scoreboard → BRB).
4. Record: OBS fps, render time, render lag, encoder skipped, CPU, GPU 3D %, Video Decode %, dedicated GPU memory,
   and the worst rows of the Overdrive performance table (fps, p95, slow frames, video drops).

## 2. Switch to 4K

1. OBS → Settings → Video: **Base (Canvas) 3840×2160**, Output **3840×2160** (run 2a) or **1920×1080** (run 2b, 4K
   graphics with a 1080p stream), **60 fps**.
2. Overdrive OBS Setup → Output **4K UHD 3840×2160** → **Verify OBS Setup**: every Overdrive scene now shows *size
   is 1920×1080, should be 3840×2160*. Nothing has changed in OBS yet.
3. **Repair All** → read the plan (only browser-source sizes change) → Confirm. Verify again: no picture-quality
   findings. Your own sources (game capture, cameras, sponsors) are untouched. Check their position and scale on
   the 4K canvas yourself, because OBS does not rescale existing items when the canvas changes.

## 3. Measurements at 4K (repeat for run 2a and 2b)

| Test | How | Time |
| --- | --- | --- |
| A. Idle, no pausing | Same rotation as the baseline, **Pause off-air sources off** | 10 min |
| B. Idle, pausing on | Same, **Pause off-air sources on**. The table shows which pages are *paused (off air)* | 10 min |
| C. Transitions | Pausing on, OBS Studio Mode: TAKE between every pair of Overdrive scenes, both with the stinger and with a cut. Watch Program for a frozen or blank first frame | 15 min |
| D. Animation artifacts | Run the motion loop (below) on Program and record it in OBS | 10 min |
| E. Soak | A real rehearsal (talent, cameras, game), pausing on, monitor on | 2 h |

Motion loop (nameplates out/in, layout change with tile move and logo sting, desk masks, map card, stinger takes):
```
OD_URL=http://localhost:8787 OD_TOKEN=<Controller → Settings → Integrations token> npx tsx scripts/motion-loop.ts 30
```
Record at 3840×2160 with a high-quality local recording (e.g. CQP 14–16 or lossless). Then step frame by frame through
the nameplates, sting, masks and map card in a video player. Look for: text that turns soft while moving and snaps sharp
when it stops, shimmering edges, stair-stepped mask corners, a one-frame flash or blank at the stinger cut.

If an artifact shows, note the scene and the moment. Then repeat test D with that one source's URL changed to add
`?raster=zoom` (or `&raster=zoom`), the alternative scaling mode. Known side effect of zoom: thin 1-px frame lines can
disappear, so it is a diagnostic, not the default.

Optional deep dive: start OBS with `--remote-debugging-port=9222`, open `chrome://inspect` in Chrome on the same PC, and
record a Performance trace of one browser source during the motion loop.

## 4. Proposed pass thresholds (to discuss after the run)

| Metric | Pass |
| --- | --- |
| OBS active fps | 60, steady |
| OBS render lag (frames missed due to rendering lag) | 0, or under 0.1 % over the soak |
| Encoder skipped frames | 0 |
| Average frame render time (OBS stats) | under 8 ms (half of the 16.7 ms budget at 60 fps) |
| Overdrive page p95 frame time (showing pages) | 20 ms or less |
| Slow frames per 5 s (showing pages) | 2 or fewer |
| Video drops (showing pages) | 0 |
| GPU 3D | under 70 % |
| GPU Video Decode | under 80 % |
| Dedicated GPU memory | at least 1 GB free |
| Artifacts (test D) | none visible at normal speed; none worse than 1 frame stepping through |

## 5. Record sheet

| | 1080p baseline | 4K (2a, 4K out) A | 4K (2a) B | 4K (2b, 1080 out) A | 4K (2b) B | Soak |
| --- | --- | --- | --- | --- | --- | --- |
| OBS fps / render ms | | | | | | |
| Render lag / encoder skipped | | | | | | |
| CPU % | | | | | | |
| GPU 3D % / Video Decode % | | | | | | |
| Dedicated GPU memory used | | | | | | |
| Worst Overdrive page (fps / p95 / slow / drops) | | | | | | |
| Transitions OK (C) | — | | | | | |
| Artifacts seen (D) | — | | | | | |

Send back the sheet, a screenshot of the Overdrive performance panel during the worst moment, and the OBS log
(**Help → Log Files → Show Log Files**, the newest file). Don't use "Upload", which publishes the log.

## 6. Back to 1080p

OBS Setup → Output **1080p** → Repair All → Confirm. OBS → Settings → Video back to 1920×1080. Turn the performance
monitor off. Nothing else changed.

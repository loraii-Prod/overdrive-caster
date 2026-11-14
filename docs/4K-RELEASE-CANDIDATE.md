# Overdrive native 4K: release candidate

Branch `feature/native-4k`, based on `main` (2.2.5, `379d9e1`). Not merged and not deployed. The `audience` branch is
untouched and will need rebasing onto this work before release.

**Status: release candidate, pending external validation on the production PC.** Everything below was tested on
the build machine (headless Chrome with software rendering, and an obs-websocket v5 protocol mock). Real OBS GPU
performance, frame drops and animation smoothness, and production readiness are **not verified**. They need the
production-PC test in `docs/4K-PERF-TEST.md`.

## What's in it

| Area | Result |
| --- | --- |
| Rendering | Every output renders natively at its browser-source size: 3840×2160 = exactly 2 px per unit of the 1920×1080 layout grid, 1920×1080 = 1. Text, SVG and CSS are drawn at device resolution (identical to Chrome's own 2× rendering). Fonts are loaded before the first frame. No scrollbars or margins; transparency kept. |
| 1080p compatibility | 1080p stays the default. The 1080p output is pixel-identical to the build before the upgrade on all 30 scenes. Existing shows, URLs, scenes and automation are unchanged. |
| Scenes | All 30 broadcast scenes validated at 4K (`docs/4K-SCENE-VALIDATION.md`, stills in `docs/4k/`). No scene needed a code change. |
| OBS | Studio → OBS Setup → Output: 4K / 1080p. Build and Repair create sources at the profile size, only after a confirmed plan, never automatically. Verify checks the canvas, output, fps and every Overdrive source against the profile. A 4K canvas with a 1080p stream is supported. OBS camera sources follow a canvas change made while connected (bug fixed). Migration guide: `docs/4K-MIGRATION.md`. |
| Cameras | Per-caster 720p30 (default) or 1080p30 in Studio → Talent → Camera, for both the app camera (switched in place on the live track, no drop) and VDO.Ninja (push link and OBS view bitrate). Local VDO.Ninja handling is unchanged. |
| Assets | 4K replacements drop in at `public/brand/overdrive/4k/` (an SVG can replace a PNG). 4K outputs use them; 1080p keeps the originals. Uploads get 4K size advice per role, never a block. **43 of the 47 bundled assets still limit 4K**: `docs/4K-ASSET-REPORT.md`. Nothing has been upscaled or called 4K. |
| Performance | Optional off-air pausing: OBS reports which sources are showing; hidden pages pause their videos, loops and clocks after 3 s and resume in place (transitions unchanged). The performance monitor shows live page and OBS stats. Live data updates touch only the changed text. Results: `docs/4K-PERF-RESULTS.md`. |

## Tests (all passing)

`bash e2e-rig/4k/run_all.sh` builds and runs everything.

| Suite | Checks |
| --- | --- |
| Unit: engine, OBS setup (+ profiles), dataset, camera quality, 4K assets | 91 · 76 · 25 · 7 · 11 |
| Visual regression vs the original build, 1080p + 4K | 60/60 identical |
| Layout equivalence 4K ↔ 1080p | 30/30 |
| Output basics (size, scale, alpha, scrollbars, fonts, previews) | 11/11 |
| Mid-animation sharpness: nameplates, layout sting, desk masks, map card, stinger | 9/9 |
| Scene validation at 4K | 30/30 |
| Camera quality end to end | 11/11 |
| Re-render on live data | 4/4 |
| Off-air pausing | 16/16 |
| OBS on a 4K canvas | 8/8 |
| 4K asset replacements (real build) | 7/7 |
| Existing: broadcast workflow, camera sync, OBS UI, OBS docks | 23 · 29 · 22 · 21 |

## Pending external validation (production PC)

1. GPU load, VRAM and video decoding of about 20 4K browser sources; OBS render lag and skipped frames at 60 fps.
2. Animation sharpness under GPU rasterisation (nameplates, stingers, match cards, caster masks), using
   `scripts/motion-loop.ts` with a 4K recording.
3. Off-air pausing with your real scene collection, Studio Mode and projectors.
4. A 2-hour rehearsal soak. Then the decision on 4K output vs 4K canvas + 1080p stream.

## Known limits

- Assets without 4K sources stay at their own resolution (videos 1080p, plates 1080p, mark 235×180, team logos
  64×64, map photos 1024²). Original project files are needed.
- Camera feeds are 720p or 1080p, never 4K. Game capture is at its own resolution.
- With a projector or multiview open, OBS reports every scene as showing, so nothing pauses.
- Headless benchmarks cannot measure GPU raster or compositing, the main extra cost of 4K.

## Deploying

Nothing is deployed. Production on Render runs `a9f6a24` (2.2.4) with no persistent disk: any deploy restarts it with an
empty data folder (uploads, show configuration, Wildcard bracket). Before any deploy, take the backup in the `audience`
branch's `docs/BACKUP-AND-ROLLBACK.md` (Render SSH tar of the data folder), deploy the approved commit by hand, check
`/api/version`, then restore. `main`/2.2.5 adds `/api/version` only in `release-2.2.5`. This branch does not include
`/api/version` or the durable storage work on `audience`.

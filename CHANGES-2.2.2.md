# Overdrive 2.2.2: picture-quality audit

I measured every clean OBS output to find out why graphics look soft or pixelated. No design, layout, colour or animation was changed.

## What I measured and found

| Check | Result |
|---|---|
| WebM backgrounds (13 files) | All are real 1920×1080: none is a 720p file stretched to 1080p.<br>The test: a frame shrunk to 1280×720 and scaled back up keeps 37–42 dB, while a genuinely upscaled 720p frame keeps 54 dB.<br>All are VP9 4:2:0 with alpha, 2.1–5.4 Mb/s, 30 fps (the transitions are 60 fps), with a keyframe every 4.27 s. |
| Compression | There is no gross blockiness: at 8 px block edges the image changes only 0.93–1.20× as much as anywhere else.<br>The visible artefact is colour stair-stepping on bright red edges, from 4:2:0 colour subsampling (colour is stored at 960×540). This is baked into the files and re-encoding them cannot recover it. |
| `/g/*` and `/output/*` rendering | Every output draws its 1920×1080 canvas 1:1 at device pixel ratio 1, with no CSS zoom and no page scroll.<br>Checked in Chrome at the browser-source size across all 20 builder outputs. |
| CSS transforms | Nothing is scaled at rest.<br>The only transform with a fractional offset is the scrolling ticker, which is in motion. |
| OBS browser sources made by the Scene Builder | 1920×1080 at 60 fps, drawn 1:1 on a 1920×1080 canvas.<br>Repair/Verify already catch drift on these. |
| Double scaling | Happens only when a browser source is not 1920×1080. Overdrive then shrinks its canvas to fit (1280×720 → 67%, OBS's 800×600 default → 42% and letterboxed), and OBS enlarges it again.<br>Before this change, nothing reported this for sources made by hand. |
| Team logos | **Confirmed source of quality loss.** Every file in `public/brand/overdrive/teams/` is 64×64.<br>The match-intro VS screen and the Champions screen draw them at 230×230, a **3.6× upscale**. Everywhere else they are drawn at 56 px or less. |
| `mark.png` (235×180) | Upscaled 1.16× on the interview screen (drawn 273 px wide). |
| Plates (1920×1080), map photos (1024², drawn 440 px), `logo.png` (756×183) | All at or above native size. |

## Changes
- **OBS Setup → Verify now reports picture-quality problems.** This is read-only: it never writes to OBS. It reports:
  - an OBS base canvas that is not 1920×1080;
  - an OBS output (scaled) resolution below the canvas;
  - every browser source anywhere in OBS that loads an Overdrive picture page but is not 1920×1080 (1920×1480 for `?controls`);
  - every scene item that draws such a source at anything other than 100%.

  The findings appear as a "Picture quality" strip in the OBS Setup tab and as a count in the Verify message.
- **`e2e-rig/quality/gfx_quality_audit.py`** repeats this whole audit (media, images, live rendering). It exits 1 whenever something is upscaled or a canvas is not drawn 1:1.

## Still needed (artwork only, not code)
- **Team logos:** 512×512 transparent PNGs (or at least 256×256), using the same file names in `public/brand/overdrive/teams/`. Once they are in place, the VS and Champions screens are sharp with no code change.
- **`mark.png`:** a version at least 300 px wide.
- **WebMs:** cleaner red edges and more headroom in motion need a re-export from the original project files, not a re-encode of these files. For example: VP9 2-pass, CRF 18–22, 1920×1080, with alpha only where needed. `loop`, `bar` and `screen` are fully opaque.

## Tests
- `tests/obsSetup.test.ts` 67/67
- `tests/engine.test.ts` 91/91
- `e2e-rig/obs/realObs.test.ts` 20/20 against real OBS 30.0.2. The new check reads its real canvas, output and fps.
- `ui_e2e.py` 22/22 and `dock_e2e.py` 21/21
- `tsc` clean

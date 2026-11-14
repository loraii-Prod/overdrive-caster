# 4K performance results (build machine)

> **Pending external validation.** Measured in headless Chrome on the build machine: 2 CPU cores, **no GPU**, software rendering. These numbers show the *relative* cost of 4K vs 1080p and of awake vs paused pages. They do not predict the production PC, whose GPU rasterises and composites. Real OBS GPU usage, frame drops and animation smoothness must be measured on the production PC: `docs/4K-PERF-TEST.md`.

Per page, over 8 s: main-thread busy time (ms per second of wall time; 1000 = one full core) and video frames decoded per second. *Paused* = the page's OBS source is off air with **Pause off-air sources** on (real path: Overdrive server + OBS bridge + OBS protocol mock).

| Page | Size | Awake busy (ms/s) | Awake video (fps) | Paused busy (ms/s) | Paused video (fps) | Paused busy before clock optimisation |
| --- | --- | --- | --- | --- | --- | --- |
| `/output/screen/casters` | 1920×1080 | 24.1 | 30.0 | 0.6 | 0.0 | 7.7 |
| `/output/screen/starting` | 1920×1080 | 24.0 | 30.0 | 0.7 | 0.0 | 5.1 |
| `/output/screen/analysis` | 1920×1080 | 79.9 | 55.2 | 1.0 | 0.7 | 7.9 |
| `/output/screen/gameplay` | 1920×1080 | 6.0 | 0.0 | 0.6 | 0.0 | 4.5 |
| `/g/caster-desk` | 1920×1080 | 37.2 | 30.1 | 0.4 | 0.0 | 7.3 |
| `/output/major` | 1920×1080 | 3.9 | 0.0 | 0.6 | 0.0 | 5.4 |
| `/output/screen/casters` | 3840×2160 | 14.1 | 30.0 | 0.9 | 0.0 | 7.9 |
| `/output/screen/starting` | 3840×2160 | 17.3 | 30.0 | 0.5 | 0.0 | 5.9 |
| `/output/screen/analysis` | 3840×2160 | 40.9 | 29.6 | 1.0 | 0.0 | 11.9 |
| `/output/screen/gameplay` | 3840×2160 | 5.8 | 0.0 | 0.9 | 0.0 | 6.1 |
| `/g/caster-desk` | 3840×2160 | 32.9 | 28.9 | 0.6 | 0.0 | 8.4 |
| `/output/major` | 3840×2160 | 4.5 | 0.0 | 0.5 | 0.0 | 3.2 |

## What this shows

- **Off-air pausing** stops all background-video decoding on pages OBS is not showing (30–60 decoded frames/s → 0) and cuts their main-thread time to about 4 % of an awake page at 4K (sum over the measured pages: 116 → 4 ms/s). With ~20 Overdrive sources and one or two on air, that is most of the browser-source load.
- **Paused pages skip their clock ticks** (they re-rendered 4× a second while nobody saw them). They catch up the instant they wake, before OBS shows a frame: 3–12 ms/s → about 0.5–1 ms/s per paused page (last column = before).
- **Live updates touch only what changed**: a score, a name or the timer changing rewrites 2–10 DOM nodes, nothing else (`e2e-rig/4k/rerender_check.py`).
- **4K vs 1080p on the main thread** is similar: layout and script do not depend on resolution, because the layout is the same logical grid. The extra 4K cost is in rasterising, compositing and video upscaling: GPU work this machine cannot measure. That is exactly what the production-PC test measures (OBS render time, GPU 3D and video decode).
- Headless frame rate with software rendering only (Phase 1): Caster Desk 60 fps at 1080p vs 22 fps at 4K, with half the background-video frames dropped. That is the worst case without a GPU, the reason the production-PC test is required.

Reproduce: `python3 e2e-rig/4k/perf_bench.py --json /tmp/4k/perf-rc.json && python3 e2e-rig/4k/perf_report.py`.

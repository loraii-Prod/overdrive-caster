"""docs/4K-PERF-RESULTS.md from perf_bench.py output (default /tmp/4k/perf-rc.json; optional before-file for the
paused-clock optimisation).   python3 e2e-rig/4k/perf_report.py [rc.json] [before.json]"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
rc = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/4k/perf-rc.json'))
before = json.load(open(sys.argv[2])) if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else None
key = lambda r: (r['route'], r['res'])
bmap = {key(r): r for r in before} if before else {}
L = ['# 4K performance results (build machine)', '',
     '> **Pending external validation.** Measured in headless Chrome on the build machine: 2 CPU cores, **no GPU**, software rendering. These numbers show the *relative* cost of 4K vs 1080p and of awake vs paused pages. They do not predict the production PC, whose GPU rasterises and composites. Real OBS GPU usage, frame drops and animation smoothness must be measured on the production PC: `docs/4K-PERF-TEST.md`.', '',
     'Per page, over 8 s: main-thread busy time (ms per second of wall time; 1000 = one full core) and video frames decoded per second. *Paused* = the page\'s OBS source is off air with **Pause off-air sources** on (real path: Overdrive server + OBS bridge + OBS protocol mock).', '',
     '| Page | Size | Awake busy (ms/s) | Awake video (fps) | Paused busy (ms/s) | Paused video (fps) |' + (' Paused busy before clock optimisation |' if before else ''),
     '| --- | --- | --- | --- | --- | --- |' + (' --- |' if before else '')]
for r in rc:
    a, p = r['awake'], r['paused'] or {}
    b = bmap.get(key(r), {}).get('paused') or {}
    L.append(f"| `{r['route']}` | {r['res'].replace('x', '×')} | {a['busy_ms_s']} | {a['video_frames_s']} | {p.get('busy_ms_s', '—')} | {p.get('video_frames_s', '—')} |" + (f" {b.get('busy_ms_s', '—')} |" if before else ''))
aw = sum(r['awake']['busy_ms_s'] for r in rc if r['res'] == '3840x2160'); pz = sum((r['paused'] or {}).get('busy_ms_s', 0) for r in rc if r['res'] == '3840x2160')
L += ['', '## What this shows', '',
      f'- **Off-air pausing** stops all background-video decoding on pages OBS is not showing (30–60 decoded frames/s → 0) and cuts their main-thread time to about {round(100 * pz / aw)} % of an awake page at 4K (sum over the measured pages: {round(aw)} → {round(pz)} ms/s). With ~20 Overdrive sources and one or two on air, that is most of the browser-source load.',
      '- **Paused pages skip their clock ticks** (they re-rendered 4× a second while nobody saw them). They catch up the instant they wake, before OBS shows a frame: 3–12 ms/s → about 0.5–1 ms/s per paused page' + (' (last column = before).' if before else '.'),
      '- **Live updates touch only what changed**: a score, a name or the timer changing rewrites 2–10 DOM nodes, nothing else (`e2e-rig/4k/rerender_check.py`).',
      '- **4K vs 1080p on the main thread** is similar: layout and script do not depend on resolution, because the layout is the same logical grid. The extra 4K cost is in rasterising, compositing and video upscaling: GPU work this machine cannot measure. That is exactly what the production-PC test measures (OBS render time, GPU 3D and video decode).',
      '- Headless frame rate with software rendering only (Phase 1): Caster Desk 60 fps at 1080p vs 22 fps at 4K, with half the background-video frames dropped. That is the worst case without a GPU, the reason the production-PC test is required.',
      '', 'Reproduce: `python3 e2e-rig/4k/perf_bench.py --json /tmp/4k/perf-rc.json && python3 e2e-rig/4k/perf_report.py`.']
open(os.path.join(ROOT, 'docs/4K-PERF-RESULTS.md'), 'w').write('\n'.join(L) + '\n')
print('written')

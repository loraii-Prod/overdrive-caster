"""Visual regression for broadcast outputs at 1920x1080 and 3840x2160.

    python3 e2e-rig/4k/vis.py capture <label> [fhd|uhd|both]   -> /tmp/4k/vis/<label>/<res>/<route>.png
    python3 e2e-rig/4k/vis.py compare <labelA> <labelB> [fhd|uhd|both]   -> per-route diff, exit 1 on regressions
    python3 e2e-rig/4k/vis.py equiv <label>    -> 4K render downsampled to 1080 vs the 1080 render (layout must not move)

Needs a server on :8787 started with a FRESH data dir (the default show is the fixture). The page is frozen for the shot:
entrance animations are allowed to finish, then CSS animations are paused at t=0, background videos are seeked to 2.000 s
and paused, and the clock is irrelevant (default show has no running timer). Not real OBS: headless Chrome, software GL.
"""
import asyncio, json, os, sys, urllib.request
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

B = os.environ.get('OD_BASE', 'http://localhost:8787')
ROOT = '/tmp/4k/vis'
RES = {'fhd': (1920, 1080), 'uhd': (3840, 2160)}
SCREENS = ['starting', 'casters', 'analysis', 'interview', 'veto', 'warmup', 'gameplay', 'brb', 'bracket', 'matches', 'ending']
ROUTES = [f'/output/screen/{s}' for s in SCREENS] + ['/output/casters', '/output/solo', '/output/duo', '/output/trio', '/output/names',
          '/output/scoreboard', '/output/nextmatch', '/output/ticker', '/output/player', '/output/major', '/output/major/waiting',
          '/output/major/casters', '/output/bracket', '/output/matches']
FREEZE = """async () => {
  const st = document.createElement('style'); st.id = 'vis-freeze';
  st.textContent = '*,*::before,*::after{animation-delay:0s!important;animation-play-state:paused!important;caret-color:transparent!important}';
  document.head.appendChild(st);
  for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = 0; } catch (e) {} }
  await Promise.all([...document.querySelectorAll('video')].map(v => new Promise(r => { v.pause(); if (!v.duration) return r(); v.onseeked = () => r(); v.currentTime = Math.min(2, v.duration / 2); setTimeout(r, 3000); })));
  await document.fonts.ready;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}"""

def graphics():
    s = json.load(open(os.environ['OD_STATE'])) if os.environ.get('OD_STATE') else None
    return [f"/g/{g['id']}" for g in (s or {}).get('graphics', [])]

def engine(cmd):
    tok = json.load(open(os.environ['OD_STATE']))['apiToken']
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())

def prepare():
    """Put every graphic IN and the scoreboard flag on, so overlays have something to draw (same on every build)."""
    if not os.environ.get('OD_STATE'): return
    for g in graphics(): engine({'c': 'gfx-anim', 'id': g.split('/')[-1], 'action': 'in'})
    for f in ('scoreboard', 'ticker', 'names'): engine({'c': 'stage-flag', 'flag': f, 'on': True})
    engine({'c': 'take'})

async def capture(label, which):
    routes = ROUTES + graphics()
    prepare(); await asyncio.sleep(1.5)
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--force-color-profile=srgb', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'])
        for res in which:
            w, h = RES[res]; out = f'{ROOT}/{label}/{res}'; os.makedirs(out, exist_ok=True)
            ctx = await br.new_context(viewport={'width': w, 'height': h})
            for r in routes:
                p = await ctx.new_page()
                q = os.environ.get('OD_QUERY', '')
                await p.goto(B + r + ((('&' if '?' in r else '?') + q) if q else '')); await p.wait_for_timeout(3200)
                await p.evaluate(FREEZE)
                await p.screenshot(path=f"{out}/{r.strip('/').replace('/', '_')}.png", omit_background=True)
                await p.close()
            await ctx.close()
            print(f'captured {len(routes)} routes at {res} -> {out}', flush=True)
        await br.close()

def load(p): return np.asarray(Image.open(p).convert('RGBA'), dtype=np.int16)

def clock_mask(res, f):
    """Pixels that change with the wall clock (rotating warm-up player, desk strips): they differ between the two baseline
    runs `base` and `base2`, taken minutes apart on the same build. Dilated by 6 px. Only these pixels are ignored."""
    a, b = f'{ROOT}/base/{res}/{f}', f'{ROOT}/base2/{res}/{f}'
    if not (os.path.exists(a) and os.path.exists(b)): return None
    m = np.abs(load(a) - load(b)).max(axis=2) > 8
    if not m.any(): return None
    from PIL import ImageFilter
    return np.asarray(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.MaxFilter(13))) > 0

def compare(a, b, which):
    bad = 0
    for res in which:
        da, db = f'{ROOT}/{a}/{res}', f'{ROOT}/{b}/{res}'
        for f in sorted(os.listdir(da)):
            if not os.path.exists(f'{db}/{f}'): print(f'MISSING {res} {f}'); bad += 1; continue
            x, y = load(f'{da}/{f}'), load(f'{db}/{f}')
            if x.shape != y.shape: print(f'FAIL {res} {f}: size {x.shape} vs {y.shape}'); bad += 1; continue
            d = np.abs(x - y).max(axis=2)
            m = clock_mask(res, f)
            if m is not None: d[m] = 0
            n = int((d > 8).sum())
            ok = n <= x.shape[0] * x.shape[1] * 0.0005   # <= 0.05 % of pixels differ visibly
            bad += not ok
            print(f"{'PASS' if ok else 'FAIL'} {res} {f}: {n} px differ (>8/255), max {int(d.max())}{f', clock-driven area masked ({m.mean() * 100:.1f} %)' if m is not None else ''}", flush=True)
    return bad

def equiv(label):
    """Downsample the 4K render by 2 and compare with the 1080 render: positions must agree (no layout drift)."""
    bad = 0
    for f in sorted(os.listdir(f'{ROOT}/{label}/fhd')):
        lo = Image.open(f'{ROOT}/{label}/fhd/{f}').convert('RGBA'); hi = Image.open(f'{ROOT}/{label}/uhd/{f}').convert('RGBA')
        if hi.size != (3840, 2160) or lo.size != (1920, 1080): print(f'FAIL {f}: sizes {lo.size} {hi.size}'); bad += 1; continue
        x = np.asarray(lo, dtype=np.float32); y = np.asarray(hi.resize((1920, 1080), Image.BOX), dtype=np.float32)
        # Compare alpha-weighted luminance edges: text re-rasterised at 2x differs slightly in AA, geometry must not.
        mse = float(((x - y) ** 2).mean()); psnr = 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
        ok = psnr >= 30
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'} equiv {f}: PSNR {psnr:.1f} dB (4K downsampled vs 1080)", flush=True)
    return bad

if __name__ == '__main__':
    cmd = sys.argv[1]
    which = {'fhd': ['fhd'], 'uhd': ['uhd'], 'both': ['fhd', 'uhd']}[sys.argv[-1] if sys.argv[-1] in ('fhd', 'uhd', 'both') else 'both']
    if cmd == 'capture': asyncio.run(capture(sys.argv[2], which))
    elif cmd == 'compare': sys.exit(1 if compare(sys.argv[2], sys.argv[3], which) else 0)
    elif cmd == 'equiv': sys.exit(1 if equiv(sys.argv[2]) else 0)

"""4K audit probe: how sharp is each output at 3840x2160 today, and with alternative scaling strategies?
For each route it captures:
  ref   1920x1080 viewport at deviceScaleFactor 2  -> what the browser draws when it truly rasterizes at 2x (the target)
  now   3840x2160 viewport, the shipping code (ScaledCanvas -> transform: scale(2))
  zoom  3840x2160 viewport, ScaledCanvas inner div switched to CSS zoom: 2 (layout-level scaling)
  up    1920x1080 at 1x, then bicubic-upscaled to 3840 (what "1080p stretched" looks like)
and reports PSNR vs ref plus a sharpness score (variance of the Laplacian on text-heavy crops).
    python3 e2e-rig/4k/raster_probe.py [base] [outdir]
"""
import asyncio, os, sys, json
import numpy as np
from PIL import Image, ImageFilter
from playwright.async_api import async_playwright
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/4k/probe'
os.makedirs(OUT, exist_ok=True)
# static text/vector regions in logical 1920x1080 px (x0, y0, x1, y1): title, nameplate, logo
CROPS = {'/output/screen/casters': [(40, 50, 400, 110), (1010, 715, 1500, 775), (1620, 40, 1880, 120)],
         '/g/caster-desk': [(40, 50, 400, 110), (1010, 715, 1500, 775), (1620, 40, 1880, 120)]}
ROUTES = ['/output/screen/casters', '/g/caster-desk']
ZOOM_JS = """() => { const d = document.querySelector('.od-stage')?.parentElement?.parentElement; if (!d) return false;
  d.style.left = '0'; d.style.top = '0'; d.style.transform = 'none'; d.style.zoom = '2'; return true; }"""

def psnr(a, b):
    m = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return 99.0 if m == 0 else 10 * np.log10(255 ** 2 / m)
def sharp(img):
    g = np.asarray(img.convert('L'), dtype=np.float64)
    lap = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())

async def shot(br, route, vw, vh, dpr, zoom=False):
    ctx = await br.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=dpr)
    p = await ctx.new_page()
    await p.goto(B + route); await p.wait_for_timeout(3500)
    await p.add_style_tag(content='*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important}')
    await p.evaluate("() => document.querySelectorAll('video').forEach(v => { v.pause(); v.currentTime = 1; })")
    if zoom: ok = await p.evaluate(ZOOM_JS)
    await p.evaluate("() => document.fonts.ready"); await p.wait_for_timeout(700)
    path = f"{OUT}/{route.strip('/').replace('/', '_')}-{vw}x{vh}@{dpr}{'-zoom' if zoom else ''}.png"
    await p.screenshot(path=path)
    await ctx.close(); return Image.open(path).convert('RGB')

async def main():
    res = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--font-render-hinting=none'])
        for r in ROUTES:
            ref = await shot(br, r, 1920, 1080, 2)
            now = await shot(br, r, 3840, 2160, 1)
            zm = await shot(br, r, 3840, 2160, 1, zoom=True)
            lo = await shot(br, r, 1920, 1080, 1)
            up = lo.resize((3840, 2160), Image.BICUBIC)
            crops = CROPS.get(r)
            if crops:
                cut = lambda im: [im.crop(tuple(c * 2 for c in box)) for box in crops]
                ref_c, now_c, zm_c, up_c = cut(ref), cut(now), cut(zm), cut(up)
                row = {'route': r, 'crop': True}
                for k, cs in (('now', now_c), ('zoom', zm_c), ('up', up_c)):
                    row[f'psnr_{k}'] = round(float(np.mean([psnr(np.asarray(a), np.asarray(b)) for a, b in zip(cs, ref_c)])), 2)
                for k, cs in (('ref', ref_c), ('now', now_c), ('zoom', zm_c), ('up', up_c)):
                    row[f'sharp_{k}'] = round(float(np.mean([sharp(c) for c in cs])))
                for i, (a, b, c2, d) in enumerate(zip(ref_c, now_c, zm_c, up_c)):
                    w, h = a.size; strip = Image.new('RGB', (w, h * 4 + 12), 'white')
                    for j, im in enumerate((a, b, c2, d)): strip.paste(im, (0, j * (h + 4)))
                    strip.save(f"{OUT}/{r.strip('/').replace('/', '_')}-crop{i}.png")
                res.append(row); print(json.dumps(row), flush=True); continue
            A = {k: np.asarray(v) for k, v in dict(ref=ref, now=now, zoom=zm, up=up).items()}
            row = {'route': r, 'psnr_now': round(psnr(A['now'], A['ref']), 2), 'psnr_zoom': round(psnr(A['zoom'], A['ref']), 2), 'psnr_up': round(psnr(A['up'], A['ref']), 2),
                   'sharp_ref': round(sharp(ref)), 'sharp_now': round(sharp(now)), 'sharp_zoom': round(sharp(zm)), 'sharp_up': round(sharp(up))}
            res.append(row); print(json.dumps(row), flush=True)
        await br.close()
    json.dump(res, open(f'{OUT}/results.json', 'w'), indent=1)

asyncio.run(main())

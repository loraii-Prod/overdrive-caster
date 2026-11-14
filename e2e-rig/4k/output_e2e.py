"""Broadcast output basics at both profiles (headless Chrome, not real OBS):
  - every output route at 3840x2160 and 1920x1080: exact device scale (2 / 1), anchored at 0,0, no scrollbars or margins,
    nothing overflowing the frame, transparent where the scene has no background
  - other sizes (1440p, odd sizes) get an exact fit, centred
  - fonts: the stage stays hidden until the broadcast fonts are loaded (no fallback-font frame), with a 2.5 s cap
  - producer + controller previews stay light on 1080p and 1440p screens: no 4K render, nothing in device scale
    python3 e2e-rig/4k/output_e2e.py   (server on :8787, fresh data dir)
"""
import asyncio, sys, time
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from vis import ROUTES as _R, B, graphics
ROUTES = _R + graphics()
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)

GEO = """() => { const c = document.querySelector('[data-od-canvas]'); const st = c?.firstElementChild; const r = st?.getBoundingClientRect();
  const d = document.documentElement; return { canvas: c?.dataset.odCanvas, scale: c?.dataset.odScale, ready: c?.dataset.odReady, transform: st?.style.transform, left: st?.style.left,
  rect: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], scrollW: d.scrollWidth, scrollH: d.scrollHeight, vw: innerWidth, vh: innerHeight,
  bodyMargin: getComputedStyle(document.body).margin, bg: getComputedStyle(document.body).backgroundColor } }"""

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        for (w, h, k) in [(3840, 2160, '2'), (1920, 1080, '1')]:
            ctx = await br.new_context(viewport={'width': w, 'height': h})
            bads = []; alpha_ok = []
            for r in ROUTES:
                p = await ctx.new_page(); await p.goto(B + r); await p.wait_for_timeout(1800)
                g = await p.evaluate(GEO)
                good = g['canvas'] == f'{w}x{h}' and g['scale'] == k and g['rect'] == [0, 0, w, h] and g['left'] == '0px' and g['scrollW'] == w and g['scrollH'] == h and g['bodyMargin'] == '0px' and g['ready'] == '1'
                if not good: bads.append((r, g))
                if r in ('/output/scoreboard', '/output/names', '/output/ticker', '/output/nextmatch', '/output/player'):
                    png = await p.screenshot(omit_background=True, path='/tmp/4k/alpha.png')
                    a = np.asarray(Image.open('/tmp/4k/alpha.png').convert('RGBA'))[..., 3]
                    alpha_ok.append((r, int(a[0, 0]), int(a[-1, -1]), round(float((a == 0).mean()) * 100)))
                await p.close()
            check(f'{w}×{h}: all {len(ROUTES)} output routes render at exactly {k} device px per unit, anchored at 0,0, no scroll/margins, fonts ready', not bads, str(bads[:2]))
            check(f'{w}×{h}: overlays are transparent outside their graphics (alpha 0 corners)', all(c1 == 0 and c2 == 0 for _, c1, c2, _ in alpha_ok), str(alpha_ok))
            await ctx.close()
        # other sizes: exact fit, centred, never cropped
        for (w, h) in [(2560, 1440), (1366, 768), (3840, 2000)]:
            ctx = await br.new_context(viewport={'width': w, 'height': h}); p = await ctx.new_page(); await p.goto(B + '/output/screen/brb'); await p.wait_for_timeout(1500)
            g = await p.evaluate(GEO); s = min(w / 1920, h / 1080)
            check(f'{w}×{h}: exact fit (scale {s:.3f}), centred, not cropped', abs(float(g['scale']) - round(s, 3)) < 0.002 and g['rect'][2] <= w and g['rect'][3] <= h and abs(g['rect'][0] * 2 + g['rect'][2] - w) <= 2, str(g))
            await ctx.close()
        # fonts gate: hold the woff2 files for 1.5 s; the stage must stay hidden until they are in
        ctx = await br.new_context(viewport={'width': 3840, 'height': 2160}); p = await ctx.new_page()
        async def slow(route): await asyncio.sleep(1.5); await route.continue_()
        await p.route('**/*.woff2', slow)
        t0 = time.time(); await p.goto(B + '/output/screen/brb')
        early = []
        for _ in range(12):
            early.append(await p.evaluate("() => { const c = document.querySelector('[data-od-canvas]'); return c ? [c.dataset.odReady, getComputedStyle(c.firstElementChild).visibility, document.fonts.check('400 20px \"Bebas Neue\"')] : null }"))
            await asyncio.sleep(0.1)
        await p.wait_for_selector("[data-od-ready='1']", timeout=6000); t_ready = time.time() - t0
        fonts = await p.evaluate("() => ['400 20px Inter', '700 20px Sora', '400 20px \"Bebas Neue\"', '600 20px \"Barlow Condensed\"', '800 20px \"WC Montserrat\"'].map(f => document.fonts.check(f))")
        hidden_while_loading = all(e is None or (e[0] == '0' and e[1] == 'hidden') or e[2] for e in early)
        check(f'fonts: stage hidden while the fonts load, shown once they are in ({t_ready:.1f} s)', hidden_while_loading and any(e and e[0] == '0' for e in early) and all(fonts), f'{early[:4]} {fonts}')
        await ctx.close()
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080}); p = await ctx.new_page()
        await p.route('**/*.woff2', lambda route: route.abort())
        t0 = time.time(); await p.goto(B + '/output/screen/brb'); await p.wait_for_selector("[data-od-ready='1']", timeout=6000)
        check(f'fonts: a missing font never keeps the source blank (shown after {time.time() - t0:.1f} s)', time.time() - t0 < 4.5)
        await ctx.close()
        # producer / controller previews on 1080p and 1440p screens
        for (w, h) in [(1920, 1080), (2560, 1440)]:
            ctx = await br.new_context(viewport={'width': w, 'height': h}); p = await ctx.new_page()
            await p.request.post(B + '/api/login', data={'password': 'testpw'})
            await p.goto(B + '/producer'); await p.wait_for_timeout(2500)
            info = await p.evaluate("() => ({ outputs: document.querySelectorAll('[data-od-canvas]').length, maxW: Math.max(0, ...[...document.querySelectorAll('.od-stage')].map(e => e.getBoundingClientRect().width)), scrollW: document.documentElement.scrollWidth })")
            check(f'producer at {w}×{h}: preview is a scaled view (no output-scale canvas, stage drawn ≤ window), page fits', info['outputs'] == 0 and info['maxW'] <= w and info['scrollW'] <= w, str(info))
            await ctx.close()
        await br.close()
    print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

asyncio.run(main())

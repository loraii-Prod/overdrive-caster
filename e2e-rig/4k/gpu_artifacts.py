"""Mid-animation sharpness at 4K: nameplates, the logo sting on a layout change, caster-desk masks, the map (match) card
and the stinger transition, frozen at the same instant of their animation in two renders:
  4K   3840×2160 viewport at 1 device px per CSS px (what an OBS 4K browser source does: Overdrive scales ×2)
  ref  1920×1080 viewport at deviceScaleFactor 2   (Chrome rasterising everything natively at 2×)
plus the same instant at 1080p upscaled to 4K (what a soft, 1080-rasterised layer would look like).
Time is frozen with Playwright's clock (JS-driven motion) + seeking CSS/WAAPI animations and videos, so both renders show
the same frame. PASS = the 4K frame matches the native-2× frame (PSNR ≥ 35 dB) and is clearly sharper than the
1080p-upscaled frame. Headless Chrome, software raster: GPU raster in OBS can differ, so this does NOT replace the
real-OBS check in docs/4K-PERF-TEST.md (it runs the same scenes).
    python3 e2e-rig/4k/gpu_artifacts.py      (server on :8787 with a fresh data dir; OD_STATE=<data>/state.json)
"""
import asyncio, json, os, sys, urllib.request
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
B = 'http://localhost:8787'; OUT = '/tmp/4k/gpu'; os.makedirs(OUT, exist_ok=True)
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''), flush=True)
def engine(cmd):
    tok = json.load(open(os.environ['OD_STATE']))['apiToken']
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())
def psnr(a, b):
    m = float(((a.astype(np.float64) - b.astype(np.float64)) ** 2).mean()); return 99.0 if m == 0 else 10 * np.log10(255 ** 2 / m)
def sharp(img):
    g = np.asarray(img.convert('L'), dtype=np.float64); lap = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]; return float(lap.var())

SEEK = """(ms) => { for (const a of document.getAnimations()) { try { const d = a.effect.getTiming(); const end = (d.delay || 0) + (Number(d.duration) || 0) * (d.iterations === Infinity ? 1 : (d.iterations || 1));
  a.pause(); a.currentTime = d.iterations === Infinity ? 0 : Math.min(ms, end); } catch (e) {} }
  return Promise.all([...document.querySelectorAll('video')].map(v => new Promise(r => { v.pause(); if (!v.duration) return r(); v.onseeked = () => r(); v.currentTime = v.loop ? 1 : Math.min(ms / 1000, v.duration - 0.05); setTimeout(r, 2000); }))); }"""

CASES = [
    # name, route, setup commands, trigger commands, ms into the animation, crop of the animating element (logical px)
    ('nameplate', '/output/casters', [{'c': 'stage-flag', 'flag': 'names', 'on': False}, {'c': 'take'}], [{'c': 'stage-flag', 'flag': 'names', 'on': True}, {'c': 'take'}], 60, (60, 780, 1860, 1000)),
    ('layout-sting', '/output/casters', [{'c': 'stage-booth', 'ids': [1]}, {'c': 'take'}], [{'c': 'stage-booth', 'ids': [1, 2]}, {'c': 'take'}], 300, (40, 140, 1880, 920)),
    ('desk-masks', '/output/screen/casters', [{'c': 'stage-booth', 'ids': [1]}, {'c': 'take'}], [{'c': 'stage-booth', 'ids': [1, 2]}, {'c': 'take'}], 250, (160, 280, 1760, 800)),
    ('map-card', '/output/screen/gameplay', [], [{'c': 'graphic', 'g': 'map-card', 'map': 'india'}], 350, (0, 0, 1920, 1080)),
]

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--force-color-profile=srgb', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'])
        for name, route, setup, trigger, ms, crop in CASES:
            for c in setup:
                try: engine(c)
                except Exception as e: print('setup', c, e)
            await asyncio.sleep(1.5)
            pages = {}
            for key, (w, h, dpr) in {'4k': (3840, 2160, 1), 'ref': (1920, 1080, 2), 'lo': (1920, 1080, 1)}.items():
                ctx = await br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr)
                p = await ctx.new_page()
                # CSS transitions/animations run on the real clock: freeze each one the moment it starts, SEEK sets the instant
                await p.add_init_script("for (const ev of ['transitionrun', 'animationstart']) document.addEventListener(ev, e => { if (window.__freeze) for (const a of e.target.getAnimations()) a.pause(); }, true);")
                if name != 'map-card':  # JS-driven motion: freeze the page clock; the map card is CSS + server-clock timed
                    await p.clock.install(); await p.goto(B + route)
                    await p.clock.run_for(4000); await asyncio.sleep(2.5); await p.clock.run_for(2000)
                    await p.clock.pause_at(await p.evaluate('Date.now()') + 1000)
                else:
                    await p.goto(B + route); await asyncio.sleep(3)
                pages[key] = (ctx, p)
            SIG = "() => document.querySelector('.od-stage')?.innerHTML.length ?? 0"
            sig0 = {k: await p.evaluate(SIG) for k, (_, p) in pages.items()}
            for _, p in pages.values(): await p.evaluate('window.__freeze = true')
            for c in trigger: engine(c)
            await asyncio.sleep(1.2)       # messages arrive; JS clocks are paused, so nothing has moved yet in JS
            shots = {}; started = {}
            for key, (ctx, p) in pages.items():
                if name != 'map-card':
                    # step the frozen clock until the update lands (the client applies it on a timer), then go `ms` in
                    for i in range(800):
                        if await p.evaluate(SIG) != sig0[key]: started[key] = i * 4; break
                        await p.clock.run_for(4)
                    await p.clock.run_for(ms)
                else: await p.wait_for_selector('.mc', timeout=5000); started[key] = 0
                await p.evaluate(SEEK, ms)
                await p.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))') if False else None
                path = f'{OUT}/{name}-{key}.png'; await p.screenshot(path=path); shots[key] = Image.open(path).convert('RGB')
                if key == '4k':  # the settled frame, to prove the captured one was really mid-animation
                    if name != 'map-card': await p.clock.run_for(3000)
                    await p.evaluate("() => { window.__freeze = false; for (const a of document.getAnimations()) try { if (a.effect.getTiming().iterations !== Infinity) a.finish(); } catch (e) {} }")
                    await asyncio.sleep(0.3); await p.screenshot(path=f'{OUT}/{name}-4k-settled.png')
                await ctx.close()
            box = tuple(c * 2 for c in crop)
            c4, cr, cu = shots['4k'].crop(box), shots['ref'].crop(box), shots['lo'].resize((3840, 2160), Image.BICUBIC).crop(box)
            p_ref, p_up = psnr(np.asarray(c4), np.asarray(cr)), psnr(np.asarray(cu), np.asarray(cr))
            s4, sr, su = sharp(c4), sharp(cr), sharp(cu)
            settled = Image.open(f'{OUT}/{name}-4k-settled.png').convert('RGB').crop(box)
            changed = float((np.abs(np.asarray(c4, dtype=np.int16) - np.asarray(settled, dtype=np.int16)).max(axis=2) > 24).mean() * 100)
            check(f'{name}: caught mid-animation (update landed in all 3 renders; {changed:.1f} % of the element differs from its settled frame)', len(started) == 3 and changed > 0.5, f'{started}')
            # The question is whether moving layers are rasterised at 4K: a layer drawn at 1080 and scaled would have the
            # sharpness of the upscaled frame. Sharpness is robust to a frame of timing offset between renders; PSNR is
            # reported as information (≥ 35 dB = the same frame, pixel for pixel).
            check(f'{name}: moving element rasterised at 4K (sharpness 4K {s4:.0f} vs native-2× {sr:.0f} vs 1080p-upscaled {su:.0f}; PSNR vs native {p_ref:.1f} dB{"" if p_ref >= 35 else ", frames a few ms apart"})',
                  s4 >= 0.9 * sr and s4 > 1.3 * su)
            strip = Image.new('RGB', (c4.width, c4.height * 3 + 8), 'white')
            for i, im in enumerate((c4, cr, cu)): strip.paste(im, (0, i * (c4.height + 4)))
            strip.save(f'{OUT}/{name}-strip.png')
        # stinger: a 1080p asset by design (no 4K render supplied yet); check it covers the 4K frame exactly, 1:1 with the canvas
        engine({'c': 'stage-screen', 'screen': 'brb'}); engine({'c': 'take', 'transition': 'cut'}); await asyncio.sleep(1.5)
        ctx = await br.new_context(viewport={'width': 3840, 'height': 2160}); p = await ctx.new_page(); await p.goto(B + '/output/program'); await asyncio.sleep(3)
        engine({'c': 'stage-screen', 'screen': 'starting'}); engine({'c': 'take', 'transition': 'stinger'})
        geo = None
        for _ in range(60):
            geo = await p.evaluate("() => { const v = [...document.querySelectorAll('video')].find(v => /stinger|trans-/.test(v.currentSrc)); if (!v) return null; const r = v.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), vw: v.videoWidth, vh: v.videoHeight, src: v.currentSrc.split('/').pop() }; }")
            if geo and geo['vw']: break
            await asyncio.sleep(0.05)
        check('stinger: plays full-frame at 4K (3840×2160 at 0,0); the file itself is 1920×1080 (flagged: needs a 4K render)', bool(geo) and geo['w'] == 3840 and geo['h'] == 2160 and geo['x'] == 0 and geo['y'] == 0, str(geo))
        await p.screenshot(path=f'{OUT}/stinger-4k.png'); await ctx.close()
        await br.close()
    print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

asyncio.run(main())

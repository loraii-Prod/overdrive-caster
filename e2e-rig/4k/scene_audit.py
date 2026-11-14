"""Phase 2 scene validation: every broadcast scene (30 routes) rendered at 3840x2160 and checked.

Per scene:
  native  4K frame vs Chrome's own 2x rasterisation of the same frozen frame (PSNR; 99 = identical)
  layout  4K frame scaled to 1080 vs the 1080 render (no element moves between profiles)
  text    elements whose text is cut (ellipsis / overflow) at 4K vs at 1080: must be the same set (font metrics at 2x
          must not truncate anything new)
  edges   boxes with a border/background whose edges fall between device pixels at 4K (soft edge risk), informational
  raster  every <img>, CSS background image and <video>: natural size vs the device size it is drawn at; anything
          drawn larger than its pixels (upscaled) is listed for the low-resolution asset report
  fonts   all broadcast faces loaded, stage shown
Writes the 4K stills + report to /tmp/4k/scenes/ and docs/4K-SCENE-VALIDATION.md (with --doc).
    OD_STATE=<data>/state.json python3 e2e-rig/4k/scene_audit.py [--doc]
Headless Chrome (software raster), not real OBS.
"""
import asyncio, json, os, sys
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vis import ROUTES, B, FREEZE, graphics, engine as _engine
def engine(c):
    try: return _engine(c)
    except Exception as e: return {'error': str(e)}
OUT = '/tmp/4k/scenes'; os.makedirs(OUT, exist_ok=True)
DOC = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'docs', '4K-SCENE-VALIDATION.md')

def seed():
    """Realistic, repeatable content: named talent on all seats, a cast match with a score, every graphic in."""
    s = json.load(open(os.environ['OD_STATE']))
    names = ['Alexandra "Lexi" Moreau', 'Jonas Whitfield', 'Kenji Watanabe', 'Priya Raman', 'Mateus Oliveira']
    for i, t in enumerate(s['talent'][:5]):
        engine({'c': 'talent-edit', 'id': t['id'], 'name': names[i]})
        engine({'c': 'seat', 'seat': i + 1, 'talent': t['id']})
    m = next((x for x in (s.get('tournament') or {}).get('matches', []) if x.get('a') and x.get('b')), None)
    if m: engine({'c': 'cast-match', 'id': m['id']})
    for side, n in (('a', 2), ('b', 1)):
        for _ in range(n): engine({'c': 'score', 'side': side, 'delta': 1})
    engine({'c': 'stage-booth', 'ids': [1, 2]}); engine({'c': 'stage-desk', 'analysts': [3, 4]})
    for f in ('scoreboard', 'ticker', 'names'): engine({'c': 'stage-flag', 'flag': f, 'on': True})
    try: engine({'c': 'take'})
    except Exception: pass
    for g in graphics(): engine({'c': 'gfx-anim', 'id': g.split('/')[-1], 'action': 'in'})
    # next-match corner, player spotlight (fixture player), Wildcard teams (Major casters/waiting cards)
    engine({'c': 'op-quick', 'op': {'k': 'next-match', 'patch': {'enabled': True, 'label': 'Grand Final', 'time': '20:30 CET'}}})
    engine({'c': 'op-quick', 'op': {'k': 'spotlight', 'kind': 'player', 'id': 'p-fixture', 'seconds': None}})

# Infinite loops (ticker scroll, pattern drift) frozen 8 s in, so the ticker shows text; everything else as FREEZE.
# Finite (entrance) animations are shown at their end state: the settled scene, as it sits on air.
FREEZE = FREEZE.replace("a.pause(); a.currentTime = 0;", "if (a.effect && a.effect.getTiming().iterations === Infinity) { a.pause(); a.currentTime = 8000; } else { a.finish(); }")

PROBE = """() => {
  const stage = document.querySelector('.od-stage') || document.querySelector('[data-od-canvas] > div');
  const k = Number(document.querySelector('[data-od-canvas]')?.dataset.odScale || 1);
  const vis = e => { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; let o = 1, n = e; while (n && n !== document.body) { o *= Number(getComputedStyle(n).opacity); n = n.parentElement; } return o > 0.05; };
  const label = e => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase());
  const cut = [], soft = [], raster = [];
  for (const e of stage ? stage.querySelectorAll('*') : []) {
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || !vis(e)) continue;
    const cs = getComputedStyle(e);
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (own && (cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis') && (e.scrollWidth > e.clientWidth + 1)) cut.push(e.textContent.trim().slice(0, 40));
    const boxy = cs.borderTopWidth !== '0px' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.width < innerWidth * 0.9);
    if (boxy) { const f = v => Math.abs(v - Math.round(v)) > 0.02; if (f(r.left) || f(r.top) || f(r.right) || f(r.bottom)) soft.push(label(e)); }
    const add = (src, nw, nh) => { if (!nw || !nh) return; const need = Math.max(r.width / nw, r.height / nh); raster.push({ src: src.replace(location.origin, '').slice(0, 120), natural: `${nw}x${nh}`, drawn: `${Math.round(r.width)}x${Math.round(r.height)}`, upscale: Math.round(need * 100) / 100 }); };
    if (e.tagName === 'IMG' && e.complete) add(e.currentSrc || e.src, e.naturalWidth, e.naturalHeight);
    if (e.tagName === 'VIDEO') add(e.currentSrc, e.videoWidth, e.videoHeight);
    const bg = cs.backgroundImage.match(/url\\("?([^")]+)"?\\)/);
    if (bg && !bg[1].startsWith('data:')) { const im = new Image(); im.src = bg[1]; if (im.complete && im.naturalWidth) { const size = cs.backgroundSize; if (size === 'cover' || size === 'contain' || size === '100% 100%' || size === 'auto') add(bg[1], im.naturalWidth, im.naturalHeight); } }
  }
  const faces = ['400 20px Inter', '700 20px Sora', '400 20px "Bebas Neue"', '600 20px "Barlow Condensed"'].every(f => document.fonts.check(f));
  return { k, cut: [...new Set(cut)], soft: [...new Set(soft)], raster, faces, ready: document.querySelector('[data-od-canvas]')?.dataset.odReady };
}"""

def psnr(a, b):
    m = float(((a.astype(np.float64) - b.astype(np.float64)) ** 2).mean()); return 99.0 if m == 0 else 10 * np.log10(255 ** 2 / m)

async def shoot_all(br, route):
    """4K, native-2× reference and 1080, loaded together and frozen at the same instant (clock-driven scenes match)."""
    specs = [(3840, 2160, 1), (1920, 1080, 2), (1920, 1080, 1)]
    ctxs = [await br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=d) for w, h, d in specs]
    pages = [await c.new_page() for c in ctxs]
    await asyncio.gather(*(p.goto(B + route) for p in pages)); await asyncio.sleep(3.2)
    await asyncio.gather(*(p.evaluate(FREEZE) for p in pages))
    out = []
    for (w, h, d), p in zip(specs, pages):
        info = await p.evaluate(PROBE)
        path = f"{OUT}/{route.strip('/').replace('/', '_')}-{w}x{h}@{d}.png"
        await p.screenshot(path=path, omit_background=True); out.append((info, path))
    for c in ctxs: await c.close()
    return out

async def main():
    seed(); await asyncio.sleep(2)
    routes = ROUTES + graphics()
    rows = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--force-color-profile=srgb', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'])
        for r in routes:
            (i4, p4), (ir, pr), (i1, p1) = await shoot_all(br, r)
            a4, ar = np.asarray(Image.open(p4).convert('RGBA')), np.asarray(Image.open(pr).convert('RGBA'))
            native = psnr(a4, ar)
            lo = np.asarray(Image.open(p1).convert('RGBA'), dtype=np.float32); dn = np.asarray(Image.open(p4).convert('RGBA').resize((1920, 1080), Image.BOX), dtype=np.float32)
            layout = psnr(lo, dn)
            up = [x for x in i4['raster'] if x['upscale'] > 1.05]
            row = {'route': r, 'still': os.path.basename(p4), 'native_db': round(native, 1), 'layout_db': round(layout, 1), 'cut4k': i4['cut'], 'cut1080': i1['cut'],
                   'soft': i4['soft'], 'upscaled': up, 'raster': i4['raster'], 'fonts': i4['faces'] and i4['ready'] == '1', 'scale': i4['k']}
            row['pass'] = native >= 40 and layout >= 30 and sorted(i4['cut']) == sorted(i1['cut']) and row['fonts'] and i4['k'] == 2
            rows.append(row)
            print(f"{'PASS' if row['pass'] else 'FAIL'} {r}: native {native:.1f} dB, layout {layout:.1f} dB, cut {len(i4['cut'])}/{len(i1['cut'])}, soft edges {len(i4['soft'])}, upscaled {len(up)}", flush=True)
        await br.close()
    json.dump(rows, open(f'{OUT}/report.json', 'w'), indent=1)
    # contact sheet of the 4K stills
    W, H, cols = 480, 270, 5
    sheet = Image.new('RGB', (cols * (W + 8) + 8, ((len(rows) + cols - 1) // cols) * (H + 30) + 8), (24, 24, 26))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, row in enumerate(rows):
        im = Image.open(f"{OUT}/{row['still']}").convert('RGBA'); bg = Image.new('RGBA', im.size, (40, 40, 44, 255)); bg.alpha_composite(im)
        x, y = 8 + (i % cols) * (W + 8), 8 + (i // cols) * (H + 30)
        sheet.paste(bg.convert('RGB').resize((W, H), Image.LANCZOS), (x, y)); d.text((x, y + H + 6), row['route'], fill=(230, 230, 230))
    sheet.save(f'{OUT}/contact-sheet.png')
    print(f"{sum(r['pass'] for r in rows)}/{len(rows)} scenes pass")
    if '--doc' in sys.argv: write_doc(rows)
    sys.exit(0 if all(r['pass'] for r in rows) else 1)

def write_doc(rows):
    L = ['# 4K scene validation', '', 'Every broadcast scene rendered at 3840×2160 (headless Chrome, software raster, frozen frame, seeded show).',
         'Generated by `e2e-rig/4k/scene_audit.py`. **Not real OBS**: GPU behaviour is pending the production-PC test (`docs/4K-PERF-TEST.md`).', '',
         '- **Native** = 4K frame vs Chrome rasterising the same frame natively at 2× (99 dB = identical pixels).',
         '- **Layout** = 4K frame scaled to 1080 vs the 1080 render (≥ 30 dB = nothing moved; differences are anti-aliasing).',
         '- **Cut text** = text clipped by its box, at 4K / at 1080 (must match).',
         '- **Upscaled** = images or video drawn larger than their own pixels at 4K (see `docs/4K-ASSET-REPORT.md`).', '',
         '| Scene | Result | Native | Layout | Cut text 4K/1080 | Upscaled raster at 4K |', '| --- | --- | --- | --- | --- | --- |']
    for r in rows:
        ups = '; '.join(sorted({f"{x['src'].split('/')[-1]} {x['natural']} ×{x['upscale']}" for x in r['upscaled']}))[:300] or 'none'
        L.append(f"| `{r['route']}` | {'pass' if r['pass'] else '**fail**'} | {r['native_db']} dB | {r['layout_db']} dB | {len(r['cut4k'])}/{len(r['cut1080'])} | {ups} |")
    open(DOC, 'w').write('\n'.join(L) + '\n')

asyncio.run(main())

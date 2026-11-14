"""Draw sizes of transient graphics the static scene audit does not catch (map card pop-up), at 4K.
Writes /tmp/4k/scenes/extra.json for asset_report.py.   (server on :8787 with the fixture; OD_STATE set)"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vis import B, engine
async def main():
    out = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        p = await (await br.new_context(viewport={'width': 3840, 'height': 2160})).new_page()
        await p.goto(B + '/output/screen/gameplay'); await p.wait_for_timeout(2500)
        engine({'c': 'graphic', 'g': 'map-card', 'map': 'india'})
        await p.wait_for_selector('.mc', timeout=5000); await p.wait_for_timeout(1500)
        out += await p.evaluate("() => [...document.querySelectorAll('.mc img')].map(e => { const r = e.getBoundingClientRect(); return { src: e.currentSrc.replace(location.origin, ''), natural: `${e.naturalWidth}x${e.naturalHeight}`, drawn: `${Math.round(r.width)}x${Math.round(r.height)}`, upscale: Math.round(Math.max(r.width / e.naturalWidth, r.height / e.naturalHeight) * 100) / 100, scene: 'map card (gameplay pop-up)' } })")
        await br.close()
    json.dump(out, open('/tmp/4k/scenes/extra.json', 'w'), indent=1); print(out)
asyncio.run(main())

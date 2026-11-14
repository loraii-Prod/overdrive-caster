"""4K replacement support, end to end with a real build: temporary, clearly-labelled TEST replacements are put in
public/brand/overdrive/4k/ (a 3840×2160 BRB plate, an SVG for one team logo, a 4K test loop video), the app is rebuilt,
and the 4K outputs must use them while 1080p outputs keep the original files byte for byte. The test files are always
removed and the app rebuilt afterwards (nothing is left in the repo).
    python3 e2e-rig/4k/replace_e2e.py
"""
import asyncio, json, os, shutil, subprocess, sys, time
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R4 = os.path.join(ROOT, 'public/brand/overdrive/4k')
TEST = ['plate-brb.png', 'teams/big.svg', 'booth-duo.webm']
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def build():
    r = subprocess.run('node scripts/uhd-manifest.mjs && npx vite build >/dev/null 2>&1 && echo built', cwd=ROOT, shell=True, capture_output=True, text=True)
    return r.stdout
def server():
    subprocess.run(['bash', os.path.join(ROOT, 'e2e-rig/4k/fixture.sh'), ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def cleanup():
    for f in TEST:
        p = os.path.join(R4, f)
        if os.path.exists(p): os.remove(p)
        d = os.path.join(ROOT, 'dist/client/brand/overdrive/4k', f)
        if os.path.exists(d): os.remove(d)
    if os.path.isdir(os.path.join(R4, 'teams')) and not os.listdir(os.path.join(R4, 'teams')): os.rmdir(os.path.join(R4, 'teams'))

async def main():
    os.makedirs(os.path.join(R4, 'teams'), exist_ok=True)
    im = Image.new('RGBA', (3840, 2160), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle((600, 900, 3240, 1260), outline=(255, 255, 0, 255), width=12); d.text((700, 1000), 'TEST 4K REPLACEMENT PLATE', fill=(255, 255, 0, 255))
    im.save(os.path.join(R4, 'plate-brb.png'))
    open(os.path.join(R4, 'teams/big.svg'), 'w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="12" fill="#ffd400"/><text x="50" y="58" font-size="22" text-anchor="middle">TEST</text></svg>')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x202020@0.0:s=3840x2160:d=2,format=yuva420p', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '200k', '-deadline', 'realtime', os.path.join(R4, 'booth-duo.webm')], check=True)
    print(build().strip())
    man = open(os.path.join(ROOT, 'shared/uhdAssets.generated.ts')).read()
    check('manifest lists the 3 replacements (extension may differ: SVG for a PNG)', all(k in man for k in ('"plate-brb"', '"teams/big"', '"booth-duo"')), man)
    server()
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        res = {}
        for (w, h) in [(3840, 2160), (1920, 1080)]:
            ctx = await br.new_context(viewport={'width': w, 'height': h})
            got = {}
            for route in ['/output/screen/brb', '/output/screen/bracket', '/output/screen/casters']:
                p = await ctx.new_page(); await p.goto('http://localhost:8787' + route); await p.wait_for_timeout(3000)
                got[route] = await p.evaluate("() => [...document.querySelectorAll('img, video')].map(e => e.currentSrc || e.src).filter(Boolean).map(s => s.replace(location.origin, ''))")
                await p.close()
            res[w] = got; await ctx.close()
        await br.close()
    u, f = res[3840], res[1920]
    check('4K: BRB uses the 4K plate', '/brand/overdrive/4k/plate-brb.png' in u['/output/screen/brb'], u['/output/screen/brb'])
    check('4K: the bracket uses the SVG team logo', '/brand/overdrive/4k/teams/big.svg' in u['/output/screen/bracket'], u['/output/screen/bracket'])
    check('4K: the casters booth frame uses the 4K video', '/brand/overdrive/4k/booth-duo.webm' in u['/output/screen/casters'], u['/output/screen/casters'])
    check('4K: files without a replacement keep the bundled file (background loop, mark)', '/brand/overdrive/loop.webm' in u['/output/screen/bracket'] and '/brand/overdrive/mark.png' in u['/output/screen/casters'])
    check('1080p: nothing changes (original plate, logo, loop)', not any('/4k/' in s for v in f.values() for s in v) and '/brand/overdrive/plate-brb.png' in f['/output/screen/brb'], f)

try: asyncio.run(main())
finally:
    cleanup(); print(build().strip(), '(test replacements removed)')
    man = open(os.path.join(ROOT, 'shared/uhdAssets.generated.ts')).read()
    check('cleanup: no test replacement left, manifest empty again', 'UHD_ASSETS: Record<string, string> = {}' in man, man)
print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

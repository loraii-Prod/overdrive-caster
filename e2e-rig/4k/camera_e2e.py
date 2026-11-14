"""Per-caster camera quality (720p default / 1080p), end to end against a real server + headless Chrome with a fake
camera (no real VDO.Ninja connection: the VDO.Ninja links are checked as URLs, the app's own WebRTC capture for real).
    e2e-rig/4k/fixture.sh && OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/camera_e2e.py
"""
import asyncio, json, os, sys, time, urllib.parse
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vis import B, engine
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def state(): return json.load(open(os.environ['OD_STATE']))
def cmd(c):
    try: return engine(c)
    except Exception as e: return {'error': str(e)}

GUM = """window.__gum = []; const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = c => { window.__gum.push(JSON.parse(JSON.stringify(c))); return orig(c); };"""

async def main():
    s = state(); t1, t2 = s['talent'][0], s['talent'][1]
    check('default: every talent profile asks for 720p', all(t.get('camQuality') == '720p' for t in s['talent']), [t.get('camQuality') for t in s['talent']])
    cmd({'c': 'talent-edit', 'id': t1['id'], 'name': 'Lexi Moreau'}); cmd({'c': 'seat', 'seat': 1, 'talent': t1['id']})
    cmd({'c': 'talent-edit', 'id': t2['id'], 'name': 'Jonas Whitfield', 'mode': 'vdo'}); cmd({'c': 'seat', 'seat': 2, 'talent': t2['id']})
    time.sleep(0.6)
    s = state(); src = {c['id']: c['source'] for c in s['live']['casters']}
    check('720p: seated positions carry no 1080p flag (state unchanged for existing shows)', 'quality' not in src[1] and 'quality' not in src[2], src)
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await br.new_context(viewport={'width': 1280, 'height': 900}, permissions=['camera', 'microphone']); await ctx.add_init_script(GUM)
        pg = await ctx.new_page(); await pg.goto(f"{B}/talent/{t1['id']}?key={urllib.parse.quote(t1['key'])}")
        await pg.wait_for_selector('[data-cam-quality]', timeout=10000)
        check('caster page (app camera) shows the producer setting: 720p', await pg.get_attribute('[data-cam-quality]', 'data-cam-quality') == '720p')
        start = pg.get_by_role('button', name='Start')
        if await start.count(): await start.first.click()
        await pg.wait_for_function('window.__gum.length > 0', timeout=8000)
        g = (await pg.evaluate('window.__gum'))[-1]['video']
        check('720p: captures 1280×720 at 30 fps', g['width']['ideal'] == 1280 and g['height']['ideal'] == 720 and g['frameRate']['ideal'] == 30, g)
        # producer switches the caster to 1080p in Studio: the page re-captures on its own, no new link
        cmd({'c': 'talent-edit', 'id': t1['id'], 'camQuality': '1080p'})
        await pg.wait_for_selector("[data-cam-quality='1080p']", timeout=8000)
        track = None
        for _ in range(40):
            track = await pg.evaluate("() => { const v = document.querySelector('video'); const t = v && v.srcObject && v.srcObject.getVideoTracks()[0]; return t ? t.getSettings() : null }")
            if track and track.get('width') == 1920: break
            await asyncio.sleep(0.2)
        check('1080p: the caster page switches its camera to 1920×1080 by itself (same link, no new link)', bool(track) and track.get('width') == 1920 and track.get('height') == 1080, track)
        check('…in place: the running track is reconfigured, no second camera capture', len(await pg.evaluate('window.__gum')) == 1, await pg.evaluate('window.__gum.length'))
        for _ in range(20):
            s = state(); src = {c['id']: c['source'] for c in s['live']['casters']}
            if src[1].get('quality') == '1080p': break
            await asyncio.sleep(0.25)
        check('1080p: position 1 carries quality 1080p into the show (Preview and Program)', src[1].get('quality') == '1080p' and next(c for c in s['preview']['casters'] if c['id'] == 1)['source'].get('quality') == '1080p', src[1])
        await ctx.close()

        # VDO.Ninja talent: push link and OBS view link follow the setting
        ctx = await br.new_context(viewport={'width': 1280, 'height': 900}); pg = await ctx.new_page()
        await pg.route('https://vdo.ninja/**', lambda r: r.fulfill(status=200, body='<html>vdo stub</html>', content_type='text/html'))
        await pg.goto(f"{B}/talent/{t2['id']}?key={urllib.parse.quote(t2['key'])}"); await pg.wait_for_timeout(2500)
        push = await pg.evaluate("() => [...document.querySelectorAll('iframe')].map(f => f.src).find(s => s.includes('push=')) || ''")
        check('VDO.Ninja 720p: push link asks for 720p (&quality=1)', '&quality=1' in push and 'quality=0' not in push, push[:160])
        cmd({'c': 'talent-edit', 'id': t2['id'], 'camQuality': '1080p'}); await pg.wait_for_timeout(1500)
        push = await pg.evaluate("() => [...document.querySelectorAll('iframe')].map(f => f.src).find(s => s.includes('push=')) || ''")
        check('VDO.Ninja 1080p: push link asks for 1080p30 (&quality=0&maxframerate=30)', '&quality=0&maxframerate=30' in push, push[:160])
        out = await ctx.new_page()
        await out.route('https://vdo.ninja/**', lambda r: r.fulfill(status=200, body='<html>vdo stub</html>', content_type='text/html'))
        await out.goto(f'{B}/output/casters'); await out.wait_for_timeout(2500)
        views = await out.evaluate("() => [...document.querySelectorAll('iframe')].map(f => f.src).filter(s => s.includes('view='))")
        check('OBS output: the 1080p VDO.Ninja caster is viewed at the higher bitrate (&bitrate=6000)', any('&bitrate=6000' in v for v in views), views)
        await ctx.close()
        # Studio: the Camera column switches it, and the copied VDO link carries it
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080}); p = await ctx.new_page()
        await p.request.post(B + '/api/login', data={'password': 'testpw'})
        await p.goto(B + '/producer'); await p.evaluate("localStorage.setItem('od2.mode','studio');localStorage.setItem('od2.studioTab','talent')"); await p.reload()
        row = p.locator(f"[data-talent='{t1['id']}']"); await row.wait_for(timeout=10000)
        await row.get_by_role('button', name='720p').click(); await p.wait_for_timeout(800)
        await p.wait_for_timeout(1500)
        check('Studio → Talent → Camera: switching back to 720p from the table', state()['talent'][0]['camQuality'] == '720p' and 'quality' not in next(c for c in state()['live']['casters'] if c['id'] == 1)['source'])
        await p.screenshot(path='/tmp/4k/studio-camera.png')
        await ctx.close(); await br.close()
    # persistence: survives a restart (sanitizer keeps it)
    print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

asyncio.run(main())

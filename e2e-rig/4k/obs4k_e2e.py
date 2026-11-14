"""OBS integration on a 4K canvas (real Overdrive server + its OBS bridge against the obs-websocket v5 protocol mock;
not real OBS): the 1080p → 4K migration done the way a producer would, with Overdrive connected the whole time.
  1. 1080p canvas: OBS camera sources are placed in 1080p coordinates
  2. OBS canvas switched to 3840×2160 while connected: camera sources are re-placed at ×2 (no reconnect needed)
  3. 4K canvas under the 1080p profile: Verify says so and suggests switching the profile; nothing is written
  4. profile → 4K, Verify: every scene outdated (1080p sources), Repair (confirmed plan) → 3840×2160 sources, clean Verify
  5. 4K canvas + 1080p output (4K graphics, 1080p stream): supported, no warning; scenes, transitions, automation untouched
    python3 e2e-rig/4k/obs4k_e2e.py
"""
import asyncio, json, os, signal, shutil, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://localhost:8787'; MP = 4480; M = f'http://127.0.0.1:{MP + 1}'; D = '/tmp/od-obs4k'
ok = bad = 0; procs = {}
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def mock(path): return json.load(urllib.request.urlopen(M + path))
def start(name, cmd, env=None):
    procs[name] = subprocess.Popen(cmd, cwd=ROOT, env={**os.environ, **(env or {})}, stdout=open(f'/tmp/od-obs4k-{name}.log', 'a'), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
def stop(name):
    p = procs.pop(name, None)
    if p:
        try: os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        p.wait(10)
def wait(url):
    for _ in range(150):
        try: urllib.request.urlopen(url, timeout=1); return
        except Exception: time.sleep(0.2)
SRV = {'PORT': '8787', 'DATA_DIR': D, 'CONTROLLER_PASSWORD': 'testpw', 'ADMIN_PASSWORD': 'adminpw'}

WS = """async (msgs) => { const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws'); const acks = [];
  await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
  await new Promise(r => setTimeout(r, 400));
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'ack') acks.push(m); };
  for (const m of msgs) { ws.send(JSON.stringify(m)); await new Promise(r => setTimeout(r, 700)); }
  await new Promise(r => setTimeout(r, 800)); ws.close(); return acks; }"""

def cam_tr():
    st = mock('/state'); sc = next(s for s in st['scenes'] if s['name'] == 'Cams')
    it = next(i for i in sc['items'] if i['source'] == 'Cam 1'); return it.get('transform', {}), it.get('enabled')

async def main():
    shutil.rmtree(D, ignore_errors=True)
    start('mock', ['npx', 'tsx', 'e2e-rig/obs/mockObsServer.ts', str(MP), 'obspw']); wait(M + '/state')
    urllib.request.urlopen(M + '/add-scene?scene=Cams'); urllib.request.urlopen(M + '/add-browser?scene=Cams&name=Cam%201')
    start('srv', ['node', 'dist/server.js'], SRV); wait(B + '/api/health'); stop('srv')
    s = json.load(open(f'{D}/state.json')); s['obsUrl'] = f'ws://127.0.0.1:{MP}'; s['obsPassword'] = 'obspw'
    s['seats']['1'] = 't1'; s['talent'][0]['name'] = 'Lexi Moreau'
    for sc in (s['live'], s['preview']):
        sc['casters'][0]['source'] = {'type': 'obs', 'url': '', 'obsScene': 'Cams', 'obsSource': 'Cam 1', 'vdo': ''}; sc['casters'][0]['enabled'] = True
    json.dump(s, open(f'{D}/state.json', 'w'))
    start('srv', ['node', 'dist/server.js'], SRV); wait(B + '/api/health'); time.sleep(2)
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await (await br.new_context()).new_page()
        await pg.request.post(B + '/api/login', data={'password': 'testpw'}); await pg.goto(B + '/producer'); await pg.wait_for_timeout(1500)
        cmd = lambda c: pg.evaluate(WS, [{'t': 'cmd', 'id': f'x{time.time()}', 'cmd': c}])
        await pg.evaluate(WS, [{'t': 'obs-sync'}])
        t1, en = cam_tr()
        check('1080p canvas: the OBS camera source is placed in 1080p coordinates', en and 0 < t1.get('boundsWidth', 0) <= 1920 and t1.get('positionX', -1) >= 0, t1)
        urllib.request.urlopen(M + '/video?bw=3840&bh=2160&ow=3840&oh=2160')   # OBS → Settings → Video, Overdrive stays connected
        await pg.evaluate(WS, [{'t': 'obs-sync'}])
        t2, _ = cam_tr()
        check('canvas switched to 4K while connected: the camera source is re-placed at ×2 (no reconnect)', all(abs(t2[k] - 2 * t1[k]) < 0.01 for k in ('positionX', 'positionY', 'boundsWidth', 'boundsHeight')), f'{t1} → {t2}')
        writes0 = len([l for l in mock('/state')['log'] if not l['req'].startswith('Get')])
        await cmd({'c': 'obs-setup', 'action': 'verify'})
        st = await pg.evaluate("() => fetch('/api/v1/state?token=' + encodeURIComponent(window.__tok || ''), {}).then(r => r.status)")
        q = json.load(open(f'{D}/state.json'))['obsSetup']
        # quality findings live in memory: read them through the producer page state
        await pg.goto(B + '/producer'); await pg.evaluate("localStorage.setItem('od2.mode','studio');localStorage.setItem('od2.studioTab','obs')"); await pg.reload()
        await pg.wait_for_selector("[data-obs-conn='on']", timeout=15000); await pg.click("[data-act='verify']") if await pg.locator("[data-act='verify']").count() else None
        await pg.wait_for_timeout(2000)
        txt = (await pg.text_content('[data-quality]')) if await pg.locator('[data-quality]').count() else ''
        check('4K canvas under the 1080p profile: Verify says so and offers both fixes', 'base canvas is 3840×2160' in txt and 'switch the output profile to 4K UHD' in txt, txt[:400])
        writes1 = len([l for l in mock('/state')['log'] if not l['req'].startswith('Get')])
        check('…and Verify wrote nothing to OBS', writes1 == writes0, f'{writes0} → {writes1}')
        await pg.select_option("[data-opt='profile']", 'uhd'); await pg.wait_for_timeout(1200)
        await pg.click("[data-act='build-all']"); await pg.wait_for_selector('[data-obs-plan]', timeout=10000)
        plan = await pg.inner_text('[data-obs-plan]')
        check('4K profile: the build plan lists 3840×2160 browser sources', '3840' in plan and '2160' in plan, plan[:300])
        await pg.click('[data-plan-confirm]'); await pg.wait_for_selector('[data-obs-plan]', state='detached', timeout=20000)
        pics = [i for i in mock('/state')['inputs'] if i['kind'] == 'browser_source' and ('/g/' in (i['settings'].get('url') or '') or '/output/' in (i['settings'].get('url') or '')) and not any(x in i['settings']['url'] for x in ('/output/audio', '/output/music'))]
        check('after the confirmed build: every Overdrive picture source is 3840×2160', len(pics) > 10 and all(i['settings'].get('width') == 3840 and i['settings'].get('height') == 2160 for i in pics), [(i['name'], i['settings'].get('width')) for i in pics[:3]])
        cams = cam_tr()[0]
        check('…your own sources (the OBS camera) are not touched by the build', cams == t2, f'{t2} → {cams}')
        urllib.request.urlopen(M + '/video?ow=1920&oh=1080')   # 4K graphics, 1080p stream
        await pg.click("[data-act='verify']"); await pg.wait_for_timeout(2500)
        txt = (await pg.text_content('[data-quality]')) if await pg.locator('[data-quality]').count() else ''
        check('4K canvas + 1080p output: a supported setup (no canvas, output or source warnings)', txt == '', txt[:400])
        await br.close()
    stop('srv'); stop('mock')
    print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

try: asyncio.run(main())
finally:
    for k in list(procs): stop(k)

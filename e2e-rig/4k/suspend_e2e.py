"""Off-air suspension + performance monitor, end to end: real Overdrive server + its real OBS bridge (obs-websocket-js)
against the obs-websocket v5 protocol mock (Program / Studio-Mode Preview / projector / nested scenes), with output
pages in headless Chrome. Not real OBS.
    python3 e2e-rig/4k/suspend_e2e.py
"""
import asyncio, json, os, signal, shutil, subprocess, sys, time, urllib.parse, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://localhost:8787'; MP = 4470; M = f'http://127.0.0.1:{MP + 1}'; D = '/tmp/od-suspend'
ok = bad = 0; procs = {}
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def mock(path): return json.load(urllib.request.urlopen(M + path))
def start_server():
    procs['srv'] = subprocess.Popen(['node', 'dist/server.js'], cwd=ROOT, env={**os.environ, 'PORT': '8787', 'DATA_DIR': D, 'CONTROLLER_PASSWORD': 'testpw', 'ADMIN_PASSWORD': 'adminpw'}, stdout=open('/tmp/od-suspend.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        try: urllib.request.urlopen(B + '/api/health', timeout=1); return
        except Exception: time.sleep(0.2)
def stop(k):
    p = procs.pop(k, None)
    if p:
        try: os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        p.wait(10)
def start_mock():
    procs['mock'] = subprocess.Popen(['npx', 'tsx', 'e2e-rig/obs/mockObsServer.ts', str(MP), 'obspw'], cwd=ROOT, stdout=open('/tmp/od-suspend-mock.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        try: mock('/state'); return
        except Exception: time.sleep(0.2)

STATE = """() => ({ suspended: document.documentElement.classList.contains('od-suspended'),
  videos: [...document.querySelectorAll('video')].map(v => ({ paused: v.paused, t: v.currentTime, loop: v.loop })),
  anims: document.getAnimations().filter(a => a.effect && a.effect.getTiming().iterations === Infinity).map(a => a.playState),
  canvas: document.querySelector('[data-od-canvas]')?.dataset.odCanvas, scale: document.querySelector('[data-od-canvas]')?.dataset.odScale })"""

async def wait_for(page, cond, timeout=8.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = await page.evaluate(STATE)
        if cond(s): return s, time.time() - t0
        await asyncio.sleep(0.05)
    return await page.evaluate(STATE), None

async def main():
    shutil.rmtree(D, ignore_errors=True)
    start_mock(); start_server(); stop('srv')
    s = json.load(open(f'{D}/state.json')); s['obsUrl'] = f'ws://127.0.0.1:{MP}'; s['obsPassword'] = 'obspw'; json.dump(s, open(f'{D}/state.json', 'w'))
    start_server()
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        ctl = await br.new_context(viewport={'width': 1920, 'height': 1480}); pg = await ctl.new_page()
        await pg.request.post(B + '/api/login', data={'password': 'testpw'})
        await pg.goto(B + '/producer')
        await pg.evaluate("localStorage.clear();localStorage.setItem('od2.mode','studio');localStorage.setItem('od2.studioTab','obs')")
        await pg.reload(); await pg.wait_for_selector("[data-obs-conn='on']", timeout=15000)
        await pg.wait_for_selector('[data-target]', timeout=10000)
        await pg.click("[data-act='build-all']"); await pg.wait_for_selector('[data-obs-plan]')
        await pg.click('[data-plan-confirm]'); await pg.wait_for_selector('[data-obs-plan]', state='detached', timeout=15000)
        st = mock('/state'); names = {i['name']: i for i in st['inputs']}
        brb_scene = next(x['name'] for x in st['scenes'] if any(it['source'] == 'Overdrive · Be right back overlay' for it in x['items']))
        desk_scene = next(x['name'] for x in st['scenes'] if any('g/caster-desk' in it['source'] for it in x['items']))
        desk_input = next(n for n in names if 'g/caster-desk' in n)
        check('setup: OBS scenes built (BRB, Caster Desk)', bool(brb_scene and desk_scene), str(list(names)[:4]))
        urllib.request.urlopen(f'{M}/program?scene={urllib.parse.quote(brb_scene)}')

        out = await br.new_context(viewport={'width': 3840, 'height': 2160})
        brb = await out.new_page(); await brb.goto(B + '/output/screen/brb')
        desk = await out.new_page(); await desk.goto(B + '/g/caster-desk')
        await asyncio.sleep(4)
        a = await brb.evaluate(STATE)
        check('4K output: 3840×2160 source renders at exactly 2 device px per unit', a['canvas'] == '3840x2160' and a['scale'] == '2', a)
        check('feature off by default: nothing is paused', not a['suspended'] and not (await desk.evaluate(STATE))['suspended'] and any(not v['paused'] for v in a['videos']), a)

        # turn it on (and the monitor)
        await pg.click("[data-opt='suspendOffAir']"); await pg.click("[data-opt='perfMonitor']")
        ds, dt = await wait_for(desk, lambda s: s['suspended'], 8)
        check('on: the Caster Desk page (never on air) pauses at once', ds['suspended'] and dt is not None, f'{dt} s {ds}')
        check('…its looping videos are paused and its CSS loops frozen', all(v['paused'] for v in ds['videos'] if v['loop']) and all(x == 'paused' for x in ds['anims']), ds)
        bs = await brb.evaluate(STATE)
        check('…the on-air BRB page keeps playing', not bs['suspended'] and any(not v['paused'] for v in bs['videos']), bs)
        s1 = await desk.screenshot(); await asyncio.sleep(1.2); s2 = await desk.screenshot()
        check('suspended page keeps its last frame (no blank) and produces no new frames', s1 == s2 and len(s1) > 20000)

        # cut to the desk: wakes at once; BRB stays awake for the grace period (the outgoing side of a transition)
        t0 = time.time(); urllib.request.urlopen(f'{M}/program?scene={urllib.parse.quote(desk_scene)}')
        ds, dt = await wait_for(desk, lambda s: not s['suspended'], 3)
        check('cut to Caster Desk: wakes in < 0.5 s (videos resume in place)', dt is not None and dt < 0.5 and any(not v['paused'] for v in ds['videos'] if v['loop']), f'{dt} s')
        await asyncio.sleep(1.0)
        check('…the scene just left stays awake during the transition grace', not (await brb.evaluate(STATE))['suspended'])
        bs, bt = await wait_for(brb, lambda s: s['suspended'], 6)
        check('…and pauses ~3 s after leaving Program', bs['suspended'], f'{bt}')

        # Studio Mode: a scene in Preview is awake before TAKE
        urllib.request.urlopen(f'{M}/preview?scene={urllib.parse.quote(brb_scene)}')
        bs, bt = await wait_for(brb, lambda s: not s['suspended'], 3)
        check('Studio Mode: putting BRB in Preview wakes it before the take', not bs['suspended'] and bt is not None and bt < 0.5, f'{bt}')
        urllib.request.urlopen(f'{M}/studio-off')
        await wait_for(brb, lambda s: s['suspended'], 6)
        # projector keeps a source awake
        urllib.request.urlopen(f"{M}/project?source={urllib.parse.quote('Overdrive · Be right back overlay')}")
        bs, bt = await wait_for(brb, lambda s: not s['suspended'], 3)
        check('a projector showing the source keeps it awake', not bs['suspended'], f'{bt}')
        urllib.request.urlopen(f"{M}/project?source={urllib.parse.quote('Overdrive · Be right back overlay')}&on=0")
        await wait_for(brb, lambda s: s['suspended'], 6)

        # nested: the desk source added inside the BRB scene → showing when BRB is on Program
        # (OBS semantics, mock: an enabled item of a scene in Program is active)
        # monitor: the Studio panel shows OBS stats and one row per output page
        await asyncio.sleep(6)
        txt = await pg.inner_text('[data-perf-panel]')
        check('monitor: OBS stats shown (fps, render time, lag, encoder)', 'OBS 60 fps' in txt and 'render 3.21 ms/frame' in txt and 'render lag 0/36000' in txt, txt[:200])
        rows = await pg.locator('[data-perf-table] tbody tr').count()
        check('monitor: one row per open output page, with size, scale and state', rows >= 2 and '3840×2160' in txt and 'paused (off air)' in txt and 'showing' in txt, txt[:600])
        await pg.screenshot(path='/tmp/4k/perf-panel.png')

        # OBS goes away: everything wakes (never stuck paused)
        stop('mock')
        bs, bt = await wait_for(brb, lambda s: not s['suspended'], 8)
        check('OBS disconnected: suspended pages wake by themselves', not bs['suspended'], f'{bt}')
        start_mock()
        await asyncio.sleep(1)
        # turning the option off wakes everything
        await pg.click("[data-opt='suspendOffAir']"); await pg.click("[data-opt='perfMonitor']")
        await asyncio.sleep(1.5)
        check('option off: nothing paused', not (await brb.evaluate(STATE))['suspended'] and not (await desk.evaluate(STATE))['suspended'])
        # media page is never suspended
        med = await out.new_page(); await med.goto(B + '/output/media')
        await br.close()
    stop('srv'); stop('mock')
    print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

try: asyncio.run(main())
finally:
    for k in list(procs): stop(k)

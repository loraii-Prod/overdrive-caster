"""Rendering cost per scene at 1080p and 4K, awake vs paused off air (real pausing path: Overdrive server + OBS bridge
against the obs-websocket v5 protocol mock). Headless Chrome on THIS machine: software raster, no GPU, so the absolute
numbers are not the production PC's; the comparisons (4K vs 1080p, awake vs paused) are what matters.
Per scene, over 8 s: main-thread busy time per second (CDP TaskDuration), of which script / style / layout, frames
produced (CDP frame counter), video frames decoded.
    python3 e2e-rig/4k/perf_bench.py [--json /tmp/4k/perf.json]
"""
import asyncio, json, os, signal, shutil, subprocess, sys, time, urllib.parse, urllib.request
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://localhost:8787'; MP = 4490; M = f'http://127.0.0.1:{MP + 1}'; D = '/tmp/od-perf'
SCENES = ['/output/screen/casters', '/output/screen/starting', '/output/screen/analysis', '/output/screen/gameplay', '/g/caster-desk', '/output/major']
procs = {}
def start(name, cmd, env=None):
    procs[name] = subprocess.Popen(cmd, cwd=ROOT, env={**os.environ, **(env or {})}, stdout=open(f'/tmp/od-perf-{name}.log', 'a'), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
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

async def measure(page, secs=8):
    cdp = await page.context.new_cdp_session(page); await cdp.send('Performance.enable')
    m0 = {m['name']: m['value'] for m in (await cdp.send('Performance.getMetrics'))['metrics']}
    v0 = await page.evaluate("() => [...document.querySelectorAll('video')].reduce((a, v) => a + (v.getVideoPlaybackQuality?.().totalVideoFrames || 0), 0)")
    t0 = time.time(); await asyncio.sleep(secs); dt = time.time() - t0
    m1 = {m['name']: m['value'] for m in (await cdp.send('Performance.getMetrics'))['metrics']}
    v1 = await page.evaluate("() => [...document.querySelectorAll('video')].reduce((a, v) => a + (v.getVideoPlaybackQuality?.().totalVideoFrames || 0), 0)")
    d = lambda k: (m1.get(k, 0) - m0.get(k, 0))
    return {'busy_ms_s': round(d('TaskDuration') * 1000 / dt, 1), 'script_ms_s': round(d('ScriptDuration') * 1000 / dt, 1), 'style_ms_s': round(d('RecalcStyleDuration') * 1000 / dt, 1),
            'layout_ms_s': round(d('LayoutDuration') * 1000 / dt, 1), 'video_frames_s': round((v1 - v0) / dt, 1)}

def _free_port():
    """Stop any Overdrive server left on :8787 by another test (it would answer our health check)."""
    subprocess.run(['pkill', '-f', 'node dist/' + 'server.js']); time.sleep(1)

async def main():
    _free_port()
    shutil.rmtree(D, ignore_errors=True)
    start('mock', ['npx', 'tsx', 'e2e-rig/obs/mockObsServer.ts', str(MP), 'obspw']); wait(M + '/state')
    start('srv', ['node', 'dist/server.js'], SRV); wait(B + '/api/health'); stop('srv')
    s = json.load(open(f'{D}/state.json')); s['obsUrl'] = f'ws://127.0.0.1:{MP}'; s['obsPassword'] = 'obspw'
    s['obsSetup']['options'].update({'suspendOffAir': True, 'profile': 'uhd', 'legacy': True})  # legacy: screen scenes too
    names = ['Lexi Moreau', 'Jonas Whitfield', 'Kenji Watanabe', 'Priya Raman']
    for i, n in enumerate(names): s['talent'][i]['name'] = n; s['seats'][str(i + 1)] = s['talent'][i]['id']
    json.dump(s, open(f'{D}/state.json', 'w'))
    start('srv', ['node', 'dist/server.js'], SRV); wait(B + '/api/health'); time.sleep(2)
    rows = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        ctl = await (await br.new_context(viewport={'width': 1920, 'height': 1480})).new_page()
        await ctl.request.post(B + '/api/login', data={'password': 'testpw'}); await ctl.goto(B + '/producer')
        await ctl.evaluate("localStorage.setItem('od2.mode','studio');localStorage.setItem('od2.studioTab','obs')"); await ctl.reload()
        await ctl.wait_for_selector("[data-obs-conn='on']", timeout=15000); await ctl.wait_for_selector('[data-target]', timeout=10000)
        await ctl.click("[data-act='build-all']"); await ctl.wait_for_selector('[data-obs-plan]'); await ctl.click('[data-plan-confirm]')
        await ctl.wait_for_selector('[data-obs-plan]', state='detached', timeout=20000)
        st = mock('/state')
        def scene_of(route):
            for sc in st['scenes']:
                for it in sc['items']:
                    inp = next((i for i in st['inputs'] if i['name'] == it['source']), None)
                    if inp and urllib.parse.urlparse(inp['settings'].get('url') or '').path == route: return sc['name']
        for (w, h) in [(1920, 1080), (3840, 2160)]:
            ctx = await br.new_context(viewport={'width': w, 'height': h})
            for r in SCENES:
                sc = scene_of(r)
                if sc: urllib.request.urlopen(f'{M}/program?scene={urllib.parse.quote(sc)}')
                p = await ctx.new_page(); await p.goto(B + r); await p.wait_for_timeout(4000)
                awake = await measure(p)
                # take it off air: Program to another scene → paused after the 3 s grace
                urllib.request.urlopen(f"{M}/program?scene={urllib.parse.quote(scene_of('/output/screen/brb') if r != '/output/screen/brb' else scene_of('/output/screen/ending'))}")
                for _ in range(80):
                    if await p.evaluate("document.documentElement.classList.contains('od-suspended')"): break
                    await asyncio.sleep(0.1)
                paused_ok = await p.evaluate("document.documentElement.classList.contains('od-suspended')")
                await asyncio.sleep(0.5)
                paused = await measure(p)
                rows.append({'route': r, 'res': f'{w}x{h}', 'awake': awake, 'paused': paused if paused_ok else None})
                print(json.dumps(rows[-1]), flush=True)
                await p.close()
            await ctx.close()
        await br.close()
    out = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else '/tmp/4k/perf.json'
    json.dump(rows, open(out, 'w'), indent=1)

def mock(path): return json.load(urllib.request.urlopen(M + path))
if __name__ == '__main__':
    try: asyncio.run(main())
    finally:
        for k in list(procs): stop(k)

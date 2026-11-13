"""Renders the approval animation + stills of the six MVP portrait variants from the REAL graphic (/g/mvp) with the
real vote service, broadcast server, asset storage (S3 stand-in) and test portraits (synthetic, not real people).
Also checks: portraits preloaded before the reveal plays, framing rules (cut-out / framed / fallback), no enlargement
past 1.25x, live portrait replacement without a reload.
    python3 e2e-rig/audience/mvp_render.py      (needs Postgres on :5433, `npm run build`, /tmp/oddata-vq, /tmp/portraits)
"""
import asyncio, json, os, shutil, signal, subprocess, sys, time, urllib.request, http.cookiejar
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V = 'http://localhost:8790'; B = 'http://localhost:8787'; D = '/tmp/oddata-mvp'; OUT = '/tmp/mvp-render'; FR = OUT + '/frames'
SECRET = 'render-secret-0123456789abcdefghij'
S3 = {'R2_ENDPOINT': 'http://127.0.0.1:4572', 'R2_BUCKET': 'overdrive-test', 'R2_ACCESS_KEY_ID': 'S3RVER', 'R2_SECRET_ACCESS_KEY': 'S3RVER'}
ok = bad = 0
def check(n, c, x=''):
    global ok, bad
    ok += bool(c); bad += not c; print(('PASS ' if c else 'FAIL ') + n + (f'  [{x}]' if x and not c else ''), flush=True)
procs = {}
def up(name, args, env, url):
    procs[name] = subprocess.Popen(args, cwd=ROOT, env={**os.environ, **env}, stdout=open(f'/tmp/mvp-{name}.log', 'w'), stderr=subprocess.STDOUT)
    for _ in range(100):
        try: urllib.request.urlopen(url, timeout=1); return
        except urllib.error.HTTPError: return
        except Exception: time.sleep(0.2)
def sql(q, db='vote'): return subprocess.run(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', 'vote', '-d', db, '-tAc', q], capture_output=True, text=True).stdout.strip()
def tok(): return json.load(open(f'{D}/state.json'))['apiToken']
def engine(cmd):
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())
def wcop(op):
    r = urllib.request.Request(f'{B}/api/v1/msg?token={tok()}', data=json.dumps({'t': 'wc', 'op': op}).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())
class Viewer:
    def __init__(self, name):
        self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.post('/auth/dev', {'name': name})
    def post(self, p, b):
        try: return self.o.open(urllib.request.Request(V + p, data=json.dumps(b).encode(), headers={'content-type': 'application/json'}, method='POST')).status
        except urllib.error.HTTPError as e: return e.code
async def ws_op(pg, op):
    return await pg.evaluate("""op => new Promise(res => { const ws = new WebSocket(location.origin.replace('http','ws') + '/ws'); const id = Math.random().toString(36).slice(2);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'aud', id, op })); if (m.t === 'aud-ack' && m.id === id) { ws.close(); res(m.ok ? null : m.error); } };
      setTimeout(() => res('timeout'), 9000); })""", op)
async def priv(pg):
    return await pg.evaluate("""() => new Promise(res => { const ws = new WebSocket(location.origin.replace('http','ws') + '/ws');
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' })); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'aud-private') { ws.close(); res(m.aud); } }; })""")
def publish(patch): engine({'c': 'gfx-set', 'id': 'mvp', 'patch': patch}); return engine({'c': 'gfx-publish', 'id': 'mvp'})

async def upload(pg, path, mime):
    return await pg.evaluate("""async ([b64, mime]) => { const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const r = await fetch('/api/upload?role=portrait', { method: 'POST', headers: { 'Content-Type': mime }, body: b }); return await r.json(); }""", [__import__('base64').b64encode(open(path, 'rb').read()).decode(), mime])

frame_no = 0
async def capture(src, name, step_patch, ms=3400, hold=20, record=True):
    """Publish a step, wait until the reveal may start (portraits preloaded), then step the animations frame by frame."""
    global frame_no
    t0 = time.time()
    publish(step_patch)
    await src.wait_for_function("() => { const e = document.querySelector('.mvx, .mvc'); return e && !e.classList.contains('mvx-wait'); }", timeout=8000)
    waited = time.time() - t0
    await src.evaluate("() => { document.querySelectorAll('video').forEach(v => v.pause()); document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); }")
    imgs_ready = await src.evaluate("() => [...document.querySelectorAll('.mvx-pic img, .mvc-pic img')].every(i => i.complete && i.naturalWidth > 0)")
    if record:
        for t in range(0, ms, 33):
            await src.evaluate(f"() => document.getAnimations().forEach(a => {{ a.currentTime = {t}; }})")
            await src.screenshot(path=f'{FR}/{frame_no:05d}.jpg', type='jpeg', quality=90); frame_no += 1
        for _ in range(hold): await src.screenshot(path=f'{FR}/{frame_no:05d}.jpg', type='jpeg', quality=90); frame_no += 1
    await src.evaluate("() => document.getAnimations().forEach(a => { a.currentTime = 60000; })")
    await src.screenshot(path=f'{OUT}/mvp-{name}.png')
    return waited, imgs_ready

async def main():
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(FR)
    sql('drop table if exists audit, mvp_votes, polls, champion_picks, picks, viewer_sessions, viewers, matches, sessions, meta cascade')
    sql('drop table if exists od_state, od_state_history', 'odstate')
    shutil.rmtree(D, ignore_errors=True); shutil.copytree('/tmp/oddata-vq', D); shutil.rmtree('/tmp/s3-mvp', ignore_errors=True)
    s = json.load(open(f'{D}/state.json')); s.pop('audience', None); s.pop('assets', None)
    for k, m in s['wildcard']['matches'].items(): m.update({'s1': '', 's2': '', 'live': False})
    s['wildcard']['matches']['R1_UB1'].update({'s1': '3', 's2': '1'}); s['wildcard']['cast'] = 'R1_UB1'; s['wildcard']['showcase']['photos'] = {}
    json.dump(s, open(f'{D}/state.json', 'w'))
    procs['s3'] = subprocess.Popen(['node', 'e2e-rig/persist/s3mock.mjs', '4572', '/tmp/s3-mvp'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.5)
    up('vote', ['node', 'dist/vote.js'], {'DATABASE_URL': 'postgres://vote@127.0.0.1:5433/vote', 'VOTE_SECRET': SECRET, 'VOTE_DEV_LOGIN': '1', 'PORT': '8790'}, V + '/healthz')
    up('bcast', ['node', 'dist/server.js'], {'PORT': '8787', 'DATA_DIR': D, 'CONTROLLER_PASSWORD': 'testpw', 'ADMIN_PASSWORD': 'adminpw', 'VOTE_URL': 'http://127.0.0.1:8790', 'VOTE_SECRET': SECRET,
        'VOTE_PUBLIC_URL': 'https://overdrive-vote.onrender.com/vote', 'STATE_DATABASE_URL': 'postgres://vote@127.0.0.1:5433/odstate', **S3}, B + '/api/health')
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        prod = await br.new_page(); await prod.request.post(B + '/api/login', data={'password': 'testpw'}); await prod.goto(B + '/api/session')
        g = await upload(prod, '/tmp/portraits/cutout.png', 'image/png'); m = await upload(prod, '/tmp/portraits/framed.jpg', 'image/jpeg')
        check('test portraits uploaded to storage (transparent cut-out + rectangular photo)', g.get('stored') and g.get('alpha') and m.get('stored') and not m.get('alpha'), (g, m))
        wcop({'k': 'photo', 'player': 'GranaDy', 'url': g['url']}); wcop({'k': 'photo', 'player': 'Massa', 'url': m['url']})
        await asyncio.sleep(3)
        err = await ws_op(prod, {'k': 'mvp-prepare', 'match': 'R1_UB1', 'players': ['Massa', 'GranaDy', 'Heav', 'Nayko']})
        pv = await priv(prod); poll = pv['summary']['polls'][-1]['id']
        await ws_op(prod, {'k': 'mvp-open', 'poll': poll})
        n = 0
        for name, k in (('GranaDy', 27), ('Massa', 16), ('Heav', 10), ('Nayko', 7)):
            for _ in range(k): Viewer(f'r{n:03d}').post('/v1/mvp', {'poll': poll, 'player': name}); n += 1
        await ws_op(prod, {'k': 'mvp-close', 'poll': poll})
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 4, 'player': 'Massa', 'reason': 'Clutch on map 4 decided the series'})
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 5, 'player': 'Massa'})
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 1, 'player': 'GranaDy'})
        await asyncio.sleep(3)
        src = await br.new_page(viewport={'width': 1920, 'height': 1080})
        net = []; src.on('request', lambda r: net.append((time.time(), r.url)))
        publish({'match': 'R1_UB1', 'step': 'voting'}); engine({'c': 'gfx-anim', 'id': 'mvp', 'action': 'in'})
        await src.goto(B + '/g/mvp'); await src.wait_for_timeout(3500)
        await src.screenshot(path=f'{OUT}/mvp-0-voting.png')
        pre = [u for _, u in net if '/uploads/' in u]
        check('preload: both portraits fetched during the voting step, before any reveal', any(g['url'] in u for u in pre) and any(m['url'] in u for u in pre), pre)

        mark = time.time()
        w, ready = await capture(src, '1-community', {'step': 'winner'})
        check('community reveal: no portrait request at reveal time (already preloaded)', not [u for t, u in net if t > mark and '/uploads/' in u])
        check('community reveal: plays at once (portrait ready), image fully decoded', w < 1.0 and ready, (w, ready))
        check('community reveal: transparent portrait drawn as a cut-out', await src.get_attribute('.mvx', 'data-mvp-portrait') == 'cutout')
        check('community reveal: winner GranaDy, 45%, Community MVP', 'GRANADY' in (await src.inner_text('.mvx-name')).upper() and '45%' in await src.inner_text('.mvx-share'))
        await capture(src, '2-analyst', {'step': 'desk'})
        check('analyst reveal: Massa, 2 of 3 analysts, reason line', 'MASSA' in (await src.inner_text('.mvx-name')).upper() and '2 OF 3' in (await src.inner_text('.mvx-quote-by')).upper())
        check('analyst reveal: rectangular photo drawn in the 3:4 frame', await src.get_attribute('.mvx', 'data-mvp-portrait') == 'framed')
        await capture(src, '3-compare', {'step': 'compare'})
        check('comparison (different players): both portraits side by side', await src.locator('.mvc-half').count() == 2 and await src.locator('.mvc-pic img').count() == 2)
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 4, 'player': 'GranaDy'}); await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 5, 'player': 'GranaDy'})
        await asyncio.sleep(0.6)
        publish({'step': 'winner'}); await asyncio.sleep(0.8)
        await capture(src, '4-agree', {'step': 'compare'}, record=True)
        check('comparison (same player): one portrait, both badges, unanimous', await src.locator('.mvx-badge').count() == 2 and 'UNANIMOUS' in (await src.inner_text('.mvx-share')).upper())
        # framed variant on the community reveal: replace GranaDy's portrait live (no reload, no rebuild)
        f2 = await upload(prod, '/tmp/portraits/framed.jpg', 'image/jpeg')
        wcop({'k': 'photo', 'player': 'GranaDy', 'url': f2['url']}); await asyncio.sleep(0.4)
        publish({'step': 'voting'}); await asyncio.sleep(2.5)
        await capture(src, '5-framed', {'step': 'winner'}, record=False)
        check('live replace: the new portrait shows without reloading the source', await src.get_attribute('.mvx', 'data-mvp-portrait') == 'framed' and f2['url'] in await src.get_attribute('.mvx-pic img', 'src'))
        # fallback: an analyst MVP without a portrait
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 4, 'player': 'Heav', 'reason': 'Kept FUT in it on map 3'}); await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 5, 'player': 'Heav'})
        await asyncio.sleep(0.6)
        await capture(src, '6-fallback', {'step': 'desk'}, record=False)
        check('fallback: no portrait → team mark, no empty frame or broken image', await src.get_attribute('.mvx', 'data-mvp-portrait') == 'fallback' and await src.locator('.mvx-pic .mv-fb .logo').count() == 1)
        # low-resolution portrait is not blown up
        lo = await upload(prod, '/tmp/portraits/lowres.png', 'image/png')
        wcop({'k': 'photo', 'player': 'GranaDy', 'url': lo['url']}); await asyncio.sleep(0.4)
        publish({'step': 'voting'}); await asyncio.sleep(2.5)
        await capture(src, '7-lowres-check', {'step': 'winner'}, record=False)
        box = await src.evaluate("() => { const i = document.querySelector('.mvx-pic img'); const r = i.getBoundingClientRect(); return [r.width, r.height, i.naturalWidth, i.naturalHeight]; }")
        check('low-res portrait (300×400) enlarged at most 1.25×', box[0] <= box[2] * 1.25 + 1 and box[1] <= box[3] * 1.25 + 1, box)
        check('output stays native 1920×1080', await src.evaluate('[innerWidth, innerHeight]') == [1920, 1080])
        await br.close()
    for k in list(procs): procs.pop(k).send_signal(signal.SIGTERM)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '30', '-i', f'{FR}/%05d.jpg', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', f'{OUT}/mvp-reveals.mp4'])
    print(f'\n{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

try: asyncio.run(main())
finally:
    for k in list(procs): procs.pop(k).terminate()

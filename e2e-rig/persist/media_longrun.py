"""Media delivery under browser-source conditions: a looping video on /output/media for a long stretch while
storage goes away, the server restarts (deploy-like, data folder wiped) and the page has to reconnect.
Uses headless Chrome with OBS-like flags (autoplay, no user gesture) — NOT real OBS (no obs-browser plugin here).
    python3 e2e-rig/persist/media_longrun.py [seconds_per_phase]
"""
import asyncio, json, os, shutil, subprocess, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import persist_e2e as P
from playwright.async_api import async_playwright
PH = int(sys.argv[1]) if len(sys.argv) > 1 else 30
check = P.check

def webm(path, secs=6):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'testsrc=size=640x360:rate=30:duration={secs}',
                    '-c:v', 'libvpx', '-b:v', '600k', '-deadline', 'realtime', path], check=True)

async def sample(page, secs, log):
    """Sample playback every second; return (#seconds advancing, loops seen, max retries)."""
    adv = loops = 0; last = None; retries = 0
    for _ in range(secs):
        await asyncio.sleep(1)
        st = await page.evaluate("() => { const v = document.querySelector('video'); return v ? {t: v.currentTime, p: !v.paused, e: v.error && v.error.code, r: +v.dataset.mediaRetries || 0, rs: v.readyState} : null }")
        if st:
            if last is not None and st['t'] + 2 < last: loops += 1
            elif last is not None and st['t'] > last + 0.3: adv += 1
            last = st['t']; retries = max(retries, st['r'])
        log.append(st)
    return adv, loops, retries

async def main():
    P.sql('drop table if exists od_state, od_state_history')
    shutil.rmtree(P.D, ignore_errors=True); shutil.rmtree(P.S3DIR, ignore_errors=True)
    P.s3(True); P.start()
    h = P.Http(); h.login()
    f = '/tmp/longrun.webm'; webm(f)
    c, b, _ = h.req('POST', '/api/media', open(f, 'rb').read(), {'X-Filename': 'Loop reel.webm', 'content-type': 'video/webm'})
    items = json.loads(b)['items']; url = items[0]['url']
    check('webm upload stored durably', c == 200 and json.loads(b).get('durable') is True, b[:200])
    P.engine({'c': 'media-set', 'playlist': [url]}); P.engine({'c': 'media-opts', 'auto': True, 'loop': True, 'muted': True})
    # deploy-like: the local copy is gone, only storage has it
    os.remove(f"{P.D}/media/{urllib.parse.unquote(url.split('/')[-1])}")
    P.engine({'c': 'media', 'action': 'play'})
    redirects = []; codes = []
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        page = await br.new_page(viewport={'width': 1920, 'height': 1080})
        page.on('response', lambda r: (codes.append(r.status), redirects.append(r.url) if 300 <= r.status < 400 else None) if '/media/' in r.url else None)
        await page.goto(P.B + '/output/media'); log = []
        adv, loops, _ = await sample(page, PH, log)
        check(f'phase 1 ({PH}s): plays from storage with no local copy, loops', adv + loops >= PH - 2 and loops >= PH // 7, (adv, loops, log[-3:]))
        P.s3(False)
        adv, loops, _ = await sample(page, PH, log)
        check(f'phase 2 ({PH}s): storage DOWN — keeps playing and looping (served from the disk cache)', adv + loops >= PH - 2 and loops >= 1, (adv, loops, log[-3:]))
        P.s3(True)
        # server restart with a wiped data folder (state comes back from Postgres, media from storage)
        P.stop(); shutil.rmtree(f'{P.D}/media', ignore_errors=True); P.start()
        await asyncio.sleep(6)
        md = P.state()['media']
        gone = await page.evaluate("() => !document.querySelector('video')")
        check('phase 3: after a restart/deploy nothing re-airs by itself (stopped), playlist + loop setting kept', gone and md['status'] == 'stopped' and md['playlist'] == [url] and md['loop'] is True, (gone, md))
        P.engine({'c': 'media', 'action': 'play'})
        adv, loops, retries = await sample(page, PH, log)
        check(f'phase 3 ({PH}s): operator presses Play — same browser source (no OBS refresh) plays again from storage', adv + loops >= PH - 4, (adv, loops, log[-5:]))
        # server gone for 20 s (a slow deploy) while the page is open, back, Play again
        P.stop(); await asyncio.sleep(20); P.start(); await asyncio.sleep(4)
        P.engine({'c': 'media', 'action': 'play'})
        adv, loops, retries = await sample(page, PH, log)
        check(f'phase 4 ({PH}s): 20 s server outage — page reconnects on its own, plays after Play', adv + loops >= PH - 4, (adv, loops, log[-5:]))
        # network blip while playing: the server stays up but the video request breaks (abort mid-stream)
        await page.route('**/media/**', lambda r: r.abort())
        await page.evaluate("() => { const v = document.querySelector('video'); v.src = v.src; }")
        await asyncio.sleep(4); await page.unroute('**/media/**')
        adv, loops, retries = await sample(page, PH, log)
        check(f'phase 5 ({PH}s): broken video request — the player retries with backoff and recovers, re-synced', adv + loops >= PH - 8 and retries >= 1, (adv, loops, retries, log[-5:]))
        st = await page.evaluate("() => { const v = document.querySelector('video'); return v ? {err: v.error && v.error.code, paused: v.paused} : {err: 'no video element', paused: true} }")
        check('end: no media error left on the element, still playing', not st['err'] and not st['paused'], st)
        check('no redirects to signed storage links (nothing can expire mid-show)', not redirects, redirects[:3])
        check('media served with byte ranges (206) as browsers/OBS expect', 206 in codes, sorted(set(codes)))
        await br.close()
    P.stop(); P.s3(False)
    print(f'{P.ok} passed, {P.bad} failed'); sys.exit(1 if P.bad else 0)

asyncio.run(main())

"""Caster camera vs frame synchronisation, measured on every rendered frame (requestAnimationFrame) of /g/caster-desk
with LIVE camera video (Chrome fake camera published through the talent pages, real WebRTC to the source).

  python3 e2e-rig/cams/camsync.py [label]       (server on :8787 with a fresh DATA_DIR=/tmp/oddata)

For each layout change it reports, per camera that stays on screen:
  - when the camera reaches 50 % / 95 % of its move, vs when the new frame video reaches 50 % / 95 % opacity
  - the largest gap between the camera edges and the hole of the frame that is currently dominant (> 50 % opacity)
  - remounts (video element replaced), black/frozen video, camera opacity dips
and saves a screencast frame sequence (/tmp/cam/<label>_<transition>_###.jpg).
"""
import asyncio, base64, io, json, os, sys, time, urllib.request
from playwright.async_api import async_playwright

B = 'http://localhost:8787'
LABEL = sys.argv[1] if len(sys.argv) > 1 else 'run'
OUT = '/tmp/cam'; os.makedirs(OUT, exist_ok=True)
HOLES = {'solo': [(427, 207, 1067, 600)], 'duo': [(177, 308, 730, 408), (1013, 308, 730, 408)], 'trio': [(73, 309, 564, 407), (678, 309, 564, 407), (1283, 309, 564, 407)]}
N = {'solo': 1, 'duo': 2, 'trio': 3}

def tok(): return json.load(open('/tmp/oddata/state.json'))['apiToken']
def send(cmd):
    req = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    try: return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())

SAMPLER = r"""() => {
  window.__s = []; window.__tag = 0;
  const tick = () => {
    const now = performance.now();
    const cams = [...document.querySelectorAll('[data-cam]')].map(el => {
      const r = el.getBoundingClientRect(), v = el.querySelector('video'), cs = getComputedStyle(el);
      if (v && !v.__t) v.__t = ++window.__tag;
      let vr = null; if (v) { const b = v.getBoundingClientRect(); vr = [b.x, b.y, b.width, b.height]; }
      return { id: el.getAttribute('data-cam'), r: [r.x, r.y, r.width, r.height], op: +cs.opacity, v: v ? v.__t : 0, vr, ready: v ? v.readyState : -1, ct: v ? v.currentTime : 0 };
    });
    const frames = [...document.querySelectorAll('[data-booth] video')].filter(v => !v.closest('[data-cam]')).map(v => ({ src: (v.currentSrc || v.src).split('/').pop(), op: +getComputedStyle(v).opacity * +getComputedStyle(v.parentElement).opacity }));
    window.__s.push({ t: now, booth: document.querySelector('[data-booth]')?.getAttribute('data-booth'), cams, frames });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""

def lerp_frac(a, b, x):
    d = b - a
    return 1.0 if abs(d) < 0.5 else (x - a) / d

def analyse(samples, t_cmd, frm, to):
    seg = [s for s in samples if t_cmd - 50 <= s['t'] <= t_cmd + 1800]
    if not seg: return None
    FR = {'solo': 'desk-solo.webm', 'duo': 'booth-duo.webm', 'trio': 'booth-trio.webm'}
    frame_to = FR[to]
    def fop(s, name): return max([f['op'] for f in s['frames'] if f['src'] == name] or [0])
    t50f = next((s['t'] for s in seg if fop(s, frame_to) >= 0.5), None)
    t95f = next((s['t'] for s in seg if fop(s, frame_to) >= 0.95), None)
    t_start = next((s['t'] for s in seg if s['booth'] == to), None)  # the staged switch (frame decoded) happened
    live = max(sum(1 for c in s['cams'] if c['ready'] >= 2) for s in seg)
    res = {'live_videos': live, 'transition': f'{frm}->{to}', 'frame_50_ms': round(t50f - t_cmd) if t50f else None, 'frame_95_ms': round(t95f - t_cmd) if t95f else None, 'switch_ms': round(t_start - t_cmd) if t_start else None, 'cams': []}
    ids_end = [c['id'] for c in seg[-1]['cams']]
    for i, cid in enumerate(ids_end[:N[to]]):
        track = [(s['t'], next((c for c in s['cams'] if c['id'] == cid), None), s) for s in seg]
        track = [(t, c, s) for t, c, s in track if c]
        if not track: continue
        x0 = track[0][1]['r'][0]; x1 = HOLES[to][i][0]; w0 = track[0][1]['r'][2]; w1 = HOLES[to][i][2]
        moved = abs(x1 - x0) > 1 or abs(w1 - w0) > 1
        def reach(f):
            for t, c, _ in track:
                fx = lerp_frac(x0, x1, c['r'][0]); fw = lerp_frac(w0, w1, c['r'][2])
                if min(fx, fw) >= f: return round(t - t_cmd)
            return None
        # misalignment vs the dominant frame's hole (the hole the viewer sees)
        worst = 0; worst_t = None
        for t, c, s in track:
            dom = frm if fop(s, FR[frm]) > fop(s, frame_to) else to
            holes = HOLES[dom]
            j = i if dom == to else min(i, len(holes) - 1)
            if j >= len(holes): continue
            hx, hy, hw, hh = holes[j]
            x, y, w, h = c['r']
            gap = max(abs(x - hx), abs(y - hy), abs(x + w - hx - hw), abs(y + h - hy - hh))
            if gap > worst: worst, worst_t = gap, round(t - t_cmd)
        vids = {c['v'] for _, c, _ in track}
        ready_min = min(c['ready'] for _, c, _ in track)
        op_min = min(c['op'] for _, c, _ in track)
        cts = [c['ct'] for _, c, _ in track]
        res['cams'].append({'cam': cid, 'moved': moved, 'cam_50_ms': reach(0.5) if moved else 0, 'cam_95_ms': reach(0.95) if moved else 0,
                            'worst_gap_px': round(worst), 'worst_at_ms': worst_t, 'video_elements': len(vids), 'min_readyState': ready_min, 'min_opacity': round(op_min, 2),
                            'video_advanced_s': round(cts[-1] - cts[0], 2) if cts else 0})
    return res

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
        st = json.load(open('/tmp/oddata/state.json'))
        for seat, tid in ((1, 't1'), (2, 't2'), (3, 't3')): send({'c': 'seat', 'seat': seat, 'talent': tid})
        for tid in ('t1', 't2', 't3'):
            prof = next(x for x in st['talent'] if x['id'] == tid)
            tp = await ctx.new_page(); await tp.goto(f"{B}/talent/{tid}?key={prof['key']}"); await tp.wait_for_timeout(1200)
            b = tp.get_by_role('button', name='Start camera')
            if await b.count(): await b.first.click()
        send({'c': 'gfx-set', 'id': 'caster-desk', 'patch': {'layout': 'solo'}}); send({'c': 'gfx-publish', 'id': 'caster-desk'})
        pg = await ctx.new_page(); await pg.goto(f'{B}/g/caster-desk'); await pg.wait_for_timeout(5000)
        live = await pg.evaluate("[...document.querySelectorAll('[data-cam] video')].filter(v=>v.srcObject&&v.readyState>=2).length")
        print('live camera videos at start:', live)
        await pg.evaluate(SAMPLER)
        cdp = await ctx.new_cdp_session(pg); shots = []
        def on(f):
            shots.append((time.time(), f['data'])); asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': f['sessionId']}))
        cdp.on('Page.screencastFrame', on)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 80, 'maxWidth': 960, 'maxHeight': 540, 'everyNthFrame': 1})
        seq = ['duo', 'solo', 'trio', 'duo', 'trio', 'solo']
        cur = 'solo'; marks = []
        await pg.wait_for_timeout(800)
        for to in seq:
            t_wall = time.time(); t_perf = await pg.evaluate('performance.now()')
            send({'c': 'gfx-set', 'id': 'caster-desk', 'patch': {'layout': to}}); send({'c': 'gfx-publish', 'id': 'caster-desk'})
            marks.append((cur, to, t_perf, t_wall)); cur = to
            await pg.wait_for_timeout(2200)
        await cdp.send('Page.stopScreencast')
        samples = await pg.evaluate('window.__s')
        cfg = json.load(open('/tmp/oddata/state.json'))
        tr = next(g for g in cfg['graphics'] if g['id'] == 'caster-desk')['config']
        print('caster-desk transition:', {k: tr.get(k) for k in ('transition', 'transitionMs', 'ms') if k in tr})
        dts = [b['t'] - a['t'] for a, b in zip(samples, samples[1:])]
        print(f'samples: {len(samples)}, median frame interval {sorted(dts)[len(dts)//2]:.1f} ms, worst {max(dts):.1f} ms')
        report = []; checks = []
        frame_ms = sorted(dts)[len(dts)//2]
        for frm, to, tp, tw in marks:
            r = analyse(samples, tp, frm, to); report.append(r); print(json.dumps(r))
            mv = [c for c in r['cams'] if c['moved'] and c['min_opacity'] > 0.5]
            ent = [c for c in r['cams'] if c['min_opacity'] <= 0.5]
            checks.append((f'{frm}->{to}: moving cameras reach 50 %/95 % with the frame video (within one frame)', all(abs(c['cam_50_ms'] - r['frame_50_ms']) <= frame_ms + 1 and abs(c['cam_95_ms'] - r['frame_95_ms']) <= frame_ms + 1 for c in mv)))
            checks.append((f'{frm}->{to}: every camera keeps one video element (no remount / reconnect)', all(c['video_elements'] == 1 for c in r['cams'])))
            checks.append((f'{frm}->{to}: every camera on screen has live video throughout (no black)', all(c['min_readyState'] >= 2 for c in r['cams'])))
            checks.append((f'{frm}->{to}: moving cameras never fade or flash (opacity stays 1)', all(c['min_opacity'] >= 0.99 for c in mv)))
            # save the screencast frames of this transition
            k = 0
            for ts, d in shots:
                if tw - 0.05 <= ts <= tw + 1.6:
                    open(f'{OUT}/{LABEL}_{frm}-{to}_{k:03d}.jpg', 'wb').write(base64.b64decode(d)); k += 1
        # ---- camera on/off and caster-profile switch (in duo): other cameras keep their video element and stream
        send({'c': 'gfx-set', 'id': 'caster-desk', 'patch': {'layout': 'duo'}}); send({'c': 'gfx-publish', 'id': 'caster-desk'}); await pg.wait_for_timeout(1500)
        tags = lambda: pg.evaluate("Object.fromEntries([...document.querySelectorAll('[data-cam]')].map(e=>{const v=e.querySelector('video');return [e.dataset.cam,{on:e.dataset.camOn,tag:v?v.__t||0:0,rs:v?v.readyState:-1}]}))")
        t0 = await tags()
        send({'c': 'camera', 'seat': 2, 'on': False}); send({'c': 'take', 'transition': 'cut'}); await pg.wait_for_timeout(1500)
        t1 = await tags()
        checks.append(('camera 2 off: camera 1 keeps its video element and stream', t1['1']['tag'] == t0['1']['tag'] and t1['1']['rs'] >= 2))
        checks.append(('camera 2 off: its window stays in place (layout unchanged)', t1.get('2', {}).get('on') == '1'))
        send({'c': 'camera', 'seat': 2, 'on': True}); send({'c': 'take', 'transition': 'cut'}); await pg.wait_for_timeout(2500)
        t2 = await tags()
        checks.append(('camera 2 on again: live video back, camera 1 untouched', t2['2']['rs'] >= 2 and t2['1']['tag'] == t0['1']['tag']))
        send({'c': 'seat', 'seat': 2, 'talent': 't4'}); await pg.wait_for_timeout(1500)
        t3 = await tags()
        checks.append(('profile switch on seat 2 (t2 -> t4): camera 1 untouched', t3['1']['tag'] == t0['1']['tag'] and t3['1']['rs'] >= 2))
        send({'c': 'seat', 'seat': 2, 'talent': 't2'}); await pg.wait_for_timeout(2500)
        t4 = await tags()
        checks.append(('profile switched back: seat 2 live again', t4['2']['rs'] >= 2))
        json.dump({'report': report, 'samples': samples, 'marks': marks}, open(f'{OUT}/{LABEL}.json', 'w'))
        await br.close()
        bad = 0
        for name, okk in checks:
            print(('PASS ' if okk else 'FAIL ') + name); bad += 0 if okk else 1
        print(f'\n{len(checks) - bad} passed, {bad} failed')
        sys.exit(1 if bad else 0)

asyncio.run(main())

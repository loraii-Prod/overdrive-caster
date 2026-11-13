"""Analyst desk camera vs frame sync (/g/analyst-desk), same method as camsync.py: rAF sampling of every camera
element and every background/frame video. Switches: cameras <-> panel (h2h), 2 analysts -> 1 -> 2.
Server on :8787 with DATA_DIR=/tmp/oddata.   python3 e2e-rig/cams/desksync.py <label>
"""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
B = 'http://localhost:8787'; LABEL = sys.argv[1] if len(sys.argv) > 1 else 'run'
def tok(): return json.load(open('/tmp/oddata/state.json'))['apiToken']
def send(cmd):
    req = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    try: return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())

SAMPLER = r"""() => {
  window.__s = []; window.__tag = 0;
  const tick = () => {
    const cams = [...document.querySelectorAll('[data-cam]')].map(el => {
      const r = el.getBoundingClientRect(), v = el.querySelector('video'); if (v && !v.__t) v.__t = ++window.__tag;
      return { id: el.dataset.cam, r: [r.x, r.y, r.width, r.height], op: +getComputedStyle(el).opacity, v: v ? v.__t : 0, ready: v ? v.readyState : -1 };
    });
    const vids = [...document.querySelectorAll('video')].filter(v => !v.closest('[data-cam]')).map(v => {
      let o = 1, e = v; while (e && e !== document.body) { o *= +getComputedStyle(e).opacity; e = e.parentElement; }
      return { src: (v.currentSrc || v.src).split('/').pop(), op: o };
    });
    window.__s.push({ t: performance.now(), mode: document.querySelector('[data-desk-mode]')?.dataset.deskMode, kind: document.querySelector('[data-desk-kind]')?.dataset.deskKind, cams, vids });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""

def analyse(seg, t0, label):
    end = seg[-1]
    # the incoming video = the one whose opacity rises the most over the window
    srcs = {v['src'] for s in seg for v in s['vids']}
    op = lambda s, src: max([v['op'] for v in s['vids'] if v['src'] == src] or [0])
    rise = {src: op(end, src) - op(seg[0], src) for src in srcs}
    inc = max(rise, key=rise.get) if rise and max(rise.values()) > 0.3 else None
    fall = min(rise, key=rise.get) if rise and min(rise.values()) < -0.3 else None
    # the desk frame video is what the viewer sees move (the bar loop appears at once underneath it)
    frames = [x for x in (inc, fall) if x and x.startswith('desk-')]
    lead = frames[0] if frames else (inc or fall)
    def vt(f):
        if not lead: return None
        a, b = op(seg[0], lead), op(end, lead)
        return next((round(s['t'] - t0) for s in seg if abs(op(s, lead) - a) >= f * abs(b - a)), None)
    r = {'switch': label, 'frame_video': lead, 'frame_50_ms': vt(0.5), 'frame_95_ms': vt(0.95), 'cams': []}
    for c_end in end['cams']:
        tr = [(s['t'], next((c for c in s['cams'] if c['id'] == c_end['id']), None)) for s in seg]
        tr = [(t, c) for t, c in tr if c]
        x0, w0 = tr[0][1]['r'][0], tr[0][1]['r'][2]; x1, w1 = c_end['r'][0], c_end['r'][2]
        moved = abs(x1 - x0) > 1 or abs(w1 - w0) > 1
        def reach(f):
            for t, c in tr:
                fx = 1 if abs(x1 - x0) < 1 else (c['r'][0] - x0) / (x1 - x0); fw = 1 if abs(w1 - w0) < 1 else (c['r'][2] - w0) / (w1 - w0)
                if min(fx, fw) >= f: return round(t - t0)
        r['cams'].append({'cam': c_end['id'], 'moved': moved, 'present_from_start': tr[0][0] <= seg[0]['t'] + 1, 'cam_50_ms': reach(0.5) if moved else 0, 'cam_95_ms': reach(0.95) if moved else 0,
                          'video_elements': len({c['v'] for _, c in tr}), 'min_ready': min(c['ready'] for _, c in tr), 'min_op': round(min(c['op'] for _, c in tr), 2), 'end_op': c_end['op']})
    return r

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
        st = json.load(open('/tmp/oddata/state.json'))
        for seat, tid in ((4, 't4'), (5, 't5')): send({'c': 'seat', 'seat': seat, 'talent': tid})
        for tid in ('t4', 't5'):
            prof = next(x for x in st['talent'] if x['id'] == tid)
            tp = await ctx.new_page(); await tp.goto(f"{B}/talent/{tid}?key={prof['key']}"); await tp.wait_for_timeout(1200)
            b = tp.get_by_role('button', name='Start camera')
            if await b.count(): await b.first.click()
        G = lambda patch: (send({'c': 'gfx-set', 'id': 'analyst-desk', 'patch': patch}), send({'c': 'gfx-publish', 'id': 'analyst-desk'}))
        G({'layout': 'duo', 'panel': 'cams'})
        pg = await ctx.new_page(); await pg.goto(f'{B}/g/analyst-desk'); await pg.wait_for_timeout(6000)
        await pg.evaluate(SAMPLER)
        steps = [('cams->panel', {'panel': 'h2h'}), ('panel->cams', {'panel': 'cams'}), ('duo->solo', {'layout': 'solo'}), ('solo->duo', {'layout': 'duo'}),
                 ('solo cams->panel', None)]
        steps = steps[:4] + [('duo->solo (panel)', {'layout': 'solo', 'panel': 'h2h'}), ('solo->duo (panel)', {'layout': 'duo'}), ('panel->cams duo', {'panel': 'cams'})]
        marks = []
        for label, patch in steps:
            send({'c': 'gfx-set', 'id': 'analyst-desk', 'patch': patch})
            t0 = await pg.evaluate('performance.now()'); print(label, send({'c': 'gfx-publish', 'id': 'analyst-desk'}).get('ok'))
            marks.append((label, t0)); await pg.wait_for_timeout(2600)
        samples = await pg.evaluate('window.__s')
        checks = []
        for label, t0 in marks:
            seg = [s for s in samples if t0 - 30 <= s['t'] <= t0 + 2200]
            r = analyse(seg, t0, label); print(json.dumps(r))
            mv = [c for c in r['cams'] if c['moved'] and c['present_from_start'] and c['end_op'] > 0.5]
            if r['frame_50_ms'] is not None:
                checks.append((f'{label}: moving cameras in step with the frame video', all(abs(c['cam_50_ms'] - r['frame_50_ms']) <= 40 and abs(c['cam_95_ms'] - r['frame_95_ms']) <= 40 for c in mv)))
            checks.append((f'{label}: cameras keep their video element', all(c['video_elements'] == 1 for c in r['cams'])))
            checks.append((f'{label}: every camera on screen has live video throughout, incl. one coming back (no black)', all(c['min_ready'] >= 2 for c in r['cams'] if c['end_op'] > 0.5)))
        json.dump({'samples': samples, 'marks': marks}, open(f'/tmp/cam/desk_{LABEL}.json', 'w'))
        await br.close()
        bad = 0
        for n, ok in checks: print(('PASS ' if ok else 'FAIL ') + n); bad += not ok
        print(f'\n{len(checks) - bad} passed, {bad} failed'); sys.exit(1 if bad else 0)
asyncio.run(main())

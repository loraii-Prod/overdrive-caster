"""Transition audit for every /g/* graphic: OUT then IN, recorded with the CDP screencast at 1920x1080 over a grey
backdrop (so transparent overlays are visible). Reports per graphic: delay to first change, time to settle, any frame
that goes (near) fully black, any frame that is fully empty mid-IN (flash), and size of the final-vs-start difference
(layout shift / not returning to the same picture).  Server on :8787, DATA_DIR=/tmp/oddata-aud.
"""
import asyncio, base64, io, json, os, sys, time, urllib.request
from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright
B = 'http://localhost:8787'; D = '/tmp/oddata-aud'; OUT = '/tmp/aud/tr'; os.makedirs(OUT, exist_ok=True)
def tok(): return json.load(open(f'{D}/state.json'))['apiToken']
def send(cmd):
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
GFX = ['scoreboard', 'gameplay', 'bracket', 'caster-desk', 'analyst-desk']

def diff(a, b):
    return ImageStat.Stat(ImageChops.difference(a, b).convert('L')).mean[0]

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = await br.new_page(viewport={'width': 1920, 'height': 1080})
        cdp = await pg.context.new_cdp_session(pg)
        res = {}
        for g in GFX:
            send({'c': 'gfx-anim', 'id': g, 'action': 'in'})
            await pg.goto(f'{B}/g/{g}'); await pg.add_style_tag(content='html,body{background:#3a3a3a!important}')
            await pg.wait_for_timeout(4000)
            frames = []
            def on(f):
                frames.append((time.time(), f['data'])); asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': f['sessionId']}))
            cdp.on('Page.screencastFrame', on)
            await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 70, 'maxWidth': 960, 'maxHeight': 540, 'everyNthFrame': 1})
            await pg.wait_for_timeout(500)
            t_out = time.time(); send({'c': 'gfx-anim', 'id': g, 'action': 'out'}); await pg.wait_for_timeout(2500)
            t_in = time.time(); send({'c': 'gfx-anim', 'id': g, 'action': 'in'}); await pg.wait_for_timeout(3000)
            await cdp.send('Page.stopScreencast'); cdp.remove_listener('Page.screencastFrame', on)
            ims = [(t, Image.open(io.BytesIO(base64.b64decode(d))).convert('RGB')) for t, d in frames]
            ref_in = ims[0][1]
            out_frames = [(t, im) for t, im in ims if t_out <= t < t_in]
            in_frames = [(t, im) for t, im in ims if t >= t_in]
            ref_out = out_frames[-1][1] if out_frames else ref_in
            def timing(seq, t0, target):
                d0 = diff(seq[0][1], target) if seq else 0
                first = next((t - t0 for t, im in seq if diff(im, seq[0][1]) > 1.0), None)
                settle = next((t - t0 for t, im in seq if diff(im, target) < max(0.6, d0 * 0.03)), None)
                return first, settle
            o1, o2 = timing(out_frames, t_out, ref_out)
            i1, i2 = timing(in_frames, t_in, ims[-1][1])
            black = [round(t - t_out, 2) for t, im in ims if ImageStat.Stat(im.convert('L')).mean[0] < 12]
            final_vs_start = diff(ims[-1][1], ref_in)
            for k, (t, im) in enumerate(ims[::3]): im.save(f'{OUT}/{g}_{k:03d}.jpg')
            r = {'out_first_ms': o1 and round(o1 * 1000), 'out_settle_ms': o2 and round(o2 * 1000), 'in_first_ms': i1 and round(i1 * 1000), 'in_settle_ms': i2 and round(i2 * 1000),
                 'black_frames_at_s': black[:5], 'final_vs_start_diff': round(final_vs_start, 2), 'frames': len(ims)}
            res[g] = r; print(g, json.dumps(r))
        json.dump(res, open(f'{OUT}/transitions.json', 'w'), indent=1)
        await br.close()
asyncio.run(main())

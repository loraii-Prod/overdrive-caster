"""Frame capture of a /g/<id> source while engine commands are sent. Usage: flashcap.py <gfx-id> <label> <json-cmds...>
Each cmd json is sent via POST /api/v1/engine?source=manual; between cmds we wait GAP ms. Reports per-frame 'empty' (green bg) and 'black' fractions."""
import asyncio, json, sys, base64, io, time, urllib.request
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
B = "http://localhost:8787"
TOK = json.load(open("/tmp/oddata/state.json"))["apiToken"]
GAP = int(__import__('os').environ.get('GAP', '1500'))
def send(cmd):
    req = urllib.request.Request(f"{B}/api/v1/engine?token={TOK}&source=manual", data=json.dumps(cmd).encode(), headers={"content-type": "application/json"}, method="POST")
    try: return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
async def main():
    gid, label, cmds = sys.argv[1], sys.argv[2], [json.loads(c) for c in sys.argv[3:]]
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu-rasterization"])
        ctx = await br.new_context(viewport={"width": 1920, "height": 1080})
        import os
        st = json.load(open("/tmp/oddata/state.json"))
        for tid in [t for t in os.environ.get("TALENT", "").split(",") if t]:
            prof = next(x for x in st["talent"] if x["id"] == tid)
            tp = await ctx.new_page(); await tp.goto(f"{B}/talent/{tid}?key={prof['key']}"); await tp.wait_for_timeout(1500)
            for bl in ["Start camera"]:
                b = tp.get_by_role("button", name=bl)
                if await b.count(): await b.first.click(); break
        pg = await ctx.new_page()
        await pg.goto(f"{B}/g/{gid}")
        await pg.add_style_tag(content="html,body{background:#00ff00 !important}")
        await pg.wait_for_timeout(int(os.environ.get("SETTLE", "4000")))
        await pg.evaluate("""()=>{window.__cams=[...document.querySelectorAll('[data-cam] video')];window.__cams.forEach((v,i)=>v.__tag=i);
          window.__plays=0;document.addEventListener('playing',()=>window.__plays++,true)}""")
        cdp = await pg.context.new_cdp_session(pg)
        frames = []
        def on(f):
            frames.append((time.time(), f["data"]))
            asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": f["sessionId"]}))
        cdp.on("Page.screencastFrame", on)
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 70, "maxWidth": 480, "maxHeight": 270, "everyNthFrame": 1})
        await pg.wait_for_timeout(600)
        marks = []
        for c in cmds:
            marks.append((time.time(), c.get("c") + ":" + json.dumps(c.get("patch", c.get("action", "")))))
            r = send(c)
            if not r.get("ok"): print("CMD FAIL", c, r)
            await pg.wait_for_timeout(GAP)
        await pg.wait_for_timeout(int(os.environ.get("TAIL", "0")))
        await cdp.send("Page.stopScreencast")
        probe = await pg.evaluate("""()=>{const now=[...document.querySelectorAll('[data-cam] video')];
          return {before:window.__cams.length, after:now.length, same:window.__cams.filter(v=>v.isConnected).length,
            live:now.filter(v=>v.srcObject&&v.readyState>=2).length, playingEvents:window.__plays,
            final:document.querySelector('[data-desk-mode]')?.getAttribute('data-desk-mode')+'/'+(document.querySelector('[data-desk-panel]')?.getAttribute('data-desk-panel')??'-')+'/'+(document.querySelector('[data-booth],[data-desk-kind]')?.getAttribute('data-booth')??document.querySelector('[data-desk-kind]')?.getAttribute('data-desk-kind')),
            layers:document.querySelectorAll('[data-swap-layer]').length}}""")
        print("PROBE", json.dumps(probe))
        await br.close()
    t0 = frames[0][0]
    worst = []
    out = []
    for i, (t, d) in enumerate(frames):
        a = np.asarray(Image.open(io.BytesIO(base64.b64decode(d))).convert("RGB")).astype(int)
        green = (a.min(axis=2) > 236).mean()
        black = (a.max(axis=2) < 18).mean()
        out.append((t - t0, green, black))
        if i % 1 == 0: Image.open(io.BytesIO(base64.b64decode(d))).save(f"/tmp/fc_{label}_{i:03d}.jpg")
    print(f"{label}: {len(frames)} frames over {frames[-1][0]-t0:.2f}s; cmds at " + ", ".join(f"{m[0]-t0:.2f}s {m[1]}" for m in marks))
    base_g = np.median([g for _, g, _ in out[:5]]); base_b = np.median([b for _, _, b in out[:5]])
    print(f"  baseline empty={base_g:.3f} black={base_b:.3f}")
    bad = [(i, t, g, b) for i, (t, g, b) in enumerate(out) if g > base_g + 0.05 or b > base_b + 0.05]
    print(f"  frames with >5% more empty/black area than baseline: {len(bad)}")
    for i, t, g, b in bad[:40]: print(f"   #{i:03d} t={t:.3f}s empty={g:.3f} black={b:.3f}")
    json.dump(out, open(f"/tmp/fc_{label}.json", "w"))
asyncio.run(main())

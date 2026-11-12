import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
B="http://localhost:8787"; TOK=json.load(open("/tmp/oddata/state.json"))["apiToken"]
def send(c):
    r=urllib.request.Request(f"{B}/api/v1/engine?token={TOK}&source=manual",data=json.dumps(c).encode(),headers={"content-type":"application/json"},method="POST")
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
async def main():
    gid=sys.argv[1]; cmds=[json.loads(c) for c in sys.argv[2:]]
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--autoplay-policy=no-user-gesture-required"])
        pg=await (await br.new_context(viewport={"width":1920,"height":1080})).new_page()
        await pg.goto(f"{B}/g/{gid}"); await pg.wait_for_timeout(3500)
        await pg.evaluate("""()=>{window.__log=[];const t0=performance.now();const f=()=>{const g=document.querySelector('[data-gfx]');const vids=[...document.querySelectorAll('video')].filter(v=>v.currentSrc&&v.currentSrc.includes('brand'));
          window.__log.push({t:Math.round(performance.now()-t0),gfx:g&&g.getAttribute('data-gfx-state'),layerOp:g&&getComputedStyle(g).opacity,nodes:g?g.querySelectorAll('*').length:0,
          v:vids.map(v=>v.currentSrc.split('/').pop()+':'+v.readyState+':'+(+getComputedStyle(v).opacity).toFixed(2)).join(' ')});requestAnimationFrame(f)};f();}""")
        for c in cmds:
            await pg.evaluate("m=>window.__log.push({mark:m})", json.dumps(c)); print("ack", send(c)); await pg.wait_for_timeout(900)
        log=await pg.evaluate("window.__log"); await br.close()
    prev=None
    for e in log:
        if 'mark' in e: print("----", e['mark']); continue
        k=(e['gfx'],e['layerOp'],e['nodes']//5,e['v'])
        if k!=prev: print(e)
        prev=k
asyncio.run(main())

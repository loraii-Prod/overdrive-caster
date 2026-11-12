import asyncio, json
from playwright.async_api import async_playwright
B="http://localhost:8787"
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--autoplay-policy=no-user-gesture-required"])
        ctx=await br.new_context(viewport={"width":1920,"height":1480}); pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e: errs.append(str(e)[:200])); pg.on("console",lambda m: errs.append("console: "+m.text[:200]) if m.type=="error" else None)
        await pg.request.post(B+"/api/login",data={"password":"testpw"}); await pg.goto(B+"/producer"); await pg.wait_for_selector("[data-library]")
        rows=await pg.evaluate("[...document.querySelectorAll('[data-gfx-row],[data-source-row]')].map(e=>e.getAttribute('data-gfx-row')?'g:'+e.getAttribute('data-gfx-row'):e.getAttribute('data-source-row'))")
        for r in rows:
            sel=f"[data-gfx-row='{r[2:]}'] >> button >> nth=0" if r.startswith('g:') else f"[data-source-row='{r}'] >> button"
            await pg.click(sel); await pg.wait_for_timeout(450)
            pv=await pg.get_attribute("[data-preview]","data-preview")
            if pv!=r: errs.append(f"selection {r} -> preview {pv}")
        print("library entries visited:", len(rows))
        await pg.keyboard.press("Alt+2")
        for t in ["packages","instances","talent","bindings","modules","assets","show"]:
            await pg.click(f"[data-studio-tab='{t}']"); await pg.wait_for_timeout(350)
        await pg.keyboard.press("Alt+1"); await pg.click("[data-details-toggle]"); await pg.wait_for_timeout(300); await pg.keyboard.press("Escape"); await pg.keyboard.press("?"); await pg.wait_for_timeout(200); await pg.keyboard.press("Escape")
        print("console errors:", errs or "none")
        out={}
        for path in ["/g/caster-desk","/g/analyst-desk","/g/scoreboard","/g/gameplay","/g/bracket","/controller","/controller/dock","/controller/dock/all","/output/screen/casters","/output/screen/analysis","/output/screen/bracket","/output/program","/output/scoreboard","/output/media","/output/major?part=2"]:
            q=await ctx.new_page(); e=[]; q.on("pageerror",lambda x: e.append(str(x)[:160])); q.on("console",lambda m: e.append(m.text[:160]) if m.type=="error" else None)
            await q.goto(B+path); await q.wait_for_timeout(2200)
            n=await q.evaluate("document.querySelectorAll('*').length"); out[path]=(n, e[:2]); await q.close()
        for k,v in out.items(): print(f"{k:28s} nodes={v[0]:4d} errors={v[1] or 'none'}")
        await br.close()
asyncio.run(main())

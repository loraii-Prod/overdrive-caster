import asyncio, json, sys
from playwright.async_api import async_playwright
B="http://localhost:8787"
VPS=[(1920,1480),(1600,900),(2560,1440),(1920,1080),(1280,720),(1440,1480)]
JS="""()=>{
 const R=e=>{if(!e)return null;const b=e.getBoundingClientRect();return [+b.x.toFixed(2),+b.y.toFixed(2),+b.width.toFixed(2),+b.height.toFixed(2)]};
 const cv=document.querySelector('[data-console-canvas]'),pv=document.querySelector('[data-preview]'),ct=document.querySelector('[data-controls]');
 const c=cv.getBoundingClientRect();
 const hov=[...document.querySelectorAll('[data-library],[data-inspector],[data-scene-panel],[data-rundown],[data-publish],[data-studio-mode]')].map(e=>{const sc=[...e.querySelectorAll('*')].filter(x=>{const s=getComputedStyle(x);return (s.overflowX==='auto'||s.overflowX==='scroll')&&x.scrollWidth>x.clientWidth+1});return sc.length}).reduce((a,b)=>a+b,0);
 // content wider than its column (clipped): any element whose right edge passes its panel's right edge
 let clipped=0;for(const p of document.querySelectorAll('[data-library],[data-inspector],[data-rundown],[data-publish]')){const pr=p.getBoundingClientRect();for(const x of p.querySelectorAll('button,select,input,span,b')){const b=x.getBoundingClientRect();if(b.width&&b.right>pr.right+1&&getComputedStyle(x).visibility!=='hidden')clipped++;}}
 const se=document.scrollingElement;
 return {canvas:R(cv),preview:R(pv),controls:R(ct),scale:+(c.width/1920).toFixed(4),scaleY:+(c.height/1480).toFixed(4),
   centred:[+(c.x-(innerWidth-c.right)).toFixed(2),+(c.y-(innerHeight-c.bottom)).toFixed(2)],pageScroll:[se.scrollWidth-innerWidth,se.scrollHeight-innerHeight],hScrollPanels:hov,clipped}}"""
async def main():
    sel=sys.argv[1] if len(sys.argv)>1 else 'g:analyst-desk'
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        for w,h in VPS:
            ctx=await br.new_context(viewport={"width":w,"height":h},device_scale_factor=1)
            pg=await ctx.new_page()
            await pg.request.post(B+"/api/login",data={"password":"testpw"})
            await pg.goto(B+"/producer"); await pg.evaluate(f"localStorage.setItem('od2.sel','{sel}');localStorage.setItem('od2.mode','live')"); await pg.reload(); await pg.wait_for_timeout(3000)
            print(f"{w}x{h}", json.dumps(await pg.evaluate(JS)))
            await ctx.close()
        # 1920x1480 at browser zoom 100% vs page zoom emulation (deviceScaleFactor 1.25 = Windows 125% scaling)
        ctx=await br.new_context(viewport={"width":1536,"height":1184},device_scale_factor=1.25)
        pg=await ctx.new_page(); await pg.request.post(B+"/api/login",data={"password":"testpw"}); await pg.goto(B+"/producer"); await pg.wait_for_timeout(3000)
        print("1920x1480 @125% OS scaling", json.dumps(await pg.evaluate(JS)))
        await br.close()
asyncio.run(main())

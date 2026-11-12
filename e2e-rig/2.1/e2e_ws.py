"""End-to-end: the new workstation drives the real engine and real /g/ browser sources (2 operators, 1 source)."""
import asyncio, json, time, urllib.request
from playwright.async_api import async_playwright
B="http://localhost:8787"
ok=bad=0
def check(name, cond, extra=""):
    global ok,bad
    ok+= bool(cond); bad+= not cond
    print(("PASS " if cond else "FAIL ")+name+(f"  {extra}" if extra else ""))
def state():
    return json.load(open("/tmp/oddata/state.json"))
async def console(br):
    ctx=await br.new_context(viewport={"width":1920,"height":1480})
    pg=await ctx.new_page(); await pg.request.post(B+"/api/login",data={"password":"testpw"})
    await pg.goto(B+"/producer"); await pg.evaluate("localStorage.clear();localStorage.setItem('od2.sel','g:caster-desk')"); await pg.reload(); await pg.wait_for_selector("[data-library]")
    return pg
async def anim(src, gid):
    return await src.evaluate("id=>document.querySelector(`[data-gfx='${id}']`)?.getAttribute('data-gfx-state')", gid)
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--autoplay-policy=no-user-gesture-required"])
        A=await console(br); Bc=await console(br)
        sctx=await br.new_context(viewport={"width":1920,"height":1080}); S=await sctx.new_page(); await S.goto(B+"/g/analyst-desk"); await S.wait_for_timeout(2500)
        gd=lambda: next(g for g in state()["graphics"] if g["id"]=="analyst-desk")
        seq0=gd()["anim"]["seq"]; obs_before=state().get("showLive",{}).get("obsScenes")
        # 1 selection only changes the workspace
        await A.click("[data-gfx-row='analyst-desk'] >> button >> nth=0"); await A.wait_for_timeout(400)
        check("library selection shows the graphic in the preview", await A.get_attribute("[data-preview]","data-preview")=="g:analyst-desk")
        await A.click("[data-gfx-row='scoreboard'] >> button >> nth=0"); await A.click("[data-source-row='bracket'] >> button"); await A.click("[data-gfx-row='analyst-desk'] >> button >> nth=0"); await A.wait_for_timeout(500)
        check("selecting graphics never animates them (seq unchanged)", gd()["anim"]["seq"]==seq0)
        check("…and the source did not change", await anim(S,"analyst-desk")=="in")
        # 2 inspector -> draft, visible on both operators, not on the source
        await A.select_option("[data-inspector='analyst-desk'] [data-prop='panel'] select","h2h"); await A.wait_for_timeout(600)
        check("Inspector edit makes a draft (server)", gd()["draft"] and gd()["draft"]["panel"]=="h2h" and gd()["config"]["panel"]=="cams")
        check("operator B sees the DRAFT badge instantly", await Bc.locator("[data-gfx-row='analyst-desk'] >> text=DRAFT").count()==1)
        check("source still shows the published panel", await S.evaluate("document.querySelector('[data-desk-mode]')?.getAttribute('data-desk-mode')")=="cams")
        await A.click("[data-view-toggle] >> text=Live"); await A.wait_for_timeout(300)
        live_has_panel=await A.evaluate("!!document.querySelector('[data-preview] [data-desk-panel]')")
        await A.click("[data-view-toggle] >> text=Draft"); await A.wait_for_timeout(700)
        draft_has_panel=await A.evaluate("document.querySelector('[data-preview] [data-desk-panel]')?.getAttribute('data-desk-panel')")
        check("preview: Draft shows the prepared panel, Live shows the source", (not live_has_panel) and draft_has_panel=="h2h", f"live={live_has_panel} draft={draft_has_panel}")
        # 3 publish from the inspector (ack before success)
        await A.click("[data-anims] >> text=Publish 1"); await A.wait_for_timeout(1200)
        check("Publish: config live, draft gone, UPDATE played", gd()["config"]["panel"]=="h2h" and gd()["draft"] is None and gd()["anim"]["action"]=="update")
        check("the source changed to the panel (no reload)", await S.evaluate("document.querySelector('[data-desk-panel]')?.getAttribute('data-desk-panel')")=="h2h")
        log=await A.inner_text("[data-log]"); check("ack logged as confirmed", "✓ Publish Analyst Desk" in log, log.splitlines()[0] if log else "")
        # 4 keyboard F4 OUT / F2 IN on the selected graphic
        await A.click("[data-preview]"); await A.keyboard.press("F4"); await A.wait_for_timeout(900)
        check("F4 takes the selected graphic OUT on its source", gd()["anim"]["action"]=="out" and await anim(S,"analyst-desk")=="out")
        await A.keyboard.press("F2"); await A.wait_for_timeout(1200)
        check("F2 takes it IN again", gd()["anim"]["action"]=="in" and await anim(S,"analyst-desk")=="in")
        # 5 rundown via UI
        await A.click("[data-rd-add]"); await A.wait_for_timeout(300)
        await A.select_option("[aria-label='Item data']","snapshot"); await A.click("[data-rd-add]"); await A.wait_for_timeout(400)
        await A.click("[data-gfx-row='scoreboard'] >> button >> nth=0"); await A.click("[data-rd-add]"); await A.wait_for_timeout(500)
        rd=state()["rundown"]; check("rundown: 3 items added from the UI, first cued", len(rd["items"])==3 and rd["cue"]==rd["items"][0]["id"] and rd["items"][1]["data"] is not None and rd["items"][2]["data"] is None, json.dumps([i["label"] for i in rd["items"]]))
        check("operator B sees the same rundown", await Bc.locator("[data-rundown-row]").count()==3)
        first=rd["items"][2]["id"]
        await A.click(f"[data-rundown-row='{first}'] [aria-label='Move up']"); await A.wait_for_timeout(400)
        check("rundown reorder (▲)", state()["rundown"]["items"][1]["id"]==first)
        await A.click("[data-gfx-row='analyst-desk'] >> button >> nth=0"); await A.keyboard.press("F4"); await A.wait_for_timeout(700)
        await A.click("[data-preview]"); await A.keyboard.press("F8"); await A.wait_for_timeout(1200)
        rd=state()["rundown"]
        check("F8 TAKE NEXT: cued item IN on its source, next cued", gd()["anim"]["action"]=="in" and await anim(S,"analyst-desk")=="in" and rd["cue"]==rd["items"][1]["id"])
        await A.click(f"[data-rd-out='{rd['items'][0]['id']}']"); await A.wait_for_timeout(900)
        check("rundown OUT button", await anim(S,"analyst-desk")=="out")
        # 6 publish all + undo via keyboard on operator B
        await Bc.click("[data-gfx-row='caster-desk'] >> button >> nth=0")
        await Bc.select_option("[data-inspector='caster-desk'] [data-prop='layout'] select","solo"); await Bc.wait_for_timeout(400)
        cdesk=lambda: next(g for g in state()["graphics"] if g["id"]=="caster-desk")
        await Bc.click("[data-preview]"); await Bc.keyboard.press("Control+Enter"); await Bc.wait_for_timeout(900)
        check("Ctrl+Enter publishes all (operator B)", cdesk()["config"]["layout"]=="solo" and cdesk()["draft"] is None)
        # 7 source refresh keeps the published state without replaying
        await S.reload(); await S.wait_for_timeout(2500)
        check("refreshed source shows the published state (OUT stays OUT)", await anim(S,"analyst-desk")=="out")
        # 8 studio: rename instance
        await A.keyboard.press("Alt+2"); await A.wait_for_timeout(300); await A.click("[data-studio-tab='instances']")
        await A.fill("[aria-label='Name of scoreboard']","Series score"); await A.press("[aria-label='Name of scoreboard']","Enter"); await A.wait_for_timeout(600)
        check("Studio: rename instance through the engine", next(g for g in state()["graphics"] if g["id"]=="scoreboard")["name"]=="Series score")
        check("Studio: renamed in operator B's library", await Bc.locator("[data-gfx-row='scoreboard'] >> text=Series score").count()==1)
        # 9 nothing in this session switched OBS / played a stinger
        alllog=await A.inner_text("[data-log]")+await Bc.inner_text("[data-log]")
        check("no OBS switch was ever sent", "OBS →" not in alllog)
        check("graphics source has no stinger video", await S.evaluate("[...document.querySelectorAll('video')].every(v=>!v.currentSrc.includes('stinger'))"))
        errs=[]
        await br.close()
    print(f"\n{ok} passed, {bad} failed")
asyncio.run(main())

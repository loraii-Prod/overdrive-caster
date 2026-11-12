"""End-to-end: Producer → Studio → OBS Setup drives the real server + real ObsBridge (obs-websocket-js, password auth)
against the obs-websocket v5 protocol mock (e2e-rig/obs/mockObsServer.ts). Not real OBS."""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright
B = "http://localhost:8787"; M = "http://127.0.0.1:4461"
ok = bad = 0
def check(name, cond, extra=""):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra else ""))
def mock(path="/state"):
    return json.load(urllib.request.urlopen(urllib.request.Request(M + path, method="GET")))
FORBIDDEN = {"SetCurrentProgramScene", "SetCurrentPreviewScene", "TriggerStudioModeTransition", "RemoveScene", "RemoveInput", "RemoveSceneItem", "SetCurrentSceneTransition"}

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        ctx = await br.new_context(viewport={"width": 1920, "height": 1480})
        pg = await ctx.new_page()
        await pg.request.post(B + "/api/login", data={"password": "testpw"})
        await pg.goto(B + "/producer")
        await pg.evaluate("localStorage.clear();localStorage.setItem('od2.mode','studio');localStorage.setItem('od2.studioTab','obs')")
        await pg.reload(); await pg.wait_for_selector("[data-obs-setup]")
        await pg.wait_for_selector("[data-obs-conn='on']", timeout=10000)
        check("OBS Setup tab shows the connection + OBS version", "mock" in (await pg.inner_text("[data-obs-version]")), await pg.inner_text("[data-obs-version]"))
        await pg.wait_for_selector("[data-target]", timeout=10000)
        n_rows = await pg.locator("[data-target]").count()
        check("every Overdrive output listed (scan ran automatically on connect)", n_rows == 20, f"{n_rows} rows")
        check("all scenes start MISSING in an empty OBS", await pg.locator("[data-target-status='missing']").count() >= 14)
        await pg.screenshot(path="/tmp/obs-ui-1-scan.png")
        log0 = len(mock()["log"])
        # Build All -> preview dialog, nothing changed yet
        await pg.click("[data-act='build-all']"); await pg.wait_for_selector("[data-obs-plan]")
        writes = [l for l in mock()["log"][log0:] if not l["req"].startswith("Get")]
        check("Build All opens the server's preview; OBS unchanged until Confirm", len(writes) == 0, f"{len(writes)} writes")
        txt = await pg.inner_text("[data-obs-plan]")
        check("preview lists each new scene and its 1920×1080 source", "Overdrive · Caster Desk" in txt and "1920×1080" in txt and "/g/caster-desk" in txt)
        await pg.screenshot(path="/tmp/obs-ui-2-plan.png")
        await pg.click("[data-plan-confirm]"); await pg.wait_for_selector("[data-obs-plan]", state="detached", timeout=15000)
        await pg.wait_for_timeout(600)
        st = mock()
        scenes = {s["name"]: s for s in st["scenes"]}
        check("Confirm builds one OBS scene per output", len(scenes) == 16, f"{len(scenes)} scenes")
        check("rows now OK", await pg.locator("[data-target][data-target-status='ok']").count() >= 14, f"{await pg.locator('[data-target-status=ok]').count()} ok")
        check("last run summary shown", "15/15" in await pg.inner_text("[data-last-run]"), await pg.inner_text("[data-last-run]"))
        check("Program scene untouched, no switch / transition / delete sent", st["program"] == "Scene" and not [l for l in st["log"] if l["req"] in FORBIDDEN])
        await pg.screenshot(path="/tmp/obs-ui-3-built.png")
        # select one scene, break it in OBS, Verify All flags it, Repair Selected fixes only it
        urllib.request.urlopen(M + "/break-url?input=" + urllib.parse.quote("Overdrive · Map veto overlay"))
        urllib.request.urlopen(M + "/add-manual?scene=" + urllib.parse.quote("Overdrive · Map veto") + "&name=Sponsor")
        await pg.click("[data-act='verify']"); await pg.wait_for_timeout(1200)
        check("Verify All flags the broken scene", await pg.get_attribute("[data-target='s:veto']", "data-target-status") == "outdated")
        await pg.click("[data-target='s:veto']")
        det = await pg.inner_text("[data-obs-detail]")
        check("detail pane: URL problem + the manual item listed as kept", "wrong:1" in det and "Sponsor" in det)
        log1 = len(mock()["log"])
        await pg.click("[data-act='repair-selected']"); await pg.wait_for_selector("[data-obs-plan]")
        check("Repair Selected preview mentions only that scene", "Overdrive · Map veto" in await pg.inner_text("[data-obs-plan]") and "Caster Desk" not in await pg.inner_text("[data-obs-plan]"))
        await pg.click("[data-plan-confirm]"); await pg.wait_for_selector("[data-obs-plan]", state="detached", timeout=15000); await pg.wait_for_timeout(600)
        st = mock(); inp = {i["name"]: i for i in st["inputs"]}
        touched = {l["data"].get("sceneName") or l["data"].get("inputName") for l in st["log"][log1:] if not l["req"].startswith("Get")}
        check("repair fixed the URL, kept the manual item, touched nothing else", inp["Overdrive · Map veto overlay"]["settings"]["url"] == B + "/output/screen/veto" and any(i["source"] == "Sponsor" for s in st["scenes"] if s["name"] == "Overdrive · Map veto" for i in s["items"]) and touched <= {"Overdrive · Map veto overlay", "Overdrive · Map veto"}, str(touched))
        check("row back to OK", await pg.get_attribute("[data-target='s:veto']", "data-target-status") == "ok")
        # on-air guard in the UI
        urllib.request.urlopen(M + "/program?scene=" + urllib.parse.quote("Overdrive · Interview"))
        urllib.request.urlopen(M + "/break-url?input=" + urllib.parse.quote("Overdrive · Interview overlay"))
        await pg.wait_for_timeout(500)
        await pg.click("[data-row-repair='s:interview']"); await pg.wait_for_selector("[data-obs-plan]")
        check("plan marks the ON AIR scene and offers the explicit override", await pg.locator("[data-obs-plan] >> text=ON AIR").count() >= 1 and await pg.locator("[data-allow-live]").count() == 1)
        await pg.screenshot(path="/tmp/obs-ui-4-onair.png")
        await pg.click("[data-plan-confirm]"); await pg.wait_for_selector("[data-obs-plan]", state="detached", timeout=15000); await pg.wait_for_timeout(500)
        inp = {i["name"]: i for i in mock()["inputs"]}
        check("without the override the on-air source is not touched", inp["Overdrive · Interview overlay"]["settings"]["url"] == "http://wrong:1/nothing")
        # Build Selected on a single scene; idempotent
        log2 = len(mock()["log"])
        await pg.click("[data-target='g:bracket']"); await pg.click("[data-act='build-selected']"); await pg.wait_for_selector("[data-obs-plan]")
        check("Build Selected on a built scene: nothing to change", await pg.locator("[data-plan-empty]").count() == 1)
        await pg.click("[data-plan-cancel]"); await pg.wait_for_selector("[data-obs-plan]", state="detached")
        check("…and no OBS writes", not [l for l in mock()["log"][log2:] if not l["req"].startswith("Get")])
        # tally: the Live library now knows each graphic's OBS scene
        await pg.click("[data-mode] >> text=live"); await pg.wait_for_selector("[data-library]")
        t = await pg.get_attribute("[data-gfx-row='caster-desk'] >> button >> nth=0", "title")
        check("tally mapping: library knows the graphic's OBS scene", "OBS: Overdrive · Caster Desk" in (t or ""), t)
        # disconnect: UI reports it and recovers
        await pg.click("[data-mode] >> text=studio"); await pg.wait_for_selector("[data-obs-setup]")
        urllib.request.urlopen(M + "/drop")
        await pg.wait_for_selector("[data-obs-conn='off']", timeout=5000)
        check("OBS drop shown; actions disabled", await pg.is_disabled("[data-act='build-all']"))
        await pg.wait_for_selector("[data-obs-conn='on']", timeout=10000)
        check("ObsBridge reconnects by itself", True)
        stj = json.load(open("/tmp/oddata-obs/state.json"))
        check("mapping persisted on the server (scene, source, uuids, item id)", stj["obsSetup"]["map"]["g:caster-desk"]["sceneUuid"] and stj["obsSetup"]["map"]["g:caster-desk"]["itemId"])
        await br.close()
    print(f"\n{ok} passed, {bad} failed")
import urllib.parse
asyncio.run(main())

"""End-to-end: per-scene controllers (/producer/scene/<target>) as OBS docks would load them, against the real server
+ ObsBridge + the obs-websocket protocol mock. Run after ui_e2e.py (scenes built). Not real OBS docks."""
import asyncio, json, re, urllib.request, urllib.parse
from playwright.async_api import async_playwright
B = "http://localhost:8787"; M = "http://127.0.0.1:4461"
ok = bad = 0
def check(name, cond, extra=""):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra else ""))
def mock(path="/state"): return json.load(urllib.request.urlopen(M + path))
def state(): return json.load(open("/tmp/oddata-obs/state.json"))
def gfx(i): return next(g for g in state()["graphics"] if g["id"] == i)

async def page(br, path, w, h):
    ctx = await br.new_context(viewport={"width": w, "height": h})
    await ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=B)
    pg = await ctx.new_page(); await pg.request.post(B + "/api/login", data={"password": "testpw"})
    await pg.goto(B + path); await pg.wait_for_selector("[data-controls]", timeout=15000); await pg.wait_for_timeout(800)
    return pg

async def scale(pg):
    t = await pg.eval_on_selector("[data-console-canvas]", "e => getComputedStyle(e).transform")
    m = re.match(r"matrix\(([-\d.e]+)", t); return float(m.group(1)) if m else 1.0

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        # 1 a scene controller at dock size: 1920×1480 logical layout, uniform scale
        cd = await page(br, "/producer/scene/g:caster-desk", 640, 600)
        s = await scale(cd)
        check("caster-desk dock: uniform scale min(640/1920, 600/1480)", abs(s - min(640 / 1920, 600 / 1480)) < 0.002, f"{s:.4f}")
        check("caster-desk dock shows ITS graphic, marked as scene controller", await cd.get_attribute("[data-preview]", "data-preview") == "g:caster-desk" and await cd.get_attribute("[data-dock]", "data-dock") == "g:caster-desk")
        check("…with only its controls: inspector, no library / rundown / Studio", await cd.locator("[data-inspector='caster-desk']").count() == 1 and await cd.locator("[data-library]").count() == 0 and await cd.locator("[data-rundown]").count() == 0 and await cd.locator("[data-mode]").count() == 0)
        cd.set_default_timeout(5000)
        await cd.screenshot(path="/tmp/dock-caster.png")
        big = await page(br, "/producer/scene/g:caster-desk", 1920, 1480)
        check("at full size the layout is exactly 1920×1480 (preview 1080 + controls 400)", await scale(big) == 1.0 and await big.eval_on_selector("[data-preview]", "e => e.offsetHeight") == 1080 and await big.eval_on_selector("[data-controls]", "e => e.offsetHeight") == 400)
        await big.screenshot(path="/tmp/dock-caster-full.png"); await big.context.close()
        # 2 a legacy scene source controller: its modules
        vt = await page(br, "/producer/scene/s:veto", 960, 740)
        check("map-veto dock: its preview + its scene modules (veto)", await vt.get_attribute("[data-preview]", "data-preview") == "veto" and await vt.locator("[data-modules='veto']").count() == 1)
        # 3 independent + synchronised through the engine
        main_ = await page(br, "/producer", 1920, 1480)
        await main_.evaluate("localStorage.setItem('od2.sel','g:bracket')"); await main_.reload(); await main_.wait_for_selector("[data-library]")
        seq0 = gfx("caster-desk")["anim"]["seq"]
        await cd.mouse.click(5, 5); await cd.keyboard.press("F4"); await cd.wait_for_timeout(700)
        check("scene action in its dock (F4 = OUT) reaches the engine", gfx("caster-desk")["anim"]["action"] == "out" and gfx("caster-desk")["anim"]["seq"] > seq0)
        check("…the main console sees it at once (shared state)", await main_.get_attribute("[data-gfx-row='caster-desk']", "data-gfx-state") == "out")
        check("…the other dock (veto) did not change selection or content", await vt.get_attribute("[data-preview]", "data-preview") == "veto" and gfx("bracket")["anim"]["action"] == "in")
        await cd.keyboard.press("F2"); await cd.wait_for_timeout(500)
        check("…and back IN from the dock", gfx("caster-desk")["anim"]["action"] == "in")
        check("docks never wrote the main console's saved selection", await main_.evaluate("localStorage.getItem('od2.sel')") == "g:bracket")
        # 4 follow-OBS dock: follows Program, then Studio Mode Preview, never switches OBS
        urllib.request.urlopen(M + "/studio-off")
        fo = await page(br, "/producer/scene/follow", 800, 617)
        log0 = len(mock()["log"])
        urllib.request.urlopen(M + "/program?scene=" + urllib.parse.quote("Overdrive · Map veto")); await fo.wait_for_timeout(900)
        check("follow dock follows OBS Program to Map Veto", await fo.get_attribute("[data-preview]", "data-preview") == "veto")
        urllib.request.urlopen(M + "/preview?scene=" + urllib.parse.quote("Overdrive · Tournament Bracket")); await fo.wait_for_timeout(900)
        pv = await fo.get_attribute("[data-preview]", "data-preview"); lab = await fo.inner_text("[data-dock]")
        check("Studio Mode: follow dock follows OBS Preview (bracket)", pv == "g:bracket" and "PREVIEW" in lab.upper(), f"{pv} / {lab}")
        urllib.request.urlopen(M + "/preview?scene=Scene"); await fo.wait_for_timeout(900)
        check("non-Overdrive scene in OBS: follow dock says so (keeps last)", await fo.locator("[data-dock-message]").count() == 1)
        st = mock()
        check("following never switched OBS (no Program/Preview request sent)", not [l for l in st["log"][log0:] if l["req"] in ("SetCurrentProgramScene", "SetCurrentPreviewScene", "TriggerStudioModeTransition")] and st["program"] == "Overdrive · Map veto")
        # 5 unknown target
        un = await page(br, "/producer/scene/g:no-such-graphic", 800, 617)
        check("dock of a removed scene explains itself", await un.locator("[data-dock-message]").count() == 1)
        # 6 Studio actions
        await main_.evaluate("localStorage.setItem('od2.mode','studio');localStorage.setItem('od2.studioTab','obs')"); await main_.reload(); await main_.wait_for_selector("[data-target]")
        await main_.click("[data-target='g:analyst-desk']")
        await main_.click("[data-act='copy-dock']"); clip = await main_.evaluate("navigator.clipboard.readText()")
        check("Copy Controller Dock URL copies the OBS-reachable controller URL", clip == B + "/producer/scene/g:analyst-desk", clip)
        async with main_.context.expect_page() as pi: await main_.click("[data-act='open-controller']")
        pop = await pi.value; await pop.wait_for_selector("[data-dock]", timeout=15000)
        check("Open Individual Controller opens that scene's controller", await pop.get_attribute("[data-preview]", "data-preview") == "g:analyst-desk")
        await main_.click("[data-act='docks']"); await main_.wait_for_selector("[data-docks-dialog]")
        n = await main_.locator("[data-dock-row]").count()
        check("OBS Docks dialog: a dock per built scene + Follow OBS", n == 15, f"{n} docks")
        async with main_.expect_download() as di: await main_.click("[data-docks-ps1]")
        d = await di.value; txt = open(await d.path(), encoding="utf-8", newline="").read()
        check("Windows installer download contains every dock URL", txt.count("/producer/scene/") == 15 and "\r\n" in txt, f"{txt.count('/producer/scene/')} urls")
        await main_.screenshot(path="/tmp/docks-dialog.png")
        await main_.click("[data-docks-close]")
        # 7 a controller page used as a broadcast source is flagged
        urllib.request.urlopen(M + "/add-browser?scene=" + urllib.parse.quote("Overdrive · Matches") + "&name=" + urllib.parse.quote("Controller by mistake") + "&url=" + urllib.parse.quote(B + "/producer/scene/s:matches"))
        await main_.click("[data-act='verify']"); await main_.wait_for_selector("[data-controller-leak]", timeout=5000)
        check("Verify OBS Setup warns when a controller is inside a broadcast scene (not deleted)", "Controller by mistake" in await main_.inner_text("[data-controller-leak]") and any(i["name"] == "Controller by mistake" for i in mock()["inputs"]))
        await main_.screenshot(path="/tmp/obs-setup-leak.png")
        srcs = [i for i in mock()["inputs"] if i["kind"] == "browser_source" and i["name"].startswith("Overdrive")]
        check("no Overdrive-built broadcast source loads a controller page", all("/producer" not in i["settings"].get("url", "") for i in srcs), f"{len(srcs)} sources")
        await br.close()
    print(f"\n{ok} passed, {bad} failed")
asyncio.run(main())

"""Producer Control Room: every primary control drives the real engine + (mock) OBS. Needs the seeded server on :8787
(e2e-rig/producer/seed.py) and mockobs on 4455/4456 with the scenes built and Studio Mode on."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
B = 'http://localhost:8787'
ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1; print('  ok  ', name)
    else: fail += 1; print('  FAIL', name, extra)
def obs():
    d = json.load(urllib.request.urlopen('http://127.0.0.1:4456/state'))
    return d['program'], [l for l in d['log'] if l['req'] in ('SetCurrentPreviewScene', 'SetCurrentProgramScene', 'TriggerStudioModeTransition')]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("if(!sessionStorage.getItem('init')){sessionStorage.setItem('init','1');localStorage.setItem('od2.mode','live');localStorage.removeItem('od3.room.favs');localStorage.removeItem('od3.room.rail')}")
        await pg.goto(f'{B}/producer?ui=room'); await pg.wait_for_selector('[data-control-room]'); await pg.wait_for_timeout(2500)
        r = await pg.evaluate("({sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth})")
        check('1080p: no page scrolling', r['sh'] <= r['ih'] and r['sw'] <= r['iw'], r)
        for sel in ['[data-monitors]', '[data-scene-bank]', '[data-context]', '[data-rail]', '[data-room-status-bar]', '[data-match-strip]']:
            b = await pg.locator(sel).first.bounding_box()
            check(f'{sel} fully visible', b and b['y'] >= 0 and b['y'] + b['height'] <= 1081 and b['x'] + b['width'] <= 1921, b)
        tiles = await pg.eval_on_selector_all('[data-room-scene]', 'e => e.map(x => x.getAttribute("data-room-scene"))')
        check('scene bank order', [t.split(':')[-1] for t in tiles][:9] == ['starting', 'gameplay', 'caster-desk', 'analyst-desk', 'mvp', 'brb', 'ending', 'safe', 'team-intro'], tiles)

        async def tile(name): return pg.locator(f'[data-room-scene$="{name}"]').first
        async def take(btn, scene, label):
            n0 = len(obs()[1])
            await (await tile(scene)).click(); await pg.wait_for_timeout(700)
            prog, log = obs(); new = log[n0:]
            check(f'{label}: tile click prepares OBS Preview only', any(l['req'] == 'SetCurrentPreviewScene' for l in new) and not any(l['req'] != 'SetCurrentPreviewScene' for l in new), new)
            t = await pg.locator('[data-monitor="pvw"] [data-monitor-title]').inner_text() if await pg.locator('[data-monitor="pvw"]').count() else (await pg.locator('[data-monitor-title]').first.inner_text())
            check(f'{label}: Preview monitor shows it', label.lower() in t.lower(), t)
            await pg.locator(f'[{btn}]').click(); await pg.wait_for_timeout(1500)
            prog = obs()[0]
            check(f'{label}: {btn} puts it on OBS Program', label.lower() in prog.lower(), prog)
            tally = await (await tile(scene)).get_attribute('data-tally')
            check(f'{label}: tile tally is PGM', tally == 'pgm', tally)
        await (await tile('ending')).click(); await pg.wait_for_timeout(600)   # reruns: start from a known Preview
        await take('data-room-cut', 'analyst-desk', 'Analyst Desk')
        await take('data-room-auto', 'starting', 'Starting')
        await take('data-room-take', 'gameplay', 'Gameplay')
        await take('data-room-take', 'caster-desk', 'Caster Desk')

        # context controls follow the selection
        await (await tile('gameplay')).click(); await pg.wait_for_timeout(500)
        mods = await pg.eval_on_selector_all('[data-context-module]', 'e => e.map(x => x.getAttribute("data-context-module"))')
        check('Gameplay context = match, scoreboard, track, graphics…', mods[:3] == ['match', 'scoreboard', 'track'], mods)
        await (await tile('mvp')).click(); await pg.wait_for_timeout(600)
        check('MVP context = MVP panel', await pg.locator('[data-context] [data-mvp-panel], [data-context] [data-mvp]').count() > 0 or 'MVP' in await pg.locator('[data-context-title]').inner_text())

        # favourites
        await (await tile('gameplay')).click(); await pg.wait_for_timeout(300)
        await pg.locator('[data-room-fav]').click(); await pg.wait_for_timeout(200)
        await pg.locator('[data-bank-tab="fav"]').first.click(); await pg.wait_for_timeout(300)
        favs = await pg.eval_on_selector_all('[data-room-scene]', 'e => e.map(x => x.getAttribute("data-room-scene"))')
        check('favourite appears in Favourites tab', any('gameplay' in f for f in favs), favs)
        await pg.locator('[data-bank-tab="main"]').click()

        # automation HOLD and rundown GO
        s0 = await pg.locator('[data-room-auto-status]').inner_text()
        await pg.locator('[data-room-hold]').click(); await pg.wait_for_timeout(600)
        s1 = await pg.locator('[data-room-auto-status]').inner_text()
        check('HOLD holds automation', 'held' in s1.lower() and s0 != s1, (s0, s1))
        await pg.locator('[data-room-hold]').click(); await pg.wait_for_timeout(600)
        check('HOLD again resumes', 'armed' in (await pg.locator('[data-room-auto-status]').inner_text()).lower())
        r0 = await pg.locator('[data-room-rundown]').inner_text(); p0 = obs()[0]
        await pg.locator('[data-room-go]').click(); await pg.wait_for_timeout(1500)
        r1 = await pg.locator('[data-room-rundown]').inner_text()
        check('GO advances the show rundown', r0 != r1 and 'nothing marked on air' not in r1, r1[:120])
        p1 = obs()[0]  # the on-air item's scene: either a switch happened, or it was already on Program (fresh seed: Opening · Caster Desk)
        check('GO puts the rundown item on OBS Program', p1 != p0 or p1.split(' · ')[-1].lower() in r1.lower(), (p0, p1))

        # match strip popover
        await pg.locator('[data-match-strip]').click(); await pg.wait_for_timeout(400)
        check('match strip opens the match controls', await pg.locator('[data-match-popover]').is_visible())
        await pg.keyboard.press('Escape'); await pg.locator('[data-match-strip]').click()

        # resizable + saved layout
        sep = await pg.locator('[data-room-rail-split]').bounding_box(); w0 = (await pg.locator('[data-rail]').bounding_box())['width']
        await pg.mouse.move(sep['x'] + 3, sep['y'] + 200); await pg.mouse.down(); await pg.mouse.move(sep['x'] - 80, sep['y'] + 200, steps=5); await pg.mouse.up()
        w1 = (await pg.locator('[data-rail]').bounding_box())['width']
        await pg.reload(); await pg.wait_for_selector('[data-control-room]'); await pg.wait_for_timeout(1500)
        w2 = (await pg.locator('[data-rail]').bounding_box())['width']
        check('rail resizes and the size survives reload', w1 > w0 + 50 and abs(w2 - w1) < 3, (w0, w1, w2))
        check('favourites survive reload', await pg.evaluate("JSON.parse(localStorage.getItem('od3.room.favs')||'[]').length") > 0)

        # prepare → publish → undo, and the status-bar actions are acknowledged by the server
        async def last(): return await pg.locator('[data-room-log]').inner_text()
        await pg.locator('[data-room-prepare-opt="prepare"]').click()
        await (await tile('analyst-desk')).click(); await pg.wait_for_timeout(500)
        await pg.locator('[data-context-module^="talent"] button', has_text='Solo').first.click(); await pg.wait_for_timeout(700)
        check('Prepare: a change enables Publish all', await pg.locator('[data-room-publish]').is_enabled())
        await pg.locator('[data-room-publish]').click(); await pg.wait_for_timeout(900)
        check('Publish all publishes (draft clean, acked)', not await pg.locator('[data-room-publish]').is_enabled() and '✓' in await last(), await last())
        check('Undo is available after publishing', await pg.locator('[data-room-undo]').is_enabled())
        await pg.locator('[data-room-undo]').click(); await pg.wait_for_timeout(900)
        check('Undo acknowledged', '✓' in await last() and 'Undo' in await last(), await last())
        await pg.locator('[data-room-prepare-opt="live"]').click()
        for sel, word in [('[data-room-clear]', 'Clear graphics'), ('[data-room-reload]', 'Reload sources')]:
            await pg.locator(sel).click(); await pg.wait_for_timeout(900)
            check(f'{word} acknowledged', word in await last() and '✓' in await last(), await last())

        # classic layout round trip
        await pg.locator('[data-room-classic]').click(); await pg.wait_for_timeout(1200)
        check('Classic opens the previous Producer', await pg.locator('[data-control-room]').count() == 0)
        await pg.locator('[data-room-open]').click(); await pg.wait_for_timeout(1200)
        check('"Control room" button returns', await pg.locator('[data-control-room]').count() == 1)
        check('no page errors', not errs, errs[:3])
        await br.close()
    print(f'{ok} ok, {fail} failed'); sys.exit(1 if fail else 0)
asyncio.run(main())

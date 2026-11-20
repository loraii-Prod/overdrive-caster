"""Overdrive 3.1 · Track Progression, end to end.

Real server + Producer page in headless Chrome + the OBS browser source URL the Scene Builder registered in a mock
OBS (obs-websocket 5). The Google Sheet is replaced by local CSV files in the sheet's exact 28-column layout
(SHEET_FIXTURE_DIR, the server's existing offline-sheet switch): the real loader, parser and auto refresh run.

  bash e2e-rig/track/run.sh <build dir>
"""
import asyncio, csv, json, os, shutil, subprocess, urllib.request
from playwright.async_api import async_playwright

B, M, R = 'http://localhost:8787', 'http://127.0.0.1:4456', __file__.rsplit('/e2e-rig/', 1)[0]
OUT, FX = '/home/claude/out', os.environ.get('SHEET_FIXTURE_DIR', '/tmp/trackfx')
res = []
def check(name, ok, extra=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or extra == '' else f'  [{extra}]'), flush=True)
def get(u): return json.loads(urllib.request.urlopen(u).read())
def probe(msgs=()): return json.loads(subprocess.run(['node', f'{R}/e2e-rig/mvp4/probe.mjs', json.dumps(list(msgs))], capture_output=True, text=True).stdout)
def wc(op): return {'t': 'wc', 'op': op}
def track_url():
    for i in get(f'{M}/state')['inputs']:
        u = (i.get('settings') or {}).get('url', '')
        if u.endswith('/g/track'): return i['name'], u
    return None, None
def scenes(): return get(f'{M}/state').get('scenes', [])

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1480})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        errs = []
        pr = await ctx.new_page(); pr.on('pageerror', lambda e: errs.append(str(e)))
        await pr.add_init_script("localStorage.setItem('od2.mode','live'); localStorage.setItem('od3.lib','library')")

        # ---- OBS: the Scene Builder registers the new graphic like every other one
        name, url = track_url()
        # 3.2 main-scenes layout: Track Progression is a layer (scene item) of the Gameplay scene, not a scene of its own
        gp = next((s for s in scenes() if s.get('name') == 'Overdrive · Gameplay'), None)
        check('OBS: Scene Builder put the /g/track browser source in the Gameplay scene (a layer, hidden until shown)', bool(url) and url.startswith(B) and bool(gp) and any(i['source'] == name and not i['enabled'] for i in gp['items']) and not any(s.get('name') == 'Overdrive · Track Progression' for s in scenes()), [name, url])
        g = await (await br.new_context(viewport={'width': 1920, 'height': 1080})).new_page(); g.on('pageerror', lambda e: errs.append('gfx: ' + str(e)))
        await g.goto(url); await g.wait_for_timeout(1500)
        check('no track yet: the graphic draws nothing (no invented data)', await g.query_selector('[data-track]') is None)

        # ---- the cast match and its veto (the event's own data)
        probe([wc({'k': 'teams', 'teams': ['BIG', 'FUT Esports', 'Airwalkers', 'COOK', 'Ragnarok', 'NAVI', 'rnboi', 'All Gamers Global']}), wc({'k': 'cast', 'id': 'R1_UB1'}),
               wc({'k': 'score', 'id': 'R1_UB1', 'side': 1, 'delta': 1}), wc({'k': 'veto', 'map': 'india'}), wc({'k': 'veto', 'map': 'uk'})])
        await pr.goto(f'{B}/producer'); await pr.wait_for_timeout(2200)
        await pr.click('[data-gfx-row="track"] button >> nth=0'); await pr.wait_for_timeout(900)
        check('Producer: selecting Track Progression opens its Track rounds module', await pr.query_selector('[data-track-module]') is not None)

        # ---- entered here: teams from the cast match, track 2 → UK, picked by FUT (from the veto)
        ta = await pr.eval_on_selector('select[aria-label="Team A"]', 'e => e.value'); tb = await pr.eval_on_selector('select[aria-label="Team B"]', 'e => e.value')
        mp = await pr.eval_on_selector('select[aria-label="Map"]', 'e => e.value')
        check('new track defaults: cast teams (BIG vs FUT Esports), track 2 → UK from the veto', ta == 'BIG' and tb == 'FUT Esports' and mp == 'uk', [ta, tb, mp])
        await pr.click('[data-track-start]'); await pr.wait_for_timeout(1200)
        await g.wait_for_timeout(500)
        kick = await g.inner_text('[data-track-kicker]')
        check('graphic (OBS source, no refresh): Track 2 · FUT Esports pick, United Kingdom, 0–0', 'TRACK 2' in kick.upper() and 'FUT ESPORTS PICK' in kick.upper() and 'UNITED KINGDOM' in (await g.inner_text('.trk-title')).upper(), kick)
        for k in ['3-0', '2-1', '1-1', '0-3', '1-2']:
            await pr.click(f'[data-track-add="{k}"]'); await pr.wait_for_timeout(350)
        await g.wait_for_timeout(800)
        sc = await g.eval_on_selector_all('.trk-score', 'e => e.map(x => x.textContent)')
        check('round buttons → graphic live: 7–7 after 5 rounds', sc == ['7', '7'] and await g.get_attribute('[data-track]', 'data-track-rounds') == '5', sc)
        outs = await g.eval_on_selector_all('[data-track-round]', 'e => e.map(x => x.dataset.outcome)')
        check('round cells: ACE, WIN, DRAW, ACE, WIN', outs == ['ACE', 'WIN', 'DRAW', 'ACE', 'WIN'], outs)
        await pr.click('text=Undo round'); await pr.wait_for_timeout(800)
        check('Undo → 4 rounds, 6–5', await g.get_attribute('[data-track]', 'data-track-rounds') == '4' and await g.eval_on_selector_all('.trk-score', 'e => e.map(x => x.textContent)') == ['6', '5'])
        await pr.select_option('select[aria-label="Fastest player"]', 'Heav'); await pr.fill('input[aria-label="Lap time"]', '41.237'); await pr.fill('input[aria-label="Round"]', '3')
        await pr.click('[data-track-module] >> text=Set >> nth=0'); await pr.wait_for_timeout(900)
        fl = await g.inner_text('[data-track-fastest]') if await g.query_selector('[data-track-fastest]') else ''
        check('fastest lap entered → on the graphic (FUT colour side)', 'HEAV' in fl.upper() and '41.237' in fl, fl)
        for k in ['3-0', '2-1']:
            await pr.click(f'[data-track-add="{k}"]'); await pr.wait_for_timeout(350)
        await g.wait_for_timeout(900)
        check('BIG reach 11–6 with the lead → FINAL + key takeaway', await g.get_attribute('[data-track]', 'data-track-state') == 'final' and 'BIG' in await g.inner_text('[data-track-narrative]'))
        await g.screenshot(path=f'{OUT}/track-manual.png')

        # ---- Google Sheet: Control tab (out_track_progression)
        await pr.click('[data-track-module] >> text=Google Sheet'); await pr.wait_for_timeout(2500)
        await g.wait_for_timeout(600)
        check('Source → Google Sheet: Control tab loaded (NaVi x Joel → NAVI vs Nyxar Competitive, Egypt)', 'EGYPT' in (await g.inner_text('.trk-title')).upper() and 'NATUS' in (await g.inner_text('.trk-board')).upper() and 'NYXAR' in (await g.inner_text('.trk-board')).upper())
        check('sheet logos resolve to Overdrive logos (navixjoel, nyxar)', await g.eval_on_selector_all('.trk-logo img', 'e => e.map(x => x.src.split("/").pop())') == ['navixjoel.png', 'nyxar.png'])
        check('module: "Loaded" status', 'Loaded' in await pr.inner_text('[data-track-sheet-status]'))

        # ---- Match + track: db_rounds_flat query
        await pr.click('[data-track-module] >> text=Match + track'); await pr.wait_for_timeout(1200)
        await pr.fill('[data-track-match]', 'match_0006'); await pr.press('[data-track-match]', 'Tab'); await pr.wait_for_timeout(2000)
        await g.wait_for_timeout(600)
        sc = await g.eval_on_selector_all('.trk-score', 'e => e.map(x => x.textContent)')
        check('Match + track (match_0006, track 1): Czech, BIG vs FUT 12–8 final, 7 rounds', 'CZECH' in (await g.inner_text('.trk-title')).upper() and sc == ['12', '8'] and await g.get_attribute('[data-track]', 'data-track-state') == 'final', sc)
        fl = await g.inner_text('[data-track-fastest]')
        check('fastest lap from the sheet (Heav 38.104, R4)', 'HEAV' in fl.upper() and '38.104' in fl and 'R4' in fl.upper(), fl)

        # ---- auto refresh: a new round row in the sheet appears by itself
        await pr.click('[data-track-auto] button'); await pr.wait_for_timeout(600)
        rows = list(csv.reader(open(f'{FX}/db_rounds_flat.csv')))
        new = [''] * 28; new[:11] = ['match_0006', '1', '8', '', '', 'BIG', 'FUT', '0', '3', '3-4', '1-2']
        with open(f'{FX}/db_rounds_flat.csv', 'a', newline='') as f: csv.writer(f).writerow(new)
        await g.wait_for_timeout(10500)
        sc = await g.eval_on_selector_all('.trk-score', 'e => e.map(x => x.textContent)')
        check('Auto refresh (8 s): round 8 from the sheet appears without touching anything (12–11)', await g.get_attribute('[data-track]', 'data-track-rounds') == '8' and sc == ['12', '11'], sc)

        # ---- a broken source: clear error, the last good data stays on air
        await pr.click('[data-track-module] >> text=Control tab'); await pr.wait_for_timeout(1500)
        before = await g.get_attribute('[data-track]', 'data-track-rounds')
        await pr.fill('input[aria-label="Control tab"]', 'no_such_tab'); await pr.press('input[aria-label="Control tab"]', 'Tab'); await pr.wait_for_timeout(2000)
        st = await pr.inner_text('[data-track-sheet-status]')
        check('missing tab → error in the module, graphic keeps the last good track', 'Sheet' in st and before == '4' and await g.get_attribute('[data-track]', 'data-track-rounds') == before, [st, before])
        await pr.click('[data-track-auto] button'); await pr.wait_for_timeout(400)

        # ---- demo + clear
        await pr.click('[data-track-module] >> text=Demo track'); await pr.wait_for_timeout(1000)
        check('Demo track: labelled DEMO DATA on the graphic', await g.query_selector('[data-track-demo]') is not None)
        await pr.click('[data-track-module] >> text=Clear'); await pr.wait_for_timeout(900)
        check('Clear: the graphic draws nothing', await g.query_selector('[data-track]') is None)

        # ---- 4K
        g4 = await (await br.new_context(viewport={'width': 3840, 'height': 2160})).new_page()
        probe([wc({'k': 'track-src', 'patch': {'mode': 'sheet', 'match': 'match_0006', 'track': 1}})]); await g4.goto(url); await g4.wait_for_timeout(2500)
        w = await g4.evaluate("() => { const e = document.querySelector('.trk-chart'); return e ? Math.round(e.getBoundingClientRect().width) : 0 }")
        check('4K source: native 2× (chart 3456 px wide)', w == 3456, w)
        await g4.screenshot(path=f'{OUT}/track-sheet-4k.png')
        await pr.screenshot(path=f'{OUT}/track-producer.png')
        check('no page errors', not errs, errs[:3])
        await br.close()
    print(f'\n{sum(res)}/{len(res)} passed')

asyncio.run(main())

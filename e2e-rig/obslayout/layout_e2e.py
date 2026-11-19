"""3.2 simplified OBS layout, end to end: real server + real ObsBridge against the obs-websocket protocol MOCK (not real OBS).
1) a 3.1 collection (one scene per output) with the operator's own additions, 2) switch to the nine main scenes and Build All
(migration: reuse, nothing deleted), 3) the dry-run cleanup report in the OBS Setup UI and a confirmed removal,
4) Producer Mode: prepare layers off-air, TAKE, on-air overlay, Safe / BRB, rundown GO."""
import asyncio, json, subprocess, urllib.request
from playwright.async_api import async_playwright
B, M, R = 'http://localhost:8787', 'http://127.0.0.1:4456', __file__.rsplit('/e2e-rig/', 1)[0]
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  {extra}' if extra else ''))
def get(p): return json.loads(urllib.request.urlopen(M + p).read())
def state(): return get('/state')
def prog(): return get('/program')
def probe(msgs): return json.loads(subprocess.run(['node', f'{R}/e2e-rig/mvp4/probe.mjs', json.dumps(msgs)], capture_output=True, text=True).stdout)
C = lambda **c: {'t': 'cmd', 'cmd': c}
def scene(n): return next((s for s in state()['scenes'] if s['name'] == n), None)
def input_by_url(part):
    return [i['name'] for i in state()['inputs'] if part in str((i.get('settings') or {}).get('url', ''))]
def on(sc, inp):
    s = scene(sc); return bool(s) and any(i['source'] == inp and i['enabled'] for i in s['items'])
def browser_count(): return len([i for i in state()['inputs'] if i['kind'] == 'browser_source'])
G, MV, SAFE, INT = 'Overdrive · Gameplay', 'Overdrive · MVP', 'Overdrive · Safe / BRB', 'Overdrive · Intermission'

async def main():
    # ---- 1) a 3.1 collection
    d = probe([C(c='obs-setup', action='options', options={'layout': 'per-output'}), C(c='obs-setup', action='preview', mode='build', targets='all'), {'apply': True}, {'wait': 1500}])
    old = [s['name'] for s in state()['scenes']]
    check('1 a 3.1 collection: one scene per output', len(old) >= 24, f'{len(old)} scenes')
    urllib.request.urlopen(f'{M}/add-audio?scene=Overdrive%20%C2%B7%20Interview&name=Guest%20webcam&kind=dshow_input')
    urllib.request.urlopen(f'{M}/add-scene?scene=My%20sponsor%20loop')
    probe([C(c='scene-take', target='g:caster-desk', transition='cut'), {'wait': 600}])
    uuids = {i['name']: i['uuid'] for i in state()['inputs']}
    n_browser = browser_count()

    # ---- 2) migrate
    probe([C(c='obs-setup', action='options', options={'layout': 'main'}), C(c='obs-setup', action='preview', mode='build', targets='all'), {'apply': True}, {'wait': 1500}])
    names = [s['name'] for s in state()['scenes']]
    mains = ['Overdrive · Starting Soon', G, 'Overdrive · Caster Desk', 'Overdrive · Analyst Desk', MV, INT, 'Overdrive · Ending', SAFE, 'Overdrive · Team Introduction']
    check('2 Build All creates / reuses the nine main scenes', all(n in names for n in mains), [n for n in mains if n not in names])
    check('2 nothing deleted or renamed: every 3.1 scene still exists', all(n in names for n in old))
    check('2 no duplicate browser sources (the existing ones are reused, same uuid; + the one MVP Preview identity)', browser_count() == n_browser + 1 and all(state_i['uuid'] == uuids[state_i['name']] for state_i in state()['inputs'] if state_i['name'] in uuids), f'{browser_count()} vs {n_browser}')
    check('2 Program never switched by the build', prog()['program'] == 'Overdrive · Caster Desk', prog())

    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # ---- 3) OBS Setup UI: overview + dry-run cleanup + confirmed removal
        await pg.add_init_script("if(!sessionStorage.getItem('i')){sessionStorage.setItem('i','1');localStorage.clear();localStorage.setItem('od2.mode','studio');localStorage.setItem('od.studio.section','\"obs\"');localStorage.setItem('od.studio.tabs',JSON.stringify({obs:'builder'}))}")
        await pg.goto(f'{B}/producer'); await pg.wait_for_selector('[data-obs-setup]'); await pg.wait_for_selector("[data-obs-conn='on']", timeout=10000)
        await pg.wait_for_selector('[data-main-overview]', timeout=10000)
        chips = await pg.locator('[data-main-scene][data-exists="1"]').count()
        check('3 OBS Setup shows the nine main scenes, all built', chips == 9, chips)
        check('3 layout selector on "Nine main scenes"', await pg.locator('[data-opt="layout"]').input_value() == 'main')
        before = json.dumps(state()['scenes'])
        await pg.click('[data-act="cleanup"]'); await pg.wait_for_selector('[data-cleanup-scene]', timeout=10000)
        await pg.wait_for_timeout(500)
        check('3 the cleanup report is a dry run (OBS unchanged)', json.dumps(state()['scenes']) == before)
        cls = {await r.get_attribute('data-cleanup-scene'): await r.get_attribute('data-cls') for r in await pg.locator('[data-cleanup-scene]').all()}
        check('3 report: main scenes / consolidate / kept / not Overdrive\'s', cls.get(G) == 'main' and cls.get('Overdrive · MVP (Preview identity)') == 'main' and cls.get('Overdrive · Scoreboard') == 'consolidate' and cls.get('Overdrive · Interview') == 'keep' and cls.get('My sponsor loop') == 'not-overdrive' and cls.get('Scene') == 'not-overdrive', {k: v for k, v in cls.items() if v != 'consolidate'})
        check('3 the scene on Program is never offered for removal', cls.get('Overdrive · Caster Desk') == 'main')
        await pg.screenshot(path='/home/claude/out/obs-cleanup-report.png')
        btn = pg.locator('[data-cleanup-apply]')
        check('3 Remove is disabled until REMOVE is typed', not await btn.is_enabled())
        await pg.fill('[data-cleanup-confirm]', 'remove'); check('3 … lower-case does not count', not await btn.is_enabled())
        await pg.fill('[data-cleanup-confirm]', 'REMOVE'); await btn.click()
        await pg.wait_for_selector('[data-cleanup-result]', timeout=15000); await pg.wait_for_timeout(800)
        names2 = [s['name'] for s in state()['scenes']]
        consolidated = [k for k, v in cls.items() if v == 'consolidate']
        check('3 confirmed: the consolidatable scenes are gone', all(n not in names2 for n in consolidated), [n for n in consolidated if n in names2])
        check('3 kept, foreign and main scenes untouched', all(n in names2 for n in ['Overdrive · Interview', 'My sponsor loop', 'Scene'] + mains))
        check('3 no source lost except the 5 retired per-view MVP sources (drawn by the one MVP source now)', browser_count() == n_browser + 1 - 5, f'{browser_count()} vs {n_browser}')
        check('3 Program untouched by the cleanup', prog()['program'] == 'Overdrive · Caster Desk')
        print('   OBS now:', ' | '.join(names2))
        await pg.click('[data-cleanup-close]')
        await pg.click('[data-act="verify"]'); await pg.wait_for_timeout(1500)

        # ---- 4) Producer Mode (Control room)
        await pg.evaluate("localStorage.setItem('od2.mode','live');localStorage.setItem('od3.ui','room')")
        await pg.goto(f'{B}/producer?ui=room'); await pg.wait_for_selector('[data-control-room]'); await pg.wait_for_timeout(2000)
        tiles = await pg.eval_on_selector_all('[data-room-scene]', 'e => e.map(x => x.getAttribute("data-room-scene"))')
        check('4 nine main scene tiles in the order asked', [t.split(':')[-1] for t in tiles][:9] == ['starting', 'gameplay', 'caster-desk', 'analyst-desk', 'mvp', 'brb', 'ending', 'safe', 'team-intro'], tiles)
        veto = input_by_url('/output/screen/veto')[0]; gpo = input_by_url('/g/gameplay')[0]; trk = input_by_url('/g/track')[0]
        # prepare Gameplay off air, then the Map Veto panel in it
        await pg.locator('[data-room-scene$="gameplay"]').first.click(); await pg.wait_for_timeout(800)
        check('4 Gameplay tile: OBS Preview = Gameplay, Program untouched', prog()['preview'] == G and prog()['program'] == 'Overdrive · Caster Desk', prog())
        lay = await pg.eval_on_selector_all('[data-room-layer]', 'e => e.map(x => x.getAttribute("data-room-layer"))')
        check('4 the OBS layers of Gameplay are listed (overlay base, veto, scoreboard, track)', all(t in lay for t in ['g:gameplay', 's:veto', 'g:scoreboard', 'g:track']), lay)
        await pg.click('[data-room-layer="s:veto"]'); await pg.wait_for_timeout(800)
        check('4 Map Veto prepared OFF AIR: shown in Gameplay (in Preview), gameplay overlay hidden, Program untouched', on(G, veto) and not on(G, gpo) and prog()['program'] == 'Overdrive · Caster Desk', prog())
        check('4 the layer chip shows it shown, off air', await pg.locator('[data-room-layer="s:veto"]').get_attribute('data-on') == '1' and 'OFF AIR' in await pg.inner_text('[data-room-layers]'))
        await pg.click('[data-room-take]'); await pg.wait_for_timeout(1500)
        check('4 TAKE: Gameplay (with the veto) on Program', prog()['program'] == G and on(G, veto), prog())
        # on air: overlay toggles live
        await pg.click('[data-room-layer="g:track"]'); await pg.wait_for_timeout(800)
        check('4 on air: Track Progression overlay shown live on top', on(G, trk) and on(G, veto) and prog()['program'] == G)
        await pg.click('[data-room-layer="g:gameplay"]'); await pg.wait_for_timeout(800)
        check('4 on air: back to the gameplay overlay (veto hidden), Track stays', on(G, gpo) and not on(G, veto) and on(G, trk))
        await pg.click('[data-room-layer="g:track"]'); await pg.wait_for_timeout(800)
        check('4 overlay hidden again', not on(G, trk))
        # preview another layer of the ON-AIR scene: never changes Program
        snap = json.dumps(scene(G)['items'])
        await pg.locator('[data-bank-tab="lib"]').click(); await pg.wait_for_timeout(400)
        # selecting the scoreboard graphic (a layer of the on-air scene) must not change what is on air
        r = probe([C(c='obs-preview', scene=G, target='g:scoreboard'), {'wait': 400}])
        check('4 preparing a layer of the ON-AIR scene changes nothing in OBS (it waits for TAKE)', json.dumps(scene(G)['items']) == snap and r['acks'][0].get('ok'), r['acks'][0])
        await pg.locator('[data-bank-tab="main"]').click()
        # Safe / BRB
        await pg.locator('[data-room-scene$="safe"]').first.click(); await pg.wait_for_timeout(600)
        await pg.click('[data-room-cut]'); await pg.wait_for_timeout(1200)
        brb = input_by_url('/output/screen/brb')
        check('4 Safe / BRB on Program with CUT', prog()['program'] == SAFE, prog())
        check('4 Safe / BRB shows the BRB card through the same source as Intermission (one browser source)', len(brb) == 1 and on(SAFE, brb[0]) and any(i['source'] == brb[0] for i in scene(INT)['items']))
        check('4 Safe / BRB: music only, no live caster mic', any(i['source'] == 'Overdrive Music' for i in scene(SAFE)['items']) and not any('Caster' in i['source'] and 'audio' in i['source'] for i in scene(SAFE)['items']))
        tally = await pg.locator('[data-room-scene$="safe"]').first.get_attribute('data-tally')
        check('4 Safe tile tally = PGM', tally == 'pgm', tally)
        # MVP: a view prepared off air, TAKE
        d2 = probe([C(c='obs-preview', scene=MV, target='s:mvp-closed'), {'wait': 500}])
        check('4 MVP view prepared on the MVP Preview identity (OBS Preview), Program = Safe untouched', d2['mvp'].get('prepared') == 'closed' and prog()['program'] == SAFE and prog()['preview'] == 'Overdrive · MVP (Preview identity)', [prog(), d2['mvp']])
        # rundown GO onto a layer target
        d3 = probe([C(c='sp-seg-add', seg={'label': 'Track check', 'target': 'g:track', 'transition': 'cut'}), {'wait': 300}])
        sid = next((x['id'] for x in d3.get('segs', []) if x['label'] == 'Track check'), None)
        d4 = probe([C(c='sp-next', id=sid), {'wait': 200}, C(c='sp-go'), {'wait': 1200}])
        check('4 rundown GO on a layer target: Gameplay on Program with Track Progression shown', prog()['program'] == G and on(G, trk) and d4.get('onAirSeg') == sid, [prog()['program'], d4['acks'][-1]])
        await pg.wait_for_timeout(500)
        check('4 no page errors', not errs, errs[:3])
        await pg.screenshot(path='/home/claude/out/obs-layers-room.png')
        await br.close()
    check('5 still exactly one browser source per output (no duplicates after all of it)', browser_count() == n_browser + 1 - 5, f'{browser_count()} vs {n_browser}')
    check('5 the removal requests were only the confirmed cleanup', all(l['req'] in ('RemoveScene', 'RemoveSceneItem') for l in state()['log'] if l['req'].startswith('Remove')))
    print(f'\n{ok} passed, {bad} failed')
asyncio.run(main())

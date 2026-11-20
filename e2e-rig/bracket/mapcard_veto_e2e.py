"""Map card follows the veto (map-next, map number + picker) and no gameplay popup for the match on stream. Needs e2e-rig/4k/fixture.sh."""
import asyncio, json, os, sys
sys.path.insert(0, '/home/claude/overdrive-caster/e2e-rig/4k'); os.environ['OD_STATE'] = '/tmp/od4k/state.json'
from vis import engine
from playwright.async_api import async_playwright
B='http://localhost:8787'; R=[]
def ok(n,c,i=''): R.append(c); print(('PASS ' if c else 'FAIL ')+n+(f'  [{i}]' if i else ''))
def wc(op): return engine({'c': 'op-wc', 'op': op})
def st(): return json.load(open('/tmp/od4k/state.json'))
async def m():
    s = st()['wildcard']; R1 = s['matches']
    wc({'k': 'cast', 'id': 'R1_UB2'})
    for id in ('R1_UB2', 'R1_UB3'):
        for side in (1, 2): pass
    wc({'k': 'veto-reset'}); wc({'k': 'veto', 'map': 'uk'}); wc({'k': 'veto', 'map': 'czech'}); await asyncio.sleep(1)
    w = st()['wildcard']; print('cast', w['cast'], 'intro', w['intro']['a'], w['intro']['b'], 'veto', w['veto']['done'], 'game', st()['showLive']['game'])
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome'); p = await (await b.new_context(viewport={'width':1920,'height':1080})).new_page()
        pops = []
        p.on('websocket', lambda ws: ws.on('framereceived', lambda f: pops.append(json.loads(f)['pop']) if isinstance(f, str) and '"wc-pop"' in f else None))
        await p.goto(B + '/output/screen/gameplay'); await p.wait_for_timeout(2500)
        wc({'k': 'map-next'}); await p.wait_for_timeout(1500)
        ok('map-next plays map 1 of the veto (UK)', st()['wildcard']['map']['id'] == 'uk')
        k = await p.locator('.mc-k').inner_text(); pk = await p.locator('[data-map-pick]').inner_text()
        ok('card says Map 1 + picked by team A', k.upper().startswith('MAP 1') and w['intro']['a'].upper() in pk.upper(), f'{k} | {pk}')
        await p.screenshot(path='/tmp/mv-1.png')
        pops.clear()
        wc({'k': 'score', 'id': 'R1_UB2', 'side': 1, 'delta': 1}); await p.wait_for_timeout(1200)
        ok('no popup for a map won in the match on stream', not [x for x in pops if x.get('id') == 'R1_UB2'], pops)
        ok('series now on game 2', st()['showLive']['game'] == 2, st()['showLive']['game'])
        wc({'k': 'map-next'}); await p.wait_for_timeout(1500)
        k = await p.locator('.mc-k').inner_text(); pk = await p.locator('[data-map-pick]').inner_text()
        ok('map-next now plays map 2 (Czech Republic), picked by team B', st()['wildcard']['map']['id'] == 'czech' and k.upper().startswith('MAP 2') and w['intro']['b'].upper() in pk.upper(), f'{k} | {pk}')
        await p.screenshot(path='/tmp/mv-2.png')
        pops.clear(); wc({'k': 'score', 'id': 'R1_UB3', 'side': 1, 'delta': 1}); await p.wait_for_timeout(1200)
        ok('other matches still pop up', any(x.get('id') == 'R1_UB3' for x in pops), [x.get('id') for x in pops])
        wc({'k': 'score', 'id': 'R1_UB2', 'side': 2, 'delta': 1}); wc({'k': 'score', 'id': 'R1_UB2', 'side': 2, 'delta': 1}); await p.wait_for_timeout(500)
        wc({'k': 'map-next'}); await p.wait_for_timeout(500)
        ok('map 4 not in the veto yet: nothing played', st()['wildcard']['map']['id'] == 'czech')
        await b.close()
    print(f'{sum(R)}/{len(R)}')
asyncio.run(m())

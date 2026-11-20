"""Overdrive 3.0 · MVP integration with the ONLINE vote service (public voting website), end to end.

The real vote service (vote/server.ts on a real PostgreSQL 16, through the rig's small wire client in place of the
`pg` package), the real Overdrive server, the real public voting page (/vote) and Producer page in headless Chrome,
viewers signing in with the service's test login (VOTE_DEV_LOGIN — Twitch sign-in itself is not reachable here).

  bash e2e-rig/mvp4/run-online.sh <build dir>
"""
import asyncio, http.cookiejar, json, subprocess, urllib.request
from playwright.async_api import async_playwright

B, V, M, R = 'http://localhost:8787', 'http://localhost:8790', 'http://127.0.0.1:4456', __file__.rsplit('/e2e-rig/', 1)[0]
OUT = '/home/claude/out'
res = []
def check(name, ok, extra=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or extra == '' else f'  [{extra}]'), flush=True)
def get(u): return json.loads(urllib.request.urlopen(u).read())
def probe(msgs=()): return json.loads(subprocess.run(['node', f'{R}/e2e-rig/mvp4/probe.mjs', json.dumps(list(msgs))], capture_output=True, text=True).stdout)
def wc(op): return {'t': 'wc', 'op': op}
def score(mid, a, b): return [wc({'k': 'score', 'id': mid, 'side': 2, 'delta': 1})] * b + [wc({'k': 'score', 'id': mid, 'side': 1, 'delta': 1})] * a
def viewer(name):
    jar = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.open(urllib.request.Request(f'{V}/auth/dev', data=json.dumps({'name': name}).encode(), headers={'content-type': 'application/json'}))
    return op
def vote(op, poll, player):
    try: return json.loads(op.open(urllib.request.Request(f'{V}/v1/mvp', data=json.dumps({'poll': poll, 'player': player}).encode(), headers={'content-type': 'application/json'})).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
def pub(): return get(f'{V}/v1/state')

TEAMS = ['BIG', 'FUT Esports', 'Airwalkers', 'COOK', 'Ragnarok', 'NAVI', 'rnboi', 'All Gamers Global']

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1480})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        pr = await ctx.new_page()
        await pr.add_init_script("localStorage.setItem('od2.mode','live'); localStorage.setItem('od3.lib','scenes')")
        await pr.goto(f'{B}/producer'); await pr.wait_for_timeout(2500)
        s = probe()
        check('online vote service configured: MVP counting = online', s['mode'] == 'online', s['mode'])

        # ---- a match finishes: prepared on the ONLINE service automatically
        probe([wc({'k': 'teams', 'teams': TEAMS}), wc({'k': 'cast', 'id': 'R1_UB1'})] + score('R1_UB1', 3, 1) + [{'wait': 1500}])
        await pr.wait_for_timeout(2500)
        s = probe()
        check('match completed → MVP vote prepared on the online service (id from the service, all 4 players)', s['poll'] and s['poll']['id'].startswith('major26:R1_UB1') and s['poll']['status'] == 'draft' and len(s['poll']['players']) == 4, s['poll'])
        ps = pub()
        m = next((x for x in ps.get('matches', []) if x['id'] == 'R1_UB1'), None)
        check('public website: the finished match with its result (pushed by the broadcast server)', m and m['winner'] == 'BIG' and m['score'] == '3-1', m)
        check('public website: a prepared vote is NOT shown before it opens', not any(x['match'] == 'R1_UB1' for x in ps.get('polls', [])))

        # ---- the producer opens voting; the public page shows it; the voting graphic shows the website QR
        await pr.click('[data-mvp-chip]'); await pr.wait_for_timeout(1000)
        await pr.click('[data-mvp-start]'); await pr.wait_for_timeout(2500)
        page = await br.new_page(); await page.goto(f'{V}/vote'); await page.wait_for_timeout(2500)
        body = await page.inner_text('body')
        check('public voting page: the open MVP vote with the 4 players of BIG vs FUT Esports', all(h.lower() in body.lower() for h in ['Massa', 'GranaDy', 'Heav', 'Nayko']), body[:300])
        await page.screenshot(path=f'{OUT}/mvp-public-page.png', full_page=True)
        g = await (await br.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
        await g.goto(f'{B}/g/mvp?view=voting'); await g.wait_for_timeout(2000)
        check('voting graphic: website QR code (Scan to vote) with the public address', await g.query_selector('.qrbox:not(.chat):not(.done)') is not None and 'overdrive-vote.onrender.com' in await g.inner_text('body'))

        # ---- viewers vote on the website; the producer sees it live; one vote per viewer
        poll = s['poll']['id']
        v1, v2, v3 = viewer('alice'), viewer('bob'), viewer('carol')
        r1, r2, r3 = vote(v1, poll, 'GranaDy'), vote(v2, poll, 'GranaDy'), vote(v3, poll, 'Heav')
        check('website votes accepted', r1.get('ok') and r2.get('ok') and r3.get('ok'), [r1, r2, r3])
        again = vote(v1, poll, 'Heav')
        check('one vote per viewer (a second vote keeps the first)', again.get('already') and again.get('player') == 'GranaDy', again)
        check('a player of another match is refused', vote(viewer('dave'), poll, 'Whizzy').get('ok') is not True)
        await pr.wait_for_timeout(3500)
        total = await pr.inner_text('[data-mvp-total]')
        check('producer: 3 website votes, live (private)', total.startswith('3 votes') and 'web 3' in total, total)

        # ---- the next match ends during voting: queued, the online vote untouched
        probe(score('R1_UB2', 3, 0) + [{'wait': 1500}])
        s = probe()
        check('another result during voting → queued, the online vote of R1_UB1 still open', s['notice']['kind'] == 'queued' and s['poll']['status'] == 'open' and s['mvp']['match'] == 'R1_UB1', s['notice'])

        # ---- stop, reveal on air → the public page shows the result (only then)
        await pr.click('[data-mvp-stop]'); await pr.wait_for_timeout(3000)
        pp = next((x for x in pub()['polls'] if x['id'] == poll), {})
        check('closed: the public page says voting closed, result hidden until the reveal', pp.get('status') == 'closed' and pp.get('frozen') is None, pp)
        await pr.click('[data-mvp-view="winner"]'); await pr.wait_for_timeout(500)
        await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(300); await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(4000)
        pp = next((x for x in pub()['polls'] if x['id'] == poll), {})
        check('REVEAL on air → the public page shows the revealed result (GranaDy 2 of 3)', pp.get('status') == 'revealed' and pp.get('frozen', {}).get('counts', {}).get('GranaDy') == 2, pp)

        # ---- rehearsal while online: NOTHING reaches the online service
        before = json.dumps(pub()['matches'])
        await pr.click('[data-demo-load]'); await pr.wait_for_timeout(2500)
        s = probe()
        check('rehearsal: counting local even though the online service is configured', s['rehearsal'] and s['mode'] == 'local', s['mode'])
        await pr.click('[data-demo-finish]'); await pr.wait_for_timeout(2500)
        await pr.click('[data-mvp-start]'); await pr.wait_for_timeout(1500)
        await pr.wait_for_timeout(2500)
        after = pub()
        check('rehearsal: the public website never sees the demo teams or the demo vote', json.dumps(after['matches']) == before and not any('DEMO' in json.dumps(x) for x in after['polls']), [x['id'] for x in after['polls']])
        await pr.click('[data-mvp-stop]'); await pr.wait_for_timeout(1200)
        await pr.click('[data-demo-leave]'); await pr.wait_for_timeout(3000)
        s = probe()
        check('leave rehearsal → online counting again, real votes intact', not s['rehearsal'] and s['mode'] == 'online' and any(x.startswith('R1_UB1:revealed') for x in s['polls']), [s['mode'], s['polls']])

        # ---- a team only known from this event's roster: the online service would refuse it → clear guidance
        probe([wc({'k': 'teams', 'teams': ['BIG', 'FUT Esports', 'Airwalkers', 'COOK', 'Mystery Five', 'NAVI', 'rnboi', 'All Gamers Global']}), wc({'k': 'roster', 'team': 'Mystery Five', 'players': ['Alpha5', 'Beta5']})])
        await pr.click('[data-main-scene="analyst-desk"]'); await pr.wait_for_timeout(300); await pr.click('[data-transport-cut]'); await pr.wait_for_timeout(1000)  # MVP off air
        probe(score('R1_UB3', 3, 0) + [{'wait': 1500}])
        s = probe()
        check('online + event roster: not prepared online, producer told to count locally', s['mvp']['match'] == 'R1_UB3' and s['poll'] is None and s['notice']['kind'] == 'error' and 'Local' in s['notice']['text'], s['notice'])
        await pr.click('[data-mvp-chip]'); await pr.wait_for_timeout(800)
        await pr.click('[data-mvp-ready-toggle]'); await pr.wait_for_timeout(300)
        check('readiness names it (Online voting)', await pr.get_attribute('[data-mvp-check="online-roster"]', 'data-tone') == 'bad')
        await pr.click('[data-mvp-controls] >> text=Local'); await pr.wait_for_timeout(2000)
        await pr.click('[data-mvp-prepare]'); await pr.wait_for_timeout(2000)
        s = probe()
        check('Counting → Local, Prepare → vote with the event roster', s['mode'] == 'local' and s['poll'] and s['poll']['players'][:2] == ['Alpha5', 'Beta5'], [s['mode'], s['poll']])
        await br.close()
    print(f'\n{sum(res)}/{len(res)} passed')

import urllib.error
asyncio.run(main())

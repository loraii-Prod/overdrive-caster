"""Audience interaction end to end: the real vote service (Postgres), the real broadcast server and the real /g/ graphics.

Runs the full producer workflow (create match → open voting → test votes → lock → desk picks → reveal on air →
verified winner → scoreboard → MVP open → close → reveal → community vs desk), plus invalid votes, duplicates,
simultaneous voters, a vote-service outage, and restarts of both services.

Needs: Postgres on 127.0.0.1:5433 (user vote, db vote), `npm run build`, a seed state in /tmp/oddata-vq.
    python3 e2e-rig/audience/aud_e2e.py
"""
import asyncio, http.cookiejar, json, os, shutil, signal, subprocess, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V = 'http://localhost:8790'; B = 'http://localhost:8787'; D = '/tmp/oddata-aud-e2e'; OUT = '/tmp/aud-e2e'
SECRET = 'e2e-secret-0123456789abcdefghij'
DBURL = 'postgres://vote@127.0.0.1:5433/vote'
os.makedirs(OUT, exist_ok=True)
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)

procs = {}
def start_vote():
    env = {**os.environ, 'DATABASE_URL': DBURL, 'VOTE_SECRET': SECRET, 'VOTE_DEV_LOGIN': '1', 'PORT': '8790'}
    env.pop('RENDER', None); env.pop('NODE_ENV', None)
    procs['vote'] = subprocess.Popen(['node', 'dist/vote.js'], cwd=ROOT, env=env, stdout=open('/tmp/aud-vote.log', 'a'), stderr=subprocess.STDOUT)
    wait_http(V + '/healthz')
def start_bcast():
    env = {**os.environ, 'PORT': '8787', 'DATA_DIR': D, 'CONTROLLER_PASSWORD': 'testpw', 'ADMIN_PASSWORD': 'adminpw',
           'VOTE_URL': 'http://127.0.0.1:8790', 'VOTE_SECRET': SECRET, 'VOTE_PUBLIC_URL': 'https://overdrive-vote.onrender.com/vote'}
    procs['bcast'] = subprocess.Popen(['node', 'dist/server.js'], cwd=ROOT, env=env, stdout=open('/tmp/aud-bcast.log', 'a'), stderr=subprocess.STDOUT)
    wait_http(B + '/api/session')
def stop(k):
    p = procs.pop(k, None)
    if p: p.send_signal(signal.SIGTERM); p.wait(10)
def wait_http(u, t=20):
    end = time.time() + t
    while time.time() < end:
        try: urllib.request.urlopen(u, timeout=1); return
        except urllib.error.HTTPError: return
        except Exception: time.sleep(0.2)
    raise RuntimeError('not up: ' + u)

def tok(): return json.load(open(f'{D}/state.json'))['apiToken']
def bstate(): return json.load(open(f'{D}/state.json'))
def engine(cmd):
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
def wcop(op):
    r = urllib.request.Request(f'{B}/api/v1/msg?token={tok()}', data=json.dumps({'t': 'wc', 'op': op}).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())

class Viewer:
    """One phone: its own cookie jar, signed in through the dev login."""
    def __init__(self, name):
        self.jar = http.cookiejar.CookieJar(); self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar)); self.name = name
        if name: self.post('/auth/dev', {'name': name})
    def post(self, path, body, raw=None):
        data = raw if raw is not None else json.dumps(body).encode()
        r = urllib.request.Request(V + path, data=data, headers={'content-type': 'application/json'}, method='POST')
        try: x = self.o.open(r, timeout=10); return x.status, json.loads(x.read() or b'{}')
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read() or b'{}')
            except Exception: return e.code, {}
    def get(self, path):
        return json.loads(self.o.open(V + path, timeout=10).read())

def sql(q):
    return subprocess.run(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', 'vote', '-d', 'vote', '-tAc', q], capture_output=True, text=True).stdout.strip()

async def ws_op(pg, op):
    """Send a producer audience command over the producer's own WebSocket session; returns the error or None."""
    return await pg.evaluate("""op => new Promise(res => {
      const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
      const id = Math.random().toString(36).slice(2);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
      ws.onmessage = e => { const m = JSON.parse(e.data);
        if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'aud', id, op }));
        if (m.t === 'aud-ack' && m.id === id) { ws.close(); res(m.ok ? null : m.error); } };
      setTimeout(() => res('timeout'), 9000);
    })""", op)
async def priv(pg):
    return await pg.evaluate("""() => new Promise(res => {
      const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' }));
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'aud-private') { ws.close(); res(m.aud); } };
      setTimeout(() => res(null), 5000);
    })""")
def gfx(gid): return next(g for g in bstate()['graphics'] if g['id'] == gid)
def publish(gid, patch):
    engine({'c': 'gfx-set', 'id': gid, 'patch': patch}); return engine({'c': 'gfx-publish', 'id': gid})

async def main():
    # ---------- fresh stores
    sql('drop table if exists audit, mvp_votes, polls, champion_picks, picks, viewer_sessions, viewers, matches, sessions, meta cascade')
    shutil.rmtree(D, ignore_errors=True); shutil.copytree('/tmp/oddata-vq', D)
    s = json.load(open(f'{D}/state.json')); s.pop('audience', None)
    for k, m in s['wildcard']['matches'].items(): m.update({'s1': '', 's2': '', 'live': False})
    s['wildcard']['cast'] = 'R1_UB1'; s['wildcard']['pickem'] = {}
    json.dump(s, open(f'{D}/state.json', 'w'))
    start_vote(); start_bcast()
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        prod = await br.new_page(); await prod.request.post(B + '/api/login', data={'password': 'testpw'}); await prod.goto(B + '/api/session')
        src = await br.new_page(viewport={'width': 1920, 'height': 1080})
        shot = lambda name: src.screenshot(path=f'{OUT}/{name}.png')
        seq0 = {g['id']: g['anim']['seq'] for g in bstate()['graphics']}

        # 1 create match: the bracket's first-round matches reach the vote service, only verified teams
        await asyncio.sleep(3)
        st = Viewer(None).get('/v1/state')
        ids = [m['id'] for m in st.get('matches', [])]
        check('1 matches with both teams known reach the public page', ids == ['R1_UB1', 'R1_UB2', 'R1_UB3', 'R1_UB4'], ids)
        check('1 …with the verified team names', st['matches'][0]['a'] == 'BIG' and st['matches'][0]['b'] == 'FUT Esports')
        check('1 matches without both teams are not listed (no invented pairings)', not any(i.startswith('R2') for i in ids))

        # 2 + 3 public voting + test votes (through the real page for one viewer)
        ph = await br.new_page(viewport={'width': 390, 'height': 844}); await ph.goto(V + '/vote')
        await ph.fill('input[aria-label="Test name"]', 'phoneuser'); await ph.press('input[aria-label="Test name"]', 'Enter'); await ph.wait_for_timeout(1500)
        await ph.click('section[aria-label="BIG vs FUT Esports"] button:has-text("BIG")'); await ph.wait_for_timeout(600)
        await ph.click('section[aria-label="BIG vs FUT Esports"] button:has-text("3-1")'); await ph.wait_for_timeout(900)
        await ph.screenshot(path=f'{OUT}/phone_picks.png')
        check('3 a phone picks BIG 3-1 on the real page', sql("select team||' '||score from picks p join viewers v on v.id=p.viewer where v.name='phoneuser'") == 'BIG 3-1')
        check('3 the page confirms the save', await ph.locator('text=Saved: BIG 3-1').count() >= 1)
        voters = [Viewer(f'v{i:03d}') for i in range(60)]
        plan = [('BIG', '3-1')] * 25 + [('BIG', '3-0')] * 10 + [('FUT Esports', '3-2')] * 15 + [('FUT Esports', '')] * 10
        for v, (t, sc) in zip(voters, plan): v.post('/v1/pick', {'match': 'R1_UB1', 'team': t, 'score': sc})
        for v in voters[:40]: v.post('/v1/champion', {'team': 'BIG' if int(v.name[1:]) % 3 else 'Natus Vincere'})
        check('3 60 viewers + the phone = 61 picks stored', sql("select count(*) from picks where match='R1_UB1'") == '61')

        # invalid votes
        x = voters[0]
        check('invalid: unknown match rejected (400)', x.post('/v1/pick', {'match': 'R9_XX', 'team': 'BIG'})[0] == 400)
        check('invalid: team not in the match rejected', x.post('/v1/pick', {'match': 'R1_UB1', 'team': 'COOK'})[0] == 400)
        check('invalid: impossible score rejected', x.post('/v1/pick', {'match': 'R1_UB1', 'team': 'BIG', 'score': '4-0'})[0] == 400)
        check('invalid: not signed in → 401', Viewer(None).post('/v1/pick', {'match': 'R1_UB1', 'team': 'BIG'})[0] == 401)
        check('invalid: unknown champion team rejected', x.post('/v1/champion', {'team': 'Made Up FC'})[0] == 400)
        check('invalid: oversized request rejected (413)', x.post('/v1/pick', None, raw=json.dumps({'match': 'R1_UB1', 'team': 'BIG', 'pad': 'x' * 20000}).encode())[0] == 413)
        check('invalid: broken JSON rejected (400)', x.post('/v1/pick', None, raw=b'{nope')[0] == 400)
        check('invalid: internal API refuses a missing secret', urllib.request.Request(V + '/internal/summary') and (lambda: (lambda r: r)(subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', V + '/internal/summary'], capture_output=True, text=True).stdout))() == '401')
        check('nothing public about an open match: no split on the page', Viewer(None).get('/v1/state')['matches'][0]['split'] is None)

        # duplicates: the same pick fired 20 times at once saves once
        d = Viewer('dupe')
        with ThreadPoolExecutor(20) as ex: codes = list(ex.map(lambda _: d.post('/v1/pick', {'match': 'R1_UB2', 'team': 'Airwalkers', 'score': '3-0'})[0], range(20)))
        check('duplicates: 20 parallel identical picks → one stored pick', sql("select count(*) from picks p join viewers v on v.id=p.viewer where v.name='dupe'") == '1', codes)
        check('duplicates: a changed pick replaces the old one', d.post('/v1/pick', {'match': 'R1_UB2', 'team': 'COOK', 'score': '3-2'})[0] == 200 and sql("select team from picks p join viewers v on v.id=p.viewer where v.name='dupe'") == 'COOK')

        # simultaneous voters
        crowd = [Viewer(f'c{i:03d}') for i in range(200)]
        t0 = time.time()
        with ThreadPoolExecutor(50) as ex: res = list(ex.map(lambda v: v.post('/v1/pick', {'match': 'R1_UB3', 'team': 'Ragnarok' if int(v.name[1:]) % 4 else 'Natus Vincere', 'score': ''})[0], crowd))
        dt = time.time() - t0
        check('simultaneous: 200 voters at once, every vote accepted', res.count(200) == 200, {c: res.count(c) for c in set(res)})
        check('simultaneous: …and every vote counted exactly once', sql("select count(*) from picks where match='R1_UB3'") == '200')
        print(f'    200 concurrent picks in {dt:.2f}s')

        # rate limit: one account cannot flood
        f = Viewer('flood')
        with ThreadPoolExecutor(20) as ex: fc = list(ex.map(lambda _: f.post('/v1/pick', {'match': 'R1_UB4', 'team': 'rnboi', 'score': ''})[0], range(60)))
        check('rate limit: one account is cut off after ~30 writes a minute', fc.count(429) >= 25 and fc.count(200) <= 31, {c: fc.count(c) for c in set(fc)})

        # 4 lock voting
        err = await ws_op(prod, {'k': 'lock-match', 'match': 'R1_UB1', 'locked': True})
        check('4 producer locks R1_UB1', err is None, err)
        await asyncio.sleep(1)
        c, j = voters[1].post('/v1/pick', {'match': 'R1_UB1', 'team': 'FUT Esports', 'score': '3-0'})
        check('4 a pick after the lock is refused (409)', c == 409, (c, j))
        check('4 the locked pick is unchanged', sql("select team from picks p join viewers v on v.id=p.viewer where v.name='v001' and match='R1_UB1'") == 'BIG')

        # 5 desk predictions (prepared = sealed on air)
        engine({'c': 'pick', 'slot': 4, 'team': 'BIG', 'score': '3-1'}); engine({'c': 'pick', 'slot': 5, 'team': 'FUT Esports', 'score': '3-2'}); engine({'c': 'pick', 'slot': 1, 'team': 'BIG', 'score': '3-0'})
        await src.goto(B + '/g/pickem'); await src.wait_for_timeout(2500)
        await shot('pickem_0_sealed')
        check('5 the graphic shows the desk sealed (no pick revealed)', await src.locator('.an .pick.rev').count() == 0 and await src.locator('.an .pick.hidden').count() == 3)
        check('5 preparing/locking/voting never aired or animated a graphic', all(g['anim']['seq'] == seq0.get(g['id']) for g in bstate()['graphics']))

        # 6 reveal on air, one by one, then the community
        publish('pickem', {'match': 'R1_UB1', 'step': 'd1'}); await src.wait_for_timeout(1200); await shot('pickem_1_desk1')
        check('6 desk pick 1 revealed, the others still sealed', await src.locator('.an .pick.rev').count() == 1)
        publish('pickem', {'step': 'd3'}); await src.wait_for_timeout(1200); await shot('pickem_2_desk3')
        check('6 all three desk picks revealed', await src.locator('.an .pick.rev').count() == 3)
        check('6 community still locked on air until its step', await src.locator('.cm.locked').count() == 1)
        check('6 …and still hidden on the public page', Viewer(None).get('/v1/state')['matches'][0]['split'] is None)
        publish('pickem', {'step': 'community'}); await src.wait_for_timeout(1800); await shot('pickem_3_community')
        txt = await src.inner_text('.split')
        check('6 community split on air matches the votes (BIG 36/61 = 59%)', '59%' in txt and '41%' in txt, txt)
        await asyncio.sleep(2.5)
        sp = Viewer(None).get('/v1/state')['matches'][0]['split']
        check('6 taking the community step revealed it on the public page', sp and sp['total'] == 61, sp)
        publish('pickem', {'step': 'verdict'}); await src.wait_for_timeout(1500); await shot('pickem_4_verdict')
        check('6 verdict: desk 2–1 BIG and community BIG agree', 'BOTH BACK BIG' in (await src.inner_text('.verdict')).upper())

        # 7 record the verified winner (bracket score, as today)
        for side, n in ((2, 1), (1, 3)):
            for _ in range(n): wcop({'k': 'score', 'id': 'R1_UB1', 'side': side, 'delta': 1})
        await asyncio.sleep(3)
        st = Viewer(None).get('/v1/state')
        m0 = st['matches'][0]
        check('7 the bracket result reaches the vote service (BIG 3-1, final)', m0['status'] == 'final' and m0['winner'] == 'BIG' and m0['score'] == '3-1', m0)

        # 8 scoreboard
        me = Viewer('v000').get('/v1/me')['me']
        check('8 an exact pick scores 3 points', me['points'] == 3, me)
        check('8 a right winner, wrong score scores 1', Viewer('v030').get('/v1/me')['me']['points'] == 1)
        check('8 a wrong pick scores 0', Viewer('v040').get('/v1/me')['me']['points'] == 0)
        check('8 community record: majority BIG 3-1 = right and exact', st['accuracy'] == {'played': 1, 'right': 1, 'exact': 1, 'points': 3, 'marks': ['y']}, st['accuracy'])
        pv = await priv(prod)
        check('8 producer leaderboard ranks the exact pickers first', pv['summary']['leaderboard'][0]['points'] == 3, pv['summary']['leaderboard'][:2])

        # 9 MVP
        err = await ws_op(prod, {'k': 'mvp-prepare', 'match': 'R1_UB1', 'players': ['Massa', 'GranaDy', 'Heav', 'Nayko', 'Wirtual']})
        check('9 MVP vote prepared for the finished match (unknown names dropped)', err is None, err)
        pv = await priv(prod); poll = pv['summary']['polls'][-1]
        check('9 eligible players = the two verified rosters', [x['handle'] for x in poll['players']] == ['Massa', 'GranaDy', 'Heav', 'Nayko'], poll['players'])
        check('9 a draft poll takes no votes', voters[0].post('/v1/mvp', {'poll': poll['id'], 'player': 'Massa'})[0] == 409)
        check('9 producer opens voting', await ws_op(prod, {'k': 'mvp-open', 'poll': poll['id']}) is None)
        publish('mvp', {'match': 'R1_UB1', 'step': 'voting'}); await src.goto(B + '/g/mvp'); await src.wait_for_timeout(2500); await shot('mvp_1_voting')
        check('9 the voting graphic shows the four players and VOTING OPEN', await src.locator('.pc').count() == 4 and 'VOTING OPEN' in await src.inner_text('.status'))
        mv = [('GranaDy', 27), ('Massa', 16), ('Heav', 10), ('Nayko', 7)]
        k = 0
        for name, n in mv:
            for v in voters[k:k + n]: v.post('/v1/mvp', {'poll': poll['id'], 'player': name})
            k += n
        c, j = voters[0].post('/v1/mvp', {'poll': poll['id'], 'player': 'Nayko'})
        check('9 a second vote is refused: the first vote stands', c == 200 and j.get('already') and j.get('player') == 'GranaDy', j)
        check('9 an ineligible player is refused', voters[59].post('/v1/mvp', {'poll': poll['id'], 'player': 'Wirtual'})[0] == 400)
        check('9 live counts never reach the graphics', 'counts' not in json.dumps(await src.evaluate('1')) and not any('counts' in json.dumps(p) for p in (await priv(prod))['summary']['polls'][:0]))

        # 10 close + reveal
        check('10 producer closes voting', await ws_op(prod, {'k': 'mvp-close', 'poll': poll['id']}) is None)
        check('10 a vote after close is refused', Viewer('late').post('/v1/mvp', {'poll': poll['id'], 'player': 'Massa'})[0] == 409)
        await asyncio.sleep(2.5)
        pub = Viewer(None).get('/v1/state')
        check('10 closing reveals nothing: no winner on the public page yet', not any(p['status'] == 'revealed' for p in pub['polls']))
        check('10 …and the graphic still shows the voting step', await src.locator('.pc').count() == 4)
        frozen = json.loads(sql(f"select frozen from polls where id='{poll['id']}'"))
        check('10 the frozen result counts every vote once (60)', frozen['total'] == 60 and frozen['counts']['GranaDy'] == 27, frozen)
        publish('mvp', {'step': 'winner'}); await src.wait_for_timeout(2600); await shot('mvp_2_winner')
        check('10 winner reveal: GranaDy, 45%', 'GRANADY' in (await src.inner_text('.mvx-name')).upper() and '45%' in await src.inner_text('.mvx-share'))
        await asyncio.sleep(2.5)
        check('10 taking the reveal made it public on the page', any(p['status'] == 'revealed' and p['frozen']['total'] == 60 for p in Viewer(None).get('/v1/state')['polls']))

        # 11 community vs desk
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 4, 'player': 'Massa', 'reason': 'Clutch on map 4'})
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 5, 'player': 'Massa'})
        check('11 a desk MVP outside the match is refused', await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 1, 'player': 'Whizzy'}) is not None)
        publish('mvp', {'step': 'compare'}); await src.wait_for_timeout(2200); await shot('mvp_3_compare')
        t = await src.inner_text('.mvc-vs')
        check('11 comparison: split, same team', 'SPLIT' in t.upper() and 'SAME TEAM' in t.upper(), t)

        # QR
        publish('qr', {'qr': 'vote', 'position': 'lower-third'}); engine({'c': 'gfx-anim', 'id': 'qr', 'action': 'in'})
        await src.goto(B + '/g/qr'); await src.wait_for_timeout(1800); await shot('qr_lower_third')
        import cv2
        im = cv2.imread(f'{OUT}/qr_lower_third.png'); dec, _, _ = cv2.QRCodeDetector().detectAndDecode(im)
        check('QR: the lower third decodes to the exact voting address at 1080p', dec == 'https://overdrive-vote.onrender.com/vote', dec)
        small = cv2.resize(im, (1280, 720)); dec2, _, _ = cv2.QRCodeDetector().detectAndDecode(small)
        check('QR: still decodes when the stream is scaled to 720p', dec2 == 'https://overdrive-vote.onrender.com/vote', dec2)
        check('QR: an unapproved host is refused', await ws_op(prod, {'k': 'qr-set', 'qr': [{'id': 'x', 'label': 'X', 'url': 'https://evil.example/vote', 'expires': 0}]}) is not None)
        check('QR: a non-https link is refused', await ws_op(prod, {'k': 'qr-set', 'qr': [{'id': 'x', 'label': 'X', 'url': 'http://overdrive-vote.onrender.com/vote', 'expires': 0}]}) is not None)
        publish('qr', {'qr': 'nope'}); await src.wait_for_timeout(800)
        check('QR: an unknown link draws nothing', await src.locator('[data-qr]').count() == 0)
        publish('qr', {'qr': 'vote'})

        # outage: the vote service goes down mid-show
        await src.goto(B + '/g/mvp'); await src.wait_for_timeout(2000)
        stop('vote'); await asyncio.sleep(5.5)
        pv = await priv(prod)
        check('outage: the producer sees "voting offline"', pv and pv['online'] is False and pv['error'], pv and pv['error'])
        check('outage: the last confirmed results are kept', pv['summary'] and pv['summary']['polls'][-1]['frozen']['total'] == 60)
        await src.reload(); await src.wait_for_timeout(2500); await shot('outage_mvp_compare')
        check('outage: graphics keep rendering the confirmed result', 'SPLIT' in (await src.inner_text('.mvc-vs')).upper())
        r0 = engine({'c': 'gfx-set', 'id': 'pickem', 'patch': {'step': 'd1'}})
        check('outage: producer controls stay responsive', r0.get('ok') is True, r0)
        engine({'c': 'gfx-revert', 'id': 'pickem'})
        check('outage: MVP commands fail clearly instead of hanging', (await ws_op(prod, {'k': 'mvp-open', 'poll': poll['id']})) not in (None, 'timeout'))
        start_vote(); await asyncio.sleep(5)
        pv = await priv(prod)
        check('reconnect: back online on its own', pv['online'] is True)
        check('reconnect: no vote lost', sql("select count(*) from picks") == str(61 + 1 + 200 + 1) and sql(f"select count(*) from mvp_votes where poll='{poll['id']}'") == '60')

        # production restarts: both services
        stop('bcast'); stop('vote'); start_vote(); start_bcast(); await asyncio.sleep(4)
        await src.goto(B + '/g/mvp'); await src.wait_for_timeout(2500)
        check('restart: graphics come back with the same confirmed result', 'SPLIT' in (await src.inner_text('.mvc-vs')).upper())
        check('restart: frozen result unchanged in the database', json.loads(sql(f"select frozen from polls where id='{poll['id']}'"))['hash'] == frozen['hash'])
        check('restart: viewer sessions survive (still signed in)', Viewer.__new__(Viewer) is not None and voters[0].get('/v1/me')['me']['name'] == 'v000')
        check('audit trail has every producer action', all(a in sql('select string_agg(distinct action, \',\') from audit') for a in ['match-lock', 'match-result', 'mvp-prepare', 'mvp-open', 'mvp-close', 'mvp-reveal', 'community-reveal']), sql('select string_agg(distinct action, \',\') from audit'))
        await br.close()
    stop('bcast'); stop('vote')
    print(f'\n{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

try: asyncio.run(main())
finally:
    for k in list(procs): stop(k)

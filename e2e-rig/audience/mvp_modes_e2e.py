"""MVP voting modes A/B/C end to end (real vote service + Postgres, real broadcast server, real /g/ graphics, real phone page).

A: voting open, countdown, no totals unless the producer enables them · B: closed, winner hidden · C: reveal with stats/achievements.
Also: producer Preview never changes Program, reveal only on publish, repeated reveal = one animation, late votes refused,
countdown auto-close, archive, Studio public URL + QR (scannable at 1080p and 4K), the desk QR, photos on the phone page.
    python3 e2e-rig/audience/mvp_modes_e2e.py
"""
import asyncio, json, os, shutil, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'aud_e2e.py')).read(); exec(src[:src.index('async def main():')])  # shared helpers
OUT = '/tmp/mvp-modes'; os.makedirs(OUT, exist_ok=True)
import cv2
def qr_decode(path):
    im = cv2.imread(path); d = cv2.QRCodeDetector(); v, *_ = d.detectAndDecode(im); return v
_start_bcast = start_bcast
def start_bcast():
    os.environ['PUBLIC_URL'] = 'https://bcast.example.com'; _start_bcast()

async def main():
    sql('drop table if exists audit, mvp_votes, polls, champion_picks, picks, viewer_sessions, viewers, matches, sessions, meta cascade')
    shutil.rmtree(D, ignore_errors=True); shutil.copytree('/tmp/oddata-vq', D)
    s = json.load(open(f'{D}/state.json')); s.pop('audience', None)
    for k, m in s['wildcard']['matches'].items(): m.update({'s1': '', 's2': '', 'live': False})
    s['wildcard']['cast'] = 'R1_UB1'
    json.dump(s, open(f'{D}/state.json', 'w'))
    start_vote(); start_bcast()
    for side, n in ((2, 1), (1, 3)):
        for _ in range(n): wcop({'k': 'score', 'id': 'R1_UB1', 'side': side, 'delta': 1})
    await asyncio.sleep(3)
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        prod = await br.new_page(); await prod.request.post(B + '/api/login', data={'password': 'testpw'}); await prod.goto(B + '/api/session')
        pg = await br.new_page(viewport={'width': 1920, 'height': 1080})
        pv = await priv(prod); check('vote service online for the producer', pv and pv['online'], pv and pv.get('error'))
        # photo for one player (relative upload → absolute https for the phone page)
        err = await ws_op(prod, {'k': 'mvp-prepare', 'match': 'R1_UB1', 'players': []})
        check('prepare with no players is refused', err is not None)
        # find eligible handles from the private summary after a full prepare
        import re
        st = json.load(open(f'{D}/state.json'))
        handles = [x.strip() for x in subprocess.run(['npx', 'tsx', '-e', "import { teamRoster } from './shared/audience'; console.log([...teamRoster('BIG'), ...teamRoster('FUT Esports')].map(p => p.handle).join(','))"], cwd=ROOT, capture_output=True, text=True).stdout.strip().split(',') if x.strip()]
        check('rosters known for BIG and FUT Esports', len(handles) >= 4, handles)
        top, second, third = handles[0], handles[1], handles[-1]
        from_norm = lambda x: re.sub(r'[^a-z0-9]', '', x.lower())
        st['wildcard']['showcase']['photos'][from_norm(top)] = '/uploads/mvp-face.png'
        os.makedirs(f'{D}/uploads', exist_ok=True); shutil.copy(os.path.join(ROOT, 'public/brand/overdrive/logo.png'), f'{D}/uploads/mvp-face.png')
        stop('bcast'); json.dump(st, open(f'{D}/state.json', 'w')); start_bcast(); await asyncio.sleep(3)
        err = await ws_op(prod, {'k': 'mvp-prepare', 'match': 'R1_UB1', 'players': handles[:4]})
        check('prepare MVP vote (4 eligible players)', err is None, err)
        pv = await priv(prod); poll = [q for q in pv['summary']['polls'] if q['match'] == 'R1_UB1'][-1]
        check('the photographed player carries an absolute https portrait', any(x.get('photo') == 'https://bcast.example.com/uploads/mvp-face.png' for x in poll['players']), poll['players'])
        err = await ws_op(prod, {'k': 'mvp-open', 'poll': poll['id'], 'seconds': 120})
        check('open voting with a 2 min countdown', err is None, err)
        await asyncio.sleep(2.5)
        pub = Viewer(None).get('/v1/state'); pp = [q for q in pub['polls'] if q['id'] == poll['id']][0]
        check('public page: poll open with its closing time', pp['status'] == 'open' and pp['closesAt'] and 100_000 < pp['closesAt'] - time.time() * 1000 < 121_000, pp.get('closesAt'))
        check('public page: no counts while open', 'counts' not in pp and pp['frozen'] is None)
        # Mode A on air
        publish('mvp', {'match': 'R1_UB1', 'step': 'voting'}); await pg.goto(B + '/g/mvp'); await pg.wait_for_timeout(2500)
        check('Mode A: the voting graphic is in mode A', await pg.locator('[data-mvp-mode="A"]').count() == 1)
        cdt = await pg.locator('[data-countdown]').inner_text() if await pg.locator('[data-countdown]').count() else ''
        check('Mode A: countdown on air', re.search(r'1:5\d|2:00', cdt) is not None, cdt)
        check('Mode A: no live totals on air by default', await pg.locator('[data-live-total]').count() == 0)
        await pg.screenshot(path=f'{OUT}/A_voting.png')
        voters = [Viewer(f'm{i:03d}') for i in range(30)]
        plan = [top] * 16 + [second] * 9 + [third] * 5
        for v, who in zip(voters, plan): v.post('/v1/mvp', {'poll': poll['id'], 'player': who})
        c, j = voters[0].post('/v1/mvp', {'poll': poll['id'], 'player': second})
        check('a second vote from the same account keeps the first', c == 200 and j.get('already') and j.get('player') == top, (c, j))
        check('30 votes stored', sql(f"select count(*) from mvp_votes where poll='{poll['id']}'") == '30')
        # live totals on air only when enabled
        await ws_op(prod, {'k': 'mvp-totals', 'poll': poll['id'], 'on': True}); await asyncio.sleep(3); await pg.wait_for_timeout(500)
        lt = await pg.locator('[data-live-total]').all_inner_texts()
        check('Mode A: producer enables live totals → shown on air', len(lt) == 4 and '53%' in ' '.join(lt), lt)
        await pg.screenshot(path=f'{OUT}/A_live_totals.png')
        check('…but the public page still has no counts', 'counts' not in [q for q in Viewer(None).get('/v1/state')['polls'] if q['id'] == poll['id']][0])
        await ws_op(prod, {'k': 'mvp-totals', 'poll': poll['id'], 'on': False}); await asyncio.sleep(1); await pg.wait_for_timeout(400)
        check('live totals off → gone from air', await pg.locator('[data-live-total]').count() == 0)
        # phone page: photo, countdown, confirmation
        ph = await br.new_page(viewport={'width': 390, 'height': 844})
        await ph.route('https://bcast.example.com/**', lambda r: r.fulfill(path=os.path.join(ROOT, 'public/brand/overdrive/logo.png'), content_type='image/png'))
        await ph.goto(V + '/vote')
        await ph.fill('input[aria-label="Test name"]', 'phone2'); await ph.press('input[aria-label="Test name"]', 'Enter'); await ph.wait_for_timeout(1500)
        await ph.click('button[role="tab"]:has-text("MVP")'); await ph.wait_for_timeout(400)
        check('phone: candidates with the uploaded portrait', await ph.locator('.p img.face').count() == 1 and await ph.locator('.p').count() == 4)
        check('phone: countdown shown', await ph.locator('.live .cd').count() == 1)
        await ph.click(f'.p:has-text("{second}")'); await ph.click('button.btn'); await ph.wait_for_timeout(1200)
        check('phone: vote confirmation', await ph.locator('[data-voted]').count() == 1)
        await ph.screenshot(path=f'{OUT}/phone_A.png')
        # network failure on the phone: request fails → clear message, nothing claimed
        await ph.route('**/v1/**', lambda r: r.abort()); await ph.click('button[role="tab"]:has-text("Pick")'); await ph.wait_for_timeout(300)
        btn = ph.locator('section.m button.t').first
        if await btn.count(): await btn.click(); await ph.wait_for_timeout(800)
        check('phone: offline write shows "No connection"', await ph.locator('.toast.bad').count() == 1 and 'No connection' in await ph.locator('.toast').inner_text())
        await ph.unroute('**/v1/**')
        # countdown → auto close; late votes refused
        await ws_op(prod, {'k': 'mvp-timer', 'poll': poll['id'], 'seconds': 10}); late = Viewer('late')
        await asyncio.sleep(11)
        c, j = late.post('/v1/mvp', {'poll': poll['id'], 'player': top})
        check('a vote after the countdown is refused (409)', c == 409, (c, j))
        await asyncio.sleep(4)
        pv = await priv(prod); poll = [q for q in pv['summary']['polls'] if q['id'] == poll['id']][0]
        check('countdown closed the vote and froze the result', poll['status'] == 'closed' and poll['frozen']['total'] == 31, (poll['status'], poll.get('frozen')))
        # Mode B: winner hidden on air and on the phone
        await pg.wait_for_timeout(800)
        check('Mode B: voting graphic switches to closed', await pg.locator('[data-mvp-mode="B"]').count() == 1)
        body = await pg.inner_text('body')
        check('Mode B: no winner, no percentages on air', '%' not in body and 'Votes are in'.upper() in body.upper(), body[:200])
        await pg.screenshot(path=f'{OUT}/B_closed.png')
        await ph.reload(); await ph.wait_for_timeout(1500); await ph.click('button[role="tab"]:has-text("MVP")'); await ph.wait_for_timeout(300)
        check('phone: "voting closed", winner not shown', await ph.locator('[data-closed]').count() == 1 and await ph.locator('[data-winner]').count() == 0)
        await ph.screenshot(path=f'{OUT}/phone_B.png')
        # Mode C extras + analyst MVP
        err = await ws_op(prod, {'k': 'mvp-card', 'match': 'R1_UB1', 'player': top, 'card': {'stats': [{'label': 'Maps won', 'value': '3'}, {'label': 'Best lap', 'value': '41.204'}], 'achievements': ['Fastest lap of the series', 'x' * 200]}})
        await asyncio.sleep(1.5)
        check('reveal card saved (long text trimmed)', err is None and len(bstate()['audience']['mvpCards']['R1_UB1'][top]['achievements'][1]) == 60, err)
        check('card for a player who did not play is refused', (await ws_op(prod, {'k': 'mvp-card', 'match': 'R1_UB1', 'player': 'Nobody', 'card': {'stats': [{'label': 'a', 'value': '1'}], 'achievements': []}})) is not None)
        for slot, who in ((4, top), (5, third)): await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': slot, 'player': who})
        # Preview (draft) never touches Program
        seq = gfx('mvp')['anim']['seq']
        engine({'c': 'gfx-set', 'id': 'mvp', 'patch': {'step': 'winner'}}); await asyncio.sleep(1.5); await pg.wait_for_timeout(500)
        check('Preview reveal: Program still on the closed voting graphic', await pg.locator('[data-mvp-mode="B"]').count() == 1 and gfx('mvp')['config']['step'] == 'voting')
        check('…and nothing revealed publicly', [q for q in Viewer(None).get('/v1/state')['polls'] if q['id'] == poll['id']][0]['frozen'] is None)
        r1 = engine({'c': 'gfx-publish', 'id': 'mvp'}); r2 = engine({'c': 'gfx-publish', 'id': 'mvp'})
        await pg.wait_for_timeout(3200)
        check('REVEAL: winner on Program with the stats/achievements', (await pg.locator('.mvx-name').inner_text()).upper() == top.upper() and await pg.locator('[data-mvp-extras] .mvx-stats div').count() == 2 and await pg.locator('.mvx-ach span').count() == 2)
        check('REVEAL: community share from the frozen result (16/31 = 52%)', '52%' in await pg.inner_text('.mvx-share'))
        check('repeated REVEAL press: the second publish does nothing (one animation)', r1.get('ok') and not r2.get('ok') and gfx('mvp')['anim']['seq'] <= seq + 1, (r1, r2, gfx('mvp')['anim']['seq'], seq))
        await pg.screenshot(path=f'{OUT}/C_reveal.png')
        await asyncio.sleep(3)
        pp = [q for q in Viewer(None).get('/v1/state')['polls'] if q['id'] == poll['id']][0]
        check('after the reveal the public page has the result', pp['status'] == 'revealed' and pp['frozen']['total'] == 31)
        await ph.reload(); await ph.wait_for_timeout(1500); await ph.click('button[role="tab"]:has-text("MVP")'); await ph.wait_for_timeout(300)
        wt = await ph.locator('[data-winner]').inner_text() if await ph.locator('[data-winner]').count() else ''
        check('phone: winner with photo and % after the reveal', top.upper() in wt.upper() and '52%' in wt and await ph.locator('[data-winner] img.face').count() == 1, wt)
        await ph.screenshot(path=f'{OUT}/phone_C.png')
        publish('mvp', {'step': 'desk'}); await pg.wait_for_timeout(3000)
        check('Analyst MVP view (1 of 2 analysts each → first pick) with its card', await pg.locator('.mvx-desk').count() == 1)
        await pg.screenshot(path=f'{OUT}/C_desk.png')
        publish('mvp', {'step': 'compare'}); await pg.wait_for_timeout(3000)
        check('Community vs Analysts: same player → one hero with both badges', await pg.locator('.mvx-badge').count() == 2 and await pg.locator('.mvc-half').count() == 0)
        await ws_op(prod, {'k': 'staff-mvp', 'match': 'R1_UB1', 'slot': 4, 'player': third}); await asyncio.sleep(1); await pg.wait_for_timeout(2500)
        check('…different players → split view', await pg.locator('.mvc-half').count() == 2)
        await pg.screenshot(path=f'{OUT}/C_compare_split.png')
        # archive
        e = await ws_op(prod, {'k': 'mvp-archive', 'match': 'R1_UB1', 'on': True}); await asyncio.sleep(1.5)
        check('archive the finished session', e is None and 'R1_UB1' in bstate()['audience']['archived'], e)
        check('archived results are kept', sql(f"select status from polls where id='{poll['id']}'") == 'revealed')
        # Studio public URL + QR
        check('Studio: http URL refused', (await ws_op(prod, {'k': 'vote-url', 'url': 'http://vote.example.com'})) is not None)
        check('Studio: credentials in URL refused', (await ws_op(prod, {'k': 'vote-url', 'url': 'https://a:b@vote.example.com'})) is not None)
        check('Studio: https URL accepted', (await ws_op(prod, {'k': 'vote-url', 'url': 'https://vote.overdrive.example/mvp'})) is None)
        publish('qr', {'qr': 'vote', 'position': 'lower-third'}); await pg.goto(B + '/g/qr'); await pg.wait_for_timeout(2000)
        await pg.screenshot(path=f'{OUT}/qr_1080.png')
        check('QR lower-third decodes at 1080p to the Studio URL', qr_decode(f'{OUT}/qr_1080.png') == 'https://vote.overdrive.example/mvp', qr_decode(f'{OUT}/qr_1080.png'))
        p4 = await (await br.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=2)).new_page(); await p4.goto(B + '/g/qr'); await p4.wait_for_timeout(2000)
        await p4.screenshot(path=f'{OUT}/qr_4k.png')
        check('QR lower-third decodes at 4K', qr_decode(f'{OUT}/qr_4k.png') == 'https://vote.overdrive.example/mvp')
        # 1080p broadcast downscale (e.g. a 720p viewer stream) still scans
        im = cv2.imread(f'{OUT}/qr_1080.png'); cv2.imwrite(f'{OUT}/qr_720.png', cv2.resize(im, (1280, 720), interpolation=cv2.INTER_AREA))
        check('QR still decodes in a 720p downscale of the stream', qr_decode(f'{OUT}/qr_720.png') == 'https://vote.overdrive.example/mvp')
        engine({'c': 'gfx-set', 'id': 'analyst-desk', 'patch': {'qr': True}}); engine({'c': 'gfx-publish', 'id': 'analyst-desk'})
        await pg.goto(B + '/g/analyst-desk'); await pg.wait_for_timeout(2500); await pg.screenshot(path=f'{OUT}/desk_qr.png')
        CLASH = """() => { const q = document.querySelector('.qr-desk, .qr-corner').getBoundingClientRect();
          const cams = Array.from(document.querySelectorAll('body *')).filter(e => { if (e.closest('.aud') || getComputedStyle(e).position !== 'absolute') return false; for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.visibility === 'hidden' || c.display === 'none' || +c.opacity < 0.05) return false; } return true; }).map(e => e.getBoundingClientRect()).filter(r => r.width >= 300 && r.width <= 1300 && r.height >= 200 && r.height <= 900);
          return cams.filter(r => !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom)).map(r => [r.x, r.y, r.width, r.height]) }"""
        for lay in ('duo', 'solo'):
            engine({'c': 'gfx-set', 'id': 'analyst-desk', 'patch': {'qr': True, 'layout': lay}}); engine({'c': 'gfx-publish', 'id': 'analyst-desk'}); await pg.wait_for_timeout(1800)
            await pg.screenshot(path=f'{OUT}/desk_qr_{lay}.png'); clash = await pg.evaluate(CLASH)
            check(f'Analyst Desk ({lay}): the QR does not cover a camera', not clash, clash)
            check(f'Analyst Desk ({lay}): the QR scans', qr_decode(f'{OUT}/desk_qr_{lay}.png') == 'https://vote.overdrive.example/mvp')
        engine({'c': 'gfx-set', 'id': 'analyst-desk', 'patch': {'layout': 'duo'}}); engine({'c': 'gfx-publish', 'id': 'analyst-desk'}); await pg.wait_for_timeout(1500)
        check('Analyst Desk: QR present when enabled', await pg.locator('.qr-desk').count() == 1)
        check('Studio: back to the server setting', (await ws_op(prod, {'k': 'vote-url', 'url': ''})) is None and (await priv(prod))['publicUrl'] == 'https://overdrive-vote.onrender.com/vote')
        check('no producer secret on the public page', 'e2e-secret' not in (await ph.content()) and 'e2e-secret' not in json.dumps(Viewer(None).get('/v1/state')))
        await br.close()
    stop('bcast'); stop('vote')
    print(f'\n{ok}/{ok + bad} MVP mode checks pass'); sys.exit(1 if bad else 0)
asyncio.run(main())

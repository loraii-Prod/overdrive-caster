"""Overdrive 3.0 · MVP integration, end to end (the 'FIX MVP INTEGRATION COMPLETELY' brief).

Real server, real Producer page (two controllers) in headless Chrome, the exact browser-source URLs the Scene Builder
put in OBS (1080p and 4K), mock OBS (obs-websocket 5 protocol, every Overdrive scene built by the real Scene Builder),
local MVP counting. Results are entered through the controller's own score command (as the match manager does).

  bash e2e-rig/mvp4/run.sh <build dir>

Not covered here: real OBS, real Twitch chat, the online vote service / public website (none reachable here).
"""
import asyncio, json, subprocess, urllib.request
from playwright.async_api import async_playwright

B, M, R = 'http://localhost:8787', 'http://127.0.0.1:4456', __file__.rsplit('/e2e-rig/', 1)[0]
OUT = '/home/claude/out'
res = []
def check(name, ok, extra=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or extra == '' else f'  [{extra}]'), flush=True)
def get(u): return json.loads(urllib.request.urlopen(u).read())
def obs(): return get(f'{M}/program')
def probe(msgs=()): return json.loads(subprocess.run(['node', f'{R}/e2e-rig/mvp4/probe.mjs', json.dumps(list(msgs))], capture_output=True, text=True).stdout)
def wc(op): return {'t': 'wc', 'op': op}
def score(mid, a, b): return [wc({'k': 'score', 'id': mid, 'side': 2, 'delta': 1})] * b + [wc({'k': 'score', 'id': mid, 'side': 1, 'delta': 1})] * a
def src_url(view):
    # 3.3: every MVP view is drawn by the ONE MVP Program source (/g/mvp)
    for i in get(f'{M}/state')['inputs']:
        u = (i.get('settings') or {}).get('url', '')
        if u.split('?key=')[0].endswith('/g/mvp'): return i['name'], u
    return None, None

TEAMS = ['BIG', 'FUT Esports', 'Airwalkers', 'COOK', 'Mystery Five', 'NAVI Team', 'rnboi', 'All Gamers Global']
# 3.2 main-scenes layout: the five MVP views are layers (scene items) of ONE scene, "Overdrive · MVP"
MVP = 'Overdrive · MVP'
def layer_on(view):
    st = json.loads(urllib.request.urlopen(f'{M}/state').read())
    names = {i['name'] for i in st['inputs'] if str((i.get('settings') or {}).get('url', '')).split('?key')[0].endswith(f'/g/mvp?view={view}')}
    sc = next((x for x in st['scenes'] if x['name'] == MVP), None)
    return bool(sc) and any(it['source'] in names and it['enabled'] for it in sc['items'])
def only(view): return layer_on(view) and not any(layer_on(v) for v in ['voting', 'closed', 'winner', 'desk', 'compare'] if v != view)
# 3.3 unified MVP renderer: ONE Program source (/g/mvp, its step = what is on air) in "Overdrive · MVP", and the
# MVP Preview identity (/g/mvp?id=pvw, its own internal scene) drawing the view prepared off-air.
PVW = 'Overdrive · MVP (Preview identity)'
STEP = {'voting': 'voting', 'closed': 'voting', 'winner': 'winner', 'desk': 'desk', 'compare': 'compare'}
def mvpst():
    import subprocess as _sp
    return json.loads(_sp.run(['node', __file__.rsplit('/e2e-rig/', 1)[0] + '/e2e-rig/mvp4/probe.mjs', '[]'], capture_output=True, text=True).stdout)['mvp']
def on_pgm(view): o = obs(); m = mvpst(); return o['program'] == MVP and m['step'] == STEP[view]
def on_pvw(view): o = obs(); m = mvpst(); return o['preview'] == PVW and (m.get('prepared') or ('voting' if m['step'] == 'voting' else m['step'])) == view
SC = {'voting': 'Overdrive · Community MVP — Voting Open', 'closed': 'Overdrive · Community MVP — Voting Closed', 'winner': 'Overdrive · Community MVP — Winner Reveal'}

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1480})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        errs = []
        pr = await ctx.new_page(); pr.on('pageerror', lambda e: errs.append(str(e)))
        await pr.add_init_script("localStorage.setItem('od2.mode','live'); localStorage.setItem('od3.lib','scenes')")
        await pr.goto(f'{B}/producer'); await pr.wait_for_timeout(2000)
        chip = lambda: pr.get_attribute('[data-mvp-chip]', 'data-mvp-chip')

        # ---- the exact OBS browser sources of the MVP scene (1080p + 4K), open the whole time: live updates, no refresh
        name, vurl = src_url('voting')
        check('OBS: the Scene Builder registered the MVP voting browser source with a valid /g/mvp URL', bool(vurl) and vurl.startswith(B), vurl)
        gv = await (await br.new_context(viewport={'width': 1920, 'height': 1080})).new_page(); await gv.goto(vurl)
        _, wurl = src_url('winner')
        gw = await (await br.new_context(viewport={'width': 1920, 'height': 1080})).new_page(); await gw.goto(wurl)
        g4 = await (await br.new_context(viewport={'width': 3840, 'height': 2160})).new_page(); await g4.goto(vurl)

        # ---- Caster Desk on Program, Studio Mode on
        await pr.click('[data-main-scene="caster-desk"]'); await pr.wait_for_timeout(300)
        await pr.click('[data-transport-auto]'); await pr.wait_for_timeout(800)
        urllib.request.urlopen(f'{M}/studio-mode?on=1'); await pr.wait_for_timeout(400)

        # ---- 1. the active match: teams from the event, cast, match in progress → MVP waits (nothing invented)
        probe([wc({'k': 'teams', 'teams': TEAMS}), wc({'k': 'cast', 'id': 'R1_UB1'})] + score('R1_UB1', 2, 1))
        await pr.wait_for_timeout(600)
        s = probe()
        check('match in progress: no MVP match, no vote (MVP only after a result)', s['mvp']['match'] == '' and s['poll'] is None, s['mvp'])

        # ---- 3. the match is marked completed (3rd win, the controller's score command)
        probe(score('R1_UB1', 1, 0) + [{'wait': 800}]); await pr.wait_for_timeout(1200)
        s = probe()
        check('match completed → MVP match = that match automatically', s['mvp']['match'] == 'R1_UB1', s['mvp'])
        check('→ vote prepared with ALL eligible players of both teams (BIG + FUT Esports)', s['poll'] and s['poll']['status'] == 'draft' and s['poll']['players'] == ['Massa', 'GranaDy', 'Heav', 'Nayko'], s['poll'])
        check('→ producer notified (MVP ready)', s['notice'] and s['notice']['kind'] == 'ready' and 'BIG vs FUT Esports' in s['notice']['text'], s['notice'])
        check('→ voting NOT opened, OBS NOT switched (automation off by default)', s['poll']['status'] == 'draft' and obs()['program'] == 'Overdrive · Caster Desk', obs())
        check('Producer header: MVP chip says READY (visible from any scene)', await chip() == 'ready', await chip())
        stage = await pr.get_attribute('[data-main-scene="mvp"] [data-mvp-tile-stage]', 'data-mvp-tile-stage')
        tile = await pr.inner_text('[data-main-scene="mvp"] [data-mvp-tile-stage]')
        check('MVP tile: R1 UB 1 · Ready (alongside the other main scenes)', stage == 'prepared' and 'R1 UB 1' in tile, tile)
        await gv.wait_for_timeout(800)
        cards = await gv.eval_on_selector_all('[data-candidate]', 'e => e.map(x => x.dataset.candidate)')
        check('OBS browser source (no refresh): voting graphic shows the 4 players of the finished match', cards == ['Massa', 'GranaDy', 'Heav', 'Nayko'], cards)

        # ---- 2. the producer moves the cast to the next match (normal): the MVP stays on the finished one
        probe([wc({'k': 'cast', 'id': 'R1_UB2'})] + score('R1_UB2', 1, 1)); await pr.wait_for_timeout(800)
        s = probe()
        check('cast match moves on → MVP match unchanged (the old bug: MVP followed the cast and went blank)', s['mvp']['match'] == 'R1_UB1' and s['cast'] == 'R1_UB2', [s['mvp'], s['cast']])
        await gv.wait_for_timeout(400)
        check('… and the voting graphic still shows R1_UB1\'s players', len(await gv.query_selector_all('[data-candidate]')) == 4)

        # ---- 4. Producer MVP panel: active match, loaded players, readiness, open voting
        await pr.click('[data-mvp-chip]'); await pr.wait_for_timeout(1000)
        check('chip → MVP scene selected, MVP panel open on R1_UB1', await pr.get_attribute('[data-mvp-panel]', 'data-mvp-match-id') == 'R1_UB1')
        o = obs(); check('selecting MVP: OBS Preview = MVP voting scene, Program untouched', on_pvw('voting') and o['program'] == 'Overdrive · Caster Desk', o)
        cands = await pr.eval_on_selector_all('[data-mvp-candidate]', 'e => e.map(x => x.dataset.mvpCandidate)')
        check('panel: the automatically loaded players (with team)', cands == ['Massa', 'GranaDy', 'Heav', 'Nayko'] and 'FUT Esports' in await pr.inner_text('[data-mvp-candidates]'), cands)
        await pr.click('[data-mvp-ready-toggle]'); await pr.wait_for_timeout(300)
        tones = await pr.eval_on_selector_all('[data-mvp-check]', 'e => Object.fromEntries(e.map(x => [x.dataset.mvpCheck, x.dataset.tone]))')
        check('readiness: match, players, vote, OBS scenes OK; pictures flagged; no way to vote flagged (no Twitch, no service)',
              tones.get('match') == 'ok' and tones.get('players') == 'ok' and tones.get('vote') == 'ok' and tones.get('obs') == 'ok' and tones.get('photos') == 'warn' and tones.get('ways') == 'bad', tones)
        check('readiness: MVP browser sources connected (counted from the real OBS-source pages)', tones.get('sources') == 'ok', tones)
        await pr.click('[data-mvp-start]'); await pr.wait_for_timeout(1500)
        check('Start voting → OPEN', await pr.get_attribute('[data-mvp-status]', 'data-mvp-status') == 'open')
        await gv.wait_for_timeout(600)
        check('OBS browser source updates live: VOTING OPEN (no refresh)', await gv.get_attribute('[data-mvp-mode]', 'data-mvp-mode') == 'A')

        # ---- second controller (another producer) sees the same state; a refresh loses nothing
        pr2 = await ctx.new_page(); await pr2.goto(f'{B}/producer'); await pr2.wait_for_timeout(1800)
        await pr2.click('[data-mvp-chip]'); await pr2.wait_for_timeout(900)
        check('second controller: same MVP match and status', await pr2.get_attribute('[data-mvp-panel]', 'data-mvp-match-id') == 'R1_UB1' and await pr2.get_attribute('[data-mvp-status]', 'data-mvp-status') == 'open')

        # ---- the next match ends while voting is open → queued, never switched under the open vote
        probe(score('R1_UB2', 2, 0) + [{'wait': 800}]); await pr.wait_for_timeout(1000)
        s = probe()
        check('another match finishes during voting → MVP stays on R1_UB1, producer told it is waiting', s['mvp']['match'] == 'R1_UB1' and s['notice']['kind'] == 'queued' and s['notice']['match'] == 'R1_UB2', s['notice'])
        check('panel shows the waiting notice', await pr.get_attribute('[data-mvp-notice]', 'data-mvp-notice') == 'queued')
        s = probe([{'t': 'cmd', 'cmd': {'c': 'mvp-match', 'match': 'R1_UB2'}}])
        check('changing the MVP match while voting is open is refused by the server (any console)', s['acks'][0]['ok'] is False and 'Voting is open' in s['acks'][0].get('error', ''), s['acks'])
        check('the match selector is locked in the panel while voting', await pr.is_disabled('[data-mvp-match]'))

        # ---- votes in real time, stop, preview, reveal (CONFIRM), OBS
        await pr.click('[data-mvp-controls] >> text=+50 votes'); await pr.wait_for_timeout(1500)
        check('live count in the panel', '50 votes' in await pr.inner_text('[data-mvp-total]'), await pr.inner_text('[data-mvp-total]'))
        await pr2.wait_for_timeout(500)
        check('… and on the second controller (same state)', '50 votes' in await pr2.inner_text('[data-mvp-total]'))
        await pr.reload(); await pr.wait_for_timeout(2000); await pr.click('[data-mvp-chip]'); await pr.wait_for_timeout(900)
        check('refresh: match, status and votes kept', await pr.get_attribute('[data-mvp-panel]', 'data-mvp-match-id') == 'R1_UB1' and '50 votes' in await pr.inner_text('[data-mvp-total]'))
        await pr.click('[data-mvp-stop]'); await pr.wait_for_timeout(1500)
        s = probe()
        frozen = s['poll']['frozen']
        check('Stop voting → result frozen (50 votes)', s['poll']['status'] == 'closed' and frozen['total'] == 50, s['poll'])
        await pr.click('[data-mvp-view="winner"]'); await pr.wait_for_timeout(800)
        check('preview the reveal: prepared on the MVP Preview identity (OBS Preview), Program untouched', on_pvw('winner') and obs()['program'] == 'Overdrive · Caster Desk', obs())
        await gw.wait_for_timeout(300)
        check('winner browser source draws NOTHING before the producer\'s reveal', await gw.query_selector('.mvx-name') is None)
        # the Preview identity (what OBS Studio Mode shows in Preview) draws the prepared winner; Program does not
        pv_name = next(i['name'] for i in get(f'{M}/state')['inputs'] if '/g/mvp?id=pvw' in str((i.get('settings') or {}).get('url', '')))
        pv_url = next(i['settings']['url'] for i in get(f'{M}/state')['inputs'] if i['name'] == pv_name)
        gp = await (await br.new_context(viewport={'width': 1920, 'height': 1080})).new_page(); await gp.goto(pv_url); await gp.wait_for_timeout(3500)
        pv_win = (await gp.inner_text('.mvx-name')).strip() if await gp.query_selector('.mvx-name') else ''
        check('Preview identity source (OBS Preview) draws the prepared winner while the Program source still shows voting', bool(pv_win) and await gw.query_selector('.mvx-name') is None and on_pgm('voting') is False and obs()['program'] == 'Overdrive · Caster Desk', pv_win)
        check('Preview identity is muted in OBS (no Preview audio leak)', next(i for i in get(f'{M}/state')['inputs'] if i['name'] == pv_name).get('audio', {}).get('muted') is True)
        await gp.screenshot(path=f'{OUT}/mvp-preview-identity.png')
        await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(400)
        check('reveal asks CONFIRM', await pr.get_attribute('[data-mvp-panel-take]', 'data-mvp-panel-take') == 'armed')
        await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(1800)
        check('REVEAL → OBS Program = MVP winner scene', on_pgm('winner'), [obs(), mvpst()])
        await gw.wait_for_timeout(2500)
        winner = (await gw.inner_text('.mvx-name')).strip() if await gw.query_selector('.mvx-name') else ''
        cnt = probe()['poll']['frozen']['counts']; best = max(cnt.values()); tops = [h.lower() for h, v in cnt.items() if v == best]
        check('winner graphic = the top of the frozen R1_UB1 result (right match, right winner)', winner.lower() in tops, [winner, cnt])
        await gw.screenshot(path=f'{OUT}/mvp-sync-winner.png')
        await gp.wait_for_timeout(800)
        check('after TAKE the Preview identity mirrors Program (prepared cleared)', mvpst().get('prepared') is None)

        # ---- switch to the waiting match: votes stay with their match, no wrong winner
        await pr.click('[data-mvp-notice] >> text=Switch MVP to'); await pr.wait_for_timeout(1500)
        s = probe()
        check('Switch → MVP match R1_UB2, its players prepared (Airwalkers + COOK)', s['mvp']['match'] == 'R1_UB2' and s['poll']['players'] == ['Whizzy', 'Stufts', 'L1ngo', 'Scrapie'], s['poll'])
        check('R1_UB1\'s votes stay with R1_UB1 (revealed, 50 votes) — nothing carried to R1_UB2', 'R1_UB1:revealed' in s['polls'] and (s['poll']['total'] or 0) == 0, s['polls'])
        check('the waiting notice is answered (cleared)', s['notice'] is None, s['notice'])
        await gw.wait_for_timeout(800)
        check('the MVP Program source no longer draws R1_UB1\'s winner (authorization belongs to its match)', await gw.query_selector('.mvx-name') is None)
        cards = await gv.eval_on_selector_all('[data-candidate]', 'e => e.map(x => x.dataset.candidate)')
        check('voting source follows: R1_UB2\'s players', cards == ['Whizzy', 'Stufts', 'L1ngo', 'Scrapie'], cards)
        await pr.click('[data-main-scene="analyst-desk"]'); await pr.wait_for_timeout(300); await pr.click('[data-transport-cut]'); await pr.wait_for_timeout(800)

        # ---- missing data: a team with no known players (another event's team) → clear warning, fill in, stays in sync
        probe(score('R1_UB3', 3, 0) + [{'wait': 900}]); await pr.wait_for_timeout(1200)
        s = probe()
        check('R1_UB3 (Mystery Five, no players known) finishes → MVP match R1_UB3, producer told what is missing', s['mvp']['match'] == 'R1_UB3' and s['notice']['kind'] == 'error' and 'Mystery Five' in s['notice']['text'], s['notice'])
        await pr.click('[data-mvp-chip]'); await pr.wait_for_timeout(900)
        check('panel: clear "no players known for Mystery Five" with a field to fill in', await pr.query_selector('[data-mvp-roster-missing="Mystery Five"]') is not None)
        await pr.fill('[data-mvp-roster-input="Mystery Five"]', 'Alpha5, Beta5'); await pr.click('[data-mvp-roster-missing="Mystery Five"] >> text=Save players'); await pr.wait_for_timeout(1500)
        s = probe()
        check('players entered → vote prepared with them (and the other team\'s verified players)', s['poll'] and s['poll']['players'][:2] == ['Alpha5', 'Beta5'] and len(s['poll']['players']) == 4, s['poll'])
        check('… and the producer is told the MVP is now ready', s['notice'] and s['notice']['kind'] == 'ready', s['notice'])
        await gv.wait_for_timeout(600)
        cards = await gv.eval_on_selector_all('[data-candidate]', 'e => e.map(x => x.dataset.candidate)')
        check('… and the OBS voting source shows them at once', cards[:2] == ['Alpha5', 'Beta5'], cards)
        await pr.screenshot(path=f'{OUT}/mvp-sync-producer.png')

        # ---- OBS: Verify and Repair include the MVP scenes
        urllib.request.urlopen(f'{M}/break-url?input=' + urllib.parse.quote(name))
        s = probe([{'t': 'cmd', 'cmd': {'c': 'obs-setup', 'action': 'verify'}}])
        check('Verify: the broken MVP browser source is reported', s['acks'][0]['ok'] and 'need attention' in s['acks'][0].get('note', ''), s['acks'])
        s = probe([{'t': 'cmd', 'cmd': {'c': 'obs-setup', 'action': 'preview', 'mode': 'repair', 'targets': 'all'}}, {'apply': True}])
        check('Repair (preview → confirm) succeeds', all(a.get('ok') for a in s['acks']), s['acks'])
        _, fixed = src_url('voting')
        check('… MVP voting source URL restored', fixed == vurl, fixed)
        s = probe([{'t': 'cmd', 'cmd': {'c': 'obs-setup', 'action': 'verify'}}])
        check('Verify after repair: every scene correct', 'All' in s['acks'][0].get('note', ''), s['acks'])

        # ---- 8. rehearsal: demo match, the real workflow, the real event untouched
        await pr.click('[data-demo-load]'); await pr.wait_for_timeout(2000)
        s = probe()
        check('Load demo match → rehearsal event, fictional DEMO teams, OBS not switched', s['rehearsal'] and s['teams'][:2] == ['DEMO Falcons', 'DEMO Comets'] and obs()['program'] == 'Overdrive · Analyst Desk', [s['teams'], obs()['program']])
        check('rehearsal: the real event\'s votes are not visible / not touched', s['polls'] == [], s['polls'])
        check('rehearsal bar + REHEARSAL in the header chip', await pr.query_selector('[data-mvp-rehearsal-bar]') is not None and 'REHEARSAL' in await pr.inner_text('[data-mvp-chip]'))
        await pr.click('[data-demo-finish]'); await pr.wait_for_timeout(2000)
        s = probe()
        check('Finish demo match → MVP populates itself (4 DEMO players), notice ready', s['mvp']['match'] == 'R1_UB1' and all('(demo)' in h for h in s['poll']['players']) and s['notice']['kind'] == 'ready', s['poll'])
        await gv.wait_for_timeout(800)
        check('OBS voting source: demo players + REHEARSAL tag', (await gv.eval_on_selector_all('[data-candidate]', 'e => e.length')) == 4 and await gv.query_selector('[data-rehearsal-tag]') is not None)
        await pr.click('[data-mvp-start]'); await pr.wait_for_timeout(1200)
        await pr.click('[data-mvp-controls] >> text=+200 votes'); await pr.wait_for_timeout(1500)
        await pr.click('[data-mvp-view="voting"]'); await pr.wait_for_timeout(400)
        await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(1500)
        check('rehearsal: TAKE → OBS Program = MVP voting scene', on_pgm('voting'), [obs(), mvpst()])
        await pr.click('[data-mvp-stop]'); await pr.wait_for_timeout(1500)
        await pr.click('[data-mvp-view="winner"]'); await pr.wait_for_timeout(500)
        await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(300); await pr.click('[data-mvp-panel-take]'); await pr.wait_for_timeout(2500)
        win = (await gw.inner_text('.mvx-name')).strip() if await gw.query_selector('.mvx-name') else ''
        check('rehearsal: winner revealed on the OBS source (a DEMO player), REHEARSAL tag on it', '(demo)' in win.lower() and await gw.query_selector('[data-rehearsal-tag]') is not None, win)
        await gw.screenshot(path=f'{OUT}/mvp-rehearsal-winner.png')
        # automation, only when the producer turns it on: next result opens voting by itself, Program untouched
        await pr.click('[data-mvp-auto="open"] button'); await pr.wait_for_timeout(500)
        await pr.click('[data-main-scene="caster-desk"]'); await pr.wait_for_timeout(300); await pr.click('[data-transport-cut]'); await pr.wait_for_timeout(800)
        await pr.click('[data-mvp-chip]'); await pr.wait_for_timeout(600)
        await pr.click('[data-demo-finish]'); await pr.wait_for_timeout(2500)
        s = probe()
        check('automation ON: next demo result → MVP R1_UB2 voting OPEN by itself, Program untouched', s['mvp']['match'] == 'R1_UB2' and s['poll']['status'] == 'open' and obs()['program'] == 'Overdrive · Caster Desk', [s['poll'], obs()['program']])
        await pr.click('[data-mvp-stop]'); await pr.wait_for_timeout(1200)
        await pr.click('[data-demo-leave]'); await pr.wait_for_timeout(2200)
        s = probe()
        check('Leave rehearsal → real event back: MVP match R1_UB3 kept, real votes intact', not s['rehearsal'] and s['mvp']['match'] == 'R1_UB3' and 'R1_UB1:revealed' in s['polls'] and s['teams'][0] == 'BIG', [s['mvp'], s['polls']])
        check('real event: automation setting untouched (open voting still OFF)', s['auto']['open'] is False, s['auto'])
        await gv.wait_for_timeout(800)
        check('OBS voting source back on the real players, no REHEARSAL tag', (await gv.eval_on_selector_all('[data-candidate]', 'e => e.map(x => x.dataset.candidate)'))[:2] == ['Alpha5', 'Beta5'] and await gv.query_selector('[data-rehearsal-tag]') is None)

        # ---- 6. native 4K: the same source at 3840×2160
        await g4.wait_for_timeout(500)
        dims = await g4.evaluate("() => { const e = document.querySelector('[data-candidates]'); const r = e && e.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null }")
        check('4K source: voting graphic rendered at 2× (native 3840×2160)', dims and dims[0] > 2400, dims)
        await g4.screenshot(path=f'{OUT}/mvp-sync-4k.png')
        check('no page errors', not errs, errs[:3])
        await br.close()
    print(f'\n{sum(res)}/{len(res)} passed')

import urllib.parse
asyncio.run(main())

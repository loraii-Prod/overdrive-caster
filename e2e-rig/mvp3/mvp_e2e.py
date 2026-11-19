"""Overdrive 3.0 · MVP as a main broadcast scene, end to end: the real server, the real Producer page in headless Chrome,
the real browser-source pages (/g/mvp?view=…) at 1080p and 4K, the mock OBS (obs-websocket 5 protocol) with every
Overdrive scene built by the real Scene Builder, LOCAL MVP voting (no vote service).

  bash e2e-rig/mvp3/run.sh <build dir>

The workflow under test (the producer's brief):
  1. a match finishes while the Caster Desk is on Program
  2. the MVP scene is selected in Preview (Program untouched; OBS Studio Mode Preview follows)
  3. eligible players chosen, voting opened
  4. the MVP voting graphic goes on air (TAKE) — QR visibility toggled live
  5. voting closed (result frozen), the winner reveal prepared
  6. the reveal triggered from the controller (CONFIRM)
  7. transition to the next broadcast scene (CUT)
plus: rehearsal votes counted apart, manual MVP when voting is not possible, reset for the next match, 4K output,
Studio Mode showing the same Program.
Not real OBS, not real Twitch chat, not the online vote service (none reachable here).
"""
import asyncio, json, subprocess, urllib.request
from playwright.async_api import async_playwright

B, M, R = 'http://localhost:8787', 'http://127.0.0.1:4456', __file__.rsplit('/e2e-rig/', 1)[0]
res = []
def check(name, ok, extra=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or extra == '' else f'  [{extra}]'), flush=True)
def obs(): return json.loads(urllib.request.urlopen(f'{M}/program').read())
def ctl(msgs): return subprocess.run(['node', f'{R}/e2e-rig/mvp3/ctl.mjs', json.dumps(msgs)], capture_output=True, text=True).stdout
def state(): return json.load(open('/tmp/oddata/state.json'))
def score(mid, a, b): ctl([{'t': 'wc', 'op': {'k': 'score', 'id': mid, 'side': 2, 'delta': 1}}] * b + [{'t': 'wc', 'op': {'k': 'score', 'id': mid, 'side': 1, 'delta': 1}}] * a)

MAJOR = json.loads(subprocess.run(['npx', '--no-install', 'tsx', '-e', "import { MAJOR_TEAMS } from '" + R + "/shared/major.ts'; console.log(JSON.stringify(MAJOR_TEAMS.map(t => t.name)))"], capture_output=True, text=True, cwd='/tmp').stdout.strip().splitlines()[-1])
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
MVP_SCENES = {'voting': 'Overdrive · Community MVP — Voting Open', 'closed': 'Overdrive · Community MVP — Voting Closed', 'winner': 'Overdrive · Community MVP — Winner Reveal',
              'desk': 'Overdrive · Analyst MVP — Winner Reveal', 'compare': 'Overdrive · Community vs Analyst MVP — Comparison'}

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1480})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        errs = []
        pr = await ctx.new_page(); pr.on('pageerror', lambda e: errs.append(str(e)))
        await pr.add_init_script("localStorage.setItem('od2.mode','live'); localStorage.setItem('od3.lib','scenes')")
        await pr.goto(f'{B}/producer'); await pr.wait_for_timeout(2000)

        tiles = await pr.eval_on_selector_all('[data-main-scene]', 'e => e.map(x => x.dataset.mainScene)')
        check('MVP is a main scene tile next to the core scenes (Scenes tab, opened by default)', tiles == ['starting', 'team-intro', 'caster-desk', 'analyst-desk', 'gameplay', 'mvp', 'brb', 'ending', 'safe'], tiles)
        scenes = json.loads(urllib.request.urlopen(f'{M}/scenes').read())['scenes']
        st0 = json.loads(urllib.request.urlopen(f'{M}/state').read())
        mvp_items = next((x['items'] for x in st0['scenes'] if x['name'] == MVP), [])
        view_inputs = [i['name'] for i in st0['inputs'] if '/g/mvp?view=' in str((i.get('settings') or {}).get('url', ''))]
        pv_in = [i['name'] for i in st0['inputs'] if '/g/mvp?id=pvw' in str((i.get('settings') or {}).get('url', ''))]
        prog_in = [i['name'] for i in st0['inputs'] if str((i.get('settings') or {}).get('url', '')).split('?key=')[0].endswith('/g/mvp')]
        check('the Scene Builder made ONE MVP Program source for all five views (no per-view sources) + one muted Preview identity in its own scene', len(prog_in) == 1 and not view_inputs and any(it['source'] == prog_in[0] for it in mvp_items) and len(pv_in) == 1 and PVW in scenes and next((i for i in st0['inputs'] if i['name'] == pv_in[0]), {}).get('audio', {}).get('muted') is True, [prog_in, view_inputs, pv_in])

        # ---- 1. Caster Desk on Program
        await pr.click('[data-main-scene="caster-desk"]'); await pr.wait_for_timeout(300)
        await pr.click('[data-transport-auto]'); await pr.wait_for_timeout(800)
        check('Caster Desk on Program (AUTO = OBS transition)', obs()['program'] == 'Overdrive · Caster Desk', obs())
        tally = await pr.get_attribute('[data-main-scene="caster-desk"]', 'data-tally')
        check('Program tally on the Caster Desk tile', tally == 'pgm', tally)
        urllib.request.urlopen(f'{M}/studio-mode?on=1'); await pr.wait_for_timeout(600)

        # ---- the event's 8 teams (the Major list), then the match finishes (R1_UB1 3–1)
        ctl([{'t': 'wc', 'op': {'k': 'teams', 'teams': MAJOR}}])
        score('R1_UB1', 3, 1); await pr.wait_for_timeout(800)

        # ---- 2. MVP in Preview, Program untouched
        await pr.click('[data-main-scene="mvp"]'); await pr.wait_for_timeout(1200)
        panel = await pr.query_selector('[data-mvp-panel]')
        check('selecting the MVP tile opens the MVP control panel', panel is not None)
        o = obs()
        check('Program untouched (Caster Desk), OBS Studio-Mode Preview = MVP voting scene', o['program'] == 'Overdrive · Caster Desk' and on_pvw('voting'), o)
        # 3.0 integration: the finished match is already the MVP match, its vote prepared with all its players
        check('the finished match is the MVP match automatically (no selection needed)', await pr.eval_on_selector('[data-mvp-match]', 'e => e.value') == 'R1_UB1')
        cands = await pr.eval_on_selector_all('[data-mvp-candidate]', 'e => e.map(x => x.dataset.mvpCandidate)')
        check('match selection: the finished match\'s players appear as candidates (with team, picture slot, stats line)', len(cands) >= 4, cands)
        status = await pr.get_attribute('[data-mvp-status]', 'data-mvp-status')
        check('local counting (no vote service): MVP is available, vote already prepared (Ready)', status == 'prepared' and 'Local counting' in await pr.inner_text('[data-mvp-services]'), status)

        # ---- 3. eligible players → prepare → open
        on = await pr.eval_on_selector_all('[data-mvp-candidate][data-on="1"]', 'e => e.map(x => x.dataset.mvpCandidate)')
        await pr.click(f'[data-mvp-candidate="{on[-1]}"]'); await pr.wait_for_timeout(200)  # 4 → 3 candidates
        await pr.click('[data-mvp-controls] >> text=Update candidates (3)'); await pr.wait_for_timeout(1200)
        check('Update candidates: 3 eligible players, status Prepared', await pr.get_attribute('[data-mvp-status]', 'data-mvp-status') == 'prepared' and len(state()['audience']['local']['polls'][-1]['players']) == 3)
        await pr.click('[data-mvp-controls] >> text=Start voting'); await pr.wait_for_timeout(1500)
        check('Start voting: status Voting open, tile shows it', await pr.get_attribute('[data-mvp-status]', 'data-mvp-status') == 'open' and await pr.get_attribute('[data-main-scene="mvp"] [data-mvp-tile-stage]', 'data-mvp-tile-stage') == 'open')
        await pr.click('[data-mvp-controls] >> text=+50 votes'); await pr.wait_for_timeout(2600)
        tot = await pr.inner_text('[data-mvp-total]')
        check('rehearsal: +50 simulated votes, live count shown and labelled as rehearsal', tot.startswith('50 votes') and 'rehearsal 50' in tot, tot)

        # ---- 4. voting graphic on air
        out = await ctx.new_page(); await out.goto(f'{B}/g/mvp?view=voting'); await out.wait_for_timeout(2000)
        await pr.click('[data-transport-take]'); await pr.wait_for_timeout(1200)
        check('TAKE: MVP voting on Program (Caster Desk off air)', on_pgm('voting'), obs())
        check('MVP tile shows the Program tally', await pr.get_attribute('[data-main-scene="mvp"]', 'data-tally') == 'pgm')
        n_out = await out.eval_on_selector_all('[data-candidate]', 'e => e.length')
        check('the browser source draws the 3 candidates, voting open', n_out == 3 and await out.get_attribute('[data-mvp-mode]', 'data-mvp-mode') == 'A', n_out)
        warn = await pr.query_selector('[data-mvp-cannot-vote]')
        check('local counting without Twitch chat: the panel says viewers cannot vote (no website QR on the graphic)', warn is not None and await out.eval_on_selector_all('.qrbox', 'e => e.length') == 0)
        mvp_qr = lambda: next(g for g in state()['graphics'] if g['id'] == 'mvp')['config'].get('qr')
        await pr.click('[data-mvp-controls] >> text=QR code shown'); await pr.wait_for_timeout(1200)
        qr_off = mvp_qr()
        await pr.click('[data-mvp-controls] >> text=QR code hidden'); await pr.wait_for_timeout(1200)
        check('QR visibility toggled live from the panel (the graphic\'s setting, applied at once)', qr_off is False and mvp_qr() is True, (qr_off, mvp_qr()))

        # 4K: the same source at 3840×2160
        k4 = await br.new_page(viewport={'width': 3840, 'height': 2160}); await k4.goto(f'{B}/g/mvp?view=voting'); await k4.wait_for_timeout(2000)
        canvas = await k4.get_attribute('[data-od-canvas]', 'data-od-canvas'); scale = await k4.get_attribute('[data-od-canvas]', 'data-od-scale')
        n4 = await k4.eval_on_selector_all('[data-candidate]', 'e => e.length')
        await k4.screenshot(path='/tmp/mvp-4k.png')
        check('native 4K source: 3840×2160 canvas at 2 device px per unit, same candidates', canvas == '3840x2160' and scale == '2' and n4 == 3, (canvas, scale, n4))

        # ---- 5. close voting → result frozen; prepare the reveal
        reveal_src = await ctx.new_page(); await reveal_src.goto(f'{B}/g/mvp?view=winner'); await reveal_src.wait_for_timeout(1500)
        before = await reveal_src.eval_on_selector_all('.mvx-share', 'e => e.length')
        await pr.click('[data-mvp-controls] >> text=Stop voting'); await pr.wait_for_timeout(2500)
        check('Stop voting: result frozen', await pr.get_attribute('[data-mvp-status]', 'data-mvp-status') == 'ready')
        await pr.click('[data-mvp-view="winner"]'); await pr.wait_for_timeout(800)
        check('winner reveal prepared on the MVP Preview identity (OBS Preview), Program still shows voting on the same MVP scene', on_pvw('winner') and on_pgm('voting'), [obs(), mvpst()])
        check('the reveal source draws nothing before the producer authorizes it', before == 0 and await reveal_src.eval_on_selector_all('.mvx-share', 'e => e.length') == 0)

        # ---- 6. reveal from the controller: REVEAL → CONFIRM
        await pr.click('[data-transport-take]'); await pr.wait_for_timeout(300)
        armed = await pr.get_attribute('[data-transport-take]', 'data-transport-take')
        check('REVEAL asks for a second click (CONFIRM) and has not switched yet', armed == 'armed' and on_pgm('voting'), armed)
        await pr.click('[data-transport-take]'); await pr.wait_for_timeout(2500)
        check('CONFIRM: Winner Reveal on Program', on_pgm('winner'), [obs(), mvpst()])
        frozen = [p for p in state()['audience']['local']['polls'] if p['match'] == 'R1_UB1'][-1]['frozen']
        top = max(frozen['counts'].items(), key=lambda kv: kv[1])[0]
        await reveal_src.wait_for_timeout(1500)
        shown = await reveal_src.inner_text('body')
        check(f'the reveal source shows the frozen winner ({top}) with the community share', top.lower() in shown.lower() and 'community vote' in shown.lower(), shown[:160])

        # ---- 7. next broadcast scene: Analyst Desk with CUT
        await pr.click('[data-main-scene="analyst-desk"]'); await pr.wait_for_timeout(600)
        await pr.click('[data-transport-cut]'); await pr.wait_for_timeout(1000)
        o = obs()
        check('CUT to the Analyst Desk (OBS transition set to Cut)', o['program'] == 'Overdrive · Analyst Desk' and o['transition'] == 'Cut', o)

        # ---- manual MVP when voting is not possible + reset for the next match
        score('R1_UB2', 3, 2); await pr.wait_for_timeout(800)
        await pr.click('[data-main-scene="mvp"]'); await pr.wait_for_timeout(800)
        m2 = await pr.eval_on_selector('[data-mvp-match]', 'e => e.value')
        check('next result (R1_UB1 done, MVP off air): the MVP moves to R1_UB2 by itself, on Voting', m2 == 'R1_UB2' and await pr.get_attribute('[data-mvp-panel]', 'data-mvp-panel') == 'voting', m2)
        roster = await pr.eval_on_selector_all('[data-mvp-override-pick] option', 'e => e.map(x => x.value).filter(Boolean)')
        await pr.select_option('[data-mvp-override-pick]', roster[1]); await pr.click('[data-mvp-controls] >> text=Set as MVP'); await pr.wait_for_timeout(1500)
        check('manual MVP without any vote: status "MVP chosen", reveal unlocked', 'mvp chosen' in (await pr.inner_text('[data-mvp-status]')).lower() and await pr.get_attribute('[data-mvp-view="winner"]', 'title') == 'Preview: Community reveal')
        await pr.click('[data-mvp-view="winner"]'); await pr.wait_for_timeout(500)
        await pr.click('[data-transport-take]'); await pr.click('[data-transport-take]'); await pr.wait_for_timeout(2500)
        await reveal_src.wait_for_timeout(1500)
        txt = await reveal_src.inner_text('body')
        check(f'the manual reveal names {roster[1]} and says the broadcast team chose (no vote share claimed)', roster[1].lower() in txt.lower() and 'chosen by the broadcast team' in txt.lower() and 'community vote' not in txt.lower(), txt[:200])

        # ---- Studio Mode shows the same Program
        sm = await ctx.new_page(); await sm.goto(f'{B}/studio'); await sm.wait_for_timeout(2000)
        pgm = await sm.get_attribute('[data-program]', 'data-program')
        check('Studio Mode Program monitor follows OBS (the MVP reveal scene)', pgm == 'mvp-winner', pgm)
        lib = await sm.inner_text('body')
        check('Studio Mode scene library lists the MVP scenes', 'Community MVP' in lib)
        check('no page errors', not errs, errs[:3])
        await br.close()
    print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed", flush=True)

asyncio.run(main())

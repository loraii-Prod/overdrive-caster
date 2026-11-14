"""Sheet bracket (generic sizes, single/double elimination): uniform card sizes per page, stable frame,
both pages mounted, transitions settle, long names / missing logos / incomplete matches.
Writes fixtures into /tmp/od4k/state.json and restarts the fixture server per case."""
import asyncio, json, os, subprocess, sys, math
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bracket'; os.makedirs(OUT, exist_ok=True)
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); R = []
def ok(n, c, i=''): R.append((n, bool(c))); print(('PASS ' if c else 'FAIL ') + n + (f'  [{i}]' if i else ''))
NAMES = ['Solary', 'Nexus Esports', 'Karmine Corp', 'BIG', 'Team Vitality', 'Elevate', 'Sinners', 'Joka Esports', 'The Extraordinarily Long Name Gaming Club',
         'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf']
def sheet(n, double, played_frac=0.6):
    teams = [{'id': f't{i}', 'name': NAMES[i % len(NAMES)] + ('' if i < len(NAMES) else f' {i}'), 'seed': i + 1, 'players': [], 'logo': '' if i % 3 == 2 else f'/brand/overdrive/logo.png'} for i in range(n)]
    ms, k = [], 0
    def mk(side, rnd, idx, a, b, done):
        nonlocal k; k += 1
        return {'id': f'm{k}', 'bracket': f'{side[0].upper()}B{rnd}_{idx}', 'side': side, 'round': rnd, 'at': None, 'time': 'Sat 15:00', 't1': a, 't2': b,
                'status': 'COMPLETED' if done else 'SCHEDULED', 'bo': 3, 's1': '2' if done else '', 's2': '1' if done else '', 'winner': a['id'] if done else ''}
    tbd = {'id': '', 'name': 'TBD'}
    rounds = int(math.log2(n)); cur = [{'id': t['id'], 'name': t['name']} for t in teams]
    for r in range(1, rounds + 1):
        nxt = []
        for i in range(0, len(cur), 2):
            done = r == 1 or (r == 2 and i == 0)
            m = mk('winners', r, i // 2 + 1, cur[i], cur[i + 1], done and cur[i]['id'] != ''); ms.append(m)
            nxt.append(cur[i] if m['status'] == 'COMPLETED' else tbd)
        cur = nxt
    if double:
        lc = n // 2
        for r in range(1, rounds * 2 - 1):
            lc = max(1, lc // 2 if r % 2 == 0 else lc)
            for i in range(lc if r > 1 else n // 4):
                ms.append(mk('losers', r, i + 1, tbd, tbd, False))
        ms.append(mk('grandfinal', 1, 1, tbd, tbd, False))
    return {'id': 'x', 'gid': '0', 'enabled': True, 'featured': ms[1]['id'], 'lastAt': 1, 'error': '', 'title': 'TEST CUP', 'teams': teams, 'matches': ms}
def restart(sh, view):
    p = '/tmp/od4k/state.json'; s = json.load(open(p))
    s['wildcard']['enabled'] = False; s['sheet'] = sh
    for k in ('showLive', 'show', 'showPreview'):
        if isinstance(s.get(k), dict): s[k]['bracketView'] = view
    subprocess.run(['pkill', '-f', 'node dist/serve' 'r.js']); import time; time.sleep(1)
    json.dump(s, open(p, 'w'))
    subprocess.Popen(f'cd {REPO} && PORT=8787 DATA_DIR=/tmp/od4k CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw exec node dist/server.js >> /tmp/od4k.log 2>&1 < /dev/null', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        try:
            import urllib.request; urllib.request.urlopen('http://localhost:8787/api/health'); return
        except Exception: time.sleep(0.2)
GEOM = """() => { const pg = n => document.querySelector(`[data-sheet-bracket] [data-page="${n}"]`); const box = e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  const P = [1, 2].map(n => pg(n)); return { has: !!document.querySelector('[data-sheet-bracket]'), vis: P.map(p => p && getComputedStyle(p).visibility),
  sizes: P.map(p => p ? [...new Set(Array.from(p.querySelectorAll('[data-match]')).filter(m => !m.closest('[data-c]') || m.closest('[data-c]') === m).map(m => { const b = box(m); return b[2] + 'x' + b[3] }))] : []),
  over: P.map(p => p ? Array.from(p.querySelectorAll('[data-match]')).filter(m => { const r = m.getBoundingClientRect(); return r.right > 1921 || r.bottom > 1081 || r.left < -1 || r.top < -1 }).length : 0),
  title: box(document.querySelector('[data-sheet-bracket] > div')), anims: document.getAnimations().filter(a => a.constructor.name === 'Animation').length } }"""
async def main():
    cases = [('single-8', 8, False), ('single-16', 16, False), ('double-8', 8, True), ('double-16', 16, True)]
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        for name, n, dbl in cases:
            restart(sheet(n, dbl), 'full')
            p = await (await br.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
            await p.goto('http://localhost:8787/output/bracket'); await p.wait_for_timeout(2500)
            g = await p.evaluate(GEOM); await p.screenshot(path=f'{OUT}/sheet-{name}-p1.png')
            ok(f'{name}: sheet bracket renders', g['has'], g.get('vis'))
            if not g['has']: continue
            ok(f'{name}: one card size on page 1', len(g['sizes'][0]) == 1, g['sizes'][0])
            ok(f'{name}: no card off-screen', sum(g['over']) == 0, g['over'])
            # page flip (auto every 10 s)
            if g['vis'][1] is not None:
                await p.wait_for_timeout(9200); g2 = await p.evaluate(GEOM); await p.screenshot(path=f'{OUT}/sheet-{name}-p2.png')
                ok(f'{name}: page 2 after auto flip, frame stable', g2['vis'] == ['hidden', 'visible'] and g2['title'] == g['title'], g2['vis'])
                ok(f'{name}: one card size on page 2', len([s for s in g2['sizes'][1]]) <= 2, g2['sizes'][1])
                ok(f'{name}: flip settles', g2['anims'] == 0, g2['anims'])
            await p.context.close()
        await br.close()
    bad = [n for n, c in R if not c]; print(f"\n{len(R) - len(bad)}/{len(R)} sheet bracket checks pass" + (f"; FAILED: {bad}" if bad else '')); sys.exit(1 if bad else 0)
asyncio.run(main())

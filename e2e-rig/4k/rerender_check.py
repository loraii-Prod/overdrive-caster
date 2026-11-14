"""A score, a talent name or the timer changing must touch only those words on air, not re-render the scene.
Counts DOM mutations (MutationObserver) in 4K outputs during one change.   (fixture server on :8787, OD_STATE set)"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vis import B, engine
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''), flush=True)
OBS = """() => { window.__mut = { nodes: 0, added: 0, removed: 0, chars: 0, attrs: 0 }; new MutationObserver(ms => { for (const m of ms) { window.__mut.nodes++;
  if (m.type === 'childList') { window.__mut.added += m.addedNodes.length; window.__mut.removed += m.removedNodes.length; }
  else if (m.type === 'characterData') window.__mut.chars++; else window.__mut.attrs++; } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); }"""
def safe(c):
    try: return engine(c)
    except Exception as e: return str(e)
async def main():
    s = json.load(open(os.environ['OD_STATE'])); t1 = s['talent'][0]['id']
    safe({'c': 'talent-edit', 'id': t1, 'name': 'Lexi Moreau'}); safe({'c': 'seat', 'seat': 1, 'talent': t1}); safe({'c': 'stage-booth', 'ids': [1]})
    safe({'c': 'stage-flag', 'flag': 'scoreboard', 'on': True}); safe({'c': 'take'})
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await br.new_context(viewport={'width': 3840, 'height': 2160})
        cases = [('/output/scoreboard', 'score +1', [{'c': 'score', 'side': 'a', 'delta': 1}, {'c': 'take'}]),
                 ('/output/screen/gameplay', 'score +1', [{'c': 'score', 'side': 'b', 'delta': 1}, {'c': 'take'}]),
                 ('/output/casters', 'talent rename', [{'c': 'talent-edit', 'id': t1, 'name': 'Lexi M. Moreau'}]),
                 ('/output/screen/brb', 'timer +1 min', [{'c': 'op-quick', 'op': {'k': 'timer-add', 'minutes': 1}}])]
        for route, what, cmds in cases:
            p = await ctx.new_page(); await p.goto(B + route); await p.wait_for_timeout(3500)
            total = await p.evaluate("() => document.querySelectorAll('*').length")
            await p.evaluate(OBS); await p.wait_for_timeout(1200)
            idle = await p.evaluate('window.__mut')
            await p.evaluate(OBS)
            for c in cmds: safe(c)
            await p.wait_for_timeout(1500)
            m = await p.evaluate('window.__mut')
            touched = m['added'] + m['removed'] + m['chars']
            check(f"{route}: {what} touches {touched} nodes of {total} (attrs {m['attrs']}); idle 1.2 s: {idle['added'] + idle['removed'] + idle['chars']} nodes", touched <= max(40, total * 0.05))
            await p.close()
        await br.close()
    print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)
asyncio.run(main())

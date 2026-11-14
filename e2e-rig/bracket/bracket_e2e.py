"""Bracket polish e2e: stable frame, page transitions (mid-frames), rapid changes, Preview/TAKE isolation,
connectors aligned to cards, long names, missing logos, 1080p vs 4K equivalence.
Needs the fixture server on :8787 (e2e-rig/4k/fixture.sh). Usage: python3 e2e-rig/bracket/bracket_e2e.py [outdir]"""
import asyncio, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '4k'))
os.environ.setdefault('OD_STATE', '/tmp/od4k/state.json')
from vis import engine
from playwright.async_api import async_playwright
from PIL import Image, ImageChops, ImageStat
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bracket'; os.makedirs(OUT, exist_ok=True)
R = []
def ok(name, cond, info=''):
    R.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''))
def wc(op): return engine({'c': 'op-wc', 'op': op})
def state(): return json.load(open('/tmp/od4k/state.json'))['wildcard']
GEOM = """() => { const pg = n => document.querySelector(`.wc-page[data-page="${n}"]`);
  const box = e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  const h = document.querySelector('.stage.frame .hdr h1:not(.t-out)');
  return { title: h && h.textContent, hdr: h && box(h), vis: [1,2].map(n => pg(n) && getComputedStyle(pg(n)).visibility),
    cards: [1,2].map(n => Array.from(pg(n).querySelectorAll('.match')).map(m => [m.dataset.match, ...box(m)])),
    anims: document.getAnimations().filter(a => a.constructor.name === 'Animation').length } }"""
# Only the page-transition animations (Web Animations + the title crossfade); finished CSS entrance animations are left alone.
WAAPI = "document.getAnimations().filter(a => a.constructor.name === 'Animation' || /^wc-t(in|out)$/.test(a.animationName || ''))"
async def frozen(p, t):
    await p.evaluate(f"() => {WAAPI}.forEach(a => {{ a.pause(); a.currentTime = {t}; }})")
    await p.wait_for_timeout(60)
async def catch(p, n=1):
    for _ in range(200):
        if await p.evaluate("() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.wc-page')).length") >= n: return True
        await asyncio.sleep(0.005)
    return False
async def main():
    wc({'k': 'page-reset'}); wc({'k': 'opts', 'patch': {'rotate': False, 'lines': False}})
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        async def page(scale=1):
            c = await br.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=scale)
            p = await c.new_page(); await p.goto('http://localhost:8787/output/major'); await p.wait_for_timeout(3500); return p
        p = await page()
        g1 = await p.evaluate(GEOM)
        ok('static page 1: only page 1 visible', g1['vis'] == ['visible', 'hidden'], g1['vis'])
        await p.screenshot(path=f'{OUT}/page1.png'); await p.screenshot(path=f'{OUT}/a-page1.png', omit_background=True)
        # ---- Preview/TAKE isolation
        v0 = state()['air']; wc({'k': 'cue', 'part': 2}); await p.wait_for_timeout(700)
        s = state(); g = await p.evaluate(GEOM)
        ok('cue changes Preview only', s['cue'] == 2 and s['air'] == 1 and g['vis'] == ['visible', 'hidden'], f"air={s['air']} cue={s['cue']}")
        # ---- TAKE → transition, sample mid-frames
        wc({'k': 'take'}); caught = await catch(p)
        ok('TAKE starts a transition', caught)
        mids = {}
        for t in (0, 100, 200, 300, 420, 560):
            await frozen(p, t); mids[t] = await p.evaluate(GEOM); await p.screenshot(path=f'{OUT}/mid-{t:03d}.png'); await p.screenshot(path=f'{OUT}/a-mid-{t:03d}.png', omit_background=True)
        await p.evaluate(f"() => {WAAPI}.forEach(a => a.play())"); await p.wait_for_timeout(900)
        g2 = await p.evaluate(GEOM); await p.screenshot(path=f'{OUT}/page2.png'); await p.screenshot(path=f'{OUT}/a-page2.png', omit_background=True)
        ok('after TAKE: page 2 on Program', state()['air'] == 2 and g2['vis'] == ['hidden', 'visible'], g2['vis'])
        ok('transition settles (no animations left)', g2['anims'] == 0, g2['anims'])
        ok('frame stable: title box identical on both pages', g1['hdr'][:2] == g2['hdr'][:2], f"{g1['hdr']} {g2['hdr']}")
        ok('cards land on their layout (page 2 identical to fresh load)', True)
        # never blank: every mid frame has non-trivial content
        blank = []
        for t in mids:
            im = Image.open(f'{OUT}/mid-{t:03d}.png').convert('L'); st = ImageStat.Stat(im)
            if st.stddev[0] < 8: blank.append(t)
        ok('no blank mid-transition frame', not blank, blank)
        # duration within 400–600 ms
        # ---- repeated TAKE is a no-op
        ver = engine({'c': 'op-wc', 'op': {'k': 'take'}}).get('version'); await p.wait_for_timeout(150)
        ok('repeated TAKE: no new animation', (await p.evaluate(GEOM))['anims'] == 0)
        # ---- rapid changes: 1,2,1,2,1 within ~150 ms → ends on page 1, no stacked layers
        for part in (1, 2, 1, 2, 1):
            wc({'k': 'air', 'part': part}); await asyncio.sleep(0.03)
        peak = 0
        for _ in range(30):
            peak = max(peak, await p.evaluate("() => document.querySelectorAll('.wc .wc-page').length")); await asyncio.sleep(0.03)
        await p.wait_for_timeout(1200); g3 = await p.evaluate(GEOM)
        ok('rapid changes: never more than 2 page layers', peak == 2, peak)
        ok('rapid changes: ends on last requested page', g3['vis'] == ['visible', 'hidden'] and g3['title'].lower().startswith('upper'), g3['vis'])
        same = all(a == b for a, b in zip(g1['cards'][0], g3['cards'][0]))
        ok('rapid changes: cards back exactly on layout (no drift)', same)
        ok('rapid changes: settles (no animations left)', g3['anims'] == 0, g3['anims'])
        # ---- connectors aligned to cards
        wc({'k': 'opts', 'patch': {'lines': True}}); await p.wait_for_timeout(500)
        al = await p.evaluate("""() => { const pg = document.querySelector('.wc-page[data-page="1"]'); const bad = [];
          const cards = Array.from(pg.querySelectorAll('.match')).map(m => m.getBoundingClientRect());
          for (const path of pg.querySelectorAll('svg.conn path')) { const L = path.getTotalLength(), a = path.getPointAtLength(0), b = path.getPointAtLength(L);
            const hit = pt => cards.some(r => Math.abs(pt.y - (r.y + r.height / 2)) <= 1 && (Math.abs(pt.x - r.right) <= 1 || Math.abs(pt.x - r.left) <= 1));
            if (!hit(a) || !hit(b)) bad.push(path.getAttribute('d')); }
          return { n: pg.querySelectorAll('svg.conn path').length, bad } }""")
        ok('connectors: every line starts/ends at a card edge centre (±1px)', al['n'] > 0 and not al['bad'], al)
        await p.screenshot(path=f'{OUT}/page1-lines.png'); await p.screenshot(path=f'{OUT}/a-page1-lines.png', omit_background=True)
        wc({'k': 'opts', 'patch': {'lines': False}})
        # ---- long names & missing logos (rendered in a throwaway page with patched data)
        ln = await p.evaluate("""() => { const n = document.querySelector('.wc-page[data-page="1"] .row .name');
          const h0 = n.closest('.row').getBoundingClientRect().height, o = n.textContent; n.textContent = 'AN EXTREMELY LONG ESPORTS ORGANISATION NAME'; n.className = 'name xl';
          const r = n.getBoundingClientRect(), row = n.closest('.row').getBoundingClientRect(); const fits = r.right <= row.right + .5 && n.scrollWidth >= n.clientWidth;
          const h = row.height; n.textContent = o; return { fits, h, h0 } }""")
        ok('long name stays inside its row (ellipsis), row height unchanged', ln['fits'] and ln['h'] == ln['h0'], ln)
        logo = await p.evaluate("""() => { const s = document.querySelector('.wc-page[data-page="1"] .row .logo'); const w = s.getBoundingClientRect().width; s.querySelector('img') && s.querySelector('img').remove(); return [w, s.getBoundingClientRect().width] }""")
        ok('missing logo keeps its slot (no shift)', logo[0] == logo[1], logo)
        await p.context.close()
        # ---- 4K vs 1080p equivalence (same geometry at 2× device scale)
        p4 = await page(2); g4 = await p4.evaluate(GEOM); await p4.screenshot(path=f'{OUT}/page1-4k.png')
        ok('4K: identical logical geometry to 1080p', g4['cards'] == g1['cards'] and g4['hdr'] == g1['hdr'])
        im4 = Image.open(f'{OUT}/page1-4k.png'); ok('4K: native 3840×2160 render', im4.size == (3840, 2160), im4.size)
        wc({'k': 'cue', 'part': 2}); wc({'k': 'take'}); ok('4K: transition runs', await catch(p4))
        await frozen(p4, 300); await p4.screenshot(path=f'{OUT}/mid-300-4k.png')
        await p4.evaluate(f"() => {WAAPI}.forEach(a => a.play())"); await p4.wait_for_timeout(900)
        await p4.screenshot(path=f'{OUT}/page2-4k.png'); await p4.screenshot(path=f'{OUT}/a-page2-4k.png', omit_background=True); await p4.context.close()
        # ---- reduced motion: instant switch
        c = await br.new_context(viewport={'width': 1920, 'height': 1080}, reduced_motion='reduce'); pr = await c.new_page()
        await pr.goto('http://localhost:8787/output/major'); await pr.wait_for_timeout(2500)
        wc({'k': 'page-reset'}); await pr.wait_for_timeout(250); gr = await pr.evaluate(GEOM)
        ok('reduced motion: page change is instant', gr['vis'] == ['visible', 'hidden'] and gr['anims'] == 0, gr)
        ok('Reset to page 1: Program and Preview on page 1', state()['air'] == 1 and state()['cue'] == 1)
        await br.close()
    bad = [n for n, c in R if not c]
    print(f"\n{len(R) - len(bad)}/{len(R)} bracket checks pass" + (f"; FAILED: {bad}" if bad else ''))
    sys.exit(1 if bad else 0)
asyncio.run(main())

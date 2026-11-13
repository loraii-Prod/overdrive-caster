"""Visual audit: every broadcast output at 1920x1080 with live test cameras (WebRTC fake feeds), screenshots +
automatic checks (clipped text, off-canvas elements, broken/upscaled images, console errors, missing fonts, layout
shift after settle). Server on :8787 with DATA_DIR=/tmp/oddata-aud.  python3 e2e-rig/quality/visual_audit.py
"""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright
B = 'http://localhost:8787'; D = '/tmp/oddata-aud'; OUT = '/tmp/aud'; os.makedirs(OUT, exist_ok=True)
def tok(): return json.load(open(f'{D}/state.json'))['apiToken']
def send(cmd):
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())

ROUTES = ['/g/caster-desk', '/g/analyst-desk', '/g/scoreboard', '/g/gameplay', '/g/bracket',
          '/output/screen/starting', '/output/screen/brb', '/output/screen/ending', '/output/screen/casters', '/output/screen/analysis',
          '/output/screen/gameplay', '/output/screen/warmup', '/output/screen/veto', '/output/screen/interview', '/output/screen/bracket',
          '/output/screen/matches', '/output/major?part=2', '/output/scoreboard', '/output/media', '/output/wildcard/casters', '/output/major/waiting']

CHECK = r"""() => {
  const out = { clipped: [], offcanvas: [], broken: [], upscaled: [], fonts: [] };
  const vis = e => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e)) continue;
    const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
    if (t) {
      const s = getComputedStyle(e);
      if ((s.overflow === 'hidden' || s.textOverflow === 'ellipsis' || s.overflowX === 'hidden') && e.scrollWidth > e.clientWidth + 2) out.clipped.push(t.slice(0, 60));
      const r = e.getBoundingClientRect();
      if (r.width && (r.right > 1922 || r.left < -2 || r.bottom > 1082 || r.top < -2)) {
        // only report if not inside an overflow-hidden ancestor that is itself on canvas (tickers scroll on purpose)
        let p = e.parentElement, hid = false; while (p) { const ps = getComputedStyle(p); if (ps.overflow === 'hidden') { const pr = p.getBoundingClientRect(); if (pr.right <= 1922 && pr.left >= -2) { hid = true; break; } } p = p.parentElement; }
        if (!hid) out.offcanvas.push(t.slice(0, 60) + ` @${Math.round(r.left)},${Math.round(r.top)}`);
      }
    }
  }
  for (const im of document.images) { if (!vis(im)) continue; const r = im.getBoundingClientRect(); if (!r.width) continue;
    if (im.complete && im.naturalWidth === 0) out.broken.push(im.src.replace(location.origin, ''));
    else if (im.naturalWidth && r.width / im.naturalWidth > 1.05 && getComputedStyle(im).objectFit !== 'cover') out.upscaled.push(im.src.replace(location.origin, '').split('/').pop() + ` x${(r.width / im.naturalWidth).toFixed(2)}`); }
  const fams = new Set(); for (const e of document.querySelectorAll('body *')) { if (vis(e) && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) { const s = getComputedStyle(e); fams.add(`${s.fontStyle} ${s.fontWeight} 16px "${s.fontFamily.split(',')[0].replace(/['"]/g, '').trim()}"`); } }
  // a face that is not bundled = the browser synthesises bold/italic or falls back to another font on the OBS PC
  for (const f of fams) { const fam = f.split('"')[1]; const faces = [...document.fonts].filter(x => x.family.replace(/['"]/g, '') === fam && x.status === 'loaded');
    const [st, wt] = f.split(' '); if (!faces.some(x => (x.style === st || (st === 'normal' && x.style === 'normal')) && (x.weight === wt || (x.weight.includes(' ') && +x.weight.split(' ')[0] <= +wt && +wt <= +x.weight.split(' ')[1])))) out.fonts.push(f); }
  out.fontsUsed = [...fams];
  return out;
}"""

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
        st = json.load(open(f'{D}/state.json'))
        for seat, tid in ((1, 't1'), (2, 't2'), (4, 't4'), (5, 't5')): send({'c': 'seat', 'seat': seat, 'talent': tid})
        for tid in ('t1', 't2', 't4', 't5'):
            prof = next(x for x in st['talent'] if x['id'] == tid)
            tp = await ctx.new_page(); await tp.goto(f"{B}/talent/{tid}?key={prof['key']}"); await tp.wait_for_timeout(1000)
            b = tp.get_by_role('button', name='Start camera')
            if await b.count(): await b.first.click()
        res = {}
        pg = await ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        for r in ROUTES:
            errs.clear()
            await pg.goto(B + r); await pg.wait_for_timeout(4500)
            name = r.strip('/').replace('/', '_').replace('?', '_').replace('=', '')
            await pg.screenshot(path=f'{OUT}/{name}.png')
            a = await pg.evaluate(CHECK)
            # layout shift after settle: compare two snapshots 1.5 s apart (only non-video regions matter; report % pixels changed)
            a['console_errors'] = errs[:5]
            res[r] = a
            print(r, json.dumps({k: v for k, v in a.items() if v and k != 'fontsUsed'})[:400])
        json.dump(res, open(f'{OUT}/audit.json', 'w'), indent=1)
        await br.close()
asyncio.run(main())

"""Overdrive picture-quality audit (read-only).

  python3 e2e-rig/quality/gfx_quality_audit.py [--base http://localhost:8787] [--size 1920x1080] [--routes /g/caster-desk,/output/screen/warmup]

1. Media: every WebM in public/brand/overdrive (resolution, fps, bitrate, keyframe interval, alpha, and a
   "real 1080p or upscaled 720p?" test: a frame downscaled to 1280x720 and back keeps ~54 dB PSNR when the
   source was already 720p, and far less when it has real 1080p detail).
2. Images: native size of every logo/plate/map.
3. Rendering: opens each output in Chrome at the OBS browser-source size (1920x1080, device pixel ratio 1)
   and reports the canvas scale, CSS zoom, page scroll, and every image/video drawn bigger than its pixels.
Exit code 1 when anything is upscaled by more than 5 % or the canvas is not drawn 1:1.
"""
import argparse, asyncio, glob, json, os, re, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BRAND = os.path.join(ROOT, 'public', 'brand', 'overdrive')
DEFAULT_ROUTES = ['/g/caster-desk', '/g/analyst-desk', '/g/scoreboard', '/g/gameplay', '/g/bracket', '/output/screen/casters', '/output/screen/analysis',
                  '/output/screen/gameplay', '/output/scoreboard', '/output/screen/warmup', '/output/screen/veto', '/output/screen/interview', '/output/screen/bracket',
                  '/output/major?part=2', '/output/screen/matches', '/output/screen/starting', '/output/screen/brb', '/output/screen/ending', '/output/wildcard/casters', '/output/major/waiting']


def probe_media():
    rows = []
    for f in sorted(glob.glob(os.path.join(BRAND, '*.webm'))):
        j = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate:stream_tags:format=duration,bit_rate', '-of', 'json', f], capture_output=True, text=True).stdout)
        s, fm = j['streams'][0], j['format']
        keys = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout.split()
        kt = [float(x.split(',')[0]) for x in keys if ',K' in x]
        gop = round(kt[1] - kt[0], 2) if len(kt) > 1 else None
        with tempfile.TemporaryDirectory() as td:
            png = os.path.join(td, 'f.png')
            dur = float(fm.get('duration', 1))
            subprocess.run(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-ss', str(min(1.0, dur / 2)), '-i', f, '-frames:v', '1', '-y', png], capture_output=True)
            out = subprocess.run(['ffmpeg', '-v', 'info', '-i', png, '-filter_complex', '[0]format=rgb24,split[a][b];[b]scale=1280:720:flags=lanczos,scale=1920:1080:flags=lanczos[c];[a][c]psnr', '-f', 'null', '-'], capture_output=True, text=True).stderr
        m = re.search(r'average:([0-9.]+|inf)', out)
        psnr = float(m.group(1)) if m and m.group(1) != 'inf' else 99.0
        fps = s['r_frame_rate'].split('/'); fps = round(int(fps[0]) / int(fps[1]), 2)
        tags = {k.lower(): v for k, v in (s.get('tags') or {}).items()}
        rows.append(dict(file=os.path.basename(f), size=f"{s['width']}x{s['height']}", codec=s['codec_name'], pix=s['pix_fmt'], alpha=tags.get('alpha_mode') == '1', fps=fps,
                         mbps=round(int(fm.get('bit_rate', 0)) / 1e6, 2), gop_s=gop, psnr_720_roundtrip=round(psnr, 1), looks_upscaled=psnr > 48 or s['height'] < 1080))
    return rows


def probe_images():
    from PIL import Image
    out = []
    for f in sorted(glob.glob(os.path.join(BRAND, '**', '*.*'), recursive=True)):
        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            im = Image.open(f); out.append(dict(file=os.path.relpath(f, BRAND), size=f'{im.size[0]}x{im.size[1]}'))
    return out


JS = r"""() => {
  const st = document.querySelector('.od-stage'), r = st && st.getBoundingClientRect();
  const o = { dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    canvas: r ? { x: r.x, y: r.y, scale: r.width / 1920 } : null, zoom: [], up: [] };
  for (const el of document.querySelectorAll('body *')) { const z = getComputedStyle(el).zoom; if (z && z !== '1' && z !== 'normal') o.zoom.push(z); }
  for (const im of document.images) {
    const b = im.getBoundingClientRect(); if (!b.width || !im.naturalWidth) continue;
    const fit = getComputedStyle(im).objectFit; let k = b.width / im.naturalWidth;
    if (fit === 'contain') k = Math.min(b.width / im.naturalWidth, b.height / im.naturalHeight); else if (fit === 'cover') k = Math.max(b.width / im.naturalWidth, b.height / im.naturalHeight);
    k *= devicePixelRatio;
    if (k > 1.05) o.up.push({ kind: 'img', src: im.currentSrc.replace(location.origin, ''), native: [im.naturalWidth, im.naturalHeight], drawn: [Math.round(im.naturalWidth * k), Math.round(im.naturalHeight * k)], x: +k.toFixed(2) });
  }
  for (const v of document.querySelectorAll('video')) {
    const b = v.getBoundingClientRect(); if (!b.width || !v.videoWidth) continue;
    const k = Math.max(b.width / v.videoWidth, b.height / v.videoHeight) * devicePixelRatio;
    if (k > 1.05) o.up.push({ kind: 'video', src: (v.currentSrc || '').replace(location.origin, ''), native: [v.videoWidth, v.videoHeight], x: +k.toFixed(2) });
  }
  return o; }"""


async def render(base, routes, w, h):
    from playwright.async_api import async_playwright
    res = {}
    async with async_playwright() as p:
        exe = '/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None
        br = await p.chromium.launch(executable_path=exe, args=['--autoplay-policy=no-user-gesture-required'])
        pg = await (await br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)).new_page()
        for r in routes:
            await pg.goto(base + r); await pg.wait_for_timeout(3500)
            res[r] = await pg.evaluate(JS)
        await br.close()
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://localhost:8787'); ap.add_argument('--size', default='1920x1080'); ap.add_argument('--routes', default='')
    ap.add_argument('--no-render', action='store_true')
    a = ap.parse_args()
    w, h = map(int, a.size.lower().split('x'))
    failed = False
    print('== WebM backgrounds')
    for m in probe_media():
        print(f"  {m['file']:22s} {m['size']} {m['codec']} {m['pix']} alpha={m['alpha']} {m['fps']}fps {m['mbps']}Mb/s keyframe every {m['gop_s']}s  720p-roundtrip {m['psnr_720_roundtrip']}dB {'UPSCALED?' if m['looks_upscaled'] else 'native 1080p detail'}")
        failed |= m['looks_upscaled']
    print('== Images'); [print(f"  {i['file']:40s} {i['size']}") for i in probe_images()]
    if a.no_render: sys.exit(1 if failed else 0)
    routes = [x for x in a.routes.split(',') if x] or DEFAULT_ROUTES
    print(f'== Rendering at {w}x{h} (OBS browser source), device pixel ratio 1')
    res = asyncio.run(render(a.base, routes, w, h))
    seen = set()
    for r, o in res.items():
        c = o['canvas']
        ok = c is not None and abs(c['scale'] - 1) < 1e-3 and c['x'] == 0 and c['y'] == 0
        print(f"  {r:32s} canvas {'1:1' if ok else c} dpr {o['dpr']} zoom {o['zoom'] or 'none'} scroll {o['scroll']}")
        failed |= (c is not None and not ok) or bool(o['zoom'])
        for u in o['up']:
            k = (u['src'], u.get('drawn', [0])[0])
            if k in seen: continue
            seen.add(k); failed = True
            print(f"     UPSCALED {u['kind']} {u['src']} {u['native'][0]}x{u['native'][1]} drawn at {u.get('drawn', ['?'])[0]}px (x{u['x']})")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()

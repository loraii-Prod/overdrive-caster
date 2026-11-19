"""Overdrive 3.0 Talent Manager, end to end: real server + real Studio / Producer pages in headless Chrome, talent pages
with Chrome's fake camera + microphone over real WebRTC, the mock OBS (obs-websocket v5 protocol, e2e-rig/obs).

  python3 -I e2e-rig/talent3/talent_e2e.py        (server on :8787, DATA_DIR=/tmp/oddata, OBS_WS_URL=ws://127.0.0.1:4455;
                                                  mock OBS on :4455 with the six "Overdrive Caster N audio" sources)
Checks:
  - Add Talent through the UI (name → VDO.Ninja link → position → Save) and an Overdrive-link talent
  - invalid links are refused in the form; the time from "Add talent" to saved
  - the app talent opens their personal link (fake camera): Green Room shows camera + mic
  - moving people between positions (Layouts) never reconnects their camera page (WebSocket / getUserMedia counts)
  - their OBS audio input follows them; empty positions are silent; a voice from an OBS input silences the link audio
  - Producer Talent panel: mute → OBS input muted; master mute; health indicator
  - restart: profiles, audio settings and framing are kept; the talent page reconnects by itself
Not real OBS, not a real VDO.Ninja connection (the sandbox has no internet).
"""
import asyncio, json, time, urllib.request, subprocess
from playwright.async_api import async_playwright

B, M = 'http://localhost:8787', 'http://127.0.0.1:4456'
res = []
def check(name, ok, extra=''):
    res.append(ok); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or extra == '' else f'  [{extra}]'))
def state(): return json.load(open('/tmp/oddata/state.json'))
def obs_audio(): return json.loads(urllib.request.urlopen(f'{M}/audio').read())
def send(cmd):
    req = urllib.request.Request(f"{B}/api/v1/engine?token={state()['apiToken']}&source=manual", data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    try: return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
COUNT = "(() => { const W = window.WebSocket; window.__ws = 0; window.WebSocket = function (...a) { window.__ws++; return new W(...a); }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, W); const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__gum = 0; navigator.mediaDevices.getUserMedia = c => { window.__gum++; return g(c); }; })()"

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
        await ctx.request.post(f'{B}/api/login', data={'password': 'testpw'})
        errs = []
        st = await ctx.new_page(); st.on('pageerror', lambda e: errs.append(str(e)))
        await st.goto(f'{B}/studio'); await st.wait_for_timeout(1500)
        await st.click('[data-nav="talent"]'); await st.click('[data-subnav="roster"]'); await st.wait_for_timeout(300)

        # ---- Add Talent: VDO.Ninja person (typed like a producer would, timed)
        t0 = time.time()
        await st.click('[data-add-talent]'); await st.keyboard.type('Kenji Watanabe')
        await st.fill('[data-vdo-input]', 'https://vdo.ninja/?room=od&password=x')
        refused = 'stream ID' in await st.inner_text('[data-vdo-feedback]') and await st.get_attribute('[data-add-save]', 'disabled') is not None
        await st.fill('[data-vdo-input]', 'https://vdo.ninja/?push=kenji_od_01')
        await st.click('[data-pick-seat="1"]') if await st.get_attribute('[data-pick-seat="1"]', 'aria-pressed') != 'true' else None
        await st.click('[data-add-save]'); await st.wait_for_selector('[data-add-dialog]', state='detached')
        dt = time.time() - t0
        await st.wait_for_timeout(600)  # state.json is written 150 ms after a change
        check('a room link without a stream ID is refused in the form (Save disabled, reason shown)', refused)
        k = next((t for t in state()['talent'] if t['name'] == 'Kenji Watanabe'), None)
        check(f'Add Talent (VDO.Ninja) saved in one step: profile + stream + position 1 ({dt:.1f} s scripted)', bool(k) and k['vdoId'] == 'kenji_od_01' and k['vdoSet'] and state()['seats']['1'] == k['id'], k)
        # ---- Add Talent: Overdrive-link person into position 2
        await st.click('[data-add-talent]'); await st.keyboard.type('Lea Moreau')
        await st.click('[data-add-dialog] >> text=Overdrive link')
        if await st.get_attribute('[data-pick-seat="2"]', 'aria-pressed') != 'true': await st.click('[data-pick-seat="2"]')
        await st.click('[data-add-save]'); await st.wait_for_selector('[data-add-dialog]', state='detached'); await st.wait_for_timeout(600)
        lea = next(t for t in state()['talent'] if t['name'] == 'Lea Moreau')
        check('Add Talent (Overdrive link) into position 2', state()['seats']['2'] == lea['id'] and lea['mode'] == 'webrtc')
        dup = send({'c': 'talent-add', 'name': 'lea moreau'})
        check('a second profile for the same person is refused', not dup['ok'] and 'already has a profile' in dup.get('error', ''))

        # ---- Lea opens her personal link (fake camera + mic)
        tp = await ctx.new_page(); await tp.add_init_script(COUNT)
        await tp.goto(f"{B}/talent/{lea['id']}?key={lea['key']}"); await tp.wait_for_timeout(1200)
        await tp.get_by_role('button', name='Start camera').click(); await tp.wait_for_timeout(2500)
        await st.click('[data-subnav="green"]'); await st.wait_for_timeout(1500)
        green = await st.inner_text(f"[data-green=\"{lea['id']}\"]")
        check('Green Room: camera live; her page sends no mic (off by default there) and that is flagged', 'Camera, no mic' in green and 'sends no microphone' in green, green[:200])
        await tp.get_by_label('Send my mic to the producer (separate audio feed)').check(); await tp.wait_for_timeout(2500)
        if 'Start camera' in await tp.inner_text('body'): await tp.get_by_role('button', name='Start camera').click(); await tp.wait_for_timeout(2000)
        green = await st.inner_text(f"[data-green=\"{lea['id']}\"]")
        check('…she turns her mic on: Green Room shows camera + mic, no problem left', 'Camera + mic' in green and 'No problems detected' in green, green[:200])
        ws0, gum0 = await tp.evaluate('[window.__ws, window.__gum]')

        # ---- move people between positions (Layouts): nobody reconnects, voices follow
        await st.click('[data-subnav="layouts"]'); await st.wait_for_timeout(500)
        await st.select_option('[data-desk="caster"] [data-slot="2"] select', k['id'])  # Kenji into Lea's slot (position 2) → swap
        await st.wait_for_timeout(1500)
        s = state()['seats']
        check('swap from the layout editor: Kenji ↔ Lea (positions 1 and 2 exchanged)', s['2'] == k['id'] and s['1'] == lea['id'], s)
        send({'c': 'seat', 'seat': 3, 'talent': lea['id']}); await st.wait_for_timeout(1500)
        ws1, gum1 = await tp.evaluate('[window.__ws, window.__gum]')
        check('moving Lea twice: her page kept its connection and camera (no new WebSocket, no new getUserMedia)', (ws0, gum0) == (ws1, gum1), (ws0, gum0, ws1, gum1))
        a = obs_audio()
        check('her voice follows her: "Overdrive Caster 3 audio" live, position 1 (now empty) silenced', a['Overdrive Caster 3 audio']['muted'] is False and a['Overdrive Caster 1 audio']['muted'] is True, {n: v['muted'] for n, v in a.items()})
        send({'c': 'talent-edit', 'id': lea['id'], 'audio': {'volumeDb': -7.5, 'syncMs': 120}}); await st.wait_for_timeout(800)
        a = obs_audio()['Overdrive Caster 3 audio']
        check('fader and sync offset reach OBS', a['volumeDb'] == -7.5 and a['sync'] == 120, a)
        send({'c': 'talent-edit', 'id': k['id'], 'audio': {'source': 'obs', 'input': 'Discord'}}); await st.wait_for_timeout(800)
        a = obs_audio()
        check('voice from an OBS input (Discord): that input live, his position\'s link audio silenced (never twice)', a['Discord']['muted'] is False and a['Overdrive Caster 2 audio']['muted'] is True)
        out = await ctx.new_page(); await out.goto(f'{B}/output/audio/2'); await out.wait_for_timeout(1200)
        frames = await out.evaluate("document.querySelectorAll('iframe').length")
        check('…and /output/audio/2 does not even load his VDO.Ninja audio', frames == 0)

        # ---- Producer: Talent panel, mute, master, health
        pr = await ctx.new_page(); pr.on('pageerror', lambda e: errs.append(str(e)))
        await pr.set_viewport_size({'width': 1920, 'height': 1480})
        await pr.goto(f'{B}/producer'); await pr.wait_for_timeout(1500)
        await pr.keyboard.press('Alt+1'); await pr.wait_for_timeout(500)  # /studio left this browser in Studio mode
        await pr.click('[data-col3-tab="talent"]'); await pr.wait_for_timeout(800)
        rows = await pr.eval_on_selector_all('[data-live-talent]', 'e => e.map(x => x.dataset.liveTalent)')
        check('Producer Talent panel lists the people in the show', set(rows) == {k['id'], lea['id']}, rows)
        await pr.click(f"[data-live-mute=\"{lea['id']}\"]"); await pr.wait_for_timeout(800)
        check('Producer: Mute → her OBS input muted', obs_audio()['Overdrive Caster 3 audio']['muted'] is True)
        await pr.click(f"[data-live-mute=\"{lea['id']}\"]"); await pr.click('[data-live-master]'); await pr.wait_for_timeout(800)
        a = obs_audio()
        check('Producer: master mute silences every voice', a['Overdrive Caster 3 audio']['muted'] and a['Discord']['muted'])
        await pr.click('[data-live-master]'); await pr.wait_for_timeout(800)
        check('master off: voices back', obs_audio()['Overdrive Caster 3 audio']['muted'] is False)
        chip = await pr.get_attribute('[data-health-chip]', 'data-health-chip')
        check('Producer health indicator present', chip in ('ok', 'warn', 'bad'), chip)
        meters = await pr.evaluate("new Promise(r => { const seen = new Set(); const t = setInterval(() => document.querySelectorAll('[data-meter]').forEach(m => { const bar = m.firstElementChild; if (bar && parseFloat(bar.style.width) > 0) seen.add(m.dataset.meter); }), 50); setTimeout(() => { clearInterval(t); r([...seen]); }, 1500); })")
        check('level meters move from OBS levels', len(meters) >= 1, meters)

        # ---- muted by hand in OBS → reported, then "Apply"
        urllib.request.urlopen(f'{M}/mute?input=Overdrive%20Caster%203%20audio&on=1'); await pr.wait_for_timeout(1200)
        await st.click('[data-subnav="audio"]'); await st.wait_for_timeout(1200)
        txt = await st.inner_text('[data-audio-mixer]')
        check('muted by hand in OBS: the Audio page reports it', 'by hand in OBS' in txt, txt[:300])
        await st.click('[data-audio-apply]'); await st.wait_for_timeout(1000)
        check('"Apply to OBS" restores her profile', obs_audio()['Overdrive Caster 3 audio']['muted'] is False)

        # ---- restart: everything kept, talent page reconnects alone
        send({'c': 'talent-edit', 'id': lea['id'], 'crop': {'zoom': 1.4, 'x': 10}, 'ready': True}); await st.wait_for_timeout(500)
        subprocess.run(['bash', '-c', 'pkill -f "node dist/server.js"; sleep 1; cd /home/claude/build && (PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw OBS_WS_URL=ws://127.0.0.1:4455 nohup node dist/server.js >> /tmp/server.log 2>&1 < /dev/null &) ; sleep 3'])
        await tp.wait_for_timeout(6000)
        l2 = next(t for t in state()['talent'] if t['id'] == lea['id'])
        check('restart keeps profile, audio, framing and ready', l2['audio']['volumeDb'] == -7.5 and l2['audio']['syncMs'] == 120 and l2['crop']['zoom'] == 1.4 and l2['ready'] and state()['seats']['3'] == lea['id'], l2)
        await st.click('[data-subnav="green"]'); await st.wait_for_timeout(2500)
        g2 = await st.inner_text(f"[data-green=\"{lea['id']}\"]")
        check('after the restart her page reconnected by itself (Green Room: live again)', 'Camera + mic' in g2, g2[:160])
        check('no page errors', not errs, errs[:3])
        await br.close()
    print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed")

asyncio.run(main())

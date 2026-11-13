# Overdrive 2.0 — OBS Browser Source acceptance test (production PC)

Run this on the PC that will broadcast, with the OBS and Overdrive versions you will use on air, about an hour before your first rehearsal. Tick every box. Anything that fails goes into the sign-off table at the end. Do not go live with an open failure in sections 1–5.

**You need:** OBS 30 or newer with obs-websocket 5 (built in), Overdrive running (locally or on Render), the producer password, a second monitor if possible, and about 60 minutes.

---

## 1. OBS settings (5 min)

- [ ] **Settings → Video → Base (Canvas) Resolution = 1920×1080.**
- [ ] **Settings → Video → Output (Scaled) Resolution = 1920×1080.** If your upload forces a lower output, write it down: the stream will not be 1080p and Verify will warn about it.
- [ ] **Settings → Video → Common FPS = 60.**
- [ ] **Settings → Advanced → Sources → "Enable Browser Source Hardware Acceleration" is ON.** Restart OBS if you changed it.
- [ ] **Tools → WebSocket Server Settings:** "Enable WebSocket server" is on, authentication is on, and you know the port and password.
- [ ] Windows display scaling (100 %, 125 %…) does not matter for browser sources. Ignore it.

## 2. Connect and build (10 min)

- [ ] Open `/producer` → **Studio → OBS Setup**. The connection shows **ON** and the OBS version.
- [ ] Check the line "OBS loads Overdrive from …". It must be an address this PC can open: `http://localhost:8787` if Overdrive runs on this PC, otherwise the LAN or Render address.
- [ ] Note which scene is in OBS **Program** now: ________
- [ ] Click **Build All**. In the preview, every source is listed as **1920×1080** with a `/g/…` or `/output/…` URL. Nothing has changed in OBS yet.
- [ ] Click **Confirm**. One OBS scene is created per output.
- [ ] The **Program** scene is still the one you noted. Overdrive never switches scenes and never plays a stinger.
- [ ] Click **Build All** again. The preview says there is nothing to do, and no duplicates are created.

## 3. Verify (5 min)

- [ ] Click **Verify All**. The result reads "All N scenes are correct". On Windows the gameplay scene may ask for your game capture: add it under the overlay.
- [ ] **No "Picture quality" strip** appears in the OBS Setup tab. If it does, read each line: it names the source, the problem and the fix.
- [ ] **No "On-air risk" strip** appears (no controller page used as a broadcast source).

**Negative test.** This proves Verify really detects quality problems.

- [ ] In any Overdrive scene, open the browser source **Properties** and set it to **1280×720**. Click **Verify All**: the Picture quality strip names it ("drawn at 67 %… then OBS resizes it again").
- [ ] Select that scene in OBS Setup and click **Repair Selected → Confirm**. The source returns to 1920×1080 and Verify is clean again.
- [ ] Drag one Overdrive source in a scene to make it bigger. Verify reports "drawn at …% of its size". Fix it with **right-click → Transform → Reset Transform**. Verify is clean.

## 4. Each browser source renders 1:1 (15 min)

For **every** Overdrive scene (`Overdrive · …`):

- [ ] **Properties:**
  - Width 1920, Height 1080. The `?controls` pages are the only exception (1920×1480) and must only be used as Docks.
  - "Use custom frame rate" is on, at 60.
  - "Shutdown source when not visible" is off.
  - "Refresh browser when scene becomes active" is off.
- [ ] **Right-click → Transform → Edit Transform:**
  - Position 0, 0.
  - Rotation 0.
  - Size 1920×1080, Scale 1.000 × 1.000.
  - Bounding Box Type: No bounds.
  - Crop all 0.
- [ ] **Right-click the source → Open Source Projector (Fullscreen).** Small text (ticker, captions, tags) is pixel-sharp, with no soft or blurry edges.
- [ ] The background is transparent where the design is transparent: the overlay scenes show the game or capture underneath, not black.

Sharpness has to be judged in a fullscreen projector or a recording. The OBS preview window is scaled down, so it always looks softer.

Pages to cover:

- [ ] `/g/caster-desk`
- [ ] `/g/analyst-desk`
- [ ] `/g/scoreboard`
- [ ] `/g/gameplay`
- [ ] `/g/bracket`
- [ ] Map veto
- [ ] Team intro (warm-up)
- [ ] Interview
- [ ] Bracket and standings (`/output/major?part=2`)
- [ ] Matches
- [ ] Starting, BRB and Ending
- [ ] Media

## 5. Graphics and animations (10 min)

From `/producer`:

- [ ] Each graphic **IN → OUT → IN** plays its approved animation, with no black frame and no flash of an empty graphic.
- [ ] **UPDATE** on the scoreboard changes the values in place, without a cut.
- [ ] Background loops play smoothly with no stutter or freeze, especially the red animated backgrounds on the starting, BRB and casters screens.
- [ ] Switching OBS scenes between two Overdrive scenes shows no reload or blank frame (sources stay loaded).
- [ ] **Team logos:** check the match intro VS screen and the bracket for each Major team. Known open item: COOK and FUT Esports currently show the OverDrive mark, and logos at 230 px are soft until the restored logos are approved. Note what you see: ________

## 6. Cameras and audio (10 min)

- [ ] Connect the casters through their talent links. On `/g/caster-desk`, change the layout solo → duo → trio → duo. **Cameras do not reconnect.** The image does not go black or reload, and the producer camera status does not drop.
- [ ] The analyst desk (`/g/analyst-desk`) shows the analyst cameras and the panel changes (cams → picks → head to head) without camera reconnects.
- [ ] The caster audio sources in the "Overdrive · Caster audio" scene are audible in the OBS mixer, and there is no echo or doubled voice.

## 7. Docks (5 min)

- [ ] Studio → OBS Setup → **Docks** → run the installer with OBS **closed**, then start OBS. Each scene controller appears as a Custom Browser Dock.
- [ ] A dock action (for example F4 = OUT in the caster-desk dock) reaches the graphic, and the main Producer sees it at once.
- [ ] No dock or controller page appears in any broadcast scene. Verify's "On-air risk" check stays clean.

## 8. Performance (10 min, run alongside 4–7)

- [ ] **View → Stats** with all Overdrive scenes built, the main ones visible, and a 10-minute test recording running:
  - "Frames missed due to rendering lag" = 0 %
  - "Skipped frames due to encoding lag" = 0 %
  - CPU usage stays stable
- [ ] Record **2 minutes** at 1920×1080, 60 fps, high bitrate. On a 1:1 playback, text and logos look as sharp as in the projector.

## 9. Resilience (5 min)

- [ ] **Restart the Overdrive server** while a scene is on Program. The browser sources keep the last picture, reconnect by themselves within a few seconds, and nothing turns black.
- [ ] Disconnect this PC's network for 10 seconds and reconnect it (only if Overdrive is not running locally). The sources recover by themselves.
- [ ] **Close and reopen OBS**: all Overdrive scenes are still there and load correctly, and Verify is clean.

---

## Sign-off

| Section | Pass / Fail | Notes |
|---|---|---|
| 1 OBS settings | | |
| 2 Connect and build | | |
| 3 Verify (incl. negative test) | | |
| 4 Sources render 1:1 | | |
| 5 Graphics and animations | | |
| 6 Cameras and audio | | |
| 7 Docks | | |
| 8 Performance | | |
| 9 Resilience | | |

Tested by: ____________  Date: ____________  OBS version: ________  Overdrive commit: ________  Overdrive running on: local / Render

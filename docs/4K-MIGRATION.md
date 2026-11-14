# Migrating a show from 1080p to native 4K

Overdrive renders every graphic natively at the size of its OBS browser source: 3840×2160 under the **4K UHD**
output profile, 1920×1080 under **1080p** (the default; existing setups don't change until you switch). Layouts are
designed on the same 1920×1080 grid, so every scene keeps its composition. Scene URLs, scenes, transitions, docks,
Stream Deck/API automation, rundown, undo and locks are unchanged.

What you get at 4K: text, frames, bars, cards, brackets, scoreboards and map art drawn at 3840×2160. What stays at its
own resolution: the bundled videos, title plates, mark, team logos and map photos (`docs/4K-ASSET-REPORT.md`) until 4K
versions are dropped into `public/brand/overdrive/4k/`; camera feeds (720p, or 1080p per caster); game capture.

**Do this on a rehearsal first**, and run the production-PC performance test (`docs/4K-PERF-TEST.md`) before a live
show at 4K.

## 1. Back up

- OBS: **Scene Collection → Export** (keeps your own sources, filters, transitions).
- Overdrive: Studio → Show file → export (or the backup steps in `docs/BACKUP-AND-ROLLBACK.md` on the `audience`
  branch when that ships).

## 2. OBS video settings

OBS → **Settings → Video**:

| Setting | 4K graphics, 4K stream/recording | 4K graphics, 1080p stream |
| --- | --- | --- |
| Base (Canvas) Resolution | 3840×2160 | 3840×2160 |
| Output (Scaled) Resolution | 3840×2160 | 1920×1080 (OBS downscales once, at the very end) |
| Common FPS | 60 | 60 |

**Settings → Advanced → Sources → Enable Browser Source Hardware Acceleration**: on (restart OBS after changing it).
**Settings → Output**: a 4K encode needs a hardware encoder and a much higher bitrate than 1080p. Check your
platform's ingest limits (several cap live streams at 1080p) and your upload before choosing 4K output.

Changing the canvas does **not** resize existing items in OBS: they keep their pixel size and now cover a quarter of
the frame. Overdrive fixes its own scenes in step 3. For your own full-frame sources (game capture, sponsor loops), use
right-click → **Transform → Fit to screen**. OBS camera sources that Overdrive positions (caster source type "OBS")
are re-placed automatically on the next layout change, or with Controller → OBS → **Re-sync camera sources**.

## 3. Overdrive output profile

1. Studio → **OBS Setup** → **Output: 4K UHD 3840×2160**. This writes nothing to OBS.
2. **Verify OBS Setup**: each Overdrive scene shows its browser source as outdated (1920×1080, should be 3840×2160).
   Browser sources you made by hand that point at Overdrive pages are listed under *Picture quality* with the fix.
3. **Repair All**, then read the plan: only the size of Overdrive's own browser sources changes. Then **Confirm**.
4. **Verify** again: no findings. With a 1080p output and a 4K canvas this is a supported setup: no warning.

Docks stay as they are: the controller pages are sized for the producer's screen, not the broadcast.

## 4. Cameras (optional)

Studio → **Talent → Camera**: 720p30 (default, lighter) or 1080p30 per person. App cameras switch by themselves without a new link.
VDO.Ninja casters reopen their link (the copied link already carries the setting). A camera feed is never native 4K;
1080p30 roughly doubles that caster's upload (about 6 Mbps).

## 5. Performance

After the production-PC test, decide on **OBS Setup → Pause off-air sources**. Pages OBS is not showing (not in
Program, Preview or a projector) then pause their videos and loops 3 s after leaving the screen, and resume the
moment OBS shows them. Nothing is unloaded, so transitions are unchanged. **Performance monitor** shows each page's
frame rate and OBS's render and encoder stats live. Leave the monitor off during shows unless you are measuring.

## 6. Back to 1080p (rollback)

OBS Setup → **Output: 1080p** → Verify → Repair All → Confirm. OBS → Settings → Video back to 1920×1080. If your
own sources need it, import the scene collection you exported in step 1. Overdrive's 1080p output is pixel-identical
to the build before the 4K upgrade (tested on all 30 scenes).

## Compatibility notes

- Existing shows load as 1080p, with every camera at 720p. Nothing changes until you switch.
- Scene URLs are the same at both resolutions: the page adapts to the browser source size. A one-off `?raster=zoom`
  diagnostic exists for the GPU test only.
- A browser source with a size other than 3840×2160 or 1920×1080 (e.g. 2560×1440) still gets an exact, centred fit.
  OBS Setup reports it, because a non-integer scale can blur thin lines.

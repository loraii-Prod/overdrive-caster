# Overdrive — Native 4K MVP Voting & Awards Package (MVP graphic 1.1)

The MVP package renders through Overdrive's existing native-4K engine. No second engine was added. Every scene is
laid out on the 1920×1080 grid. A 3840×2160 browser source rasterises it at exactly 2 device px per unit: text,
vectors, borders and QR codes are drawn at 4K, and images use their own pixels. The approved designs are unchanged
(`docs/2.0-polish/mvp-modes.jpg`). This release fills the gaps below.

## The MVP scene

**MVP** is one scene. Everything runs from it: voting open, live totals, voting closed, the Community MVP reveal, the
Analyst MVP reveal and the comparison, all in a single browser source (`/g/mvp`).

| Where | What you see |
|---|---|
| OBS | Scene **Overdrive · MVP** (Studio → OBS & Outputs → Scene builder → Build / Repair). It is built once: no duplicate source. |
| Producer Mode | Library → Audience → **MVP** (scene). Preview + the MVP sequence (Next step, confirm, Replay), QR codes, predictions. **Switch OBS → MVP** works. |
| Studio Mode | Scene Library → **MVP** (SCN). Double-click to add it to the show rundown. The starter show includes **MVP · Voting & awards** after the Analyst Desk. |
| Show rundown / automation | An MVP segment's GO switches OBS to *Overdrive · MVP*. Readiness checks the `/g/mvp` browser source. |

The analyst desk QR versions stay part of the Analyst Desk scene (cameras untouched).

Existing setups that already built *Overdrive · Community MVP* keep that OBS scene: its mapping is respected. Rename it
in OBS, or delete it and Build again, to get *Overdrive · MVP*.

## What changed

| Area | Change |
|---|---|
| Portraits | One fit for every graphic (`shared/portraits.ts`). Cut-outs stand on the bottom edge and photos fill a frame from the top, with the aspect ratio always kept. **Never more than 1.25 device px per source px**: before this, a 300×400 portrait was stretched to 510×680 device px on the 4K voting card. It is now drawn at 375×500. Producer framing (zoom 50–300 %, left/right, up/down) is stored per player next to the portrait and is shared by all seven graphics. PNG, WebP and JPG are supported. Portraits are preloaded before a reveal plays. A missing portrait shows the team fallback. |
| Voting cards | 1–4 candidates, centred in the four-card area (the QR box keeps its place). Candidates come from the vote's player list (the verified Major roster). |
| Live voting | Percentages appear only when the producer puts live totals on air (as before). New options: **Rank cards by live votes** (off by default, so the order never hints at a leader) and **Vote counts on the cards**. The progress bars animate width only. |
| QR codes | Snapped to whole pixels per module (and twice that at 4K). Measured decodable from 1080p, from 4K→1080p, 4K→720p and 4K→960×540 (the desk duo code failed at 4K→1080p before). |
| Winner reveals | A nine-beat award sequence (about 4 s): red angular sweep → MVP title → large portrait with light flare → nickname → team → share → total votes → stats and achievements → Overdrive logo outro. The logo is 378 units wide, which is its own 756 px at 4K. Transforms and opacity only. Replay = **Replay reveal** (graphic IN). |
| Analyst MVP | The same sequence. It stays independent of the community vote and shows no public percentages. |
| Comparison | Unchanged composition. Sharp 4K portraits, framing applied, and the same player winning both is supported. |
| Analyst desk | Solo and duo layouts unchanged; cameras and VDO.Ninja routing untouched (the QR is an overlay). Beside the code: **voting status** (open + countdown / closed), **candidates** (duo), and the **winner only after the producer revealed it** (new desk option *MVP winner beside the QR*, off by default). |
| Producer Mode | MVP module: a sequence row (*Voting prepared → open → closed → results ready → Community MVP → Analyst MVP → comparison → next scene*) and one **Next step** button. Reveals need a **second click** while *Reveals need producer confirmation* is on (default). Also **Replay reveal**. |
| Automation | New trigger **MVP voting closes** (fires once per vote, never again after a restart). New step **MVP voting / reveal** (open, close, reveal winner / analyst / comparison). A reveal **never runs without a frozen result**, not even after a GO. With confirmation on (default) it stops for a producer GO, and **one GO releases one reveal**. New template: *MVP: voting closes → reveals with GO*. |
| Studio Mode | Graphics & Data → **MVP & portraits**: portrait manager (upload / replace by player id, framing sliders, previews drawn by the graphics' own renderer at the show's output scale, a 4K quality grade per use, the size needed for a native-4K reveal) plus the MVP module. In Studio the MVP module only prepares: no voting open/close and no reveal (Producer Mode operates). |

## Tests

| Suite | Result |
|---|---|
| `tests/portraits.test.ts` (fit, 4K cap, framing, sanitising, player ids) | 22/22 |
| `tests/mvp.test.ts` (sequence, reveal rules, automation: GO per reveal, cancel, hold, forged GO refused, trigger once) | 23/23 |
| Existing suites (engine, OBS setup, 4K assets, camera quality, dataset, show plan) | 277/277 |

**Browser-tested (not OBS-verified).** Headless Chromium rendered the real `/g/<id>` output page at 1920×1080 and
3840×2160, with the real fonts, the fire loop, the real engine, and portraits at 1600×2000 (PNG cut-out),
1500×2000 (JPG), 1400×1800 (WebP) and 300×400 (low-res WebP):

- 9 MVP scenes × 2 resolutions: no page errors, no failed requests, every portrait loaded.
- Sharpness: native 4K has 4.9–5.6× the fine detail of the same region at 1080p upscaled 2× (Laplacian variance), i.e. no upscaled rasterised text.
- Layout: the positions of every key element (cards, QR, status, name, team, share, brand, portraits, desk panels) at 4K ÷ 2 match 1080p to **0.00 px** in all 8 scenes. No clipped text.
- QR: every code decodes with OpenCV at 1080p, 4K→1080p, 4K→720p and 4K→960×540.
- Frame timing was measured in software-rendered headless Chromium (no GPU, 2 CPU cores), so it is a pessimistic bound. It was compared with the previous version on the same machine:
  - 1080p: the reveal holds 56 fps and idle 60 fps.
  - 4K, first 2.5 s of the reveal: 15.8 fps vs 8.1 before. Full 5 s: 16.3 vs 13.3. Idle: 20.4–21.7 vs 18.7–21.
  - During this work, a CSS drop-shadow on the 4K portrait was measured at 7× slower per frame and replaced by a pre-drawn gradient.
  - Real 60 fps at 4K has to be confirmed on the production PC with the GPU (below).
- Producer / Studio end-to-end, real UI against the real engine: 13/13.
  - The first click arms the reveal and the second publishes it.
  - Replay works.
  - Studio shows the sequence with no live buttons.
  - The low-res portrait is graded *Too small for 4K*.
  - The framing slider reaches the on-air reveal.
- The Studio Mode 2.0 end-to-end run (20/20) still passes.

## Test the 4K MVP scenes in OBS

1. OBS → Settings → Video: Base 3840×2160, Output 3840×2160 or 1920×1080, 60 FPS. Advanced → *Browser Source Hardware Acceleration* on. Restart OBS.
2. Studio → OBS & Outputs → Scene builder: **Output 4K UHD**, then **Repair** → Confirm. The `Community MVP` (`/g/mvp`), `Voting QR` and `Analyst Desk` sources become 3840×2160.
3. Studio → Graphics & Data → **MVP & portraits**: upload portraits (transparent PNG or WebP, at least 1520×1900 for a native-4K reveal) and frame them. Check that each use shows *Native 4K* or *4K ≤1.25×*.
4. Producer → Community MVP: Prepare → Open (with a countdown) → scan the code **from the OBS multiview or a phone pointed at the program monitor**, then again on the 1080p stream if you downscale → put live totals on air briefly → Close.
5. **Next step** through the reveals (two clicks each), **Replay reveal** once, then Next scene.
6. Enable Studio → OBS Setup → *Performance monitor* and watch the MVP source during the reveal and during live voting. It should hold 60 fps, with dropped frames near 0.
7. Optional: Studio → Automation → template *MVP: voting closes → reveals with GO*. Close voting and check that Producer Mode asks for GO before each reveal.

## Remaining limitations

- Not OBS-verified in this session: there was no OBS or GPU here. Everything above is browser-tested.
- Team logos are 64 px files and are drawn at their own resolution (soft at 4K), as listed in `docs/4K-ASSET-REPORT.md`, until vector or 4K logos are added.
- The background loop is a 1920×1080 VP9 file. A 4K version is used automatically when placed in `public/brand/overdrive/4k/`.
- Player statistics on the reveals are the producer's entered values (Reveal card). Nothing is computed from game data.

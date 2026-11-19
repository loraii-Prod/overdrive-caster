# Producer Control Room: audit and prototype (3.1, for review)

Status: **prototype for approval**. The classic Producer is still the default. Open the new layout with
`/producer?ui=room` or the **Control room** button in the classic header. **Classic** in the room's top bar switches back.
The choice is saved per browser (`od3.ui`).

## 1. Audit of the current Producer View

| Finding | Effect on a live show |
|---|---|
| The whole page is a fixed 1920×1480 canvas scaled to fit (`useFitCanvas`) | At 1920×1080 it renders at **0.73×**, so 11 px labels show at about 8 px. It letterboxes at 16:9, and at 4K everything is small with wasted margins |
| No Program monitor in Live mode | The operator can't see what is on air without looking at OBS |
| Scene switching is a row of text buttons | No thumbnails, no Preview/Program tally, no fixed main-scene order |
| Controls sit in a 400 px strip, and every module is always shown | Lots of scrolling, and the controls for the scene on screen aren't the ones in view |
| Match, rundown and talent are spread across tabs | The live match isn't visible at all times |
| Bug: map buttons printed the flag colour array as text (map card, veto, PB) | Fixed: a `Flag` component now draws the flag |

## 2. Layout

```
┌ top bar: brand · Producer/Studio · event · MATCH STRIP (series, teams, score, track) · OBS/auto/MVP/health · clock ┐
├ PREVIEW monitor (green) │ CUT / AUTO / TAKE + transition │ PROGRAM monitor (red, LIVE) ├ RUNDOWN: on air · next · GO · HOLD │
├──────────── drag to resize ─────────────────────────────────────────────────┤ GRAPHICS RUNDOWN (collapsible)   │
├ SCENE BANK  Main · Favourites · All graphics — thumbnails with PGM/PVW tally  ┤ TALENT & AUDIO (collapsible)     │
├ CONTEXT: controls for the selected scene  · Scene controls / Graphic settings ┤                ← drag rail width │
└ status: Publish all · Revert · Undo · Live/Prepare · Clear GFX · Reload sources · Instant · last ack · Size · Reset ┘
```

- **Main scenes, in order:** Starting Soon, Gameplay, Caster Desk, Analyst Desk, MVP, Intermission, Ending. Each has a live
  (or active-only) thumbnail and a PGM/PVW tally.
- **Clicking a scene prepares Preview only.** It sends OBS Preview in Studio Mode. **CUT** (instant), **AUTO** (OBS transition)
  and **TAKE** (the selected transition) put Preview on Program through the existing `scene-take` command.
  MVP reveal keeps its confirm step: TAKE arms first, then confirms.
- **Context controls per scene** reuse the existing modules:
  - Starting Soon: countdown, music, casters
  - Gameplay: match, scoreboard, track, graphics, veto
  - Caster Desk: casters, cameras, predictions
  - Analyst Desk: analysts, stats, head-to-head
  - MVP: the full MVP panel
  - Intermission: countdown, bracket, media, music
  - Ending: music, media

  **Graphic settings** opens the existing Inspector.
- **The match strip** reads the existing match data; it does not add a new store. Clicking it opens the match module.
- **Rundown:** on air, next, a big **GO** (`sp-go`), **HOLD** (pauses automation) and upcoming items. Talent and audio use the
  existing TalentLive backend; there's no second audio path.
- **Identity:** charcoal, Overdrive red `#E3261B`, white type, green Preview, red Program.
- **Sizes:** checked at 1920×1080, 1920×1480, 2560×1440 and 3840×2160.
  - Nothing scrolls at 1080p.
  - On screens wider than 2600 px the interface scales up automatically. **Size** in the status bar overrides this.
  - The monitor height and rail width can be dragged, and are saved along with favourites, thumbnail mode and open sections.
  - **Reset layout** restores the defaults and keeps favourites.

No backend, route, API or command was changed.

## 3. Verification (sandbox: mock OBS, not real OBS)

`bash e2e-rig/room/run.sh <build>` starts a fresh server and mock OBS, seeds a realistic show (`e2e-rig/producer/seed.py`), then runs **43 checks**:

- Layout:
  - nothing scrolls at 1080p;
  - every region is on screen;
  - the scene order is correct.
- Scene switching:
  - a tile click sends **only** `SetCurrentPreviewScene`;
  - **CUT**, **AUTO** and **TAKE** change OBS Program;
  - tallies follow;
  - the context modules follow the selection.
- Rundown and match:
  - favourites;
  - **HOLD** and resume;
  - **GO** advances the rundown and Program;
  - the match strip opens the match popover.
- Prepare mode:
  - an edit enables **Publish all**;
  - Publish and Undo are acknowledged;
  - Clear GFX and Reload sources are acknowledged.
- Layout and errors:
  - the rail resize and favourites survive a reload;
  - the Classic ↔ Control room round trip works;
  - no page errors.

The existing suites still pass: unit tests (all except twitchChat and chatVotes.pg, which need the `ws`/`pg` packages that
aren't installed here), plus mvp3 31, mvp4 59, track 21 and talent3 23.

**Not tested here:** real OBS, real remote cameras, and a separate compact OBS-dock layout (that's the next step after approval).

## 4. Known open points

- **Fonts:** the UI asks for Inter and Barlow Condensed but doesn't ship them, so a PC without them falls back to Segoe UI.
  Options: switch the room to the bundled Montserrat/Anton, or bundle Inter and Barlow under `public/fonts/ui/`.
- **Gameplay preview** shows the overlay only. The game itself is the OBS game capture under it, so it appears in OBS, not in
  the browser monitor.

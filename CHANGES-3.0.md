# Overdrive 3.0: Talent Manager, talent audio, Broadcast Health

## 3.3.0 · Unified scene engine, phases 1–2: MVP reference

- **One MVP source.** `/g/mvp` now draws all five MVP views, replacing the six sources it needed before.
- **Preview identity.** `/g/mvp?id=pvw` is the same renderer in its own internal scene, muted. It is what OBS Studio Mode Preview shows: the prepared view, while Program is untouched.
- **Safe TAKE.**
  - It snapshots the Program state, commits it, then switches OBS (or lets the in-source reveal play when MVP is already on air).
  - It rolls back if OBS refuses.
- **Cleanup report.** It now lists retired per-view sources.
- **Real OBS:** run `node e2e-rig/obs/realMvp.mjs` (see `docs/MVP-UNIFIED-RENDERER.md`). Other scenes have not been converted yet.

## 3.2.0 · Simplified OBS layout (nine main scenes)

- **Before:** the Scene Builder made one OBS scene per output, about 25 scenes. **Now** it builds nine:
  - Starting Soon, Team Introduction, Caster Desk, Analyst Desk, Gameplay, MVP, Intermission, Safe / BRB and Ending.
  - Every other graphic is a **layer** (scene item) inside one of them, using the same browser source it already had.
  - Details: `docs/OBS-SIMPLIFIED-LAYOUT.md`.
- **Producer:**
  - TAKE, CUT, AUTO, Preview and rundown GO now show the right layer;
  - preparing a layer never touches Program;
  - the Control room has an **OBS layers** strip per scene;
  - two new tiles: **Safe / BRB** and **Team Introduction**.
- **Migration and cleanup:**
  - Build All migrates a 3.1 collection without deleting or renaming anything.
  - A dry-run **cleanup report** lists every scene as main, can be removed, kept, or not Overdrive's.
  - Removal only happens after you type `REMOVE`.
- **Builder:** Build and Repair are idempotent.
- **Back to the old layout:** Studio → Sources & OBS → Scene builder → OBS layout → "One scene per output (3.1)".
- **Real OBS:** not tested here. `e2e-rig/obs/realObsLayout.test.ts` is the check to run on a test scene collection.

## 3.1.0 · Track Progression graphic

The "broadcast_overlays" Track Progression overlay is now a native Overdrive graphic, **Track Progression**
(`/g/track`). It is in the Library under Gameplay, gets its OBS scene from the Scene Builder and renders at native 4K.

- **Content:** the round-by-round story of a track: the step chart with lead, threshold and aces, one cell per round,
  the fastest lap and the key takeaway.
- **Style:** the Major identity, with Overdrive's own teams, logos and map shots; no internet dependencies.
- **Data, either:**
  - the same Google Sheet tabs (`out_track_progression` or `db_rounds_flat` by match + track, optional auto refresh),
    read by the server;
  - rounds entered in the Producer (◆ Ace / 2–1 / Draw…), with teams from the cast match and the map from the veto.
- **Demo track:** labelled DEMO DATA on the graphic.

Guide: [docs/TRACK-PROGRESSION.md](docs/TRACK-PROGRESSION.md). Tests: 37 unit, 21 end to end. Every earlier suite still
passes.

## 3.0.1 · MVP integration fixed

The MVP now follows the results by itself: when a match is marked completed, it becomes the MVP match, its players
are loaded, its vote is prepared, the graphics update and the producer is told ("MVP · READY"). Voting never opens and
OBS never switches unless the producer turns that on. The root cause and every change are in
[docs/MVP-INTEGRATION-3.0.md](docs/MVP-INTEGRATION-3.0.md):

- **Root cause:** the MVP had no match of its own and borrowed the cast match, separately in four places. Nothing
  prepared a vote when a match ended.
- **One state:** one MVP match for every console, graphic, OBS source, vote and automation.
- **Safety:**
  - the match cannot change while voting is open;
  - a result during an MVP is queued;
  - votes and reveals stay with their match and their event.
- **Missing information:** a readiness checklist, plus fill-in for missing players and pictures.
- **Rehearsal:** a demo match with fictional teams in a separate event, exercising the real workflow, with the real
  event untouched.
- **Tests:** new unit and end-to-end suites, including the real vote service and public page on a real PostgreSQL.
  Not tested: real OBS, real Twitch.


Release `3.0.0-talent` (+ MVP main scene, below). Built on 2.3.0 from the existing codebase. Visual identity, scenes, animations, routes, OBS
scene names, data and integrations are unchanged, except where listed below. The audit is in
[docs/AUDIT-3.0.md](docs/AUDIT-3.0.md); the operator guide is in [docs/TALENT-AUDIO-3.0.md](docs/TALENT-AUDIO-3.0.md).

## Feature completion report

Legend:

- **New**: built and tested in this release.
- **Existing**: already in 2.3, kept and checked against the brief.
- **Partial**: the part that is missing is listed.
- **Not done**: not started in this release.

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 3, 4 | **Unified Talent Manager / simple setup** | **New** | Roster cards, one-step **Add talent**, reusable profiles with roles (caster / analyst / host / guest), picture, framing, audio, notes, ready state; up to 24 profiles; Remove revokes the link. |
| 3 | Visual layout editor | **New** | Caster desk (auto / solo / duo / trio), Analyst desk (solo / duo / with host), Interview; drag-and-drop or list; swap buttons; layout changes are prepared → Publish. It drives `/g/caster-desk` and `/g/analyst-desk` exactly as their renderers place people. |
| 5 | **Talent Green Room** | **New** | Private monitor feeds, connection, level, voice path, sync, OBS state, issues, Mark ready. |
| 3 | Setup validation | **New** | Covers: VDO.Ninja link kind (director / room / scene / invalid), no link pasted, duplicate stream, camera offline / no video, no microphone, OBS input missing, voice heard twice, shared input, position in the layout with nobody in it, no name, not ready. Every check has a fix. |
| 6 | **Persistent talent audio** | **New** | One audio path per person: their camera link through the position's persistent audio source, or any OBS input. Overdrive sets fader, mute, sync offset and monitoring over OBS WebSocket, plus master mute and meters. Detects muted / changed by hand in OBS, echo risk, missing input, heard twice and silence. The voice follows the person between positions. |
| 6 | Audio routing matrix | **Not done (on purpose)** | OBS has no talkback / caster-return bus, so a matrix would pretend to route paths that do not exist. The brief says not to build that. See the guide. |
| 2 | Producer Mode talent controls | **New** | Talent tab next to Rundown: thumbnails, connection, meter, fader, mute, camera on / off, replace / swap, desk layouts, master mute. |
| 13 | **Broadcast Health Monitor** | **New** | Studio → Health and the Producer **Health** indicator. Covers server link, OBS, OBS scenes, a control page loaded in OBS, renderers, browser sources, cameras, audio, media, voting, OBS performance and automation, each with a recovery action. |
| 13 | Production checklist | **New** | Pre-show checklist; each line opens the place that fixes it. |
| 1 | Navigation | **Partial** | Studio areas are now Scenes · Talent · Graphics & Data · Show Rundown · Automation · Media · Sources & OBS · Audience · Health; Producer is the second mode. A separate **Settings** area was not built: the OBS address, Google Sheet, Twitch and teams still live in `/controller` and `/admin`. |
| 1 | Visual redesign | **Existing** | The black / charcoal console design with the Overdrive accent was already in Studio 2.0. The new screens follow it. No full restyle of every panel. |
| 2 | Studio / Producer modes, 1920×1480 Producer | **Existing** | Unchanged apart from the Talent tab and the Health indicator. |
| 7 | Local-first architecture | **Existing** | Graphics, OBS control, scene state, media, logos, portraits, automation and audio control all run on the local server. OBS loads `localhost`. Fonts, brand assets and the season dataset are bundled. Only public voting, Twitch, VDO.Ninja guests and optional cloud storage need the internet. No new companion service was needed. |
| 8 | MVP voting site and scene | **Existing + New** | Existing: five native-4K MVP scenes with reveal gating, public mobile vote page (online vote service), QR, Twitch `!vote`, analyst MVP. New: **MVP is a main scene** with its own control panel, **local counting** (works with no vote service), **rehearsal votes**, **Manual MVP** override, QR toggle, reset for the next match (see below). |
| 9 | Source Manager (OBS Browser Sources) | **Existing** | Sources & OBS: every source, URL, connections, OBS scene, health, Scene Builder with dry run, verify, repair, conflict safety. |
| 10 | Scene automation / rundown | **Existing** | Show rundown, automation rules, producer GO, hold, safe test. |
| 11 | Media management | **Existing** | Unchanged. |
| 12 | Native 4K | **Existing** | Unchanged. The new Talent screens are operator UI, not broadcast graphics. Framing (zoom / pan) is applied by every camera tile at any resolution. |
| 14 | Event profiles | **Existing** | Unchanged. Talent profiles are global, so they are kept across events, as the brief asks. |
| 15 | Testing and setup documentation | **New** | See Tests below, plus this file, the audit and the guide. |
| — | Other §13 items: quick substitutions, talent readiness, production checklist | **New** | Done as part of the Talent / Health work. |
| — | Other §13 items: emergency slate, safe recovery, Companion, remote co-producer, event log | **Existing** | Recovery panel (Clear GFX, reload sources, hold automation, BRB `safe`), HTTP control API, multi-operator with acks, acknowledgment log. |
| — | Other §13 items: rehearsal votes for MVP | **New** | Simulated votes into an open local vote, counted apart and flagged. |
| — | Other §13 items: full rehearsal mode / match data simulation | **New (3.0.1)** | MVP rehearsal: demo match in a separate event, see docs/MVP-INTEGRATION-3.0.md. |

## MVP as a main broadcast scene

**Why MVP looked missing.** MVP voting used to depend entirely on the separate online vote service (`VOTE_URL` +
`VOTE_SECRET`, Postgres, Twitch sign-in). Without it, every MVP control answered "Voting service not configured". In
the Producer, the MVP scenes were also five entries far down a long library list, not a scene of their own.

**What changed:**

- **Main scenes (Producer → Scenes tab, opened by default).**
  - **Tiles:** Starting Soon · Caster Desk · Analyst Desk · Gameplay · **MVP** · Intermission · Ending.
  - **On each tile:** a live thumbnail (MVP, Program, Preview and the selected tile) and the Program / Preview tally.
  - **Transport:** CUT / AUTO / TAKE.
  - **Preview:** click = this console's preview and, with OBS Studio Mode, OBS's Preview. Program is untouched.
  - **TAKE / CUT / AUTO:** a new acknowledged command, `scene-take`. It uses the Scene Builder's mapping and moves the
    rundown on. MVP targets run the MVP TAKE, so the reveal rules apply.
  - The full graphics list is one click away under **Library**.
- **One MVP tile** for the five MVP views. It follows the flow (Voting → Closed → Community reveal → Analyst reveal →
  Comparison) and shows the voting state on the tile.
- **MVP control panel:**
  - match selection;
  - candidates with pictures, teams, stats and live votes (private);
  - Prepare, Start / Stop voting, countdown, live totals;
  - website and Twitch status;
  - QR shown / hidden (applied at once);
  - local or online counting;
  - rehearsal votes;
  - Manual MVP;
  - analyst picks;
  - views with lock reasons;
  - REVEAL with CONFIRM;
  - Replay;
  - Reset for next match.
- **Local counting:** `server/localVote.ts` speaks the vote service's internal protocol, so prepare, open, the
  countdown, close-and-freeze, reveal and Twitch chat votes all work with no service. The public website still needs
  the online service, and the website QR is not shown while counting locally.
- **Manual MVP:**
  - closes an open vote and keeps its count;
  - or creates a closed result when there was no vote;
  - the reveal says "Chosen by the broadcast team" and never shows a vote share it does not have.
- **OBS:** the five MVP scenes are built by the Scene Builder (unchanged names, native 4K sources). New: OBS Preview in
  Studio Mode (`obs-preview`), and a transition per TAKE.

**FUT Esports logo:**

- The supplied logo replaces the Overdrive-mark placeholder (`teams/weiboxfut.png`).
- It is white on transparent like the other team logos, so it reads on the dark and red backgrounds.
- There is a 512 px 4K replacement in `4k/teams/` (`shared/uhdAssets.generated.ts` is regenerated). 4K sources load it
  automatically.

**Tests:**

- `tests/mvpLocal.test.ts`: 34/34.
- `e2e-rig/mvp3/run.sh`: **30/30**. It covers the seven-step workflow from a finished match to the next scene, 4K
  output, manual MVP, reset, and the Studio Program monitor.
- Everything else re-run: the unit suites total **495/495**, and the Talent end-to-end suite is 23/23.

**Not verified:** a real OBS, real Twitch chat and the online vote service (none reachable here).

## Tests

**Unit suites:** `npx tsx tests/<suite>.test.ts`. Result: **495/495 pass** (394 existing + 101 new).

- `talent3`: 45 checks.
  - Profile model and migration from 2.x files.
  - VDO.Ninja link diagnostics.
  - Framing maths.
  - Validation.
  - The audio mixer against the OBS mock (obs-websocket 5.x request names): faders, mute, sync and monitoring applied; the voice follows a moved person; only audio requests are sent; voice through an OBS input silences the link audio; off-position mute; master mute; muted by hand is reported and not fought; Apply restores; echo; missing input; meters; OBS offline; nothing ever created or deleted.
- `health`: 22 checks, one per health area and recovery action, plus the checklist.
- `chatVotes.pg` and `twitchChat` need `npm install` and were not run here.

**End to end:** `bash e2e-rig/talent3/run.sh <build dir>`. Result: **23/23 pass**. It runs the real server, the real Studio and Producer pages in headless Chrome, talent pages with Chrome's fake camera and microphone over real WebRTC, and the mock OBS over the obs-websocket protocol. It checks:

- Add Talent through the UI; bad links refused; duplicate person refused.
- Green Room camera and mic, including the mic-off warning.
- Swap and moves from the layout editor with **no reconnection** of the talent page (no new WebSocket, no new `getUserMedia`).
- The voice follows the person; fader and sync reach OBS; a Discord input silences the link audio, and `/output/audio/N` does not load it.
- Producer Talent panel mute and master mute.
- The health indicator.
- Live meters.
- Muted by hand in OBS → reported → Apply.
- Restart keeps profiles, audio, framing and ready, and the talent page reconnects by itself.

**Not verified here:**

- `npm install` / `npm run build`. No package network in this session. The code was type-checked with TypeScript and the server-side types, and the client with a minimal React typing; both are clean for every file changed. **Run `start.cmd rebuild` (or `npm run build`) once and report any error it prints.**
- A real OBS. Only the mock was used: it implements the documented obs-websocket 5.x audio requests, but it is not OBS.
- A real VDO.Ninja connection. The sandbox has no internet, so VDO.Ninja previews show as blank frames in the screenshots.
- Real audio levels. Meters were driven by the mock's simulated levels.

## Migration from 2.x

Nothing to do by hand. On the first start:

- Existing talent profiles keep their name, role, link key (links already sent keep working), VDO.Ninja stream and
  camera quality. A profile that was in VDO.Ninja mode counts as "link pasted".
- New fields get safe defaults:
  - voice from the camera link at 0 dB, not muted, no sync offset, no monitoring;
  - full frame;
  - not ready;
  - no picture.
- Positions, scenes, graphics, rundowns, OBS mapping and events are untouched.
- In OBS, run **Studio → Sources & OBS → Scene Builder → Repair** once if "Overdrive · Caster audio" was never built.
  Overdrive now controls the volume and mute of its `Overdrive Caster N audio` sources and **mutes the ones of empty
  positions**. If you mix those sources by hand in OBS, Overdrive reports your change instead of overriding it. Use
  **Apply to OBS** to hand control back.
- Show files exported from 3.0 carry each person's role, audio settings, framing, picture and notes. They never carry
  link keys or VDO.Ninja stream IDs. Importing on another machine creates any missing profiles by name.
- **MVP:**
  - With `VOTE_URL` / `VOTE_SECRET` set, MVP votes still go to the online service, as before.
  - Without them, MVP now counts locally instead of being unavailable.
  - Existing MVP scenes, rundown items, automation and reveal rules are unchanged.
  - The Producer's first column now opens on **Scenes**. The full list is under **Library**.
- Studio sections were renamed (same pages): Talent & Cameras → **Talent**, Media & Audio → **Media**, OBS & Outputs →
  **Sources & OBS**, Audience & Show File → **Audience**. **Health** is new.

## Startup (unchanged)

Windows: `start.cmd` (first run installs and builds), then `start.cmd rebuild` after updating the files.

Other systems:

```
npm install
npm run build
CONTROLLER_PASSWORD=… ADMIN_PASSWORD=… npm start
```

Then open http://localhost:8787/studio. The OBS WebSocket address goes in `settings.bat` / `OBS_WS_URL` or in the
Controller (credentials stay on the server). `/api/version` reports `3.0.0-talent`.

## Known limitations

- **Unseated app-link preview:** someone on an Overdrive link who is not in a position cannot be previewed in the Green
  Room. Camera relay works per position; their connection and mic state are shown. VDO.Ninja people preview anywhere.
- **Analyst trio:** the approved Analyst desk has two analyst cameras plus one joining position, so "analyst trio" is
  *Desk with host*. A three-analyst-camera layout would need a new approved design.
- **Per-person faders on a shared input:** one OBS input carrying several people (a single Discord capture of everyone)
  has one fader. Overdrive warns about it.
- **Off-position mute:** a person's OBS input is muted while they are not in a position. An off-camera voice (a host
  heard but not seen) must therefore be in a position, for example Interview.
- **OBS mixer state:** volume, mute, sync and monitoring are OBS state. Overdrive re-applies them when OBS reconnects
  and every 5 s, but never fights a manual change.
- **Local MVP counting** takes Twitch chat (and rehearsal) votes only. Website voting needs the online vote service.
  Without Twitch chat connected, viewers cannot vote locally, and the MVP panel says so.
- **Rehearsal votes** stay in that match's vote until **Reset for next match**. A red badge marks the vote while it
  contains them: never reveal it as real.
- **Not built:** a talkback / IFB system, a Settings area separate from `/controller`, and full match-data simulation.

# Overdrive 2.0 — Modular broadcast production

One Producer Console (`/producer`) controls every scene as its **own OBS browser source**. OBS does the final broadcast, the scene switching and the transitions; Overdrive controls what each source shows (talent, cameras, graphics, match data, media) through one production engine. The Major version is untouched (separate folder).

---

## 1. Audit (what the project already had)

| Area | Finding | 2.0 decision |
|---|---|---|
| Browser sources | `/output/screen/<id>` already renders each of the 11 scenes on its own; plus overlays (`scoreboard`, `ticker`, `nextmatch`, `player`…), Major sources (`/output/major?part=1|2`, `major/gameplay`…), `program` (all scenes in one source). | Every scene = its own source. `/output/program` kept for existing setups but no longer part of the workflow. New: `/output/media`. |
| State | One authoritative server state (`server/hub.ts`, `server/store.ts`), WebSocket sync, versioned broadcasts. | Kept. Every module goes through the engine (`server/engine.ts`): one command type, acks, priorities. |
| Cameras | 6 camera slots, one secret link per **slot** (`/contribute/:slot`), WebRTC relay by slot, VDO.Ninja option per slot. Identity = slot. | Slots stay as the render positions (approved layouts unchanged). 10 talent profiles with their own links; the server routes each position to the talent seated there. |
| OBS | Connect, scene list, set scene, build scenes per screen (each with its `/output/screen/<id>` source). | Explicit OBS switch from the console with the transition chosen by type; Studio Mode awareness. |
| Controllers | Big tabbed Controller + docks + 1.x Producer Console with a Program bus. | New console: scene preview + scene modules + publish + OBS. The Controller stays for setup (teams, Twitch, sheet, music files…). |

## 2. Independent browser sources

| Scene | OBS browser source (1920×1080) | Default modules |
|---|---|---|
| Caster Desk | `/output/screen/casters` | Talent (3 caster positions), Cameras, Predictions, Match, Countdown, Music |
| Analyst Desk | `/output/screen/analysis` | Talent (2 analyst positions + caster joining), Cameras, Statistics, Head-to-head, Predictions, Countdown, Music |
| Gameplay | `/output/screen/gameplay` | Match, Scoreboard, Graphics trigger, Music |
| Scoreboard | `/output/scoreboard` | Scoreboard, Match |
| Team intro / Player showcase | `/output/screen/warmup` | Team introduction, Player showcase, Predictions, Match, Countdown, Music |
| Map Veto | `/output/screen/veto` | Map veto, Match, Music |
| Interview | `/output/screen/interview` | Interview, Talent (guest), Cameras, Music |
| Bracket | `/output/screen/bracket` | Bracket, Match, Music |
| Standings | `/output/major?part=2` | Bracket, Match |
| Matches | `/output/screen/matches` | Match, Bracket, Music |
| Starting Soon / BRB / Ending | `/output/screen/starting` · `brb` · `ending` | Countdown, Match (Graphics on Ending), Music |
| Media Playback | `/output/media` | Media player |

Every existing output route still works. "Predictions" is shown on the desks and caster name bars (no separate approved design exists for a standalone predictions screen, so none was invented).

## 3. Producer Console → Graphics Workstation (`/producer`, 1920×1480, scales uniformly to any screen)
Since 2.1 the console is a graphics workstation (Live graphics / Studio modes, library, generated inspector, rundown, publish & recovery): see **Workstation** below. Selecting anything is instant and never airs; every command is confirmed by the server and failures appear in the acknowledgment log with the reason.

## 4. OBS
- OBS performs every transition. **SWITCH OBS → scene** (with "OBS default", Stinger, Fade or Cut, matched by type so localized names work) or any other OBS scene from the list.
- Publishing content never switches OBS. Studio Mode is shown (OBS preview scene), and is separate from Overdrive drafts.
- The stinger never plays in a browser source.
- **OBS Scene Builder** (Studio → **OBS Setup**, `server/obsSetup.ts`): one OBS scene per Overdrive output, each with its own
  1920×1080 browser source (`/g/<instance>` for every graphics-engine instance, `/output/…` for every registry source incl.
  the legacy screens). Discovered from the engine + registry, never a hardcoded list, never a master scene, never
  `/output/program`. Uses the existing OBS connection. Buttons: Scan OBS, Verify All Scenes, Repair All, Build Selected
  Scene, Repair Selected Scene, Build All Scenes, plus Build / Repair on every row. Build and Repair always show the
  server's dry-run plan first; Confirm applies exactly that plan (refused if OBS changed in between).
  - **Build** creates what is missing (scene, source, scene item, game capture under gameplay, the shared
    "Overdrive · Caster audio" scene nested once). It never changes an existing source. **Repair** also fixes URL, size,
    transform (full canvas), visibility, order (overlay above capture) and audio routing of Overdrive's own sources.
  - Ownership: a source is Overdrive's only if it carries the `overdrive_id` marker, matches the stored uuid, or is a
    legacy "Overdrive …" browser source already pointing at that same route (adopted, then marked). Anything else with
    the same name is a **conflict**: skipped, never overwritten. Nothing is ever deleted; manual items are kept and listed.
  - The scene that is OBS's Program is **held back** unless "Also change the scene that is ON AIR" is ticked. The builder
    never sends a Program/Preview switch, a transition or a delete (asserted by the tests).
  - Mapping (scene, source, uuids, scene item id) persists in `state.json → obsSetup` and feeds tallies
    (graphic → OBS scene) and the legacy screen → OBS scene map. A scene renamed by hand is found again (uuid on OBS 31+,
    else the scene that still holds Overdrive's source).
  - Base URL OBS loads: localhost when OBS is on this PC, this PC's LAN address when OBS is on another PC, Overdrive's
    public address (`PUBLIC_URL`, `RENDER_EXTERNAL_URL`, or the producer page's host) when OBS is reached over the
    internet/a tunnel, or the one you type in "OBS loads Overdrive from".
  - Legacy screens that an engine graphic replaces (caster desk, analyst desk, gameplay, bracket, scoreboard) are listed
    as "legacy duplicate": Build All skips them unless "Build All includes legacy duplicates" is ticked; each can still be
    built on its own. The old Controller "Build scenes in OBS" button now runs this builder for the legacy screens and no
    longer switches OBS afterwards.
- **Per-scene controllers (OBS docks)**: `/producer/scene/<target>` (e.g. `/producer/scene/g:caster-desk`,
  `/producer/scene/s:veto`) is the 1920×1480 controller of ONE OBS scene: its own graphic on top (1920×1080), only its
  controls below (1920×400: the graphic's Inspector, or the scene's control modules, plus Publish / recovery), uniformly
  scaled to the dock. No library, rundown or Studio; same engine commands and live state as the main console, so
  every controller stays in sync and works on its own. `/producer/scene/follow` follows the Overdrive scene that OBS
  has in Preview (Studio Mode) or Program: it never switches OBS. Controllers are never put into a scene: the builder
  only creates `/g/…` and `/output/…` sources, and Verify OBS Setup flags any OBS source that loads a controller page.
  - OBS cannot create Custom Browser Docks over obs-websocket (checked: no dock request in obs-websocket 5.3.4's 142
    requests; obs-browser's vendor request is only `emit_event`). OBS keeps them in `[BasicWindow] ExtraBrowserDocks`
    (JSON `title`/`url`/`uuid`, OBS 30 source `UI/window-extra-browsers.cpp`, global.ini), read at start and rewritten on
    exit. Studio → OBS Setup → **OBS Docks…** lists every dock (name + URL, copy), with instructions for
    Docks → Custom Browser Docks…, and two installers that merge the docks into OBS's settings while OBS is closed
    (Windows PowerShell, macOS/Linux sh + python3; backups, idempotent, existing docks kept, refuse while OBS runs).
  - Studio actions: Build All OBS Scenes, Build Individual OBS Scene, Repair OBS Scene, Verify OBS Setup, Open Individual
    Controller, Copy Controller Dock URL (+ Ctrl ↗ / Dock on every row).

## 5. Talent: 10 profiles, 6 positions
- Profiles `t1`…`t10`: name, role (Caster / Analyst), camera via the app (WebRTC) or VDO.Ninja, personal link `/talent/<id>?key=…`, personal VDO.Ninja push ID. Links never give producer access; a new link can be generated (the old one stops working).
- Positions: **Caster 1 (left), Caster 2 (center), Caster 3 (right), Analyst 1 (left), Analyst 2 (right)**, plus the interview guest.
- Assigning, swapping, removing and replacing talent re-routes the camera on the server: **the talent never reconnects**; Solo/Duo/Trio only changes what the source shows.
- **Names**: no names were found in the project files (the Major data only has the slot labels "Caster 1"…"Analyst 2"), and none can be invented. On the first start, any real names already typed into your show's camera slots are taken over automatically and seated where they were. Every other profile shows **"name needed"** in the Talent tab: type the names there.

## 6. Studio Mode
Per scene: add/remove modules, reorder, pin (pinned modules come first). Saved on the server for every operator. **Export / Import show** (module layouts, talent names/roles/positions, playlist, prepared graphics; never the link keys).

## 7. Engine & automation
- Engine commands (`shared/engine.ts`): publish / revert / draft, talent seats, cameras, feed re-sync, OBS switch, media, Studio, plus the existing Major and quick operations (validated, acked). Legacy TAKE/CUT still exist for `/output/program` and the HTTP API.
- **HTTP**: `POST /api/v1/engine` (token: `Authorization: Bearer <API token>` or `?token=`) with a JSON command (e.g. `{"c":"score","side":"a","delta":1}`, `{"c":"seat","seat":1,"talent":"t3"}`, `{"c":"media","action":"play"}`, `{"c":"obs-switch","scene":"Overdrive · Gameplay","transition":"stinger"}`). Counts as automation unless `?source=manual`: automation can't switch OBS, publish, publish a graphic or play a graphic IN/OUT while held or within 8 s of a manual action (it can still prepare). Existing Stream Deck / Companion endpoints are unchanged.

## 8. Tests run
- **Engine**: `npx tsx tests/engine.test.ts`, 45/45.
- **End to end (35/35)**: real server hub + real frontend in headless Chromium, 5 talent pages with fake cameras over WebRTC, each scene as its own browser-source page, a simulated OBS (French transition names, records every call).
  - Talent: 10 profiles and 10 unique links; 3 casters connected and assigned; Trio with 3 live cameras in left/center/right order; Duo prepared then published (2 cameras); no talent reconnected; 2 analysts assigned with 2 cameras on the Analyst Desk; Caster 1↔2 swap live without reconnecting; a talent disconnects (position goes dark) and reconnects with the same identity and position.
  - Producer: Caster Desk and Analyst Desk load their own controls; Gameplay modules; scoreboard prepared then published; live score; prepared score + prediction visible in the console but not on the sources until PUBLISH; explicit OBS switch with OBS's stinger; **no stinger in any browser source**; console refresh; all sources in sync and connected.
  - Media: plays, auto-advances on end, stops after the last item.
- **Not verified here**: a real OBS (simulated OBS only), remote VDO.Ninja connections (only this app's WebRTC talent links were tested), and the production build (`start.cmd rebuild` runs the real TypeScript check and Vite build: please report any error it prints).

## 9. Known limits
- Positions are the 6 existing camera slots (3 casters, 2 analysts, interview guest): one talent per position at a time, as the approved layouts require.
- Media upload goes through the console (stored in `data/media`); very large files are limited to 1 GB per upload.
- Undo restores the draft and published scene/desk state; scores already published are corrected with the score buttons.

---

# Graphics Engine (packages, instances, IN/UPDATE/OUT)

Overdrive is the graphics engine; OBS is the switcher. A **graphics package** declares a graphic; an **instance** is one live copy with its own browser source.

## Package interface (`shared/gfx.ts`)
`id`, `name`, `version`, `collection`, `category`, `description`, `renderer`, `resolution`, typed `props` (text / number / boolean / colour / select, with defaults, groups, limits), `bindings` (shared show data: talent seats, match, predictions, score), `animations` (IN, UPDATE, OUT, RESET), `assets`, `commands`, `permissions`, `obsKey`. Every value is validated against its declaration on the server (`checkProp`).

## Instances
- Stable OBS URL per instance: **`/g/<instance id>`** (e.g. `/g/caster-desk`). Several instances of one package can run with different settings ("+ Instance" in Studio → package library, e.g. `/g/scoreboard-stage-b`).
- Each instance has its own configuration, a draft (prepare → **Publish this graphic** / Revert, or the global PUBLISH), presets, animation state and health. Everything is saved on the server and restored after a refresh or a restart.
- Each graphic renders inside its own error boundary and reports its health (shown in the library, the Inspector and the Rundown). An unknown or failing graphic shows nothing on its own source and does not affect the others.
- `/g/…` sources only need the server: they keep running when the console is closed and don't depend on `/output/program`.

## Animation lifecycle
`IN` (Web Animations entrance + the approved components' own entrances), `UPDATE` (played automatically when a visible graphic's configuration is published), `OUT` (animates off, then hidden), `RESET` (back to the package defaults). These are animations inside one graphic: they never switch OBS and never play a stinger.

## Workstation (2.1: `/producer` is a graphics workstation, not a switcher)
Fixed logical canvas **1920×1480**, one scale factor `min(vw/1920, vh/1480)` for both axes, centred. At 1920×1480 / 100 % zoom the preview is exactly 1920×1080 at the top and the controls exactly 1920×400 under it (no page scroll). A 1920×1480 screen with Windows display scaling at 125 % gives the browser 1536×1184: the console then fits at 0.8, uniformly. The graphics outputs stay 1920×1080.
- **Preview (1920×1080)**: the selected graphic rendered by its own renderer, nothing painted over it. **Draft** view = with its prepared changes (an OUT graphic is still drawn here so it can be prepared); **Live** view = exactly what its source shows. `G` = safe-area guides (operator only).
- **Header (30 px)**: Live graphics / Studio, the selection with its state (IN / OUT, DRAFT, OBS PGM / PVW, sources connected), Draft / Live view, status chips (engine + latency + version, OBS + programme scene, graphics sources, talent cameras, automation), Details (sources per route, health, talent, OBS) and `?` (shortcuts + state legend).
- **Live graphics mode** (resizable columns, saved per browser):
  - **Library**: every graphic by category (Desks, Gameplay, Match graphics, Tournament graphics, Player & team, Media, Utility): engine instances with IN/OUT (click = quick IN/OUT), DRAFT, ⚠ health, ●n sources, OBS tally edge; then the scene sources not migrated yet (`SCENE`). Selecting never airs, animates or switches OBS.
  - **Inspector**: generated from the package: IN / UPDATE / OUT / RESET, Publish n / Revert, package commands, presets (load / save), one block per property group (incl. **Motion**: content transition + ms) and the data bindings (talent positions, match, score, predictions, bracket results).
  - **Rundown**: the show's graphics sequence (server state, every operator sees the same list and cue). An item = a graphic + its data: *its data at take*, *a snapshot now* or *a preset*. Per item IN / UPD / OUT, cue ▶, drag or ▲▼ to reorder, double-click to rename. **Take next (F8)** takes the cued item IN and cues the next. Never switches OBS.
  - **Publish**: PUBLISH ALL / Revert / Undo, prepared list, live data Live | Prepare, OBS (explicit switch only, OBS plays the transition), recovery (Clear GFX, Reload sources, Hold automation, Instant, Controller, Sign out), command acknowledgments.
- **Studio mode**: Packages (create instances) · Instances & OBS (rename, URL, OBS scene mapping per graphic for tallies and the switch button, delete) · Talent · Data bindings (who/what each graphic reads now) · Control modules (layouts of the scene sources) · Assets (package files + media library) · Show file (export / import incl. graphics configs, presets, OBS mapping and rundown; imported configs arrive as drafts).
- **Shortcuts**: F2 IN · F3 UPDATE (publishes the graphic's draft) · F4 OUT · F8 take next · Ctrl+Enter publish all · Ctrl+Z undo · Alt+↑/↓ previous/next graphic · Alt+1/Alt+2 Live/Studio · D Draft/Live · G guides · ? help. Ignored while typing in a field.
- HTTP automation: the same commands (`gfx-set`, `gfx-publish`, `gfx-anim`, `gfx-preset`, `rd-next`, `rd-take`, …) through `POST /api/v1/engine`, e.g. `{"c":"gfx-set","id":"caster-desk","patch":{"layout":"duo"}}`. Automation may prepare at any time but cannot publish, take, play IN/OUT or switch OBS while held or within 8 s of a manual action.

## Internal graphic transitions (2.1, `src/gfx/transition.tsx`)
Content changes INSIDE a graphic (never OBS transitions): crossfade, slide, wipe, scale or cut, `transition` / `transitionMs` on every package (Motion group; default 300 ms, Analyst Desk slide 350 ms).
- The outgoing picture stays on screen until the incoming one can draw (videos decoded, images loaded; 900 ms safety timeout). Asset-backed layouts change in one commit (`useStaged`); content swaps use `Swap` (rapid changes settle on the latest, nothing left half-way).
- Camera elements are never remounted by a layout change: they move between frame holes / desk column (feeds keep playing; VDO.Ninja views don't reconnect). Hole backing covers holes while cameras travel.
- Analyst Desk: Cameras only ↔ panels is one composition (frame fades over / off the bar loop, cameras move, panel slides in/out); panel → panel keeps the box and swaps the content (rows keep their approved staggered entrance). Solo / Duo / Trio (both desks) crossfade frame over frame. IN waits until the graphic's videos can draw.
- Cause of the old ~100–350 ms black frames: a fresh `<video>` draws nothing until its first frame is decoded, and the old code unmounted the frame/background video on every panel change and used `AnimatePresence mode="wait"` (old layout fully faded out before the new one existed) for Solo/Duo/Trio.

## Official collection (Overdrive Major)
| Package | Instance / OBS URL | Renderer |
|---|---|---|
| Caster Desk 2.0.0 | `/g/caster-desk` | approved booth (Solo / Duo / Trio, names, matchup bar, prediction badges, ticker, accent colour) |
| Analyst Desk 2.0.0 | `/g/analyst-desk` | approved desk (Solo / Duo, caster joins, panel, VS strip, countdown) |
| Scoreboard 2.0.0 | `/g/scoreboard` | approved scoreboard |
| Gameplay overlay 2.0.0 | `/g/gameplay` | approved gameplay overlay (scoreboard, cams, ticker, map card, replay badges) |
| Tournament Bracket 2.1.0 | `/g/bracket` | approved Major bracket (Upper + Grand Final / Lower + Standings) or matches board; cycling from the synced clock |

The other scenes (veto, team intro / player showcase, interview, matches as its own scene, intermissions, media) still run as scene sources with their modules; they move to packages next, the same way.

## Tests (graphics engine)
- `tests/engine.test.ts`: 61/61 (16 new: validation, drafts, publish → UPDATE on that graphic only, IN/OUT/RESET, presets, instances, persistence).
- Caster Desk proof of concept, end to end, 23/23: registered; own URL connected and healthy; 6 generated properties + animations + 3 seat bindings; 3 positions assigned; 3 live cameras; names; Duo prepared then published; Solo; Trio; no talent reconnected; UPDATE on publish; OUT / IN; accent colour; second operator and second source in sync; source refresh without replaying animations; server restart restores everything and the source reconnects by itself; independent of `/output/program`; no stinger anywhere; unknown graphic URL fails safely.
- Analyst Desk / Scoreboard / Gameplay packages, 10/10; previous 2.0 suite, 35/35 (no regression).
- Not verified here: a real OBS, remote VDO.Ninja, the production build (`start.cmd rebuild`), and deliberately crashing a renderer (the error boundary and health reporting are in place, but no fault was injected).

# Overdrive — Studio Mode 2.0

Studio Mode is now a full-screen workspace for preparing the show. It used to be a 370 px strip under the preview. Producer Mode is unchanged apart from one small **Show GO** row in its Publish column.

- **Studio Mode:** `/studio`, or `/producer` → Studio Mode (Alt+2)
- **Producer Mode:** `/producer` (Alt+1)

Both modes are the same page running on the same server state. Every edit is an acknowledged engine command, so every operator sees it immediately. Two people can work at once, one in Studio and one in Producer, without overwriting each other.

## Layout (designed for 1920×1080 and larger)

| Area | What it holds |
|---|---|
| Top bar | Overdrive logo, Studio / Producer switch, what OBS has on air, active event, readiness list (each item opens the section that fixes it), sign out |
| Left rail | 8 sections and the **Scene Library**: search, filters, ★ favourites, PGM / DRAFT / source-open tallies. Click a scene to preview and inspect it; double-click to add it to the show rundown. Resizable; collapses to an icon rail. |
| Monitors | Large 16:9 **Preview** (Draft or Live, safe-area guides, full screen) and a **Program** monitor that renders the Overdrive source OBS has on air, with live data. Below them: an on-air / next strip. The monitor height is resizable and the monitors can be collapsed. |
| Workspace | The selected section and its sub-tabs |
| Inspector | Selected scene, any pending GO, next items in the rundown, automation, prepared changes (Publish needs two clicks, plus Revert and Undo), and activity. Resizable and collapsible. |
| Status bar | Studio readiness · OBS · outputs and profile · talent cameras · automation · draft state · engine |

Panel sizes, the open/closed state of each panel, filters and favourites are remembered per browser.

## Sections

- **Scenes:** scene settings (browser source URL, connections, OBS scene mapping, animations, add to show / graphics rundown); the scene's control modules; a graphic's generated properties, bindings and **presets**; control-module layouts; packages and instances.
- **Talent & Cameras:** the 10 profiles (name, role, position, App or VDO.Ninja, **paste a VDO.Ninja link**, 720p/1080p, links, new link). Also live camera previews for the 6 positions with on/off and re-sync, and the desk layouts (1 caster / duo / trio, solo analyst / duo / desk plus a caster). Renaming someone or moving them to another position never makes them reconnect.
- **Graphics & Data:** match and scores, countdown, bracket and standings, teams and players (intro, showcase, stats, H2H), predictions, Pick'ems, MVP and QR, veto and interview, data bindings. **Live data edited in Studio is prepared**: it waits for Publish, so it works as a manual override.
- **Show Rundown (new):** segments with scene, OBS scene (auto-mapped or chosen), duration, transition (OBS default / Stinger / Fade / Cut), media to start on GO, "needs producer GO", auto-advance when time is up, and crew notes. Each segment shows its readiness and what is missing: no scene, deleted scene, browser source not open, no talent seated, camera offline, OBS scene missing, auto-advance without a duration. Rows can be dragged to reorder. Prepare / Mark on air. A starter show is included. Optional mirroring to the crew / caster run of show.
- **Automation (new):** WHEN (countdown reaches zero · media ends · the on-air segment's time is up · a clock time) · WHILE (a given segment is on air) · THEN (prepare a segment, notify, **wait for producer GO**, GO, play / stop / next media, countdown, graphics TAKE NEXT, switch OBS scene). Includes a visual timeline drawn to scale with a playhead, templates (including the reference workflow), **Test (safe)** which describes what would happen and changes nothing, Run now, enable / disable, and Hold all automation.
- **Media & Audio:** media player and playlist (sponsor ads), music per scene, assets and sponsors, audio routing (the caster microphone, music and media sources).
- **OBS & Outputs:** connection health, Program / Preview, transitions, output resolution, every browser source with its connections, OBS scene and graphic health; the Scene Builder; graphics → OBS mapping.
- **Audience & Show File:** the public voting page and QR. The show file export / import now includes the show rundown and automation.

## Reference workflow (tested end to end)

1. Starting Soon is on air and its countdown reaches zero.
2. Automation prepares **Opening** and notifies the producer: "Opening is ready: press GO".
3. Producer Mode shows a pulsing **GO · Opening** (F9) with a Cancel button.
4. The producer presses GO. OBS switches to Opening's scene with its transition, and its media starts.
5. The next segment is prepared.

## Live safety

- Studio never switches OBS, never takes a segment and never plays a graphic IN or OUT. In Studio, the Inspector's IN / UPDATE / OUT / Publish buttons are hidden, and the on-air shortcuts (F2–F4, F8, F9, Ctrl+Enter) are ignored. Studio's only route to air is the two-step "Publish…".
- Automation runs on the server through the engine as `auto` commands. It does nothing while **held**, waits 8 s after any manual on-air action, and **an automatic GO that is refused becomes a pending GO** rather than being dropped. If a GO fails (for example OBS refuses the switch), nothing is marked on air and the pending GO is kept so it can be retried.
- A pending GO never survives a server restart, and a clock rule whose time passed while the server was off is not run.
- `/studio` counts as a control page in the OBS leak check, so it can never become a broadcast source.

## Engine additions (`shared/showplan.ts`, `server/engine.ts`)

- Commands: `sp-seg-add / -edit / -remove / -move`, `sp-next`, `sp-go`, `sp-cancel`, `sp-onair`, `sp-rule-set / -remove / -run (dry)`, `sp-starter`, `sp-import`, `sp-opts`.
- `talent-edit` now accepts `vdoId`, which can be a pasted VDO.Ninja link.
- The plan is persisted in `state.json` (`plan`). The hub runs the automation tick every 500 ms.
- The same commands work through the existing HTTP control API (Stream Deck / Companion).

## Tests

- `npx tsx tests/showplan.test.ts`: 67 checks covering the model, readiness, OBS scene resolution, the reference workflow, hold, OBS failure and retry, auto-advance, clock / media rules, import and persistence.
- The existing suites still pass: 210/210.
- A browser end-to-end run (real Producer page and real engine, two operators): 20/20.

## Known limitations

- This session had no package installs, so `npm run build` / `tsc` with the real dependencies and a live OBS were **not** run here. Run `npm run build` once before deploying.
- The UI was verified with esbuild, Tailwind 4, headless Chromium, the real engine and the project's OBS WebSocket mock. Two caveats from that setup:
  - `motion` was stubbed, so animations weren't exercised.
  - Barlow Condensed was replaced by a wider font, so labels in the real app will be slightly narrower than in the screenshots.
- Existing panels are reused in Studio at 1.12–1.14× zoom rather than rewritten, so they keep their exact behaviour. They are denser than the new modules.
- Sponsor logos, teams / seeding, the Google Sheet and OBS address / password still live in the Controller and `/admin`. Studio links to them.
- Clock rules use the server clock, and the time is entered in the browser's time zone.

## Studio UI expansion (layouts & usability)

UI/UX only — no broadcast graphic, route or output resolution changed.

- **Three workspace layouts** in the top bar, switched instantly (Alt+O / Alt+F / Alt+P):
  - *Overview* — scene library, preview/program monitors, configuration and inspector together.
  - *Focus* — the configuration fills the centre; a compact live preview sits on top of the inspector.
  - *Preview* — large preview/program monitors (≈70% of the height) for checking graphics, portraits and cameras.
- **Resizable everything**: sidebar, inspector and monitor/config split. Sizes are remembered *per layout* and per browser (localStorage), so each operator keeps their own arrangement. Double-click a divider to collapse/restore.
- **Full workspace** (expand button, Esc to leave): the active section fills the whole window.
- **One navigation level**: section pages (e.g. Graphics & Data › Bracket, MVP & portraits) are listed in the sidebar under the active section instead of a tab bar inside the workspace.
- **Quick switcher** (Ctrl/Cmd+K): jump to any scene, page or layout by name.
- **Scene library**: grouped by category with headers, taller rows, ↑/↓ from the search box to move the selection.
- **Bigger controls**: buttons 40 px, inputs 40 px / 15 px text, larger labels and card headers; the top bar compacts itself below 2200 px wide so nothing wraps at 1920×1080.
- **Large views**: click a camera tile (Talent) or a portrait framing (MVP & portraits) for a full-window view.

Tested at 1920×1080 and 2560×1440 (browser harness): layout e2e 20/20 at both sizes; Studio e2e 20/20, MVP e2e 13/13, MVP-scene e2e 10/10; unit suites 327/327.

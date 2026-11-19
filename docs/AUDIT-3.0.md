# Overdrive 3.0 — Codebase audit (Phase 0)

Audited from the uploaded `overdrive-caster-full` archive (release `2.3.0-audience`) on 16 Nov 2026, before any change.

## Baseline

| Item | Result |
|---|---|
| Size | ~30,000 lines of TypeScript (server 5.5k, shared 6k, UI 18k), 47 routes, 8 graphics-engine packages, 28 scenes in the Studio scene library |
| Unit suites (`npx tsx tests/*.test.ts`) | 10 of 12 run here: **394/394 pass**. `chatVotes.pg` and `twitchChat` need `pg` / `ws` from `npm install` and could not run in this sandbox. |
| Build | `npm install` is not possible in this sandbox (no package network). A sandbox build was made with esbuild and Tailwind 4 from the machine's tools, plus small shims for packages that are not installed (`e2e-rig/devshim/`, never shipped). The real `npm run build` (tsc + Vite) was **not** run. |
| UI | The real Studio, Producer, talent pages and outputs were rendered in headless Chrome against the real server. |

## Inventory

**Control pages:** `/studio` (Studio Mode 2.0, full-screen preparation), `/producer` (1920×1480 Producer console; Live graphics / Studio), `/producer/scene/<target>` (one-scene OBS dock), `/controller` (2.x tabbed controller, still used for teams, sheet, Twitch, OBS address), `/admin` (tournament admin), `/crew` (run of show), `/staff-picks`.

**Outputs (OBS browser sources):** graphics engine `/g/<instance>` (caster-desk, analyst-desk, gameplay, scoreboard, bracket, mvp + `?view=voting|closed|winner|desk|compare`, qr, pickem); scene sources `/output/screen/<id>` (casters, analysis, gameplay, warmup, veto, interview, bracket, matches, starting, brb, ending); overlays (`scoreboard`, `ticker`, `nextmatch`, `player`, `playercam`, `twitch`, Major `/output/major…`); `/output/media`, `/output/music`, `/output/audio/1..6` (one voice per position); legacy `/output/program`, `/output/casters|solo|duo|trio|names|branding`.

**Talent pages:** `/talent/<id>?key=` (personal link, WebRTC camera + mic, or VDO.Ninja push embedded), legacy `/contribute/<slot>`.

**Integrations:** OBS WebSocket v5 (connect, scene switch with transitions, Studio Mode awareness, Scene Builder with dry-run plans, verify / repair, performance stats, off-air suspension); VDO.Ninja (view / push links per talent); WebRTC relay with TURN; Twitch (Helix + chat voting); Google Sheet results; external vote service (`vote/`, Postgres); S3-compatible asset storage; HTTP control API for Stream Deck / Companion (`POST /api/v1/engine`).

**State:** one authoritative server state (`server/store.ts` → `state.json`, optional database mirror), WebSocket sync, every producer action an acknowledged engine command (`shared/engine.ts`), version check on TAKE, automation hold and 8 s manual grace.

## Spec phases against the existing code

| Phase | What already existed | Gap found |
|---|---|---|
| 1 Control UI | Studio 2.0: dark broadcast-console design, Overdrive accent, sections + scene library + inspector, layouts, Ctrl+K. Producer 1920×1480. | Navigation labels did not match the requested areas; no Health area. The Controller still holds some setup (sheet, Twitch, OBS address). |
| 2 Studio / Producer | Both modes on one page, Studio never airs, Producer preview/program/OBS chips, GO, F-keys. | Producer had no live talent controls. |
| **3 Talent** | 10 fixed profiles, roles caster / analyst only, App or VDO.Ninja camera, 6 positions, re-routing without reconnecting. | **Weakest area.** 10 empty rows always shown ("Name needed"), cramped rows, no Add Talent flow, no host / guest, no picture, no audio settings, no framing, no ready state, no validation, no Green Room, layout presets drove the legacy stage instead of the desk graphics. |
| 4 Local-first | Server runs locally (`start.cmd`), fonts and brand assets bundled, offline season dataset, OBS loads from localhost, vote service is separate and optional. | Already local-first for production; documented in CHANGES-3.0. No change needed. |
| **5 Audio** | One persistent browser audio source per position, nested once in every Overdrive scene (Scene Builder); video feeds are muted. | No volume / mute / sync / monitoring control from Overdrive, no meters, no alternative audio input (Discord / mic), no duplicate or echo detection, no master mute. |
| 6 MVP | Complete: five MVP scenes at native 4K, reveal gating, public vote page, QR, Twitch `!vote`, analyst MVP (manual fallback), automation safety, 61 tests. | No simulated-vote rehearsal mode (see limitations). |
| 7 Source Manager | Studio → OBS & Outputs: every source with URL, connections, OBS scene, health; Scene Builder with discovery, dry run, verify, repair, conflict safety. | Kept as is, renamed "Sources & OBS". |
| 8 Automation | Show rundown (segments, readiness), automation rules, producer GO, hold, safe test, graphics rundown. | None blocking. |
| 9 Media | Media library + playlist output, music per scene, assets with durable storage. | None blocking. |
| 10 4K | Native 4K renderers, 4K asset swap, perf monitor (docs/4K-*). | None blocking. |
| **11 Health** | Scattered: top-bar "to check", status chips, OBS Setup issues, gfx health. | No single health view with recovery actions, no pre-show checklist. |
| 12 Events | Event profiles with separate data (`events`, `eventData`). | None blocking. |
| 14 Security | Producer / admin passwords, output key, talent link keys revocable, OBS credentials server-side, controller-page leak check. | VDO stream IDs must stay out of exported show files (kept out). |

## Problems found (and what happened to them)

- Talent screen confusing → rebuilt (Talent Manager 3.0).
- Layout presets in Studio changed the legacy stage (`stage-booth`), not the `/g/caster-desk` and `/g/analyst-desk` graphics the 2.x workflow uses → the new Layouts page drives the desk graphics, exactly as their renderers place people.
- Talent page microphone is off by default (`overdrive.micOn`), so an app-link talent can be on camera with no voice → now detected and flagged ("link sends no microphone").
- `/producer` opens in Studio mode after `/studio` was used in the same browser (shared `od2.mode`): by design, noted for testers.

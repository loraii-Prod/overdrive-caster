# Overdrive 2.2 — OBS Scene Builder

## What changed
- `shared/obsSetup.ts` (new): output discovery (every graphics instance + every registry source, legacy screens included),
  unique OBS names, URL building (fixes `?part=2?key=` of the old builder), persistent mapping store.
- `server/obsSetup.ts` (new): scan / dry-run plan / apply / verify over the existing ObsBridge; ownership, conflicts,
  on-air hold, partial failures, per-scene results; never switches, transitions or deletes.
- `server/obs.ts`: old `build()` removed (replaced), `request()` exposes the one connection, scan on (re)connect.
- `server/hub.ts`: wiring, mapping → tally + screen map, legacy `obs-build` routed to the new builder (no OBS switch afterwards),
  public-origin detection for cloud-hosted Overdrive.
- `server/engine.ts`, `shared/engine.ts`: acknowledged `obs-setup` command (scan, verify, preview, apply, cancel, options).
- `server/store.ts`, `shared/types.ts`: `obsSetup` persisted and sent to controllers.
- `src/pages/producer/ObsSetup.tsx` (new) + Studio tab **OBS Setup**. Controller OBS panel text updated. No graphic design changed.

## 2.2.1 — per-scene controllers as OBS docks
- `shared/obsDocks.ts` (new): controller URLs, dock list, Windows/macOS/Linux dock installers, controller-route check.
- `src/pages/producer/Producer.tsx`: scene-controller mode (`dock` prop): pinned to one scene, its controls only,
  follow-OBS variant, never writes the shared localStorage (OBS docks share one). `src/main.tsx`: `/producer/scene/:target`.
- `src/pages/producer/ObsSetup.tsx`: renamed actions, Open Individual Controller, Copy Controller Dock URL, per-row
  Ctrl ↗ / Dock, OBS Docks dialog (list, copy all, installers, instructions), on-air-risk banner.
- `server/obsSetup.ts`: scan reports OBS browser sources that load a controller page (never removed automatically).

## Verified
| Test | Against | Result |
|---|---|---|
| `npx tsx tests/obsSetup.test.ts` | stateful OBS WebSocket v5 mock | 55/55 |
| `npx tsx tests/engine.test.ts` | engine (now incl. obs-setup command) | 91/91 |
| `e2e-rig/obs/realObs.test.ts` | **real OBS 30.0.2, obs-websocket 5.3.4** (Linux, Xvfb, password auth) through Overdrive's ObsBridge | 19/19 |
| `e2e-rig/obs/ui_e2e.py` | real server + real ObsBridge + Producer UI in Chrome, against an obs-websocket v5 protocol mock (msgpack + JSON, auth) | 22/22 |
| `e2e-rig/obs/dock_e2e.py` | per-scene controllers in Chrome at dock sizes, real server + ObsBridge + protocol mock | 21/21 |
| dock installer (sh) | real OBS 30.0.2 settings file: refuses while OBS runs, merges, keeps an existing dock, idempotent, backup, OBS starts after | ✔ |
| `npm run build` (typecheck + client + server) | | green |

The brief's 12 checks: empty collection ✔, twice without duplicates ✔, update an existing source ✔, unrelated scenes
preserved ✔, manual items preserved ✔, OBS disconnection ✔ (mock + UI drop/reconnect), missing/invalid URLs ✔,
partial failure ✔ (mock + a real OBS error), 1920×1080 ✔ (real OBS), mapping + tally ✔, no scene switching ✔ (real OBS),
no stinger/transition request ✔.

## Not verified (honest limits)
- **Browser Source on real OBS.** The Linux OBS package has no Browser Source (CEF), so in the real-OBS run the builder's
  browser sources were created as Color Sources by a test shim and reported back as browser sources. Everything else
  in that run is real OBS. That `browser_source` accepts and keeps the settings (`url`, `width`, `height`, `reroute_audio`,
  `overdrive_id`) is expected from OBS's settings model (real OBS kept them on the Color Source) but was not run on a
  Windows/macOS OBS with obs-browser.
- **Game Capture** (Windows only) was not created on real OBS; on Linux the builder correctly reports the gameplay
  scene as missing a capture. Disconnect-mid-build was tested on the mocks only.
- OBS 31 / obs-websocket 5.5 (uuids) tested on the mock only; OBS 30 without uuids tested for real.
- Windows / Node 20, a cloud-hosted Overdrive with a tunnelled OBS (logic unit-tested only).
- **Docks inside a real OBS.** The Linux OBS here has no browser plugin, so no Custom Browser Dock could be opened; the
  controllers were tested in Chrome at dock sizes. OBS loading the installed `ExtraBrowserDocks` entries was not seen
  (the format is taken from the OBS 30.0.2 source). OBS 31+ may keep window settings in `user.ini`: the installers
  also write there when it exists, untested on 31.
- **The Windows PowerShell installer was not run** (no PowerShell available here). The sh installer was.

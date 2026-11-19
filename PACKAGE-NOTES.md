# Overdrive — package contents (2026-11-18, rev. 5)

Rev. 5 fixes the real build failure the user hit on rev. 4's ZIP: `BrowserSourcesDialog`'s `flatMap` callback
returned two differently-shaped arrays (`row: TargetReport` vs `row: null`), which real `tsc` (unlike this
sandbox's degraded one — see below) couldn't unify, collapsing `items` to `unknown` and cascading into 27
errors. Fixed with an explicit `{ group: string; row: TargetReport | null }[]` annotation on `items`.

Root-cause note on verification: this sandbox's `tsc -p tsconfig.json` aborts immediately on its two
missing-type-library errors (`node`, `vite/client`) without ever type-checking a single project file — so
every previous "ran the real tsc, only the known gap" claim in this file was true about what it printed, but
the printed output was not actually checking the code. For this fix, re-verified with a scratch tsconfig that
extends the real one but drops just the `types` entries that can't resolve here, so `tsc` performs real
cross-file inference with the project's actual strict settings; that run is clean for `ObsSetup.tsx`,
`MainScenes.tsx`, and `hub.ts` (the files touched this session) in every error class that would indicate a
type mistake, modulo the expected noise from missing `@types/node`/`@types/react` themselves (TS2307/TS2591/
TS7026 "cannot find module/name", not real logic errors).

Rev. 4 adds a **Browser Sources** dialog to Studio → OBS Setup (Scene Builder) — one central place listing
all nine main-scene broadcast browser sources (Show Screens, Analyst Desk, Caster Desk, Team Introduction,
Player MVP, Map Veto, Gameplay, Bracket, Matches) with name, URL, resolution, OBS scene, status, on-air
flag, Copy / Copy All URLs, an opt-in compact live preview, and Build/Repair/Controls buttons. It's a new
read/manage view over the existing registry (`shared/mainScenes.ts`, `shared/obsSetup.ts`) — no new OBS
scene, source, or Scene Builder engine logic; Build/Repair still go through the same dry-run
preview-then-confirm flow as everywhere else in Scene Builder, and it is kept clearly separate from (but
one click away from) the existing "OBS Docks…" dialog. Added in `src/pages/producer/ObsSetup.tsx`
(`BrowserSourcesDialog`). Verified against the real scan/build harness: all nine groups resolve to a real,
valid browser-source URL (a row-selection bug — picking a scene marker row instead of the actual browser
source for scenes with more than one base candidate, e.g. Caster Desk — was caught and fixed during this
verification, before packaging).

Rev. 3 adds the **Show Screens mode switcher** to every OBS dock and single-scene module panel (new
`ShowModeBar` in `src/pages/producer/MainScenes.tsx`, mounted from `src/pages/producer/Producer.tsx`) — the
one gap found in a full audit of the OBS individual-studio-controls spec (per-scene docks, dock-appropriate
layout, live sync, Preview/Program safety, automatic dock registration, and no extra GPU load were already
in place from earlier work and needed no changes). See `docs/OBS-DOCKS.md` for the dock install/usage guide.

Rev. 2 fixed a real `tsc` build error in `server/hub.ts` (the `audit` command dereferenced a result that is
typed `AuditReport | null | string` without a null check) — caught by the user's own `npm run build`, not by
this sandbox, which has no `@types/node`/full `tsc` available to catch it beforehand. Fixed and re-verified
against the mock-OBS test suite before repackaging.

This ZIP is the complete current Overdrive source tree, including the latest OBS Scene Builder work:
centralized talent-audio composition ("Overdrive · Audio (All)" / "Overdrive · Audio (Music only)"), the
improved Scene Builder UI (Connect → Audit → Plan → Build → Validate), the in-app real-OBS duplicate-source
audit, and the pre-event validation checklist (automated checks kept visibly separate from operator
confirmations against real OBS, with staleness tracking and history).

## What's included

- `server/`, `shared/`, `src/`, `vote/`, `plugin/`, `scripts/`, `e2e-rig/` — full source.
- `public/` — all brand/graphics assets (video loops, frames, logos, maps). This is the bulk of the ZIP's size
  (~117 MB of `.webm`/`.png` assets under `public/brand/overdrive/`); see `THIRD_PARTY_NOTICES.md` for the
  team-logo and bracket-structure attribution.
- `tests/` — the full automated test suite (mock-OBS and unit tests; see "Tests" below).
- `docs/`, `CHANGES-*.md`, `README.md`, `START.md`, `OVERDRIVE-2.0.md`, `STUDIO-MODE-2.0.md`,
  `MAJOR_NOTES.md`, `PHASE3-CAMERA-ENGINE.md` — design notes and changelogs.
- `package.json` / `package-lock.json` — exact dependency versions (see "Dependencies" below).
- `.env.example`, `settings.example.bat` — configuration templates (copy and fill in; real `.env`/`settings.bat`
  files are intentionally excluded).
- `Dockerfile`, `render.yaml` — container / Render.com deployment config.

**Intentionally excluded** (per `.gitignore`, and because they are either generated, environment-specific, or
secrets): `node_modules/`, `dist/` (build output), `data/`, `state.json`, `.env`, `settings.bat`,
`od-backup*/`, `od-live-*.tgz`. None of these are needed to set the project up from scratch.

## Dependencies

Node.js **>= 20** (see `engines` in `package.json`). All JS/TS dependencies are declared in `package.json` with
exact resolved versions locked in `package-lock.json`:

- Runtime: `express`, `ws`, `obs-websocket-js`, `pg`, `qrcode`, `cookie`, `aws4fetch`, plus the bundled
  `@fontsource/*` font packages.
- Dev/build: `react` 19 + `react-dom`, `react-router-dom`, `motion`, `vite` + `@vitejs/plugin-react`,
  `tailwindcss` + `@tailwindcss/vite`, `typescript`, `tsx`, `esbuild`, `concurrently`, `s3rver` (local S3 mock
  for dev), plus `@types/*` type packages.

No dependency needs manual installation beyond `npm install` — nothing in this project requires a system
package (no ffmpeg/ffprobe at runtime; OBS itself is external software the producer already runs separately).

## Setup

```bash
npm install
cp .env.example .env            # fill in CONTROLLER_PASSWORD, ADMIN_PASSWORD, etc.
npm run build                   # typecheck + Vite build + esbuild server/vote bundles
npm start                       # serves the built app (reads .env)
```

For development with hot reload: `npm run dev` (UI on :5173, API/WebSocket on :8787 by default).

OBS: connect via **Controller → OBS** (OBS → Tools → WebSocket Server Settings), then use **Studio Mode →
OBS Setup** (the Scene Builder) to Scan, Build and Validate the nine main scenes. See `README.md` and
`docs/` for the full routes list, talent audio, MVP flow, and camera-engine documentation, and
`docs/OBS-DOCKS.md` to install and use the per-scene OBS Custom Browser Docks (run the whole show from
inside OBS Studio itself).

## Tests

Run any test file directly with `tsx`, e.g.:

```bash
npx tsx tests/obsLayout.test.ts
npx tsx tests/obsSetup.test.ts
```

All test files under `tests/*.test.ts` were run before packaging and pass, **except**:
- `tests/chatVotes.pg.test.ts` — needs a real Postgres connection (skipped; not an OBS/Scene-Builder test).
- `tests/twitchChat.test.ts` — needs the `ws` package physically present in `node_modules` (this sandbox has no
  installed `node_modules` to test against); it will run normally once you `npm install` in a networked
  environment.

Every OBS Scene Builder / Scene Layout / validation-checklist test passed, including the newest
`tests/obsLayout.test.ts` section covering the centralized audio migration, the real-OBS duplicate audit, and
the pre-event validation checklist (122/122 in that file alone).

## Still needs real OBS / real hardware

This sandbox has no OBS instance or audio hardware, so the following are verified by code/architecture and by
the mock-OBS test suite, but still need a human check against your actual OBS before a live show:

- All nine main scenes' layouts, camera alignment to graphics, independent per-talent mic behavior.
- Audio continuity and no doubling across scene changes, especially the shared "Overdrive Music" input
  referenced by both "Overdrive · Audio (All)" and "Overdrive · Audio (Music only)".
- Preview/Program isolation while Building/Repairing.
- Native 4K source sizing, and Repair/rollback against deliberately drifted OBS.
- The Bracket scene's animated background (`/g/bracket`, via the "Overdrive fire loop" / brand skin video)
  running smoothly at native 3840×2160 OBS output, with normal GPU usage. It already exists by default
  (`bracketBg: 'brand'`), pauses/resumes in place with no restart when the producer's "Pause off-air sources"
  option is on, and never remounts across Program/Preview or scene-switch cuts since Overdrive never recreates
  the browser source. The checklist's "Validate…" dialog in Scene Builder has the step-by-step check for this.

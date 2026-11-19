# Overdrive 3.3 · Unified scene engine: Phases 1–2 (MVP reference implementation)

**Status:** MVP works end-to-end against the OBS WebSocket mock and in a real browser. **It has not yet been run on real OBS**; the acceptance script is in §5. Phases 3–7 have not started: no other scene is converted until MVP passes on real OBS, as you asked.

## 1. Phase 1 audit: sources and dependencies

| | 3.1 (one scene per output) | 3.2 (nine scenes, layers) | 3.3 now |
|---|---|---|---|
| Overdrive OBS scenes | 25 (+ caster audio) | 9 | 9 + 1 internal (MVP Preview identity) |
| Overdrive browser sources (picture) | 24 | 24 | **20**: MVP is 5 → 1 Program + 1 Preview identity |
| Audio browser sources (6 mics + music) | 7 | 7 | 7 (unchanged, persistent, one per voice) |
| MVP sources | `/g/mvp` + 5 × `/g/mvp?view=…` | the same 6, as layers | **`/g/mvp` (Program) + `/g/mvp?id=pvw` (Preview identity, muted)** |

**Findings that shaped the design:**

- **One MVP source was already possible.** The MVP graphic already had a single server-owned `step` (voting → winner → desk → compare), a reveal gate per match (`revealed`), and draft vs live data. `/g/mvp` without `view` already followed that step; the five per-view sources only existed to give OBS one scene per state.
- **Rendering.** Every renderer already takes a config override (`cfgOverride`) and an optional view. A Preview identity is just the same renderer fed the prepared state.
- **Already single-source.** Caster Desk, Analyst Desk, Gameplay and Team Intro each already draw from one engine graphic or screen. Their extra 3.2 layers (scoreboard, track, veto, interview, brackets…) are the next consolidation candidates (Phase 3).
- **What must stay separate.**
  - Audio: per-talent volume, mute, monitoring and sync live on the 7 OBS audio sources (3.0 talent audio). They stay as they are.
  - Cameras: VDO.Ninja / WebRTC sessions are opened by the desk pages. The Preview identity never opens cameras, so there is no second WebRTC session.

## 2. What MVP does now

- **One Program source.** The MVP scene contains one MVP Program source (`/g/mvp`). It draws all five views from the graphic's `step` and the poll state (Closed = the voting step with the vote closed). No per-view sources are built any more.
- **A Preview identity.** `/g/mvp?id=pvw` uses the same renderer in its own internal scene, "Overdrive · MVP (Preview identity)". It is:
  - **muted in OBS**, and Build / Repair keep it muted;
  - never placed in a main scene;
  - never opens cameras;
  - never reports health.

  It draws `prepared` (the view staged off-air) over the draft or live data. Producers never pick it: Overdrive drives it.
- **No new state store.** `prepared` is one server-owned field on the MVP graphic. Match, poll, votes, step and authorizations stay where they were.
- **Prepare (tile, MVP panel, rundown cue):** sets `prepared` and points OBS Studio Mode Preview at the Preview identity scene. **Program is never touched.** This holds even when MVP is on air: you can prepare the winner while the voting graphic stays on Program.
- **TAKE / CUT / AUTO / rundown GO.** All existing gates apply: voting is closed first, a reveal needs a frozen result and the producer's action, and automation never reveals by itself. Then:
  1. The engine snapshots the Program state.
  2. It commits the view (the step changes on the one Program source).
  3. **MVP not on air:** OBS switches to the MVP scene with the chosen transition.
  4. **MVP already on air:** no scene change. The graphic's own reveal animation (with the pace and sweep settings) is the transition.
  5. `prepared` is cleared, so the Preview identity mirrors Program again.
- **Rollback.** If OBS refuses the switch, the Program source goes back to its snapshot and the reveal authorization is withdrawn. A vote that was closed stays closed: votes are never reopened.
- **Tally.** The MVP tile and Program monitor follow the source's step. The Preview monitor follows `prepared`.
- **Migration.**
  - From 3.1: the five view scenes and their sources are "can be removed" in the cleanup report.
  - From 3.2: the five view layers inside the MVP scene are listed as *retired sources*.
  - Removal still needs the typed `REMOVE` confirmation. Build never deletes anything.

## 3. What was not changed

- The MVP graphic, its animations, styling, portraits, voting, chat votes, rehearsal, audience page and Studio settings.
- Every other scene keeps its 3.2 layout. Phase 3 applies this pattern to them only after MVP is verified on real OBS.

## 4. Tests (all against the OBS WebSocket mock + a real browser; not real OBS)

| Suite | Result |
|---|---|
| `tests/obsLayout.test.ts`: one MVP source, Preview identity muted and isolated, states never toggle items, idempotent builds, 3.1 → 3.3 and 3.2 → 3.3 migration with retired sources | 80/80 |
| `tests/mvp.test.ts`: including **rollback when OBS refuses the switch** | 62/62 |
| `e2e-rig/mvp3`: MVP voting on Program → winner prepared on the Preview identity while voting stays on Program → REVEAL + CONFIRM → winner on the same scene | 31/31 |
| `e2e-rig/mvp4`: the browser pages OBS loads. The Preview identity **draws the prepared winner while the Program source draws nothing**; Preview is muted; Preview mirrors Program after TAKE | 62/62 |
| Layout e2e, Control room, Track, Talent, all other unit suites | all pass |

## 5. Real-OBS acceptance (run this before Phase 3)

Requirements:
- a **test** scene collection in OBS (Scene Collection → Duplicate, switch to the copy);
- Overdrive running and connected to that OBS;
- the project's npm packages installed.

```
set OVERDRIVE_URL=http://localhost:8787
set OVERDRIVE_PW=<controller password>
set OBS_URL=ws://127.0.0.1:4455
set OBS_PW=<obs websocket password>
set CONFIRM_TEST_COLLECTION=1
node e2e-rig/obs/realMvp.mjs
```

It uses the rehearsal demo match and simulated votes, so the real event is untouched. It removes nothing. The run:
1. builds the scenes and checks there is ONE MVP source and that the Preview identity is muted;
2. puts Caster Desk on Program, prepares MVP voting (OBS Preview = Preview identity, Program untouched), and TAKEs it with a fade;
3. closes the vote and prepares the winner, checking that OBS renders **different frames in Preview (winner) and Program (voting)**;
4. TAKEs the reveal and checks that Program stays on the MVP scene, its source moves to the winner, and the rendered frame changes.

OBS's own rendered frames are saved to `./mvp-real-obs/`. Against the mock, 14 of 15 checks pass. The 15th, "Program picture changed", can only pass on real OBS, because the mock cannot render.

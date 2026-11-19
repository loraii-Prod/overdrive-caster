# Overdrive 3.2 · Simplified OBS layout

**Status:** implemented and tested against the OBS WebSocket mock. **Not yet verified on real OBS.** See §6 for how to check it.

## 1. Audit: 3.1 behaviour

- **What the builder made.** One OBS scene per Overdrive output. A fresh 3.1 build produced **25 Overdrive scenes**:
  - 9 graphics: caster desk, analyst desk, scoreboard, gameplay, track, bracket, pick'ems, MVP, QR;
  - 10 screens: team intro, veto, interview, upper/lower bracket, matches, starting, BRB, ending, media;
  - the 5 MVP view scenes;
  - the shared **"Overdrive · Caster audio"** scene, nested in every one of them.
- **How switching worked.** Rundown, TAKE and Preview looked up an output's scene through the builder's mapping (`map[target].scene`), then the graphic's or screen's mapping, then a name match. Showing the scoreboard, a bracket or an MVP view meant switching Program to that output's own scene.
- **What carried over.**
  - Ownership checks: the source marker, uuid mapping, and adopting older Overdrive sources.
  - The dry-run-then-apply flow with a plan hash.
  - On-air hold.
  - The rule that Build / Repair never remove anything.

## 2. The nine scenes

| Scene | Base (always there) | Panels (one at a time, replace the base) | Overlays (independent, on top) |
|---|---|---|---|
| Starting Soon | /output/screen/starting | | |
| Team Introduction | /output/screen/warmup | | |
| Caster Desk | /g/caster-desk | Interview, other caster-desk instances | Pick'ems |
| Analyst Desk | /g/analyst-desk | other analyst-desk instances | |
| Gameplay | game capture + /g/gameplay | Map Veto | Scoreboard, Track Progression |
| MVP | /g/mvp | Voting Open, Closed, Community reveal, Analyst reveal, Comparison | Voting QR |
| Intermission | /output/screen/brb | Tournament Bracket, Upper, Lower, Matches, Media | |
| Safe / BRB | the **same** BRB source as Intermission | | |
| Ending | /output/screen/ending | | |

- **Unplaced graphics.** A graphic with no defined place becomes a Gameplay overlay. Every output stays reachable.
- **Audio.** The 6 caster mics and music are added directly to each scene, at the bottom. They are the same 7 sources, never copies. Safe / BRB gets **music only**, never a live mic.
- **Stable identifiers.**
  - Each scene is stored as `main:<key>` with its OBS uuid. Renaming a scene in OBS keeps it working, and Scan updates the name.
  - Each output is stored with its scene, item id and role.
  - Browser sources keep the `overdrive_id` marker.
- **4K.** Sources are 3840×2160 at the 4K profile and fill the canvas, as before.
- **New layers are hidden.** A new panel or overlay is created hidden. The base is visible. Visibility belongs to Producer Mode from then on, so Repair no longer resets it.

## 3. Producer Mode

| Action | What happens in OBS |
|---|---|
| Select an output, scene **not** on Program | Its layer is shown (and the base / other panels it replaces are hidden), then OBS Preview is set to the scene in Studio Mode. **Program is never touched.** |
| Select an output, scene **on** Program | Nothing changes in OBS. Overdrive's monitor previews it, and the next TAKE shows it. |
| TAKE / CUT / AUTO / rundown GO | The layer is shown, then the scene goes to Program with the chosen transition. If the scene is already on Program, the layer change *is* the take: a cut inside the scene, with no scene transition. |
| OBS layers strip (Control room) | Shows each layer of the scene and whether OBS shows it, marked ON AIR or OFF AIR. A base or panel chip shows that layer and selects it, so TAKE takes it. An overlay chip toggles the overlay. |
| New tiles | **Safe / BRB** (`main:safe`) and **Team Introduction**. Nine tiles in total, in your order. |

- **Showing / hiding in OBS directly.** OBS reports this (`SceneItemEnableStateChanged`), so the strip and tallies follow.
- **Legacy screen switching.** The 2.x controller screens show the matching layer first.

## 4. Migration (3.1 collection → nine scenes)

1. Studio → Sources & OBS → Scene builder. **OBS layout** defaults to "Nine main scenes". Verify will list the main scenes as missing.
2. **Build All → Confirm.**
   - Creates the missing main scenes and reuses old ones with the same name (Caster Desk, Analyst Desk, MVP).
   - Adds every **existing** browser source to its main scene: same source, URL and uuid, so no second browser source or WebRTC session.
   - Reuses your own game capture from the old gameplay scene.
   - **Deletes and renames nothing.** Program is not switched. A change to the scene on air is held unless you tick "allow on-air".
3. **Cleanup report…** is a dry run that sorts every OBS scene into one of four groups:
   - **main**: one of the nine scenes;
   - **can be removed**: everything in it is now inside a main scene, it holds nothing of yours, and it is not on Program or Preview;
   - **kept**: it holds a source Overdrive doesn't manage (your webcam, your capture card), something isn't in a main scene yet, it's on Program or Preview, or it is nested somewhere you keep;
   - **not Overdrive's**: never touched.

   The report also lists:
   - main scenes that still nest the old audio scene. It can swap that for the same audio sources added directly (adds first, then removes the nested item).
   - what in Overdrive still names an old scene: rundown segments, screen mapping, graphics, cameras.
4. **Remove.** Only the scenes you tick in "can be removed", after typing `REMOVE`.
   - The server re-reads OBS first and refuses if anything changed since the report.
   - References are repointed to the main scene before each removal.
   - The old audio scene becomes removable in the **next** report, once nothing kept still nests it.

Removal is the only time Overdrive sends `RemoveScene` / `RemoveSceneItem`. Build, Repair, Verify and Scan never do; the tests assert this.

**Going back:** OBS layout → "One scene per output (3.1)". The old builder is unchanged, and its 76 tests still pass.

## 5. Idempotency

- Scan, preview and apply run the same ordered pass: scenes → audio sources → outputs (bases, panels, overlays) → per-scene finish.
- A dry run records what each planned step would create, so one scene isn't planned twice.
- Build or Repair on a correct collection plans **0 changes**. Tests run Build ×5 and Repair, and the scene and source counts never change.

## 6. Tests

| Suite | Result | What it covers |
|---|---|---|
| `tests/obsLayout.test.ts` (mock OBS) | 73/73 | Placement, fresh build, 4K, no duplicates, idempotency, layers, rename by uuid, on-air hold, migration from 3.1, cleanup report and confirmed removal, reference repointing |
| `e2e-rig/obslayout/run.sh` (real server, real ObsBridge, browser, protocol mock) | 35/35 | 3.1 collection → migration → cleanup UI with typed confirm → Control room: off-air prep, TAKE, live overlays, Safe / BRB, MVP view off-air, rundown GO on a layer |
| Existing suites | all pass | Unit tests, the 3.1 builder (76, run in per-output mode), MVP 3 / MVP 4 / Track / Talent / Control room e2e. MVP and Track expectations were updated from "own scene" to "layer of its main scene". |
| `e2e-rig/obs/realObsLayout.test.ts` | **not run on real OBS** | The real-OBS check (needs the project's npm packages): the same build / no-duplicates / idempotency / off-air layer / Program-untouched / dry-run-cleanup checks through ObsBridge |

To run the real-OBS check, use a **test** scene collection (OBS → Scene Collection → Duplicate) with Overdrive running:

```
set OBS_URL=ws://127.0.0.1:4455
set OBS_PW=yourpassword
set OVERDRIVE_URL=http://localhost:8787
set CONFIRM_TEST_COLLECTION=1
npx tsx e2e-rig/obs/realObsLayout.test.ts
```

It removes nothing unless `ALLOW_REMOVE=1` is also set.

## 7. Limits

- **In-scene takes are cuts.** A take inside a scene that is already on Program is a scene-item cut. OBS scene transitions only run between scenes; per-item Show/Hide transitions can be set in OBS. The graphics' own in/out animations still play.
- **Hidden layers keep rendering.** They have `shutdown` off, so they show instantly. This is the same load as the 3.1 scenes.
- **Same picture.** Safe / BRB and Intermission show the same BRB card (Safe has no mics and no extra panels).
- **Not yet verified on real OBS.** Real OBS behaviour has to be confirmed with the script above:
  - whether a source with no remaining scene is released;
  - item enable events;
  - Windows game capture.

# Track Progression (Overdrive 3.1)

The round-by-round story of one track of a Duos match:

- cumulative points of both teams, with the leader's lead shaded;
- the 10-point threshold and overtime;
- aces (◆, a 1-2 finish, 3–0);
- one cell per round;
- the fastest lap;
- a key takeaway.

It comes from the **broadcast_overlays** Track Progression overlay. That overlay was a separate web page that loaded d3,
Google Fonts and its own copies of the logos from the internet. In Overdrive it is now a native graphic:

| Overlay | In Overdrive |
|---|---|
| Separate HTML page (`index.html?broadcast=true`) | Graphic **Track Progression** (`/g/track`). The Scene Builder makes its OBS scene. |
| d3 from a CDN, Google Fonts | Plain SVG and Overdrive's own fonts (Anton / Montserrat). Nothing is loaded from the internet. |
| Its own logos / track images | Overdrive's team logos (identical files) and map shots. Sheet names such as "Weibo x FUT" or "NaVi x Joel" resolve to our teams. |
| Classic / Midnight / Cyber… themes | The Major identity: fire loop, orange accents, charcoal panels. Team colours are in-game **blue / red** by default, or Overdrive **orange / bone**. |
| Data: the Google Sheet only, read in the browser | The same sheet tabs, read by the Overdrive server (optional auto refresh), **or rounds entered in Overdrive** (no sheet needed). |
| Mock datasets | **Demo track**, labelled DEMO DATA on the graphic. |

The overlay also pointed some track names at image files it didn't include (alpine-valley.jpg and others). Those are
gone: only the five OverDrive maps have shots.

## Using it

**Producer → Library → Gameplay → Track Progression.** Its **Track rounds** panel has two sources.

**Entered here** (works with no sheet):

1. **New track.** The teams default to the cast match. The track number defaults to the next map of the series. The
   map and "picked by" come from the **map veto** (Track 2 → the second pick). Press **Start track**.
2. **Round buttons:** ◆ Ace 3–0 · 2–1 · Draw 1–1 · 1–2 · ◆ Ace 0–3. **Undo round** removes the last one.
3. Optional: the threshold (10 points), the **fastest lap** (player, time, round) and a custom **takeaway**. Without a
   custom takeaway, it is written from the rounds.

**Google Sheet:**

- **Control tab:** reads `out_track_progression`, whatever the sheet's control panel selects, as in the overlay's
  "Live Sheet" mode.
- **Match + track:** reads `db_rounds_flat` for one sheet match id (`match_0006`) and track number.
- **Load** reads it now. **Auto 8 s** re-reads it every 8 seconds; only real changes reach the graphic.
- **Sheet id:** empty means the overlay's sheet (`1Zlhvry…`). The sheet must be shared as "Anyone with the link can
  view", as before.
- **Errors:** a wrong tab or an unreachable sheet shows an error in the panel. The graphic keeps the last good track.

The data belongs to the event (like the bracket), so every console and the OBS source show the same thing. A rehearsal
event has its own.

**Graphic settings** (Inspector):

- background: fire loop / dark / transparent over the game;
- team colours;
- fastest lap on / off;
- the chart wipe animation.

## Sheet columns (unchanged from the overlay)

`A match_id · B track_number · C round_number · D track_id · E p1_team_id · F team_a_id · G team_b_id · H pts_a ·
I pts_b · J combo_a · K combo_b · L track_name · M picked_by · N point_limit · O team_a_tag · P team_a_name ·
Q team_a_roster · R team_a_color · S team_a_logo_slug · T team_b_tag · U team_b_name · V team_b_roster · W team_b_color ·
X team_b_logo_slug · Y fastest_player · Z fastest_time_ms · AA fastest_round · AB custom_takeaway`

The track, teams and fastest lap are read from the round 1 row. The team colour columns are not used: the graphic uses
blue / red or orange / bone, so the chart always has two clearly different colours.

## Tests

| Suite | Result | What it covers |
|---|---|---|
| `tests/trackProgress.test.ts` | 37/37 | Sheet parsing, wrong-tab protection, the round story, team and map resolution, operator actions, saved state. |
| `e2e-rig/track/track_e2e.py` | 21/21 | Real server, Producer and OBS source in headless Chrome, mock OBS, the sheet replaced by CSV files in the exact column layout (details below). |

What the end-to-end run checks:

- **OBS:** the Scene Builder builds the scene.
- **Entered rounds:** veto defaults, round buttons, undo, fastest lap and the final state.
- **Sheet:** the Control tab, match + track, and auto refresh picking up a new row.
- **Errors:** a wrong tab shows an error and the last good track stays.
- **Demo and clear.**
- **Output:** 4K at native 2×, and no page errors.

Not tested here: your real Google Sheet (no internet in the test machine) and real OBS.

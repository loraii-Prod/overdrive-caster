# Release candidate: bracket polish, MVP voting and audience integration

Branch `feature/native-4k`. This is not merged into `main` and not deployed. It needs approval first.

| Commit | What |
|---|---|
| `a8670ef` | `audience` merged into the 4K branch (Pick'ems, Community MVP, QR, vote service, durable storage) |
| `fe08c6c` | Major bracket: stable frame, staggered page transitions, Preview/TAKE page controls |
| `981423c` | Sheet bracket: the same page transitions, uniform card size, no blank frame |
| `b0d1de7` | MVP modes A/B/C, producer MVP management, public-page states, Studio voting URL, desk QR |
| (this doc) | Regression harness additions and release-candidate notes |

Screenshots are in `docs/2.0-polish/`.

## 1. Audit: what already existed and what was reused

I audited `main`, `feature/native-4k` and `audience`. Nothing below was duplicated; every addition extends the existing code.

| Area | Where it lives | Status before | Now |
|---|---|---|---|
| Community MVP vote | `vote/` (Postgres) + `server/audience.ts` + `od.mvp` | prepare/open/close/reveal, results frozen at close, reveal on publish | extended: countdown, optional live totals, closed state, stats and achievements, archive |
| Analyst MVP | `staff-mvp` op, `desk` and `compare` steps | per-position picks | unchanged; it now shows the reveal card too |
| Staff vs Community Pick'ems | `od.pickem`, PickemsModule | complete | unchanged; regression 71/71 |
| Desk predictions | `wc.intro.picks` / `wc.pickem` | complete | unchanged |
| QR | `od.qr` (lower-third, corner and desk positions), QrModule, approved hosts | URL only from the `VOTE_PUBLIC_URL` env | URL can now be set in Studio; optional QR on the Analyst Desk |
| Polls | only MVP polls exist (no generic polls) | none | no new poll system was added |
| Bracket | `WcBracket` (Major), `SheetBracket` (sheet), `od.bracket` package | see the root causes below | fixed |

None of the audience features become public by themselves. The voting page exists only if the vote service is configured (`VOTE_URL`/`VOTE_SECRET`). No audience graphic goes on air until a producer publishes it. OBS Setup does not create audience sources.

## 2. Bracket: root causes and fixes

**Root causes found:**

1. **Every page change remounted the whole page.** A new React key for each page meant a new layout, and every logo was requested and decoded again. That caused the flicker and the empty logo slots for a frame.
2. **The title and frame moved with the page.** The whole 1920 px page slid across, title included, over 750 ms.
3. **The title jumped between pages** because of different header positions (`.stage.p2 .hdr { top: 200px }` against 180 px).
4. **Rapid changes snapped.** An interrupted slide was cancelled, and the new one restarted from off-screen.
5. **Sheet bracket blank frame.** `AnimatePresence mode="wait"` faded the old page out (400 ms), left an empty frame, then faded the new one in. The title faded with the page.
6. **Sheet bracket uneven cards.** Compact mode and row height were decided per column, so a column with fewer matches got taller cards than its neighbours. The grand-final card also covered its own label.
7. **No connectors.** The approved Major design hides them (`svg.lines { display: none }`).

**Fixes** (`src/lib/pageFlip.ts`, shared by both brackets):

- **Both pages stay mounted.** A page change only flips visibility, so logos stay decoded and nothing is laid out again.
- **Stable frame.** The title stays put and its text crossfades. One header position is used on both pages.
- **Staggered page change, about 560 ms (never over 600 ms).** The old page's columns fade and slide out left to right. The new page's columns arrive with a stagger, from the right on a later page and from the left on an earlier one. Wide sheet brackets tighten the stagger automatically to stay within the budget.
- **Interruptions continue from where each card is** (`commitStyles`). Rapid changes never stack more than two layers, never overlap and never blank the frame. With reduced motion the change is instant.
- **Connector lines (optional, off by default** to keep the approved look). They are computed from the same layout as the cards, so they always meet the card edge centres. Lines out of finished matches are highlighted. Toggle: Producer → Bracket → "Connector lines".
- **Card states:**
  - finished: winner accent and winning score highlighted;
  - live: the existing Live tag;
  - upcoming: dim score;
  - TBD and bye: unchanged.
- **Long names** step down in size (21 px, then 18 px) before the ellipsis, decided by length with no measuring, so there is no reflow. A missing logo keeps its slot.
- **Sheet bracket:**
  - one card size per page;
  - title and tournament name stay put while the section tag crossfades;
  - grand-final label fixed.

**Producer controls (Producer → Bracket module):**

| Control | What it does |
|---|---|
| ◀ Prev / page selector / Next ▶ | Changes the **Preview** page only (`cue`). Program is untouched. |
| Draft view of the producer canvas | Shows the cued page |
| TAKE page N | Puts the cued page on Program, with the transition. A repeated TAKE does nothing. |
| Reset to page 1 | Puts page 1 on Program and in Preview |
| Auto switch halves / Connector lines | As before / new |

The PREVIEW and PROGRAM badges always show both states. The existing on-air page buttons in the controller (SceneDock, Wildcard panel) still work.

## 3. MVP scene: three modes

| Mode | On air (`od.mvp`, step "Voting open") | Public page |
|---|---|---|
| **A: voting open** | Eligible players (portrait, team, logo), QR, "VOTING OPEN", the countdown if one was set. Live totals appear **only** after the producer turns on "Live totals on air"; they are sent to the outputs only for that open vote. | Candidates with portraits, countdown, select, then submit, then "✓ Vote received". |
| **B: voting closed** | "Voting closed", "Votes are in", total counted. **No winner and no percentages.** | "Votes are in: the Community MVP is revealed on stream", plus your own vote. |
| **C: reveal** | Community MVP (winner, % of frozen votes, runners-up), Analyst MVP, or Community vs Analysts (one hero when they agree, split view when they differ). The producer's stats (up to 4) and achievements (up to 3) are shown under the player. | Winner with portrait and %, but **only after the on-air reveal**. |

The countdown is enforced on the server: the vote service refuses votes after the closing time, and the broadcast server freezes the result on time (checked every 2 s). The producer can add 30 seconds or remove the countdown while voting is open.

## 4. Producer MVP management (Producer → MVP module)

| Step | How |
|---|---|
| Select the match | Defaults to the cast match, or else the latest finished match that is not archived ("next session"). |
| Eligible players | Chips (verified rosters only), then Prepare |
| Open voting | Countdown preset (none, 1, 2, 3 or 5 min), then Open voting |
| While open | Close voting, +30 s, No timer, "Live totals on air"; private live count with bars |
| Analyst MVP | Per desk position |
| Reveal card | Stats and achievements per player; the frozen winner is suggested |
| Reveal | **Preview reveal** prepares the winner step as a draft (Program unchanged). **REVEAL on Program** publishes it. The button is disabled until a reveal step is prepared for this match, and a double press is refused by the server (one animation). Publishing a reveal step is what makes the result public on the voting page. |
| Archive & next match | Refused while voting is open. Results stay stored, and the module moves to the next match. |

All state lives on the server, so every producer interface sees the same thing. An OBS disconnect has no effect on votes: they live in the vote service's Postgres.

## 5. Public voting site

The site is the vote service's own page (`/vote`), separate from Producer and Studio, and mobile first. It has:

- portraits, absolute https addresses built from the uploads using `PUBLIC_URL`/`RENDER_EXTERNAL_URL`, with a silhouette fallback;
- names and logos;
- the countdown;
- vote confirmation;
- the closed state;
- the winner, only after the reveal;
- "No connection. Nothing was sent: try again." on network failure, after which the page reloads what the server really holds (optimistic picks are rolled back).

**Integrity, stated honestly:**

- one vote per **Twitch account** per MVP vote, enforced by a database primary key (a repeat keeps the first vote);
- server-side validation of the poll, eligible player, open status and closing time;
- per-IP and per-account rate limits;
- signed-in sessions;
- producer actions only through the broadcast server's controller session and the shared secret;
- no credentials on the page (checked by the tests).

**This is not one-person-one-vote.** Someone with several Twitch accounts can vote several times. Twitch sign-in is the strongest identity available here.

## 6. QR

| Where | How |
|---|---|
| MVP voting scene | Built in (Mode A) |
| Analyst Desk | New "Voting QR" option on the Analyst Desk graphic (off by default). It sits clear of the cameras in both the duo and solo layouts (tested). |
| Producer preview | QR module and Studio → Audience & QR show the live code |
| Lower-third / corner | The existing `od.qr` graphic |
| Public URL | **Studio → Audience & QR**: an https-only override with validation. Empty means `VOTE_PUBLIC_URL`. Its host is approved for QR codes automatically. |

**Scannability.** The tests decode the on-air QR with OpenCV from:

- the 1080p capture;
- the 4K capture;
- a 720p downscale of the 1080p frame (a typical viewer stream).

## 7. 4K and 1080p

- The bracket's logical geometry is identical at 1080p and at 2× (4K). The tests compare every card box.
- A native 3840×2160 render is checked.
- Transitions animate only opacity and translate (compositor-friendly), with no filters or blur.
- Pages are isolated with `contain: layout paint`.
- The off-air suspension from the 4K work still applies: paused pages run no animations.

## 8. Tests

| Suite | Checks |
|---|---|
| `e2e-rig/bracket/bracket_e2e.py` | 21 |
| `e2e-rig/bracket/sheet_e2e.py` | 24 |
| `e2e-rig/audience/mvp_modes_e2e.py` | 52 |
| Full regression (`bash e2e-rig/4k/run_all.sh`) | every 4K suite plus the suites above plus the existing audience/storage/OBS suites; result in §9 |

**`bracket_e2e.py`** covers:

- static pages;
- Preview not touching Program;
- TAKE, sampled mid-transition at 0, 100, 200, 300, 420 and 560 ms, with no blank frame;
- a stable title;
- a repeated TAKE as a no-op;
- 5 rapid changes (at most 2 layers, cards back exactly on layout, everything settles);
- connectors meeting card edge centres (±1 px);
- long names;
- missing logos;
- 4K geometry identical to 1080p, with a native 4K render and a 4K transition;
- reduced motion;
- reset.

**`sheet_e2e.py`** covers single and double elimination with 8 and 16 teams, long names, missing logos and incomplete matches. For each: one card size per page, nothing off-screen, auto page flip with a stable frame, settles within the budget.

**`mvp_modes_e2e.py`** runs against the real vote service, Postgres, broadcast server, graphics and phone page. It covers:

- Modes A, B and C;
- countdown on air and on the phone;
- live totals only when enabled, and never on the public page;
- repeat votes;
- offline phone writes;
- late votes refused (409) and auto-close with the result frozen;
- the winner hidden in B (on air and on the phone);
- Preview not changing Program or the public page;
- REVEAL with stats and achievements;
- a double reveal giving one animation;
- the public winner after the reveal;
- the analyst and compare (same and different player) views;
- archive;
- Studio URL validation;
- QR decoded at 1080p, 4K and 720p;
- the desk QR in duo and solo without covering cameras;
- no secret on the public page.

**Visual regression.** The bracket's static pages and its mid-transition frames are captured by `bracket_e2e.py` at 1080p and 4K (`/tmp/4k/bracket/*.png`, copied into `docs/2.0-polish/`). The 4K `vis.py` baselines predate this work. The bracket and analyst-desk scenes differ from them on purpose:

- single header position;
- winner accent;
- in the earlier transition, mid-frames no longer exist in the old form.

Those diffs are listed in §9.

## 9. Results (`bash e2e-rig/4k/run_all.sh`, full log in `docs/2.0-polish/RESULTS.txt`)

**Unit tests:**

| Suite | Result |
|---|---|
| engine | 91 |
| obsSetup | 76 |
| dataset | 25 |
| assets4k | 11 |
| camQuality | 7 |

**4K suites:**

| Suite | Result |
|---|---|
| visual 1080p + 4K vs the original | 59/60 in the full run, then **60/60 on re-run** |
| layout equivalence | 33/33 |
| output basics | 11 |
| GPU artifacts | 9 |
| scene audit | 33/33 |
| camera quality | 11 |
| rerender | 4 |
| off-air pausing | 16 |
| OBS 4K canvas | 8 |
| asset replacements | 7 |
| perf bench | ok |

The one visual failure in the full run was the warm-up showcase's clock-driven player counter, a scene this work does not touch.

**New suites:**

| Suite | Result |
|---|---|
| bracket transitions | 21/21 |
| sheet bracket sizes | 24/24 |
| MVP modes | 52/52 |

**Existing suites:**

| Suite | Result |
|---|---|
| audience workflow | 71/71 |
| MVP render | 14/14 |
| durable storage | 43/43 |
| broadcast workflow | 23 |
| camera sync | 29 |
| OBS UI | 22 |
| OBS docks | 21 |

**Screenshots:**

| File | Shows |
|---|---|
| `docs/2.0-polish/bracket-transition.jpg` | static pages, mid-transition at +100/200/300/420 ms, connectors, 4K |
| `docs/2.0-polish/sheet-bracket-sizes.jpg` | single/double elimination, 8/16 teams |
| `docs/2.0-polish/mvp-modes.jpg` | modes A/B/C, analyst, compare, desk QR in duo and solo |
| `docs/2.0-polish/phone-A-B-C.jpg` | the voting page in each mode |

## 10. Limitations

- **Real-OBS / GPU performance is not verified here.** It was all tested in headless Chrome. See the production-PC checklist below.
- One vote per Twitch account, not per person (see §5).
- Portraits on the phone page need the broadcast server's public address (`PUBLIC_URL`, or `RENDER_EXTERNAL_URL`, which Render sets automatically) and publicly readable uploads.
- Live totals are on the outputs' feed only while enabled. Outputs are not public pages, but anyone holding an output URL can read the feed: use `OUTPUT_KEY` if output URLs could leak.
- Connector lines are off by default (the approved design has none). Turn them on per show.
- The sheet bracket still rotates on its own 10 s timer (or follows "upper/lower" in the controller). Preview/TAKE page control exists for the Major (Wildcard) bracket, which is the production bracket.
- The vote-service schema migration (`closes_at`) runs automatically on boot (`alter table … add column if not exists`).

## 11. Production-PC tests before approval

1. **OBS browser source at 3840×2160 and 60 fps** on `/output/major`. In Producer, cue page 2 and TAKE, then press TAKE/Prev/Next/TAKE five times quickly. Watch OBS stats: no skipped or lagged frames. Check visually that there is no blank frame, the title never moves, and the change takes about half a second.
2. **The same at a 1920×1080 canvas.**
3. **Connector lines on, then off**, on the real logos and real results.
4. **The MVP flow live:**
   - Prepare, then open with a 2 min countdown.
   - Scan the QR **from a phone pointed at the stream preview**: the OBS projector, then the Twitch 1080p and 720p renditions.
   - Vote.
   - Turn live totals on and off.
   - Let the countdown close the vote, and confirm the phone shows "Votes are in".
   - Preview reveal, then REVEAL on Program. The phone shows the winner a few seconds later.
5. **Analyst Desk with "Voting QR" on**, in duo and solo. Check that it is clear of the real camera framing.
6. **Studio → Audience & QR:** set the production voting URL and scan the Studio check code.
7. **Disconnect OBS mid-vote** and reconnect. The vote counts are unchanged (Producer MVP module).

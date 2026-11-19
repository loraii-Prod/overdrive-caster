# Overdrive 3.0.1 · MVP integration: diagnosis and fix

This is the answer to the brief "FIX MVP INTEGRATION COMPLETELY". It covers what was actually broken (traced in the
code before anything was changed), what changed, how to use it during the Major, and how it was tested.

## 1. Diagnosis: the MVP path traced end to end

The path traced: match result → MVP match → players → vote session → graphic → OBS source → Producer → automation →
public page.

| Suspected cause (from the brief) | Found? | What the code did |
|---|---|---|
| Separate or stale state stores | **Yes, the main cause** | The MVP had **no match of its own**. The graphic, the Producer panel, the engine and the server each computed "MVP match = the graphic's match setting, else the **cast** match" on their own. Moving the cast to the next match (the normal thing after a result) pointed the MVP at a match with no result: the graphic drew nothing and the panel said "No result yet". Once someone picked a match in a dropdown, it stayed pinned, so the next match's MVP showed the old match. The older MVP module in the Inspector also kept its **own local match choice**, so two consoles could look at two different matches. |
| Incomplete voting session initialization | **Yes** | Nothing happened when a match ended. The producer had to open the MVP scene, pick the match and click candidates one by one. The built-in automation rule "Match ends → MVP voting" then failed at its "open voting" step with "No MVP vote prepared". |
| Missing match-to-MVP data mapping | **Partly** | The mapping was correct for the eight Major teams (players come from the verified Major profiles). Any other team, such as another event profile or a substitute, got zero candidates, with no warning and no way to add players. |
| Votes carried between events | **Yes** | Votes, manual MVP, analyst picks and archives were stored once for the whole server, keyed by bracket slot (R1_UB1…). Every event profile uses the same slots, so switching event carried one event's votes and reveals into another. |
| Missing controller navigation | Fixed in 3.0 | The MVP main scene tile was added in 3.0. It is now also reachable from an MVP status chip in the Producer header. |
| Missing OBS scene registration / incorrect browser source URLs | **No** | The Scene Builder already creates the five MVP scenes with valid `/g/mvp?view=…` sources. Verify and Repair already cover them. Both are tested again below. |
| Broken synchronization (WebSocket) | **No** | Changes already reached every page at once. The problem was *what* was synchronized (see the first row), not the transport. |
| Missing player data | Partly | Same as the mapping row: verified Major teams have players; other teams had none. |

## 2. What changed

**One MVP state.** The MVP match is now one value: the MVP graphic's `match`.

- **Who reads it:** the graphic, the five OBS sources, every Producer and Studio console, the vote, the automation and
  the rundown.
- **Who sets it:** only the server.
- **Cast fallback removed:** the "else the cast match" fallback is gone everywhere.
- **Old MVP module:** it now shows that same match, and changing the match there changes it for everyone.

**A match marked completed** is detected when its result comes in, either from the controller's score buttons or from
the Google Sheet. Then:

1. That match becomes the MVP match.
2. All its eligible players are loaded: both teams' players, with names, team logos and pictures.
3. The MVP vote is prepared: on the online vote service when it is set up, otherwise locally.
4. The voting graphic updates on its OBS source, with no refresh.
5. The public voting page has the match result. Its vote appears when you open voting.
6. You are told:
   - a pulsing **MVP · READY** chip in the Producer header, visible from any scene;
   - a notice in the MVP panel;
   - "R1 UB 1 · Ready" on the MVP tile.
7. Voting is **not** opened and OBS is **not** switched. Under **On result** in the MVP panel there are two settings
   for that, both **off by default**:
   - **Open voting**
   - **MVP in OBS Preview** (Studio Mode Preview only; Program never changes by itself)
8. The existing "Match ends → MVP voting" automation rule now finds a prepared vote, because preparation runs before
   the rule fires.

**Changing matches can never move votes or reveal the wrong winner.**

- **Votes stay with their match.** Every vote and result is stored against its match.
- **Switching while voting is refused.** The server refuses to change the MVP match while voting is open, from any
  console.
- **A result during an MVP is queued.** If another match finishes while an MVP is running (voting open, or an MVP
  scene on Program), it waits: the notice says so and offers **Switch MVP to …** once you're done.
- **Reveal authorizations belong to one match.** After a switch, the reveal source on Program draws nothing until the
  new match is revealed.

**Missing information** is shown in the MVP panel's checklist (**✓ Ready / ⚠ Check / ✕ Not ready**):

- match
- players
- pictures
- logos
- vote
- ways to vote
- voting page and QR
- OBS scenes
- connected MVP browser sources (counted from the source pages that actually connected)

How to fix the two kinds of gap:

- **A team with no known players:** a red box asks for them. Type them, comma separated, and press Save. They're saved
  to this event and the prepared vote picks them up straight away. **Edit … players** handles a substitute.
- **A player with no picture:** the card has **+ photo**. The upload goes to the same portrait store the graphics use.

**Per-event data.**

- **What moved into the event profile:** votes, MVP choices, analyst picks, archives, the MVP automation settings and
  the event's MVP match.
- **Switching:** switching event switches all of it.
- **New events:** a copied event keeps the voting settings, never the votes.

**Rehearsal: Load demo match** in the MVP panel.

- **The event:** switches to a separate event, "MVP rehearsal · demo data", with clearly fictional teams (DEMO Falcons,
  DEMO Comets, DEMO Rockets, DEMO Wolves) and players ("Falk (demo)", …).
- **The look:** your current scenes, brand and casters are copied in.
- **The demo matches:** match 1 is live at 2–1. **Finish demo match** ends it through the same score command the
  controller uses, so the MVP prepares itself exactly as in the show.
- **What you can do:** simulate audience votes, open and close voting, preview, reveal, TAKE to OBS, and test the
  automation settings.
- **Safety:**
  - Votes stay on this server. The online vote service is never contacted, even if it is configured.
  - Real Twitch chat is ignored.
  - The Google Sheet is not pulled.
  - Every MVP graphic carries a **REHEARSAL · DEMO DATA** tag.
- **Leave rehearsal:** returns to your event with its MVP match, votes and results untouched. OBS is not switched when
  you enter or leave.

**Smaller fixes:**

- Long player names shrink to fit on the winner reveal instead of being cut.
- The online service only knows the eight Major teams and their verified players. A match using entered players
  therefore tells you to set **Counting → Local** for it, instead of failing silently.

## 3. During the Major

1. Enter results as usual (score buttons or the sheet). When a match ends, the header chip turns **MVP · READY**.
2. Click the chip (or the MVP tile). Check the candidates and the readiness list. Click **Start voting**, then **TAKE**
   when you want it on air.
3. **Stop voting**, then the **Community reveal** view, then **REVEAL** and **CONFIRM**.
4. Move on with the main scenes as usual. The next result prepares the next MVP. If a result comes in while an MVP is
   still running, use **Switch MVP to …** when you're done.

Before the show, run **Load demo match** once and walk through it. Then press **Leave rehearsal**.

## 4. Tests

| Suite | Result | What it covers |
|---|---|---|
| `tests/mvpSync.test.ts` (new) | 41/41 | Rosters, all-player preparation, missing-team refusal, draft refresh, open votes never touched, per-event stores, rehearsal data, readiness rules, automation settings. |
| `e2e-rig/mvp4/mvp_sync_e2e.py` (new) | 59/59 | The full local workflow in headless Chrome (detailed below). |
| `e2e-rig/mvp4/mvp_online_e2e.py` (new) | 19/19 | The online vote service and public website (detailed below). |
| `e2e-rig/mvp3/mvp_e2e.py` | 31/31 | Updated to the automatic preparation. |
| `e2e-rig/talent3/talent_e2e.py` | 23/23 | Unchanged. |
| All existing unit suites | 495/495 | Unchanged, all pass. |

What the local workflow e2e (`mvp_sync_e2e.py`) runs, in headless Chrome against a stand-in OBS:

- **Results and preparation:**
  - results entered through the controller's score command;
  - auto-preparation;
  - the notice, chip and tile;
  - the cast moving on without the MVP moving.
- **Live updates and sync:**
  - OBS browser sources (the exact URLs the Scene Builder put in OBS) updating without refresh;
  - a second controller showing the same state;
  - a page reload keeping it.
- **Guards:**
  - a result during voting is queued;
  - the server refuses a match change while voting is open.
- **Votes, reveal and the next match:**
  - live counts, close, preview and reveal with CONFIRM to OBS;
  - the winner checked against the frozen counts;
  - switching to the waiting match, with no vote and no reveal carried over.
- **Missing data:** a team with no players gets a warning, players are entered, and the vote and OBS source update.
- **OBS:** Verify finds a broken MVP source, and Repair fixes it.
- **Rehearsal and automation:**
  - rehearsal load, finish, vote, TAKE, reveal and leave, with the real event intact;
  - automation "Open voting" on: the next result opens voting, Program untouched.
- **Output:** the 4K source renders.

What the online e2e (`mvp_online_e2e.py`) runs, with the real vote service on a real PostgreSQL 16:

- **Public page:**
  - automatic preparation on the online service;
  - the public page showing the result, and the vote only once it is open;
  - the QR on the voting graphic.
- **Votes:**
  - website votes from signed-in viewers;
  - one vote per viewer;
  - a player of another match refused;
  - live web counts in the Producer.
- **Reveal:**
  - the result stays hidden on the public page until the on-air reveal, then it is shown.
- **Rehearsal:** never reaches the online service.
- **Entered players:** a match with entered players gives the "count locally" guidance.

**Not tested:**

- **Real OBS:** the stand-in OBS speaks the same obs-websocket 5 protocol.
- **Real Twitch:** chat voting, and Twitch sign-in on the public page. Viewers used the service's test login.
- **Your deployed vote service and your `npm run build`.** The vote service code itself is **unchanged**, so it does
  not need redeploying. Your `npm run build` needs a rebuild: `start.cmd rebuild`.

The sandbox has no `pg` package, so the test rig talks to Postgres through a small wire-protocol client
(`e2e-rig/devshim/pg-wire.ts`, tests only, never shipped). Production uses the real `pg` package as before.

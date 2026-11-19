# MVP & Awards scenes

MVP is a scene category in the main controller, like Desks or Gameplay. There are five scenes:

| Scene | Browser source (OBS) | OBS scene | What it draws |
|---|---|---|---|
| Community MVP — Voting Open | `/g/mvp?view=voting` | Overdrive · Community MVP — Voting Open | candidates, QR / chat command, countdown, optional live totals |
| Community MVP — Voting Closed | `/g/mvp?view=closed` | Overdrive · Community MVP — Voting Closed | the voting graphic in its closed state (no result) |
| Community MVP — Winner Reveal | `/g/mvp?view=winner` | Overdrive · Community MVP — Winner Reveal | the 9-beat reveal, **only after the producer authorized it** |
| Analyst MVP — Winner Reveal | `/g/mvp?view=desk` | Overdrive · Analyst MVP — Winner Reveal | the analyst desk pick, after authorization |
| Community vs Analyst MVP — Comparison | `/g/mvp?view=compare` | Overdrive · Community vs Analyst MVP — Comparison | both winners, after authorization |

All five are views of **the one MVP graphic**. They share its data, its native 3840×2160 renderer, the player
portraits and framing, the approved animations and the branding. Nothing is duplicated or redrawn. Each scene has its
own OBS browser source, built by **Studio → OBS & Outputs → Scene Builder** (rebuild once to add them).

Existing URLs are unchanged. `/g/mvp` still works and still follows the MVP sequence. Its OBS scene keeps its name,
“Overdrive · MVP”. Saved rundowns that used the MVP scene (`s:mvp`) now open on **Voting Open**.

## Reveal safety

- A reveal scene's browser source draws **nothing** until the producer authorizes that reveal for that match.
  Authorizing means TAKE (second click), rundown GO, or the MVP sequence's confirmed reveal.
- The Overdrive Preview monitors may show it privately before that. The Program monitor and the sources do not.
- The Community MVP needs the result frozen at close. The Analyst MVP needs an analyst pick. The comparison needs both.
- Automation never authorizes a reveal by itself. An automatic GO into a reveal waits for the producer's GO, unless
  “Reveals need producer confirmation” is turned off.
- Authorizations belong to a match. Choosing another match starts again from the voting step.

## Studio Mode

Select an MVP scene in the Scene Library (category **MVP & Awards**). Scene settings shows the MVP configuration in
the normal Studio layout. Everything is saved to the current event:

- **Match & candidates:** the current match (or the cast match), the candidates from the match roster (up to four,
  numbered like the cards), Prepare / Update candidates.
- **Voting:** the default countdown, live-voting options, a preview of the voting QR code and Twitch chat voting.
- **Analyst MVP:** each seated analyst's pick.
- **Community MVP results:** live, then frozen. Producer only.
- **Reveal animation:** pace (cinematic / standard 1.4× / quick 2×, with the same beats in the same order), the
  opening sweep and flare, and whether reveals need confirmation.
- **Scene transition & music:** the transition and music of each MVP scene's rundown item. If they are missing,
  **Add MVP sequence to rundown** adds them.
- Reveal card extras (stats, achievements) and **Player portraits** (upload, crop, zoom, position).

## Producer Mode

1. Select an MVP scene in the library. The preview shows it and Program is not touched.
2. Its controls appear right under the preview:
   - **Voting Open:** Prepare candidates, Open voting (with the Studio countdown), Close voting, +30s, live totals,
     participation (votes, chat / website split, players, chat status).
   - **Voting Closed:** “Close voting + TAKE”, frozen totals (private).
   - **Winner Reveal:** winner preview (private), reveal pace, Replay animation.
   - **Analyst MVP:** select each analyst's winner, then reveal, then Replay.
   - **Comparison:** community winner and analyst winner, then Replay.
3. **TAKE** prepares what the scene needs (closes voting, authorizes the reveal), switches OBS to the scene's own
   source with the transition, and moves the show rundown on. A reveal asks for a second click (**CONFIRM**).
4. **Next: <item>** continues to the next rundown item (the same as GO / F9).

## 3.0: MVP as a main scene

**Producer Mode → first column → Scenes.** MVP is a main scene tile next to Starting Soon, Caster Desk, Analyst Desk,
Gameplay, Intermission and Ending. The tile has:

- a live thumbnail;
- the Program and Preview tally;
- the voting state (open, vote count, countdown).

The tile opens on the view the next step needs: Voting, Closed, Community reveal, Analyst reveal or Comparison.

- **Click a tile** to put it in Preview. The 1920×1080 preview and that scene's controls switch to it. With OBS in
  Studio Mode, OBS's own Preview follows. Program is never touched, so MVP is prepared while the Caster Desk stays on
  air.
- **TAKE** goes to Program with the transition chosen in the Publish column. **AUTO** uses OBS's transition. **CUT**
  cuts. The show rundown follows. A reveal asks for **CONFIRM** first.
- **MVP control panel** (MVP selected):
  - match selection;
  - candidates with picture, team, stats and live votes (private);
  - Prepare, Start / Stop voting, countdown, +30 s, live totals on air;
  - QR code shown / hidden on the graphic (applied at once);
  - counting status: local or online, website and Twitch;
  - rehearsal votes, counted apart and flagged until reset;
  - **Manual MVP** (override);
  - the analysts' picks;
  - the five views as Preview buttons, with the reason a reveal is locked;
  - Replay;
  - **Reset for next match** (archives this match's MVP and moves to the next finished match).

**Local counting (no vote service needed).** Without `VOTE_URL` / `VOTE_SECRET`, or with "Counting: Local", this
server counts the MVP vote itself. It uses the vote service's rules: one vote per Twitch account, late votes refused,
and the result frozen at close.

- **Votes come from:** Twitch chat voting, plus rehearsal votes for tests.
- **Public website:** voting there needs the online vote service, so the website QR is not shown in local counting.
- **When viewers cannot vote:** the panel says so if Twitch chat is not connected.

**Manual MVP.** When voting is not possible or must be overridden, the production picks the player.

- An open vote is closed first; its count is kept.
- With no vote at all, a closed result is created for the match.
- The reveal names the player under a **Match MVP** badge with "Chosen by the broadcast team". It never shows a vote
  share it does not have.
- **Undo** returns to the vote's own result.

Tests:

- `tests/mvpLocal.test.ts` (34 checks).
- `e2e-rig/mvp3/run.sh` (30 checks). It runs the real server, the Producer page, the browser sources at 1080p and 4K,
  and the mock OBS with every scene built by the Scene Builder. It covers the seven-step workflow above, the manual
  MVP, reset, and the Studio Program monitor.
- A real OBS, real Twitch chat and the online vote service were not available for testing.

## Rundown and automation

The starter rundown contains the five MVP items after the analyst desk. Studio → Automation has two templates, and
the starter plan includes both:

- **Match ends → MVP voting.** When a match result is entered, Voting Open is prepared and the producer is notified.
  On GO, the scene goes on air and voting opens.
- **MVP voting closes → reveals (each with GO).** Voting Closed goes on air. Then each reveal is prepared and waits
  for its own producer GO: Community MVP → Analyst MVP → comparison. After that, the next item is prepared.

“A match ends” is a new automation trigger. It fires once per match, the first time a result is entered.

## OBS test

1. Studio → OBS & Outputs → Scene Builder: build the scenes again. Five “Overdrive · … MVP …” scenes appear, each with a
   1920×1080 logical / 3840×2160 4K browser source.
2. With voting closed and nothing revealed, put “Community MVP — Winner Reveal” in OBS Preview. It must be **empty**
   (transparent).
3. In Producer Mode, select the scene, press REVEAL, then CONFIRM. OBS switches and the reveal plays.
4. Use OBS's Stats to check the frame rate at 4K. This environment could not test inside OBS. Everything above was
   checked in a browser (Chromium) at 1920×1080 and 3840×2160.

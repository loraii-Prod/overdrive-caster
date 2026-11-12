> **Overdrive 2.0**: one Producer Console at `/producer`; every scene is its own OBS browser source; 10 talent profiles with personal links; graphics engine with packages and `/g/<instance>` browser sources. See [OVERDRIVE-2.0.md](OVERDRIVE-2.0.md) for the sources list, the workflow and the test results.

# Overdrive — Broadcast Caster System

A web-based caster control system for live esports production. A producer runs up to three casters from a password-protected dashboard. OBS shows the result through browser sources that update in real time and never need refreshing.

## Quick start

```bash
npm install
npm run build
CONTROLLER_PASSWORD=producer-pass ADMIN_PASSWORD=bracket-pass npm start
# producer:          http://localhost:8787/controller
# tournament admins: http://localhost:8787/admin
```

To develop with hot reload, run `npm run dev`. The UI is at http://localhost:5173 and the API/WebSocket server at :8787.

If `CONTROLLER_PASSWORD` or `ADMIN_PASSWORD` isn't set, the server generates one on first start and prints it. Settings, presets and the last live configuration are saved in `./data/state.json` (or `DATA_DIR`). They are restored after a restart.

Docker:
```bash
docker build -t overdrive-caster .
docker run -p 8787:8787 -v overdrive-data:/data -e CONTROLLER_PASSWORD=… overdrive-caster
```

## Routes

| Route | Purpose |
|---|---|
| `/controller` | Producer dashboard (login required) |
| `/output/casters` | Main caster composition (cameras, cards, nameplates, branding) |
| `/output/solo` · `/output/duo` · `/output/trio` | Same scene, capped at 1 / 2 / 3 tiles. These always adapt down and never show an empty box |
| `/output/names` | Nameplates only, transparent, in the same positions as `/output/casters` |
| `/output/branding` | Overdrive branding only, transparent |
| `/output/screen/<screen>` | One screen exactly as `/output/program` draws it (casters, starting, brb, ending, warmup, gameplay, bracket, matches). Used by **Build scenes in OBS** |
| `/output/audio/1..3` | A remote caster's microphone only, for mixing in OBS |
| `/output/program` | **The whole show in one source.** Shows whichever screen is live (Casters, Starting soon, BRB, Thanks for watching, Bracket, Matches), with an Overdrive stinger between screens |
| `/output/starting` · `/output/brb` · `/output/ending` | Each full screen on its own, for one-OBS-scene-per-screen setups |
| `/output/scoreboard` | In-game scoreboard (transparent): tags, logos, series pips, game/map |
| `/output/ticker` | Scrolling news ticker (transparent, bottom) |
| `/output/bracket` | Tournament bracket. `?view=upper` / `?view=lower` for big brackets, `?transparent=1` without the background |
| `/output/matches` | Upcoming matches and latest results. `?transparent=1` without the background |
| `/admin` | Tournament admin (separate password) |
| `/contribute/1..3?key=…` | Camera link for a remote caster (copy it from the controller) |

Every output is a 1920×1080 canvas on a transparent page. In OBS, add a **Browser Source** at 1920×1080, with *Shutdown source when not visible* **off** and *Refresh browser when scene becomes active* **off**. Add `?debug=1` to any output to see its connection state.

Output URLs are read-only. They receive the live scene and can't change anything. To make them private too, set `OUTPUT_KEY`; the controller then shows URLs that include the key.

## Producer workflow

- **Preview / Program.** Every edit goes to the preview monitor. **TAKE LIVE** (or Ctrl/Cmd+Enter) pushes the whole preview to air in one step. **Instant mode** sends every change straight to air.
- **Layouts.** Auto picks Solo, Duo or Trio from the number of active casters. You can also force Solo, Duo or Trio. Mixed shows cameras where they're on and branded cards elsewhere. Audio shows identity cards only, over an animated Overdrive background.
- **Per caster:** enable, name, role, camera on/off, nameplate on/off, and camera source (Remote / OBS / URL / None). For a caster whose camera is off, choose *Name card* (stays on screen as a branded card) or *Remove* (the layout closes up).
- **Global:** a master nameplate switch, a branding switch, and a background switch.
- **Presets.** Six presets come built in: Pre-show, Match commentary, Analysis desk, Interview, Audio-only and Post-match. A preset stores the *look*: layout, which casters and cameras are on, and nameplates. Recalling one keeps the current names and camera sources. Tick *Also store names, roles & camera sources* when saving if you want those stored too. **TAKE** next to a preset recalls it and puts it on air in one click.
- **Reset to default** affects the preview only and keeps camera sources.
- A caster tile never shows black. A camera with no signal falls back to a branded card, and the controller monitors label it **NO SIGNAL**. That label never appears on air.

## Screens and show graphics

The six buttons under the monitors are the **screens**. Clicking one cues it in preview, so it goes out with your next **TAKE LIVE**. **GO** cuts straight to that screen and leaves your other prepared changes in preview. Each screen can also switch OBS to a matching scene (Integrations tab), if you prefer one OBS scene per screen.

The **Show graphics** panel has these tabs:
- **Match:** tournament, stage and map; team names, tags and logos (upload or URL); best-of and game number. Toggles for the in-game scoreboard, the matchup bar above the casters and the matchup card on screens. Also Swap sides and Reset scores.
- **Timer:** quick starts (1–30 min), +/- adjustments, or count down to a clock time ("18:30"). Set the label, the end text ("STARTING NOW") and which screens show the countdown. Every output uses the server clock, so countdowns agree across all OBS sources.
- **Screens:** title and subtitle for Starting soon, BRB and Thanks for watching. The schedule list can use the bracket's upcoming matches automatically, with a manual list as fallback.
- **Ticker & socials:** ticker messages, speed and placement, and social handles shown on the screens.
- **Sponsors:** upload logos; they rotate in the screen footers.
- **Tournament:** choose the **featured match**. Its teams, logos, scores, best-of and round name drive every graphic. Score buttons in the controller write back to the bracket.
- **Integrations:** the control API token with example URLs, and the screen-to-OBS-scene mapping.

Text and toggles are prepared in preview and go out with TAKE. Scores, game number and timer actions are instant, because a goal can't wait for a TAKE.

## Tournament admin (`/admin`)

Tournament admins sign in with `ADMIN_PASSWORD`. They can only manage the tournament; producer controls stay locked. A producer can open `/admin` too.

- **Teams:** up to 16, with name, tag and logo upload. Their order is the seeding.
- **Bracket setup:** single or double elimination, with match length and grand-final length. The **grand final bracket reset** option adds a second final that's only played if the lower-bracket team wins the first.
- **Bracket rules:** pairings use standard seeding (1v8, 4v5…). Losers drop into the lower bracket, crossing over on alternate rounds to avoid quick rematches. Empty slots become byes that advance automatically.
- **Matches:** scores with +/- buttons. Reaching the win target closes the match by itself. Each match also has status (Soon / Live / Final), a time and best-of, plus **Feature** to put it on the broadcast.
- **Live updates:** results are worked out from the scores, so correcting a result instantly re-flows the bracket, `/output/bracket`, `/output/matches` and the Starting Soon schedule. No TAKE is needed, because results are facts and they publish right away.

## OverDrive Major bracket

The OverDrive 2026 Major (21–22 Nov, 8 teams, double elimination, every match Bo5) is built in. Controller → **Major**. (It runs on the Wildcard overlay's engine, so code and some addresses still say "wildcard"; `/output/wildcard…` and `/output/major…` show the same thing.)

- **First round** card: pick the 8 teams in bracket order (Upper quarter-final 1 = the first two, …). Empty slots read TBD. The rest of the bracket fills in from the scores: upper quarter-finals → semi-finals → upper final; losers go to lower round 1 → lower quarter-finals (crossed) → lower semi-final → lower final; then the Grand final (Bo5, no reset).
- **Part 1** = upper bracket + Grand final, **Part 2** = lower bracket + final standings (1st–4th).
- On the first start after this update, the saved Wildcard results are cleared, the stage name and ticker switch to the Major, and the Wildcard's results sheet is replaced by the season sheet (switched off) so it can't write Wildcard scores into the Major bracket. Paste the Major tab's link in Tournament → Google Sheet when it exists.
- **On-screen extras start hidden**: caster predictions, the Casters screen's match strip and up-next card, the analyst desk's teams strip and countdown. Turn each on from the scene dock as the match gets closer.
- **Matches screen** (with the Major on): Up next (live and on-cast first, with start times) and the latest Results, straight from the bracket; no sheet needed.
- **Map card**: the map pool (India, Czech Republic, Egypt, United Kingdom, New Zealand, all by Marchielli) is in `shared/maps.ts`. On the Gameplay controls, **Next map** → a country button plays a 7-second full-frame card (map number, country, map name and author, flag colours, series score) on every gameplay source, and names the map on the scoreboard. Each map uses its in-game shot (`public/brand/overdrive/maps/<id>.jpg`) on the map card and the veto; Major tab → Map pool lets you upload another picture per map (and go back to the in-game shot). The drawn artwork in `MapArt.tsx` is the fallback.
- **Season results** per team (Split 1, Split 2, Wildcards) are in `shared/season.ts`: shown in the analyst desk's Head to head panel, and **Fill roads from the season** in the match intro card writes them as the teams' road lines.

- **State lives on this server** and reaches every source over the WebSocket: no sync keys, no localStorage, no polling. It is saved per event in `state.json`.
- **Scores come from the event's Google Sheet** (Tournament → Google Sheet, the same `match_id` block the old overlay read). While the wildcard is on, the sheet is pulled every 30 s. A sheet value only overwrites a match when it changes on the sheet, so manual corrections stay; **Pull from sheet now** overwrites everything. The old "Publish to the web" CSV link also works as the sheet address.
- **Score buttons** (+ / − / WO / Go live / Clear / start time) work as before. **Copy backup / Restore** accepts backups from the old overlay too.
- **Cast match** is shown as "On cast" and is also the scoreboard's featured match.
- **Popups** (map won / match over) are detected once on the server, so every gameplay source shows them together and a reload never replays old results. Test map / Test match / Replay last are in the controller.
- **Countdown** on the waiting screen uses the show countdown (Match → Countdown, or the buttons in the Major tab); with none running it counts down to the match start. **Match time** goes back to the start time.
- **Auto switch** between Part 1 and Part 2 runs on the server, so every source flips at the same moment.

**Player / team card: Major player showcase** (Major tab): the Player / team card screen becomes a full-screen showcase of one Major player at a time (no player cams): team, handle, real name, country, career winnings, age, palmarès and a talking point, with a photo panel. It rotates on the server clock (every source in step), can be limited to one team, and **Show** holds one player. Upload a photo per player in the same card. Profiles are in `shared/major.ts` (Liquipedia, 9 Nov 2026).

With **Use in the program** on, `/output/program` uses the Major graphics on the Bracket screen (full frame, no ticker), Starting soon / BRB / Thanks (up next + countdown in the middle panel, latest result in the bottom bar), the Casters screen (up next card) and the Gameplay screen (popups). Each place has its own switch. `/output/bracket` shows the Major bracket too.

Standalone sources (always available):

| Route | Purpose |
|---|---|
| `/output/wildcard` | Bracket, part on air. `?part=1` / `?part=2` pins a part |
| `/output/wildcard/gameplay` | Map / match popups, top left |
| `/output/wildcard/waiting` | Waiting screen for the Start/BRB/End loop video. Title follows the intermission on air; `?title=none` hides it |
| `/output/wildcard/casters` | Up next card for the casters booth |

`?cast=R2_UB1` pins a cast match on any of them. The OBS Interact button strips (1920×1480 sources) are gone: everything is in the controller, which can be docked in OBS as a Custom Browser Dock.

## Controller layout

The sidebar has three groups: **Show** (Live, Major, Twitch: what you touch during the broadcast), **People** (Casters, Analysts) and **Setup** (Links, Screens, Scoreboard, Music, Players, Run of show, Events, Tournament, Settings: set once). The monitors, screen buttons and scene dock stay at the top of every tab.

**Everything on screen starts off and animates in and out**: the gameplay scoreboard, score strips, next-match counter, up-next card, picks, desk strip and countdown, Twitch card. Turn the scoreboard and next-match counter on in Setup → Scoreboard; the rest from the scene dock. (On the first start after this update, a saved show gets them switched off once.)

**Pick'em**: the picks you enter are kept and scored when each match ends (1 point for the right winner, 3 for the exact score). Show the table on the desk (Desk → Pick'em); the Major tab has the standings and a Reset.

**Champions**: once the Grand final has a winner, **Celebrate → Champions** (scene dock on the bracket and starting/BRB/ending screens) takes over every screen: logo, team, players, the final score and confetti. Switch it off to go back.

## Map veto

A **Map veto** screen: the five maps as cards (their in-game shots, or your uploads), the two teams of the match with the one acting next lit up, "<team> to pick / to ban" and the order of steps along the bottom.

- In the scene dock (Map veto screen) or Major tab → Map veto, press a map to call the next step on it: the card is stamped **BANNED by <team>** (greyed, struck through), **PICKED by <team> · Map N**, or **DECIDER · Map N** (the last map fills in by itself). **Undo last** and **Start over** are there too.
- **Order**: presets (Bo5 pick order A, B, A, B, decider · Bo3 ban, ban, pick, pick, decider · Bo1 four bans and a decider), or set each step (A/B pick or ban, decider). Changing the order starts the veto over; picking another match does too.
- **Team PBs**: in the veto controls, **PBs → <map>** puts up the comparison for that map over the veto (in-game shot, each team's best time and both players' times, the faster one highlighted and the gap); press it again or **Hide** to take it down. It only shows when you ask. The times are built in from the trackmania.io leaderboards of the 2026 Split 3 campaign (`shared/pbs.ts`); teams with no leaderboard times (BIG, FUT Esports, Airwalkers, COOK; Massa has Egypt) show "No PB yet": type their times in Major tab → **Team PBs** (43.512 or 1:02.345); a typed time overrides the leaderboard.
- The Gameplay **Next map** buttons follow the veto: "1. India, 2. Egypt…", bans last.

## Caster camera through VDO.Ninja (inside the caster page)

A caster whose camera source is **VDO.Ninja** (Casters / Analysts / Interview tab → their card → source VDO.Ninja, then TAKE LIVE) keeps using their usual camera link (`/contribute/N?key=…`). Instead of this app's own camera sender, the page loads their normal VDO.Ninja push link (VDO's camera / mic pickers and Start, the show's VDO password, their stream ID) in an embedded player, with the production extras around it:

- the **ON AIR / STANDBY** tally (and a red frame when on air) from the producer;
- **Mute mic**, **Camera off**, **Reconnect** (VDO.Ninja IFRAME API: `mic`, `camera`, `reload`) and **Open in VDO.Ninja** if the browser won't allow the camera inside the page;
- "N receiving" when the program / OBS views connect;
- the game feed and the run of show as before.

**Talent room**: Casters tab → **Talent room (VDO.Ninja)** → New room name, TAKE LIVE. Everyone on VDO.Ninja (casters, analysts, interview guest) joins that room from their own caster page, so they see and hear each other inside the VDO.Ninja box (lighter video between guests, `&roombitrate=500`; their cameras still reach OBS at full quality through their view links), with **Mute room** and a room volume next to Mute mic / Camera off. Headphones recommended.

Every caster page also shows the **match on cast** (teams, live series score) and **everyone's picks** (yours highlighted) at the top.

Switching a caster back to the app's own camera (source WebRTC) brings the normal camera controls back, on the same link.

## Game feed for casters (low-latency stream server)

If you run the low-latency stream server (MediaMTX: OBS → server → casters over WebRTC), the casters can watch it right on their camera page.

1. Controller → Settings → **Game feed for casters**: paste the server's WHEP address (`http://<server>/live-web/whep`), the viewer user (`caster`) and its password, pick a default latency (Ultra 0 ms · Low 80 · Balanced 150 · Smooth 350 ms buffer), tick **Show the game feed**. **Preview the feed here** checks it.
2. Every caster / analyst / interview guest camera page now shows **Live game feed** at the top: latency buttons (keys 1–4), mute (M), fullscreen (F), **Pop out** (`/gamefeed?slot=&key=`, for a second screen), and buffer / fps / Mbps.

**Or VDO.Ninja**: set **Source → VDO.Ninja** and paste a normal VDO.Ninja view link (`https://vdo.ninja/?view=STREAMID`, `&password=…` if it has one, or a room scene link). The caster page loads it in an embedded VDO.Ninja player (clean output) with this app's controls on top, driven by VDO.Ninja's IFRAME API: latency buttons set VDO's buffer live (`setBufferDelay`, 0/80/150/350 ms), mute and volume, fullscreen, pop out, **Reconnect** (reloads the player), and a waiting / ● live status from VDO's connection events. That link goes to the casters' browsers as is (VDO needs it there), so a password in it is visible to them.

How it works (stream server): the caster's browser sends its WebRTC offer to this app (`/gamefeed/whep`), which forwards it to the stream server with the login and returns the answer. So the password stays in this app (never on the caster's page or in a link), and an https caster page works with the http-only stream server (no mixed content, no CORS). The video goes straight from the stream server to the caster: no extra delay. Casters behind strict networks may still need a TURN server on the stream server.

## Interview (online, RLCS style)

A new **Interview** screen and tab (Show → Interview). The player joins on the **guest camera** (slot 6): send them the link on the Interview tab; they open it, pick a camera and press Start, nothing else to install.

- **Player**: pick them from the Major list: the name bar shows handle, real name, team and country, with the team logo, and the team card beside the host shows their career winnings. ("Guest camera name" uses the name typed on their camera card.)
- **Host**: any caster or analyst (their camera sits top right with a name bar), or **Nobody** for the player alone, centred.
- **Title**: Post-match, Pre-match, Champion or Player interview.
- **Question**: type and press Enter, or tap a ready-made one; the banner slides in under the cameras. **On screen** switches the name bar and the question on or off.
- Same controls in the scene dock when the Interview screen is on air. OBS: the Links page has the Interview scene like the others.

## Casters and analysts

Two separate groups, fixed by slot (the role text is only a label):

- **Casters** = slots 1–3, Controller → **Casters** tab. They appear on the Casters screen and the gameplay cams. **On camera**: **All casters**, or click names to pick exactly who's on (max 3).
- **Analysts** = slots 4–5, Controller → **Analysts** tab. They appear on the Pre-show / Analyst desk only. **Analysts**: **All analysts** or pick; **Caster joins**: **Nobody** or one caster, who sits at the desk with them (first camera) and leaves with one click.
- Each person has their own camera link (`/contribute/1` … `/contribute/5`; 6 is the interview guest). The same pickers are in the scene dock on the Casters and Pre-show / Analyst desk screens. All instant (no TAKE).
- A save from the 3-slot version keeps its 3 people as the casters and gains two analyst slots.

## Scene dock (controller)

Under the screen buttons, the controller shows a few big controls for the screen on air (switch to the prepared screen with the tabs when preview differs). The same controls sit under each `?controls` browser source.

- **Match** (every screen): pick the match being cast. That one choice sets everything else: the scoreboard's teams, logos, series score and map number, the bracket's "On cast", the match intro teams with the round name and season road lines, and who the caster picks and the Twitch prediction are about.
- **Score**: − / + per team on the match (first to 3), and **Live**. It updates the bracket, the scoreboard and the popups together.
- **On screen** switches (green = on air): Casters: Teams + score, Up next, Caster picks. Pre-show / Analyst desk: Teams, Countdown, Caster picks. Player / team card: Caster picks. All start off.
- **Countdown**: 2′ 5′ 10′ 15′ and Stop.
- **Twitch**: one button at a time: Start viewer prediction → Lock votes → "<team> won".
- Per screen: Player / team card has ▶ Play intro / Stop and "Show a player" (the two teams' players); Pre-show / Analyst desk has Desk (Cameras, Predictions, Head to head, Player) and Who's on (Caster + analyst, or names); Gameplay has Replay / Highlights and "Show last result again"; Bracket has the part on air and auto switch.

Everything else (first round, start times, popups tests, showcase photos, backups) is in the Major tab ("All settings →").

## Match intro (Major tab)

Pick Team A and Team B (the 8 Major teams), optionally a match label ("Upper bracket quarterfinal") and each team's road so far, then **Play intro**: the program cuts to the Player / team card screen and plays a VS screen (8 s), each of the 4 players in the showcase style, then holds the VS screen. Once two teams are picked, the VS screen is the Player / team card's resting state: Play runs the players from it and returns to it, and Stop stays on it (switch “When not playing” to Player rotation for the showcase instead). Needs "Player / team card: Major player showcase" on.

## Caster predictions

You enter the picks: once a match is picked, the scene dock shows a **Picks** row per person on that screen (Casters screen: the casters on camera; Pre-show / Analyst desk: the people at the desk; Player / team card: everyone). Tap their team, then the score (3–0 / 3–1 / 3–2); tap the team again to clear. They can also be set in the Major tab → Match intro. The **Picks** switch under On screen shows or hides them. On stream: a badge in the corner of each person's camera, an "Our casters predict" row on the VS screen, and the Predictions panel on the analyst desk. Picks clear when the teams change.

## Analyst desk (screen)

A screen of its own (Analyst desk, `/output/screen/analysis`): 1, 2 or 3 analyst cameras on the left (one large, two stacked, or a column of three) and a large panel on the right. Choose who sits at the desk with the **On desk** buttons in the scene dock; with none chosen it takes casters whose role contains "analyst", otherwise whoever is on screen (up to three). Its scene dock has the same controls as the Casters screen (scoreboard, caster predictions, countdown, Twitch prediction) plus **On desk** and **Desk shows**. **Pre-show:** with nobody chosen, the desk shows one caster (the first one whose role isn't Analyst, e.g. Play-by-play) next to the analyst, the match-intro teams, and "Starts in mm:ss" when the countdown runs; the **Pre-show** button sets exactly that pair, **Auto** goes back to the default. Any caster can join the desk: click their name under **On desk** (up to three; the same camera feed is used on both screens). By default (**Desk** in the scene dock) it uses the skin's own "Analyst desk" frames, built like the Casters booth: the cameras side by side in frames with name bars, each analyst's pick in the corner of their camera, and the match-intro teams (Team A vs Team B) in a strip. The other choices put a data panel beside smaller cameras: **Predictions**, **Head to head** (the intro teams: qualification, players, combined career winnings, listed titles, best big-stage result) or **Player** in focus. Uses the "Caster desk" music bed.

## Control strips under OBS sources

Quickest way: Controller → **Links**. Every scene has its own row: **Open** (that scene with its controls, in a new browser tab), **OBS + controls** (copy the same link for a 1920 × 1480 OBS source) and **Clean** (picture only, 1920 × 1080). "Single overlays" lists the other outputs.

In Controller → Settings → OBS browser sources, switch on "With controls underneath": the listed addresses get `&controls&token=…`. Make the OBS browser source **1920 × 1480** and set **Crop Bottom 400**: the top 1080 is the picture, the 400 below hold the controls for that screen (the same as the controller's scene dock; `/output/program` also gets a row of screen buttons). Click them with right-click → **Interact**. The token is the control-API token, so keep these addresses to your own OBS.

## Twitch predictions & polls (Twitch tab)

Shows the channel's current prediction or poll on stream, live (bars, percentages, time left; the result stays 20 s), on the screens you pick: Gameplay, Casters, Player / team card, Starting/BRB/Thanks, or `/output/twitch` on its own. Start a "Who wins?" prediction (outcomes come from the match intro teams), lock it and pick the winner from the controller; polls the same way. Predictions and polls started on Twitch itself show too.

One-time setup: dev.twitch.tv/console/apps → Register Your Application → OAuth Redirect URL `http://localhost`, Client Type **Public** → paste the Client ID in the Twitch tab → Connect → enter the code shown at twitch.tv/activate with the broadcaster's account. No secret is needed; tokens stay in `data/state.json`. Predictions and polls need an Affiliate or Partner channel. `TWITCH_CLIENT_ID` can also be set in `settings.bat`.

## Control API (Stream Deck / Bitfocus Companion)

`GET` or `POST` `http://host:8787/api/v1/…`, authenticated with `?token=…` or `Authorization: Bearer …`. The token is in Controller → Show graphics → Integrations.

| Endpoint | Action |
|---|---|
| `/state` | JSON state for button feedback (screen, casters, match, timer, presets, OBS) |
| `/take` | TAKE LIVE |
| `/screen/(casters\|starting\|brb\|ending\|bracket\|matches)` | Go to screen (add `?preview=1` to only cue it) |
| `/preset/<id or name>` | Recall preset and take (add `?preview=1` to stage it) |
| `/layout/(auto\|solo\|duo\|trio\|mixed\|audio)` | Layout (preview; `?take=1` to air) |
| `/caster/1-3/(camera\|name\|enabled)/(on\|off\|toggle)` | Caster toggles (preview; `?take=1` to air) |
| `/names/(on\|off\|toggle)` · `/branding/…` | Global nameplates / branding |
| `/score/(a\|b)/(inc\|dec\|set)/[n]` · `/scores/reset` · `/swap` · `/game/<n>` | Scores (instant) |
| `/timer/start/<min>` · `/timer/add/<min>` · `/timer/stop` | Countdown (instant) |
| `/instant/(on\|off\|toggle)` | Instant mode |
| `/obs/scene/<name>` | Switch OBS scene |
| `/tournament` | Bracket JSON (matches, upcoming, results, champion) |
| `/match/<id>/score/<a>/<b>` · `/match/<id>/status/(upcoming\|live\|done)` · `/feature/<id\|none>` | Bracket results |
| `/wildcard/part/(1\|2\|toggle)` · `/wildcard/auto/(on\|off\|toggle)` · `/wildcard/cast/<R1_UB2…\|none>` · `/wildcard/pull` · `/wildcard/popup/(map\|match\|replay)` | Wildcard bracket |

Match ids look like `UB-1-0` (upper round 1, first match), `LB-2-1` and `GF-1`.

## Remote cameras (WebRTC)

1. In the controller, set the caster's source to **Remote** and send them their **camera link** privately.
2. The caster opens it, chooses a camera, a resolution and (optionally) a microphone, and clicks **Start camera**. Their page shows an **ON AIR** light whenever their camera is on air.
3. **New link (revoke old)** creates a new link and immediately disconnects the device using the old one.

How it works:
- The WebSocket server carries the signaling. Each viewer, meaning an OBS output or the controller monitors, gets its own peer connection from the caster's browser. OBS outputs receive up to 3 Mbps. The controller monitors receive a smaller ~350 kbps version, so watching from the dashboard costs the caster very little upload.
- Connections belong to the page, not to the camera tiles. Toggling a camera or changing layout doesn't reconnect anything, and a caster who is no longer needed is only dropped after 20 s.
- Everything reconnects by itself: the WebSocket retries with backoff, and both sides rebuild a failed connection. Switching camera on the caster's side happens without interrupting the stream.
- **Audio is never mixed.** Camera tiles are always muted. A caster's mic only travels to `/output/audio/N`. Add that as its own browser source with *Control audio via OBS* and mix it in OBS.
- **TURN.** For casters behind strict NAT, run coturn with `use-auth-secret` and set `TURN_URLS` and `TURN_SECRET`. The server then gives each client credentials that expire after 12 h, so the secret never reaches a browser.
- Browsers only allow camera access on **HTTPS** (or localhost). For remote casters, put the server behind a TLS reverse proxy (Caddy, nginx) and set `SECURE_COOKIES=1`.
- Each caster uploads one stream per receiving source. With only a few OBS sources per caster this is fine. If one caster's camera has to feed many outputs, move to an SFU such as LiveKit or mediasoup; the viewer and publisher code (`src/lib/rtc*.ts`) is where it would plug in.

## Suggested OBS setup

- **Simplest:** one scene containing `/output/program`, plus `/output/scoreboard` and `/output/ticker` on your gameplay scene. Everything else is driven from the controller.
- **One scene per screen:** use `/output/starting`, `/output/brb`, `/output/ending`, `/output/casters`, `/output/bracket` and so on in their own OBS scenes. Then map each screen to its scene in Integrations so GO / TAKE switches OBS too.
- **Audio:** add each remote caster's `/output/audio/N` as its own source.

## OBS WebSocket (optional)

Set `OBS_WS_URL=ws://127.0.0.1:4455` and `OBS_WS_PASSWORD=…` on the server. The credentials never reach the browser. You then get:
- **Scene switching** from the controller's OBS panel.
- **Local OBS cameras** (capture cards, NDI or SRT inputs). Set a caster's source to **OBS** and enter its scene and source name. On each TAKE, the server shows or hides that source and moves and crops it to its tile, scaled to the OBS canvas. Put the camera source **below** the `/output/casters` browser source, which draws the frame and nameplate over it. The browser never tries to display the OBS source itself.

## Branding

Overdrive's full graphics package lives in `public/brand/overdrive/`: the animated loops, caster booth/desk frames, stinger, replay/highlight overlays, and the starting/BRB/ending plates, all wired up in `shared/skins.ts`. `logo.png` and `mark.png` there are also used as the app's own fallback logo (`src/components/Brand.tsx`) for any event with no brand kit of its own. Logos are only ever sized by height, so their proportions are preserved.

## Project layout

```
shared/   types, layout engine (compose), defaults/validation, WS protocol — used by server and browser
server/   Express + ws: auth (producer/admin roles), store, hub (state sync + WebRTC signaling), control API + uploads, TURN creds, OBS bridge
shared/tournament.ts  bracket engine: seeding, single/double elimination, byes, GF reset, derived results
src/      React + Vite + Tailwind + Motion
  components/  Stage (1920×1080 composition), Nameplate, IdentityCard, Feed, Brand
  components/show/  Program + stinger, Screens (starting/brb/ending), Bracket + Matches board, Scoreboard, Ticker, parts
  pages/       Output routes, Contribute (camera link), controller/ (dashboard, show panels, login), admin/ (tournament)
  lib/         self-healing socket, RtcViewer, RtcPublisher
```

## Reliability notes

- State is written to disk atomically (temp file + rename). A corrupt state file is set aside, and the server starts clean instead of failing to boot.
- Outputs keep showing the last live scene through any disconnect. The server pings every 10 s and drops dead connections.
- Every scene coming from the controller is validated on the server. Controller rights need a valid session cookie and a same-origin page, and logins are rate-limited.

## OBS dock

`/controller/dock` is a compact controller for OBS: screen buttons (one click cuts to air), the controls for the screen on air, and the run of show.
OBS → **Docks → Custom Browser Docks…** → name `OverDrive`, URL `http://localhost:<port>/controller/dock` → Apply. Sign in once inside the dock with the producer password.

`/controller/dock/all` is the everything dock: match, score, countdown, Twitch and Champions pinned at the top, then every scene with its own GO button and controls (the one on air is outlined red).

## Music per scene

Every scene has its own music folder (`data/music/<scene>`: starting, casters, analysis, interview, veto, warmup, gameplay, brb, bracket, matches, ending) and its own level. Level **Off** = silent; Gameplay starts Off. Tracks from the old shared folders (`desk`, `results`) keep playing for their scenes until you add tracks of their own. Upload in the **Music** tab; on/off, level and skip are also in each scene's block in the OBS docks.

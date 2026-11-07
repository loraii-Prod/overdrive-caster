# GLACIAL — Broadcast Caster System

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
docker build -t glacial-caster .
docker run -p 8787:8787 -v glacial-data:/data -e CONTROLLER_PASSWORD=… glacial-caster
```

## Routes

| Route | Purpose |
|---|---|
| `/controller` | Producer dashboard (login required) |
| `/output/casters` | Main caster composition (cameras, cards, nameplates, branding) |
| `/output/solo` · `/output/duo` · `/output/trio` | Same scene, capped at 1 / 2 / 3 tiles. These always adapt down and never show an empty box |
| `/output/names` | Nameplates only, transparent, in the same positions as `/output/casters` |
| `/output/branding` | Glacial branding only, transparent |
| `/output/audio/1..3` | A remote caster's microphone only, for mixing in OBS |
| `/output/program` | **The whole show in one source.** Shows whichever screen is live (Casters, Starting soon, BRB, Thanks for watching, Bracket, Matches), with a Glacial stinger between screens |
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
- **Layouts.** Auto picks Solo, Duo or Trio from the number of active casters. You can also force Solo, Duo or Trio. Mixed shows cameras where they're on and branded cards elsewhere. Audio shows identity cards only, over an animated Glacial background.
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

The files in `public/brand/` are vector traces of the supplied Glacial artwork:
- `glacial-logo.svg`: the mark with the GLACIAL wordmark
- `glacial-mark.svg`: the circuit-and-mountain mark only
- `glacial-pattern.svg`: a seamless pattern tile built from the mark

You can swap in official master files with the same names. Logos are only ever sized by height, so their proportions are preserved. The colors match the supplied artwork: background #161616, pattern #454545, white #EFEFEF.

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

# Overdrive — OBS Custom Browser Docks (setup guide)

This turns every Overdrive Studio scene control into its own panel docked inside OBS Studio's own
window, so a producer or operator can run the whole show without ever leaving OBS.

## What you get

- One **Custom Browser Dock** per managed OBS scene/source (Starting Soon, Caster Desk, Analyst Desk,
  Team Introduction, Player MVP, Map Veto, Gameplay, Bracket, Matches, Intermission, Be Right Back,
  Thanks for Watching) plus a **Follow OBS** dock that always shows whichever scene OBS currently has
  in Preview/Program, without ever switching OBS itself.
- Each dock is the exact same controls as that scene's module panel in the normal Studio/Producer
  console — nothing new, nothing duplicated — just resized and stripped of chrome that doesn't apply
  inside a narrow OBS panel (library list, health indicator, MVP side panel, room button).
- The **Show Screens** mode switcher (Starting Soon · Be Right Back · Intermission · Thanks for
  Watching) is built into those docks too: prepare a mode in Preview, then CUT / AUTO / TAKE it to
  Program, exactly like the main console.
- Everything stays live-synced through the same WebSocket connection Studio and the Producer console
  already use — a change in a dock shows up everywhere else instantly, and vice versa.

## 1. Generate the dock list and installer scripts

1. Open **Studio → OBS Setup** (the Scene Builder).
2. Connect to OBS (Tools → WebSocket Server Settings in OBS first, if you haven't already).
3. Scan, then click **Docks…**. You'll see the full list of dock URLs, one per managed scene, plus
   **Copy** buttons for each individual URL and a **Download installer** option.

## 2. Install the docks into OBS

Two ways to do this — pick whichever you're comfortable with. **Either way, close OBS first**: OBS
only reads its dock list from its config files at startup, and rewrites that file when it exits, so
installing while OBS is running will silently get overwritten.

### Automatic (recommended)

1. Quit OBS completely.
2. Run the installer Studio generated for your OS:
   - Windows: the `.ps1` script (right-click → Run with PowerShell, or `powershell -File install-docks.ps1`).
   - macOS/Linux: the `.sh` script (`bash install-docks.sh`).
3. The script backs up your existing OBS config, then merges the Overdrive dock entries into OBS's
   `global.ini`/`user.ini` `ExtraBrowserDocks` list — it never removes or overwrites dock entries you
   already had from something else.
4. Start OBS. The docks appear under **View → Docks** (and as new panels you can drag/dock anywhere),
   already named "Overdrive · <scene name>".

This is genuinely automatic — the script writes real config, not just a reminder. It is **not** a live
OBS WebSocket action: no `obs-websocket` request exists to register a dock while OBS is running, which
is exactly why the script edits the config file directly and needs OBS closed first.

### Manual (if you'd rather not run a script, or the automatic install didn't apply)

1. In OBS: **View → Docks → Custom Browser Docks…**
2. For each scene you want, click **+**, paste in that scene's dock URL (copied from the Docks dialog
   in Studio), give it a name, and click OK.
3. Repeat for as many of the scenes as you want docked. You don't have to add all of them — only the
   ones you want direct OBS access to.

## 3. Arrange and resize

- Drag each new dock to wherever you want in OBS's layout (side panel, bottom, floating, a second
  monitor).
- Docks are built to work narrow — collapse them down to a sidebar width and the controls will still
  be usable (compact labels, no horizontal scrolling for the core buttons). Very short/narrow docks may
  need to scroll for a scene with a lot of controls; the primary Preview/CUT/AUTO/TAKE controls are
  always at the top.
- Each dock shows a red **"Controller of one OBS scene"** badge so it's never mistaken for something
  that's on air — docks are control surfaces only, never a broadcast source themselves.

## 4. Using the docks on air

- Every dock shows live Preview/Program status for its scene, so you always know what's armed and
  what's live before you touch anything.
- **TAKE** (and CUT/AUTO where available) only ever move Program — nothing in a dock can accidentally
  change what's on air by just opening or looking at it.
- MVP reveals and other on-air-sensitive actions still ask for confirmation from inside a dock, exactly
  as they do in the main console.
- If OBS reconnects (network hiccup, OBS restart), the dock reconnects on its own — no need to reopen
  it manually.
- Multiple docks, multiple operators, and the main Producer console can all be open at once safely —
  they share state through the server, not through each other's browser storage, so one operator's
  dock never clobbers another's.

## Notes / known limits

- A dock's **initial** scene is fixed to the URL you installed it from. For the Show Screens modes
  specifically, the "Be Right Back" mode doesn't have its own separate dock URL in the Docks list today
  — open the **Starting Soon**, **Intermission**, or **Thanks for Watching** dock instead; its built-in
  mode switcher includes all four Show Screens modes, "Be Right Back" included, so you can prepare and
  TAKE it from there. This doesn't block anything — it's just that the Docks list doesn't yet have a
  fifth, separate catalog entry purely for that one mode.
- Docks are control UI only: opening one does not create any extra camera connection, extra microphone,
  or extra graphics renderer in OBS — they add no GPU load beyond a normal browser panel.
- Existing Studio pages (the full console, Studio Mode, mobile) keep working exactly as before; nothing
  about dock support changes them.

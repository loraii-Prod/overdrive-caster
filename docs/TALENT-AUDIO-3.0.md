# Talent Manager, talent audio and Broadcast Health (3.0)

Studio → **Talent** (Roster · Layouts & positions · Green Room · Audio), Studio → **Health**, and in Producer Mode the
**Talent** tab next to Rundown plus the **Health** indicator in the header.

## Add a caster (the 30-second path)

1. Studio → Talent → **Add talent**.
2. Type the name (the role defaults to Caster: Analyst / Host / Guest are one click).
3. Paste their VDO.Ninja link. The form reads it as you paste:
   - `push=` / `view=` links and bare stream IDs are accepted;
   - director links, room links without a stream and scene links are refused, with the reason;
   - a link's own password is ignored (the show's VDO.Ninja password and room apply), and the form says so.
4. Their camera appears in the private preview (it loads their VDO.Ninja stream directly at low bitrate).
5. The first free position for the role is already selected. Click another slot to change it, or click the selected
   slot again to save them without a position.
6. **Save** (or Enter). One command creates the profile, sets the stream and seats them. Every source that shows
   that position updates at once.

Without VDO.Ninja, choose **Overdrive link**: they get a personal link (camera + mic in the browser). Copy it from
their card. Their page has **Send my mic** off by default: the Green Room flags "link sends no microphone" until they
tick it, or until you set their voice to another source.

Profiles are kept for future events. t1–t10 always exist, because their links may already have been sent. Add Talent
reuses an unused profile first and creates new ones up to 24. **Remove** clears a profile and revokes its link at once.

## Profile (click a card)

Name, role, position (choosing a taken position swaps the two people), picture (upload or address), camera (VDO.Ninja
link or Overdrive link, 720p / 1080p, copy their push link), **framing** (zoom and pan, applied to every tile that
shows them on every desk), **audio** (below), notes (never on air), and the list of current problems with their fix.

## Layouts & positions

The Caster desk, the Analyst desk and the Interview position, drawn the way their graphics place people:

- **Caster desk:** the people in positions 1–3, left to right, in position order. Auto / Solo / Duo / Trio.
- **Analyst desk:** positions 4 and 5. **Desk with host** brings one caster-desk position in as the third voice. The
  approved desk has two analyst cameras plus one joining position: that is the "analyst trio".
- Drag a person from the list onto a slot, or pick them from the slot's list. Assigning someone already in another
  position swaps the two. The **Swap** buttons exchange neighbours.
- Assigning and swapping people is immediate. Nobody reconnects: their camera and voice are re-routed on the server.
- Layout changes (solo / duo / trio, host) are **prepared**. The desk shows "prepared, not published" until
  **Publish layout**, or the global Publish.

## Green Room

Every person's camera (seated: through their position; not seated: their VDO.Ninja stream directly), connection,
voice level, voice path, sync offset, OBS input state, problems and a **Mark ready** button.

These previews exist only in this console, as low-bitrate monitor feeds. They never reach Preview or Program.

Limit: someone on an Overdrive link who is not in a position cannot be previewed. The app camera relay works per
position. Their connection and microphone state are still shown.

## Talent audio

Each voice has one path into OBS that never reloads when scenes change:

| Voice from | OBS input | Notes |
|---|---|---|
| Camera link (default) | `Overdrive Caster N audio`, the position's browser source in the shared "Overdrive · Caster audio" scene (Scene Builder) | VDO.Ninja audio or the Overdrive link's mic |
| OBS input | any existing OBS input: Discord / desktop capture, a microphone, an audio interface or mixer channel | their camera-link audio is then silenced |
| None | — | video only |

Overdrive controls these through OBS WebSocket:

- the fader (dB), mute, sync offset (ms) and monitoring (OBS "Monitor and Output") of each person's input;
- **master talent mute** (Studio, Producer);
- empty positions are silenced;
- someone not in a position has their OBS input muted, so off-air chatter never reaches the stream;
- level meters per person (OBS `InputVolumeMeters`, 10 per second);
- the voice follows the person when they move to another position.

What Overdrive checks and reports:

- an input that does not exist in OBS;
- a voice heard twice;
- a mute or fader changed by hand in OBS. Overdrive leaves it alone until you press **Apply to OBS**;
- echo risk: monitoring a desktop or application capture;
- one input shared by several people (their faders are linked);
- 30 s of silence on a live voice;
- OBS offline.

**Not available, on purpose:** there is no routing matrix. OBS has no talkback / caster-return bus, and Overdrive does
not pretend to control one. Stream, recording and monitoring tracks are OBS's own mixer and output settings. Use
Discord or VDO.Ninja for talkback and keep that out of OBS.

### OBS setup for talent audio

1. Studio → **Sources & OBS** → Scene Builder → **Build** (or Repair). This creates "Overdrive · Caster audio" with
   `Overdrive Caster 1…6 audio` (browser sources, *Control audio via OBS* on) and nests it once in every Overdrive scene.
2. For a Discord or desktop capture, a mic or a mixer channel: add it in OBS as usual, give it a clear name, then pick
   it in the person's profile → Audio → *OBS input*.
3. Turn off OBS monitoring on desktop / application captures you do not need to hear. Overdrive warns about the echo
   risk.

## Broadcast Health (Studio → Health, Producer header)

Every item reports one of: OK, Check, Problem, or Off (not used, never an alarm). Each item comes with a recovery
action or the place that fixes it.

- **Server link:** this console's connection and round trip.
- **OBS:** connection, Studio Mode / Program, the Scene Builder's verify results, and any Overdrive control page loaded
  inside OBS.
- **Graphics:** renderer errors (action: reload sources), and graphics placed in an OBS scene with no browser source
  connected.
- **Cameras and talent audio:** the same checks as the Talent Manager. Actions: Green Room, Apply audio settings,
  Unmute talent.
- **Media:** playing with no media source connected.
- **Voting service:** online, offline, or not configured. Local production never depends on it.
- **OBS performance:** frame rate, render time, skipped frames, CPU. Shown when the performance monitor is on.
- **Automation:** held, or waiting for GO.

The **pre-show checklist** covers:

- event;
- OBS connected;
- scenes built;
- talent audio sources;
- talent in position, named, cameras connected;
- every voice reaching OBS once;
- talent ready;
- graphics without errors;
- optional: rundown prepared, nothing left unpublished, voting service online.

Each line opens the place that fixes it.

## Engine commands (HTTP control API / Stream Deck / Companion)

```
{"c":"talent-add","name":"Kenji Watanabe","role":"caster","vdo":"https://vdo.ninja/?push=kenji01","seat":1}
{"c":"talent-edit","id":"t3","audio":{"muted":true}}
{"c":"talent-edit","id":"t3","audio":{"source":"obs","input":"Discord","volumeDb":-4,"syncMs":120,"monitor":false}}
{"c":"talent-edit","id":"t3","crop":{"zoom":1.3,"x":10,"y":-5},"ready":true,"role":"host","photo":"/uploads/x.png"}
{"c":"talent-remove","id":"t12"}
{"c":"audio-master","muted":true}
{"c":"audio-apply"}
{"c":"seat","seat":2,"talent":"t3"}
```

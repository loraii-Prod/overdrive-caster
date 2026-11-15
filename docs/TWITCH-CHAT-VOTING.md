# Twitch chat MVP voting

Viewers vote for the Community MVP in Twitch chat with `!vote 1` to `!vote 4` (the numbers on the voting cards). The
broadcast server reads the chat, applies the rules below and stores the votes in the vote service database, next to the
website votes. Totals, the frozen result and the 4K reveal graphics are the same ones the QR/website voting uses.

## How it works

- **Reading chat.** The broadcast server uses Twitch EventSub `channel.chat.message` (version 1) over Twitch's
  EventSub WebSocket (`wss://eventsub.wss.twitch.tv/ws`). It reads chat **as your own account or a bot account**.
- **Permissions.** That account signs in once with the Device Code flow (enter a code at twitch.tv/activate). The
  only permission requested is `user:read:chat`. For a WebSocket subscription Twitch asks for this scope from the
  reading account and nothing from the channel. The event channel's owner signs nothing and gives no password or
  token. (`channel:bot` from the broadcaster, or moderator status, is only needed for webhook/conduit transports, which
  Overdrive does not use.)
- **Target channel.** You only enter its name (for example `overdrive_tm`, or a twitch.tv link). Overdrive looks up
  its ID with Helix `GET /users`, which needs no permission from the channel.
- **Tokens stay on the server.** They are kept in `state.json` on the broadcast server (`twitchChat`). They are never
  sent to a browser: not to the producer, not to OBS browser sources, not to the public vote page. Producer Mode gets
  a status without tokens.
- **Twitch's rules followed.** The subscription is created within 10 s of the welcome message. Silence longer than
  the keepalive window counts as a lost connection, so Overdrive reconnects and subscribes again. On
  `session_reconnect` it moves to the given URL and keeps the old socket until the new one says welcome.
  `revocation` stops listening and asks for a new sign-in. The token is checked every hour and refreshed on 401.
  Messages sent while Overdrive was disconnected are not replayed by Twitch.

## Rules (deduplication policy)

| Message | Result |
|---|---|
| `!vote 2`, `!VOTE 2`, `!vote #2`, `!vote 2 gogo` | vote for card 02 |
| `!vote`, `!vote 0`, `!vote 5` (with 4 cards), `!vote two` | **invalid**, ignored. The account can still vote |
| any other chat | ignored silently |
| the same message delivered twice (same message ID) | counted once |
| a second vote from the same Twitch account | **ignored**. The first vote counts (no changing your vote, same as the website) |
| a message sent before voting opens, after it closes, or after the countdown ends | not counted |
| a Twitch Shared Chat message from another channel | ignored, unless “Count Shared Chat” is on |

**One vote per Twitch account per MVP vote, whichever way it arrives.** The website signs viewers in with Twitch
too. Twitch confirms the user ID at sign-in, and chat events carry the Twitch user ID, so both land on the same
`viewers.twitch_id`. The primary key of `mvp_votes (poll, viewer)` then allows one vote per account across chat
and website. A website vote blocks a chat vote from the same account, and the other way round. This is checked by
the database, not only in memory.

This is **one vote per Twitch account, not per person.** Someone with two Twitch accounts can vote twice. Overdrive
does not and cannot claim one person, one vote.

## Ways to vote

Producer → MVP module → Twitch chat voting → **Ways to vote**:

- **Twitch chat + website** (default). The QR box on the voting graphic adds “or type !vote 1–4 in chat”.
- **Twitch chat only.** The QR box becomes the chat box (`!vote 1–4` and the channel). The website refuses MVP
  votes and tells viewers to vote in chat.
- **Website only (QR).** Chat is ignored for MVP votes.

Each vote remembers its ways when it opens. Changing them while a vote is open updates that vote at once.

## Producer Mode

Twitch chat voting has a panel inside the Community MVP module, and the MVP scene controls show a compact status
line. The panel shows:

- **Connection:** not signed in / listening / reconnecting / authorization needed (with the exact reason and what to
  do) / problem. It also shows the channel and the reading account.
- **Live while voting:** chat votes and website votes, counted / already voted / invalid / duplicates / not open,
  votes still being sent, and when the last message arrived.
- **Activity:** the latest commands with their result.
- **Settings** (they open by themselves when something needs doing): sign-in, Client ID, channel, command, ways to
  vote, listening on/off, Count Shared Chat.

Opening and closing voting are the existing **Open voting / Close voting** buttons (and the automation steps). Votes
typed just before the close are sent first, then the result is frozen. If the vote service is unreachable, chat votes
wait in a queue (up to 50 000) and are retried. They are sent before a close.

## Test on your own channel first

1. **Twitch app.** dev.twitch.tv → Your Console → Applications → Register. Client Type **Public**, OAuth Redirect
   URL `http://localhost`. Copy the Client ID. The app used for predictions works too. `TWITCH_CLIENT_ID` is used
   automatically when it is set.
2. Producer → select a Community MVP scene or graphic → **Twitch chat voting** → Twitch app: paste the Client ID →
   **Save**.
3. **Sign in with Twitch.** Open the link shown, enter the code and sign in as **your account** (or a bot account).
4. **Channel:** your own channel → **Use channel**. The status turns to *Listening to chat*.
5. Prepare and open an MVP vote. In your channel's chat, type `!vote 1`, then `!vote 2` from the same account
   (*Already voted*), then `!vote 9` (*Invalid vote*). Watch the activity list and the totals.
6. Close voting. The frozen result includes the chat votes. Reveal with the existing MVP graphics.

## The event's channel

Change **Channel** to the event's channel and press **Use channel**. That is all: same sign-in, nothing from the
channel's owner. If Twitch refuses (the account is banned or timed out there, or the sign-in lost its permission),
the panel says **Authorization needed** with the reason. It does not retry in a loop.

## Limits and notes

- Viewers see four numbered cards. Chat accepts `!vote 1` to `!vote 4` (fewer when fewer candidates).
- If Overdrive is not connected while voting is open, chat votes typed during that time are missed (Twitch does not
  replay them). Producer Mode shows a warning when voting is open in chat and Overdrive is not listening.
- Twitch allows at most 3 WebSocket connections per account and Client ID. Close other tools signed in as the same
  account if Twitch answers “too many”.
- Tested here against a local mock of Twitch's OAuth, Helix and EventSub WebSocket (`tests/mockTwitch.ts`) and a real
  PostgreSQL 16 database. It has **not** been tested against the live Twitch service from this environment. Run the
  “own channel” steps above before the event.

## Files

- `shared/twitchChat.ts`: command parsing, the fast gate, policy text, types.
- `server/twitchChat.ts`: sign-in, channel lookup, EventSub WebSocket.
- `server/chatVoting.ts`: queue to the vote service, counters, activity.
- `vote/chatVotes.ts`: storage. The vote service gains `/internal/poll/:id/chat-votes` and `/internal/poll/:id/methods`,
  and the columns `mvp_votes.source`, `polls.web`, `polls.chat`, `polls.chat_cmd` and `polls.chat_channel`
  (added automatically).
- Tests: `tests/twitchChat.test.ts` (mock Twitch), `tests/chatVotes.pg.test.ts` (PostgreSQL, set `PGTEST`).

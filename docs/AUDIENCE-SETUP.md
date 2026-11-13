# Audience interaction (Pick'ems + Community MVP): setup

Two Render services from the same repository:

| Service | What it is | Start command |
| --- | --- | --- |
| `overdrive-caster` (exists) | Broadcast server: Producer, Studio, graphics, OBS | `npm start` |
| `overdrive-vote` (new) | Public voting page + vote API | `npm run start:vote` |

Plus one new **Render Postgres** database. Votes live only there, so they survive redeploys of either service. Use a paid instance: the free tier deletes the database after 30 days.

Nothing below has been done on Render yet. Each step needs the owner's go-ahead.

## 1. Database

1. In the Render dashboard, choose New → Postgres.
2. Use the name `overdrive-vote-db`, the region Frankfurt (same as `overdrive-caster`), and a paid instance type.
3. Copy its **Internal Database URL**.

## 2. Vote service

1. Choose New → Web Service.
2. Use the same repository and branch as `overdrive-caster`, and the region Frankfurt.
3. Set the build command to `npm run build` and the start command to `npm run start:vote`.
4. Set the instance type to Starter or above. Private networking needs a paid instance.
5. Set these environment variables:
   - `DATABASE_URL`: the Internal Database URL from step 1.
   - `VOTE_SECRET`: 32+ random characters. It is shared with the broadcast server; never put it in a page.
   - `TWITCH_CLIENT_ID`: the Client ID of the existing Overdrive Twitch app.
   - `PUBLIC_URL`: `https://overdrive-vote.onrender.com`.
   - Optional: `VOTE_IP_LIMIT`, the number of writes a minute allowed per IP address (default 1200; venues and mobile carriers share addresses).
   - Never set `VOTE_DEV_LOGIN` on Render. It is refused there anyway.
6. Set the health check path to `/healthz`.

## 3. Twitch app

1. Open dev.twitch.tv/console/apps and edit the existing Overdrive app.
2. Under OAuth Redirect URLs, add `https://overdrive-vote.onrender.com/auth/callback` and keep `http://localhost`.

Sign-in uses the implicit grant: no client secret is needed. The vote service checks the token with Twitch, keeps only the Twitch id and display name, and revokes the token straight away.

## 4. Broadcast server

Add these environment variables to `overdrive-caster`:

| Variable | Value |
| --- | --- |
| `VOTE_URL` | The vote service's **internal** address from its Connect → Internal tab, e.g. `http://overdrive-vote:10000` |
| `VOTE_SECRET` | The same value as on the vote service |
| `VOTE_PUBLIC_URL` | `https://overdrive-vote.onrender.com/vote` (what QR codes point to) |

Without these, the broadcast server runs exactly as before. The Pick'ems, MVP and QR modules say "Vote service not configured".

## 5. Check before going live

- `https://overdrive-vote.onrender.com/healthz` answers `{"ok":true}`.
- The Producer modules show **● Vote service online**.
- The voting page lists the matches whose two teams are set in the bracket.
- A test account can sign in with Twitch and make a pick.

## How it behaves on air

- **Picks lock** when a match starts, and the producer can lock them earlier.
- **Community splits** become public, on the voting page too, only when the producer publishes the Community step of the Pick'ems graphic. After that, the match is final.
- **MVP:**
  1. Prepare: the eligible players come from the verified rosters.
  2. Open.
  3. Close: the result is frozen in the same database transaction that stops voting. Nothing shows on air.
  4. Publishing the Winner step reveals it, on air and on the page.
- **If the vote service is down:**
  - graphics keep the last confirmed results;
  - Producer shows "Voting offline";
  - the winner steps work only from a result that was already frozen.

## Tests

Run `npm run build`, then:

```
python3 e2e-rig/audience/aud_e2e.py   # needs Postgres on 127.0.0.1:5433 (user vote, db vote) and the seed state /tmp/oddata-vq
```

It covers:

- the 11-step workflow;
- invalid votes, duplicate votes, 200 simultaneous voters and the per-account limit;
- QR decoding at 1080p and 720p;
- a vote-service outage and reconnect;
- restarts of both services.

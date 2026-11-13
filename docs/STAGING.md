# Staging: real Cloudflare R2 + Postgres + Render redeploys, before production

Goal: prove on the real infrastructure that portraits, logos, media, music, graphics config, talent assignments,
show state and audience votes survive real redeploys, and that OBS browser sources behave during a long session.
Production (`overdrive-caster`, 2.2.4) is not touched by any step here.

## What to create (needs your approval: these are paid resources)

| Resource | Settings |
| --- | --- |
| Web service `overdrive-caster-staging` | Repo `loraii-Prod/overdrive-caster`, branch **`audience`**, Frankfurt, Starter (paid: SSH + no spin-down, same as production). Build `npm run build`, start `npm start`, health check `/api/health`. **Auto-Deploy: Off.** |
| Web service `overdrive-vote-staging` | Same repo and branch, Frankfurt, Starter. Build `npm run build`, start `npm run start:vote`, health check `/healthz`. **Auto-Deploy: Off.** |
| Postgres `overdrive-staging-db` | Frankfurt, smallest paid plan (free instances expire after 30 days). Then two databases on it: `create database od_state;` and `create database od_vote;` (psql with the external URL). Production keeps the vote DB separate, as approved. |
| R2 bucket `overdrive-assets-staging` | Private (no public access, no r2.dev URL). Its own API token: **Object Read & Write**, scoped to this bucket only. Never reuse the production token. |

I can create the two services and the database with the Render tools once you approve. Env values with secrets are
yours to paste in the Render dashboard; I never see them.

## Environment

`overdrive-caster-staging`:

| Key | Value |
| --- | --- |
| `CONTROLLER_PASSWORD`, `ADMIN_PASSWORD` | new staging-only passwords |
| `R2_ACCOUNT_ID`, `R2_BUCKET=overdrive-assets-staging`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | staging token |
| `STATE_DATABASE_URL` | internal URL of `od_state` |
| `STATE_SNAPSHOT_KEY` | long random string (password manager) |
| `VOTE_URL` | internal URL of the vote service, e.g. `http://overdrive-vote-staging:10000` |
| `VOTE_PUBLIC_URL` | `https://overdrive-vote-staging.onrender.com` |
| `VOTE_SECRET` | long random string, same value on both services |

`overdrive-vote-staging`: `DATABASE_URL` (internal URL of `od_vote`), `VOTE_SECRET`, `TWITCH_CLIENT_ID`,
`PUBLIC_URL=https://overdrive-vote-staging.onrender.com`. In the Twitch developer console, add the OAuth redirect
`https://overdrive-vote-staging.onrender.com/auth/callback`. Dev logins are disabled on Render on purpose, so test
votes need real Twitch accounts (2–3 crew accounts are enough; load was tested locally with 300 voters).

## Test plan (I run it from your PC or from here once I have the staging address; passwords via env only)

**1. Version first.** `GET https://overdrive-caster-staging.onrender.com/api/version` must show the expected commit.

**2. Persistence across a real redeploy.**
```
OD_URL=https://overdrive-caster-staging.onrender.com OD_PASSWORD=… npx tsx scripts/staging-check.ts seed
# Render → overdrive-caster-staging → Manual Deploy → Deploy latest commit; wait for "live"
OD_URL=… OD_PASSWORD=… npx tsx scripts/staging-check.ts verify
```
`seed` creates tagged talent and a seat, a published graphic, a Wildcard portrait and a map photo, a logo, a video
with a playlist, a music track and a QR link. `verify` checks that the instance restarted, then every item, the bytes
of every file at the same address, database and snapshot health, that nothing is pending or lost, a byte-range video
and no auto-play after the deploy. Repeat with *Clear build cache & deploy*, then with a *Restart*.

**3. Snapshot restore.** Studio → Show file → Recovery: *Snapshot now*, change something, restore the snapshot
(type RESTORE). The server restarts with the old state.

**4. R2 unavailable (real).** Break storage without a Render deploy: in Cloudflare, edit the staging token so it is read-only or scoped to another bucket (changing Render env vars would redeploy). If your dashboard has no Edit for R2 tokens, use a second token for the test and delete it.
Upload a portrait: the producer must see *Saved on this server only, NOT yet in durable storage* and an amber
banner. Restore it: within ~15 s–10 min the banner clears and the asset is *stored*. A second round:
upload while broken, then redeploy before fixing. The asset must show as **lost** (red, "upload it again"),
never as saved.

**5. OBS on the production PC (real OBS Browser Source).** Add browser sources for
`/output/media` (video loop), `/g/mvp`, `/g/pickem`, `/g/qr` and a caster desk, pointed at staging. Run for 2+ hours.
During the run: trigger a staging redeploy; break the R2 token for 10 minutes; unplug the network for 30 s. Expected:
video keeps looping through the R2 outage (disk cache). After a redeploy, media stays stopped until Play, and plays
without refreshing the source. Graphics reconnect by themselves. Nothing airs on its own. Record the dock and output
with OBS.

**6. Audience end to end.** Pick'ems: open voting, scan the QR with a phone, sign in with Twitch, pick, lock,
reveal on air (manual publish). MVP: prepare, open, vote, close, set the desk picks, reveal winner and compare
(manual). Restart both staging services mid-vote, then check that the counts and picks are unchanged and the
reveals still match.

**7. MVP visual review with real portraits.** Upload the real portraits to staging (or send them to me). I re-render
the six variants from staging and send the stills and the animation for approval.

## Production rules that stay in force

- Production deploys only by hand, one approved commit at a time (Manual Deploy → *Deploy a specific commit*).
  Turn **Auto-Deploy Off** in production's Settings → Build & Deploy. Today it reads "On commit", but nothing
  triggers it, because the service is not linked to GitHub. Linking it later would start deploying every push.
- The 2.2.5 camera fix ships alone, from branch `release-2.2.5` (`379d9e1` + `/api/version`), after backup A in
  `docs/BACKUP-AND-ROLLBACK.md`. Check `/api/version` shows it before testing camera transitions.
- The audience features reach production only after staging steps 1–7 pass and you approve the visuals.

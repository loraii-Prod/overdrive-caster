# Persistent assets and show state: setup

Overdrive keeps working without any of this, exactly as before: local disk only, wiped by each Render deploy. With it:

- **Uploaded assets** (portraits, logos, map photos, media, music) live in a **private Cloudflare R2 bucket**.
- **The show state** (graphics, rundown, talent and positions, layouts, presets, bracket, audience settings) is mirrored to **Postgres** within a second of every change.
- **Recovery snapshots:** versioned, encrypted snapshots of the show state go to the same bucket every 10 minutes when something changed, on every shutdown, and on demand.

Credentials go only into Render's environment settings (or a local `.env` that is never committed). They never go into GitHub, the frontend, `state.json` or the logs.

## 1. Cloudflare R2 bucket (you)

1. In the Cloudflare dashboard, open **Storage & databases → R2**. Subscribe to R2 if asked; the free allowance covers this.
2. **Create bucket**:
   - Name: `overdrive-assets`.
   - Location: **Automatic**, or the location hint **Western Europe (WEUR)**.
   - Leave the jurisdiction at the default. If you choose the EU jurisdiction, the endpoint changes; see `R2_ENDPOINT` below.
3. Open the bucket → **Settings** and keep the bucket private:
   - **Public access: R2.dev subdomain** stays **Disabled**.
   - **Custom domains**: add **none**.

   Overdrive delivers assets itself: images through the server, video and music through signed links that expire after 1 hour.
4. Optional but recommended: **Settings → Object lifecycle rules**. Add a rule for the prefix `snapshots/` that deletes objects after 90 days.
5. **R2 → Overview → Manage API tokens → Create Account API token**:
   - Token name: `overdrive-caster-render`.
   - **Permissions: Object Read & Write**. This is the minimum: it can read, write, list and delete objects only. It cannot create or delete buckets or change bucket settings.
   - **Apply to specific buckets only** → `overdrive-assets`.
   - TTL: forever, or a date you will rotate it by.
   - **Create API Token**. Copy the **Access Key ID** and the **Secret Access Key** straight into Render (step 3). The secret is shown only once.
6. Note your **Account ID**, shown on the R2 overview page and in the endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Do not create **Admin** tokens for Overdrive, and do not reuse this token anywhere else.

## 2. Postgres for the show state

You can use the same Render Postgres instance as the vote service. Overdrive creates its own two tables (`od_state`, `od_state_history`) and never touches the vote tables. For full separation, create a second database on that instance, or a second instance.

- In Render, copy the database's **Internal Database URL**.

## 3. Environment variables on `overdrive-caster` (Render → Environment)

| Variable | Value | Secret |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | your Cloudflare account ID | no |
| `R2_BUCKET` | `overdrive-assets` | no |
| `R2_ACCESS_KEY_ID` | from step 1.5 | **yes** |
| `R2_SECRET_ACCESS_KEY` | from step 1.5 | **yes** |
| `R2_ENDPOINT` | only for an EU-jurisdiction bucket: `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` | no |
| `STATE_DATABASE_URL` | Internal Database URL from step 2 | **yes** |
| `STATE_SNAPSHOT_KEY` | 32+ random characters (snapshot encryption). Keep a copy in your password manager: without it, snapshots cannot be restored. | **yes** |

Render masks secret values. Never paste them into chat, issues or commits.

## 4. Before the first deploy with storage: carry today's data over

The running 2.2.4 server keeps everything on the disk that the deploy will wipe. Do this once, just before that deploy:

Full procedure, with the backup and the rollback, in **`docs/BACKUP-AND-ROLLBACK.md`** (rehearsed with the real 2.2.4 build: `e2e-rig/persist/first_deploy.py`). In short:

1. Back up the live data folder (Render SSH tar) and run `scripts/backup-live.ts`.
2. Seed the bucket with the files **and** the show state (read-only on the live server):

   ```
   OD_URL=https://overdrive-caster.onrender.com OD_PASSWORD=… STATE_SNAPSHOT_KEY=… R2_ACCOUNT_ID=… R2_BUCKET=overdrive-assets \
   R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… npx tsx scripts/migrate-live.ts --state ./state.json --dry-run   # list only
   …same command without --dry-run                                                                          # copy
   ```

   It writes `asset-migration-report.md`: every file, what uses it, and anything that failed or could not be linked to a player ID. The new server imports the list at its first start, so the old addresses keep working. `--state` stores the live `state.json` (from the SSH backup) as an encrypted snapshot. The first start, with an empty disk and an empty database, restores it, so the show, Wildcard bracket, talent and OBS token come across unchanged.
3. Deploy by hand. Check `/api/version`, **Studio → Assets → Migration report** and **Studio → Show file → Recovery** (restored from snapshot; database and snapshots ok; banner clear).

From then on, deploys and restarts keep everything.

## 5. Why commits do not deploy (2.2.5 is not live)

Render's event history for `overdrive-caster` shows that every deploy so far was started through the API, and none was triggered by a GitHub push (no commit events at all). Render only auto-deploys services connected through its GitHub integration. A service added from a public repository URL has to be deployed manually.

To fix it (your choice, nothing has been changed):

1. In Render, open the service → **Settings → Build & Deploy → Repository**.
2. Connect it through **GitHub**. Install the Render GitHub App on `loraii-Prod` with access to `overdrive-caster`.

**Warning:** once connected, every push to `main` deploys. Merge to `main` only what you want live.

To deploy 2.2.5 alone, without the audience work, use **Manual Deploy → Deploy latest commit** (`main` = `379d9e1`). It does not include the `audience` branch.

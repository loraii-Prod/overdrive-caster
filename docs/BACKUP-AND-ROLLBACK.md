# Backup and rollback plan: live Render instance (2.2.4) → Overdrive 2.3

Service `overdrive-caster` (`srv-dbnqfhdg1s2s73ddf610`, Frankfurt, starter, 1 instance), live deploy **`a9f6a24` (2.2.4)**.
There is no persistent disk. Everything below lives in the instance's data folder and is **deleted by every deploy,
restart or rollback**:

| What | Where (DATA_DIR, default `/opt/render/project/src/data`) |
| --- | --- |
| Show configuration: talent, seats, events, graphics + rundown, OBS setup, tokens/keys, Wildcard bracket (teams, matches, results, pick'em, veto, portraits/map-photo bindings), tournament, media playlist | `state.json` |
| Studio/Wildcard uploads (portraits, map photos, logos, images) | `uploads/` |
| Media library (videos for /output/media) | `media/` |
| Music library | `music/` (first event) and `music/events/<id>/` |

So: **take the backup before anything that restarts the live service**, including the 2.2.5 camera deploy.
Rehearsed end to end on this machine with the real 2.2.4 build: `e2e-rig/persist/first_deploy.py` (backup → migrate →
first deploy on an empty disk → second deploy → rollback). Not yet done against the real Render/R2.

## 1. Backups (all read-only on the live server)

Do A **and** B, at a quiet time (no show on air), right before the change. Keep both folders private: `state.json` and
`messages.json` contain the API token, crew key and talent/camera keys. Never commit them to GitHub.

**A. Full data folder over SSH (primary: exact and complete).**
SSH works on paid web services. One-time: add your public key in Render → Account settings → SSH public keys.
Use the **running** instance, never `render ssh --ephemeral` (an ephemeral instance has an empty disk).
```
ssh srv-dbnqfhdg1s2s73ddf610@ssh.frankfurt.render.com 'echo "${DATA_DIR:-./data}"; du -sh "${DATA_DIR:-./data}"'
ssh srv-dbnqfhdg1s2s73ddf610@ssh.frankfurt.render.com 'tar czf - -C "${DATA_DIR:-./data}" .' > od-live-$(date +%Y%m%d-%H%M).tgz
tar tzf od-live-*.tgz | head            # check: ./state.json, ./uploads/…, ./media/…, ./music/…
tar xzf od-live-*.tgz ./state.json -O | python3 -m json.tool > /dev/null && echo "state.json OK"
```
If SSH is not possible: the Render dashboard **Shell** tab reaches the same instance. Use it to copy `state.json`
(`gzip -c "${DATA_DIR:-./data}/state.json" | base64 -w0`, then decode locally). The files come from B.

**B. HTTP backup (secondary: no SSH key needed, also a cross-check).**
```
OD_URL=https://overdrive-caster.onrender.com OD_PASSWORD=… npx tsx scripts/backup-live.ts ./od-backup
```
It saves everything the server sends a signed-in producer (`messages.json`), the Wildcard state on its own
(`wildcard.json`, which Wildcard → Restore backup accepts), every referenced or listed upload/media/music file
(byte-exact, with sha256 in `manifest.json`) and anything that is referenced but missing. Limits: it does not capture
uploads nothing references, or passwords/keys that the server never sends to a browser. That is why A is primary.

**C. In-app copies (belt and braces).** Wildcard → *Copy backup*; Show file → export, where the build has it.
Record the OBS WebSocket settings and the Stream Deck/API token from Studio → OBS Setup and Admin.

**Verify the backup before going on.** The file count and sizes in A must match B's `manifest.json`. B's `missing`
list must be empty, or understood.

## 2. Migration to the new build (first deploy with R2 + Postgres)

1. Backups A + B done and checked (above).
2. Create the R2 bucket, the token and the database, and set the env vars on the service, without deploying
   (`docs/ASSET-STORAGE-SETUP.md`). Set `STATE_SNAPSHOT_KEY` and store a copy in your password manager.
   Without it, encrypted snapshots cannot be read.
3. Seed R2 from the live server (read-only on it):
   ```
   tar xzf od-live-*.tgz ./state.json
   OD_URL=https://overdrive-caster.onrender.com OD_PASSWORD=… STATE_SNAPSHOT_KEY=… \
   R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
   npx tsx scripts/migrate-live.ts --dry-run --state ./state.json     # read the report first
   … same without --dry-run
   ```
   Check `asset-migration-report.md`: 0 failed; the show state is seeded as an encrypted snapshot.
4. Manual deploy of the approved commit. On boot, the new build finds an empty database and an empty disk, so it
   restores the seeded snapshot. It imports the asset registry, and the old `/uploads/…`, `/media/…` and `/music/…`
   addresses keep working from R2.
5. Check: `/api/version` shows the expected commit. Studio → Show file → Recovery shows *restored from snapshot*,
   database ok, snapshots ok. The storage banner shows nothing pending. Then spot-check portraits, map photos,
   media, music, talent and seats, the Wildcard bracket and the OBS scenes. Only after that, the first real
   redeploy, to prove that it survives.

## 3. Rollback

| Situation | Rollback |
| --- | --- |
| New build misbehaves, show not yet changed on it | Render → Deploys → **Rollback** to `a9f6a24`. Its disk starts empty, so restore backup A: `ssh … 'mkdir -p "${DATA_DIR:-./data}" && tar xzf - -C "${DATA_DIR:-./data}"' < od-live-….tgz`, then **Restart service** (Render → Manual deploy → Restart; a restart keeps the disk; a deploy does not). |
| Changes were made on the new build and should be kept | Download the newest state from the new build first (Studio → Show file → Recovery → *Download show state*, i.e. `GET /api/persist/download`). 2.2.4 can read a 2.3 `state.json` (it ignores the new fields; rehearsed), but files uploaded after the migration live in R2 only: copy them back (backup-live.ts against the new build) before rolling back. |
| Only the 2.2.5 camera change misbehaves | Rollback to `a9f6a24`, plus backup A as above. 2.2.5 changes no data. |
| R2 or Postgres down during a show | No rollback needed: the server keeps running from its local disk. New uploads are marked *pending* (banner), and media plays from the disk cache. Do not redeploy until the banner is clear. |

Rollback never deletes anything from R2 or Postgres, so the migration can be repeated later.

**Compatibility, rehearsed:** a 2.2.4 data folder boots on 2.3 (assets registered and linked to player ids).
A 2.3 `state.json` boots on 2.2.4. Uploads keep their addresses both ways.

## 4. Before any deploy (2.2.5 or 2.3)

- [ ] No show on air or in rehearsal; crew told.
- [ ] Backups A + B taken and checked, stored privately (not in the repo).
- [ ] Render Auto-Deploy confirmed **Off** (Settings → Build & Deploy).
- [ ] The exact commit approved; deploy started by hand (Manual Deploy → *Deploy a specific commit*).
- [ ] After the deploy: `GET /api/version` shows that commit before testing anything (camera transitions included).
- [ ] Rollback target noted: `a9f6a24` (2.2.4) + backup A.

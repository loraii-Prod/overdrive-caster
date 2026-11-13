/**
 * Durable show state. state.json on the server's disk stays the working copy (fast, atomic writes), but on Render
 * that disk is wiped by every deploy, so:
 *
 *  1. PRIMARY: every save is mirrored (debounced 1 s) to Postgres (STATE_DATABASE_URL): one current row plus a
 *     rolling history. At boot, before anything reads state.json, a newer database copy replaces the local file.
 *  2. RECOVERY: versioned snapshots go to the private R2 bucket every 10 minutes when something changed, on
 *     shutdown, and on demand. Encrypted (AES-256-GCM) when STATE_SNAPSHOT_KEY is set. Used at boot only when the
 *     database is not configured or not reachable and there is no local file, or when a producer restores one.
 *
 * Neither is required: without them the server behaves exactly as before (local file only). A database or storage
 * outage never blocks the show: saves keep going to the local file and are mirrored again once it is back.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import pg from 'pg';
import { S3, s3Conf } from './s3';

const env = process.env;
const DATA_DIR = path.resolve(env.DATA_DIR ?? './data');
const FILE = path.join(DATA_DIR, 'state.json');
const HISTORY_EVERY = 60_000, HISTORY_KEEP = 300, SNAP_EVERY = 10 * 60_000;

export interface PersistStatus {
  database: 'off' | 'ok' | 'error';
  snapshots: 'off' | 'ok' | 'error';
  encrypted: boolean;
  lastMirror: number; lastSnapshot: number; rev: number;
  restoredFrom: 'local' | 'database' | 'snapshot' | 'fresh';
  error: string | null;
}
export const status: PersistStatus = { database: 'off', snapshots: 'off', encrypted: !!env.STATE_SNAPSHOT_KEY, lastMirror: 0, lastSnapshot: 0, rev: 0, restoredFrom: 'local', error: null };

let pool: pg.Pool | null = null;
const s3c = s3Conf();
export const store = s3c ? new S3(s3c) : null;
if (store) status.snapshots = 'ok';

const SCHEMA = `
create table if not exists od_state(id text primary key, rev bigint not null, saved_at timestamptz not null, data jsonb not null);
create table if not exists od_state_history(id bigserial primary key, rev bigint not null, saved_at timestamptz not null, data jsonb not null, reason text not null default 'auto');
create index if not exists od_state_history_at on od_state_history(saved_at desc);`;

function key(): Buffer | null {
  const k = env.STATE_SNAPSHOT_KEY;
  return k ? crypto.createHash('sha256').update(k).digest() : null;
}
/** gzip, then AES-256-GCM when a key is set: [magic "ODS1"][iv 12][tag 16][ciphertext]. */
export function seal(json: string): Buffer {
  const z = zlib.gzipSync(json);
  const k = key();
  if (!k) return z;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([c.update(z), c.final()]);
  return Buffer.concat([Buffer.from('ODS1'), iv, c.getAuthTag(), body]);
}
export function unseal(b: Buffer): string {
  if (b.subarray(0, 4).toString() === 'ODS1') {
    const k = key();
    if (!k) throw new Error('snapshot is encrypted: STATE_SNAPSHOT_KEY is not set');
    const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(4, 16));
    d.setAuthTag(b.subarray(16, 32));
    return zlib.gunzipSync(Buffer.concat([d.update(b.subarray(32)), d.final()])).toString('utf8');
  }
  return zlib.gunzipSync(b).toString('utf8');
}
const validState = (s: string) => { try { const j = JSON.parse(s); return j && typeof j === 'object' && Array.isArray(j.graphics ?? []) ? j : null; } catch { return null; } };
const writeLocal = (json: string) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', json); fs.renameSync(FILE + '.tmp', FILE); };

/** Run once at boot, BEFORE the store reads state.json. Never throws. */
export async function restore(): Promise<void> {
  const localAt = (() => { try { return fs.statSync(FILE).mtimeMs; } catch { return 0; } })();
  if (env.STATE_DATABASE_URL) {
    try {
      const ssl = /render\.com|sslmode=require/.test(env.STATE_DATABASE_URL) ? { rejectUnauthorized: false } : undefined;
      pool = new pg.Pool({ connectionString: env.STATE_DATABASE_URL, max: 3, ssl, connectionTimeoutMillis: 5000 });
      pool.on('error', e => { status.database = 'error'; status.error = e.message; });
      await pool.query(SCHEMA);
      const r = await pool.query("select rev, saved_at, data::text as data from od_state where id = 'main'");
      status.database = 'ok';
      if (r.rows[0]) {
        status.rev = Number(r.rows[0].rev);
        const dbAt = +r.rows[0].saved_at;
        if (!localAt || dbAt > localAt + 1000) {
          if (validState(r.rows[0].data)) { writeLocal(r.rows[0].data); status.restoredFrom = 'database'; console.log(`[persist] restored show state from the database (rev ${status.rev})`); }
        }
      }
      return;
    } catch (e: any) {
      status.database = 'error'; status.error = `database: ${e.message}`;
      console.error('[persist] database not reachable at boot:', e.message);
    }
  }
  if (!localAt && store) {
    try {
      const snaps = await store.list('snapshots/state/', 2000);
      for (const s of snaps.reverse()) {
        const b = await store.getBuffer(s.key);
        const json = b && unseal(b);
        if (json && validState(json)) { writeLocal(json); status.restoredFrom = 'snapshot'; console.log(`[persist] restored show state from snapshot ${s.key}`); return; }
      }
    } catch (e: any) { status.snapshots = 'error'; status.error = `snapshots: ${e.message}`; console.error('[persist] snapshot restore failed:', e.message); }
  }
  status.restoredFrom = localAt ? 'local' : 'fresh';
}

// ---------------------------------------------------------------- mirror + snapshots

let pending: string | null = null, mirrorTimer: NodeJS.Timeout | null = null, lastHistory = 0, writing = false;
let latest: string | null = null, saves = 0, lastSnapSaves = 0;

/** Called after every local save with the JSON that was written. */
export function onSaved(json: string) {
  latest = json; saves++;
  if (!pool) return;
  pending = json;
  if (!mirrorTimer) mirrorTimer = setTimeout(() => { mirrorTimer = null; mirror().catch(() => {}); }, 1000);
}

async function mirror(reason = 'auto') {
  if (!pool || writing || pending == null) return;
  const json = pending; pending = null; writing = true;
  try {
    const rev = status.rev + 1, now = new Date();
    await pool.query("insert into od_state(id, rev, saved_at, data) values ('main', $1, $2, $3::jsonb) on conflict (id) do update set rev = excluded.rev, saved_at = excluded.saved_at, data = excluded.data", [rev, now, json]);
    status.rev = rev; status.lastMirror = now.getTime(); status.database = 'ok'; status.error = null;
    if (reason !== 'auto' || now.getTime() - lastHistory > HISTORY_EVERY) {
      lastHistory = now.getTime();
      await pool.query('insert into od_state_history(rev, saved_at, data, reason) values ($1, $2, $3::jsonb, $4)', [rev, now, json, reason]);
      await pool.query('delete from od_state_history where id in (select id from od_state_history order by saved_at desc offset $1)', [HISTORY_KEEP]);
    }
  } catch (e: any) {
    status.database = 'error'; status.error = `database: ${e.message}`;
    if (pending == null) pending = json; // keep the newest copy and retry
    setTimeout(() => mirror().catch(() => {}), 5000).unref();
  } finally {
    writing = false;
    if (pending != null && !mirrorTimer) mirrorTimer = setTimeout(() => { mirrorTimer = null; mirror().catch(() => {}); }, 1000);
  }
}

const snapKey = (reason: string) => `snapshots/state/${new Date().toISOString().replace(/[:.]/g, '-')}-r${status.rev}-${reason.replace(/[^\w-]/g, '')}.json.gz${env.STATE_SNAPSHOT_KEY ? '.enc' : ''}`;
export async function snapshot(reason = 'auto'): Promise<string | null> {
  const json = latest ?? (fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null);
  if (!store || !json) return null;
  const k = snapKey(reason);
  try {
    await store.put(k, seal(json), 'application/octet-stream', { reason, rev: String(status.rev) });
    status.lastSnapshot = Date.now(); status.snapshots = 'ok'; lastSnapSaves = saves;
    return k;
  } catch (e: any) { status.snapshots = 'error'; status.error = `snapshots: ${e.message}`; return null; }
}
export async function listSnapshots() {
  if (!store) return [];
  return (await store.list('snapshots/state/', 500)).reverse().map(s => ({ key: s.key, size: s.size }));
}
/** Read and check a snapshot (nothing changes). */
export async function readSnapshot(k: string): Promise<{ json: string } | { error: string }> {
  if (!store || !/^snapshots\/state\/[\w.-]+$/.test(k)) return { error: 'Unknown snapshot' };
  const b = await store.getBuffer(k).catch(() => null);
  if (!b) return { error: 'Snapshot not found' };
  let json: string;
  try { json = unseal(b); } catch (e: any) { return { error: e.message }; }
  return validState(json) ? { json } : { error: 'Snapshot is not a valid show state' };
}
/** Make a checked snapshot the current state (database + local file). The caller restarts the server. */
export async function applyRestore(json: string, k: string) {
  await snapshot('before-restore');
  writeLocal(json);
  if (pool) { pending = json; await mirror('restore:' + k.split('/').pop()); }
}
export async function history(limit = 50) {
  if (!pool) return [];
  const r = await pool.query('select id, rev, saved_at, reason, length(data::text) as size from od_state_history order by saved_at desc limit $1', [limit]);
  return r.rows.map(x => ({ id: Number(x.id), rev: Number(x.rev), at: +x.saved_at, reason: x.reason, size: Number(x.size) }));
}

export function startPersistence() {
  setInterval(() => { if (store && saves !== lastSnapSaves && latest) snapshot('auto').catch(() => {}); }, SNAP_EVERY).unref();
}

/** Shutdown (Render sends SIGTERM before replacing the instance): mirror + snapshot the last state, 5 s budget. */
export async function shutdownPersist() {
  const t = new Promise(r => setTimeout(r, 5000));
  const work = (async () => { if (pending != null || latest) { pending = pending ?? latest; await mirror('shutdown'); } if (store && latest) await snapshot('shutdown'); })().catch(() => {});
  await Promise.race([work, t]);
}

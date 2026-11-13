/**
 * One asset registry for every uploaded broadcast asset (player portraits, team logos, map photos, media, music,
 * other images). Files keep their existing public addresses (/uploads/…, /media/…, /music/…), so no graphic,
 * playlist or saved configuration changes; what changes is where the bytes live:
 *
 *  - the private R2 bucket is the durable copy (content-hash keys: assets/<role>/<sha256>.<ext>),
 *  - the server disk is only a cache (wiped by Render deploys, refilled on demand).
 *
 * Delivery keeps the bucket private: images are read by the server and cached; large media and music are answered
 * with a short-lived signed address (1 h) so OBS streams them straight from storage. Draft assets are served only to
 * signed-in producers. The registry itself is part of the show state (db.assets), so it is mirrored to the database
 * and to the recovery snapshots with everything else.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { db, save } from './store';
import { isAdmin } from './auth';
import { store as s3 } from './durable';
import { normHandle } from '../shared/major';
import { playerIdOf } from '../shared/playerIds';

import type { AssetRole } from './filecheck';
export type { AssetRole };
export interface AssetRec {
  id: string;
  role: AssetRole;
  /** What it belongs to: player id (P_granady), map id, music section, or null. */
  ref: string | null;
  /** Public address, unchanged from before (/uploads/x.png, /media/…, /music/…). */
  path: string;
  /** Storage key in the bucket ('' = not stored yet). */
  key: string;
  sha256: string;
  size: number;
  mime: string;
  w?: number; h?: number; alpha?: boolean;
  created: number;
  status: 'approved' | 'draft';
  /**
   * Durability: 'stored' = the copy in the bucket exists and was verified; 'pending' = only on this server's disk,
   * copy being retried; 'failed' = automatic retries exhausted (manual retry, still retried every 30 min); 'lost' =
   * never reached storage and this disk no longer has it (a deploy wiped it): must be uploaded again;
   * 'local' = storage is not configured on this server (lost on the next Render deploy).
   */
  state: 'stored' | 'pending' | 'failed' | 'lost' | 'local';
  /** Back-compat (= state === 'stored'). */
  stored: boolean;
  attempts?: number; nextTry?: number; lastError?: string;
}
export interface AssetReport {
  at: number;
  storage: 'r2' | 'local';
  scanned: number; registered: number; uploaded: number; already: number;
  failed: { path: string; error: string }[];
  references: { where: string; url: string; ok: boolean }[];
  unmatched: { where: string; key: string; note: string }[];
}
export interface AssetsStore { list: AssetRec[]; report: AssetReport | null }
export function emptyAssets(): AssetsStore { return { list: [], report: null }; }
export function sanitizeAssets(v: any): AssetsStore {
  const d = emptyAssets();
  if (!v || typeof v !== 'object' || !Array.isArray(v.list)) return d;
  const ROLES: AssetRole[] = ['portrait', 'logo', 'map', 'media', 'music', 'image', 'video'];
  d.list = v.list.filter((x: any) => x && typeof x.path === 'string' && /^\/(uploads|media|music)\//.test(x.path) && ROLES.includes(x.role)).slice(0, 5000).map((x: any) => ({
    id: String(x.id).slice(0, 40), role: x.role, ref: typeof x.ref === 'string' ? x.ref.slice(0, 60) : null, path: x.path.slice(0, 300), key: typeof x.key === 'string' ? x.key.slice(0, 200) : '',
    sha256: String(x.sha256 ?? '').slice(0, 64), size: Number(x.size) || 0, mime: String(x.mime ?? '').slice(0, 60),
    ...(Number(x.w) ? { w: Number(x.w), h: Number(x.h), alpha: x.alpha === true } : {}), created: Number(x.created) || Date.now(), status: x.status === 'draft' ? 'draft' : 'approved',
    state: ['stored', 'pending', 'failed', 'lost', 'local'].includes(x.state) ? x.state : x.stored === true ? 'stored' : 'pending', stored: x.state ? x.state === 'stored' : x.stored === true,
    attempts: Number(x.attempts) || 0, nextTry: Number(x.nextTry) || 0, lastError: typeof x.lastError === 'string' ? x.lastError.slice(0, 160) : undefined,
  }));
  d.report = v.report && typeof v.report === 'object' ? v.report : null;
  return d;
}

export { sniff, imageInfo, validate } from './filecheck';
import { sniff, imageInfo } from './filecheck';

// ---------------------------------------------------------------- registry

const LOCAL: Record<string, string> = { uploads: path.join(config.dataDir, 'uploads'), media: path.join(config.dataDir, 'media'), music: path.join(config.dataDir, 'music') };
/** Local cache file of a public address (null = not a registry address). */
export function localOf(p: string): string | null {
  const m = /^\/(uploads|media|music)\/(.+)$/.exec(p);
  if (!m) return null;
  const rel = decodeURIComponent(m[2]);
  if (rel.split('/').some(x => x === '..' || x === '')) return null;
  return path.join(LOCAL[m[1]], ...rel.split('/'));
}
const byPath = () => new Map(db.assets.list.map(a => [a.path, a]));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
export const storageOn = () => !!s3;

/** Storage health as seen by uploads and reads (for the status banners). */
export const storageHealth = { ok: true, lastOk: 0, lastError: '' as string, lastErrorAt: 0 };
const setState = (rec: AssetRec, st: AssetRec['state']) => { rec.state = st; rec.stored = st === 'stored'; };
const MAX_AUTO = 8;
const backoff = (n: number) => Math.min(15_000 * 2 ** Math.max(0, n - 1), 10 * 60_000);

/**
 * Copy to storage and verify it is there (HEAD: right size) before calling it stored. Never throws: a failure leaves
 * the asset 'pending' with the next retry time; after MAX_AUTO attempts it becomes 'failed'.
 */
async function store(rec: AssetRec, b: Buffer) {
  if (!s3) { setState(rec, 'local'); return; }
  rec.key = `assets/${rec.role === 'video' || rec.role === 'image' ? rec.role : rec.role}/${rec.sha256}.${rec.path.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}`;
  rec.attempts = (rec.attempts ?? 0) + 1;
  try {
    let head = await s3.head(rec.key);
    if (!head) { await s3.put(rec.key, b, rec.mime, { path: encodeURIComponent(rec.path).slice(0, 500) }); head = await s3.head(rec.key); }
    if (!head || head.size !== b.length) throw new Error(`verification failed (${head ? head.size : 'missing'} bytes in storage)`);
    setState(rec, 'stored'); rec.lastError = undefined; rec.nextTry = 0;
    storageHealth.ok = true; storageHealth.lastOk = Date.now();
  } catch (e: any) {
    rec.lastError = String(e?.message ?? e).slice(0, 160);
    setState(rec, rec.attempts >= MAX_AUTO ? 'failed' : 'pending');
    rec.nextTry = Date.now() + (rec.state === 'failed' ? 30 * 60_000 : backoff(rec.attempts));
    storageHealth.ok = false; storageHealth.lastError = rec.lastError; storageHealth.lastErrorAt = Date.now();
    console.error(`[assets] storage copy failed (${rec.state}, attempt ${rec.attempts}):`, rec.path, rec.lastError);
  }
}

/**
 * Register a file that was just written to its usual local address (the existing upload screens call this), and
 * copy it to storage. Awaited: an upload is only reported saved once the durable copy exists (or is queued).
 */
export async function register(pathname: string, b: Buffer, role: AssetRole, ref: string | null = null, status: 'approved' | 'draft' = 'approved'): Promise<AssetRec> {
  const t = sniff(b), info = t?.kind === 'image' ? imageInfo(b, t.mime) : null;
  const prev = db.assets.list.find(a => a.path === pathname);
  const rec: AssetRec = { id: prev?.id ?? crypto.randomBytes(6).toString('base64url'), role: prev?.role ?? role, ref: ref ?? prev?.ref ?? null, path: pathname, key: '', sha256: sha(b), size: b.length,
    mime: t?.mime ?? 'application/octet-stream', ...(info ? info : {}), created: Date.now(), status, state: 'pending', stored: false, attempts: 0 };
  // One quick second try for a blip; after that the copy is retried in the background with backoff.
  await store(rec, b);
  if (rec.state === 'pending') { rec.attempts = 1; await new Promise(r => setTimeout(r, 800)); await store(rec, b); }
  db.assets.list = [...db.assets.list.filter(a => a.path !== pathname), rec];
  save();
  return rec;
}
export function unregister(pathname: string) {
  const rec = db.assets.list.find(a => a.path === pathname);
  if (!rec) return;
  db.assets.list = db.assets.list.filter(a => a.path !== pathname);
  save();
  // The bytes are only deleted when no other address still uses the same content.
  if (s3 && rec.key && !db.assets.list.some(a => a.key === rec.key)) s3.del(rec.key).catch(() => {});
}
/** Link an asset to what it belongs to (a portrait to a player id, a photo to a map). */
export function tag(pathname: string, role: AssetRole, ref: string | null) {
  const rec = db.assets.list.find(a => a.path === pathname);
  if (rec && (rec.role !== role || rec.ref !== ref)) { rec.role = role; rec.ref = ref; save(); }
}
/** Registered addresses under a prefix (listing media / music after a deploy wiped the disk). */
export const registered = (prefix: string) => db.assets.list.filter(a => a.path.startsWith(prefix));

/** Background retry of copies that have not reached storage. An asset whose local file is gone can never be copied. */
export async function retryPending(force = false): Promise<{ tried: number; stored: number }> {
  let tried = 0, ok = 0;
  if (!s3) return { tried, stored: ok };
  for (const rec of db.assets.list.filter(a => a.state === 'pending' || a.state === 'failed')) {
    if (!force && (rec.nextTry ?? 0) > Date.now()) continue;
    const f = localOf(rec.path);
    if (!f || !fs.existsSync(f)) { setState(rec, 'lost'); rec.lastError = 'The file was only on this server and is gone (deploy/restart): upload it again'; continue; }
    const b = fs.readFileSync(f);
    if (sha(b) !== rec.sha256) { setState(rec, 'lost'); rec.lastError = 'The local file changed: upload it again'; continue; }
    if (force) rec.attempts = 0;
    tried++; await store(rec, b); if (rec.state === 'stored') ok++;
    if (tried >= 10) break;
  }
  if (tried) save();
  return { tried, stored: ok };
}
setInterval(() => { retryPending().catch(() => {}); }, 15_000).unref();

/** Counts for the status banners (Producer, Controller, Admin, Studio). */
export function durability() {
  const c = { stored: 0, pending: 0, failed: 0, lost: 0, local: 0 };
  for (const a of db.assets.list) c[a.state]++;
  return { storage: s3 ? 'r2' : 'local', ...c, health: storageHealth, attention: db.assets.list.filter(a => a.state !== 'stored' && a.state !== 'local').slice(0, 20).map(a => ({ path: a.path, role: a.role, ref: a.ref, state: a.state, lastError: a.lastError, nextTry: a.nextTry })) };
}

// ---------------------------------------------------------------- delivery

/**
 * After express.static (local cache hit) comes this: an address that is registered but not on this disk (wiped by
 * a deploy) is fetched from storage. Images are cached on disk and served by the server; video and audio get a
 * signed address (1 h) so playback streams from storage with range requests. Unknown or draft addresses: 404.
 */
export function fromStorage(prefix: '/uploads' | '/media' | '/music') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = prefix + req.path;
    const rec = byPath().get(p) ?? byPath().get(prefix + encodeURI(decodeURIComponent(req.path)));
    if (!rec || (rec.status === 'draft' && !isAdmin(req))) return res.status(404).end();
    if (!s3 || !rec.key || rec.state !== 'stored') return res.status(404).end();
    const f = localOf(rec.path);
    try {
      if (rec.mime.startsWith('image/')) {
        const b = await s3.getBuffer(rec.key);
        if (!b || sha(b) !== rec.sha256) return res.status(502).end();
        if (f) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', b); fs.renameSync(f + '.tmp', f); }
        res.setHeader('Content-Type', rec.mime);
        res.setHeader('Cache-Control', prefix === '/uploads' ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
        if (rec.mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
        storageHealth.ok = true; storageHealth.lastOk = Date.now();
        return res.end(req.method === 'HEAD' ? undefined : b);
      }
      // Video / audio: streamed by this server with byte ranges (seek, loop, resume), never an expiring link, so a
      // looping OBS media source works for hours. The whole file is cached to disk in the background; from then on
      // express.static serves it (and it keeps playing if storage goes away).
      if (f) cacheInBackground(rec, f);
      const range = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
      const r = await s3.get(rec.key, range);
      if (!r) return res.status(404).end();
      res.status(r.status === 206 ? 206 : 200);
      for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
      res.setHeader('Content-Type', rec.mime); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      storageHealth.ok = true; storageHealth.lastOk = Date.now();
      if (req.method === 'HEAD' || !r.body) { res.end(); return; }
      const { Readable } = await import('node:stream');
      Readable.fromWeb(r.body as any).on('error', () => res.destroy()).pipe(res);
    } catch (e: any) {
      storageHealth.ok = false; storageHealth.lastError = String(e.message); storageHealth.lastErrorAt = Date.now();
      console.error('[assets] storage read failed:', rec.path, e.message); res.status(503).end();
    }
  };
}
const caching = new Set<string>();
function cacheInBackground(rec: AssetRec, f: string) {
  if (caching.has(rec.path) || fs.existsSync(f)) return;
  caching.add(rec.path);
  (async () => {
    const b = await s3!.getBuffer(rec.key);
    if (!b || sha(b) !== rec.sha256) throw new Error('checksum mismatch');
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', b); fs.renameSync(f + '.tmp', f);
  })().catch(e => console.error('[assets] cache fill failed:', rec.path, e.message)).finally(() => caching.delete(rec.path));
}

/** Image metadata graphics use for framing (no keys, no drafts). */
export function publicMeta(): Record<string, { w: number; h: number; alpha: boolean; v: string }> {
  return Object.fromEntries(db.assets.list.filter(a => a.status === 'approved' && a.w).map(a => [a.path, { w: a.w!, h: a.h!, alpha: !!a.alpha, v: a.sha256.slice(0, 10) }]));
}

// ---------------------------------------------------------------- migration

function walk(dir: string, base = dir): string[] {
  let out: string[] = [];
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out = out.concat(walk(f, base)); else if (!e.name.endsWith('.tmp')) out.push(path.relative(base, f)); } } catch {}
  return out;
}

/** Every asset address a saved configuration points at (to check nothing is missing). */
function references(): { where: string; url: string }[] {
  const out: { where: string; url: string }[] = [];
  const wc = db.wildcard;
  for (const [k, u] of Object.entries(wc.showcase.photos)) out.push({ where: `Player portrait ${k}`, url: u });
  for (const [k, u] of Object.entries(wc.mapPhotos ?? {})) out.push({ where: `Map photo ${k}`, url: String(u) });
  for (const u of db.media?.playlist ?? []) out.push({ where: 'Media playlist', url: u });
  const walkObj = (o: unknown, where: string, depth = 0) => {
    if (depth > 6 || !o) return;
    if (typeof o === 'string') { if (/^\/(uploads|media|music)\//.test(o)) out.push({ where, url: o }); return; }
    if (Array.isArray(o)) o.forEach((x, i) => walkObj(x, where, depth + 1));
    else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) walkObj(v, `${where} ${k}`.trim(), depth + 1);
  };
  walkObj(db.showLive.brand, 'Brand');
  walkObj(db.tournament, 'Tournament');
  walkObj(db.players, 'Players');
  return out.filter(r => r.url.startsWith('/'));
}

/**
 * One-time (and idempotent) migration: register every file already on this disk, copy it to storage, link
 * portraits to stable player ids by their existing nickname key (exact match only), and check every saved
 * reference. Writes db.assets.report. Nothing is guessed: unmatched items are listed, never merged.
 */
export async function migrate(): Promise<AssetReport> {
  const rep: AssetReport = { at: Date.now(), storage: s3 ? 'r2' : 'local', scanned: 0, registered: 0, uploaded: 0, already: 0, failed: [], references: [], unmatched: [] };
  // Uploads that never reached storage and whose file this disk no longer has (wiped by a deploy) are lost:
  // say so at once instead of waiting for the next retry.
  for (const rec of db.assets.list) {
    if (rec.state !== 'pending' && rec.state !== 'failed') continue;
    const f = localOf(rec.path);
    if (!f || !fs.existsSync(f)) { setState(rec, 'lost'); rec.lastError = 'The file was only on this server and is gone (deploy/restart): upload it again'; }
  }
  const have = byPath();
  for (const [dir, abs] of Object.entries(LOCAL)) {
    for (const rel of walk(abs)) {
      rep.scanned++;
      const pub = `/${dir}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
      const prev = have.get(pub);
      if (prev?.state === 'stored') { rep.already++; continue; }
      try {
        const b = fs.readFileSync(path.join(abs, rel));
        const t = sniff(b);
        if (!t) { rep.failed.push({ path: pub, error: 'unknown file type, not registered' }); continue; }
        const role: AssetRole = dir === 'music' ? 'music' : dir === 'media' ? 'media' : t.kind === 'video' ? 'video' : 'image';
        const rec = await register(pub, b, prev?.role ?? role, prev?.ref ?? (dir === 'music' ? rel.split(path.sep)[0] : null));
        rep.registered++; if (rec.state === 'stored') rep.uploaded++; if (s3 && rec.state !== 'stored') rep.failed.push({ path: pub, error: `not in storage yet (${rec.state}): ${rec.lastError ?? ''}` });
      } catch (e: any) { rep.failed.push({ path: pub, error: String(e.message) }); }
    }
  }
  // Portraits: the existing nickname key → stable player id (exact match only).
  for (const [k, u] of Object.entries(db.wildcard.showcase.photos)) {
    const id = playerIdOf(k);
    if (id) tag(u, 'portrait', id);
    else rep.unmatched.push({ where: 'Player portrait', key: k, note: 'no Major player with this exact nickname: kept as it is, not linked' });
  }
  for (const [k, u] of Object.entries(db.wildcard.mapPhotos ?? {})) tag(String(u), 'map', k);
  const reg = byPath();
  for (const r of references()) {
    const f = localOf(r.url);
    rep.references.push({ ...r, ok: reg.has(r.url) || (!!f && fs.existsSync(f)) || !f });
  }
  db.assets.report = rep;
  save();
  console.log(`[assets] migration: ${rep.registered} registered (${rep.uploaded} copied to storage), ${rep.already} already stored, ${rep.failed.length} failed, ${rep.references.filter(r => !r.ok).length} missing references`);
  return rep;
}

/**
 * Assets copied from the old server before the first deploy (scripts/migrate-live.ts writes registry/seed-*.json to
 * the bucket). Imported once, only into an empty registry; addresses keep their old form.
 */
export async function importSeed(): Promise<number> {
  if (!s3 || db.assets.list.length) return 0;
  try {
    const seeds = await s3.list('registry/seed-', 100);
    const last = seeds.pop();
    if (!last) return 0;
    const b = await s3.getBuffer(last.key);
    const j = b ? JSON.parse(b.toString('utf8')) : null;
    const list = sanitizeAssets({ list: j?.assets ?? [] }).list.filter(a => a.key.startsWith('assets/'));
    db.assets.list = list; save();
    console.log(`[assets] imported ${list.length} assets from ${last.key}`);
    return list.length;
  } catch (e: any) { console.error('[assets] seed import failed:', e.message); return 0; }
}

/** Studio: the registry (no storage keys), the last migration report, storage status. */
export function assetsApi() {
  const r = express.Router();
  r.get('/api/assets', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'sign in' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ storage: s3 ? 'r2' : 'local', assets: db.assets.list.map(({ key: _k, ...a }) => a), report: db.assets.report });
  });
  r.post('/api/assets/migrate', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'sign in' });
    res.json({ ok: true, report: await migrate() });
  });
  r.get('/api/assets/health', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'sign in' });
    res.setHeader('Cache-Control', 'no-store'); res.json(durability());
  });
  r.post('/api/assets/retry', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'sign in' });
    const out = await retryPending(true); res.json({ ok: true, ...out, ...durability() });
  });
  r.post('/api/assets/status', express.json(), (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'sign in' });
    const rec = db.assets.list.find(a => a.path === req.body?.path);
    if (!rec) return res.status(404).json({ error: 'unknown asset' });
    rec.status = req.body?.status === 'draft' ? 'draft' : 'approved'; save();
    res.json({ ok: true });
  });
  return r;
}

export const portraitKey = (handle: string) => normHandle(handle);

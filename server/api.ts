import { MEDIA_EXT, mediaName } from '../shared/media';
import type { ProducerCmd } from '../shared/engine';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { config } from './config';
import { isAdmin, isAuthed } from './auth';
import { db } from './store';
import { clone } from '../shared/defaults';
import { LEGACY_FOLDER, MUSIC_FOLDERS, MUSIC_SECTIONS, type MusicSection } from '../shared/music';
import type { ClientMsg } from '../shared/protocol';
import type { LayoutMode, Scene, ScreenId } from '../shared/types';
import { resolve, upcoming, results, champion, isTeam, type TournamentOp } from '../shared/tournament';
import { isWcId } from '../shared/wildcard';
import { fromStorage, register, registered, unregister, validate, type AssetRole } from './assets';

interface Api { engine: (cmd: ProducerCmd, source?: 'manual' | 'auto') => Promise<{ ok: boolean; version: number; error?: string; note?: string }>; act: (m: ClientMsg) => void; tournamentOp: (op: TournamentOp) => void; spectate: (name: string, login: string) => void; state: () => unknown }

import { SCREEN_IDS as SCREENS } from '../shared/types';
const LAYOUTS: LayoutMode[] = ['auto', 'solo', 'duo', 'trio', 'mixed', 'audio'];

function tokenOk(req: Request) {
  const h = req.headers.authorization;
  const t = (h?.startsWith('Bearer ') ? h.slice(7) : '') || String(req.query.token ?? '');
  if (!t) return false;
  const a = Buffer.from(t), b = Buffer.from(db.apiToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const flag = (v: string, cur: boolean) => (v === 'toggle' ? !cur : v === 'on' || v === '1' || v === 'true');

/**
 * HTTP control API for Stream Deck (Bitfocus Companion "Generic HTTP"),
 * Touch Portal, macros or bots. GET or POST, token via `Authorization:
 * Bearer …` or `?token=`. Scene changes go to preview; add `?take=1` to put
 * them on air (screen/preset switches take by default; `?preview=1` stages).
 */
export function controlApi(api: Api) {
  const r = express.Router();
  r.use((req, res, next) => (tokenOk(req) || isAuthed(req) ? next() : res.status(401).json({ error: 'invalid token' })));

  const done = (res: Response) => res.json({ ok: true, state: api.state() });
  const wantsTake = (req: Request, def: boolean) => (req.query.preview ? false : req.query.take ? req.query.take !== '0' : def);
  const editScene = (req: Request, fn: (s: Scene) => void, takeDefault = false) => {
    const s = clone(db.preview);
    fn(s);
    api.act({ t: 'set-preview', scene: s });
    if (wantsTake(req, takeDefault)) api.act({ t: 'take' });
  };

  r.all('/state', (_req, res) => res.json(api.state()));

  // Control strips under OBS sources (?controls&token=…): the same actions as the controller's scene dock.
  const STRIP_MSGS = new Set(['quick', 'screen', 'take', 'wc', 'tw', 'badge']);
  r.post('/msg', (req, res) => {
    const m = req.body;
    if (!m || typeof m !== 'object' || !STRIP_MSGS.has(m.t)) return res.status(400).json({ error: `t must be one of ${[...STRIP_MSGS].join(', ')}` });
    api.act(m as ClientMsg);
    res.json({ ok: true });
  });
  r.all('/take', (_req, res) => { api.act({ t: 'take' }); done(res); });

  r.all('/screen/:screen', (req, res) => {
    const screen = req.params.screen as ScreenId;
    if (!SCREENS.includes(screen)) return res.status(400).json({ error: `screen must be one of ${SCREENS.join(', ')}` });
    api.act({ t: 'screen', screen, take: wantsTake(req, true) });
    done(res);
  });

  r.all('/preset/:id', (req, res) => {
    const key = req.params.id.toLowerCase();
    const p = db.presets.find(p => p.id === req.params.id || p.name.toLowerCase() === key);
    if (!p) return res.status(404).json({ error: 'preset not found', presets: db.presets.map(p => p.name) });
    api.act({ t: 'preset-recall', id: p.id, take: wantsTake(req, true) });
    done(res);
  });

  r.all('/layout/:mode', (req, res) => {
    const mode = req.params.mode as LayoutMode;
    if (!LAYOUTS.includes(mode)) return res.status(400).json({ error: `layout must be one of ${LAYOUTS.join(', ')}` });
    editScene(req, s => { s.layout = mode; });
    done(res);
  });

  r.all('/caster/:n/:field/:value', (req, res) => {
    const i = Number(req.params.n) - 1;
    const field = ({ camera: 'cameraOn', name: 'showName', enabled: 'enabled' } as const)[req.params.field as 'camera'];
    if (!(i >= 0 && i < 6) || !field) return res.status(400).json({ error: 'use /caster/1-6/(camera|name|enabled)/(on|off|toggle)' });
    editScene(req, s => { s.casters[i][field] = flag(req.params.value, s.casters[i][field]); });
    done(res);
  });

  r.all('/names/:value', (req, res) => { editScene(req, s => { s.showNames = flag(req.params.value, s.showNames); }); done(res); });
  r.all('/branding/:value', (req, res) => { editScene(req, s => { s.showBranding = flag(req.params.value, s.showBranding); }); done(res); });

  r.all('/score/:team/:action{/:n}', (req, res) => {
    const team = req.params.team.toUpperCase() === 'B' ? 'B' : 'A';
    const n = Number(req.params.n ?? 1);
    const a = req.params.action;
    if (a === 'inc') api.act({ t: 'quick', op: { k: 'score', team, delta: n } });
    else if (a === 'dec') api.act({ t: 'quick', op: { k: 'score', team, delta: -n } });
    else if (a === 'set') api.act({ t: 'quick', op: { k: 'score', team, value: n } });
    else return res.status(400).json({ error: 'use /score/(a|b)/(inc|dec|set)/[n]' });
    done(res);
  });
  r.all('/scores/reset', (_req, res) => { api.act({ t: 'quick', op: { k: 'reset-scores' } }); done(res); });
  r.all('/swap', (_req, res) => { api.act({ t: 'quick', op: { k: 'swap' } }); done(res); });
  r.all('/game/:n', (req, res) => { api.act({ t: 'quick', op: { k: 'game', value: Number(req.params.n) || 1 } }); done(res); });

  r.all('/timer/start/:minutes', (req, res) => { api.act({ t: 'quick', op: { k: 'timer-start', minutes: Number(req.params.minutes) || 0 } }); done(res); });
  r.all('/timer/add/:minutes', (req, res) => { api.act({ t: 'quick', op: { k: 'timer-add', minutes: Number(req.params.minutes) || 0 } }); done(res); });
  r.all('/timer/stop', (_req, res) => { api.act({ t: 'quick', op: { k: 'timer-stop' } }); done(res); });

  // ---- tournament (producer token) ----
  r.all('/tournament', (_req, res) => {
    const t = db.tournament, rs = resolve(t);
    const name = (s: any) => (isTeam(s) ? s.name : s === 'BYE' ? 'BYE' : 'TBD');
    res.json({
      name: t.name, format: t.format, featured: t.featured, champion: champion(t, rs)?.name ?? null,
      matches: t.matches.map(m => ({ id: m.id, label: m.label, a: name(rs.get(m.id)!.a), b: name(rs.get(m.id)!.b), scoreA: m.scoreA, scoreB: m.scoreB, status: m.status, time: m.time })),
      upcoming: upcoming(t, rs).map(x => x.m.id),
      results: results(t, rs).map(x => x.m.id),
    });
  });
  r.all('/match/:id/score/:a/:b', (req, res) => {
    api.tournamentOp({ k: 'match', id: req.params.id, patch: { scoreA: Number(req.params.a), scoreB: Number(req.params.b) } });
    done(res);
  });
  r.all('/match/:id/status/:status', (req, res) => {
    const status = req.params.status as 'upcoming' | 'live' | 'done';
    if (!['upcoming', 'live', 'done'].includes(status)) return res.status(400).json({ error: 'status: upcoming | live | done' });
    api.tournamentOp({ k: 'match', id: req.params.id, patch: { status } });
    done(res);
  });
  r.all('/feature/:id', (req, res) => { api.tournamentOp({ k: 'feature', id: req.params.id === 'none' ? null : req.params.id }); done(res); });

  // ---- OverDrive Wildcard bracket ----
  r.all('/wildcard/part/:part', (req, res) => {
    const v = req.params.part, cur = db.wildcard.air;
    const part = v === 'toggle' ? (cur === 1 ? 2 : 1) : v === '2' ? 2 : v === '1' ? 1 : null;
    if (!part) return res.status(400).json({ error: 'use /wildcard/part/(1|2|toggle)' });
    api.act({ t: 'wc', op: { k: 'air', part } });
    done(res);
  });
  r.all('/wildcard/auto/:value', (req, res) => { api.act({ t: 'wc', op: { k: 'opts', patch: { rotate: flag(req.params.value, db.wildcard.opts.rotate) } } }); done(res); });
  r.all('/wildcard/cast/:id', (req, res) => {
    const id = req.params.id.toUpperCase();
    if (id !== 'NONE' && !isWcId(id)) return res.status(400).json({ error: 'use /wildcard/cast/(R1_UB2 … R5_LB2|none)' });
    api.act({ t: 'wc', op: { k: 'cast', id: id === 'NONE' ? null : id } });
    done(res);
  });
  r.all('/wildcard/pull', (_req, res) => { api.act({ t: 'wc', op: { k: 'pull' } }); done(res); });
  r.all('/wildcard/popup/:kind', (req, res) => {
    const k = req.params.kind;
    if (k === 'replay') api.act({ t: 'wc', op: { k: 'replay' } });
    else if (k === 'map' || k === 'match') api.act({ t: 'wc', op: { k: 'test', kind: k } });
    else return res.status(400).json({ error: 'use /wildcard/popup/(map|match|replay)' });
    done(res);
  });

  r.all('/ros/next', (_req, res) => { const c = db.ros.current; api.act({ t: 'ros-go', index: c == null ? 0 : Math.min(c + 1, db.ros.items.length - 1) }); done(res); });
  r.all('/ros/prev', (_req, res) => { const c = db.ros.current; api.act({ t: 'ros-go', index: c == null ? 0 : Math.max(c - 1, 0) }); done(res); });
  r.all('/ros/message/:text', (req, res) => { api.act({ t: 'ros-message', text: req.params.text === 'clear' ? '' : req.params.text }); done(res); });

  r.all('/spotlight/player/:name', (req, res) => {
    const k = req.params.name.toLowerCase();
    const p = db.players.find(x => x.id === k || x.name.toLowerCase() === k) ?? db.players.find(x => x.name.toLowerCase().startsWith(k));
    if (!p) return res.status(404).json({ error: 'player not found' });
    api.act({ t: 'quick', op: { k: 'spotlight', kind: 'player', id: p.id, seconds: Number(req.query.seconds ?? 15) || null } });
    done(res);
  });
  r.all('/spotlight/hide', (_req, res) => { api.act({ t: 'quick', op: { k: 'spotlight-hide' } }); done(res); });

  // Openplanet plugin: /spectate?name=<in-game name>&login=<account login>
  r.all('/spectate', (req, res) => { api.spectate(String(req.query.name ?? '').slice(0, 120), String(req.query.login ?? '').slice(0, 120)); res.json({ ok: true }); });
  r.all('/playercam/off', (_req, res) => { api.act({ t: 'quick', op: { k: 'active-player', id: null } }); done(res); });
  r.all('/playercam/:name', (req, res) => {
    const k = req.params.name.toLowerCase();
    const p = db.players.find(x => x.id === k || x.name.toLowerCase() === k) ?? db.players.find(x => x.name.toLowerCase().startsWith(k));
    if (!p) return res.status(404).json({ error: 'player not found' });
    api.act({ t: 'quick', op: { k: 'active-player', id: p.id } });
    done(res);
  });

  // Overdrive 2.0 engine: POST a ProducerCmd as JSON ({"c":"take"}, {"c":"stage-screen","screen":"gameplay"}, ...).
  // Answers with the engine's ack; HTTP 409 when the engine refused it (never a silent success).
  // Commands from here count as automation unless ?source=manual (manual always wins over automation).
  r.post('/engine', async (req, res) => {
    const cmd = req.body && typeof req.body === 'object' ? req.body : null;
    if (!cmd || typeof cmd.c !== 'string') return res.status(400).json({ ok: false, error: 'POST a JSON command, e.g. {"c":"publish"}' });
    const ack = await api.engine(cmd, req.query.source === 'manual' ? 'manual' : 'auto');
    res.status(ack.ok ? 200 : 409).json(ack);
  });

  r.all('/instant/:value', (req, res) => { api.act({ t: 'set-instant', on: flag(req.params.value, db.instant) }); done(res); });
  r.all('/obs/scene/:name', (req, res) => { api.act({ t: 'obs-scene', name: req.params.name }); done(res); });

  r.use((_req, res) => res.status(404).json({ error: 'unknown endpoint' }));
  return r;
}

// Openplanet plugin, embedded at build time; served with this server's URL + token filled in.
import { pluginInfo, pluginMain } from './pluginSource';
import { zip } from './zip';

export function pluginDownload() {
  const r = express.Router();
  // Old BNLCamFollow.op address kept so existing links still work.
  r.get(['/api/plugin/OverdriveCamFollow.op', '/api/plugin/BNLCamFollow.op'], (req, res) => {
    if (!isAuthed(req)) return res.status(401).send('Sign in to the controller first.');
    const host = `http://localhost:${config.port}`;
    const main = pluginMain.replace('__URL__', host).replace('__TOKEN__', db.apiToken);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="OverdriveCamFollow.op"');
    res.send(zip([{ name: 'info.toml', data: Buffer.from(pluginInfo) }, { name: 'main.as', data: Buffer.from(main) }]));
  });
  return r;
}

const MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm' };

/** Logo / sponsor uploads (controller session only). Stored in DATA_DIR/uploads. */
export function uploads() {
  const dir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const r = express.Router();
  r.post('/api/upload', express.raw({ type: Object.keys(MIME), limit: '250mb' }), async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'not signed in' });
    if (!MIME[String(req.headers['content-type']).split(';')[0]] || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'send a PNG, JPG, WebP, GIF or SVG image, or an MP4/WebM video' });
    // The file's own bytes decide its type (not the header): role = what the upload screen says it is for.
    const role = (['portrait', 'logo', 'map', 'image'].includes(String(req.query.role)) ? String(req.query.role) : 'image') as AssetRole;
    const v = validate(req.body, role === 'image' && /^video\//.test(String(req.headers['content-type'])) ? 'video' : role);
    if ('error' in v) return res.status(v.error.includes('up to') ? 413 : 400).json({ error: v.error });
    const name = `${crypto.randomBytes(9).toString('base64url')}.${v.ext}`;
    fs.writeFileSync(path.join(dir, name), req.body);
    const ref = typeof req.query.ref === 'string' ? req.query.ref.slice(0, 60) : null;
    const rec = await register(`/uploads/${name}`, req.body, v.kind === 'video' ? 'video' : role, ref);
    res.json({ url: `/uploads/${name}`, stored: rec.stored, w: rec.w, h: rec.h, alpha: rec.alpha });
  });
  r.use('/uploads', express.static(dir, {
    maxAge: '365d',
    immutable: true,
    // Uploaded SVGs are only ever images: no scripts, even if opened directly.
    setHeaders: res => res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"),
  }));
  r.use('/uploads', fromStorage('/uploads'));
  return r;
}

const AUDIO: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm' };
const AUDIO_EXT = /\.(mp3|ogg|wav|flac|m4a|aac|webm|opus)$/i;

/**
 * Music beds: DATA_DIR/music/<section>/*.mp3. Drop files into those folders or
 * upload them from the controller. Listing is public (outputs need it).
 */
export function music() {
  const base = path.join(config.dataDir, 'music');
  /** First event keeps data/music/<section>; others get data/music/events/<id>/<section>. */
  const rootOf = () => (db.activeEvent === 'bnl' || !db.activeEvent ? base : path.join(base, 'events', db.activeEvent));
  const ensure = (root: string) => { for (const s of MUSIC_SECTIONS) fs.mkdirSync(path.join(root, s), { recursive: true }); };
  ensure(base);
  const prefix = () => (rootOf() === base ? '/music' : `/music/events/${db.activeEvent}`);
  const read = (root: string, folder: string) => { try { return fs.readdirSync(path.join(root, folder)).filter(f => AUDIO_EXT.test(f)).sort(); } catch { return []; } };
  /** Each scene's own tracks; a scene with none yet uses its old shared folder (desk / results). */
  const list = () => { const root = rootOf(); ensure(root); return Object.fromEntries(MUSIC_SECTIONS.map(s => {
    let folder: string = s, files = read(root, s);
    const legacy = LEGACY_FOLDER[s];
    if (!files.length && legacy) { const old = read(root, legacy); if (old.length) { folder = legacy; files = old; } }
    // Files only in storage (this disk was wiped by a deploy) are listed too.
    const pre = `${prefix()}/${folder}/`, stored = registered(pre).map(a => decodeURIComponent(a.path.slice(pre.length))).filter(f => !f.includes('/') && AUDIO_EXT.test(f));
    files = [...new Set([...files, ...stored])].sort();
    return [s, files.map(f => ({ name: f.replace(AUDIO_EXT, '').replace(/^[A-Za-z0-9_-]{6}_/, ''), url: `${prefix()}/${folder}/${encodeURIComponent(f)}`, shared: folder !== s }))];
  })); };
  const r = express.Router();
  r.get('/api/music', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ sections: list(), folder: rootOf() }); });
  r.post('/api/music/:section', express.raw({ type: () => true, limit: '60mb' }), async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'not signed in' });
    const s = String(req.params.section) as MusicSection;
    if (!MUSIC_SECTIONS.includes(s)) return res.status(400).json({ error: 'unknown section' });
    const type = String(req.headers['content-type']).split(';')[0];
    const orig = String(req.headers['x-filename'] ?? '').replace(/[^\w .()-]/g, '').slice(0, 80);
    const ext = AUDIO[type] ?? (AUDIO_EXT.exec(orig)?.[1]?.toLowerCase());
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'send an MP3, OGG, WAV, FLAC or M4A file' });
    const base = (orig.replace(AUDIO_EXT, '') || 'track').trim();
    const v = validate(req.body, 'music');
    if ('error' in v) return res.status(v.error.includes('up to') ? 413 : 400).json({ error: v.error });
    const name = `${crypto.randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 6).padEnd(6, 'x')}_${base}.${ext}`;
    ensure(rootOf()); // a new event's folders may not exist yet
    fs.writeFileSync(path.join(rootOf(), s, name), req.body);
    await register(`${prefix()}/${s}/${encodeURIComponent(name)}`, req.body, 'music', s);
    res.json({ sections: list() });
  });
  r.delete('/api/music/:section/:file', (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'not signed in' });
    const s = String(req.params.section);
    const f = path.basename(String(req.params.file));
    if (!MUSIC_FOLDERS.includes(s) || !AUDIO_EXT.test(f)) return res.status(400).end();
    try { fs.unlinkSync(path.join(rootOf(), s, f)); } catch {}
    unregister(`${prefix()}/${s}/${encodeURIComponent(f)}`);
    res.json({ sections: list() });
  });
  r.use('/music', express.static(base, { maxAge: '1h', setHeaders: res => res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox") }));
  r.use('/music', fromStorage('/music'));
  return r;
}

/**
 * 2.0 media library for /output/media: GET /api/media (list), POST /api/media (raw body + X-Filename),
 * DELETE /api/media/:file. Files are served from /media/… (data/media).
 */
export function media() {
  const r = express.Router();
  const dir = path.join(config.dataDir, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const list = () => {
    const local = fs.readdirSync(dir).filter(f => MEDIA_EXT.test(f));
    const stored = registered('/media/').map(a => ({ f: decodeURIComponent(a.path.slice(7)), size: a.size })).filter(x => !local.includes(x.f) && MEDIA_EXT.test(x.f));
    return [...local.map(f => ({ f, size: fs.statSync(path.join(dir, f)).size })), ...stored].sort((a, b) => a.f.localeCompare(b.f)).map(({ f, size }) => ({ url: `/media/${encodeURIComponent(f)}`, name: mediaName(f), size }));
  };
  r.get('/api/media', (req, res) => { if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' }); res.setHeader('Cache-Control', 'no-store'); res.json({ items: list() }); });
  r.post('/api/media', express.raw({ type: () => true, limit: '1gb' }), async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' });
    const raw = path.basename(decodeURIComponent(String(req.header('X-Filename') ?? ''))).replace(/[^\w .()-]/g, '').slice(-120);
    if (!MEDIA_EXT.test(raw) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Send a video, audio or image file (mp4, webm, mov, mp3, wav, png, jpg…)' });
    const v = validate(req.body, 'media');
    if ('error' in v) return res.status(v.error.includes('up to') ? 413 : 400).json({ error: v.error });
    const name = `${crypto.randomBytes(4).toString('base64url').slice(0, 6)}_${raw}`;
    fs.writeFileSync(path.join(dir, name), req.body);
    await register(`/media/${encodeURIComponent(name)}`, req.body, 'media');
    res.json({ ok: true, items: list() });
  });
  r.delete('/api/media/:file', (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' });
    const f = path.basename(String(req.params.file));
    if (!MEDIA_EXT.test(f)) return res.status(400).end();
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
    unregister(`/media/${encodeURIComponent(f)}`);
    res.json({ ok: true, items: list() });
  });
  r.use('/media', express.static(dir, { maxAge: '1h', setHeaders: res => res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox") }));
  r.use('/media', fromStorage('/media'));
  return r;
}

import crypto from 'node:crypto';
import express, { type Request } from 'express';
import { isAuthed } from './auth';
import { db, save } from './store';
import { CASTER_IDS, type CasterId } from '../shared/types';
import { GAMEFEED_MODES, gameFeedReady, sanitizeGameFeed, type GameFeedMode } from '../shared/gamefeed';

/**
 * Game feed for casters: the low-latency OBS feed from the MediaMTX server (WHEP), played on the
 * casters' camera pages. The browser sends its WebRTC offer here; this server forwards it to the
 * MediaMTX WHEP endpoint with the caster login (kept here, never sent to browsers) and returns the
 * answer. The video then flows straight from MediaMTX to the caster, so no delay is added, and an
 * https page can use an http-only stream server (no mixed content, no CORS).
 */

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** A caster page (?slot=&key=) or a signed-in producer. */
function allowed(req: Request): boolean {
  if (isAuthed(req)) return true;
  const slot = Number(req.query.slot) as CasterId, key = String(req.query.key ?? '');
  const t = typeof req.query.talent === 'string' ? db.talent.find(p => p.id === req.query.talent) : undefined;
  if (t) return !!key && safeEq(key, t.key);
  return CASTER_IDS.includes(slot) && !!key && safeEq(key, db.contributorKeys[slot] ?? '');
}

/** Open sessions: our id → the MediaMTX session URL (for hang-up). */
const sessions = new Map<string, { url: string; at: number }>();
setInterval(() => { const old = Date.now() - 12 * 3600_000; for (const [k, s] of sessions) if (s.at < old) sessions.delete(k); }, 600_000).unref();

export function gameFeed() {
  const r = express.Router();

  // What a caster page needs: is there a feed, and the default latency mode. No URL, no password.
  r.get('/gamefeed/config', (req, res) => {
    if (!allowed(req)) return res.status(401).json({ error: 'not allowed' });
    const g = db.gameFeed;
    res.json({ enabled: g.enabled && gameFeedReady(g), mode: g.mode, modes: GAMEFEED_MODES, source: g.source, ...(g.source === 'vdo' ? { vdoUrl: g.vdoUrl } : {}) });
  });

  // Producer settings (password write-only: only "is there one" comes back).
  r.get('/gamefeed/settings', (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'not signed in' });
    const { pass, ...rest } = db.gameFeed;
    res.json({ ...rest, hasPass: !!pass });
  });
  r.post('/gamefeed/settings', express.json({ limit: '8kb' }), (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'not signed in' });
    const b = req.body ?? {};
    // An empty password field keeps the saved one.
    db.gameFeed = sanitizeGameFeed({ ...db.gameFeed, ...b, pass: typeof b.pass === 'string' && b.pass ? b.pass : db.gameFeed.pass });
    save();
    const { pass, ...rest } = db.gameFeed;
    res.json({ ...rest, hasPass: !!pass });
  });

  // WHEP offer → MediaMTX → answer.
  r.post('/gamefeed/whep', express.text({ type: 'application/sdp', limit: '64kb' }), async (req, res) => {
    if (!allowed(req)) return res.status(401).json({ error: 'not allowed' });
    const g = db.gameFeed;
    if (!g.enabled || g.source !== 'whep' || !g.url) return res.status(503).json({ error: 'game feed is off' });
    if (typeof req.body !== 'string' || !req.body.startsWith('v=')) return res.status(400).json({ error: 'send an SDP offer' });
    try {
      const up = await fetch(g.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', ...(g.user || g.pass ? { Authorization: 'Basic ' + Buffer.from(`${g.user}:${g.pass}`).toString('base64') } : {}) },
        body: req.body,
        signal: AbortSignal.timeout(8000),
      });
      if (!up.ok) return res.status(up.status === 404 ? 404 : up.status === 401 ? 502 : up.status).json({ error: up.status === 404 ? 'no stream yet (OBS not sending)' : up.status === 401 ? 'stream server refused the login (check the game feed settings)' : `stream server answered ${up.status}` });
      const answer = await up.text();
      const loc = up.headers.get('location');
      const id = crypto.randomBytes(9).toString('base64url');
      if (loc) sessions.set(id, { url: new URL(loc, g.url).toString(), at: Date.now() });
      res.status(201).setHeader('Content-Type', 'application/sdp').setHeader('X-Session', id).send(answer);
    } catch (e: any) {
      res.status(502).json({ error: `can't reach the stream server (${e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? e})` });
    }
  });

  // Hang up (page closed or reconnecting).
  r.delete('/gamefeed/session/:id', async (req, res) => {
    if (!allowed(req)) return res.status(401).end();
    const s = sessions.get(req.params.id);
    sessions.delete(req.params.id);
    if (s) {
      const g = db.gameFeed;
      fetch(s.url, { method: 'DELETE', headers: g.user || g.pass ? { Authorization: 'Basic ' + Buffer.from(`${g.user}:${g.pass}`).toString('base64') } : {}, signal: AbortSignal.timeout(4000) }).catch(() => {});
    }
    res.status(204).end();
  });

  return r;
}

export type { GameFeedMode };

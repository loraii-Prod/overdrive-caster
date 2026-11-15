/**
 * Staff pick'em page API (/staff-picks?key=…): the board and the picks. The key is the staff link's secret
 * (Studio → Graphics & Data → Staff pick'em: copy / replace the link). Anyone with the link can pick under any
 * staff name: it is an internal page for trusted staff, not a public vote.
 */
import crypto from 'node:crypto';
import express from 'express';
import { db, save } from './store';
import { cleanName, staffBoard, staffPick } from '../shared/staffPicks';

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function staffPicksApi(changed: () => void) {
  const r = express.Router();
  const hits = new Map<string, { n: number; at: number }>();
  const keyOk = (k: unknown) => typeof k === 'string' && k.length > 0 && safeEq(k, db.staffPicks.key);
  r.get('/api/staff-picks', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!keyOk(req.query.key)) return res.status(403).json({ error: 'This staff pick\'em link is invalid or has been replaced. Ask the producer for the new one.' });
    const me = cleanName(req.query.name) || null;
    res.json(staffBoard(db.staffPicks, db.wildcard, me));
  });
  r.post('/api/staff-picks', (req, res) => {
    const b = req.body ?? {};
    if (!keyOk(b.key)) return res.status(403).json({ error: 'This staff pick\'em link is invalid or has been replaced. Ask the producer for the new one.' });
    const ip = req.ip ?? '?', now = Date.now(), h = hits.get(ip);
    if (h && now - h.at < 10_000) { if (++h.n > 40) return res.status(429).json({ error: 'Too many changes: wait a few seconds' }); } else hits.set(ip, { n: 1, at: now });
    const pick = b.pick === null ? null : { team: String(b.pick?.team ?? ''), score: String(b.pick?.score ?? '') };
    const e = staffPick(db.staffPicks, db.wildcard, String(b.name ?? ''), String(b.match ?? ''), pick);
    if (e) return res.status(400).json({ error: e });
    save(); changed();
    res.json(staffBoard(db.staffPicks, db.wildcard, cleanName(b.name)));
  });
  return r;
}

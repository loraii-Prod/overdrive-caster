/** Producer-only recovery API: status, snapshot list, snapshot now, restore (then the server restarts). */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { isAuthed } from './auth';
import { flush, freeze } from './store';
import { applyRestore, history, listSnapshots, readSnapshot, snapshot, status } from './durable';

export function persistApi() {
  const r = express.Router();
  r.get('/api/persist', async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' });
    res.setHeader('Cache-Control', 'no-store');
    const [snaps, hist] = await Promise.all([listSnapshots().catch(() => []), history(30).catch(() => [])]);
    res.json({ status, snapshots: snaps.slice(0, 60), history: hist });
  });
  r.post('/api/persist/snapshot', async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' });
    flush();
    const k = await snapshot('manual');
    k ? res.json({ ok: true, key: k }) : res.status(503).json({ error: status.snapshots === 'off' ? 'Snapshot storage is not configured' : status.error ?? 'Snapshot failed' });
  });
  // The current show state as a file, for an off-site copy or a rollback to an older build. It holds the API token
  // and talent/camera keys: producer only, never cached.
  r.get('/api/persist/download', (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' });
    flush();
    const f = path.join(config.dataDir, 'state.json');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'No saved state yet' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="overdrive-state-${new Date().toISOString().replace(/[:.]/g, '-')}.json"`);
    fs.createReadStream(f).pipe(res);
  });
  r.post('/api/persist/restore', express.json(), async (req, res) => {
    if (!isAuthed(req)) return res.status(401).json({ error: 'sign in' });
    if (req.body?.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm' });
    const key = String(req.body?.key ?? '');
    const snap = await readSnapshot(key);
    if ('error' in snap) return res.status(400).json({ error: snap.error });
    flush(); freeze();
    await applyRestore(snap.json, key);
    res.json({ ok: true, note: 'Restored. The server restarts now; outputs reconnect by themselves.' });
    // The running show holds the old state in memory: restart so every part loads the restored one.
    setTimeout(() => process.exit(0), 800);
  });
  return r;
}

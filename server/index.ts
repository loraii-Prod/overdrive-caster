import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config';
import { announcePassword, checkPassword, COOKIE, cookieOptions, createSession, destroySession, loginAllowed, noteFailure, roleFrom, sessionFrom } from './auth';
import { flush } from './store';
import { createHub } from './hub';
import { controlApi, music, pluginDownload, uploads } from './api';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));
const server = http.createServer(app);
const hub = createHub(server);
app.use('/api/v1', controlApi(hub.api));
app.use(uploads());
app.use(music());
app.use(pluginDownload());

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/api/session', (req, res) => { const role = roleFrom(req); res.json({ authed: role === 'producer', role }); });

app.post('/api/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (!loginAllowed(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const role = checkPassword(String(req.body?.password ?? ''));
  if (!role) {
    noteFailure(ip);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  res.cookie(COOKIE, createSession(role), cookieOptions());
  res.json({ ok: true, role });
});

// Restart (the Windows launcher brings the server straight back up). Producer only.
app.post('/api/restart', (req, res) => {
  if (roleFrom(req) !== 'producer') return res.status(401).json({ error: 'not signed in' });
  res.json({ ok: true });
  setTimeout(() => { try { flush(); } catch {} process.exit(0); }, 200);
});

app.post('/api/logout', (req, res) => {
  destroySession(sessionFrom(req));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Production: serve the built SPA. In dev Vite serves it and proxies /api + /ws here.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = [path.join(here, 'client'), path.join(here, '../dist/client')].find(d => fs.existsSync(path.join(d, 'index.html')));
if (clientDir) {
  app.use(express.static(clientDir, {
    index: false,
    setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  const html = path.join(clientDir, 'index.html');
  app.get(/^\/(?!api\/|ws|uploads\/|music\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(html);
  });
}

server.listen(config.port, config.host, () => {
  console.log(`GLACIAL caster system on http://localhost:${config.port}`);
  console.log(`  controller  /controller`);
  console.log(`  outputs     /output/casters  /output/solo  /output/duo  /output/trio  /output/names  /output/branding  /output/audio/1..3`);
  console.log(`  cameras     /contribute/1..3?key=…  (links shown in the controller)`);
  console.log(`  screens     /output/program  /output/starting  /output/brb  /output/ending  /output/scoreboard  /output/ticker`);
  console.log(`  control API /api/v1/…  (token shown in the controller → Integrations)`);
  if (!clientDir) console.log('  (no built client found – run `npm run dev` or `npm run build`)');
  announcePassword();
});

const shutdown = () => { try { flush(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', e => console.error('[uncaught]', e)); // never take the show down
process.on('unhandledRejection', e => console.error('[unhandled]', e));

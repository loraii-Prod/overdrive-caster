/**
 * Read-only backup of a RUNNING Overdrive server (works against the live 2.2.4 build; nothing on it changes).
 * Secondary to the Render-shell tar of DATA_DIR (see docs/BACKUP-AND-ROLLBACK.md); this one needs no SSH key.
 *
 *   OD_URL=https://overdrive-caster.onrender.com OD_PASSWORD=… npx tsx scripts/backup-live.ts [out-dir]
 *
 * Writes <out-dir>/ (default ./od-backup-<time>/):
 *   messages.json   everything the server sends a signed-in producer: show/rundown/graphics/talent/seats/events,
 *                   Wildcard bracket (wc), tournament, match data, media + music state. Contains the API token
 *                   and crew key: keep the folder private (never in GitHub).
 *   wildcard.json   the Wildcard state on its own, in the format Wildcard → "Restore backup" accepts.
 *   files/…         every uploaded file the show references or lists (/uploads, /media, /music), byte-exact.
 *   manifest.json   each file: address, size, sha256, where it is used; plus counts and anything missing.
 * Credentials only from the environment; the password is never printed or written.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';

const base = (process.env.OD_URL ?? '').replace(/\/$/, ''), pw = process.env.OD_PASSWORD ?? '';
if (!base || !pw) { console.error('Set OD_URL and OD_PASSWORD'); process.exit(1); }
const out = path.resolve(process.argv[2] ?? `od-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(path.join(out, 'files'), { recursive: true });

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
if (!login.ok) { console.error(`Producer sign-in failed (${login.status})`); process.exit(1); }
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const get = (p: string) => fetch(base + p, { headers: { cookie } });

// Everything a controller is sent on connect (welcome + state + live + ros + media + gfx + tournament + matchData + wildcard + twitch).
const msgs: Record<string, any> = await new Promise((res, rej) => {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { cookie } }), got: Record<string, any> = {};
  const done = () => { clearTimeout(t); try { ws.close(); } catch { /* closed */ } res(got); };
  const t = setTimeout(done, 8000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' })));
  ws.on('message', d => {
    const m = JSON.parse(String(d));
    if (m.t === 'error') { clearTimeout(t); rej(new Error(m.message)); return; }
    if (!['pong', 'rtc-publisher', 'presence'].includes(m.t)) got[m.t] = m;
    if (got.state && got.wildcard && got.tournament && got.live && got.media) setTimeout(done, 800); // let the rest arrive
  });
  ws.on('error', rej);
});
if (!msgs.state) { console.error('Did not receive the show state (sign-in / version problem). Nothing written.'); process.exit(1); }
delete msgs.welcome?.iceServers; // short-lived TURN credentials, useless later
fs.writeFileSync(path.join(out, 'messages.json'), JSON.stringify(msgs, null, 1));
if (msgs.wildcard?.wc) fs.writeFileSync(path.join(out, 'wildcard.json'), JSON.stringify(msgs.wildcard.wc, null, 1));

// Every file address anywhere in what we received, plus the media and music libraries.
const refs = new Map<string, Set<string>>();
const walk = (v: unknown, where: string) => {
  if (typeof v === 'string') { const m = v.match(/^\/(uploads|media|music)\/[^?#]+/); if (m) (refs.get(m[0]) ?? refs.set(m[0], new Set()).get(m[0])!).add(where); return; }
  if (Array.isArray(v)) v.forEach(x => walk(x, where));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where.split('.').length < 4 ? `${where}.${k}` : where);
};
for (const [t, m] of Object.entries(msgs)) walk(m, t);
const media = await get('/api/media'); if (media.ok) for (const it of (await media.json()).items ?? []) walk(it.url, 'media library');
const music = await get('/api/music'); if (music.ok) walk((await music.json()).sections, 'music library');

const files: any[] = [], missing: any[] = [];
for (const [url, where] of [...refs].sort()) {
  const r = await get(url);
  if (!r.ok) { missing.push({ url, status: r.status, where: [...where] }); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  const rel = decodeURIComponent(url.slice(1));
  if (rel.includes('..')) { missing.push({ url, status: 'unsafe path', where: [...where] }); continue; }
  fs.mkdirSync(path.dirname(path.join(out, 'files', rel)), { recursive: true });
  fs.writeFileSync(path.join(out, 'files', rel), buf);
  files.push({ url, file: `files/${rel}`, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), type: r.headers.get('content-type'), where: [...where] });
}
const manifest = { from: base, at: new Date().toISOString(), messages: Object.keys(msgs), files, missing,
  counts: { files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), missing: missing.length,
            events: msgs.state?.state?.events?.length ?? null, talent: msgs.state?.state?.talent?.length ?? null } };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`Backup written to ${out}\n  ${files.length} files (${(manifest.counts.bytes / 1e6).toFixed(1)} MB), ${missing.length} missing, messages: ${manifest.messages.join(', ')}`);
if (missing.length) { console.log('  Missing (referenced but not served):'); for (const m of missing) console.log(`   ${m.status}  ${m.url}  (${m.where.join('; ')})`); }

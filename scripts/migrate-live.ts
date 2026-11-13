/**
 * Pre-deploy asset migration: copies every uploaded file the RUNNING Overdrive server uses (portraits, map photos,
 * logos, media, music) into the R2 bucket, and writes registry/seed-<time>.json there. The next deploy (with
 * storage configured) imports that seed, so the same addresses keep working after the disk is wiped.
 *
 * Read-only on the live server. Credentials only from the environment (never arguments, never printed):
 *   OD_URL=https://overdrive-caster.onrender.com OD_PASSWORD=… R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *   npx tsx scripts/migrate-live.ts            # add --dry-run to only list what would be copied
 * Writes a report to ./asset-migration-report.md.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { S3, s3Conf } from '../server/s3';
import { sniff, imageInfo } from '../server/filecheck';
import { playerIdOf } from '../shared/playerIds';

const base = (process.env.OD_URL ?? '').replace(/\/$/, ''), pw = process.env.OD_PASSWORD ?? '', dry = process.argv.includes('--dry-run');
if (!base || !pw) { console.error('Set OD_URL and OD_PASSWORD'); process.exit(1); }
const conf = s3Conf();
if (!conf && !dry) { console.error('Set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'); process.exit(1); }
const s3 = conf ? new S3(conf) : null;

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
if (!login.ok) { console.error('Producer sign-in failed'); process.exit(1); }
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const get = (p: string) => fetch(base + p, { headers: { cookie } });

// What the live show references: the outputs' view (wildcard state, live show, tournament) + media + music lists.
const live: Record<string, any> = await new Promise((res, rej) => {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws'), got: Record<string, any> = {};
  const t = setTimeout(() => { ws.close(); res(got); }, 6000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'output', route: 'migrate' })));
  ws.on('message', d => { const m = JSON.parse(String(d)); if (m.t === 'wildcard') got.wc = m.wc; if (m.t === 'live') got.show = m.show; if (m.t === 'tournament') got.tournament = m.tournament; if (got.wc && got.show && got.tournament) { clearTimeout(t); ws.close(); res(got); } });
  ws.on('error', rej);
});
const refs = new Map<string, { where: string; role: string; ref: string | null }>();
const add = (url: unknown, where: string, role: string, ref: string | null = null) => { if (typeof url === 'string' && /^\/(uploads|media|music)\//.test(url) && !refs.has(url)) refs.set(url, { where, role, ref }); };
for (const [k, u] of Object.entries(live.wc?.showcase?.photos ?? {})) add(u, `portrait ${k}`, 'portrait', playerIdOf(k));
for (const [k, u] of Object.entries(live.wc?.mapPhotos ?? {})) add(u, `map photo ${k}`, 'map', k);
const walk = (o: any, where: string, d = 0) => { if (d > 6 || !o) return; if (typeof o === 'string') return add(o, where, 'image'); if (typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${where}.${k}`, d + 1); };
walk(live.show?.brand, 'brand'); walk(live.tournament, 'tournament');
const media = await get('/api/media').then(r => (r.ok ? r.json() : { items: [] })) as any;
for (const i of media.items ?? []) add(i.url, 'media library', 'media');
const music = await get('/api/music').then(r => (r.ok ? r.json() : { sections: {} })) as any;
for (const [sec, list] of Object.entries(music.sections ?? {})) for (const t of list as any[]) add(t.url, `music ${sec}`, 'music', sec);

const assets: any[] = [], lines: string[] = [], failed: string[] = [];
for (const [url, r] of refs) {
  try {
    const res = await get(url);
    if (!res.ok) { failed.push(`${url} (${r.where}): HTTP ${res.status}`); continue; }
    const b = Buffer.from(await res.arrayBuffer()), t = sniff(b);
    if (!t) { failed.push(`${url} (${r.where}): unknown file type`); continue; }
    const h = crypto.createHash('sha256').update(b).digest('hex'), ext = url.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') || t.ext;
    const role = r.role === 'image' && t.kind === 'video' ? 'video' : r.role, key = `assets/${role}/${h}.${ext}`;
    const info = t.kind === 'image' ? imageInfo(b, t.mime) : null;
    if (!dry) { if (!(await s3!.head(key))) await s3!.put(key, b, t.mime, { path: encodeURIComponent(url).slice(0, 500) }); }
    assets.push({ id: crypto.randomBytes(6).toString('base64url'), role, ref: r.ref, path: url, key, sha256: h, size: b.length, mime: t.mime, ...(info ?? {}), created: Date.now(), status: 'approved', state: dry ? 'pending' : 'stored', stored: !dry });
    lines.push(`| ${r.where} | \`${url}\` | ${role}${r.ref ? ` → ${r.ref}` : ''} | ${(b.length / 1024).toFixed(0)} KB${info ? ` · ${info.w}×${info.h}${info.alpha ? ' · transparent' : ''}` : ''} |`);
  } catch (e: any) { failed.push(`${url} (${r.where}): ${e.message}`); }
}
const unmatched = Object.keys(live.wc?.showcase?.photos ?? {}).filter(k => !playerIdOf(k));
if (!dry && assets.length) await s3!.put(`registry/seed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, Buffer.from(JSON.stringify({ from: base, at: Date.now(), assets })), 'application/json');
fs.writeFileSync('asset-migration-report.md', [
  `# Asset migration report`, ``, `From ${base} · ${new Date().toISOString()} · ${dry ? 'DRY RUN (nothing copied)' : 'copied to the bucket'}`, ``,
  `${assets.length} copied · ${failed.length} failed · ${unmatched.length} portraits not linked to a player id`, ``,
  `| Used by | Address | Kind | Size |`, `| --- | --- | --- | --- |`, ...lines, ``,
  failed.length ? `## Failed\n\n${failed.map(f => `- ${f}`).join('\n')}` : '## Failed\n\nNone.', ``,
  unmatched.length ? `## Portraits kept but not linked (no exact Major player match)\n\n${unmatched.map(k => `- ${k}`).join('\n')}` : '',
].join('\n'));
console.log(`${assets.length} assets ${dry ? 'found' : 'copied'}, ${failed.length} failed. Report: asset-migration-report.md`);

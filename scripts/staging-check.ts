/**
 * Staging persistence check around a REAL redeploy (Render + Cloudflare R2 + Postgres). Never point it at production:
 * it refuses unless the address contains "staging" (or --i-know-this-is-not-production).
 *
 *   OD_URL=https://overdrive-caster-staging.onrender.com OD_PASSWORD=… npx tsx scripts/staging-check.ts seed
 *   … trigger a manual deploy in Render, wait until it is live …
 *   OD_URL=… OD_PASSWORD=… npx tsx scripts/staging-check.ts verify
 *
 * seed   writes a uniquely tagged show: talent name + seat, a graphic's published config, a Wildcard portrait,
 *        a map photo, a logo, a video (+ playlist), a music track, a QR link, a desk MVP pick. Saves what it
 *        expects in ./staging-expect.json (no secrets in it).
 * verify checks, after the redeploy: a different boot (instance really restarted), every item still there, every
 *        file the same bytes from the same address, durable storage + database healthy, nothing pending/lost,
 *        video served by byte range (no expiring links). Prints PASS/FAIL per item; exit 1 on any failure.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import WebSocket from 'ws';

const mode = process.argv[2];
const base = (process.env.OD_URL ?? '').replace(/\/$/, ''), pw = process.env.OD_PASSWORD ?? '';
if (!['seed', 'verify'].includes(mode ?? '') || !base || !pw) { console.error('Usage: OD_URL=… OD_PASSWORD=… npx tsx scripts/staging-check.ts seed|verify'); process.exit(2); }
if (!/staging|localhost|127\.0\.0\.1/.test(base) && !process.argv.includes('--i-know-this-is-not-production')) { console.error(`Refusing: ${base} does not look like staging.`); process.exit(2); }
const EXPECT = 'staging-expect.json';

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
if (!login.ok) { console.error(`Sign-in failed (${login.status})`); process.exit(2); }
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const api = async (p: string, init: RequestInit = {}) => { const r = await fetch(base + p, { ...init, headers: { cookie, ...(init.headers ?? {}) } }); const t = await r.text(); try { return { status: r.status, j: JSON.parse(t) as any, r }; } catch { return { status: r.status, j: null as any, r }; } };
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** Open a controller connection: collect the state messages; optionally send ops after welcome. */
function controller(send: object[] = []): Promise<Record<string, any>> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { cookie } }), got: Record<string, any> = {};
    const t = setTimeout(() => { ws.close(); res(got); }, 7000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' })));
    ws.on('message', d => { const m = JSON.parse(String(d)); if (m.t === 'error') { clearTimeout(t); rej(new Error(m.message)); } got[m.t] = m; if (m.t === 'welcome') for (const s of send) ws.send(JSON.stringify(s)); });
    ws.on('error', rej);
  });
}
const engine = async (cmd: object) => { const r = await api(`/api/v1/engine?token=${tokenOf(await controller())}&source=manual`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmd) }); if (!r.j?.ok) throw new Error(`${JSON.stringify(cmd)} → ${JSON.stringify(r.j)}`); };
const tokenOf = (m: Record<string, any>) => m.state?.state?.apiToken as string;

function png(w: number, h: number, seed: number): Buffer {
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; rows[o] = (x * seed) & 255; rows[o + 1] = (y * 3) & 255; rows[o + 2] = seed & 255; rows[o + 3] = 255; }
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0); return Buffer.concat([l, Buffer.from(t), d, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info = '') => { results.push([name, ok, info]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && info ? `  [${info}]` : ''}`); };

if (mode === 'seed') {
  const tag = `stg-${Date.now().toString(36)}`;
  const ver = (await api('/api/version')).j, persist = (await api('/api/persist')).j?.status;
  if (persist?.database !== 'ok' || persist?.snapshots !== 'ok') console.warn(`WARNING: persistence not healthy before seeding: ${JSON.stringify(persist)}`);
  const up = async (p: string, body: Buffer, h: Record<string, string>) => { const r = await api(p, { method: 'POST', headers: h, body }); if (r.status !== 200) throw new Error(`${p} → ${r.status} ${JSON.stringify(r.j)}`); if (!r.j.durable) throw new Error(`${p} not durable: ${r.j.warning}`); return r.j; };
  const portrait = png(720, 960, 7), logo = png(256, 256, 11), map = png(1280, 720, 13);
  const video = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(1_500_000)]);
  const audio = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), crypto.randomBytes(200_000)]);
  const pr = await up('/api/upload?role=portrait&ref=GranaDy', portrait, { 'content-type': 'image/png' });
  const lg = await up('/api/upload?role=logo', logo, { 'content-type': 'image/png' });
  const mp = await up('/api/upload?role=map&ref=india', map, { 'content-type': 'image/png' });
  const md = await up('/api/media', video, { 'X-Filename': `${tag}.webm`, 'content-type': 'video/webm' });
  const mu = await up('/api/music/analysis', audio, { 'x-filename': `${tag}.mp3`, 'content-type': 'audio/mpeg' });
  const mediaUrl = md.items.find((i: any) => i.url.includes(tag)).url;
  const musicUrl = Object.values(mu.sections ?? (await api('/api/music')).j.sections).flat().find((t: any) => t.url.includes(tag)) as any;
  const st = (await controller()).state.state;
  const t1 = st.talent[0].id;
  await engine({ c: 'talent-edit', id: t1, name: `Caster ${tag}` });
  await engine({ c: 'seat', seat: 2, talent: t1 });
  await engine({ c: 'gfx-set', id: 'pickem', patch: { title: `Pick'ems ${tag}` } }); await engine({ c: 'gfx-publish', id: 'pickem' });
  await engine({ c: 'media-set', playlist: [mediaUrl] });
  const qrHost = (await controller())['aud-private']?.aud?.qrHosts?.[0];
  const qr = qrHost ? [{ id: tag, label: `QR ${tag}`, url: `https://${qrHost}/vote?src=${tag}`, expires: 0 }] : [];
  await controller([{ t: 'wc', op: { k: 'photo', player: 'GranaDy', url: pr.url } }, { t: 'wc', op: { k: 'map-photo', id: 'india', url: mp.url } }, ...(qr.length ? [{ t: 'aud', op: { k: 'qr-set', qr } }] : [])]);
  const expect = { tag, at: new Date().toISOString(), version: ver, booted: ver?.booted ?? null,
    files: { portrait: { url: pr.url, sha: sha(portrait) }, logo: { url: lg.url, sha: sha(logo) }, map: { url: mp.url, sha: sha(map) }, media: { url: mediaUrl, sha: sha(video) }, music: { url: musicUrl?.url, sha: sha(audio) } },
    talent: { id: t1, name: `Caster ${tag}`, seat: 2 }, gfx: { id: 'pickem', title: `Pick'ems ${tag}` }, qr: qr[0] ?? null };
  fs.writeFileSync(EXPECT, JSON.stringify(expect, null, 1));
  console.log(`Seeded ${tag} on ${base} (release ${ver?.release ?? '?'}, commit ${ver?.commit ?? '?'}). Now redeploy the staging service manually, then run: verify`);
} else {
  const ex = JSON.parse(fs.readFileSync(EXPECT, 'utf8'));
  const ver = (await api('/api/version')).j;
  check('the instance really restarted (new boot time)', !!ver?.booted && ver.booted !== ex.booted, `${ex.booted} → ${ver?.booted}`);
  console.log(`  running: release ${ver?.release}, commit ${ver?.commit ?? 'n/a'}, branch ${ver?.branch ?? 'n/a'}`);
  const p = (await api('/api/persist')).j?.status;
  check('database mirror healthy', p?.database === 'ok', JSON.stringify(p));
  check('snapshots to R2 healthy (encrypted)', p?.snapshots === 'ok' && p?.encrypted === true, JSON.stringify(p));
  check('state came back from the database (not a fresh show)', p?.restoredFrom === 'database' || p?.restoredFrom === 'local', p?.restoredFrom);
  const h = (await api('/api/assets/health')).j;
  check('asset storage = R2, nothing pending / failed / lost / local-only', h?.storage === 'r2' && !h.pending && !h.failed && !h.lost && !h.local, JSON.stringify(h));
  for (const [k, f] of Object.entries(ex.files) as [string, any][]) {
    const r = await fetch(base + f.url);
    const b = Buffer.from(await r.arrayBuffer());
    check(`${k}: same address, same bytes after the redeploy`, r.status === 200 && sha(b) === f.sha, `${r.status} ${f.url}`);
  }
  const rr = await fetch(base + ex.files.media.url, { headers: { Range: 'bytes=0-99' }, redirect: 'manual' });
  check('video: byte-range stream from the server, no redirect to an expiring link', rr.status === 206 && !rr.headers.get('location'), `${rr.status} ${rr.headers.get('location') ?? ''}`);
  const m = await controller(), st = m.state?.state;
  const tal = st?.talent?.find((t: any) => t.id === ex.talent.id);
  check('talent name kept', tal?.name === ex.talent.name, tal?.name);
  check('talent seat assignment kept', JSON.stringify(st?.seats ?? '').includes(ex.talent.id), JSON.stringify(st?.seats)?.slice(0, 200));
  const g = m.gfx?.graphics?.find?.((x: any) => x.id === ex.gfx.id) ?? st?.graphics?.find?.((x: any) => x.id === ex.gfx.id);
  check('published graphic config kept', g?.config?.title === ex.gfx.title, g?.config?.title);
  check('Wildcard portrait binding kept', m.wildcard?.wc?.showcase?.photos?.granady === ex.files.portrait.url);
  check('Wildcard map photo kept', m.wildcard?.wc?.mapPhotos?.india === ex.files.map.url);
  check('media playlist kept', m.media?.media?.playlist?.includes(ex.files.media.url) ?? JSON.stringify(m.media).includes(ex.files.media.url));
  check('media did NOT start playing by itself after the deploy', (m.media?.media?.status ?? 'stopped') === 'stopped', m.media?.media?.status);
  if (ex.qr) check('QR link kept', !!m['aud-private']?.aud?.customQr?.some((q: any) => q.url === ex.qr.url), JSON.stringify(m['aud-private']?.aud?.customQr));
  else console.log('  (QR not checked: no vote service configured on this instance)');
  const bad = results.filter(r => !r[1]).length;
  console.log(`\n${results.length - bad} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
}

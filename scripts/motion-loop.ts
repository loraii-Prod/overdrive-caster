/**
 * Loops the animations most at risk of GPU scaling artifacts, so they can be watched and recorded in REAL OBS at
 * 3840×2160 (docs/4K-PERF-TEST.md, step 5). It only drives Overdrive's own engine through the API token, on a
 * REHEARSAL show: it changes the booth, names, screens and map card on Program. It never touches OBS.
 *
 *   OD_URL=http://localhost:8787 OD_TOKEN=<Controller → Integrations token> npx tsx scripts/motion-loop.ts [rounds]
 *
 * Each round (~14 s): nameplates out/in · layout change 1 → 2 casters (tile move + logo sting) · desk masks 2 → 1 → 2
 * · map card (India) · stinger take BRB → Starting soon → BRB. Ctrl+C to stop; the last state is BRB on Program.
 */
const base = (process.env.OD_URL ?? 'http://localhost:8787').replace(/\/$/, ''), token = process.env.OD_TOKEN ?? '';
if (!token) { console.error('Set OD_TOKEN (Controller → Settings → Integrations).'); process.exit(1); }
if (!/localhost|127\.0\.0\.1|staging|\.local\b|192\.168\.|10\./.test(base) && !process.argv.includes('--yes-this-is-a-rehearsal')) { console.error(`Refusing on ${base}: run it on a rehearsal instance (or pass --yes-this-is-a-rehearsal).`); process.exit(1); }
const rounds = Number(process.argv.find(a => /^\d+$/.test(a)) ?? 20);
const cmd = async (c: object) => { const r = await fetch(`${base}/api/v1/engine?token=${encodeURIComponent(token)}&source=manual`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }); return r.status === 409 ? 'same' : r.ok ? 'ok' : `HTTP ${r.status}`; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const step = async (label: string, cs: object[], hold: number) => { const res = []; for (const c of cs) res.push(await cmd(c)); console.log(`${new Date().toISOString().slice(11, 23)}  ${label.padEnd(34)} ${res.join(', ')}`); await wait(hold); };

for (let i = 1; i <= rounds; i++) {
  console.log(`— round ${i}/${rounds}`);
  await step('booth: 2 casters (names on)', [{ c: 'stage-screen', screen: 'casters' }, { c: 'stage-booth', ids: [1, 2] }, { c: 'stage-flag', flag: 'names', on: true }, { c: 'take', transition: 'cut' }], 1500);
  await step('nameplates OUT', [{ c: 'stage-flag', flag: 'names', on: false }, { c: 'take' }], 1200);
  await step('nameplates IN', [{ c: 'stage-flag', flag: 'names', on: true }, { c: 'take' }], 1500);
  await step('layout 2 → 1 (tiles move, sting)', [{ c: 'stage-booth', ids: [1] }, { c: 'take' }], 1500);
  await step('layout 1 → 2 (tiles move, sting)', [{ c: 'stage-booth', ids: [1, 2] }, { c: 'take' }], 1800);
  await step('map card India (gameplay screen)', [{ c: 'stage-screen', screen: 'gameplay' }, { c: 'take', transition: 'cut' }, { c: 'graphic', g: 'map-card', map: 'india' }], 2500);
  await step('stinger → Starting soon', [{ c: 'stage-screen', screen: 'starting' }, { c: 'take', transition: 'stinger' }], 2500);
  await step('stinger → BRB', [{ c: 'stage-screen', screen: 'brb' }, { c: 'take', transition: 'stinger' }], 2500);
}

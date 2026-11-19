/**
 * OBS Scene Builder — real-OBS visual audit (read-only).
 *
 * Connects directly to a REAL OBS (obs-websocket v5) and to a running Overdrive server (optional, over the
 * existing controller WebSocket — the same connection the Producer page uses) and produces a self-contained
 * HTML report comparing the ACTUAL OBS scene collection against the layout Overdrive's Scene Builder expects:
 * scene list, every scene's items (source, kind, enabled, order, transform), which main scene each output
 * SHOULD be a layer of, duplicate/foreign sources, and the audio + camera arrangement.
 *
 * This never calls a single write request — GetX / list-only — so it is always safe to run against production.
 *
 *   OBS_URL=ws://192.168.1.50:4455 OBS_PASSWORD=secret npx tsx scripts/obs-audit.ts
 *   OBS_URL=… OBS_PASSWORD=… OD_URL=http://192.168.1.50:8787 OD_PASSWORD=… npx tsx scripts/obs-audit.ts
 *
 * Without OD_URL/OD_PASSWORD, the audit compares against Overdrive's DEFAULT graphics/registry (every package's
 * default instance, legacy screens unmapped) rather than this installation's actual live configuration — still
 * useful, but the report says so up top so you know the "expected" column may not reflect custom graphics.
 *
 * Output: obs-audit-report.html (open it in a browser) + obs-audit-report.json (same data, for scripting).
 */
import fs from 'node:fs';
import { OBSWebSocket } from 'obs-websocket-js';
import WebSocket from 'ws';
import { discoverTargets, nativeSizeOf, AUDIO_SCENE, type ObsTarget } from '../shared/obsSetup';
import { sanitizeGraphics, type GfxInstance } from '../shared/gfx';
import { defaultShow } from '../shared/defaults';
import { MAIN_SCENES, mainSceneName, cameraInputName, bSceneName, DESK_SCENES, DESK_SEATS, type MainKey } from '../shared/obsLayout';
import type { ScreenId } from '../shared/types';

const OBS_URL = process.env.OBS_URL ?? '';
const OBS_PASSWORD = process.env.OBS_PASSWORD ?? '';
const OD_URL = (process.env.OD_URL ?? '').replace(/\/$/, '');
const OD_PASSWORD = process.env.OD_PASSWORD ?? '';
if (!OBS_URL) { console.error('Usage: OBS_URL=ws://host:4455 [OBS_PASSWORD=…] [OD_URL=http://host:8787 OD_PASSWORD=…] npx tsx scripts/obs-audit.ts'); process.exit(2); }

// ---------------------------------------------------------------- 1. expected layout (from Overdrive's own code)
async function liveGraphicsAndScenes(): Promise<{ graphics: GfxInstance[]; obsScenes: Partial<Record<ScreenId, string>>; source: string }> {
  if (!OD_URL || !OD_PASSWORD) return { graphics: sanitizeGraphics([]), obsScenes: defaultShow().obsScenes, source: 'DEFAULTS (no OD_URL/OD_PASSWORD given — not this installation\'s real graphics)' };
  const login = await fetch(OD_URL + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: OD_PASSWORD }) });
  if (!login.ok) { console.error(`Overdrive sign-in failed (${login.status}) — falling back to defaults.`); return { graphics: sanitizeGraphics([]), obsScenes: defaultShow().obsScenes, source: 'DEFAULTS (sign-in failed)' }; }
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  return new Promise(resolve => {
    const ws = new WebSocket(OD_URL.replace(/^http/, 'ws') + '/ws', { headers: { cookie } });
    const got: Record<string, any> = {};
    const done = () => { ws.close(); resolve({ graphics: got.gfx?.graphics ? sanitizeGraphics(got.gfx.graphics) : sanitizeGraphics([]), obsScenes: got.live?.show?.obsScenes ?? defaultShow().obsScenes, source: `LIVE (${OD_URL})` }); };
    const t = setTimeout(done, 6000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'controller' })));
    ws.on('message', d => { const m = JSON.parse(String(d)); got[m.t] = m; if (got.gfx && got.live) { clearTimeout(t); done(); } });
    ws.on('error', () => { clearTimeout(t); done(); });
  });
}

// ---------------------------------------------------------------- 2. actual OBS state (read-only)
interface Item { sceneItemId: number; sourceName: string; inputKind?: string | null; sceneItemIndex: number; sceneItemEnabled: boolean; sceneItemTransform?: any }
interface ObsSnapshot {
  canvas: { w: number; h: number; ow?: number; oh?: number; fps?: number };
  program: string; preview: string;
  scenes: Map<string, Item[]>;
  inputs: Map<string, { kind: string; settings: any; muted?: boolean }>;
  obsVersion: string;
}
async function readObs(): Promise<ObsSnapshot> {
  const obs = new OBSWebSocket();
  await obs.connect(OBS_URL, OBS_PASSWORD || undefined);
  const v = await obs.call('GetVideoSettings');
  const ver = await obs.call('GetVersion').catch(() => ({ obsVersion: '?' }) as any);
  const sl = await obs.call('GetSceneList');
  const scenes = new Map<string, Item[]>();
  for (const s of sl.scenes ?? []) {
    const name = String((s as any).sceneName);
    const items = ((await obs.call('GetSceneItemList', { sceneName: name })).sceneItems ?? []) as any[];
    scenes.set(name, items.map(i => ({ sceneItemId: i.sceneItemId, sourceName: String(i.sourceName), inputKind: i.inputKind ?? null, sceneItemIndex: i.sceneItemIndex, sceneItemEnabled: !!i.sceneItemEnabled, sceneItemTransform: i.sceneItemTransform })));
  }
  const il = await obs.call('GetInputList');
  const inputs = new Map<string, { kind: string; settings: any; muted?: boolean }>();
  for (const i of il.inputs ?? []) {
    const name = String((i as any).inputName);
    const kind = String((i as any).unversionedInputKind ?? (i as any).inputKind ?? '');
    let settings: any = {}, muted: boolean | undefined;
    try { settings = (await obs.call('GetInputSettings', { inputName: name })).inputSettings ?? {}; } catch {}
    if (kind === 'browser_source') { try { muted = !!(await obs.call('GetInputMute', { inputName: name })).inputMuted; } catch {} }
    inputs.set(name, { kind, settings, muted });
  }
  await obs.disconnect();
  return { canvas: { w: v.baseWidth, h: v.baseHeight, ow: v.outputWidth, oh: v.outputHeight, fps: Number(v.fpsNumerator) / (Number(v.fpsDenominator) || 1) }, program: String(sl.currentProgramSceneName ?? ''), preview: String(sl.currentPreviewSceneName ?? ''), scenes, inputs, obsVersion: String((ver as any).obsVersion ?? '?') };
}

function routeOf(url: string): string | null {
  try { const u = new URL(url); u.searchParams.delete('key'); const q = u.searchParams.toString(); return u.pathname + (q ? `?${q}` : ''); } catch { return null; }
}
function fillsCanvas(tr: any, cw: number, ch: number): boolean {
  if (!tr) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
  if (!near(Number(tr.positionX) || 0, 0) || !near(Number(tr.positionY) || 0, 0) || (Number(tr.rotation) || 0) !== 0) return false;
  if (tr.boundsType && tr.boundsType !== 'OBS_BOUNDS_NONE') return near(tr.boundsWidth, cw) && near(tr.boundsHeight, ch);
  const sw = Number(tr.sourceWidth) || cw, sh = Number(tr.sourceHeight) || ch;
  return near((Number(tr.scaleX) || 1) * sw, cw) && near((Number(tr.scaleY) || 1) * sh, ch);
}

// ---------------------------------------------------------------- 3. compare
interface SceneFinding { scene: string; kind: 'main' | 'pvw' | 'desk-b' | 'other'; main?: MainKey; exists: boolean; onAir: boolean; onPreview: boolean;
  layers: { target: string; role: string; input: string; present: boolean; enabled: boolean; expectedEnabled?: boolean; fits: boolean | null; order: number }[];
  actualOrder: { source: string; kind: string; enabled: boolean }[]; audioSources: string[]; cameraSources: string[]; foreign: string[]; issues: string[] }

async function audit() {
  const [{ graphics, obsScenes, source }, obs] = await Promise.all([liveGraphicsAndScenes(), readObs()]);
  const targets = discoverTargets(graphics, obsScenes, { audio: true, gameCapture: true, layout: 'main' });
  const byMain = new Map<MainKey, ObsTarget[]>();
  for (const t of targets) if (t.main) (byMain.get(t.main) ?? byMain.set(t.main, []).get(t.main)!).push(t);

  const camNames = new Set([...new Set(Object.values(DESK_SEATS).flat())].map(cameraInputName));
  const audioNames = new Set([1, 2, 3, 4, 5, 6].map(n => `Overdrive Caster ${n} audio`).concat(['Overdrive Music']));
  const knownInputs = new Set<string>([...targets.map(t => t.input), ...camNames, ...audioNames, AUDIO_SCENE, 'Overdrive Game capture']);

  const findings: SceneFinding[] = [];
  const topLevelIssues: string[] = [];

  // duplicate detection: two browser_source inputs pointing at the SAME route/overdrive_id, or two camera-shaped
  // inputs for the same seat, or two audio inputs for the same /output/audio/N route.
  const byRoute = new Map<string, string[]>();
  for (const [name, inp] of obs.inputs) {
    if (inp.kind !== 'browser_source') continue;
    const url = typeof inp.settings.url === 'string' ? inp.settings.url : '';
    const r = routeOf(url) ?? (inp.settings.overdrive_id ? `id:${inp.settings.overdrive_id}` : null);
    if (!r) continue;
    (byRoute.get(r) ?? byRoute.set(r, []).get(r)!).push(name);
  }
  for (const [route, names] of byRoute) if (names.length > 1) topLevelIssues.push(`DUPLICATE: ${names.length} OBS sources all point at "${route}": ${names.map(n => `"${n}"`).join(', ')}. Only one should exist — this is exactly the duplication the Scene Builder is supposed to prevent; it means one of these was created by hand or by an older Overdrive version, not the current builder.`);

  for (const m of MAIN_SCENES) {
    const scene = mainSceneName(m.key);
    const exists = obs.scenes.has(scene);
    const items = obs.scenes.get(scene) ?? [];
    const layerTargets = (byMain.get(m.key) ?? []).filter(t => t.role !== 'pvw');
    const layers = layerTargets.map(t => {
      const it = items.find(i => i.sourceName === t.input);
      const expectedEnabled = t.role === 'base';
      return { target: t.id, role: t.role!, input: t.input, present: !!it, enabled: !!it?.sceneItemEnabled, expectedEnabled, fits: it ? fillsCanvas(it.sceneItemTransform, obs.canvas.w, obs.canvas.h) : null, order: it?.sceneItemIndex ?? -1 };
    });
    const issues: string[] = [];
    if (!exists) issues.push('Scene does not exist in OBS yet — run Build.');
    for (const l of layers) {
      if (!l.present) issues.push(`"${l.input}" (${l.role}) is missing from this scene.`);
      else if (l.fits === false) issues.push(`"${l.input}" is not fitted to the full canvas (resized/cropped/moved by hand).`);
    }
    const seats = DESK_SCENES.includes(m.key) ? (DESK_SEATS[m.key] ?? []) : [];
    const camsHere = items.filter(i => camNames.has(i.sourceName));
    if (seats.length && camsHere.length !== seats.length) issues.push(`Expected ${seats.length} camera source(s) for this desk, found ${camsHere.length}.`);
    if (camsHere.length) { const bottom = items.slice(0, camsHere.length); if (!camsHere.every(c => bottom.some(b => b.sourceName === c.sourceName))) issues.push('Camera sources are not at the bottom of the stack (should sit below audio and graphics).'); }
    const audioHere = items.filter(i => audioNames.has(i.sourceName));
    const expectAudioCount = m.audio === 'music' ? 1 : 7;
    if (audioHere.length && audioHere.length !== expectAudioCount) issues.push(`Expected ${expectAudioCount} audio source(s) directly in this scene, found ${audioHere.length}.`);
    const foreign = items.filter(i => !knownInputs.has(i.sourceName)).map(i => i.sourceName);
    findings.push({ scene, kind: 'main', main: m.key, exists, onAir: scene === obs.program, onPreview: scene === obs.preview, layers, actualOrder: items.map(i => ({ source: i.sourceName, kind: i.inputKind ?? '', enabled: i.sceneItemEnabled })), audioSources: audioHere.map(i => i.sourceName), cameraSources: camsHere.map(i => i.sourceName), foreign, issues });
  }
  for (const m of DESK_SCENES) {
    const scene = bSceneName(m);
    const exists = obs.scenes.has(scene);
    const items = obs.scenes.get(scene) ?? [];
    findings.push({ scene, kind: 'desk-b', main: m, exists, onAir: scene === obs.program, onPreview: scene === obs.preview, layers: [], actualOrder: items.map(i => ({ source: i.sourceName, kind: i.inputKind ?? '', enabled: i.sceneItemEnabled })), audioSources: [], cameraSources: items.filter(i => camNames.has(i.sourceName)).map(i => i.sourceName), foreign: items.filter(i => !knownInputs.has(i.sourceName)).map(i => i.sourceName), issues: exists ? [] : ['(B) camera-composition scene not built yet.'] });
  }
  const mvpPvw = mainSceneName('mvp') + ' (Preview identity)';
  findings.push({ scene: mvpPvw, kind: 'pvw', exists: obs.scenes.has(mvpPvw), onAir: false, onPreview: false, layers: [], actualOrder: (obs.scenes.get(mvpPvw) ?? []).map(i => ({ source: i.sourceName, kind: i.inputKind ?? '', enabled: i.sceneItemEnabled })), audioSources: [], cameraSources: [], foreign: [], issues: [] });

  const known = new Set(findings.map(f => f.scene));
  const otherScenes = [...obs.scenes.keys()].filter(n => !known.has(n) && n !== 'Scene');
  for (const name of otherScenes) {
    const items = obs.scenes.get(name)!;
    const ours = items.filter(i => knownInputs.has(i.sourceName));
    findings.push({ scene: name, kind: 'other', exists: true, onAir: name === obs.program, onPreview: name === obs.preview, layers: [], actualOrder: items.map(i => ({ source: i.sourceName, kind: i.inputKind ?? '', enabled: i.sceneItemEnabled })), audioSources: [], cameraSources: [], foreign: items.filter(i => !knownInputs.has(i.sourceName)).map(i => i.sourceName),
      issues: ours.length ? [`Not one of the main scenes, but holds ${ours.length} Overdrive source(s) (${ours.map(i => i.sourceName).join(', ')}) — likely left over from an earlier Overdrive version. Safe to review in Scene Builder's Cleanup report.`] : [] });
  }

  // canvas-level issues
  const P = { w: 1920, h: 1080 };
  if (obs.canvas.w !== P.w * 2 && obs.canvas.w !== P.w) topLevelIssues.push(`OBS base canvas is ${obs.canvas.w}×${obs.canvas.h} — expected 1920×1080 (1080p profile) or 3840×2160 (4K profile).`);

  return { findings, topLevelIssues, obs, source, targetCount: targets.length, duplicateRouteCount: [...byRoute.values()].filter(v => v.length > 1).length };
}

// ---------------------------------------------------------------- 4. render
function esc(s: string) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function render(r: Awaited<ReturnType<typeof audit>>): string {
  const sceneCard = (f: SceneFinding) => {
    const bad = f.issues.length || f.foreign.length;
    return `<div class="card ${bad ? 'bad' : 'ok'}">
      <h3>${esc(f.scene)} ${f.onAir ? '<span class="tag air">PROGRAM</span>' : ''}${f.onPreview ? '<span class="tag pvw">PREVIEW</span>' : ''}${!f.exists ? '<span class="tag missing">MISSING</span>' : ''}</h3>
      ${f.layers.length ? `<table><tr><th>layer</th><th>role</th><th>present</th><th>shown</th><th>fits canvas</th></tr>${f.layers.map(l => `<tr class="${l.present && (l.fits !== false) ? '' : 'warn'}"><td>${esc(l.input)}</td><td>${l.role}</td><td>${l.present ? '✓' : '✗ missing'}</td><td>${l.enabled === l.expectedEnabled ? '✓' : `${l.enabled ? 'on' : 'off'} (expected ${l.expectedEnabled ? 'on' : 'off/producer-controlled'})`}</td><td>${l.fits === null ? '—' : l.fits ? '✓' : '✗ drift'}</td></tr>`).join('')}</table>` : ''}
      ${f.cameraSources.length ? `<p class="meta">Cameras: ${f.cameraSources.map(esc).join(', ')}</p>` : ''}
      ${f.audioSources.length ? `<p class="meta">Audio: ${f.audioSources.length} source(s) direct in this scene</p>` : ''}
      <p class="meta">Actual order (bottom→top): ${f.actualOrder.map(i => esc(i.source) + (i.enabled ? '' : ' (hidden)')).join(' → ') || '<em>empty</em>'}</p>
      ${f.foreign.length ? `<p class="warn-text">Not Overdrive's: ${f.foreign.map(esc).join(', ')}</p>` : ''}
      ${f.issues.length ? `<ul class="issues">${f.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="good-text">No issues found.</p>'}
    </div>`;
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Overdrive OBS Audit</title><style>
    body{font-family:-apple-system,Segoe UI,sans-serif;background:#0b0b0d;color:#e9e9ec;margin:0;padding:32px;}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#9a9aa2;margin:0 0 24px;font-size:13px}
    .top{background:#17171a;border:1px solid #2a2a2e;border-radius:10px;padding:16px;margin-bottom:24px}
    .top h2{margin:0 0 8px;font-size:15px;color:#f5a524} .top ul{margin:0;padding-left:20px} .top li{margin:4px 0;font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
    .card{background:#111113;border:1px solid #2a2a2e;border-radius:10px;padding:14px}
    .card.bad{border-color:#e5484d55} .card.ok{border-color:#2fbf7155}
    .card h3{margin:0 0 10px;font-size:14px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .tag{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:.04em}
    .tag.air{background:#e5484d;color:#fff} .tag.pvw{background:#2fbf71;color:#000} .tag.missing{background:#f5a524;color:#000}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px} td,th{padding:3px 6px;border-bottom:1px solid #222;text-align:left}
    tr.warn td{color:#f5a524}
    .meta{font-size:12px;color:#9a9aa2;margin:4px 0} .warn-text{font-size:12px;color:#f5a524} .good-text{font-size:12px;color:#2fbf71}
    .issues{font-size:12px;color:#e5484d;margin:6px 0 0;padding-left:18px}
  </style></head><body>
    <h1>Overdrive OBS Audit</h1>
    <p class="sub">OBS ${esc(r.obs.obsVersion)} · canvas ${r.obs.canvas.w}×${r.obs.canvas.h} · Program: ${esc(r.obs.program)} · Expected graphics: ${esc(r.source)} · generated ${new Date().toLocaleString()}</p>
    ${r.topLevelIssues.length ? `<div class="top"><h2>Top-level findings</h2><ul>${r.topLevelIssues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : `<div class="top"><h2>Top-level findings</h2><ul><li>No duplicate sources detected across the whole OBS collection.</li></ul></div>`}
    <div class="grid">${r.findings.map(sceneCard).join('')}</div>
  </body></html>`;
}

const result = await audit();
fs.writeFileSync('obs-audit-report.json', JSON.stringify(result, (k, v) => v instanceof Map ? Object.fromEntries(v) : v, 2));
fs.writeFileSync('obs-audit-report.html', render(result));
console.log(`Wrote obs-audit-report.html and obs-audit-report.json (${result.findings.length} scenes checked, ${result.topLevelIssues.length} top-level finding(s)).`);

// Overdrive 3.0 Broadcast Health Monitor + pre-show checklist (pure functions over the controller state).
//   npx tsx tests/health.test.ts
import { computeHealth, checklist, worst, type HealthItem } from '../shared/health';
import { blankTalent, emptySeats } from '../shared/talent';
import type { ControllerState } from '../shared/types';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra: unknown = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== '' ? `  [${JSON.stringify(extra)}]` : ''}`); };
let k = 0; const key = () => `k${String(++k).padStart(20, '0')}`;
const T = (id: string, p: object = {}, live: object = {}) => ({ ...blankTalent(id, key, key), ...p, online: false, publishing: false, hasAudio: false, seat: null, ...live });

function state(over: Partial<ControllerState> = {}): ControllerState {
  return {
    obs: { enabled: true, connected: true, scenes: ['Overdrive · Caster Desk'], currentScene: 'Overdrive · Caster Desk' },
    outputs: [{ route: 'g/caster-desk', count: 1 }],
    graphics: [{ id: 'caster-desk', pkg: 'od.caster-desk', name: 'Caster Desk', config: {}, draft: null, anim: { action: 'in', seq: 1, at: 0 }, presets: [], obsScene: 'Overdrive · Caster Desk' }],
    gfxHealth: {}, talent: [], seats: emptySeats(), events: [{ id: 'od', name: 'Overdrive', createdAt: 0 }], activeEvent: 'od',
    plan: { segments: [], rules: [], onAir: null, next: null, pending: null } as never,
    engine: { version: 1, autoHold: false, dirty: false, draft: [] } as never,
    media: { playlist: [], index: 0, status: 'stopped', startedAt: null, pausedMs: 0, volume: 1, muted: false, auto: true, loop: false, seq: 0 },
    audio: { obs: true, master: false, inputs: [], talent: {}, seats: Object.fromEntries([1, 2, 3, 4, 5, 6].map(s => [s, { input: `Overdrive Caster ${s} audio`, exists: true, who: [], seat: s }])), issues: [], at: 0 },
    obsSetup: { targets: [{ id: 'g:caster-desk', name: 'Caster Desk', kind: 'gfx', scene: 'Overdrive · Caster Desk', input: '', url: '', status: 'ok', issues: [], unmanaged: [], onAir: true, inAll: true }], controllerLeaks: [] } as never,
    ...over,
  } as ControllerState;
}
const find = (h: HealthItem[], area: string, label?: string) => h.find(i => i.area === area && (!label || i.label === label));

// healthy show
const seats = { ...emptySeats(), 1: 't1' };
const good = state({ talent: [T('t1', { name: 'Ana', ready: true }, { online: true, publishing: true, hasAudio: true, seat: 1 })] as never, seats, audio: { ...state().audio!, talent: { t1: { input: 'Overdrive Caster 1 audio', exists: true, who: ['t1'], seat: 1, muted: false } } } });
const h = computeHealth({ st: good, conn: 'open', rtt: 12 });
check('healthy show: nothing bad or warning', worst(h) === 'ok', h.filter(i => i.tone !== 'ok' && i.tone !== 'off'));
check('every area is reported (link, obs, graphics, cameras, audio, media, performance, automation)', ['link', 'obs', 'graphics', 'cameras', 'audio', 'media', 'performance', 'automation'].every(a => h.some(i => i.area === a)));
check('checklist: done items for a ready show', checklist(good).filter(c => !c.optional).every(c => c.done), checklist(good).filter(c => !c.done));

// server link lost
check('server link lost → bad', find(computeHealth({ st: good, conn: 'closed', rtt: null }), 'link')!.tone === 'bad');
check('slow link → warning', find(computeHealth({ st: good, conn: 'open', rtt: 900 }), 'link')!.tone === 'warn');

// OBS down
const obsDown = state({ ...good, obs: { enabled: true, connected: false, scenes: [], error: 'OBS not reachable' }, audio: { ...good.audio!, obs: false } });
const hd = computeHealth({ st: obsDown, conn: 'open', rtt: 10 });
check('OBS unreachable → bad with the reason and a place to fix it', find(hd, 'obs')!.tone === 'bad' && /not reachable/.test(find(hd, 'obs')!.detail) && !!find(hd, 'obs')!.fix?.go);
check('…and talent audio is reported as not controlled', find(hd, 'audio')!.tone === 'bad');
check('OBS not set up → off (not an alarm)', find(computeHealth({ st: state({ obs: { enabled: false, connected: false, scenes: [] } }), conn: 'open', rtt: 1 }), 'obs')!.tone === 'off');

// renderer error → reload sources action
const gErr = computeHealth({ st: state({ ...good, gfxHealth: { 'caster-desk': { ok: false, error: 'TypeError: x', at: 1 } } }), conn: 'open', rtt: 1 });
check('graphics renderer error → bad with "Reload sources"', find(gErr, 'graphics', 'Graphics renderers')!.tone === 'bad' && find(gErr, 'graphics', 'Graphics renderers')!.fix?.cmd?.c === 'reload-outputs');
// a graphic used in OBS but its source is not connected
const noSrc = computeHealth({ st: state({ ...good, outputs: [] }), conn: 'open', rtt: 1 });
check('graphic in an OBS scene with no connected source → warning', find(noSrc, 'graphics', 'Browser sources')!.tone === 'warn' && /Caster Desk/.test(find(noSrc, 'graphics', 'Browser sources')!.detail));

// cameras
const camOff = computeHealth({ st: state({ ...good, talent: [T('t1', { name: 'Ana' }, { seat: 1 })] as never }), conn: 'open', rtt: 1 });
check('seated camera not connected → bad, fix opens the Green Room', find(camOff, 'cameras')!.tone === 'bad' && find(camOff, 'cameras')!.fix?.go?.tab === 'green');

// audio override → apply action; master mute → unmute action
const ov = computeHealth({ st: state({ ...good, audio: { ...good.audio!, issues: [{ code: 'override', tone: 'warn', talent: 't1', text: 'Ana: muted by hand' }] } }), conn: 'open', rtt: 1 });
check('voice muted by hand in OBS → warning with "Apply audio settings"', find(ov, 'audio')!.tone === 'warn' && find(ov, 'audio')!.fix?.cmd?.c === 'audio-apply');
const mm = computeHealth({ st: state({ ...good, audio: { ...good.audio!, master: true } }), conn: 'open', rtt: 1 });
check('master talent mute on → warning with "Unmute talent"', find(mm, 'audio')!.tone === 'warn' && (find(mm, 'audio')!.fix?.cmd as { muted?: boolean })?.muted === false);

// media playing with no source
const med = computeHealth({ st: state({ ...good, media: { ...good.media!, status: 'playing', playlist: ['/media/a.mp4'] } }), conn: 'open', rtt: 1 });
check('media playing but no media source connected → warning', find(med, 'media')!.tone === 'warn');

// voting
const aud = (o: object) => ({ configured: true, online: true, error: null, summary: null, lockedMatches: [], championLocked: false, qrHosts: [], customQr: [], publicUrl: 'https://vote.example', publicUrlSet: '', envPublicUrl: '', liveTotals: [], ...o });
check('vote service down → bad, and says local production is unaffected', (() => { const v = find(computeHealth({ st: good, conn: 'open', rtt: 1, aud: aud({ online: false, error: 'timeout' }) }), 'voting')!; return v.tone === 'bad' && /unaffected/.test(v.detail); })());
check('vote service not configured → off', find(computeHealth({ st: good, conn: 'open', rtt: 1, aud: aud({ configured: false }) }), 'voting')!.tone === 'off');

// performance
const perf = (o: object) => ({ on: true, suspendOffAir: false, outputs: [], showing: {}, obs: { fps: 60, renderMs: 3, renderSkipped: 0, renderTotal: 1000, outputSkipped: 0, outputTotal: 1000, cpu: 20, memMB: 800, ...o } });
check('OBS performance: healthy / dropping frames', find(computeHealth({ st: good, conn: 'open', rtt: 1, perf: perf({}) }), 'performance')!.tone === 'ok' && find(computeHealth({ st: good, conn: 'open', rtt: 1, perf: perf({ outputSkipped: 40 }) }), 'performance')!.tone === 'bad');

// automation held
check('automation held → warning with "Release"', (() => { const a = find(computeHealth({ st: state({ ...good, engine: { ...good.engine!, autoHold: true } }), conn: 'open', rtt: 1 }), 'automation')!; return a.tone === 'warn' && a.fix?.cmd?.c === 'automation'; })());

// controller page loaded in OBS
check('an Overdrive control page inside OBS → bad', computeHealth({ st: state({ ...good, obsSetup: { ...good.obsSetup!, controllerLeaks: [{ input: 'x', url: '/producer' }] } }), conn: 'open', rtt: 1 }).some(i => i.label === 'Control page in OBS' && i.tone === 'bad'));

// checklist on a fresh install
const fresh = checklist(state({ obs: { enabled: false, connected: false, scenes: [] }, obsSetup: { targets: [], controllerLeaks: [] } as never, audio: undefined }));
check('fresh install checklist: OBS, scenes, talent, cameras open; event done', !fresh.find(c => c.id === 'obs')!.done && !fresh.find(c => c.id === 'obs-scenes')!.done && !fresh.find(c => c.id === 'talent')!.done && fresh.find(c => c.id === 'event')!.done);
check('checklist items point to where they are fixed', fresh.filter(c => !c.done && !c.optional).every(c => !!c.go || c.id === 'drafts'));
check('worst(): off never alarms', worst([{ tone: 'off' }, { tone: 'ok' }]) === 'ok');

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

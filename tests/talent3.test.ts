// Overdrive 3.0 talent: profile model + migration, VDO.Ninja link diagnostics, framing, setup validation, and the
// persistent audio mixer against the OBS mock (obs-websocket 5.x request names).   npx tsx tests/talent3.test.ts
import { sanitizeTalent, describeVdoLink, cropStyle, blankTalent, inUse, TALENT_COUNT, emptySeats, type TalentProfile, type Seats } from '../shared/talent';
import { checkTalent, toneOf, type LiveTalent } from '../shared/talentCheck';
import { seatAudioInput, MONITOR_TYPES } from '../shared/audio';
import { createAudioMix } from '../server/audioMix';
import { MockObs } from './mockObs';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra: unknown = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== '' ? `  [${typeof extra === 'string' ? extra : JSON.stringify(extra)}]` : ''}`); };
let k = 0; const key = () => `key-${String(++k).padStart(20, '0')}`, vdo = () => `od${String(++k).padStart(10, '0')}`;

// ---------------------------------------------------------------- model + migration
const fresh = sanitizeTalent([], key, vdo);
check('fresh install: t1…t10, all unused, audio from the camera link at 0 dB, full frame', fresh.length === TALENT_COUNT && fresh.every(t => !inUse(t, false) && t.audio.source === 'feed' && t.audio.volumeDb === 0 && t.crop.zoom === 1 && !t.ready));
const v2 = sanitizeTalent([{ id: 't1', name: 'Ana', role: 'caster', mode: 'vdo', key: 'k'.repeat(20), vdoId: 'abc_123456', camQuality: '1080p' }, { id: 't2', name: 'Bo', role: 'analyst', mode: 'webrtc', key: 'q'.repeat(20), vdoId: 'zzz_123456' }], key, vdo);
check('2.x profile keeps name, role, key, VDO stream and quality', v2[0].name === 'Ana' && v2[0].key === 'k'.repeat(20) && v2[0].vdoId === 'abc_123456' && v2[0].camQuality === '1080p' && v2[1].role === 'analyst');
check('2.x VDO.Ninja profile counts as a pasted link; an app-camera one does not', v2[0].vdoSet === true && v2[1].vdoSet === false);
const added = sanitizeTalent([{ id: 't14', name: 'Host', role: 'host' }, { id: 't99', name: 'nope' }, { id: 't3', role: 'guest' }], key, vdo);
check('added profiles (t11–t24) survive a restart; out-of-range ids are dropped; host / guest roles kept', added.length === 11 && added.some(t => t.id === 't14' && t.role === 'host') && !added.some(t => t.id === 't99') && added.find(t => t.id === 't3')!.role === 'guest');
const dirty = sanitizeTalent([{ id: 't1', audio: { source: 'obs', input: 'Discord', volumeDb: 99, syncMs: -5000, muted: 'yes', monitor: true }, crop: { zoom: 9, x: -400, y: 12 }, photo: 'javascript:alert(1)' }], key, vdo)[0];
check('audio / crop / picture are clamped and sanitized', dirty.audio.source === 'obs' && dirty.audio.input === 'Discord' && dirty.audio.volumeDb === 12 && dirty.audio.syncMs === -950 && dirty.audio.muted === false && dirty.audio.monitor === true && dirty.crop.zoom === 3 && dirty.crop.x === -50 && dirty.photo === '', dirty);

// ---------------------------------------------------------------- VDO.Ninja link diagnostics
const L = (s: string) => describeVdoLink(s);
check('push link → stream ID', L('https://vdo.ninja/?push=Caster_Ana123&webcam').id === 'Caster_Ana123' && L('https://vdo.ninja/?push=Caster_Ana123').kind === 'push');
check('view link → stream ID', L('https://vdo.ninja/?view=abcdef12&password=x').id === 'abcdef12' && L('https://vdo.ninja/?view=abcdef12&password=x').kind === 'view');
check('a link\'s own password is reported as ignored', /password/.test(L('https://vdo.ninja/?view=abcdef12&password=x').note ?? ''));
check('bare stream ID accepted', L('abc_123456').ok && L('abc_123456').kind === 'bare');
check('director link refused with an explanation', !L('https://vdo.ninja/?director=myroom').ok && /director/i.test(L('https://vdo.ninja/?director=myroom').problem ?? ''));
check('room link without a stream refused', !L('https://vdo.ninja/?room=myroom&password=x').ok && L('https://vdo.ninja/?room=myroom').kind === 'room');
check('scene link refused', !L('https://vdo.ninja/?scene&room=myroom').ok && L('https://vdo.ninja/?scene&room=myroom').kind === 'scene');
check('random text / short ids refused', !L('hello there').ok && !L('abc').ok && !L('https://youtube.com/watch?v=xyz').ok);
check('other host with push= → accepted with a note (only the ID is used)', L('https://example.com/?push=abcdef123').ok && /Not on vdo\.ninja/.test(L('https://example.com/?push=abcdef123').note ?? ''));
check('empty → not ok, no problem text', !L('  ').ok && L('').kind === 'empty' && !L('').problem);

// ---------------------------------------------------------------- framing
check('crop: full frame = no transform', Object.keys(cropStyle({ zoom: 1, x: 0, y: 0 })).length === 0 && Object.keys(cropStyle(undefined)).length === 0);
const cs = cropStyle({ zoom: 2, x: 50, y: -50 }).transform ?? '';
check('crop: zoom 2, pan to the edge stays inside the frame (max 25 % of the scaled element)', cs === 'scale(2) translate(-25%, 25%)', cs);

// ---------------------------------------------------------------- validation
const live = (p: Partial<TalentProfile> & { id: string }, s: Partial<LiveTalent> = {}): LiveTalent => ({ ...blankTalent(p.id, key, vdo), ...p, online: false, publishing: false, hasAudio: false, seat: null, ...s });
const seats: Seats = { ...emptySeats(), 1: 't1', 2: 't2', 4: 't3' };
const pool = [
  live({ id: 't1', name: 'Ana', mode: 'vdo', vdoSet: false }),
  live({ id: 't2', name: 'Bo' }, { online: true, publishing: true, hasAudio: false }),
  live({ id: 't3', name: '', ready: true }, { online: true, publishing: true, hasAudio: true }),
  live({ id: 't4', name: 'Unseated' }),
  live({ id: 't5', name: '' }),
];
const issues = checkTalent({ talent: pool, seats, needed: [1, 2, 3, 4, 5] });
const has = (code: string, talent?: string, seat?: number) => issues.some(i => i.code === code && (talent == null || i.talent === talent) && (seat == null || i.seat === seat));
check('VDO.Ninja camera without a pasted link → blocking issue for a seated person', has('vdo-missing', 't1') && issues.find(i => i.code === 'vdo-missing')!.tone === 'bad');
check('app camera publishing without a mic while voice = link → missing microphone', has('mic-missing', 't2'));
check('seated with no name → name needed', has('name', 't3'));
check('positions in the layout with nobody in them → unassigned position (3 and 5, not 1/2/4)', has('seat-empty', undefined, 3) && has('seat-empty', undefined, 5) && !has('seat-empty', undefined, 1));
check('not ready is information only', issues.filter(i => i.code === 'not-ready').every(i => i.tone === 'info') && has('not-ready', 't1') && !has('not-ready', 't3'));
check('unused empty profile produces nothing; unseated named profile only its own problems', !issues.some(i => i.talent === 't5') && !has('not-ready', 't4') && !has('cam-offline', 't4'));
const off = checkTalent({ talent: [live({ id: 't1', name: 'Ana' })], seats: { ...emptySeats(), 1: 't1' } });
check('seated app camera never opened → camera offline with the fix "send their link"', off.some(i => i.code === 'cam-offline' && /link/.test(i.fix ?? '')));
const dupV = checkTalent({ talent: [live({ id: 't1', name: 'A', mode: 'vdo', vdoSet: true, vdoId: 'same_12345' }), live({ id: 't2', name: 'B', mode: 'vdo', vdoSet: true, vdoId: 'same_12345' })], seats: emptySeats() });
check('two people on one VDO.Ninja stream → duplicate', dupV.filter(i => i.code === 'vdo-duplicate').length === 2);
const sharedIn = checkTalent({ talent: [live({ id: 't1', name: 'A', audio: { source: 'obs', input: 'Discord', volumeDb: 0, muted: false, syncMs: 0, monitor: false } }), live({ id: 't2', name: 'B', audio: { source: 'obs', input: 'Discord', volumeDb: 0, muted: false, syncMs: 0, monitor: false } })], seats: { ...emptySeats(), 1: 't1', 2: 't2' } });
check('two seated people on one OBS input → shared-fader warning', sharedIn.some(i => i.code === 'audio-duplicate' && i.tone === 'warn'));
check('status dot = worst issue', toneOf(issues, 't1') === 'bad' && toneOf(issues, 't4') === 'ok');

// ---------------------------------------------------------------- audio mixer against the OBS mock
const obs = new MockObs();
obs.addScene('Overdrive · Caster audio');
for (const n of [1, 2, 3, 4, 5, 6]) obs.addInput('Overdrive · Caster audio', seatAudioInput(n), 'browser_source', { url: `http://localhost:8787/output/audio/${n}` });
obs.addInput('Scene', 'Discord', 'wasapi_process_output_capture');
obs.addInput('Scene', 'Mic/Aux', 'wasapi_input_capture');
let talent = sanitizeTalent([{ id: 't1', name: 'Ana', mode: 'vdo', vdoId: 'ana_123456' }, { id: 't2', name: 'Bo' }, { id: 't3', name: 'Cy' }], key, vdo);
let s: Seats = { ...emptySeats(), 1: 't1', 2: 't2' };
let master = false, connected = true, changes = 0;
const meters: Record<string, number>[] = [];
const mix = createAudioMix({ call: () => (connected ? obs.call : null), talent: () => talent, seats: () => s, master: () => master, onChange: () => changes++, meters: m => meters.push(m) });
obs.onEvent = (type, data) => { if (type === 'InputMuteStateChanged') mix.onMute(data); };
const A = (n: string) => obs.audioOf(n)!;
const edit = (id: string, patch: Partial<TalentProfile>) => { talent = talent.map(t => (t.id === id ? { ...t, ...patch } : t)); };

await mix.sync('test');
check('empty positions are silenced; seated voices are on at their fader', A(seatAudioInput(3)).muted && A(seatAudioInput(6)).muted && !A(seatAudioInput(1)).muted && !A(seatAudioInput(2)).muted);
check('state: OBS connected, inputs listed for the picker (no browser / image sources except position audio)', mix.state().obs && mix.state().inputs.includes('Discord') && mix.state().inputs.includes('Mic/Aux') && mix.state().inputs.includes(seatAudioInput(1)));
edit('t1', { audio: { ...talent[0].audio, volumeDb: -6.5, syncMs: 120, monitor: true } });
await mix.sync('edit');
check('fader, sync offset and monitoring are applied to their position\'s source', A(seatAudioInput(1)).volumeDb === -6.5 && A(seatAudioInput(1)).sync === 120 && A(seatAudioInput(1)).monitor === MONITOR_TYPES.both, A(seatAudioInput(1)));
// move Ana from position 1 to 3: the voice follows, the old position goes silent, nobody reconnects (only OBS mute/volume calls)
const before = obs.log.length;
s = { ...s, 1: null, 3: 't1' };
await mix.sync('seat');
const calls = obs.log.slice(before).map(l => l.req);
check('moving a person: their settings follow to the new position, the old one is silenced', A(seatAudioInput(3)).volumeDb === -6.5 && !A(seatAudioInput(3)).muted && A(seatAudioInput(1)).muted, A(seatAudioInput(3)));
check('…using only audio requests (no source re-creation, no settings / URL change, no scene switch)', calls.every(r => /^(Get|Set)Input(Mute|Volume|AudioSyncOffset|AudioMonitorType|List)$/.test(r)), calls);
// voice through Discord instead of the camera link → the position source is silenced (never heard twice)
edit('t2', { audio: { source: 'obs', input: 'Discord', volumeDb: -3, muted: false, syncMs: 0, monitor: false } });
await mix.sync('edit');
check('voice from an OBS input: that input is set, the position\'s own audio source is silenced', A('Discord').volumeDb === -3 && !A('Discord').muted && A(seatAudioInput(2)).muted);
// someone off position: their OBS input is muted (no off-air chatter)
s = { ...s, 2: null };
await mix.sync('seat');
check('person leaves their position → their OBS input is muted', A('Discord').muted);
s = { ...s, 2: 't2' }; await mix.sync('seat');
// master mute
master = true; await mix.sync('master');
check('master mute silences every talent voice (position sources and OBS inputs)', A(seatAudioInput(3)).muted && A('Discord').muted);
master = false; await mix.sync('master');
check('master off: back to each person\'s own mute', !A(seatAudioInput(3)).muted && !A('Discord').muted);
// muted by hand in OBS → reported, not fought; "apply" re-asserts
obs.setMute('Discord', true);
await mix.sync('poll'); await mix.sync('poll');
check('muted by hand in OBS: Overdrive leaves it alone and reports an override', A('Discord').muted && mix.state().issues.some(i => i.code === 'override' && i.talent === 't2'), mix.state().issues);
await mix.applyAll();
check('"Apply Overdrive audio settings" restores the profile', !A('Discord').muted && !mix.state().issues.some(i => i.code === 'override'));
// echo risk: monitoring an application capture
edit('t2', { audio: { ...talent[1].audio, monitor: true } });
await mix.sync('edit');
check('monitoring a desktop / application capture is flagged as an echo risk', mix.state().issues.some(i => i.code === 'echo' && i.talent === 't2'));
// missing input
edit('t2', { audio: { ...talent[1].audio, input: 'Discord (old)', monitor: false } });
await mix.sync('edit');
check('voice set to an OBS input that does not exist → reported with a fix', mix.state().issues.some(i => i.code === 'input-missing' && i.tone === 'bad'));
// meters
mix.onMeters({ inputs: [{ inputName: seatAudioInput(3), inputLevelsMul: [[0.1, 0.5, 0.5], [0.1, 0.25, 0.25]] }, { inputName: 'Mic/Aux', inputLevelsMul: [[0.9, 0.9, 0.9]] }] });
await new Promise(r => setTimeout(r, 150));
check('meters: peak dBFS per talent (−6 dB for 0.5), only for inputs carrying a talent', meters.length === 1 && meters[0].t1 === -6 && !('t2' in meters[0]) && Object.keys(meters[0]).length === 1, meters);
// OBS gone
connected = false; await mix.sync('poll');
check('OBS disconnected: reported (not crashing), nothing called', !mix.state().obs && mix.state().issues.some(i => i.code === 'obs-offline'));
check('every write was an audio request on an existing input (nothing created, nothing deleted)', obs.writes().every(w => /^SetInput(Mute|Volume|AudioSyncOffset|AudioMonitorType)$/.test(w.req)));
check('validation includes the OBS findings', checkTalent({ talent: talent.map(t => ({ ...t, online: true, publishing: true, hasAudio: true, seat: null })), seats: s, audio: { ...mix.state(), issues: [{ code: 'echo', tone: 'warn', talent: 't2', text: 'x' }] } }).some(i => i.code === 'audio' && i.talent === 't2'));
check('onChange fires (Talent Manager / Health update)', changes > 5);

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

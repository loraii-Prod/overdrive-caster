// Overdrive 3.0 · MVP integration: event rosters, all-players preparation, per-event vote stores, rehearsal data,
// the MVP readiness checklist, MVP automation settings.   npx tsx tests/mvpSync.test.ts
import { Audience, emptyAudStore, sanitizeAudStore } from '../server/audience';
import { defaultWildcard, sanitizeRosters, sanitizeWildcard, wcResolve, type WildcardState } from '../shared/wildcard';
import { matchRoster, rosterSource, teamRoster, defaultMvpAuto } from '../shared/audience';
import { MAJOR_TEAMS } from '../shared/major';
import { DEMO_MATCHES, DEMO_ROSTERS, demoWildcard } from '../shared/mvpRehearsal';
import { mvpReadiness, worstTone, type MvpReadyIn } from '../shared/mvpReady';

let ok = 0, bad = 0;
const check = (name: string, cond: unknown, extra: unknown = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== '' ? `  [${JSON.stringify(extra)}]` : ''}`); };

// ---------------------------------------------------------------- rosters
const A = MAJOR_TEAMS[0].name, Bt = MAJOR_TEAMS[1].name;
check('verified team: players from the Major profiles', teamRoster(A).length === 2 && rosterSource(A) === 'verified');
check('unknown team: no players, source none', teamRoster('Mystery Five').length === 0 && rosterSource('Mystery Five') === 'none');
const ros = { 'Mystery Five': ['Alpha5', 'Beta5'], [A]: ['Sub1', 'Massa'] };
check('event roster fills an unknown team', teamRoster('Mystery Five', ros).map(p => p.handle).join() === 'Alpha5,Beta5' && rosterSource('Mystery Five', ros) === 'event');
check('event roster replaces a verified team (substitute)', teamRoster(A, ros)[0].handle === 'Sub1' && rosterSource(A, ros) === 'event');
check('matchRoster: both teams, empty when a team is TBD / BYE', matchRoster(A, Bt).length === 4 && matchRoster(A, null).length === 0 && matchRoster(A, 'BYE').length === 0);
const sr = sanitizeRosters({ ' X ': [' a ', 'a', '', 'b'], Y: 'nope', Z: [], ['T'.repeat(80)]: ['p'] });
check('sanitizeRosters: trimmed, deduplicated, empty / invalid dropped, names capped', JSON.stringify(sr.X) === '["a","b"]' && !('Y' in sr) && !('Z' in sr) && Object.keys(sr).some(k => k.length === 60), sr);
const wcs = sanitizeWildcard({ ...defaultWildcard(), rosters: ros, rehearsal: true });
check('wildcard state keeps rosters + rehearsal flag through sanitize', wcs.rosters['Mystery Five']?.length === 2 && wcs.rehearsal === true);
check('older saves: no rosters, not a rehearsal', (() => { const w = sanitizeWildcard({ bracket: 'major26' }); return JSON.stringify(w.rosters) === '{}' && w.rehearsal === false; })());

// ---------------------------------------------------------------- audience store (per event)
const st0 = sanitizeAudStore({ mvpAuto: { open: true }, mvpMatch: 'R1_UB1', mvpNotice: { kind: 'queued', text: 'x', match: 'R1_UB2', at: 1 } });
check('automation defaults: prepare on, open off, preview off', JSON.stringify(defaultMvpAuto()) === '{"prepare":true,"open":false,"preview":false}');
check('sanitize: automation / MVP match / notice kept', st0.mvpAuto.prepare && st0.mvpAuto.open && !st0.mvpAuto.preview && st0.mvpMatch === 'R1_UB1' && st0.mvpNotice?.kind === 'queued');
check('sanitize: bad MVP match / notice dropped', (() => { const s = sanitizeAudStore({ mvpMatch: 'X9', mvpNotice: { kind: 'boom', text: 'x' } }); return s.mvpMatch === '' && s.mvpNotice === null; })());

// a finished match, the Audience on top of a local store
let wc: WildcardState = defaultWildcard(true);
wc.teams = [A, Bt, 'Mystery Five', MAJOR_TEAMS[2].name, '', '', '', ''];
wc.matches.R1_UB1 = { ...wc.matches.R1_UB1, s1: '3', s2: '1' };
wc.matches.R1_UB2 = { ...wc.matches.R1_UB2, s1: '3', s2: '0' };
let pushes = 0;
const storeA = emptyAudStore();
const aud = new Audience(storeA, () => {}, () => wc, () => pushes++);
await aud.tick();
check('local mode (no vote service), not a rehearsal', aud.mode === 'local' && !aud.rehearsal);
check('prepareAll: a match without a result is refused', /finished match/.test(await aud.prepareAll('R2_UB1') ?? ''));
check('prepareAll: ALL eligible players of both teams (2 + 2)', (await aud.prepareAll('R1_UB1')) === null && aud.pollOf('R1_UB1')?.players.map(p => p.handle).join() === [...teamRoster(A), ...teamRoster(Bt)].map(p => p.handle).join());
const first = aud.pollOf('R1_UB1')!.id;
check('prepareAll again: nothing changes (same draft)', (await aud.prepareAll('R1_UB1')) === null && aud.pollOf('R1_UB1')!.id === first);
const miss = await aud.prepareAll('R1_UB2');
check('prepareAll: a team with no known players → clear error naming it, no half vote', /Mystery Five/.test(miss ?? '') && !aud.pollOf('R1_UB2'), miss);
wc = { ...wc, rosters: { 'Mystery Five': ['Alpha5', 'Beta5'] } };
check('players entered → prepared with them', (await aud.prepareAll('R1_UB2')) === null && aud.pollOf('R1_UB2')?.players.slice(0, 2).map(p => p.handle).join() === 'Alpha5,Beta5');
wc = { ...wc, rosters: { 'Mystery Five': ['Alpha5', 'Gamma5'] } };
check('roster changed while still a draft → draft refreshed', (await aud.prepareAll('R1_UB2')) === null && aud.pollOf('R1_UB2')?.players[1].handle === 'Gamma5');
const p1 = aud.pollOf('R1_UB1')!;
await aud.op({ k: 'mvp-open', poll: p1.id }); await aud.op({ k: 'mvp-sim', poll: p1.id, votes: 30 });
check('open + 30 rehearsal votes on R1_UB1', aud.pollOf('R1_UB1')?.status === 'open' && aud.pollOf('R1_UB1')?.total === 30);
check('prepareAll never touches a vote that is open', (await aud.prepareAll('R1_UB1')) === null && aud.pollOf('R1_UB1')?.status === 'open' && aud.pollOf('R1_UB1')?.total === 30);
check('votes belong to their match: R1_UB2 still at 0', (aud.pollOf('R1_UB2')?.total ?? 0) === 0);
await aud.op({ k: 'mvp-auto', patch: { open: true } });
check('mvp-auto: only the given switch changes', aud.auto.open && aud.auto.prepare && !aud.auto.preview);
aud.notice({ kind: 'ready', match: 'R1_UB1', text: 'MVP ready' });
check('notice stored + pushed, then cleared by the producer', aud.priv().mvpNotice?.kind === 'ready' && (await aud.op({ k: 'mvp-notice-clear' })) === null && aud.priv().mvpNotice === null);

// another event: its own store — none of event A's votes are visible, A's are untouched
const storeB = emptyAudStore();
aud.swap(storeB); await aud.tick();
check('event switch: the other event sees none of this event\'s votes (same slot ids R1_UB1…)', !aud.pollOf('R1_UB1') && !aud.pollOf('R1_UB2'));
check('event switch: its own automation settings (defaults)', !aud.auto.open);
aud.swap(storeA); await aud.tick();
check('back: event A\'s open vote and its 30 votes are intact', aud.pollOf('R1_UB1')?.status === 'open' && aud.pollOf('R1_UB1')?.total === 30);

// ---------------------------------------------------------------- rehearsal data
const demo = demoWildcard();
const R = wcResolve(demo.matches, demo.teams);
check('demo: every team and player is labelled DEMO / (demo)', demo.teams.filter(Boolean).every(t => t.startsWith('DEMO ')) && Object.values(DEMO_ROSTERS).flat().every(h => h.endsWith('(demo)')));
check('demo: rehearsal flag on, never pulls the real sheet', demo.rehearsal && !demo.sheetAuto);
check('demo: matches live, not finished (finishing one is the test), match 1 cast', DEMO_MATCHES.every(id => demo.matches[id].live && !R[id].winner) && demo.cast === 'R1_UB1');
check('demo: rosters cover both demo matches', DEMO_MATCHES.every(id => matchRoster(R[id].t1, R[id].t2, demo.rosters).length === 4));
const reh = new Audience(emptyAudStore(), () => {}, () => demo, () => {});
check('rehearsal audience: always local (never the online vote service)', reh.rehearsal && !reh.remote && reh.mode === 'local');

// ---------------------------------------------------------------- readiness checklist
const base: MvpReadyIn = { match: 'R1_UB1', matchLabel: 'Upper quarter-final 1', finished: true, teams: [A, Bt], rosterSource: ['verified', 'verified'], logos: [true, true],
  players: [{ handle: 'a', photo: true }, { handle: 'b', photo: true }, { handle: 'c', photo: true }, { handle: 'd', photo: true }], poll: { status: 'draft', players: 4, sim: 0 },
  mode: 'local', online: false, publicUrl: '', chat: 'listening', rehearsal: false, obs: { connected: true, scenes: [{ view: 'voting', scene: 'S', exists: true }] }, sources: 1 };
const t = (i: Partial<MvpReadyIn>) => Object.fromEntries(mvpReadiness({ ...base, ...i }).map(c => [c.id, c.tone]));
check('ready: all OK with Twitch chat (local); website off, not an error', worstTone(mvpReadiness(base)) === 'ok' && t({}).page === 'off');
check('no MVP match → one blocking check', mvpReadiness({ ...base, match: '' }).length === 1 && t({ match: '' }).match === 'bad');
check('no result yet → match blocked', t({ finished: false }).match === 'bad');
check('team with no players → players blocked', t({ rosterSource: ['verified', 'none'] }).players === 'bad');
check('missing pictures → warning (silhouette)', t({ players: [{ handle: 'a', photo: false }, { handle: 'b', photo: true }] }).photos === 'warn');
check('no way to vote → blocked', t({ chat: 'off' }).ways === 'bad');
check('online service offline → website check blocked', t({ mode: 'online', online: false, publicUrl: 'https://v/vote', chat: 'off' }).page === 'bad');
check('rehearsal votes in a REAL vote → blocked; in the rehearsal → fine', t({ poll: { status: 'open', players: 4, sim: 10 } })['rehearsal-votes'] === 'bad' && t({ rehearsal: true, poll: { status: 'open', players: 4, sim: 10 } })['rehearsal-votes'] === 'ok');
check('a missing MVP scene in OBS → named', mvpReadiness({ ...base, obs: { connected: true, scenes: [{ view: 'voting', scene: 'S', exists: true }, { view: 'winner', scene: 'W', exists: false }] } }).find(c => c.id === 'obs')?.detail.includes('W'));
check('no MVP browser source connected → warning', t({ sources: 0 }).sources === 'warn');

console.log(`\n${ok}/${ok + bad} passed`);
if (bad) process.exit(1);

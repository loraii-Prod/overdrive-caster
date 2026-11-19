// Overdrive 3.0 · MVP as a main scene: LOCAL voting (no vote service), rehearsal votes, manual MVP (override),
// QR rules, and the main-scene mapping.   npx tsx tests/mvpLocal.test.ts
import { createLocalVote, emptyLocalVote, sanitizeLocalVote } from '../server/localVote';
import { Audience, emptyAudStore } from '../server/audience';
import { defaultWildcard, wcResolve } from '../shared/wildcard';
import { teamRoster } from '../shared/audience';
import { MAJOR_TEAMS } from '../shared/major';
import { MAIN_SCENE_DEFS, mainScenes, mainSceneOf, suggestedMvpView, MVP_SOURCE } from '../shared/mainScenes';
import { revealAllowed } from '../shared/mvpFlow';

let ok = 0, bad = 0;
const check = (name: string, cond: unknown, extra: unknown = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== '' ? `  [${JSON.stringify(extra)}]` : ''}`); };
const throws = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return (e as Error).message; } };

// ---------------------------------------------------------------- the local vote engine (vote-service protocol)
const store = emptyLocalVote(); let saves = 0;
const lv = createLocalVote(store, () => saves++);
const A = MAJOR_TEAMS[0].name, Bt = MAJOR_TEAMS[1].name;
const ra = teamRoster(A), rb = teamRoster(Bt);
await lv.call('PUT', '/internal/session', { session: 's', name: 'x', championLocked: false, matches: [{ id: 'M1', label: 'Match 1', a: A, b: Bt, bestOf: 5, live: false, locked: false, winner: A, score: '3-1' }, { id: 'M2', label: 'Match 2', a: A, b: Bt, bestOf: 5, live: true, locked: false, winner: null, score: null }] });
check('a poll needs a finished match', /finished match/.test(await throws(() => lv.call('POST', '/internal/poll', { match: 'M2', players: [ra[0].handle, rb[0].handle] })) ?? ''));
check('a poll needs 2 eligible players (players of another match are ignored)', /two eligible/.test(await throws(() => lv.call('POST', '/internal/poll', { match: 'M1', players: [ra[0].handle, 'Nobody'] })) ?? ''));
const { id } = await lv.call('POST', '/internal/poll', { match: 'M1', label: 'Match 1', result: `${A} 3–1 ${Bt}`, players: [ra[0].handle, ra[1].handle, rb[0].handle] });
let poll = () => lv.summary().polls.find(p => p.id === id)!;
check('prepare → draft poll with the 3 candidates (team kept)', poll().status === 'draft' && poll().players.length === 3 && poll().players[2].team === Bt);
check('rehearsal votes refused before voting opens', /Open voting first/.test(await throws(async () => lv.simulate(id, 10)) ?? ''));
await lv.call('POST', `/internal/poll/${id}/open`, { seconds: 60, methods: { web: true, chat: true, cmd: '!mvp', channel: 'overdrive_tm' } });
check('open: countdown set; local voting takes Twitch chat, never "website" (no public site here)', poll().status === 'open' && !!poll().closesAt && poll().chat === true && poll().web === false && poll().chatCmd === '!mvp');
const now = Date.now();
const r = (await lv.call('POST', `/internal/poll/${id}/chat-votes`, { votes: [
  { msg: 'a', user: '101', name: 'v1', choice: 1, at: now }, { msg: 'b', user: '102', name: 'v2', choice: 3, at: now },
  { msg: 'c', user: '101', name: 'v1', choice: 2, at: now }, { msg: 'd', user: '103', name: 'v3', choice: 9, at: now },
  { msg: 'e', user: '104', name: 'v4', choice: 1, at: now + 3_600_000 }, { msg: 'f', user: 'x', name: 'bad', choice: 1, at: now },
] })).results.map((x: { result: string }) => x.result);
check('chat votes: accepted, one vote per Twitch account (first wins), out-of-range invalid, after the countdown refused', JSON.stringify(r) === JSON.stringify(['accepted', 'accepted', 'already-voted', 'invalid', 'closed', 'invalid']), r);
const k = lv.simulate(id, 40, 7);
check('rehearsal: +40 simulated votes, counted apart from chat', k === 40 && poll().total === 42 && poll().bySource?.chat === 2 && poll().bySource?.sim === 40, poll().bySource);
await lv.call('POST', `/internal/poll/${id}/close`);
const fz = poll().frozen!;
check('close: result frozen with the exact counts at that moment (hash)', poll().status === 'closed' && fz.total === 42 && Object.values(fz.counts).reduce((a, b) => a + b, 0) === 42 && fz.hash.length === 16);
check('a closed vote never changes (no rehearsal, chat refused)', /Open voting first/.test(await throws(async () => lv.simulate(id, 5)) ?? '') && (await lv.call('POST', `/internal/poll/${id}/chat-votes`, { votes: [{ msg: 'z', user: '200', name: 'late', choice: 1, at: Date.now() }] })).results[0].result === 'closed' && poll().frozen!.total === 42);
await lv.call('POST', `/internal/poll/${id}/close`);
check('repeated close is harmless; prepare again returns the existing (non-draft) poll', poll().frozen!.hash === fz.hash && (await lv.call('POST', '/internal/poll', { match: 'M1', players: [ra[0].handle, rb[0].handle] })).id === id);
await lv.call('POST', `/internal/poll/${id}/reveal`);
check('reveal: closed → revealed', poll().status === 'revealed');
check('live counts never leave as voter ids: summary has counts only', !JSON.stringify(lv.summary()).includes('"votes"') && !JSON.stringify(lv.summary()).includes('tw:101'));
check('restart: the store sanitizes back with polls and votes', sanitizeLocalVote(JSON.parse(JSON.stringify(store))).polls[0].frozen?.hash === fz.hash && saves > 3);

// ---------------------------------------------------------------- Audience in local mode (no VOTE_URL here)
const wc = defaultWildcard();
wc.teams = MAJOR_TEAMS.map(t => t.name);
wc.matches.R1_UB1 = { ...wc.matches.R1_UB1, s1: '3', s2: '1' };
const RR = wcResolve(wc.matches, wc.teams);
const roster = [...teamRoster(RR.R1_UB1.t1!), ...teamRoster(RR.R1_UB1.t2!)];
const astore = { ...emptyAudStore(), publicUrl: 'https://vote.example.gg' };
let pushes = 0;
const aud = new Audience(astore, () => {}, () => wc, () => pushes++);
await aud.tick();
check('no vote service: MVP voting is available, counted locally, "online" (needs no internet)', aud.configured && aud.mode === 'local' && aud.priv().online && aud.priv().mode === 'local');
check('local counting: the website QR is not offered (website votes would never reach the local count)', !aud.pub().qr.some(q => q.id === 'vote'));
check('prepare a vote on a finished bracket match', (await aud.op({ k: 'mvp-prepare', match: 'R1_UB1', players: roster.slice(0, 3).map(p => p.handle) })) === null);
let p1 = aud.priv().summary!.polls.find(p => p.match === 'R1_UB1')!;
check('…the poll is visible to the producer like an online one', p1.status === 'draft' && p1.id.startsWith('local:'));
await aud.op({ k: 'mvp-open', poll: p1.id });
check('rehearsal votes through the producer command', (await aud.op({ k: 'mvp-sim', poll: p1.id, votes: 25 })) === null && aud.priv().summary!.polls.find(p => p.id === p1.id)!.total === 25);
check('the public state never carries live counts', !('counts' in aud.pub().polls.find(p => p.id === p1.id)!));
// manual MVP while voting is open: closed first, the production's choice stands
const pick = roster[2].handle;
check('manual MVP: a player who did not play is refused', /did not play/.test((await aud.op({ k: 'mvp-override', match: 'R1_UB1', player: 'Nobody' })) ?? ''));
check('manual MVP: accepted', (await aud.op({ k: 'mvp-override', match: 'R1_UB1', player: pick })) === null);
p1 = aud.priv().summary!.polls.find(p => p.match === 'R1_UB1')!;
check('…the open vote was closed first (counts frozen and kept), the frozen result names the chosen player', p1.status === 'closed' && p1.frozen!.manual === pick && p1.frozen!.total === 25);
check('…so the reveal is allowed (frozen result)', revealAllowed('winner', { status: p1.status, frozen: !!p1.frozen, desk: false, published: '' }) === null);
check('…and the public state carries it (graphics render "chosen by the broadcast team")', aud.pub().polls.find(p => p.match === 'R1_UB1')!.frozen!.manual === pick);
await aud.op({ k: 'mvp-override', match: 'R1_UB1', player: null });
check('Undo: back to the vote\'s own frozen result', !aud.priv().summary!.polls.find(p => p.match === 'R1_UB1')!.frozen!.manual);
// manual MVP with no vote at all (the voting service failed before anything was prepared)
wc.matches.R1_UB2 = { ...wc.matches.R1_UB2, s1: '1', s2: '3' };
const r2 = wcResolve(wc.matches, wc.teams).R1_UB2, pl2 = teamRoster(r2.t2!)[0].handle;
await aud.op({ k: 'mvp-override', match: 'R1_UB2', player: pl2 });
const syn = aud.priv().summary!.polls.find(p => p.match === 'R1_UB2')!;
check('manual MVP with no vote: a closed "manual" result exists for the match (reveal can run)', syn.id === 'manual:R1_UB2' && syn.status === 'closed' && syn.frozen!.manual === pl2 && syn.players[0].handle === pl2);
check('rehearsal refused when the online service counts (never fake votes into public voting)', await (async () => { const s2 = { ...emptyAudStore() }; const a2 = new Audience(s2, () => {}, () => wc, () => {}); Object.defineProperty(a2, 'remote', { get: () => true }); return /only in local voting/.test((await a2.op({ k: 'mvp-sim', poll: 'x', votes: 5 })) ?? ''); })());
check('counting mode is a stored producer setting', (await aud.op({ k: 'vote-mode', mode: 'local' })) === null && astore.voteMode === 'local' && aud.mode === 'local');

// ---------------------------------------------------------------- main scenes
const gfx = [{ id: 'caster-desk' }, { id: 'analyst-desk' }, { id: 'gameplay' }, { id: 'mvp' }];
const flow = (status: 'draft' | 'open' | 'closed' | 'revealed' | null, frozen = false, desk = false, published = '') => ({ status, frozen, desk, published });
const ms = mainScenes(gfx, { flow: flow(null), selected: null });
check('main scenes in show order, MVP among them', ms.map(s => s.id).join(',') === 'show,analyst-desk,caster-desk,team-intro,mvp,veto,gameplay,bracket,matches', ms.map(s => s.id));
check('a graphic that does not exist is not offered', !mainScenes([{ id: 'mvp' }], { flow: flow(null), selected: null }).some(s => s.id === 'caster-desk'));
check('MVP tile follows the flow: voting → closed → community reveal → analyst → comparison',
  suggestedMvpView(flow(null)) === 'voting' && suggestedMvpView(flow('open')) === 'voting' && suggestedMvpView(flow('closed')) === 'closed' && suggestedMvpView(flow('closed', true)) === 'winner'
  && suggestedMvpView(flow('closed', true, true, 'winner')) === 'desk' && suggestedMvpView(flow('closed', true, false, 'winner')) === 'winner' && suggestedMvpView(flow('revealed', true, true, 'desk')) === 'compare');
const onView = mainScenes(gfx, { flow: flow('open'), selected: 'compare' }).find(s => s.id === 'mvp')!;
check('…but stays on the view the producer chose; its TAKE target is that view\'s scene', onView.sel === MVP_SOURCE.compare && onView.target === 's:mvp-compare');
check('any MVP view selection belongs to the MVP tile', mainSceneOf('mvp-winner', ms)?.id === 'mvp' && mainSceneOf('g:caster-desk', ms)?.id === 'caster-desk' && mainSceneOf('veto', ms)?.id === 'veto' && !mainSceneOf('scoreboard', ms));
check('every non-MVP main scene targets a registry scene, a graphic or (Safe / BRB) its main scene', MAIN_SCENE_DEFS.every(s => s.target.startsWith('g:') || s.target.startsWith('s:') || s.target === 'main:safe'));

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

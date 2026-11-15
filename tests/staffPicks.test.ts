// Staff pick'em rules: npx tsx tests/staffPicks.test.ts
import { DEFAULT_STAFF, emptyStaffPicks, sanitizeStaffPicks, staffBoard, staffLocked, staffOp, staffPick, staffTable } from '../shared/staffPicks';
import { defaultWildcard } from '../shared/wildcard';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

const wc = defaultWildcard(true);
wc.teams = ['BIG', 'Qualifier A', 'COOK', 'Qualifier B', 'AW', 'Qualifier C', 'FUT', 'Qualifier D'];
const NOW = Date.UTC(2026, 10, 20, 12);
for (const id of Object.keys(wc.matches)) wc.matches[id] = { ...wc.matches[id], s1: '', s2: '', at: null, time: '', live: false };
wc.matches.R1_UB1.at = '2026-11-21T15:00'; // tomorrow
const sp = emptyStaffPicks('k'.repeat(16));

check('staff list from the sheet + Max and Babz', ['Boney', 'GGeek', 'Legion2k', 'NuaLaoch', 'Padster', 'The_Toble', 'Turbo', 'Orion', 'Max', 'Babz'].every(n => sp.roster.includes(n)) && DEFAULT_STAFF.length === 10);
check('pick saved (winner + score)', staffPick(sp, wc, 'Boney', 'R1_UB1', { team: 'BIG', score: '3-1' }, NOW) === null && sp.picks.R1_UB1.Boney.team === 'BIG');
check('names are case-insensitive (one pick per person)', staffPick(sp, wc, 'boney', 'R1_UB1', { team: 'Qualifier A', score: '3-2' }, NOW) === null && Object.keys(sp.picks.R1_UB1).length === 1 && sp.picks.R1_UB1.Boney.team === 'Qualifier A');
check('not on the staff list → refused', staffPick(sp, wc, 'Stranger', 'R1_UB1', { team: 'BIG', score: '3-0' }, NOW) !== null);
check('a team not in the match → refused', staffPick(sp, wc, 'Max', 'R1_UB1', { team: 'COOK', score: '3-0' }, NOW) !== null);
check('score required (3-0 / 3-1 / 3-2)', staffPick(sp, wc, 'Max', 'R1_UB1', { team: 'BIG', score: '2-1' }, NOW) !== null);
check('match whose teams are unknown → refused', staffPick(sp, wc, 'Max', 'R2_UB1', { team: 'BIG', score: '3-0' }, NOW) !== null);
staffPick(sp, wc, 'Babz', 'R1_UB1', { team: 'BIG', score: '3-0' }, NOW);
staffPick(sp, wc, 'GGeek', 'R1_UB1', { team: 'BIG', score: '3-1' }, NOW);

let b = staffBoard(sp, wc, 'Babz', NOW);
const m1 = b.matches.find(m => m.id === 'R1_UB1')!;
check('before the start: only who picked is visible, not what', !m1.locked && m1.picks === null && m1.pickedBy.length === 3);
check('…but your own picks are returned to you', b.mine.R1_UB1?.team === 'BIG' && b.mine.R1_UB1?.score === '3-0' && !b.mine.R1_UB2);

check('locks at the start time', staffLocked(sp, wc, 'R1_UB1', Date.UTC(2026, 10, 22)) === true);
check('locked → picks refused', staffPick(sp, wc, 'Max', 'R1_UB1', { team: 'BIG', score: '3-0' }, Date.UTC(2026, 10, 22)) !== null);
staffOp(sp, { k: 'lock', match: 'R1_UB1', state: 'open' }, () => 'x');
check('producer can keep it open past the start (e.g. delay)', staffLocked(sp, wc, 'R1_UB1', Date.UTC(2026, 10, 22)) === false);
staffOp(sp, { k: 'lock', match: 'R1_UB2', state: 'locked' }, () => 'x');
check('producer can lock early', staffLocked(sp, wc, 'R1_UB2', NOW) === true);
wc.matches.R1_UB1.s1 = '1';
staffOp(sp, { k: 'lock', match: 'R1_UB1', state: 'auto' }, () => 'x');
check('first map score locks (auto)', staffLocked(sp, wc, 'R1_UB1', NOW) === true);
b = staffBoard(sp, wc, 'Babz', NOW);
check('after the start: everyone’s picks visible', !!b.matches.find(m => m.id === 'R1_UB1')!.picks?.GGeek);

wc.matches.R1_UB1 = { ...wc.matches.R1_UB1, s1: '3', s2: '1' };
const t = staffTable(sp, wc);
check('scoring: exact score 3, right winner 1, wrong 0', t.find(r => r.name === 'GGeek')!.points === 3 && t.find(r => r.name === 'Babz')!.points === 1 && t.find(r => r.name === 'Boney')!.points === 0);
check('leaderboard order: points, then exact scores', t[0].name === 'GGeek' && t[1].name === 'Babz');
check('a result locks even if the producer opened it', (staffOp(sp, { k: 'lock', match: 'R1_UB1', state: 'open' }, () => 'x'), staffLocked(sp, wc, 'R1_UB1', NOW)) === true);
b = staffBoard(sp, wc, null, NOW);
check('result + points on the board', b.matches.find(m => m.id === 'R1_UB1')!.result?.score === '3-1' && b.matches.find(m => m.id === 'R1_UB1')!.picks!.GGeek.points === 3);

check('staff list edit: add, dedupe, keep picks of removed names', staffOp(sp, { k: 'roster', names: ['Boney', 'boney', 'NewGuy'] }, () => 'x') === null && sp.roster.join() === 'Boney,NewGuy' && !!sp.picks.R1_UB1.GGeek);
check('…removed names still count in the table', staffTable(sp, wc).some(r => r.name === 'GGeek'));
check('empty list refused', staffOp(sp, { k: 'roster', names: [] }, () => 'x') !== null);
check('remove one pick', staffOp(sp, { k: 'remove', match: 'R1_UB1', name: 'ggeek' }, () => 'x') === null && !sp.picks.R1_UB1.GGeek);
check('new link key', staffOp(sp, { k: 'new-key' }, () => 'NEWKEY123456789') === null && sp.key === 'NEWKEY123456789');
const round = sanitizeStaffPicks(JSON.parse(JSON.stringify(sp)), 'fallbackkey00');
check('survives a restart (sanitized)', JSON.stringify(round) === JSON.stringify(sp));
check('junk is cleaned (bad match, script in name, bad score)', JSON.stringify(sanitizeStaffPicks({ roster: ['<b>x</b>', 'A'], picks: { nope: { A: { team: 'BIG', score: '3-0' } }, R1_UB2: { A: { team: 'COOK', score: '9-9' } } } }, 'kkkkkkkkkkkk').picks) === '{"R1_UB2":{"A":{"team":"COOK","score":""}}}');
check('reset', staffOp(sp, { k: 'reset' }, () => 'x') === null && !Object.keys(sp.picks).length && !Object.keys(sp.locks).length);

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

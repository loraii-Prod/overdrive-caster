// The Major data sheet (behind lavaaval.github.io/2026_overdrive_major) read by the event-tab parser: npx tsx tests/majorDataSheet.test.ts
import { readFileSync } from 'node:fs';
import { parseCsv, parseEventTab } from '../shared/sheet';
import { defaultWildcard, mergeSheet, wcResolve, WC_IDS } from '../shared/wildcard';
let ok = 0, bad = 0;
const check = (n: string, c: boolean, x = '') => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const d = parseEventTab(parseCsv(readFileSync(new URL('./fixtures/major-data-tab.csv', import.meta.url), 'utf8')));
check('8 teams with rosters', d.teams.length === 8 && d.teams[0].players.join(',') === 'Granady,Massa');
check('14 matches on app Major ids', d.matches.length === 14 && d.matches.every(m => WC_IDS.includes(m.bracket)), d.matches.map(m => m.bracket).join(' '));
check('R5_CF → lower final R4_LB1, R6_GF → R5_GF1, R2_LB1 → R1_LB1', !!d.matches.find(m => m.id === 'MATCH_0043' && m.bracket === 'R4_LB1') && !!d.matches.find(m => m.id === 'MATCH_0044' && m.bracket === 'R5_GF1') && !!d.matches.find(m => m.id === 'MATCH_0037' && m.bracket === 'R1_LB1'));
check('US dates read (11/21/2026 15:00 → SAT 15:00)', d.matches[0].time === 'SAT 15:00', d.matches[0].time);
const wc = defaultWildcard(true);
for (const id of WC_IDS) wc.matches[id] = { ...wc.matches[id], s1: '', s2: '' };
mergeSheet(wc, d.matches.map(m => ({ bracket: m.bracket, s1: m.s1, s2: m.s2, status: m.status, when: m.when ?? '' })));
wc.teams = ['BIG', 'rnboi', 'COOK', 'Ragnarok', 'Airwalkers', 'NAVI', '', ''];
const R = wcResolve(wc.matches, wc.teams);
check('scores flow: R2_UB1 = BIG vs Ragnarok, R1_LB1 = rnboi vs COOK', R.R2_UB1.t1 === 'BIG' && R.R2_UB1.t2 === 'Ragnarok' && R.R1_LB1.t1 === 'rnboi' && R.R1_LB1.t2 === 'COOK');
check('grand final time Sun 19:00', wc.matches.R5_GF1.time.endsWith('19:00'), wc.matches.R5_GF1.time);
// the Wildcard's own numbering is left alone (no Major-only codes)
const w = parseEventTab([['match_id', 'bracket_id'], ['M1', 'R2_LB1'], ['M2', 'R5_GF1']]);
check('a sheet in the app numbering is not remapped', w.matches[0].bracket === 'R2_LB1' && w.matches[1].bracket === 'R5_GF1');
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);

// The Google Sheet's Major bracket tab read straight into the Major bracket: npx tsx tests/majorSheet.test.ts
import { readFileSync } from 'node:fs';
import { parseCsv, parseEventTab, parseMajorBracketTab, SHEET_MAJOR_IDS } from '../shared/sheet';
import { defaultWildcard, mergeSheet, wcResolve, WC_IDS, WC_STRUCT } from '../shared/wildcard';
import { resolveTeam } from '../shared/trackProgress';
let ok = 0, bad = 0;
const check = (n: string, c: boolean, x = '') => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const rows = parseCsv(readFileSync(new URL('./fixtures/major-bracket-tab.csv', import.meta.url), 'utf8'));
check('not an event data tab (old parser finds nothing)', parseEventTab(rows).matches.length === 0);
const b = parseMajorBracketTab(rows)!;
check('bracket tab detected', !!b);
check('14 matches, every one on an app Major id', b.matches.length === 14 && b.matches.every(m => WC_IDS.includes(m.bracket)), b.matches.map(m => m.bracket).join(' '));
check('code map covers the 14 app ids once each', new Set(Object.values(SHEET_MAJOR_IDS)).size === 14 && WC_IDS.every(id => Object.values(SHEET_MAJOR_IDS).includes(id)));
// structure check: each sheet origin ("W R2_UB1", "L R3_UBF") maps onto the app's WC_STRUCT feeders
const origin = (s: string) => { const m = /^([WL]) (R\d_\w+)$/.exec(s); return m ? { [m[1] === 'W' ? 'w' : 'l']: SHEET_MAJOR_IDS[m[2]] } : null; };
const feedOk = b.matches.filter(m => !/^R1_UB/.test(m.bracket)).every(m => {
  const [a, c] = WC_STRUCT[m.bracket];
  return JSON.stringify(origin(m.t1.id)) === JSON.stringify(a) && JSON.stringify(origin(m.t2.id)) === JSON.stringify(c);
});
check('every sheet feeder (W/L of …) is the same as the app bracket (lower final = R5_CF, grand final = R6_GF)', feedOk);
const qf1 = b.matches.find(m => m.bracket === 'R1_UB1')!;
check('team cells "TEAM_0001 | BIG" → id + name', qf1.t1.id === 'TEAM_0001' && qf1.t1.name === 'BIG' && qf1.t2.name === 'rnboi');
check('scores read', qf1.s1 === '3' && qf1.s2 === '1');
check('time read (21.11.2026 15:00)', qf1.when === '21.11.2026 15:00' && qf1.time.endsWith('15:00'));
check('8 seeded teams', b.teams.length === 8 && b.teams.find(t => t.name === 'BIG')?.seed === 1);
check('placeholders become TBD labels', b.matches.find(m => m.bracket === 'R5_GF1')!.t1.name === 'Winner R3 UBF');
// into the bracket state
const wc = defaultWildcard(true);
for (const id of WC_IDS) wc.matches[id] = { ...wc.matches[id], s1: '', s2: '' };
mergeSheet(wc, b.matches.map(m => ({ bracket: m.bracket, s1: m.s1, s2: m.s2, status: m.status, when: m.when ?? '' })));
const seeds = b.matches.filter(m => /^R1_UB/.test(m.bracket)).sort((x, y) => x.bracket.localeCompare(y.bracket)).flatMap(m => [m.t1.name, m.t2.name]);
wc.teams = seeds.map(n => resolveTeam({ name: n }).name);
const R = wcResolve(wc.matches, wc.teams);
check('scores land on the right matches', wc.matches.R1_UB1.s1 === '3' && wc.matches.R1_UB2.s2 === '3');
check('results flow: R2_UB1 = BIG vs Ragnarok', R.R2_UB1.t1 === 'BIG' && R.R2_UB1.t2 === 'Ragnarok', `${R.R2_UB1.t1} v ${R.R2_UB1.t2}`);
check('…and the losers drop to the lower bracket (R1_LB1 = rnboi vs COOK)', R.R1_LB1.t1 === 'rnboi' && R.R1_LB1.t2 === 'COOK', `${R.R1_LB1.t1} v ${R.R1_LB1.t2}`);
check('NAVI x Joel → NAVI Team', wc.teams[5] === 'NAVI Team', wc.teams.join(', '));
check('times from the sheet', wc.matches.R5_GF1.time.endsWith('19:00'), wc.matches.R5_GF1.time);
check('FUT x Heav / All Gamers are not guessed (left for the producer)', !['FUT Esports', 'All Gamers Global'].some(t => b.teams.some(x => resolveTeam({ name: x.name }).name === t)));
console.log(`\n${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);

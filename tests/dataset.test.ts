// Verified OverDrive 2026 dataset (public/season/overdrive-2026.json) against its sources: npx tsx tests/dataset.test.ts
import fs from 'node:fs';
import { SEASON_VERIFIED } from '../shared/seasonVerified';
import { seasonOf, SEASON } from '../shared/season';
import { MAJOR_TEAMS } from '../shared/major';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const d = JSON.parse(fs.readFileSync('public/season/overdrive-2026.json', 'utf8'));
const lines = (f: string) => fs.readFileSync(`season-data/source/2026/${f}`, 'utf8').split('\n').filter(l => l.trim()).length;
const T = new Map<string, any>(d.teams.map((t: any) => [t.id, t]));
const M = d.matches as any[];

check('every source match row imported once (Split 1 101 + Split 2/Wildcard 125 + circuit 625)',
  M.length === (lines('split1_matches.csv') - 1) + lines('raw_fall_winter.txt') + lines('raw_fall_circuit.txt') + lines('raw_spring_continentals.txt') + lines('raw_spring_oq.txt'), `${M.length}`);
check('teams: every source record kept (106) + 2 provisional Split 1 entries', d.teams.length === lines('teams.txt') + 2 && d.teams.filter((t: any) => t.status === 'split1-only').length === 2);
check('standings / placements / Overpoints rows all imported', d.standings.length === lines('standings.csv') - 1 && d.continentalPlacements.length === lines('continentals_placements.csv') - 1 && d.overpoints.length === lines('overpoints_ranking.csv') - 1);
check('match ids are unique and stable (source code or content hash)', new Set(M.map(m => m.id)).size === M.length);
check('every match belongs to a known tournament', M.every(m => d.tournaments.some((t: any) => t.id === m.tournament)));
check('every team reference points at a team record', [...M.flatMap(m => [m.a.team, m.b.team]), ...d.standings.map((r: any) => r.team), ...d.overpoints.map((r: any) => r.team)].every(id => id === null || T.has(id)));
check('only "BYE" and the ambiguous "Rex Regum Qeon" are left without a team record', JSON.stringify(d.unresolvedNames) === '["BYE","Rex Regum Qeon"]', d.unresolvedNames.join(','));
check('3 regions: Oceasia, Americas, EMEA', JSON.stringify([...new Set(d.tournaments.map((t: any) => t.region).filter(Boolean))].sort()) === '["Americas","EMEA","Oceasia"]');
check('the Major has dates and no invented matches', M.filter(m => m.tournament === 'od26-major').length === 0 && d.tournaments.find((t: any) => t.id === 'od26-major').dates.length === 2);
// league tables recomputed from the match records = the sheet's standings
for (const tid of ['od26-s1-div1', 'od26-s1-div2', 'od26-s2-div1', 'od26-s2-div2']) {
  const rec = new Map<string, number[]>();
  for (const m of M.filter(x => x.tournament === tid)) for (const [s, o] of [['a', 'b'], ['b', 'a']] as const) {
    const k = m[s].team ?? m[s].name.toLowerCase(), r = rec.get(k) ?? [0, 0, 0, 0];
    if (m.winner === s) r[0]++; else if (m.winner) r[1]++;
    const f = m['score' + s.toUpperCase()], a = m['score' + o.toUpperCase()];
    if (typeof f === 'number' && typeof a === 'number') { r[2] += f; r[3] += a; }
    rec.set(k, r);
  }
  const rows = d.standings.filter((r: any) => r.tournament === tid);
  const off = rows.filter((r: any) => JSON.stringify(rec.get(r.team ?? r.name.toLowerCase())) !== JSON.stringify([r.w, r.l, r.tracksW, r.tracksL]));
  check(`${tid}: standings (W, L, tracks) = recomputed from the ${M.filter(x => x.tournament === tid).length} matches`, rows.length >= 9 && off.length === 0, off.map((r: any) => r.name).join(','));
}
check('Split 1 match records keep track scores (except the 3 the sheet marks "missing") and admins', M.filter(m => m.tournament.startsWith('od26-s1-div') && m.code).every(m => Array.isArray(m.tracks) || m.trackData === 'missing') && M.filter(m => m.trackData === 'missing').length === 3 && M.some(m => m.admin));
// logos
const used = MAJOR_TEAMS.map(t => t.name);
const MJ = d.majorTeams as Record<string, any>;
check('every Major team listed with its logo file and a team candidate', used.every(n => MJ[n] && T.has(MJ[n].team) && fs.existsSync('public' + MJ[n].logoFile)));
check('Major names that are not sheet team names stay unconfirmed (FUT Esports, Natus Vincere, All Gamers Global)', ['FUT Esports', 'Natus Vincere', 'All Gamers Global'].every(n => MJ[n].confirmed === false) && ['BIG', 'COOK', 'Airwalkers', 'Ragnarok', 'rnboi'].every(n => MJ[n].confirmed === true));
check('unconfirmed links derive nothing: no logo on the team record, no season line', ['FUT Esports', 'Natus Vincere', 'All Gamers Global'].every(n => !T.get(MJ[n].team).logo && !SEASON_VERIFIED[n]));
check('COOK / FUT logo files flagged as the OverDrive placeholder', MJ['COOK'].logoIsPlaceholder === true && MJ['FUT Esports'].logoIsPlaceholder === true && !MJ['BIG'].logoIsPlaceholder);
check('logos tab imported as a dated registry (team_id, name, official SVG)', d.logoRegistry.length === lines('logos.csv') - 1 && d.logoRegistry.some((e: any) => e.team === 'TEAM_0005' && e.name === 'FUT Esports' && e.svg === 'FUT_Esport.svg' && e.date === '2026-04-03'));
check('Split 1 FUT / NAVI kept as their own records with both pieces of evidence, unconfirmed', ['S1_FUT', 'S1_NAVI'].every(id => T.get(id).confirmed === false && T.get(id).possibleSameTeam.length === 2));
check('ambiguous Split 1 "Rex Regum Qeon" left unlinked (TEAM_0023 vs TEAM_0073)', M.filter(m => m.tournament.startsWith('od26-s1') && [m.a.name, m.b.name].includes('Rex Regum Qeon')).every(m => (m.a.name === 'Rex Regum Qeon' ? m.a.team : m.b.team) === null) && M.filter(m => m.tournament === 'od26-s2-div2' && [m.a.name, m.b.name].includes('Rex Regum Qeon')).every(m => (m.a.name === 'Rex Regum Qeon' ? m.a.team : m.b.team) === 'TEAM_0023'));
check('duplicate retired records kept as in the source (Loading, Shark)', ['TEAM_0016', 'TEAM_0098', 'TEAM_0070', 'TEAM_0101'].every(id => T.has(id)));
// season lines
check('seasonOf keeps curated lines and only adds verified fills/corrections', used.every(n => { const s = seasonOf(n)!; const c = SEASON[n], v = SEASON_VERIFIED[n] ?? {}; return (['split1', 'split2', 'wildcards', 'road'] as const).every(k => s[k] === (v[k] ?? c[k])); }));
check('COOK Split 1 corrected to the verified 6th (4–5)', seasonOf('COOK')!.split1 === 'Div 1 · 6th in the league (4–5)');

check('offline: the dataset is a static file of the build (no Google Sheets / Render URL needed at runtime)', !/docs\.google\.com\/spreadsheets\/d\/[^"]*gviz/.test(JSON.stringify(d)) && fs.existsSync('public/season/overdrive-2026.json'));
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

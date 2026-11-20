// Overdrive 3.1 · Track Progression: sheet rows (28 columns), the round story, Overdrive teams / maps, operator ops.
//   npx tsx tests/trackProgress.test.ts
import { readFileSync } from 'node:fs';
import { parseCsv } from '../shared/sheet';
import { applyTrackOp, demoTrack, emptyTrack, lapTime, parseTrackRows, resolveMapId, resolveTeam, sanitizeTrack, trackSheetUrl, trackStory, TRACK_DEFAULT_SHEET } from '../shared/trackProgress';
import { defaultWildcard, sanitizeWildcard } from '../shared/wildcard';

let ok = 0, bad = 0;
const check = (name: string, cond: unknown, extra: unknown = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== '' ? `  [${JSON.stringify(extra)}]` : ''}`); };
const fx = (f: string) => parseCsv(readFileSync(new URL(`./fixtures/track/${f}`, import.meta.url), 'utf8'));

// ---------------------------------------------------------------- the sheet rows
const flat = parseTrackRows(fx('db_rounds_flat.csv'));
check('flat query: match, track number, 7 rounds in order', flat.matchId === 'match_0006' && flat.mapNumber === 1 && flat.rounds.map(r => r.round).join() === '1,2,3,4,5,6,7');
check('flat: track name → Overdrive map (czech), picked by, threshold', flat.mapId === 'czech' && flat.pickedBy === 'BIG PICK' && flat.pointLimit === 10, flat);
check('flat: "Weibo x FUT" + WeiboxFUT.png → our FUT Esports (logo weiboxfut)', flat.teamB.name === 'FUT Esports' && flat.teamB.logo === 'weiboxfut' && flat.teamA.name === 'BIG' && flat.teamA.logo === 'big', [flat.teamA, flat.teamB]);
check('flat: fastest lap read', flat.fastest?.player === 'Heav' && flat.fastest.timeMs === 38104 && flat.fastest.round === '4');
const ctl = parseTrackRows(fx('out_track_progression.csv'));
check('Control tab: "NaVi x Joel" → NAVI Team; Nyxar Competitive keeps its name + nyxar logo', ctl.teamA.name === 'NAVI Team' && ctl.teamA.logo === 'navixjoel' && ctl.teamB.name === 'Nyxar Competitive' && ctl.teamB.logo === 'nyxar', [ctl.teamA, ctl.teamB]);
check('Control tab: roster from the sheet kept', ctl.teamB.roster === 'Alpha & Beta');
check('a tab that is not a round table is refused (gviz answers a missing tab with the first tab)', (() => { try { parseTrackRows([['team_id', 'name'], ['big', 'BIG']]); return false; } catch (e: any) { return /Not a round table/.test(e.message); } })());
check('header only → clear error', (() => { try { parseTrackRows([fx('db_rounds_flat.csv')[0]]); return false; } catch (e: any) { return /No round rows|empty/.test(e.message); } })());
check('rows without a header row are read too', parseTrackRows(fx('db_rounds_flat.csv').slice(1)).rounds.length === 7);
check('points clamped to 0–3, duplicate round rows dropped', (() => { const r = fx('db_rounds_flat.csv'); const extra = [...r, [...r[3]]]; extra[2] = [...r[2]]; extra[2][7] = '9'; const d = parseTrackRows(extra); return d.rounds.length === 7 && d.rounds[1].ptsA === 3; })());
check('gviz URL: direct query of db_rounds_flat (match + track)', /sheet=db_rounds_flat/.test(trackSheetUrl('X', { match: 'match_0006', track: 2, tab: '' })) && decodeURIComponent(trackSheetUrl('X', { match: "m'1", track: 2, tab: '' })).includes("A = 'm1' AND B = 2"));
check('gviz URL: Control tab when no match', /sheet=out_track_progression$/.test(trackSheetUrl('X', { match: '', track: 1, tab: 'out_track_progression' })));

// your sheet's real Control tab (16 Nov 2026): team1_* headers, empty team2_tag, ids in F/G, short track name
const real = parseTrackRows([
  ['match_id', 'track_number', 'round_number', 'track_id', 'p1_team_id', 'team1_id', 'team2_id', 'team1_pts', 'team2_pts', 'combo1', 'combo2', 'track_name_short', 'picked_by', 'point_limit', 'team1_tag', 'team1_name', 'team1_roster', 'team1_color', 'team1_logo', 'team2_tag', 'team2_name', 'team2_roster', 'team2_color', 'team2_logo', 'fastest_player', 'fastest_time_ms', 'fastest_round', 'custom_takeaway'],
  ['match_0006', '1', '1', 'track_017', 'team_011', 'team_011', 'team_015', '3', '0', '1-2', '3-4', 'Czech Republic', 'Brothers PICK', '10', 'BRO', 'Brothers', 'Bestie77 & Hyll-TM', '', 'Brothers.png', '', 'Nyxar Competitive', 'Lukario & Kymi_.', '', 'Nyxar.png', 'Lukario', '60320', '4', ''],
  ['match_0006', '1', '2', 'track_017', 'team_011', 'team_011', 'team_015', '2', '1', '1-3', '2-4', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
]);
check('real sheet layout: Czech map, Brothers (BRO, brothers logo) vs Nyxar Competitive (nyxar logo)', real.mapId === 'czech' && real.teamA.tag === 'BRO' && real.teamA.logo === 'brothers' && real.teamB.name === 'Nyxar Competitive' && real.teamB.logo === 'nyxar', [real.teamA, real.teamB]);
check('real sheet: empty team2_tag → "Nyxar", never the id team_015', real.teamB.tag === 'Nyxar', real.teamB.tag);
check('real sheet: 5–1 after 2 rounds, fastest Lukario 1:00.320 R4', trackStory(real).scoreA === 5 && real.fastest?.player === 'Lukario' && lapTime(real.fastest.timeMs) === '1:00.320');

// ---------------------------------------------------------------- the story
const s = trackStory(flat);
check('cumulative: 12–8 after 7 rounds, BIG won the track', s.scoreA === 12 && s.scoreB === 8 && s.done && s.winner === 'a', [s.scoreA, s.scoreB]);
check('aces / draws counted', s.acesA === 2 && s.acesB === 1 && s.draws === 1);
check('outcomes per round', s.steps.map(x => x.outcome).join() === 'WIN,ACE,ACE,DRAW,WIN,WIN,ACE');
check('auto takeaway names the winner', /BIG/.test(s.narrative), s.narrative);
const live = trackStory({ ...flat, rounds: flat.rounds.slice(0, 3) });
check('in progress: not done, leader + distance to the threshold', !live.done && live.leader === 'a' && /lead 5–4 after 3 rounds/.test(live.narrative), live.narrative);
const demo = trackStory(demoTrack());
check('demo: overtime, 13–12, overtime takeaway', demo.overtime && demo.done && demo.scoreA === 13 && demo.scoreB === 12 && /Overtime/.test(demo.narrative), demo.narrative);
check('custom takeaway wins over the automatic one', trackStory({ ...flat, narrative: 'Custom' }).narrative === 'Custom');
check('lap time format', lapTime(38104) === '38.104' && lapTime(81005) === '1:21.005');

// ---------------------------------------------------------------- Overdrive teams and maps
check('team aliases: NAVI / AG / FUT', resolveTeam({ tag: 'NAVI' }).name === 'NAVI Team' && resolveTeam({ name: 'AG' }).name === 'All Gamers Global' && resolveTeam({ name: 'fut' }).name === 'FUT Esports');
check('unknown team: own name, no logo (tag badge drawn)', (() => { const t = resolveTeam({ tag: 'ZZZ', name: 'Zed Team' }); return t.name === 'Zed Team' && t.logo === '' && t.tag === 'ZZZ'; })());
check('Major team without roster in the sheet: roster from the verified profiles', resolveTeam({ name: 'BIG' }).roster.includes('&'));
check('map names → ids', resolveMapId('OverDrive United Kingdom 2026') === 'uk' && resolveMapId('New Zealand') === 'nz' && resolveMapId('india') === 'india' && resolveMapId('Alpine Valley') === '');

// ---------------------------------------------------------------- entered in Overdrive
const t = emptyTrack();
check('a round before a track is refused', applyTrackOp(t, { k: 'track-round', ptsA: 3, ptsB: 0 }, 1) !== null);
applyTrackOp(t, { k: 'track-new', teamA: 'BIG', teamB: 'Ragnarok', mapId: 'egypt', mapNumber: 2, pickedBy: 'Ragnarok pick' }, 2);
check('track-new: teams, map, number, picked by (upper case), no rounds', t.data?.teamB.name === 'Ragnarok' && t.data.mapId === 'egypt' && t.data.track === 'OverDrive Egypt 2026' && t.data.pickedBy === 'RAGNAROK PICK' && t.data.rounds.length === 0);
for (const [a, b] of [[3, 0], [1, 1], [1, 2]]) applyTrackOp(t, { k: 'track-round', ptsA: a, ptsB: b }, 3);
check('rounds added with their combos', t.data!.rounds.map(r => `${r.ptsA}${r.ptsB}${r.comboA}`).join() === '301-2,111-4,122-4');
check('an impossible round (2–2) is refused', applyTrackOp(t, { k: 'track-round', ptsA: 2, ptsB: 2 }, 4) !== null && t.data!.rounds.length === 3);
applyTrackOp(t, { k: 'track-undo' }, 5);
check('undo removes the last round', t.data!.rounds.length === 2);
applyTrackOp(t, { k: 'track-meta', patch: { pointLimit: 7, fastest: { player: 'Massa', timeMs: 40000, round: '2' }, narrative: 'x' } }, 6);
check('meta: threshold, fastest lap, takeaway', t.data!.pointLimit === 7 && t.data!.fastest?.player === 'Massa' && t.data!.narrative === 'x');
t.src = { ...t.src, mode: 'sheet', auto: true };
applyTrackOp(t, { k: 'track-round', ptsA: 2, ptsB: 1 }, 7);
check('entering a round switches to "Entered here" (auto refresh off: the sheet would overwrite it)', t.src.mode === 'manual' && !t.src.auto);
applyTrackOp(t, { k: 'track-demo' }, 8);
check('demo flagged', t.demo && t.data?.matchId === 'demo');
applyTrackOp(t, { k: 'track-clear' }, 9);
check('clear: no data (graphic draws nothing)', t.data === null && !t.demo);
applyTrackOp(t, { k: 'track-src', patch: { sheetId: ' ab/c d ', match: "x'y", track: 42, tab: '' } as any }, 10);
check('source sanitized (id characters, match, track 1–9, tab default)', t.src.sheetId === 'abcd' && t.src.match === 'xy' && t.src.track === 9 && t.src.tab === 'out_track_progression', t.src);

// ---------------------------------------------------------------- saved state
const saved = sanitizeTrack(JSON.parse(JSON.stringify({ src: { mode: 'sheet', sheetId: TRACK_DEFAULT_SHEET, auto: true }, data: flat, at: 5, error: '', demo: false })));
check('sanitize round-trip keeps data + source', saved.data?.rounds.length === 7 && saved.src.mode === 'sheet' && saved.src.auto && saved.data.teamB.logo === 'weiboxfut');
check('sanitize drops a bad logo / map id', (() => { const x = sanitizeTrack({ data: { ...flat, mapId: 'mars', teamA: { ...flat.teamA, logo: '../evil' } } }); return x.data?.mapId === '' && x.data?.teamA.logo === ''; })());
check('event state: track defaults empty; older saves load', (() => { const w = sanitizeWildcard({}); return w.track.data === null && w.track.src.mode === 'manual' && defaultWildcard().track.data === null; })());

console.log(`\n${ok}/${ok + bad} passed`);
if (bad) process.exit(1);

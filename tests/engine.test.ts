// Engine logic tests (no server needed): npx tsx tests/engine.test.ts
import { createEngine } from '../server/engine';
import { defaultScene, defaultShow } from '../shared/defaults';
import { defaultWildcard } from '../shared/wildcard';
import { defaultMedia } from '../shared/media';
import { sanitizeGraphics } from '../shared/gfx';
const clone = (v: any) => JSON.parse(JSON.stringify(v));
const db: any = { preview: defaultScene(), live: defaultScene(), showPreview: defaultShow(), showLive: defaultShow(), wildcard: defaultWildcard(true), instant: false, media: defaultMedia(), graphics: sanitizeGraphics([]), rundown: { items: [], cue: null } };
const log: string[] = [];
let obsOk = true;
const eng = createEngine({ db, save() {}, goLive(t) { const before = db.live.screen; db.live = clone(db.preview); db.showLive = clone(db.showPreview); log.push(`goLive ${before}->${db.live.screen} tr=${t}`); },
  airProgram(prev, t) { log.push(`air ${prev}->${db.live.screen} tr=${t}`); }, broadcastLive() { log.push('broadcastLive'); }, pushWc() { log.push(`pushWc booth=${db.wildcard.booth}`); },
  wcOp(op: any) { log.push('wcOp ' + op.k); if (op.k === 'score') db.wildcard.matches[op.id].s1 = String(Number(db.wildcard.matches[op.id].s1 || 0) + op.delta); if (op.k === 'pick') db.wildcard.intro.picks[op.slot] = op.pick; },
  quick(op: any) { log.push('quick ' + op.k); }, quickBadge(k) { log.push('badge ' + k); }, clearPopups() { log.push('clearPopups'); }, reloadOutputs() { return 3; }, pushState() {}, pushMedia() { log.push('pushMedia'); }, pushGfx() { log.push('pushGfx'); },
  setSeat(seat, t) { log.push(`seat ${seat}=${t}`); return seat >= 1 && seat <= 6 ? null : 'Unknown position'; }, editTalent() { return null; }, regenTalent() { return null; }, resyncSeat(s) { return s === 1 ? null : 'Nobody is connected in this position'; },
  async obsSetup(cmd: any) { log.push(`obsSetup ${cmd.action}`); return cmd.action === 'apply' && !cmd.hash ? { error: 'This preview is out of date: preview again.' } : { note: 'ok' }; },
  async obsSwitch(scene, t) { log.push(`obs ${scene} ${t ?? 'obs-default'}`); return obsOk ? null : 'OBS is not connected'; } });
let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const run = (cmd: any, by = 'A', src: any = 'manual', base?: number) => eng.run(cmd, by, src, base);
(async () => {
  check('fresh: nothing prepared', !eng.state().dirty);
  check('publish with nothing prepared is refused', !(await run({ c: 'publish' })).ok);
  // selecting scenes never airs anything
  const g0 = log.filter(l => l.startsWith('goLive') || l.startsWith('air')).length;
  for (const s of ['gameplay', 'analysis', 'veto']) await run({ c: 'stage-screen', screen: s });
  check('selecting scenes: no Program change, no transition', log.filter(l => l.startsWith('goLive') || l.startsWith('air')).length === g0);
  // prepare + publish
  await run({ c: 'stage-booth', ids: [3, 1] });
  check('caster positions are fixed (sorted 1,3)', JSON.stringify(eng.state().stage.booth) === '[1,3]');
  check('booth refuses analyst positions', !(await run({ c: 'stage-booth', ids: [4] })).ok);
  await run({ c: 'stage-flag', flag: 'scoreboard', on: true });
  await run({ c: 'camera', seat: 2, on: false });
  check('sources untouched before publish', db.wildcard.booth.length === 0 && !db.showLive.showScoreboard && db.live.casters[1].cameraOn === true);
  const screenBefore = db.live.screen;
  const v = eng.state().version;
  await run({ c: 'stage-flag', flag: 'ticker', on: false }, 'B');
  check('publish refused if another operator changed the draft', !(await run({ c: 'publish' }, 'A', 'manual', v)).ok);
  const p = await run({ c: 'publish' }, 'A', 'manual', eng.state().version);
  check('publish ok', p.ok, (p as any).error);
  check('publish applied booth, scoreboard, camera', JSON.stringify(db.wildcard.booth) === '[1,3]' && db.showLive.showScoreboard && db.live.casters[1].cameraOn === false);
  check('publish never switches a scene / transitions', db.live.screen === screenBefore && log.some(l => l === `goLive ${screenBefore}->${screenBefore} tr=cut`));
  check('clean after publish', !eng.state().dirty);
  // draft live data
  db.wildcard.cast = 'R1_UB1'; db.wildcard.intro.a = 'BIG'; db.wildcard.intro.b = 'rnboi';
  await run({ c: 'draft', cmd: { c: 'score', side: 'a', delta: 1 } });
  await run({ c: 'draft', cmd: { c: 'pick', slot: 4, team: 'BIG', score: '3-1' } });
  check('draft refuses a pick for a team not playing', !(await run({ c: 'draft', cmd: { c: 'pick', slot: 4, team: 'Nope', score: '3-1' } })).ok);
  check('draft refuses non-draftable commands', !(await run({ c: 'draft', cmd: { c: 'panic' } })).ok);
  check('draft pending, sources untouched', eng.state().draft.length === 2 && !db.wildcard.matches.R1_UB1.s1);
  await run({ c: 'revert' });
  check('revert drops the draft', eng.state().draft.length === 0 && !eng.state().dirty);
  await run({ c: 'draft', cmd: { c: 'score', side: 'a', delta: 1 } });
  await run({ c: 'draft', cmd: { c: 'pick', slot: 4, team: 'BIG', score: '3-1' } });
  await run({ c: 'publish' });
  check('publish applies prepared score + pick', db.wildcard.matches.R1_UB1.s1 === '1' && db.wildcard.intro.picks[4]?.team === 'BIG');
  // live data directly
  await run({ c: 'score', side: 'a', delta: 1 });
  check('live score goes straight to the sources', db.wildcard.matches.R1_UB1.s1 === '2');
  // ops through the engine
  check('op-wc veto allowed', (await run({ c: 'op-wc', op: { k: 'veto', map: 'india' } })).ok && log.includes('wcOp veto'));
  check('op-wc reset refused', !(await run({ c: 'op-wc', op: { k: 'reset' } })).ok);
  check('op-wc desk panel refused (it is prepared)', !(await run({ c: 'op-wc', op: { k: 'desk', panel: 'h2h' } })).ok);
  check('op-quick timer allowed', (await run({ c: 'op-quick', op: { k: 'timer-start', minutes: 5 } })).ok && log.includes('quick timer-start'));
  // talent
  check('seat ok', (await run({ c: 'seat', seat: 2, talent: 't3' })).ok && log.includes('seat 2=t3'));
  check('seat error is reported', !(await run({ c: 'seat', seat: 9, talent: 't3' })).ok);
  check('feed re-sync error is reported', !(await run({ c: 'feed-resync', seat: 4 })).ok);
  // OBS
  check('OBS switch with chosen transition', (await run({ c: 'obs-switch', scene: 'Overdrive · Gameplay', transition: 'stinger' })).ok && log.includes('obs Overdrive · Gameplay stinger'));
  check('OBS switch with OBS default transition', (await run({ c: 'obs-switch', scene: 'Overdrive · BRB', transition: 'obs' })).ok && log.includes('obs Overdrive · BRB obs-default'));
  obsOk = false; const fo = await run({ c: 'obs-switch', scene: 'X' });
  check('OBS failure reported, not silent', !fo.ok && (fo as any).error === 'OBS is not connected'); obsOk = true;
  check('automation cannot switch OBS right after a manual switch', !(await run({ c: 'obs-switch', scene: 'Overdrive · BRB' }, 'auto', 'auto')).ok);
  await run({ c: 'automation', hold: true });
  check('held automation cannot publish', !(await run({ c: 'publish' }, 'auto', 'auto')).ok);
  await run({ c: 'automation', hold: false });
  // media
  check('play with empty playlist refused', !(await run({ c: 'media', action: 'play' })).ok);
  await run({ c: 'media-set', playlist: ['/media/a.mp4', '/media/b.mp4', '/media/' + '..' + '/x.mp4', 'http://evil/x.mp4'] });
  check('playlist sanitized', JSON.stringify(db.media.playlist) === '["/media/a.mp4","/media/b.mp4"]');
  await run({ c: 'media', action: 'play' });
  check('play', db.media.status === 'playing' && db.media.index === 0);
  await run({ c: 'media', action: 'pause' }); check('pause keeps position', db.media.status === 'paused');
  await run({ c: 'media', action: 'play' }); check('resume', db.media.status === 'playing');
  const seq = db.media.seq; eng.mediaEnded(seq); check('auto-advance on end', db.media.index === 1 && db.media.status === 'playing');
  eng.mediaEnded(seq); check('a stale "ended" report is ignored', db.media.index === 1);
  eng.mediaEnded(db.media.seq); check('stops after the last item (no loop)', db.media.status === 'stopped');
  await run({ c: 'media-opts', loop: true }); await run({ c: 'media', action: 'goto', index: 1 }); eng.mediaEnded(db.media.seq);
  check('loop goes back to the first item', db.media.index === 0 && db.media.status === 'playing');
  // studio
  check('studio layout saved', (await run({ c: 'studio-set', scene: 'gameplay', modules: ['scoreboard', 'graphics', 'nope'], pinned: ['graphics'] })).ok && JSON.stringify(db.studio.scenes.gameplay) === '{"modules":["scoreboard","graphics"],"pinned":["graphics"]}');
  check('studio unknown scene refused', !(await run({ c: 'studio-set', scene: 'zzz', modules: [], pinned: [] })).ok);
  // instant
  db.instant = true; const sc = db.live.screen;
  await run({ c: 'stage-screen', screen: 'bracket' });
  check('instant: selecting a scene never publishes', db.live.screen === sc && !eng.state().dirty);
  await run({ c: 'stage-flag', flag: 'scoreboard', on: false });
  check('instant: prepared change publishes at once', db.showLive.showScoreboard === false);
  db.instant = false;
  // undo publish
  await run({ c: 'stage-flag', flag: 'scoreboard', on: true }); await run({ c: 'publish' });
  const u = await run({ c: 'undo' });
  check('undo a publish restores the sources', u.ok && db.showLive.showScoreboard === false, (u as any).note);
  check('panic', (await run({ c: 'panic' })).ok && log.includes('clearPopups'));
  // ---------------- graphics engine
  const cd = () => db.graphics.find((g: any) => g.id === 'caster-desk');
  check('default instances for every package', ['caster-desk', 'analyst-desk', 'scoreboard', 'gameplay'].every(id => db.graphics.some((g: any) => g.id === id)));
  check('gfx-set validates types', !(await run({ c: 'gfx-set', id: 'caster-desk', patch: { layout: 'quad' } })).ok && !(await run({ c: 'gfx-set', id: 'caster-desk', patch: { names: 'yes' } })).ok && !(await run({ c: 'gfx-set', id: 'caster-desk', patch: { accent: 'red' } })).ok);
  check('gfx-set refuses undeclared properties', !(await run({ c: 'gfx-set', id: 'caster-desk', patch: { foo: 1 } })).ok);
  const seq0 = cd().anim.seq;
  await run({ c: 'gfx-set', id: 'caster-desk', patch: { layout: 'duo', accent: '#22aaff' } });
  check('gfx-set prepares (draft), source config unchanged', cd().draft.layout === 'duo' && cd().config.layout === 'auto');
  const sbSeq = db.graphics.find((g: any) => g.id === 'scoreboard').anim.seq;
  await run({ c: 'gfx-publish', id: 'caster-desk' });
  check('gfx-publish applies + plays UPDATE on that graphic only', cd().config.layout === 'duo' && cd().draft === null && cd().anim.action === 'update' && cd().anim.seq === seq0 + 1 && db.graphics.find((g: any) => g.id === 'scoreboard').anim.seq === sbSeq);
  await run({ c: 'gfx-anim', id: 'caster-desk', action: 'out' }); check('OUT', cd().anim.action === 'out');
  await run({ c: 'gfx-set', id: 'caster-desk', patch: { names: false } }); await run({ c: 'gfx-publish', id: 'caster-desk' });
  check('publishing a hidden graphic does not bring it IN', cd().anim.action === 'out' && cd().config.names === false);
  await run({ c: 'gfx-anim', id: 'caster-desk', action: 'in' }); check('IN', cd().anim.action === 'in');
  await run({ c: 'gfx-set', id: 'caster-desk', patch: { matchup: true } });
  check('global publish includes graphic drafts', (await run({ c: 'publish' })).ok && cd().config.matchup === true);
  await run({ c: 'gfx-preset', id: 'caster-desk', op: 'save', name: 'Big match' });
  await run({ c: 'gfx-anim', id: 'caster-desk', action: 'reset' });
  check('RESET restores defaults', cd().config.layout === 'auto' && cd().config.matchup === false && cd().anim.action === 'reset');
  await run({ c: 'gfx-preset', id: 'caster-desk', op: 'load', name: 'Big match' });
  check('preset loads into the draft', cd().draft?.layout === 'duo' && cd().draft?.matchup === true);
  const cr = await run({ c: 'gfx-create', pkg: 'od.caster-desk', name: 'Caster Desk B' });
  check('second instance of the same package', cr.ok && db.graphics.some((g: any) => g.id === 'caster-desk-b' && g.pkg === 'od.caster-desk'), (cr as any).note);
  check('default instance cannot be deleted', !(await run({ c: 'gfx-delete', id: 'caster-desk' })).ok);
  check('extra instance can be deleted', (await run({ c: 'gfx-delete', id: 'caster-desk-b' })).ok && !db.graphics.some((g: any) => g.id === 'caster-desk-b'));
  check('unknown package refused', !(await run({ c: 'gfx-create', pkg: 'nope', name: 'x' })).ok);
  // persistence: what is saved comes back the same (minus the animation sequence)
  const back = sanitizeGraphics(JSON.parse(JSON.stringify(db.graphics))).find((g: any) => g.id === 'caster-desk')!;
  check('instances survive save/restore (config, draft, presets)', JSON.stringify([back.config, back.draft, back.presets]) === JSON.stringify([cd().config, cd().draft, cd().presets]));
  check('gfx-set with no patch is refused (no silent success)', !(await run({ c: 'gfx-set', id: 'caster-desk' } as any)).ok && !(await run({ c: 'gfx-set', id: 'caster-desk', patch: {} })).ok);
  // automation priority covers graphics on air (IN/OUT, publish)
  await run({ c: 'gfx-anim', id: 'scoreboard', action: 'in' });
  check('automation cannot take a graphic OUT right after a manual graphics action', !(await run({ c: 'gfx-anim', id: 'scoreboard', action: 'out' }, 'auto', 'auto')).ok && db.graphics.find((g: any) => g.id === 'scoreboard').anim.action === 'in');
  await run({ c: 'gfx-set', id: 'scoreboard', patch: { map: false } }, 'auto', 'auto');
  check('automation can still prepare a graphic (gfx-set)', db.graphics.find((g: any) => g.id === 'scoreboard').draft?.map === false);
  check('automation cannot publish a graphic right after a manual action', !(await run({ c: 'gfx-publish', id: 'scoreboard' }, 'auto', 'auto')).ok);
  await run({ c: 'automation', hold: true });
  check('held automation cannot play graphics IN', !(await run({ c: 'gfx-anim', id: 'gameplay', action: 'in' }, 'auto', 'auto')).ok);
  await run({ c: 'automation', hold: false });
  check('manual graphics actions are never blocked', (await run({ c: 'gfx-publish', id: 'scoreboard' })).ok);
  // ---------------- graphics rundown
  const sb = () => db.graphics.find((g: any) => g.id === 'scoreboard');
  const rd = () => db.rundown;
  check('bracket package has a default instance /g/bracket', db.graphics.some((g: any) => g.id === 'bracket' && g.pkg === 'od.bracket'));
  check('rd-add refuses an unknown graphic', !(await run({ c: 'rd-add', gfx: 'nope' })).ok);
  check('rd-add refuses an unknown preset', !(await run({ c: 'rd-add', gfx: 'caster-desk', preset: 'Nope' })).ok);
  await run({ c: 'gfx-anim', id: 'caster-desk', action: 'out' });
  await run({ c: 'gfx-preset', id: 'caster-desk', op: 'save', name: 'Trio' }); // saves the current published config
  const a1 = await run({ c: 'rd-add', gfx: 'caster-desk', preset: 'Big match' });
  const a2 = await run({ c: 'rd-add', gfx: 'scoreboard' });
  await run({ c: 'gfx-set', id: 'analyst-desk', patch: { panel: 'h2h' } });
  const a3 = await run({ c: 'rd-add', gfx: 'analyst-desk', snapshot: true, label: 'H2H before the final' });
  check('rd-add: items, labels, first item cued', a1.ok && a2.ok && a3.ok && rd().items.length === 3 && rd().items[0].label === 'Caster Desk · Big match' && rd().items[2].label === 'H2H before the final' && rd().cue === rd().items[0].id);
  check('snapshot item stores the prepared data', rd().items[2].data?.panel === 'h2h' && rd().items[1].data === null);
  await run({ c: 'gfx-revert', id: 'analyst-desk' });
  const [i1, i2, i3] = rd().items.map((x: any) => x.id);
  await run({ c: 'rd-move', id: i3, to: 0 });
  check('rd-move reorders', rd().items.map((x: any) => x.id).join() === [i3, i1, i2].join());
  const obsN = log.filter(l => l.startsWith('obs ')).length;
  const seqCd = cd().anim.seq;
  const tk = await run({ c: 'rd-next' });
  check('rd-next takes the cued item IN with its preset data, cues the next', tk.ok && cd().anim.action === 'in' && cd().anim.seq === seqCd + 1 && cd().config.layout === 'duo' && cd().config.matchup === true && rd().cue === i2, (tk as any).error);
  check('taking rundown items never switches OBS', log.filter(l => l.startsWith('obs ')).length === obsN);
  const ad = () => db.graphics.find((g: any) => g.id === 'analyst-desk');
  await run({ c: 'gfx-anim', id: 'analyst-desk', action: 'in' });
  const adSeq = ad().anim.seq;
  await run({ c: 'rd-take', id: i3, action: 'update' });
  check('UPDATE with snapshot data publishes it and plays UPDATE', ad().config.panel === 'h2h' && ad().draft === null && ad().anim.action === 'update' && ad().anim.seq === adSeq + 1);
  await run({ c: 'gfx-set', id: 'scoreboard', patch: { map: false } });
  await run({ c: 'rd-take', id: i2, action: 'update' });
  check('UPDATE without item data publishes what is prepared on the graphic', sb().config.map === false && sb().draft === null);
  await run({ c: 'rd-take', id: i1, action: 'out' });
  check('rd-take OUT', cd().anim.action === 'out');
  check('automation cannot take rundown items right after a manual action', !(await run({ c: 'rd-take', id: i1, action: 'in' }, 'auto', 'auto')).ok);
  await run({ c: 'gfx-preset', id: 'caster-desk', op: 'delete', name: 'Big match' });
  check('taking an item whose preset was deleted is refused (no silent success)', !(await run({ c: 'rd-take', id: i1, action: 'in' })).ok);
  check('rd-edit refuses an empty name', !(await run({ c: 'rd-edit', id: i1, label: '  ' })).ok);
  await run({ c: 'rd-edit', id: i1, label: 'Desk trio', preset: 'Trio' });
  check('rd-edit renames and re-points the preset', rd().items.find((x: any) => x.id === i1).label === 'Desk trio' && rd().items.find((x: any) => x.id === i1).preset === 'Trio');
  await run({ c: 'rd-cue', id: i1 });
  await run({ c: 'rd-remove', id: i1 });
  check('removing the cued item cues its neighbour', rd().items.length === 2 && rd().cue !== i1 && rd().cue !== null);
  const cb = await run({ c: 'gfx-create', pkg: 'od.scoreboard', name: 'Score B' });
  await run({ c: 'rd-add', gfx: 'score-b' });
  await run({ c: 'gfx-delete', id: 'score-b' });
  check('deleting a graphic removes its rundown items', cb.ok && !rd().items.some((x: any) => x.gfx === 'score-b'));
  check('gfx-obs maps an OBS scene to a graphic', (await run({ c: 'gfx-obs', id: 'scoreboard', scene: 'Overdrive · Gameplay' })).ok && sb().obsScene === 'Overdrive · Gameplay');
  const { sanitizeRundown } = await import('../shared/rundown');
  check('rundown survives save/restore', JSON.stringify(sanitizeRundown(JSON.parse(JSON.stringify(rd())))) === JSON.stringify(rd()));
  await run({ c: 'rd-clear' });
  check('rd-clear empties the rundown', rd().items.length === 0 && rd().cue === null);
  check('rd-next with nothing cued is refused', !(await run({ c: 'rd-next' })).ok);
  check('bad command refused', !(await run({ c: 'nope' } as any)).ok);
  // OBS Scene Builder command: routed to the builder, never touches Program, refuses a stale/absent preview
  const g9 = log.filter(l => l.startsWith('goLive') || l.startsWith('air') || l.startsWith('obs ')).length;
  check('obs-setup scan acks', (await run({ c: 'obs-setup', action: 'scan' })).ok);
  check('obs-setup apply without a preview is refused', !(await run({ c: 'obs-setup', action: 'apply', hash: '' })).ok);
  check('obs-setup never switches OBS or airs anything', log.filter(l => l.startsWith('goLive') || l.startsWith('air') || l.startsWith('obs ')).length === g9);
  console.log(`\n${ok} passed, ${bad} failed`);
  if (bad) process.exit(1);
})();

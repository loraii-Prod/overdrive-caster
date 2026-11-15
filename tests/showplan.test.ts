// Studio Mode 2.0 show plan + automation tests (no server needed): npx tsx tests/showplan.test.ts
import { createEngine } from '../server/engine';
import { defaultScene, defaultShow } from '../shared/defaults';
import { defaultWildcard } from '../shared/wildcard';
import { defaultMedia } from '../shared/media';
import { pkgById, sanitizeGraphics } from '../shared/gfx';
import { REGISTRY } from '../shared/registry';
import { parseVdoId } from '../shared/talent';
import { isControllerRoute } from '../shared/obsDocks';
import { emptyPlan, parseDur, fmtDur, readiness, sanitizePlan, segmentIssues, segmentObsScene, type ObsLookup, type ReadyCtx, type Segment } from '../shared/showplan';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const SCENES = ['OD Starting', 'OD Casters', 'OD Team Intro', 'OD Veto', 'OD Gameplay', 'OD Analysis', 'OD BRB', 'OD Bracket', 'OD Ending'];

function mk(opts: { obsOk?: boolean } = {}) {
  const db: any = { preview: defaultScene(), live: defaultScene(), showPreview: defaultShow(), showLive: defaultShow(), wildcard: defaultWildcard(true), instant: false, media: defaultMedia(), graphics: sanitizeGraphics([]), rundown: { items: [], cue: null }, plan: emptyPlan() };
  db.showLive.obsScenes = { ...db.showLive.obsScenes, casters: 'OD Casters', warmup: 'OD Team Intro', veto: 'OD Veto', gameplay: 'OD Gameplay', analysis: 'OD Analysis', brb: 'OD BRB', bracket: 'OD Bracket', ending: 'OD Ending' };
  const log: string[] = [];
  const talentPatches: any[] = [];
  const state = { obsOk: opts.obsOk ?? true };
  const lookup = (): ObsLookup => ({ setupMap: { 's:starting': { scene: 'OD Starting' } }, screenMap: db.showLive.obsScenes, graphics: db.graphics, registry: REGISTRY, scenes: SCENES, pkgObsKey: p => pkgById(p)?.obsKey });
  const eng = createEngine({ db, save() {}, goLive() {}, airProgram() {}, broadcastLive() {}, pushWc() {}, wcOp() {}, quick(op: any) { log.push('quick ' + op.k); }, quickBadge() {}, clearPopups() {}, reloadOutputs() { return 0; }, pushState() {}, pushMedia() { log.push('pushMedia'); }, pushGfx() {},
    setSeat() { return null; }, editTalent(id, p) { talentPatches.push({ id, ...p }); return null; }, regenTalent() { return null; }, resyncSeat() { return null; },
    async obsSetup() { return {}; },
    async obsSwitch(scene, t) { log.push(`obs ${scene} ${t ?? 'obs-default'}`); return state.obsOk ? null : 'OBS is not connected'; },
    obsLookup: lookup,
    syncCrew(p) { log.push(`crew ${p.segments.length} cur=${p.onAir?.id ?? '-'}`); } });
  const run = (cmd: any, src: any = 'manual') => eng.run(cmd, 'A', src);
  const obsLog = () => log.filter(l => l.startsWith('obs '));
  return { db, eng, run, log, obsLog, talentPatches, state, lookup };
}

(async () => {
  // ------------------------------------------------------------------ pure helpers
  check('Studio Mode page counts as a control page (OBS leak check)', isControllerRoute('/studio') && isControllerRoute('/studio?x=1') && !isControllerRoute('/studios-output'));
  check('VDO link: push=', parseVdoId('https://vdo.ninja/?push=abc123XYZ&webcam&quality=1') === 'abc123XYZ');
  check('VDO link: view=', parseVdoId('https://vdo.ninja/?view=caster_01&password=x') === 'caster_01');
  check('VDO link: bare id', parseVdoId('  myStream99 ') === 'myStream99');
  check('VDO link: junk refused', parseVdoId('https://example.com/?foo=bar') === null && parseVdoId('ab') === null);
  check('duration parse m:ss / minutes', parseDur('5:30') === 330 && parseDur('3') === 180 && parseDur('') === 0 && fmtDur(330) === '5:30' && fmtDur(0) === '—');

  const raw = sanitizePlan({ segments: [{ id: 'a1', label: 'X', target: 's:starting', dur: '90', transition: 'bogus', media: '/etc/passwd' }, { id: 'a1', label: 'dup' }, { id: 'bad id!', label: 'Y' }],
    rules: [{ id: 'r1', name: 'R', when: { k: 'clock', at: 5 }, during: 'missing', then: [{ k: 'go' }, { k: 'nope' }, { k: 'obs', scene: '' }] }],
    next: 'a1', onAir: { id: 'zz', at: 1 }, pending: { id: 'p', rest: [] }, crewSync: true });
  check('sanitize: dup / bad ids dropped', raw.segments.length === 1 && raw.segments[0].dur === 90);
  check('sanitize: bad transition → OBS default, bad media dropped', raw.segments[0].transition === 'obs' && raw.segments[0].media === null);
  check('sanitize: rule steps filtered, dangling "during" cleared', raw.rules[0].then.length === 1 && raw.rules[0].during === null);
  check('sanitize: a pending GO never survives a restart', raw.pending === null);
  check('sanitize: on-air pointing to a missing segment dropped', raw.onAir === null && raw.next === 'a1' && raw.crewSync);

  {
    const { lookup, db } = mk();
    const L = lookup();
    const seg = (target: string | null, obsScene: string | null = null): Segment => ({ id: 'x', label: 'x', target, obsScene, dur: 0, transition: 'obs', media: null, autoNext: false, confirm: true, notes: '' });
    check('OBS scene: explicit wins', segmentObsScene(seg('s:starting', 'Custom'), L) === 'Custom');
    check('OBS scene: Scene Builder mapping', segmentObsScene(seg('s:starting'), L) === 'OD Starting');
    check('OBS scene: screen mapping', segmentObsScene(seg('s:caster-desk'), L) === 'OD Casters');
    check('OBS scene: graphic → its package scene source', segmentObsScene(seg('g:caster-desk'), L) === 'OD Casters');
    check('OBS scene: none for no target', segmentObsScene(seg(null), L) === null);
    const blank = { ...L, setupMap: {}, screenMap: { casters: '', bracket: '' } };
    check('OBS scene: empty mappings fall through to the scene name (default show)', segmentObsScene(seg('s:caster-desk'), { ...blank, scenes: ['Overdrive · Caster Desk'] }) === 'Overdrive · Caster Desk');
    check('OBS scene: graphic with empty mappings → by name', segmentObsScene(seg('g:bracket'), { ...blank, scenes: ['Overdrive · Tournament Bracket'] }) === 'Overdrive · Tournament Bracket');
    const ctx = (over: Partial<ReadyCtx> = {}): ReadyCtx => ({ obs: L, obsConnected: true, conns: () => 1, seat: () => ({ name: 'Loraii', live: true }), playlist: [], ...over });
    check('ready: mapped scene with talent', readiness(segmentIssues(seg('s:caster-desk'), ctx())) === 'ready');
    check('ready: no talent seated → error', readiness(segmentIssues(seg('s:caster-desk'), ctx({ seat: () => null }))) === 'error');
    check('ready: camera offline → warning', segmentIssues(seg('s:caster-desk'), ctx({ seat: () => ({ name: 'GGeek', live: false }) })).some(i => i.text.includes('GGeek')));
    check('ready: OBS has no such scene → error', segmentIssues(seg('s:caster-desk', 'Ghost'), ctx()).some(i => i.level === 'error' && i.text.includes('Ghost')));
    check('ready: browser source not open → warning', segmentIssues(seg('s:bracket'), ctx({ conns: () => 0 })).some(i => i.text.includes('Browser source')));
    check('ready: missing scene → error', readiness(segmentIssues(seg('g:deleted'), ctx())) === 'error');
    void db;
  }

  // ------------------------------------------------------------------ engine: build the show
  {
    const { db, run, obsLog } = mk();
    const a = await run({ c: 'sp-starter' });
    check('starter: segments + reference automation', a.ok && db.plan.segments.length === 14 && db.plan.rules.length === 3, (a as any).note);
    check('starter: first segment prepared', db.plan.next === db.plan.segments[0].id);
    check('starter refused into a non-empty plan', !(await run({ c: 'sp-starter' })).ok);
    const [ss, opening, intro] = db.plan.segments;
    check('building the show never switches OBS', obsLog().length === 0);

    // reorder + edit + add
    await run({ c: 'sp-seg-move', id: intro.id, to: 0 });
    check('reorder: moved to the top', db.plan.segments[0].id === intro.id);
    await run({ c: 'sp-seg-move', id: intro.id, to: 2 });
    check('reorder: back in place', db.plan.segments[2].id === intro.id);
    check('edit: empty name refused', !(await run({ c: 'sp-seg-edit', id: opening.id, patch: { label: '  ' } })).ok);
    await run({ c: 'sp-seg-edit', id: opening.id, patch: { dur: 120, transition: 'stinger', notes: 'Hype' } });
    check('edit: duration / transition / notes', db.plan.segments[1].dur === 120 && db.plan.segments[1].transition === 'stinger' && db.plan.segments[1].notes === 'Hype');
    const add = await run({ c: 'sp-seg-add', seg: { label: 'MVP vote', target: 'g:mvp', dur: 45 }, at: 3 });
    check('add at a position', add.ok && db.plan.segments[3].label === 'MVP vote');

    // dry-run test of the rule: nothing changes
    const before = JSON.stringify(db.plan);
    const dry = await run({ c: 'sp-rule-run', id: db.plan.rules[0].id, dry: true });
    check('rule TEST describes the steps and changes nothing', dry.ok && /TEST/.test((dry as any).note ?? '') && /Wait for producer GO/.test((dry as any).note ?? '') && JSON.stringify(db.plan) === before && obsLog().length === 0, (dry as any).note);

    // ---------------- Starting Soon on air (manual GO), then the reference automation
    const g1 = await run({ c: 'sp-go' });
    check('manual GO: Starting Soon on air', g1.ok && db.plan.onAir?.id === ss.id, (g1 as any).note ?? (g1 as any).error);
    check('manual GO: OBS → mapped scene with the segment transition', obsLog().at(-1) === 'obs OD Starting fade');
    check('manual GO: next segment prepared automatically', db.plan.next === opening.id);

    check('remove the on-air segment refused', !(await run({ c: 'sp-seg-remove', id: ss.id })).ok);
  }

  // ------------------------------------------------------------------ the reference workflow, under automation
  {
    const { db, eng, run, obsLog } = mk();
    await run({ c: 'sp-starter' });
    const [ss, opening, intro] = db.plan.segments;
    await run({ c: 'sp-onair', id: ss.id }); // Starting Soon is on air (OBS switched by hand): no manual grace
    check('mark on air: no OBS switch, next prepared', obsLog().length === 0 && db.plan.onAir?.id === ss.id && db.plan.next === opening.id);
    db.plan.next = null; // the rule prepares it itself
    db.showLive.timer.target = Date.now() - 10; // countdown reaches zero
    await eng.tick();
    check('countdown end → Opening prepared', db.plan.next === opening.id);
    check('countdown end → producer notified', db.plan.notes.some((n: any) => n.text === 'Opening is ready: press GO'));
    check('countdown end → waiting for GO (no OBS switch yet)', !!db.plan.pending && obsLog().length === 0 && db.plan.onAir?.id === ss.id);
    await eng.tick();
    check('the same countdown fires once', db.plan.notes.filter((n: any) => n.text === 'Opening is ready: press GO').length === 1);

    const c = await run({ c: 'sp-cancel' });
    check('cancel: pending cleared, nothing aired', c.ok && !db.plan.pending && obsLog().length === 0 && db.plan.onAir?.id === ss.id);
    check('cancel with nothing pending refused', !(await run({ c: 'sp-cancel' })).ok);

    db.showLive.timer.target = Date.now() - 5; // a new countdown ends
    await eng.tick();
    check('a new countdown re-arms the rule', !!db.plan.pending);
    const go = await run({ c: 'sp-go' });
    check('producer GO → Opening on air with its transition', go.ok && db.plan.onAir?.id === opening.id && obsLog().at(-1) === 'obs OD Casters stinger', (go as any).note ?? (go as any).error);
    check('after GO → next item prepared (Team Intro)', db.plan.next === intro.id && !db.plan.pending);
  }

  // ------------------------------------------------------------------ safety: hold, OBS failure, auto-advance
  {
    const { db, eng, run, obsLog, state } = mk();
    await run({ c: 'sp-starter' });
    const [ss, opening] = db.plan.segments;
    await run({ c: 'sp-onair', id: ss.id });
    db.plan.rules[0].then = [{ k: 'prepare', seg: 'next' }, { k: 'go' }]; // no confirm step
    await run({ c: 'automation', hold: true });
    db.showLive.timer.target = Date.now() - 10;
    await eng.tick();
    check('held automation: GO becomes a pending GO, OBS untouched', !!db.plan.pending && obsLog().length === 0 && db.plan.onAir?.id === ss.id);
    await run({ c: 'automation', hold: false });

    state.obsOk = false;
    const f = await run({ c: 'sp-go' });
    check('GO with OBS refusing: error, nothing marked on air', !f.ok && db.plan.onAir?.id === ss.id, (f as any).error);
    check('…and the pending GO is kept for a retry', !!db.plan.pending);
    state.obsOk = true;
    const r = await run({ c: 'sp-go' });
    check('retry GO succeeds', r.ok && db.plan.onAir?.id === opening.id && !db.plan.pending, JSON.stringify(r));
  }
  {
    const { db, eng, run, obsLog } = mk();
    await run({ c: 'sp-starter' });
    const segs = db.plan.segments;
    await run({ c: 'sp-seg-edit', id: segs[1].id, patch: { dur: 1, autoNext: true } });
    await run({ c: 'sp-seg-edit', id: segs[2].id, patch: { confirm: false } });
    await run({ c: 'sp-onair', id: segs[1].id });
    db.plan.onAir.at = Date.now() - 1500;
    await eng.tick();
    check('time up + auto-advance + next needs no GO → auto GO', db.plan.onAir?.id === segs[2].id && obsLog().at(-1) === 'obs OD Team Intro stinger', obsLog().join(','));
    await run({ c: 'sp-seg-edit', id: segs[2].id, patch: { dur: 1, autoNext: true } });
    db.plan.onAir.at = Date.now() - 1500;
    const n = obsLog().length;
    await eng.tick();
    check('time up + next needs GO → pending, no switch', !!db.plan.pending && obsLog().length === n && db.plan.pending.seg === segs[3].id);
  }
  {
    const { db, eng, run } = mk();
    await run({ c: 'sp-starter' });
    const st = await run({ c: 'sp-rule-set', rule: { name: 'Pre-show reminder', when: { k: 'clock', at: Date.now() - 100 }, then: [{ k: 'notify', text: 'Five minutes to air' }] } });
    check('rule add', st.ok && db.plan.rules.length === 4);
    await eng.tick(); await eng.tick();
    check('clock rule fires once', db.plan.notes.filter((x: any) => x.text === 'Five minutes to air').length === 1);
    await run({ c: 'sp-rule-set', rule: { name: 'Stale', when: { k: 'clock', at: Date.now() - 5 * 60_000 }, then: [{ k: 'notify', text: 'stale!' }] } });
    await eng.tick();
    check('a clock time long past is not run (server was off)', !db.plan.notes.some((x: any) => x.text === 'stale!'));
    const mr = await run({ c: 'sp-rule-set', rule: { name: 'Ad done', when: { k: 'media-end' }, then: [{ k: 'notify', text: 'Ad finished' }] } });
    check('media rule added', mr.ok);
    db.media.playlist = ['/media/a.mp4']; await run({ c: 'media', action: 'play' });
    eng.mediaEnded(db.media.seq);
    await sleep(5);
    check('media end fires its automation', db.plan.notes.some((x: any) => x.text === 'Ad finished'));
    const id = db.plan.rules.at(-1).id;
    await run({ c: 'sp-rule-set', rule: { id, on: false } });
    check('rule disable keeps the steps', db.plan.rules.at(-1).on === false && db.plan.rules.at(-1).then.length === 1);
    check('rule remove', (await run({ c: 'sp-rule-remove', id })).ok && !db.plan.rules.some((r: any) => r.id === id));
  }
  {
    const { db, run, log, talentPatches } = mk();
    await run({ c: 'sp-starter' });
    await run({ c: 'sp-opts', crewSync: true });
    check('crew sync mirrors the segments to the run of show', log.some(l => l === `crew ${db.plan.segments.length} cur=-`));
    await run({ c: 'talent-edit', id: 't2', vdoId: 'https://vdo.ninja/?push=ggeek_cam' });
    check('talent: pasted VDO link reaches the talent handler', talentPatches.at(-1)?.vdoId === 'https://vdo.ninja/?push=ggeek_cam');
    const media = await run({ c: 'sp-seg-edit', id: db.plan.segments[0].id, patch: { media: '/media/sponsor.mp4' } });
    await run({ c: 'sp-go' });
    check('segment media is added to the playlist and started', media.ok && db.media.playlist.includes('/media/sponsor.mp4') && db.media.status === 'playing');
    const exported = JSON.parse(JSON.stringify({ segments: db.plan.segments, rules: db.plan.rules }));
    check('import refused while a segment is on air', !(await run({ c: 'sp-import', plan: exported })).ok);
    await run({ c: 'sp-onair', id: null });
    const imp = await run({ c: 'sp-import', plan: exported });
    check('show file import keeps segment ids and rule links', imp.ok && db.plan.segments.length === exported.segments.length && db.plan.rules[0].during === exported.rules[0].during && db.plan.next === exported.segments[0].id);
    const round = sanitizePlan(JSON.parse(JSON.stringify(db.plan)));
    const A = JSON.stringify({ ...round, pending: null }), B = JSON.stringify({ ...db.plan, pending: null });
    check('persisted plan round-trips (minus pending)', A === B, A === B ? '' : `${A.slice(0, 2000)}\n${B.slice(0, 2000)}`);
  }

  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();

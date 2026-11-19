// MVP sequence + automation safety (no server needed): npx tsx tests/mvp.test.ts
import { createEngine } from '../server/engine';
import { defaultScene, defaultShow } from '../shared/defaults';
import { defaultWildcard } from '../shared/wildcard';
import { defaultMedia } from '../shared/media';
import { sanitizeGraphics } from '../shared/gfx';
import { emptyPlan, sanitizeAction, sanitizeTrigger, actionLabel } from '../shared/showplan';
import { mvpStage, nextAction, revealAllowed, revealedOf, viewAllowed, type MvpFlowIn } from '../shared/mvpFlow';
import { REGISTRY } from '../shared/registry';
import { discoverTargets } from '../shared/obsSetup';
import { MVP_RULES, MVP_SEQUENCE, routeOfTarget, sanitizeSegment, segmentObsScene } from '../shared/showplan';
import { pkgById } from '../shared/gfx';
import { defaultShow as dShow } from '../shared/defaults';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

// ------------------------------------------------------------------ the sequence
const F = (o: Partial<MvpFlowIn>): MvpFlowIn => ({ status: null, frozen: false, desk: false, published: '', ...o });
const order = [F({}), F({ status: 'draft' }), F({ status: 'open' }), F({ status: 'closed' }), F({ status: 'closed', frozen: true, desk: true }), F({ status: 'revealed', frozen: true, desk: true, published: 'winner' }), F({ status: 'revealed', frozen: true, desk: true, published: 'desk' }), F({ status: 'revealed', frozen: true, desk: true, published: 'compare' })];
check('stages in order: none → prepared → open → closed → ready → community → analyst → compare', order.map(mvpStage).join(',') === 'none,prepared,open,closed,ready,community,analyst,compare', order.map(mvpStage).join(','));
check('next actions follow the producer workflow', order.map(o => { const n = nextAction(o); return n.kind === 'reveal' ? `reveal:${n.step}` : n.kind; }).join(',') === 'prepare,open,close,wait,reveal:winner,reveal:desk,reveal:compare,next');
check('reveals are marked critical (confirmation)', order.map(nextAction).filter(n => n.kind === 'reveal').every(n => n.critical));
check('no analyst pick: Community MVP → next scene (analyst step skipped)', nextAction(F({ status: 'revealed', frozen: true, published: 'winner' })).kind === 'next');
check('reveal refused while voting is open', revealAllowed('winner', F({ status: 'open' })) !== null);
check('reveal refused when closed but not frozen', revealAllowed('winner', F({ status: 'closed' })) !== null);
check('reveal allowed from a frozen result', revealAllowed('winner', F({ status: 'closed', frozen: true })) === null);
check('analyst reveal needs an analyst pick', revealAllowed('desk', F({ status: 'closed', frozen: true })) !== null && revealAllowed('desk', F({ desk: true })) === null);
check('comparison needs both', revealAllowed('compare', F({ status: 'closed', frozen: true })) !== null && revealAllowed('compare', F({ status: 'closed', frozen: true, desk: true })) === null);
check('automation step / trigger sanitised', JSON.stringify(sanitizeAction({ k: 'mvp', action: 'reveal', step: 'nope' })) === '{"k":"mvp","action":"reveal","step":"winner"}' && sanitizeTrigger({ k: 'mvp-closed' }).k === 'mvp-closed' && sanitizeAction({ k: 'mvp', action: 'explode' }) === null);
check('step labels say a frozen result is needed', /frozen/.test(actionLabel({ k: 'mvp', action: 'reveal', step: 'winner' })));

// ------------------------------------------------------------------ the MVP scene (one scene, one source)
{
  const mvpScene = REGISTRY.find(x => x.id === 'mvp');
  const views = REGISTRY.filter(s => s.category === 'MVP & Awards');
  check('MVP & Awards: five scenes, each a view of the ONE MVP graphic with its own source', views.length === 5 && views.every(s => s.gfx === 'mvp' && s.route === `/g/mvp?view=${s.gfxView}` && s.modules.includes('mvp')) && views.map(s => s.gfxView).join() === 'voting,closed,winner,desk,compare');
  check('the old MVP scene id now opens on Voting Open (saved rundowns keep working)', !!mvpScene && mvpScene.gfxView === 'voting');
  const t = discoverTargets(sanitizeGraphics([]), dShow().obsScenes, { audio: true, gameCapture: true });
  const g = t.find(x => x.id === 'g:mvp'), sc = t.find(x => x.id === 's:mvp');
  check('OBS Scene Builder: the MVP scene is "Overdrive · MVP"', g?.scene === 'Overdrive · MVP', g?.scene);
  check('OBS: each MVP scene is built with its own browser source', views.every(s => { const x = t.find(y => y.id === `s:${s.id}`); return !!x && !x.supersededBy && x.route === `/g/mvp?view=${s.gfxView}` && x.scene === `Overdrive · ${s.name}`; }) && !sc?.supersededBy);
  check('…and /g/mvp itself is still built once (the sequence-driven source keeps its URL)', t.filter(x => x.route === '/g/mvp').length === 1);
  const L = { setupMap: {}, screenMap: {}, graphics: sanitizeGraphics([]), registry: REGISTRY, scenes: ['Overdrive · MVP'], pkgObsKey: (p: string) => pkgById(p)?.obsKey };
  const L2 = { ...L, scenes: ['Overdrive · MVP', ...views.map(s => `Overdrive · ${s.name}`)] };
  check('show rundown: each MVP segment switches OBS to its own scene', views.every(s => segmentObsScene({ obsScene: null, target: `s:${s.id}` }, L2) === `Overdrive · ${s.name}`));
  check('…the MVP graphic keeps its own scene (exact name, never a view’s)', segmentObsScene({ obsScene: null, target: 'g:mvp' }, L2) === 'Overdrive · MVP' && segmentObsScene({ obsScene: null, target: 'g:mvp' }, { ...L2, scenes: L2.scenes.slice(1) }) === null);
  check('show rundown: readiness counts each view’s own source', routeOfTarget('s:mvp-winner', REGISTRY) === 'g/mvp?view=winner' && routeOfTarget('g:mvp', REGISTRY) === 'g/mvp');
}

// ------------------------------------------------------------------ automation through the engine
function rig(flow: MvpFlowIn) {
  const db: any = { preview: defaultScene(), live: defaultScene(), showPreview: defaultShow(), showLive: defaultShow(), wildcard: defaultWildcard(true), instant: false, media: defaultMedia(), graphics: sanitizeGraphics([]), rundown: { items: [], cue: null }, plan: emptyPlan() };
  const log: string[] = [];
  const st = { ...flow };
  const eng = createEngine({ db, save() {}, goLive() {}, airProgram() {}, broadcastLive() {}, pushWc() {}, wcOp() {}, quick() {}, quickBadge() {}, clearPopups() {}, reloadOutputs() { return 0; }, pushState() {}, pushMedia() {}, pushGfx() { log.push('pushGfx'); },
    onGfxPublish(g) { log.push(`reveal ${g.config.step}`); st.published = String(g.config.step); if (st.status === 'closed') st.status = 'revealed'; },
    setSeat() { return null; }, editTalent() { return null; }, regenTalent() { return null; }, resyncSeat() { return null; },
    async obsSetup() { return {}; }, async obsSwitch() { return null; },
    mvp: { state: () => ({ ...st, match: 'R1_UB1' }), async op(a) { log.push(`mvp ${a}`); if (a === 'close') { st.status = 'closed'; st.frozen = true; } if (a === 'open') st.status = 'open'; return null; } } });
  const g = () => db.graphics.find((x: any) => x.id === 'mvp');
  const run = (cmd: any, src: any = 'manual') => eng.run(cmd, 'A', src);
  return { db, eng, log, st, g, run };
}
const RULE = { name: 'MVP results', when: { k: 'mvp-closed' }, then: [{ k: 'notify', text: 'MVP results ready' }, { k: 'mvp', action: 'reveal', step: 'winner' }, { k: 'mvp', action: 'reveal', step: 'desk' }, { k: 'mvp', action: 'reveal', step: 'compare' }] };
(async () => {
  {
    const { db, eng, log, g, run } = rig(F({ status: 'closed', frozen: true, desk: true }));
    await run({ c: 'sp-rule-set', rule: RULE });
    const before = JSON.stringify(g().config);
    await eng.fire('mvp-closed');
    check('voting closes → results announced, reveal WAITS for producer GO (default)', !!db.plan.pending && /Community MVP/.test(db.plan.pending.text) && JSON.stringify(g().config) === before && !log.some(l => l.startsWith('reveal')), db.plan.pending?.text);
    const go1 = await run({ c: 'sp-go' });
    check('GO → Community MVP on air (step winner, graphic IN/updated)', go1.ok && g().config.step === 'winner' && g().config.match === 'R1_UB1' && log.includes('reveal winner'));
    check('…and the Analyst MVP waits for its OWN GO', !!db.plan.pending && /Analyst MVP/.test(db.plan.pending.text) && !log.includes('reveal desk'));
    await run({ c: 'sp-go' });
    check('GO → Analyst MVP; comparison waits', g().config.step === 'desk' && /Community vs Analysts/.test(db.plan.pending?.text ?? ''));
    const c = await run({ c: 'sp-cancel' });
    check('cancel stops the sequence: comparison never shown', c.ok && !db.plan.pending && g().config.step === 'desk' && !log.includes('reveal compare'));
  }
  {
    const { db, log, g, run } = rig(F({ status: 'open' }));
    await run({ c: 'sp-rule-set', rule: { ...RULE, when: { k: 'countdown-end' } } });
    const id = db.plan.rules[0].id;
    await run({ c: 'sp-rule-run', id, dry: false });
    check('a rule run while voting is OPEN never reveals (refused, no GO prompt)', !db.plan.pending && g().config.step === 'voting' && !log.some(l => l.startsWith('reveal')) && db.plan.notes.some((n: any) => /refused \(voting is not closed\)/.test(n.text)));
    // producer GO cannot force it either
    db.plan.pending = { id: 'x', rule: id, name: 'forced', text: 'x', at: Date.now(), rest: [{ k: 'mvp', action: 'reveal', step: 'winner' }], seg: null };
    await run({ c: 'sp-go' });
    check('…not even with a producer GO on a forged pending step', g().config.step === 'voting' && !log.some(l => l.startsWith('reveal')));
  }
  {
    const { db, eng, log, g, run } = rig(F({ status: 'closed', frozen: true, desk: true }));
    g().config.confirmReveal = false;
    await run({ c: 'sp-rule-set', rule: { name: 'auto', when: { k: 'mvp-closed' }, then: [{ k: 'mvp', action: 'reveal', step: 'winner' }] } });
    await eng.fire('mvp-closed');
    check('confirmation turned off: automation reveals a FROZEN result by itself', g().config.step === 'winner' && log.includes('reveal winner') && !db.plan.pending);
  }
  {
    const { db, eng, log, g, run } = rig(F({ status: 'closed', frozen: true }));
    g().config.confirmReveal = false;
    await run({ c: 'automation', hold: true });
    await run({ c: 'sp-rule-set', rule: { name: 'auto', when: { k: 'mvp-closed' }, then: [{ k: 'mvp', action: 'reveal', step: 'winner' }] } });
    await eng.fire('mvp-closed');
    check('automation held: even without confirmation it stops for GO', !!db.plan.pending && !log.some(l => l.startsWith('reveal')));
  }
  {
    const { db, log, run, st } = rig(F({ status: 'draft' }));
    await run({ c: 'sp-rule-set', rule: { name: 'open/close', when: { k: 'countdown-end' }, then: [{ k: 'mvp', action: 'open' }, { k: 'mvp', action: 'close' }] } });
    await run({ c: 'sp-rule-run', id: db.plan.rules[0].id, dry: false });
    check('open / close voting steps reach the vote service', log.includes('mvp open') && log.includes('mvp close') && st.status === 'closed');
    const dry = await run({ c: 'sp-rule-run', id: db.plan.rules[0].id, dry: true });
    check('dry test describes MVP steps', dry.ok && /Open MVP voting/.test((dry as any).note));
  }
  {
    const { db, eng, run } = rig(F({ status: 'closed', frozen: true }));
    await run({ c: 'sp-rule-set', rule: { name: 'n', when: { k: 'mvp-closed' }, then: [{ k: 'notify', text: 'once' }] } });
    await run({ c: 'sp-rule-set', rule: { name: 'other', when: { k: 'countdown-end' }, then: [{ k: 'notify', text: 'never' }] } });
    await eng.fire('mvp-closed');
    check('the trigger runs only its own rules (once per fire)', db.plan.notes.filter((n: any) => n.text === 'once').length === 1 && !db.plan.notes.some((n: any) => n.text === 'never'));
  }
  // ------------------------------------------------------------------ Upper / Lower bracket: separate scenes
  {
    const up = REGISTRY.find(s => s.id === 'bracket-upper'), lo = REGISTRY.find(s => s.id === 'standings');
    check('Upper Bracket and Lower Bracket are separate scenes with their own sources', up?.gfxView === 'upper' && up.route === '/g/bracket?view=upper' && lo?.gfxView === 'lower' && lo.name === 'Lower Bracket' && lo.route === '/g/bracket?view=lower');
    const t = discoverTargets(sanitizeGraphics([]), dShow().obsScenes, { audio: true, gameCapture: true });
    const tu = t.find(x => x.id === 's:bracket-upper'), tl = t.find(x => x.id === 's:standings');
    check('OBS: two scenes, two browser sources (never replaced by the bracket graphic)', tu?.scene === 'Overdrive · Upper Bracket' && tl?.scene === 'Overdrive · Lower Bracket' && !tu?.supersededBy && !tl?.supersededBy && tu?.route !== tl?.route);
    const L = { setupMap: {}, screenMap: {}, graphics: sanitizeGraphics([]), registry: REGISTRY, scenes: ['Overdrive · Upper Bracket', 'Overdrive · Lower Bracket', 'Overdrive · Tournament Bracket'], pkgObsKey: (p: string) => pkgById(p)?.obsKey };
    check('rundown: each switches OBS to its own scene and counts its own source', segmentObsScene({ obsScene: null, target: 's:bracket-upper' }, L) === 'Overdrive · Upper Bracket' && segmentObsScene({ obsScene: null, target: 's:standings' }, L) === 'Overdrive · Lower Bracket' && routeOfTarget('s:standings', REGISTRY) === 'g/bracket?view=lower');
    const { run } = rig(F({}));
    check('bracket scenes are not MVP scenes (mvp-take refuses them)', !(await run({ c: 'mvp-take', view: 'upper' })).ok);
  }
  // ------------------------------------------------------------------ MVP & Awards scenes (TAKE / GO / gating)
  const VIEWS = REGISTRY.filter(s => s.gfx === 'mvp' && s.gfxView);
  const sceneOf = (v: string) => `Overdrive · ${VIEWS.find(s => s.gfxView === v)!.name}`;
  function rig2(flow: MvpFlowIn) {
    const r = rig(flow), obs: string[] = [];
    // same engine, with OBS scenes and the lookup the hub gives it
    const db = r.db; const st = r.st; const log = r.log;
    const eng = createEngine({ db, save() {}, goLive() {}, airProgram() {}, broadcastLive() {}, pushWc() {}, wcOp() {}, quick() {}, quickBadge() {}, clearPopups() {}, reloadOutputs() { return 0; }, pushState() {}, pushMedia() {}, pushGfx() {},
      onGfxPublish(g) { log.push(`reveal ${g.config.step}`); st.published = String(g.config.step); },
      setSeat() { return null; }, editTalent() { return null; }, regenTalent() { return null; }, resyncSeat() { return null; },
      async obsSetup() { return {}; }, async obsSwitch(scene, tr) { obs.push(`${scene}${tr ? ` (${tr})` : ''}`); return null; },
      obsLookup: () => ({ setupMap: {}, screenMap: {}, graphics: db.graphics, registry: REGISTRY, scenes: ['Overdrive · MVP', ...VIEWS.map(s => `Overdrive · ${s.name}`)], pkgObsKey: (p: string) => pkgById(p)?.obsKey }),
      mvp: { state: () => ({ ...st, match: String(db.graphics.find((x: any) => x.id === 'mvp').config.match || 'R1_UB1') }), async op(a) { log.push(`mvp ${a}`); if (a === 'close') { st.status = 'closed'; st.frozen = true; } if (a === 'open') st.status = 'open'; return null; } } });
    return { ...r, eng, obs, run: (cmd: any, src: any = 'manual') => eng.run(cmd, 'A', src) };
  }
  {
    const { g, run, obs, log, st } = rig2(F({ status: 'open' }));
    const v = await run({ c: 'mvp-take', view: 'voting' });
    check('TAKE Voting Open: OBS → its own scene, MVP graphic on the voting step', v.ok && obs.at(-1) === sceneOf('voting') && g().config.step === 'voting', (v as any).error);
    const w = await run({ c: 'mvp-take', view: 'winner' });
    check('TAKE the reveal while voting is OPEN: refused, OBS untouched, nothing authorized', !w.ok && obs.length === 1 && !viewAllowed('winner', g().config, 'R1_UB1') && !log.some(l => l.startsWith('reveal')), (w as any).error);
    const c = await run({ c: 'mvp-take', view: 'closed', transition: 'fade' });
    check('TAKE Voting Closed: closes voting first, then OBS (with the chosen transition)', c.ok && log.includes('mvp close') && st.status === 'closed' && obs.at(-1) === `${sceneOf('closed')} (fade)`);
    check('closing reveals nothing', !viewAllowed('winner', g().config, 'R1_UB1') && g().config.step === 'voting');
    const r = await run({ c: 'mvp-take', view: 'winner' });
    check('TAKE Community MVP reveal (frozen): authorized for THIS match, OBS → reveal scene', r.ok && viewAllowed('winner', g().config, 'R1_UB1') && revealedOf(g().config, 'R1_UB1').join() === 'winner' && obs.at(-1) === sceneOf('winner') && log.includes('reveal winner'));
    check('…Analyst MVP not authorized by it', !viewAllowed('desk', g().config, 'R1_UB1'));
    check('analyst reveal without an analyst pick: refused', !(await run({ c: 'mvp-take', view: 'desk' })).ok);
    st.desk = true;
    check('analyst pick made → Analyst MVP TAKE works', (await run({ c: 'mvp-take', view: 'desk' })).ok && viewAllowed('desk', g().config, 'R1_UB1') && obs.at(-1) === sceneOf('desk'));
    check('comparison TAKE', (await run({ c: 'mvp-take', view: 'compare' })).ok && revealedOf(g().config, 'R1_UB1').join() === 'winner,desk,compare');
    check('authorizations belong to the match: another match shows nothing', !viewAllowed('winner', { ...g().config, match: 'R2_UB1' }));
    const ms = await run({ c: 'mvp-settings', patch: { match: 'R1_UB2', countdown: 120, revealPace: 'quick', revealSweep: false } });
    check('Studio settings saved straight to the event (no draft), match change → voting step', ms.ok && g().config.match === 'R1_UB2' && g().config.countdown === 120 && g().config.revealPace === 'quick' && g().config.step === 'voting' && !g().draft);
    check('…and the new match has no authorized reveal', !viewAllowed('winner', g().config));
    check('reveal authorization cannot be set from a client', !(await run({ c: 'gfx-set', id: 'mvp', patch: { revealed: 'R1_UB2:winner' } })).ok && !(await run({ c: 'mvp-settings', patch: { revealed: 'R1_UB2:winner' } })).ok);
    check('mvp-settings refuses a reveal step', !(await run({ c: 'mvp-settings', patch: { step: 'winner' } })).ok);
  }
  {
    // 3.3 TAKE safety: OBS refuses the switch → the MVP Program source goes back to what it showed (rollback)
    // make the OBS switch fail through the engine's dependency
    const R = rig2(F({ status: 'closed', frozen: true }));
    const fails = createEngine({ db: R.db, save() {}, goLive() {}, airProgram() {}, broadcastLive() {}, pushWc() {}, wcOp() {}, quick() {}, quickBadge() {}, clearPopups() {}, reloadOutputs() { return 0; }, pushState() {}, pushMedia() {}, pushGfx() {},
      onGfxPublish() {}, setSeat() { return null; }, editTalent() { return null; }, regenTalent() { return null; }, resyncSeat() { return null; },
      async obsSetup() { return {}; }, async obsSwitch() { return 'OBS refused the scene switch'; },
      obsLookup: () => ({ setupMap: {}, screenMap: {}, graphics: R.db.graphics, registry: REGISTRY, scenes: ['Overdrive · MVP', ...VIEWS.map(s => `Overdrive · ${s.name}`)], pkgObsKey: (p: string) => pkgById(p)?.obsKey }),
      mvp: { state: () => ({ ...R.st, match: 'R1_UB1' }), async op() { return null; } } });
    const gR = () => R.db.graphics.find((x: any) => x.id === 'mvp');
    const cfg0 = JSON.stringify(gR().config);
    const t = await fails.run({ c: 'mvp-take', view: 'winner' } as any, 'A', 'manual');
    check('TAKE whose OBS switch fails: refused AND rolled back (the reveal is not left authorized on the Program source)', !t.ok && /Rolled back/.test((t as any).error ?? '') && JSON.stringify(gR().config) === cfg0 && !viewAllowed('winner', gR().config, 'R1_UB1'), (t as any).error);
  }
  {
    // A stale draft published later never takes an authorization back.
    const { g, run } = rig2(F({ status: 'closed', frozen: true }));
    await run({ c: 'gfx-set', id: 'mvp', patch: { liveCounts: true } }); // draft made BEFORE the reveal
    await run({ c: 'mvp-take', view: 'winner' });
    await run({ c: 'gfx-publish', id: 'mvp' });
    check('stale draft published after a reveal: still authorized', viewAllowed('winner', g().config, 'R1_UB1') && g().config.liveCounts === true);
    // Publishing a reveal step from the inspector is an explicit reveal (as before) and authorizes it.
    const { g: g2, run: run2 } = rig2(F({ status: 'closed', frozen: true, desk: true }));
    await run2({ c: 'gfx-set', id: 'mvp', patch: { match: 'R1_UB1', step: 'desk' } }); await run2({ c: 'gfx-publish', id: 'mvp' });
    check('publishing the Analyst MVP step (MVP sequence / inspector) authorizes that view', viewAllowed('desk', g2().config, 'R1_UB1') && !viewAllowed('winner', g2().config, 'R1_UB1'));
  }
  {
    // Rundown: the MVP sequence with GO; automation never authorizes a reveal by itself.
    const { db, g, run, eng, obs, st } = rig2(F({ status: 'open' }));
    db.plan.segments = MVP_SEQUENCE.map((m, i) => sanitizeSegment({ label: m.label, target: m.target, dur: m.dur, transition: m.transition, confirm: m.confirm }, 'seg' + i));
    const ids = db.plan.segments.map((s: any) => s.id);
    for (const r of MVP_RULES({ voting: ids[0], closed: ids[1] })) await run({ c: 'sp-rule-set', rule: { ...r, on: true } });
    (st as MvpFlowIn).status = 'draft';
    await eng.fire('match-end');
    check('match ends → Voting Open prepared, waiting for the producer GO', db.plan.next === ids[0] && !!db.plan.pending && /MVP voting is ready/.test(db.plan.pending.text) && obs.length === 0);
    await run({ c: 'sp-go' });
    check('GO → Voting Open scene on air, voting opened, Voting Closed prepared', obs.at(-1) === `${sceneOf('voting')} (stinger)` && st.status === 'open' && db.plan.onAir?.id === ids[0] && db.plan.next === ids[1]);
    st.status = 'closed'; st.frozen = true;
    const realNow = Date.now; Date.now = () => realNow() + 9000; // automation waits 8 s after a manual change
    await eng.fire('mvp-closed');
    Date.now = realNow;
    check('voting closes → Voting Closed goes on air by itself (shows no result)', obs.at(-1) === `${sceneOf('closed')} (fade)` && db.plan.onAir?.id === ids[1]);
    check('…Community MVP reveal prepared and WAITING for GO (not authorized)', db.plan.next === ids[2] && !!db.plan.pending && !viewAllowed('winner', g().config, 'R1_UB1'));
    await run({ c: 'sp-go' });
    check('producer GO → reveal authorized + its scene on air', viewAllowed('winner', g().config, 'R1_UB1') && obs.at(-1) === `${sceneOf('winner')} (stinger)` && db.plan.onAir?.id === ids[2]);
    check('…Analyst MVP waits for its own GO', !!db.plan.pending && /Analyst/.test(db.plan.pending.text) && !viewAllowed('desk', g().config, 'R1_UB1'));
    const nd = await run({ c: 'sp-go' });
    check('no analyst pick: the GO is refused with the reason, the rundown does not move', !nd.ok && /analyst|desk/i.test((nd as any).error ?? '') && db.plan.onAir?.id === ids[2], (nd as any).error);
    st.desk = true;
    await run({ c: 'sp-go' });
    check('pick made, GO again → Analyst MVP on air', viewAllowed('desk', g().config, 'R1_UB1') && obs.at(-1) === `${sceneOf('desk')} (stinger)`);
    await run({ c: 'sp-go' });
    check('GO → comparison; the next rundown item is prepared', obs.at(-1) === `${sceneOf('compare')} (fade)` && db.plan.onAir?.id === ids[4] && !db.plan.pending);
  }
  {
    // Automatic GO into a reveal segment (e.g. auto-advance) is held for the producer.
    const { db, g, run, eng, obs } = rig2(F({ status: 'closed', frozen: true }));
    db.plan.segments = MVP_SEQUENCE.slice(1, 3).map((m, i) => sanitizeSegment({ label: m.label, target: m.target, dur: m.dur, transition: m.transition, confirm: false }, 's' + i));
    await run({ c: 'sp-rule-set', rule: { name: 'auto go', when: { k: 'countdown-end' }, then: [{ k: 'prepare', seg: 's1' }, { k: 'go' }] } });
    await eng.fire('countdown-end');
    check('automation GO into a reveal: held (pending GO), nothing authorized, OBS untouched', !!db.plan.pending && !viewAllowed('winner', g().config, 'R1_UB1') && obs.length === 0, db.plan.pending?.text);
  }
  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();

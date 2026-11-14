/**
 * Overdrive 2.0 production engine (server side). Wraps the existing hub state instead of replacing it.
 *
 * 2.0 workflow (independent OBS browser sources, OBS does the switching):
 *   Draft   = db.preview + db.showPreview + engine stage (booth/desk) + draft live-data commands
 *   Live    = what every browser source shows: db.live + db.showLive + Major booth/desk
 *   PUBLISH = draft → live, no scene switch, no transition. REVERT = drop the draft.
 *   OBS scene switches are explicit (`obs-switch`) and OBS performs the transition.
 * The legacy TAKE/CUT (whole-show /output/program) still work for the HTTP API, but the console no longer uses them.
 */
import type { Scene, Show, ScreenId, CasterId } from '../shared/types';
import { SCREEN_IDS } from '../shared/types';
import type { WildcardState, WcOp } from '../shared/wildcard';
import type { QuickOp } from '../shared/protocol';
import { isWcId } from '../shared/wildcard';
import { isMapId } from '../shared/maps';
import { DRAFTABLE, MANUAL_GRACE_MS, MAX_UNDO, draftLabel, sanitizeStage, type CmdSource, type DraftCmd, type EngineState, type ProducerCmd, type Stage, type TransitionKind } from '../shared/engine';
import type { MediaState } from '../shared/media';
import { REGISTRY, sanitizeStudio, type Studio } from '../shared/registry';
import { checkProp, defaultsOf, pkgById, PACKAGES, sanitizeConfig, type GfxInstance } from '../shared/gfx';
import { MAX_RUNDOWN, type Rundown, type RundownItem } from '../shared/rundown';

export interface EngineDb {
  preview: Scene; live: Scene; showPreview: Show; showLive: Show; wildcard: WildcardState; instant: boolean;
  engine?: { stage?: Stage; touched?: boolean; transition?: TransitionKind; draft?: DraftCmd[] };
  liveTransition?: TransitionKind;
  media: MediaState;
  studio?: Studio;
  graphics: GfxInstance[];
  rundown: Rundown;
}

export interface EngineDeps {
  db: EngineDb;
  save(): void;
  goLive(t: TransitionKind): void;
  airProgram(prevScreen: ScreenId, t: TransitionKind): void;
  broadcastLive(): void;
  pushWc(): void;
  wcOp(op: WcOp): void;
  quick(op: QuickOp): void;
  quickBadge(kind: 'replay' | 'highlights' | 'none'): void;
  clearPopups(): void;
  reloadOutputs(): number;
  pushState(): void;
  pushMedia(): void;
  /** Send the graphics instances to every source and controller. */
  pushGfx(): void;
  /** Talent / positions (hub owns the camera routing). Return an error message or null. */
  setSeat(seat: number, talent: string | null): string | null;
  editTalent(id: string, patch: { name?: string; role?: 'caster' | 'analyst'; mode?: 'webrtc' | 'vdo'; camQuality?: import('../shared/talent').CamQuality }): string | null;
  regenTalent(id: string): string | null;
  resyncSeat(seat: number): string | null;
  /** OBS: switch Program scene with the given transition (undefined = OBS's current one). */
  obsSwitch(scene: string, transition?: TransitionKind): Promise<string | null>;
  /** OBS Scene Builder: returns an error, or a note for the ack. Never switches OBS. */
  obsSetup(cmd: Extract<ProducerCmd, { c: 'obs-setup' }>): Promise<{ error?: string; note?: string }>;
}

type Snap = { label: string; at: number; kind: 'stage' | 'take'; preview: Scene; showPreview: Show; stage: Stage; touched: boolean; draft: DraftCmd[];
  live?: Scene; showLive?: Show; booth?: number[]; desk?: WildcardState['desk'] };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type Ack = { ok: true; version: number; note?: string } | { ok: false; version: number; error: string };

/** Existing Major ops the console may send through the engine (setup/destructive ones stay in the Controller). */
const WC_OPS = new Set(['score', 'wo', 'clear', 'live', 'time', 'air', 'opts', 'cast', 'showcase', 'intro', 'pick', 'champ', 'interview', 'veto', 'pb', 'pb-show', 'veto-undo', 'veto-reset', 'veto-order', 'pickem-reset', 'map', 'intro-play', 'intro-stop', 'replay', 'desk']);
const QUICK_OPS = new Set(['score', 'swap', 'reset-scores', 'game', 'timer-start', 'timer-add', 'timer-until', 'timer-stop', 'spotlight', 'spotlight-hide', 'active-player', 'music', 'next-match', 'matchup-casters', 'flag']);

export function createEngine(d: EngineDeps) {
  const db = d.db;
  db.engine ??= {};
  db.engine.draft ??= [];
  let version = 1;
  let stageVersion = 0, stageBy = '';
  let autoHold = false, manualAt = 0;
  let lastTake: EngineState['lastTake'] = null;
  const history: Snap[] = [];
  const draft = () => db.engine!.draft!;

  const programStage = (): Stage => ({ booth: [...db.wildcard.booth], desk: { slots: [...db.wildcard.desk.slots], guest: db.wildcard.desk.guest, panel: db.wildcard.desk.panel, strip: db.wildcard.desk.strip, clock: db.wildcard.desk.clock } });
  const stage = (): Stage => (db.engine!.touched && db.engine!.stage ? db.engine!.stage : programStage());
  const transition = (): TransitionKind => db.engine!.transition ?? 'stinger';

  function contentDirty(): boolean {
    const a = { ...db.preview, screen: db.live.screen };
    return !same(a, db.live) || !same(db.showPreview, db.showLive) || !same(stage(), programStage());
  }
  const gfxDirty = () => db.graphics.some(g => g.draft && JSON.stringify(g.draft) !== JSON.stringify(g.config));
  const dirty = () => contentDirty() || draft().length > 0 || gfxDirty();

  function state(): EngineState {
    return { version, stage: stage(), dirty: dirty(), transition: transition(), autoHold, manualAt,
      undo: history.slice(-6).reverse().map(h => ({ label: h.label, at: h.at })), lastTake, draft: [...draft()] };
  }

  function remember(label: string, kind: Snap['kind']) {
    const s: Snap = { label, at: Date.now(), kind, preview: clone(db.preview), showPreview: clone(db.showPreview), stage: clone(stage()), touched: !!db.engine!.touched, draft: clone(draft()) };
    if (kind === 'take') Object.assign(s, { live: clone(db.live), showLive: clone(db.showLive), booth: [...db.wildcard.booth], desk: clone(db.wildcard.desk) });
    history.push(s);
    if (history.length > MAX_UNDO) history.shift();
  }

  function enable(ids: number[]) {
    if (ids.some(id => !db.preview.casters.find(c => c.id === id)?.enabled))
      db.preview = { ...db.preview, casters: db.preview.casters.map(c => (ids.includes(c.id) ? { ...c, enabled: true } : c)) };
  }

  function setStage(next: Stage, by: string) {
    db.engine!.stage = sanitizeStage(next, stage());
    db.engine!.touched = true;
    stageVersion = version + 1; stageBy = by;
  }

  /** Legacy whole-show TAKE (/output/program): stage + scene/show, with a screen change. */
  function take(t: TransitionKind, by: string) {
    remember(`TAKE (${t})`, 'take');
    applyStage();
    d.goLive(t);
    lastTake = { at: Date.now(), by, transition: t, screen: db.live.screen };
    manualAt = Date.now();
  }

  function applyStage() {
    const s = stage(), wc = db.wildcard;
    wc.booth = [...s.booth];
    wc.desk = { ...wc.desk, ...s.desk, slots: [...s.desk.slots] };
    db.engine!.touched = false;
    d.pushWc();
  }

  /** 2.0 PUBLISH: every prepared change goes to the browser sources. Never switches a scene. */
  function publish(by: string): string | null {
    remember('Publish', 'take');
    applyStage();
    db.preview = { ...db.preview, screen: db.live.screen }; // the legacy whole-show output keeps its screen
    d.goLive('cut'); // same screen → no transition anywhere
    for (const g of db.graphics) if (g.draft) gfxPublish(g);
    d.pushGfx();
    const ops = [...draft()];
    db.engine!.draft = [];
    for (const op of ops) { const e = liveData(op); if (e) return `Published, but "${draftLabel(op)}" failed: ${e}`; }
    lastTake = { at: Date.now(), by, transition: 'cut', screen: db.live.screen };
    manualAt = Date.now();
    return null;
  }

  function afterStage(by: string, sceneSelect = false) {
    if (db.instant && !sceneSelect) publish(by); // Instant = explicit setting: prepared changes publish at once
    d.save();
  }

  /** Live data straight to the sources. Returns an error or null. */
  function liveData(cmd: DraftCmd): string | null {
    if (cmd.c === 'score') {
      if (cmd.side !== 'a' && cmd.side !== 'b') return 'Bad side';
      const wc = db.wildcard;
      if (wc.cast) d.wcOp({ k: 'score', id: wc.cast, side: cmd.side === 'a' ? 1 : 2, delta: cmd.delta === -1 ? -1 : 1 });
      else {
        for (const s of [db.showLive, db.showPreview]) { const t = cmd.side === 'a' ? s.teamA : s.teamB; t.score = Math.max(0, Math.min(99, t.score + (cmd.delta === -1 ? -1 : 1))); }
        d.broadcastLive();
      }
      return null;
    }
    if (cmd.c === 'pick') {
      const it = db.wildcard.intro;
      if (cmd.team && cmd.team !== it.a && cmd.team !== it.b) return 'Pick a team of the cast match';
      d.wcOp({ k: 'pick', slot: cmd.slot, pick: cmd.team ? { team: cmd.team, score: cmd.score ?? '' } : null });
      return null;
    }
    d.wcOp({ k: 'intro', patch: { picksShow: cmd.on === true } });
    return null;
  }

  // ---------------------------------------------------------------- graphics engine
  const gfx = (id: string) => db.graphics.find(g => g.id === id);
  const rd = () => db.rundown;
  const rdIndex = (id: string) => db.rundown.items.findIndex(x => x.id === id);
  const rdId = () => { let id: string; do id = Math.random().toString(36).slice(2, 10); while (rdIndex(id) >= 0); return id; };
  const anim = (g: GfxInstance, action: GfxInstance['anim']['action']) => { g.anim = { action, seq: g.anim.seq + 1, at: Date.now() }; };
  /** Published config changes on a graphic that is IN play its UPDATE animation (never other graphics). */
  function gfxPublish(g: GfxInstance) {
    if (!g.draft) return;
    const changed = JSON.stringify(g.draft) !== JSON.stringify(g.config);
    g.config = g.draft; g.draft = null;
    if (changed && g.anim.action !== 'out') anim(g, 'update');
  }

  // ---------------------------------------------------------------- media
  const m = () => db.media;
  function mediaStart(index: number) {
    const md = m();
    if (!md.playlist.length) return 'The playlist is empty';
    md.index = Math.max(0, Math.min(md.playlist.length - 1, index));
    md.status = 'playing'; md.startedAt = Date.now(); md.pausedMs = 0; md.seq++;
    return null;
  }
  /** A media source reports the current item ended (accepted once per play). */
  function mediaEnded(seq: number) {
    const md = m();
    if (seq !== md.seq || md.status !== 'playing') return;
    if (md.auto && md.index + 1 < md.playlist.length) mediaStart(md.index + 1);
    else if (md.auto && md.loop && md.playlist.length) mediaStart(0);
    else { md.status = 'stopped'; md.startedAt = null; md.seq++; }
    version++; d.save(); d.pushMedia(); d.pushState();
  }

  async function run(cmd: ProducerCmd, by: string, source: CmdSource, base?: number): Promise<Ack> {
    const fail = (error: string): Ack => ({ ok: false, version, error });
    if (!cmd || typeof cmd !== 'object') return fail('Bad command');
    // On-air commands: automation waits while held or right after a manual one. Graphics IN/OUT/publish change what is on air too.
    const gfxAirCmd = cmd.c === 'gfx-publish' || cmd.c === 'gfx-anim' || cmd.c === 'rd-take' || cmd.c === 'rd-next';
    const programCmd = cmd.c === 'take' || cmd.c === 'cut' || cmd.c === 'safe' || cmd.c === 'obs-switch' || cmd.c === 'publish' || gfxAirCmd;
    if (source === 'auto' && programCmd) {
      if (autoHold) return fail('Automation is on hold');
      if (Date.now() - manualAt < MANUAL_GRACE_MS) return fail('Manual change just happened: automation waits');
    }
    let note: string | undefined;
    switch (cmd.c) {
      // ------------------------------------------------------------- draft (prepared)
      case 'stage-screen': {
        if (!SCREEN_IDS.includes(cmd.screen)) return fail('Unknown screen');
        if (db.preview.screen === cmd.screen) break;
        db.preview = { ...db.preview, screen: cmd.screen };
        afterStage(by, true);
        break;
      }
      case 'stage-booth': {
        const ids = (Array.isArray(cmd.ids) ? cmd.ids : []).map(Number).filter(n => n >= 1 && n <= 6);
        if (new Set(ids).size !== ids.length) return fail('Same position twice');
        if (ids.length > 3) return fail('The caster desk has 3 positions');
        if (ids.some(n => n > 3)) return fail('The caster desk takes caster positions 1-3');
        remember('Caster desk layout', 'stage');
        setStage({ ...stage(), booth: [...ids].sort() }, by); // positions are fixed: 1 left, 2 center, 3 right
        enable(ids);
        afterStage(by);
        break;
      }
      case 'stage-desk': {
        const cur = stage();
        const analysts = cmd.analysts ?? cur.desk.slots;
        if (analysts.some(n => n < 4 || n > 5)) return fail('Analyst positions are 4-5');
        const guest = cmd.guest === undefined ? cur.desk.guest : cmd.guest;
        if (guest != null && (guest < 1 || guest > 3)) return fail('Only a caster position (1-3) can join the desk');
        remember('Analyst desk', 'stage');
        setStage({ ...cur, desk: { ...cur.desk, slots: [...analysts].sort(), guest, panel: cmd.panel ?? cur.desk.panel } }, by);
        enable([...analysts, ...(guest != null ? [guest] : [])]);
        afterStage(by);
        break;
      }
      case 'stage-flag': {
        const on = cmd.on === true, sp = db.showPreview;
        remember(`${cmd.flag} ${on ? 'on' : 'off'}`, 'stage');
        switch (cmd.flag) {
          case 'scoreboard': db.showPreview = { ...sp, showScoreboard: on }; break;
          case 'matchup-screens': db.showPreview = { ...sp, showMatchupOnScreens: on }; break;
          case 'matchup-casters': db.showPreview = { ...sp, showMatchupOnCasters: on }; break;
          case 'ticker': db.showPreview = { ...sp, ticker: { ...sp.ticker, onScreens: on } }; break;
          case 'gameplay-cams': db.showPreview = { ...sp, gameplay: { ...sp.gameplay, cams: on } }; break;
          case 'gameplay-ticker': db.showPreview = { ...sp, gameplay: { ...sp.gameplay, ticker: on } }; break;
          case 'names': db.preview = { ...db.preview, showNames: on }; break;
          case 'desk-strip': setStage({ ...stage(), desk: { ...stage().desk, strip: on } }, by); break;
          case 'desk-clock': setStage({ ...stage(), desk: { ...stage().desk, clock: on } }, by); break;
          default: history.pop(); return fail('Unknown flag');
        }
        stageVersion = version + 1; stageBy = by;
        afterStage(by);
        break;
      }
      case 'camera': {
        const seat = Number(cmd.seat);
        if (!(seat >= 1 && seat <= 6)) return fail('Unknown position');
        remember(`Camera ${seat} ${cmd.on ? 'on' : 'off'}`, 'stage');
        db.preview = { ...db.preview, casters: db.preview.casters.map(c => (c.id === seat ? { ...c, cameraOn: cmd.on === true } : c)) };
        stageVersion = version + 1; stageBy = by;
        afterStage(by);
        break;
      }
      case 'draft': {
        const dc = cmd.cmd;
        if (!dc || !(DRAFTABLE as readonly string[]).includes(dc.c)) return fail('This change cannot be prepared');
        if (dc.c === 'pick' && dc.team) { const it = db.wildcard.intro; if (dc.team !== it.a && dc.team !== it.b) return fail('Pick a team of the cast match'); }
        draft().push(dc);
        stageVersion = version + 1; stageBy = by;
        d.save();
        break;
      }
      case 'draft-drop': {
        if (!(cmd.index >= 0 && cmd.index < draft().length)) return fail('No such prepared change');
        draft().splice(cmd.index, 1); d.save();
        break;
      }
      case 'stage-reset': case 'revert': {
        if (!dirty()) return fail('Nothing prepared');
        remember('Revert', 'stage');
        db.preview = { ...clone(db.live), screen: db.preview.screen }; db.showPreview = clone(db.showLive); db.engine!.touched = false; db.engine!.draft = [];
        for (const g of db.graphics) g.draft = null; d.pushGfx();
        d.save();
        break;
      }
      case 'publish': {
        if (base != null && base < stageVersion && stageBy !== by) return fail('The draft was changed by another operator: check it and publish again');
        if (!dirty()) return fail('Nothing prepared');
        const e = publish(by);
        if (e) note = e;
        break;
      }
      // ------------------------------------------------------------- legacy whole-show Program
      case 'take': case 'cut': {
        if (base != null && base < stageVersion && stageBy !== by) return fail('Preview was changed by another operator: check it and TAKE again');
        if (!dirty() && db.preview.screen === db.live.screen) return fail('Preview is the same as Program');
        take(cmd.c === 'cut' ? 'cut' : cmd.transition ?? transition(), by);
        break;
      }
      case 'set-transition':
        if (!['stinger', 'fade', 'cut'].includes(cmd.transition)) return fail('Unknown transition');
        db.engine!.transition = cmd.transition; d.save();
        break;
      case 'undo': {
        const h = history.pop();
        if (!h) return fail('Nothing to undo');
        db.preview = h.preview; db.showPreview = h.showPreview; db.engine!.stage = h.stage; db.engine!.touched = h.touched; db.engine!.draft = h.draft;
        if (h.kind === 'take' && h.live && h.showLive && h.desk && h.booth) {
          const prev = db.live.screen;
          db.live = h.live; db.showLive = h.showLive; db.wildcard.booth = h.booth; db.wildcard.desk = h.desk;
          d.pushWc(); d.airProgram(prev, 'cut');
          manualAt = Date.now();
        }
        d.save();
        version++; d.pushState();
        return { ok: true, version, note: `Undid: ${h.label}` };
      }
      // ------------------------------------------------- live data / keyed graphics
      case 'score': case 'pick': case 'picks-show': {
        const e = liveData(cmd); if (e) return fail(e);
        manualAt = source === 'manual' ? Date.now() : manualAt;
        break;
      }
      case 'cast-match':
        if (cmd.id != null && !isWcId(cmd.id)) return fail('Unknown match');
        d.wcOp({ k: 'cast', id: cmd.id });
        break;
      case 'graphic':
        if (cmd.g === 'map-card') { if (!isMapId(cmd.map)) return fail('Choose a map'); d.wcOp({ k: 'map', id: cmd.map! }); }
        else if (cmd.g === 'replay' || cmd.g === 'highlights') d.quickBadge(cmd.g);
        else if (cmd.g === 'clear-badge') d.quickBadge('none');
        else return fail('Unknown graphic');
        break;
      case 'op-wc': {
        const op = cmd.op as WcOp;
        if (!op || !WC_OPS.has(op.k)) return fail('This operation is not available here');
        if (op.k === 'desk' && (op.slots || op.guest !== undefined || op.panel || op.strip !== undefined || op.clock !== undefined)) return fail('Desk positions and panels are prepared: use the desk controls');
        d.wcOp(op);
        break;
      }
      case 'op-quick': {
        const op = cmd.op as QuickOp;
        if (!op || !QUICK_OPS.has(op.k)) return fail('This operation is not available here');
        d.quick(op);
        break;
      }
      // ------------------------------------------------------------- talent
      case 'seat': { const e = d.setSeat(Number(cmd.seat), cmd.talent ?? null); if (e) return fail(e); break; }
      case 'talent-edit': { const e = d.editTalent(String(cmd.id), { name: cmd.name, role: cmd.role, mode: cmd.mode, camQuality: cmd.camQuality }); if (e) return fail(e); break; }
      case 'talent-regen': { const e = d.regenTalent(String(cmd.id)); if (e) return fail(e); note = 'New link: the old one no longer works'; break; }
      case 'feed-resync': { const e = d.resyncSeat(Number(cmd.seat)); if (e) return fail(e); note = 'Feed renegotiated (talent did not have to do anything)'; break; }
      // ------------------------------------------------------------- OBS
      case 'obs-switch': {
        if (typeof cmd.scene !== 'string' || !cmd.scene) return fail('Choose an OBS scene');
        const tr = cmd.transition && cmd.transition !== 'obs' ? cmd.transition : undefined;
        const e = await d.obsSwitch(cmd.scene, tr);
        if (e) return fail(e);
        manualAt = Date.now();
        break;
      }
      case 'obs-setup': {
        const r = await d.obsSetup(cmd);
        if (r.error) return fail(r.error);
        note = r.note;
        break;
      }
      // ------------------------------------------------------------- media
      case 'media': {
        const md = m();
        let e: string | null = null;
        if (cmd.action === 'play') {
          if (md.status === 'paused') { md.status = 'playing'; md.startedAt = Date.now() - md.pausedMs; md.seq++; }
          else e = mediaStart(md.status === 'playing' ? md.index : md.index);
        } else if (cmd.action === 'pause') {
          if (md.status !== 'playing' || md.startedAt == null) return fail('Nothing is playing');
          md.pausedMs = Date.now() - md.startedAt; md.status = 'paused'; md.startedAt = null;
        } else if (cmd.action === 'stop') { md.status = 'stopped'; md.startedAt = null; md.pausedMs = 0; md.seq++; }
        else if (cmd.action === 'next') e = mediaStart(md.index + 1 < md.playlist.length ? md.index + 1 : md.loop ? 0 : md.index);
        else if (cmd.action === 'prev') e = mediaStart(Math.max(0, md.index - 1));
        else if (cmd.action === 'goto') { if (!(Number.isInteger(cmd.index) && cmd.index! >= 0 && cmd.index! < md.playlist.length)) return fail('No such item'); e = mediaStart(cmd.index!); }
        else return fail('Unknown media action');
        if (e) return fail(e);
        d.save(); d.pushMedia();
        break;
      }
      case 'media-set': {
        const list = (Array.isArray(cmd.playlist) ? cmd.playlist : []).filter(u => typeof u === 'string' && u.startsWith('/media/') && !u.includes('..')).slice(0, 100);
        const md = m(), cur = md.playlist[md.index];
        md.playlist = list;
        const keep = cur ? list.indexOf(cur) : -1;
        if (keep >= 0) md.index = keep; else { md.index = 0; if (md.status !== 'stopped') { md.status = 'stopped'; md.startedAt = null; md.seq++; } }
        d.save(); d.pushMedia();
        break;
      }
      case 'media-opts': {
        const md = m();
        if (typeof cmd.volume === 'number') md.volume = Math.max(0, Math.min(1, cmd.volume));
        if (typeof cmd.muted === 'boolean') md.muted = cmd.muted;
        if (typeof cmd.auto === 'boolean') md.auto = cmd.auto;
        if (typeof cmd.loop === 'boolean') md.loop = cmd.loop;
        d.save(); d.pushMedia();
        break;
      }
      // ------------------------------------------------------------- studio
      case 'studio-set': {
        if (!REGISTRY.some(s => s.id === cmd.scene)) return fail('Unknown scene');
        const next = sanitizeStudio({ scenes: { ...(db.studio?.scenes ?? {}), [cmd.scene]: { modules: cmd.modules, pinned: cmd.pinned } } });
        db.studio = next; d.save();
        break;
      }
      // ------------------------------------------------------------- graphics engine
      case 'gfx-set': {
        const g = gfx(cmd.id); const p = g && pkgById(g.pkg);
        if (!g || !p) return fail('Unknown graphic');
        if (!cmd.patch || typeof cmd.patch !== 'object' || !Object.keys(cmd.patch).length) return fail('Nothing to change: send {"patch": {"<property>": <value>}}');
        const next = { ...(g.draft ?? g.config) };
        for (const [k, v] of Object.entries(cmd.patch ?? {})) {
          const def = p.props.find(x => x.key === k);
          if (!def) return fail(`${p.name} has no property "${k}"`);
          const c = checkProp(def, v);
          if (!c.ok) return fail(c.error);
          next[k] = c.value;
        }
        g.draft = next;
        stageVersion = version + 1; stageBy = by;
        if (db.instant) gfxPublish(g);
        d.save(); d.pushGfx();
        break;
      }
      case 'gfx-publish': {
        const g = gfx(cmd.id);
        if (!g) return fail('Unknown graphic');
        if (!g.draft) return fail('Nothing prepared for this graphic');
        gfxPublish(g); d.save(); d.pushGfx();
        break;
      }
      case 'gfx-revert': {
        const g = gfx(cmd.id);
        if (!g) return fail('Unknown graphic');
        if (!g.draft) return fail('Nothing prepared for this graphic');
        g.draft = null; d.save(); d.pushGfx();
        break;
      }
      case 'gfx-anim': {
        const g = gfx(cmd.id);
        if (!g) return fail('Unknown graphic');
        if (!['in', 'out', 'update', 'reset'].includes(cmd.action)) return fail('Unknown animation');
        if (cmd.action === 'reset') { g.config = defaultsOf(pkgById(g.pkg)!); g.draft = null; anim(g, 'reset'); }
        else anim(g, cmd.action);
        d.save(); d.pushGfx();
        break;
      }
      case 'gfx-create': {
        const p = pkgById(cmd.pkg);
        if (!p) return fail('Unknown graphics package');
        const name = String(cmd.name ?? '').trim().slice(0, 60) || `${p.name} ${db.graphics.filter(g => g.pkg === p.id).length + 1}`;
        let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'graphic', id = base, n = 2;
        while (gfx(id)) id = `${base}-${n++}`;
        db.graphics.push({ id, pkg: p.id, name, config: defaultsOf(p), draft: null, anim: { action: 'out', seq: 0, at: Date.now() }, presets: [] });
        d.save(); d.pushGfx();
        note = `Created: browser source /g/${id}`;
        break;
      }
      case 'gfx-obs': {
        const g = gfx(cmd.id);
        if (!g) return fail('Unknown graphic');
        g.obsScene = typeof cmd.scene === 'string' && cmd.scene.trim() ? cmd.scene.trim().slice(0, 120) : null;
        d.save(); d.pushGfx();
        break;
      }
      // ------------------------------------------------------------- graphics rundown
      case 'rd-add': {
        const g = gfx(cmd.gfx);
        if (!g) return fail('Unknown graphic');
        if (rd().items.length >= MAX_RUNDOWN) return fail(`The rundown holds ${MAX_RUNDOWN} items`);
        const preset = cmd.preset ? g.presets.find(q => q.name === cmd.preset)?.name ?? null : null;
        if (cmd.preset && !preset) return fail(`${g.name} has no preset "${cmd.preset}"`);
        const item: RundownItem = {
          id: rdId(), gfx: g.id,
          label: String(cmd.label ?? '').trim().slice(0, 80) || (preset ? `${g.name} · ${preset}` : cmd.snapshot ? `${g.name} · snapshot` : g.name),
          preset, data: !preset && cmd.snapshot ? clone(g.draft ?? g.config) : null, takenAt: null,
        };
        const at = typeof cmd.at === 'number' ? Math.max(0, Math.min(rd().items.length, Math.round(cmd.at))) : rd().items.length;
        rd().items.splice(at, 0, item);
        if (!rd().cue) rd().cue = item.id;
        d.save();
        note = `Added to the rundown: ${item.label}`;
        break;
      }
      case 'rd-remove': {
        const i = rdIndex(cmd.id);
        if (i < 0) return fail('Unknown rundown item');
        rd().items.splice(i, 1);
        if (rd().cue === cmd.id) rd().cue = rd().items[i]?.id ?? rd().items[i - 1]?.id ?? null;
        d.save();
        break;
      }
      case 'rd-move': {
        const i = rdIndex(cmd.id);
        if (i < 0) return fail('Unknown rundown item');
        const to = Math.max(0, Math.min(rd().items.length - 1, Math.round(Number(cmd.to))));
        if (!Number.isFinite(to)) return fail('Bad position');
        const [it] = rd().items.splice(i, 1);
        rd().items.splice(to, 0, it);
        d.save();
        break;
      }
      case 'rd-edit': {
        const it = rd().items.find(x => x.id === cmd.id);
        if (!it) return fail('Unknown rundown item');
        if (typeof cmd.label === 'string') { if (!cmd.label.trim()) return fail('The item needs a name'); it.label = cmd.label.trim().slice(0, 80); }
        if (cmd.preset !== undefined) {
          const g = gfx(it.gfx);
          if (cmd.preset && !g?.presets.some(q => q.name === cmd.preset)) return fail(`No preset "${cmd.preset}" on this graphic`);
          it.preset = cmd.preset || null;
          if (it.preset) it.data = null;
        }
        d.save();
        break;
      }
      case 'rd-cue': {
        if (cmd.id !== null && rdIndex(cmd.id) < 0) return fail('Unknown rundown item');
        rd().cue = cmd.id;
        d.save();
        break;
      }
      case 'rd-next': case 'rd-take': {
        const id = cmd.c === 'rd-next' ? rd().cue : cmd.id;
        const action = cmd.c === 'rd-next' ? 'in' : cmd.action;
        const i = id ? rdIndex(id) : -1;
        if (i < 0) return fail(cmd.c === 'rd-next' ? 'Nothing cued in the rundown' : 'Unknown rundown item');
        const it = rd().items[i];
        const g = gfx(it.gfx), p = g && pkgById(g.pkg);
        if (!g || !p) return fail('The graphic of this item no longer exists');
        if (!['in', 'update', 'out'].includes(action)) return fail('Take IN, UPDATE or OUT');
        if (action === 'out') { if (g.anim.action !== 'out') anim(g, 'out'); }
        else {
          const data = it.preset ? g.presets.find(q => q.name === it.preset)?.config : it.data;
          if (it.preset && !data) return fail(`Preset "${it.preset}" was deleted from ${g.name}`);
          if (data) {
            // The item carries its data: it is what goes on air (any prepared draft of this graphic is replaced).
            const next = sanitizeConfig(p, { ...g.config, ...data });
            const changed = JSON.stringify(next) !== JSON.stringify(g.config);
            if (g.draft) note = `${g.name}: prepared changes replaced by the item's data`;
            g.config = next; g.draft = null;
            if (g.anim.action === 'out') { if (action === 'in') anim(g, 'in'); }
            else if (changed || action === 'update') anim(g, 'update');
          } else if (action === 'in') {
            anim(g, g.anim.action === 'out' ? 'in' : 'update');
          } else if (g.draft) gfxPublish(g); // UPDATE without own data = publish what is prepared on the graphic
          else if (g.anim.action !== 'out') anim(g, 'update');
          if (action === 'in') { it.takenAt = Date.now(); rd().cue = rd().items[i + 1]?.id ?? null; }
        }
        d.save(); d.pushGfx();
        break;
      }
      case 'rd-clear': rd().items = []; rd().cue = null; d.save(); break;
      case 'gfx-delete': {
        const i = db.graphics.findIndex(g => g.id === cmd.id);
        if (i < 0) return fail('Unknown graphic');
        if (PACKAGES.some(p => p.id.replace(/^od\./, '') === cmd.id)) return fail('The default instance of a package cannot be deleted');
        db.graphics.splice(i, 1);
        // Its rundown items go too (they could never be taken).
        const gone = rd().items.filter(x => x.gfx === cmd.id).map(x => x.id);
        rd().items = rd().items.filter(x => x.gfx !== cmd.id);
        if (rd().cue && gone.includes(rd().cue!)) rd().cue = rd().items[0]?.id ?? null;
        d.save(); d.pushGfx();
        break;
      }
      case 'gfx-rename': {
        const g = gfx(cmd.id); const name = String(cmd.name ?? '').trim().slice(0, 60);
        if (!g) return fail('Unknown graphic'); if (!name) return fail('Give it a name');
        g.name = name; d.save(); d.pushGfx();
        break;
      }
      case 'gfx-preset': {
        const g = gfx(cmd.id); const name = String(cmd.name ?? '').trim().slice(0, 40);
        if (!g) return fail('Unknown graphic'); if (!name) return fail('Give the preset a name');
        if (cmd.op === 'save') { g.presets = [...g.presets.filter(p => p.name !== name), { name, config: { ...(g.draft ?? g.config) } }].slice(-30); }
        else if (cmd.op === 'load') { const p = g.presets.find(q => q.name === name); if (!p) return fail('No such preset'); g.draft = { ...p.config }; if (db.instant) gfxPublish(g); }
        else if (cmd.op === 'delete') g.presets = g.presets.filter(p => p.name !== name);
        else return fail('Unknown preset action');
        d.save(); d.pushGfx();
        break;
      }
      // ------------------------------------------------------------- recovery
      case 'panic': {
        const wc = db.wildcard;
        d.quickBadge('none'); d.clearPopups();
        wc.map = { id: null, at: null }; wc.veto = { ...wc.veto, pb: { map: null, at: null } }; wc.champ = false;
        d.pushWc();
        break;
      }
      case 'safe': {
        remember('Safe cut to BRB', 'take');
        const prev = db.live.screen;
        db.live = { ...db.live, screen: 'brb' };
        d.airProgram(prev, 'cut');
        manualAt = Date.now();
        break;
      }
      case 'reload-outputs': { const n = d.reloadOutputs(); note = `${n} browser source${n === 1 ? '' : 's'} reloading`; break; }
      case 'automation': autoHold = cmd.hold === true; break;
      default: return fail('Unknown command');
    }
    if (gfxAirCmd && source === 'manual') manualAt = Date.now();
    version++;
    d.pushState();
    return note ? { ok: true, version, note } : { ok: true, version };
  }

  return { run, state, stage, mediaEnded, transition: () => transition() };
}
export type Engine = ReturnType<typeof createEngine>;
export type { CasterId };

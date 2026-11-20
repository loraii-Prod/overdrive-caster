import { createPerf, type Perf } from './perf';
import { SEATS, SEAT_LABELS, seatOf, talentLabel, type Seat, TALENT_ROLES, TALENT_COUNT, TALENT_MAX, sanitizeAudio, sanitizeCrop, describeVdoLink, inUse, blankTalent, talentNum, type TalentRole } from '../shared/talent';
import type { TalentPatch } from '../shared/engine';
import { createEngine, type Engine } from './engine';
import type { ProducerCmd, TransitionKind } from '../shared/engine';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config';
import { roleFrom, type AuthRole } from './auth';
import { applyOp, isTeam, resolve, type TournamentOp } from '../shared/tournament';
import { ensureStreamIds, matchPlayer, sanitizePlayers, sanitizeStories, STORY_LABELS } from '../shared/players';
import { db, newKey, newVdoId, sanitizeFollow, save } from './store';
import { iceServers } from './turn';
import { Audience } from './audience';
import { tag } from './assets';
import { playerIdOf } from '../shared/playerIds';
import { Twitch } from './twitch';
import { TwitchChat } from './twitchChat';
import { ChatVoting } from './chatVoting';
import type { ChatOp } from '../shared/twitchChat';
import { ObsBridge } from './obs';
import { createObsSetup } from './obsSetup';
import { createAudioMix } from './audioMix';
import { CamEngine } from './camEngine';
import { DESK_SCENES, DESK_SEATS, bSceneName, mainSceneName, type MainKey } from '../shared/obsLayout';
import { SKINS } from '../shared/skins';
import { pkgById } from '../shared/gfx';
import { REGISTRY } from '../shared/registry';
import { mvpViewOfSel } from '../shared/mainScenes';
import { parseVdoId } from '../shared/talent';
import { TRACK_DEFAULT_SHEET, applyTrackOp, parseTrackRows, trackSheetUrl, type TrackOp } from '../shared/trackProgress';
import { createEvent, deleteEvent, putRehearsal, rehearsalReturn, renameEvent, switchEvent } from './events';
import { DEMO_MATCHES, REHEARSAL_ID, demoWildcard } from '../shared/mvpRehearsal';
import { segmentObsScene } from '../shared/showplan';
import { applyFeatured, sheetGet, syncSheet } from './sheet';
import { parseCsv } from '../shared/sheet';
import { parseSheetUrl } from '../shared/sheet';
import { compose } from '../shared/layout';
import { clone, defaultScene, defaultShow, sanitizeRos, sanitizeScene, sanitizeShow, sameScene } from '../shared/defaults';
import type { ClientMsg, QuickOp, Role, ServerMsg, WatchRequest } from '../shared/protocol';
import { CASTER_IDS, SCREEN_IDS, type CasterId, type ContributorStatus, type ControllerState, type Preset, type Scene, type ScreenId, type Show } from '../shared/types';
import { seasonOf } from '../shared/season';
import { isMapId, majorMap } from '../shared/maps';
import { GRAND_FINAL, sanitizeInterview, sanitizePb, sanitizeVeto, vetoApply, WC_IDS, matchName, realTeam, wcLogo, wcResolve, applyMatchOp, sanitizePick, demoEvent, diffEvents, isWcBackup, isWcId, mergeSheet, sanitizeIntro, sanitizeShowcase, sanitizeWildcard, sanitizeRosters, updateDone, wcSnapshot, type WcOp, type WcPop, type WcSheetRow, vetoMapFor } from '../shared/wildcard';

interface Client {
  id: string;
  ws: WebSocket;
  authed: boolean;
  authRole: AuthRole | null;
  role?: Role;
  route?: string;
  slot?: CasterId; // contributors (legacy per-slot link)
  talent?: string; // contributors (2.0 personal talent link)
  watching: Map<CasterId, WatchRequest>;
  alive: boolean;
  pub?: { publishing: boolean; hasAudio: boolean; label?: string };
}

const isSlot = (v: unknown): v is CasterId => CASTER_IDS.includes(v as CasterId);
const DEFAULT_SEAT_NAMES: Record<Seat, string> = { 1: 'Caster 1', 2: 'Caster 2', 3: 'Caster 3', 4: 'Analyst 1', 5: 'Analyst 2', 6: 'Guest' };

export function createHub(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  const clients = new Map<string, Client>();
  const publishers = new Map<CasterId, string>();

  let stateTimer: NodeJS.Timeout | null = null;
  // eslint-disable-next-line prefer-const
  let audioMix: ReturnType<typeof createAudioMix> | undefined; // assigned below (OBS may connect while being constructed)
  let perf: Perf | null = null; // assigned below; the OBS bridge may report changes while it is being constructed
  let initCamEngines: (() => Promise<void>) | undefined; // assigned below (3.4 camera engines; OBS may connect while being constructed)
  const obs = new ObsBridge(() => { pushState(); perf?.kick(); }, { url: db.obsUrl, password: db.obsPassword }, () => { void obsSetup.scan(); perf?.kick(); audioMix?.connected(); void initCamEngines?.(); });
  // OBS Scene Builder: one OBS scene per Overdrive output, over the same OBS connection. Never switches OBS.
  const obsSetup = createObsSetup({
    call: () => (obs.status.connected ? obs.request : null),
    connected: () => obs.status.connected,
    obsUrl: () => obs.status.url ?? '',
    graphics: () => db.graphics,
    obsScenes: () => db.showLive.obsScenes,
    store: () => db.obsSetup,
    outputKey: config.outputKey,
    port: config.port,
    lanUrls: () => lanUrls(),
    publicUrl: () => publicOrigin(),
    save: () => save(),
    onChange: () => { pushState(); perf?.kick(); },
    applyMapping: built => {
      let gfxChanged = false;
      const scenes = { ...db.showLive.obsScenes };
      const known = new Set(obs.status.scenes);
      for (const { target, scene, was } of built) {
        if (target.kind === 'gfx') {
          const g = db.graphics.find(x => `g:${x.id}` === target.id);
          // 3.2 main layout: a layer is not "the" scene of its graphic (several share one): only the base claims it;
          // a layer forgets the scene an earlier build wrote (never one the operator chose by hand)
          const layer = !!target.role && target.role !== 'base';
          if (g && layer) { if (g.obsScene && was && g.obsScene === was) { g.obsScene = null; gfxChanged = true; } }
          else if (g && g.obsScene !== scene) { g.obsScene = scene; gfxChanged = true; }
          // a graphics-engine instance that replaces a legacy screen: fill the screen mapping if it is empty or stale
          const p = g ? pkgById(g.pkg) : undefined;
          const key = p && p.id.replace(/^od\./, '') === g!.id ? (p.obsKey as ScreenId | undefined) : undefined;
          if (key && key in scenes && (!scenes[key] || !known.has(scenes[key]) || target.role === 'base')) scenes[key] = scene;
        } else if (target.screen) scenes[target.screen] = scene;
      }
      db.showPreview = { ...db.showPreview, obsScenes: { ...db.showPreview.obsScenes, ...scenes } };
      db.showLive = { ...db.showLive, obsScenes: scenes };
      save();
      if (gfxChanged) pushGfx();
    },
    refsTo: scene => {
      const out: string[] = [];
      for (const sg of db.plan?.segments ?? []) if (sg.obsScene === scene) out.push(`rundown: ${sg.label}`);
      for (const [k, v] of Object.entries(db.showLive.obsScenes)) if (v === scene) out.push(`screen mapping: ${k}`);
      for (const g of db.graphics) if (g.obsScene === scene) out.push(`graphic: ${g.name}`);
      for (const c of db.live.casters) if (c.source.type === 'obs' && c.source.obsScene === scene) out.push(`camera: ${c.name}`);
      return out;
    },
    repoint: (from, to) => {
      for (const sg of db.plan?.segments ?? []) if (sg.obsScene === from) sg.obsScene = null; // the segment's target mapping now names the main scene
      const fix = (m: Record<string, string | undefined>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === from ? to : v]));
      db.showLive = { ...db.showLive, obsScenes: fix(db.showLive.obsScenes) as typeof db.showLive.obsScenes };
      db.showPreview = { ...db.showPreview, obsScenes: fix(db.showPreview.obsScenes) as typeof db.showPreview.obsScenes };
      for (const g of db.graphics) if (g.obsScene === from) g.obsScene = null;
      for (const sc of [db.live, db.preview]) for (const c of sc.casters) if (c.source.type === 'obs' && c.source.obsScene === from) c.source.obsScene = to;
      save(); pushGfx(); pushState();
    },
  });
  obs.onItems = () => { void obsSetup.refreshLayers(); };
  // 3.0 persistent talent audio over the same OBS connection (volume, mute, sync, monitoring, meters, health)
  audioMix = createAudioMix({
    call: () => (obs.status.connected ? obs.request : null),
    talent: () => db.talent,
    seats: () => db.seats,
    master: () => db.audioMaster === true,
    onChange: () => pushState(),
    meters: m => each(c => c.role === 'controller', { t: 'meters', m }),
  });
  obs.onEvent('InputVolumeMeters', e => audioMix?.onMeters(e));
  obs.onEvent('InputMuteStateChanged', e => audioMix?.onMute(e));
  obs.onEvent('InputCreated', () => void audioMix?.sync('obs input created'));
  obs.onEvent('InputRemoved', () => void audioMix?.sync('obs input removed'));
  obs.onEvent('InputNameChanged', () => void audioMix?.sync('obs input renamed'));
  setInterval(() => void audioMix?.sync('poll'), 5000).unref();
  // Off-air suspension + live performance monitor (both off until the producer enables them in OBS Setup).
  perf = createPerf({
    call: () => (obs.status.connected ? obs.request : null),
    opts: () => db.obsSetup.options,
    outputs: () => [...clients.values()].filter(c => c.role === 'output' && c.route).map(c => ({ id: c.id, route: c.route! })),
    send: (id, msg) => send(clients.get(id), msg),
    report: r => each(c => c.role === 'controller', { t: 'perf', perf: r }),
  });
  // 3.4 Camera composition: one CamEngine per desk, controlling A/B scene pairs with persistent camera inputs.
  // Created once; (re-)initialized when OBS connects by calling discoverItems() and detectMoveTransition().
  const camEngines = new Map<MainKey, CamEngine>();
  for (const desk of DESK_SCENES) {
    const seats = DESK_SEATS[desk] ?? [];
    camEngines.set(desk, new CamEngine({
      obs: { call: () => (obs.status.connected ? obs.request : null), connected: () => obs.status.connected, base: () => ({ w: 1920, h: 1080 }) },
      desk,
      scenes: { a: mainSceneName(desk), b: bSceneName(desk) },
      seats,
      holes: SKINS.overdrive.holes,
      onChange: () => pushState(),
    }));
  }
  // When OBS connects, discover camera scene items and check for Move Transition plugin.
  initCamEngines = async () => {
    for (const eng of camEngines.values()) {
      try { await eng.discoverItems(); await eng.detectMoveTransition(); } catch (e) { console.warn(`[cam] ${eng.desk} init:`, (e as Error).message); }
    }
  };
  obs.onEvent('SceneListChanged', () => void initCamEngines?.());

  /**
   * Which desk a camera command targets. ProducerCmd's cam-* variants carry no explicit desk (one
   * producer, one desk in view at a time, as of 3.4). Explicit seats in a layout are unambiguous; failing
   * that, whichever desk screen is currently in Preview (camera prep always targets Preview/B scene); failing
   * that, Caster Desk. If Phase 3e's dock UI ever needs two desks staged at once, add an explicit `desk`
   * field to these commands instead of widening this heuristic.
   */
  function deskFromSeats(cameras: { seat: number }[]): MainKey | null {
    for (const desk of DESK_SCENES) if (cameras.some(c => (DESK_SEATS[desk] ?? []).includes(c.seat))) return desk;
    return null;
  }
  function activeCamDesk(cameras?: { seat: number }[]): MainKey {
    if (cameras) { const d = deskFromSeats(cameras); if (d) return d; }
    const src = REGISTRY.find(x => x.screen === db.preview.screen);
    if (src && (DESK_SCENES as string[]).includes(src.id)) return src.id as MainKey;
    return 'caster-desk';
  }
  const camEngineFacade = {
    prepare: (presetOrLayout: string | import('../shared/camPresets').DeskCamLayout[]) =>
      camEngines.get(activeCamDesk(Array.isArray(presetOrLayout) ? presetOrLayout : undefined))!.prepare(presetOrLayout as any),
    take: (duration?: number, easing?: string) => camEngines.get(activeCamDesk())!.take(duration, easing as any),
    snap: (presetOrLayout: string | import('../shared/camPresets').DeskCamLayout[]) =>
      camEngines.get(activeCamDesk(Array.isArray(presetOrLayout) ? presetOrLayout : undefined))!.snap(presetOrLayout as any),
    autoPreset: (mode: 'cams' | 'panel', casterCount: number) => camEngines.get(activeCamDesk())!.autoPreset(mode, casterCount),
    savePreset: (name: string, cameras: import('../shared/camPresets').DeskCamLayout[], id?: string) =>
      camEngines.get(activeCamDesk(cameras))!.savePreset(name, cameras, id),
    // Custom preset ids are generated per-engine (not shared across desks): try every desk's engine.
    deletePreset: (id: string) => { for (const eng of camEngines.values()) if (eng.deletePreset(id)) return true; return false; },
  };

  const tw = new Twitch(db.twitch, save, () => pushState(), () => each(c => c.role === 'output' || c.role === 'controller' || c.role === 'crew', { t: 'twitch', tw: tw.pub }));
  // Audience interaction: the vote service is reached in the background; its outages never block this server.
  const aud = new Audience(db.audience, save, () => db.wildcard, () => pushAud());
  // MVP automation trigger: a vote that closed with a frozen result fires "MVP voting closes" once per poll.
  // Polls already closed when the server starts are known, so a restart never fires old ones again.
  let mvpSeen: Set<string> | null = null;
  function mvpClosedCheck() {
    const polls = aud.priv().summary?.polls ?? [];
    const closed = polls.filter(p => (p.status === 'closed' || p.status === 'revealed') && p.frozen).map(p => p.id);
    if (!mvpSeen) { mvpSeen = new Set(closed); return; }
    for (const id of closed) if (!mvpSeen.has(id)) { mvpSeen.add(id); engine?.fire('mvp-closed').catch(e => console.warn('[plan] mvp-closed:', e)); }
  }
  function pushAud() {
    mvpClosedCheck();
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'crew', { t: 'aud', aud: aud.pub() });
    each(c => c.role === 'controller', { t: 'aud-private', aud: audPriv() });
  }
  // Twitch chat MVP voting. The reading account's tokens stay in db.twitchChat (server only): the producer gets
  // chatVoting.status(), which has none; outputs and the public vote page only learn "chat voting on, !vote, channel".
  const audPriv = () => ({ ...aud.priv(), chat: chatVoting.status() });
  let chatPushT: NodeJS.Timeout | null = null, chatRefreshAt = 0;
  const pushChat = () => { if (chatPushT) return; chatPushT = setTimeout(() => { chatPushT = null; each(c => c.role === 'controller', { t: 'aud-private', aud: audPriv() }); }, 250); };
  const twChat = new TwitchChat(db.twitchChat, save, pushChat, m => chatVoting.onMessage(m), { fallbackClientId: () => db.twitch.clientId });
  const chatVoting = new ChatVoting(twChat, {
    // 3.0 rehearsal: real Twitch chat never votes in the demo match
    openPoll: () => (aud.rehearsal ? null : aud.openPoll()), call: (method, path, body) => aud.internal(method, path, body), configured: () => aud.configured, onChange: pushChat,
    // Stored votes: refresh the producer's live totals (at most once a second).
    onStored: () => { const now = Date.now(); if (now - chatRefreshAt < 1000) return; chatRefreshAt = now; aud.tick().catch(() => {}); },
  });
  async function chatOp(op: ChatOp): Promise<string | null> {
    switch (op?.k) {
      case 'client-id': twChat.setClientId(String(op.clientId ?? '')); break;
      case 'connect': await twChat.connect(); break;
      case 'disconnect': twChat.signOut(); break;
      case 'reconnect': twChat.restart(); break;
      case 'clear': chatVoting.clear(); break;
      case 'config': {
        if (!op.patch || typeof op.patch !== 'object') return 'Invalid settings';
        const before = JSON.stringify(chatVoting.methods());
        await twChat.configure(op.patch);
        // Ways to vote changed while a vote is open: tell the vote service now (the website and graphic follow).
        const p = aud.openPoll(), m = chatVoting.methods();
        if (p && JSON.stringify(m) !== before) { try { await aud.internal('POST', `/internal/poll/${encodeURIComponent(p.id)}/methods`, m, 'producer'); await aud.tick(); } catch (e) { return `Saved, but the open vote was not updated: ${(e as Error).message}`; } }
        break;
      }
      default: return 'Unknown Twitch chat command';
    }
    pushChat(); return null;
  }
  aud.chatHooks = {
    methods: () => (aud.rehearsal ? { ...chatVoting.methods(), web: false, chat: false } : chatVoting.methods()),
    beforeClose: poll => chatVoting.beforeClose(poll),
    op: chatOp,
  };
  aud.start();
  chatVoting.start();
  twChat.start().catch(e => console.warn('[twitch-chat]', (e as Error).message));

  // ---------- helpers ----------
  const send = (c: Client | undefined, m: ServerMsg) => {
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  };
  const each = (pred: (c: Client) => boolean, m: ServerMsg) => {
    const data = JSON.stringify(m);
    for (const c of clients.values()) if (pred(c) && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };

  /** 2.0: who publishes the camera of a position: the talent seated there, else a legacy per-slot link. */
  const talentPubs = new Map<string, string>();
  function pubOf(slot: CasterId): string | undefined {
    const t = db.seats[slot as Seat];
    return (t ? talentPubs.get(t) : undefined) ?? publishers.get(slot);
  }
  const seatOfTalent = (id: string): CasterId | null => (seatOf(db.seats, id) as CasterId | null);

  function contributorStatus(slot: CasterId): ContributorStatus {
    const pid = pubOf(slot);
    const p = pid ? clients.get(pid) : undefined;
    let viewers = 0;
    for (const c of clients.values()) if (c.watching.has(slot)) viewers++;
    return { online: !!p, publishing: !!p?.pub?.publishing, hasAudio: !!p?.pub?.hasAudio, label: p?.pub?.label, viewers };
  }

  function controllerState(): ControllerState {
    const routes = new Map<string, number>();
    for (const c of clients.values()) if (c.role === 'output') routes.set(c.route ?? '?', (routes.get(c.route ?? '?') ?? 0) + 1);
    return {
      events: db.events,
      activeEvent: db.activeEvent,
      preview: db.preview,
      live: db.live,
      showPreview: db.showPreview,
      showLive: db.showLive,
      apiToken: db.apiToken,
      crewKey: db.crewKey,
      staffPicks: db.staffPicks,
      lanUrls: lanUrls(),
      ros: db.ros,
      players: db.players,
      stories: db.stories,
      follow: db.follow,
      lastGame,
      liveVersion: db.liveVersion,
      liveAt: db.liveAt,
      instant: db.instant,
      presets: db.presets,
      contributorKeys: db.contributorKeys,
      contributors: Object.fromEntries(CASTER_IDS.map(id => [id, contributorStatus(id)])) as Record<CasterId, ContributorStatus>,
      outputs: [...routes].map(([route, count]) => ({ route, count })).sort((a, b) => a.route.localeCompare(b.route)),
      obs: obs.status,
      obsSetup: obsSetup.state(),
      camEngines: { 'caster-desk': { state: camEngines.get('caster-desk')!.state, presets: camEngines.get('caster-desk')!.presets },
        'analyst-desk': { state: camEngines.get('analyst-desk')!.state, presets: camEngines.get('analyst-desk')!.presets } },
      outputKey: config.outputKey,
      twitch: tw.status,
      engine: engine?.state(),
      talent: db.talent.map(t => { const pid = talentPubs.get(t.id), cl = pid ? clients.get(pid) : undefined; return { ...t, online: !!cl, publishing: !!cl?.pub?.publishing, hasAudio: !!cl?.pub?.hasAudio, seat: seatOfTalent(t.id) }; }),
      seats: db.seats,
      media: db.media,
      studio: db.studio,
      graphics: db.graphics,
      rundown: db.rundown,
      plan: db.plan,
      gfxHealth,
      audio: audioMix?.state(),
    };
  }

  /** Coalesce bursts (typing, ICE churn) into one state push per frame-ish. */
  function pushState() {
    if (stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      each(c => c.role === 'controller', { t: 'state', state: controllerState() });
    }, 30);
  }

  function casterInfo(slot: CasterId): ServerMsg {
    const c = db.live.casters[slot - 1];
    const tile = compose(db.live, undefined, db.showLive.theme).tiles.find(t => t.casterId === slot);
    const vdo = c.source.type === 'vdo' && c.source.vdo ? { id: c.source.vdo, password: db.showLive.vdo.password, room: db.showLive.vdo.room } : null;
    return { t: 'caster-info', camQuality: c.source.quality ?? '720p', name: c.name, role: c.role, cameraVisible: !!tile && tile.kind === 'video' && (c.source.type === 'webrtc' || !!vdo), vdo, talent: db.live.casters.filter(x => x.enabled).map(x => ({ id: x.id, name: x.name })) };
  }

  const liveMsg = (): ServerMsg => ({ t: 'live', scene: db.live, show: db.showLive, version: db.liveVersion, now: Date.now(), transition: db.liveTransition });
  let engine: Engine | null = null;

  function broadcastLive() {
    db.liveVersion++;
    db.liveAt = Date.now();
    save();
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'crew' || c.role === 'admin', liveMsg());
    pushState();
  }

  /** TAKE: atomically copy the whole preview (scene + show data) to program. */
  /**
   * THE single place a Program screen change is aired. Exactly one party plays the transition:
   * - OBS connected and the new screen has an OBS scene → OBS performs the transition (its stinger /
   *   fade / cut) and the browser Program source just cuts (its scenes use /output/screen/* anyway).
   * - otherwise → /output/program plays it, OBS is not touched.
   * No screen change → no transition at all (overlay/flag changes just update).
   */
  function airProgram(prevScreen: ScreenId, t: TransitionKind) {
    const changed = prevScreen !== db.live.screen;
    const obsScene = changed ? db.showLive.obsScenes[db.live.screen] : undefined;
    const obsOwns = !!obsScene && obs.status.connected;
    db.liveTransition = !changed ? undefined : obsOwns ? 'cut' : t;
    broadcastLive();
    db.liveTransition = undefined;
    if (!obsOwns) return;
    // 3.2 main-scenes layout: the screen's output is a layer of the main scene: show it first
    const src = REGISTRY.find(x => x.screen === db.live.screen);
    const gfxId = db.graphics.find(g => { const p = pkgById(g.pkg); return !!p && p.id.replace(/^od\./, '') === g.id && p.obsKey === db.live.screen; })?.id;
    const target = [gfxId ? `g:${gfxId}` : '', src ? `s:${src.id}` : ''].find(x => x && obsSetup.layerOf(x)?.scene === obsScene);
    if (!target) { obs.setScene(obsScene!, t); return; }
    void (async () => { await obsSetup.layer(target, true); if (obs.status.currentScene !== obsScene) obs.setScene(obsScene!, t); })();
  }

  function goLive(t: TransitionKind = 'stinger') {
    const sceneChanged = !sameScene(db.live, db.preview);
    const showChanged = JSON.stringify(db.showLive) !== JSON.stringify(db.showPreview);
    if (!sceneChanged && !showChanged) return;
    const prevScreen = db.live.screen;
    db.live = clone(db.preview);
    db.showLive = clone(db.showPreview);
    airProgram(prevScreen, t);
    // Every open caster page (also VDO.Ninja casters, who never start this app's camera).
    for (const v of clients.values()) if (v.role === 'contributor' && v.slot) send(v, casterInfo(v.slot));
    if (sceneChanged) obs.apply(db.live, db.showLive.theme);
  }

  function pushRos() {
    save();
    each(c => c.role === 'controller' || c.role === 'contributor' || c.role === 'crew', { t: 'ros', ros: db.ros, now: Date.now() });
  }

  function matchDataMsg(): ServerMsg {
    return { t: 'match-data', names: Object.fromEntries(db.players.map(p => [p.id, p.name])),
      sheet: db.sheet,
      info: Object.fromEntries(db.players.map(p => [p.id, { name: p.name, vdo: p.vdo, input: p.input, style: p.style, age: p.age, funFact: p.funFact, rival: p.rival, photo: p.photo }])) };
  }
  function pushMatchData() {
    save();
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'admin' || c.role === 'crew', matchDataMsg());
  }

  let sheetBusy = false, sheetAt = 0, wcForceNext = false;
  /** Pull the sheet. `wcForce`: overwrite every wildcard score with the sheet's (controller "Pull from sheet now"). */
  async function sheetNow(wcForce = false) {
    if (sheetBusy) { if (wcForce) wcForceNext = true; return; }
    sheetBusy = true;
    sheetAt = Date.now();
    const before = JSON.stringify([db.showLive.teamA, db.showLive.teamB, db.showLive.bestOf]);
    try { await syncSheet(); } finally { sheetBusy = false; }
    if (JSON.stringify([db.showLive.teamA, db.showLive.teamB, db.showLive.bestOf]) !== before) broadcastLive();
    const force = wcForce || wcForceNext;
    wcForceNext = false;
    if (!db.sheet.error && (db.wildcard.sheetAuto || force) && mergeSheet(db.wildcard, wcSheetRows(), force)) wcChanged();
    pushMatchData();
    pushState();
  }
  // Every 60 s, or every 30 s while the wildcard bracket takes its scores from the sheet (as the standalone overlay did).
  setInterval(() => {
    if (!db.sheet.enabled || !db.sheet.id) return;
    if ((db.wildcard.enabled && db.wildcard.sheetAuto) || Date.now() - sheetAt >= 59_000) sheetNow();
  }, 30_000);

  // ---------- OverDrive Wildcard bracket ----------
  // Results are facts: every change goes out at once (no TAKE), like the tournament admin.
  let wcSnap = wcSnapshot(db.wildcard);
  let wcSeq = 0;
  let wcLastPop: WcPop | null = null;
  let wcLastRotate = Date.now();
  // Contributors (casters' camera pages) get it too: they enter their match prediction there.
  const wcAudience = (c: Client) => c.role === 'output' || c.role === 'controller' || c.role === 'crew' || c.role === 'contributor';
  const wcMsg = (): ServerMsg => ({ t: 'wildcard', wc: db.wildcard });

  function wcSheetRows(): WcSheetRow[] {
    return db.sheet.matches.filter(m => isWcId(m.bracket)).map(m => ({ bracket: m.bracket, s1: m.s1, s2: m.s2, status: m.status, when: m.when ?? '' }));
  }

  function wcPop(p: Omit<WcPop, 'seq'>) {
    const pop: WcPop = { ...p, seq: ++wcSeq };
    wcLastPop = pop;
    each(wcAudience, { t: 'wc-pop', pop });
  }

  /** After any change: result order, popups for new map/match wins (detected once, here), push to every source. */
  /**
   * The cast match is the one source of "who's playing": its teams, logos and series score go to the
   * scoreboard (both shows), and its teams to the match intro / predictions (unless the intro is playing).
   * Returns true if the shows changed.
   */
  function castSync(): boolean {
    const wc = db.wildcard;
    if (!wc.cast) return false;
    const r = wcResolve(wc.matches, wc.teams)[wc.cast], st = wc.matches[wc.cast];
    if (!realTeam(r.t1) || !realTeam(r.t2)) return false;
    const n = (v: string) => (/^\d+$/.test(v) ? Number(v) : 0);
    const tag = (x: string) => x.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
    let changed = false;
    for (const show of [db.showLive, db.showPreview]) {
      const A = { ...show.teamA, name: r.t1, tag: show.teamA.name === r.t1 ? show.teamA.tag : tag(r.t1), logo: wcLogo(r.t1) || show.teamA.logo, score: n(st.s1) };
      const B = { ...show.teamB, name: r.t2, tag: show.teamB.name === r.t2 ? show.teamB.tag : tag(r.t2), logo: wcLogo(r.t2) || show.teamB.logo, score: n(st.s2) };
      const game = Math.max(1, Math.min(9, n(st.s1) + n(st.s2) + (r.winner ? 0 : 1)));
      if (JSON.stringify([show.teamA, show.teamB, show.bestOf, show.game]) !== JSON.stringify([A, B, 5, game])) {
        show.teamA = A; show.teamB = B; show.bestOf = 5; show.game = game; changed = true;
      }
    }
    const it = wc.intro;
    if (!it.at && (it.a !== r.t1 || it.b !== r.t2)) {
      wc.intro = { ...it, a: r.t1, b: r.t2, picks: {}, label: matchName(wc.cast), roadA: seasonOf(r.t1)?.road ?? '', roadB: seasonOf(r.t2)?.road ?? '' };
      wc.veto = { ...wc.veto, done: [], at: null, pb: { map: null, at: null } }; // a new match starts a new veto
    }
    return changed;
  }

  /** Pick'em: when the cast match has a winner, keep that match's picks (once) so they can be scored. */
  function pickemArchive() {
    const wc = db.wildcard, id = wc.cast;
    if (!id || wc.pickem[id] || !Object.keys(wc.intro.picks).length) return;
    const r = wcResolve(wc.matches, wc.teams)[id];
    if (r.winner && wc.intro.a === r.t1 && wc.intro.b === r.t2) wc.pickem = { ...wc.pickem, [id]: { ...wc.intro.picks } };
  }

  /** "Match ends" automation trigger: a match gets its result (once per match; results known at start never fire). */
  let resultsSeen: Set<string> | null = null;
  function matchEndCheck() {
    const R = wcResolve(db.wildcard.matches, db.wildcard.teams);
    const done = WC_IDS.filter(id => R[id].winner && R[id].winner !== 'BYE' && R[id].t1 !== 'BYE' && R[id].t2 !== 'BYE');
    if (!resultsSeen) { resultsSeen = new Set(done); return; }
    const fresh = done.filter(id => !resultsSeen!.has(id)).sort((a, b) => (db.wildcard.done[a] ?? 0) - (db.wildcard.done[b] ?? 0));
    for (const id of fresh) {
      resultsSeen.add(id);
      // 3.0: the MVP of that match is prepared FIRST, so the "Match ends" automation finds a vote to open
      mvpChain = mvpChain.then(() => mvpMatchEnded(id)).catch(e => console.warn('[mvp] match end:', e))
        .then(() => engine?.fire('match-end')).catch(e => console.warn('[plan] match-end:', e));
    }
    for (const id of [...resultsSeen]) if (!done.includes(id)) resultsSeen.delete(id); // a corrected result can end again
  }
  matchEndCheck(); // results already known at start are never "new"

  // ---------- 3.1 Track Progression (round-by-round story of the current track) ----------
  function trackOp(op: TrackOp) {
    const t = db.wildcard.track;
    if (op.k === 'track-load') { void trackLoad(true); return; }
    const e = applyTrackOp(t, op, Date.now());
    if (e) t.error = e; else if (op.k !== 'track-src') t.error = '';
    wcChanged(false);
    if (op.k === 'track-src' && t.src.mode === 'sheet' && !e) void trackLoad(true);
  }
  let trackBusy = false;
  /** Read the track rows from the sheet; only a real change is pushed (auto refresh every 8 s stays quiet). */
  async function trackLoad(force = false) {
    const t = db.wildcard.track;
    if (t.src.mode !== 'sheet' || trackBusy) return;
    trackBusy = true;
    try {
      const d = parseTrackRows(parseCsv(await sheetGet(trackSheetUrl(t.src.sheetId || TRACK_DEFAULT_SHEET, t.src))));
      const cur = db.wildcard.track; // the event may have changed while loading
      if (cur !== t || cur.src.mode !== 'sheet') return;
      if (force || t.demo || t.error || JSON.stringify(d) !== JSON.stringify(t.data)) { t.data = d; t.demo = false; t.error = ''; t.at = Date.now(); wcChanged(false); }
    } catch (e: any) {
      const msg = `Sheet: ${e?.message ?? e}`;
      if (db.wildcard.track === t && t.error !== msg) { t.error = msg; wcChanged(false); }
    } finally { trackBusy = false; }
  }

  function wcChanged(popups = true) {
    pickemArchive();
    updateDone(db.wildcard); // before the match-end check: the MVP orders new results by when they came in
    matchEndCheck();
    if (castSync()) broadcastLive();
    const snap = wcSnapshot(db.wildcard);
    // No popup for the match on stream: viewers are watching it (the scoreboard already shows its score).
    if (popups) for (const e of diffEvents(wcSnap, snap)) if (e.id !== db.wildcard.cast) wcPop(e);
    wcSnap = snap;
    db.wildcard.rev = Date.now();
    save();
    each(wcAudience, wcMsg());
  }

  function wcOp(op: WcOp) {
    if (!op || typeof op !== 'object') return;
    if (typeof op.k === 'string' && op.k.startsWith('track-')) return trackOp(op as TrackOp);
    const wc = db.wildcard;
    switch (op.k) {
      case 'score': case 'wo': case 'clear': case 'live': case 'time':
        if (applyMatchOp(wc, op)) wcChanged();
        return;
      // Champions only once the Grand final has a winner (else it would pop up by itself when the final ends).
      case 'champ': wc.champ = op.on === true && !!wcResolve(wc.matches, wc.teams)[GRAND_FINAL].winner; break;
      case 'veto': wc.veto = vetoApply(wc.veto, op.map, Date.now()); break;
      case 'pb': {
        if (!isMapId(op.map) || typeof op.team !== 'string' || !op.team) return;
        const forMap = { ...(wc.pbs[op.map] ?? {}) };
        const pb = sanitizePb(op.pb);
        if (pb) forMap[op.team] = pb; else delete forMap[op.team];
        wc.pbs = { ...wc.pbs, [op.map]: forMap };
        break;
      }
      case 'pb-show': wc.veto = { ...wc.veto, pb: { map: isMapId(op.map) ? op.map : null, at: isMapId(op.map) ? Date.now() : null } }; break;
      case 'veto-undo': {
        // Undo the decider together with the step that filled it in.
        let done = wc.veto.done.slice(0, -1);
        if (wc.veto.order[wc.veto.done.length - 1]?.by === 'd' && done.length) done = done.slice(0, -1);
        wc.veto = { ...wc.veto, done, at: null };
        break;
      }
      case 'veto-reset': wc.veto = { ...wc.veto, done: [], at: null, pb: { map: null, at: null } }; break;
      case 'veto-order': wc.veto = sanitizeVeto({ order: op.order, done: [], at: null }); break;
      case 'interview': wc.interview = sanitizeInterview({ ...wc.interview, ...op.patch }); break;
      case 'pickem-reset': wc.pickem = {}; break;
      case 'booth': wc.booth = sanitizeWildcard({ ...wc, booth: op.slots }).booth; break;
      case 'map-next': {
        // The veto decides which map comes next: series map number = games played + 1 (castSync's show.game).
        const id = vetoMapFor(wc, db.showLive.game || 1);
        if (!id) return;
        return wcOp({ k: 'map', id });
      }
      case 'map': {
        // Plays the map card on the gameplay screen and names the map on the scoreboard.
        const mp = majorMap(op.id);
        wc.map = { id: mp ? mp.id : null, at: mp ? Date.now() : null };
        for (const show of [db.showLive, db.showPreview]) show.mapName = mp ? mp.country : '';
        broadcastLive();
        break;
      }
      case 'map-photo': {
        if (!majorMap(op.id)) return;
        const ph = { ...wc.mapPhotos };
        if (op.url) { ph[op.id] = op.url; tag(op.url, 'map', op.id); } else delete ph[op.id];
        wc.mapPhotos = sanitizeWildcard({ ...wc, mapPhotos: ph }).mapPhotos;
        break;
      }
      case 'teams': wc.teams = sanitizeWildcard({ ...wc, teams: op.teams }).teams; wcChanged(); return;
      case 'air': wc.air = op.part === 2 ? 2 : 1; wcLastRotate = Date.now(); break;
      case 'cue': if (wc.cue === (op.part === 2 ? 2 : 1)) return; wc.cue = op.part === 2 ? 2 : 1; break; // Preview only: Program untouched
      case 'take': if (wc.air === wc.cue) return; wc.air = wc.cue; wcLastRotate = Date.now(); break; // a repeated TAKE is a no-op
      case 'page-reset': wc.air = 1; wc.cue = 1; wcLastRotate = Date.now(); break;
      case 'opts':
        wc.opts = sanitizeWildcard({ ...wc, opts: { ...wc.opts, ...(op.patch ?? {}) } }).opts;
        if (op.patch && 'rotate' in op.patch) wcLastRotate = Date.now();
        break;
      case 'enabled': wc.enabled = op.on === true; break;
      case 'cast': {
        wc.cast = isWcId(op.id) ? op.id : null;
        // The cast match is the scoreboard's featured match too (names, logos, series score from the sheet).
        const m = wc.cast ? db.sheet.matches.find(x => x.bracket === wc.cast) : undefined;
        const cur = db.sheet.matches.find(x => x.id === db.sheet.featured);
        if (m || (!wc.cast && cur && isWcId(cur.bracket))) {
          db.sheet.featured = m ? m.id : null;
          applyFeatured();
          broadcastLive();
          pushMatchData();
        }
        break;
      }
      case 'sheet-auto': wc.sheetAuto = op.on === true; if (wc.sheetAuto && db.sheet.id) sheetNow(); break;
      case 'pull': sheetNow(true); return;
      case 'reset':
        for (const id of WC_IDS) { const m = wc.matches[id]; m.s1 = m.s2 = ''; m.live = false; }
        wcSnap = wcSnapshot(wc);
        break;
      case 'restore': {
        // Accepts a backup from this controller or from the old standalone overlay ("Copy backup").
        if (!isWcBackup(op.data)) return;
        const d = op.data as any;
        const next = sanitizeWildcard({ ...wc, matches: d.matches, opts: { ...wc.opts, ...(d.opts ?? {}) }, air: d.air ?? wc.air, cast: d.cast ?? wc.cast }, wc.enabled);
        db.wildcard = { ...next, sheetAuto: wc.sheetAuto, sheetSeen: wc.sheetSeen, showcase: wc.showcase, intro: wc.intro, done: {} };
        wcSnap = wcSnapshot(db.wildcard); // restored results are not news: no popups
        break;
      }
      case 'test': wcPop(demoEvent(wc, op.kind === 'match' ? 'match' : 'map')); return;
      case 'replay': if (wcLastPop) wcPop(wcLastPop); return;
      case 'showcase': wc.showcase = sanitizeShowcase({ ...wc.showcase, ...(op.patch ?? {}), photos: wc.showcase.photos, frames: wc.showcase.frames }); break;
      case 'photo-frame': {
        const key = String(op.player ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key) return;
        wc.showcase = sanitizeShowcase({ ...wc.showcase, frames: { ...wc.showcase.frames, [key]: op.frame ?? undefined } });
        break;
      }
      case 'intro': {
        const next = sanitizeIntro({ ...wc.intro, ...(op.patch ?? {}), picks: wc.intro.picks, at: wc.intro.at });
        // New teams: the predictions were for the old match.
        if (next.a !== wc.intro.a || next.b !== wc.intro.b) { next.picks = {}; next.picksLocked = false; }
        wc.intro = next;
        break;
      }
      case 'pick': {
        if (!isSlot(op.slot)) return;
        const p = sanitizePick(op.pick, [wc.intro.a, wc.intro.b].filter(Boolean));
        const picks = { ...wc.intro.picks };
        if (p) picks[String(op.slot)] = p; else delete picks[String(op.slot)];
        wc.intro = { ...wc.intro, picks };
        break;
      }
      case 'desk': wc.desk = sanitizeWildcard({ ...wc, desk: { panel: op.panel ?? wc.desk.panel, player: op.player === undefined ? wc.desk.player : op.player, slots: op.slots ?? wc.desk.slots, guest: op.guest === undefined ? wc.desk.guest : op.guest, strip: op.strip ?? wc.desk.strip, clock: op.clock ?? wc.desk.clock } }).desk; break;
      case 'intro-play':
        if (!wc.intro.a || !wc.intro.b) return;
        wc.intro = { ...wc.intro, at: Date.now() };
        wcChanged(false);
        act({ t: 'screen', screen: 'warmup', take: true }); // the intro plays on the Warm-up screen: cut to it
        return;
      case 'intro-stop': wc.intro = { ...wc.intro, at: null }; break;
      case 'roster': {
        const team = String(op.team ?? '').trim();
        if (!team) return;
        const next = { ...wc.rosters };
        if (Array.isArray(op.players) && op.players.some(h => String(h ?? '').trim())) next[team] = op.players.map(String); else delete next[team];
        wc.rosters = sanitizeRosters(next);
        wcChanged(false);
        mvpRosterChanged(team);
        return;
      }
      case 'photo': {
        const key = String(op.player ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key) return;
        const photos = { ...wc.showcase.photos };
        if (op.url) { photos[key] = op.url; tag(op.url, 'portrait', playerIdOf(key)); } else delete photos[key];
        wc.showcase = sanitizeShowcase({ ...wc.showcase, photos });
        break;
      }
      default: return;
    }
    wcChanged(false);
  }

  // Auto switch between Part 1 and Part 2, run here so every source flips together.
  setInterval(() => {
    const o = db.wildcard.opts;
    if (o.rotate && Date.now() - wcLastRotate >= Math.max(5, o.rotateSec) * 1000) {
      db.wildcard.air = db.wildcard.air === 1 ? 2 : 1;
      wcLastRotate = Date.now();
      wcChanged(false);
    }
  }, 500);

  function switchToEvent(id: string, opts: { obs?: boolean } = {}) {
    if (id === db.activeEvent || !db.events.some(e => e.id === id)) return pushState();
    db.audience.mvpMatch = mvpMatchNow(); // this event's MVP match, back when it is active again
    if (!switchEvent(id)) return pushState();
    aud.swap(db.audience); // 3.0: this event's votes, MVP choices and analyst picks (never another event's)
    mvpFollowEvent();
    broadcastLive();
    pushRos();
    pushMatchData();
    wcSnap = wcSnapshot(db.wildcard);
    resultsSeen = null; matchEndCheck(); // another event: its results are not "new"
    each(wcAudience, wcMsg());
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'admin' || c.role === 'crew', { t: 'tournament', tournament: db.tournament });
    obs.apply(db.live, db.showLive.theme);
    const sc = db.showLive.obsScenes[db.live.screen];
    if (sc && opts.obs !== false) obs.setScene(sc); // the rehearsal never switches OBS by itself
    if (db.sheet.enabled && db.sheet.id) sheetNow();
  }

  /** Tournament edits are facts (results), so they publish immediately. */
  function tournamentOp(op: TournamentOp) {
    if (!op || typeof op !== 'object') return;
    db.tournament = applyOp(db.tournament, op);
    save();
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'admin' || c.role === 'crew', { t: 'tournament', tournament: db.tournament });
    syncFeatured();
  }

  /** Featured bracket match → scoreboard teams, scores, BO and stage on every graphic. */
  function syncFeatured() {
    const t = db.tournament;
    const m = t.featured ? t.matches.find(x => x.id === t.featured) : undefined;
    if (!m) return;
    const r = resolve(t).get(m.id)!;
    const before = JSON.stringify([db.showPreview, db.showLive]);
    for (const show of [db.showPreview, db.showLive]) {
      if (isTeam(r.a)) Object.assign(show.teamA, { name: r.a.name, tag: r.a.tag, logo: r.a.logo });
      if (isTeam(r.b)) Object.assign(show.teamB, { name: r.b.name, tag: r.b.tag, logo: r.b.logo });
      show.teamA.score = m.scoreA;
      show.teamB.score = m.scoreB;
      show.bestOf = m.bestOf;
      show.game = Math.min(m.bestOf, m.status === 'done' ? m.scoreA + m.scoreB : m.scoreA + m.scoreB + 1) || 1;
      show.stage = m.label.toUpperCase();
      show.tournament = t.name;
    }
    if (JSON.stringify([db.showPreview, db.showLive]) !== before) broadcastLive();
  }

  /** Quick ops hit preview and program at once: scores and timers can't wait for a TAKE. */
  let spotTimer: NodeJS.Timeout | null = null;
  let lastGame: ControllerState['lastGame'] = null;
  let followTimer: NodeJS.Timeout | null = null;

  /** Called by the Openplanet plugin (or anything else) with the game's spectator target. */
  function spectate(name: string, login: string) {
    const p = name || login ? matchPlayer(db.players, name, login) : null;
    lastGame = { name, login, at: Date.now(), matched: p?.id ?? null };
    pushState();
    if (!db.follow.enabled) return;
    if (!p && (db.follow.keepLast || name)) return; // unknown player / free cam: keep the current cam
    if (followTimer) clearTimeout(followTimer);
    followTimer = setTimeout(() => {
      followTimer = null;
      if ((db.showLive.activePlayer?.id ?? null) !== (p?.id ?? null)) quick({ k: 'active-player', id: p?.id ?? null, via: 'game' });
    }, db.follow.delayMs);
  }

  function quick(op: QuickOp) {
    let spot: Show['spotlight'] | undefined;
    if (op.k === 'spotlight') {
      const until = typeof op.seconds === 'number' && op.seconds > 0 ? Date.now() + Math.min(600, op.seconds) * 1000 : null;
      if (op.kind === 'player') {
        const p = db.players.find(x => x.id === op.id);
        if (!p) return;
        spot = { kind: 'player', id: p.id, until, at: Date.now(), data: { name: p.name, input: p.input, style: p.style, age: p.age, favPlayer: p.favPlayer, funFact: p.funFact, rival: p.rival, photo: p.photo } };
      } else {
        const s = db.stories.find(x => x.id === op.id);
        if (!s) return;
        spot = { kind: 'story', id: s.id, until, at: Date.now(), data: { label: STORY_LABELS[s.kind], title: s.title, text: s.text } };
      }
      if (spotTimer) clearTimeout(spotTimer);
      if (until) {
        const at = spot.at;
        spotTimer = setTimeout(() => { if (db.showLive.spotlight?.at === at) quick({ k: 'spotlight-hide' }); }, until - Date.now());
      }
    }
    for (const show of [db.showPreview, db.showLive]) {
      switch (op.k) {
        case 'score': {
          const t = op.team === 'A' ? show.teamA : show.teamB;
          const v = typeof op.value === 'number' ? op.value : t.score + (op.delta ?? 1);
          t.score = Math.max(0, Math.min(99, Math.round(v)));
          break;
        }
        case 'swap': [show.teamA, show.teamB] = [show.teamB, show.teamA]; break;
        case 'reset-scores': show.teamA.score = 0; show.teamB.score = 0; show.game = 1; break;
        case 'game': show.game = Math.max(1, Math.min(9, Math.round(op.value))); break;
        case 'timer-start': show.timer.target = Date.now() + Math.max(0, Math.min(600, op.minutes)) * 60_000; break;
        case 'timer-add': show.timer.target = Math.max(Date.now(), show.timer.target ?? Date.now()) + op.minutes * 60_000; break;
        case 'timer-until': show.timer.target = Number.isFinite(op.target) ? op.target : null; break;
        case 'timer-stop': show.timer.target = null; break;
        case 'spotlight': show.spotlight = spot ?? null; break;
        case 'music': show.music = sanitizeShow({ ...show, music: { ...show.music, ...(op.patch ?? {}) } }).music; break;
        case 'next-match': show.nextMatch = sanitizeShow({ ...show, nextMatch: { ...show.nextMatch, ...(op.patch ?? {}) } }).nextMatch; break;
        case 'lineup': show.lineup = op.ids.map(id => db.players.find(x => x.id === id)).filter(Boolean).slice(0, 32).map(x => ({ id: x!.id, vdo: x!.vdo })); break;
        case 'spotlight-hide': show.spotlight = null; break;
        case 'matchup-casters': show.showMatchupOnCasters = op.on === true; break;
        case 'flag': {
          const on = op.on === true;
          if (op.key === 'scoreboard') show.showScoreboard = on;
          else if (op.key === 'ticker') show.ticker.onScreens = on;
          else if (op.key === 'gameplay-ticker') show.gameplay.ticker = on;
          else if (op.key === 'gameplay-cams') show.gameplay.cams = on;
          break;
        }
        case 'active-player': {
          const p = op.id ? db.players.find(x => x.id === op.id) : undefined;
          show.activePlayer = p ? { id: p.id, name: p.name, tag: p.input, vdo: p.vdo, at: Date.now(), via: op.via === 'game' ? 'game' : 'manual' } : null;
          if (p && !show.lineup.some(l => l.id === p.id)) show.lineup = [...show.lineup, { id: p.id, vdo: p.vdo }].slice(-32);
          break;
        }
      }
    }
    broadcastLive();
    const f = db.tournament.featured;
    if (f && op.k === 'swap') tournamentOp({ k: 'feature', id: null }); // sides no longer match the bracket
    else if (f && (op.k === 'score' || op.k === 'reset-scores')) {
      tournamentOp({ k: 'match', id: f, patch: { scoreA: db.showLive.teamA.score, scoreB: db.showLive.teamB.score } });
    }
  }

  // ---------- WebRTC signaling ----------
  function watch(c: Client, req: WatchRequest) {
    const prev = c.watching.get(req.slot);
    if (prev && prev.quality === req.quality && prev.video === req.video && prev.audio === req.audio) return;
    c.watching.set(req.slot, req);
    const pid = pubOf(req.slot);
    if (pid) send(clients.get(pid), { t: 'rtc-viewer-join', viewerId: c.id, req });
    send(c, { t: 'rtc-publisher', slot: req.slot, online: !!pid });
    pushState();
  }

  function unwatch(c: Client, slot: CasterId) {
    if (!c.watching.delete(slot)) return;
    const pid = pubOf(slot);
    if (pid) send(clients.get(pid), { t: 'rtc-viewer-leave', viewerId: c.id });
    pushState();
  }

  function registerPublisher(c: Client, slot: CasterId) {
    const old = publishers.get(slot);
    if (old && old !== c.id) {
      const o = clients.get(old);
      send(o, { t: 'error', code: 'replaced', message: 'Another device took over this camera slot.' });
      o?.ws.close(4001, 'replaced');
    }
    publishers.set(slot, c.id);
    for (const v of clients.values()) {
      const req = v.watching.get(slot);
      if (req) {
        send(c, { t: 'rtc-viewer-join', viewerId: v.id, req });
        send(v, { t: 'rtc-publisher', slot, online: true });
      }
    }
    send(c, casterInfo(slot));
    pushState();
  }

  /** What a talent's own page shows: name, current position, on-air tally, their VDO push id (only to them). */
  function talentInfo(id: string): ServerMsg {
    const t = db.talent.find(p => p.id === id)!;
    const seat = seatOfTalent(id);
    const base = seat ? (casterInfo(seat) as Extract<ServerMsg, { t: 'caster-info' }>) : null;
    const vdo = t.mode === 'vdo' ? { id: t.vdoId, password: db.showLive.vdo.password, room: db.showLive.vdo.room } : null;
    return { t: 'caster-info', camQuality: t.camQuality, name: talentLabel(t), role: seat ? SEAT_LABELS[seat as Seat] : 'Not in a position', cameraVisible: !!base?.cameraVisible, vdo, talent: base?.talent ?? [], seat };
  }
  const sendTalentInfo = (id: string) => { const pid = talentPubs.get(id); if (pid) send(clients.get(pid), talentInfo(id)); };

  function registerTalent(c: Client) {
    const id = c.talent!;
    const old = talentPubs.get(id);
    if (old && old !== c.id) {
      const o = clients.get(old);
      send(o, { t: 'error', code: 'replaced', message: 'This link was opened on another device.' });
      o?.ws.close(4001, 'replaced');
    }
    talentPubs.set(id, c.id);
    const seat = seatOfTalent(id);
    if (seat) for (const v of clients.values()) {
      const req = v.watching.get(seat);
      if (req && pubOf(seat) === c.id) { send(c, { t: 'rtc-viewer-join', viewerId: v.id, req }); send(v, { t: 'rtc-publisher', slot: seat, online: true }); }
    }
    send(c, talentInfo(id));
    pushState();
  }

  /** Re-point every viewer of a position from one publisher to another (no reconnection for the talent). */
  function reroute(seat: CasterId, oldPid: string | undefined) {
    const nextPid = pubOf(seat);
    if (oldPid === nextPid) return;
    for (const v of clients.values()) {
      const req = v.watching.get(seat);
      if (!req) continue;
      if (oldPid) send(clients.get(oldPid), { t: 'rtc-viewer-leave', viewerId: v.id });
      if (nextPid) send(clients.get(nextPid), { t: 'rtc-viewer-join', viewerId: v.id, req });
      else send(v, { t: 'rtc-publisher', slot: seat, online: false });
    }
  }

  /** Name and camera source of a position follow the talent seated there (both Preview and live). */
  function applySeat(seat: Seat) {
    const t = db.talent.find(p => p.id === db.seats[seat]);
    const fix = (sc: Scene): Scene => ({ ...sc, casters: sc.casters.map(c => {
      if (c.id !== seat) return c;
      const base = c.source.type === 'webrtc' || c.source.type === 'vdo' ? { ...c.source, type: (t?.mode === 'vdo' ? 'vdo' : 'webrtc') as typeof c.source.type, vdo: t?.mode === 'vdo' ? t.vdoId : c.source.vdo } : c.source;
      const { quality: _q, crop: _c, audioOff: _a, ...rest } = base;
      const cam = base.type === 'webrtc' || base.type === 'vdo';
      const framed = t && (t.crop.zoom !== 1 || t.crop.x || t.crop.y) ? { crop: t.crop } : {};
      const src = { ...rest, ...(t?.camQuality === '1080p' && cam ? { quality: '1080p' as const } : {}), ...framed, ...(t && t.audio.source !== 'feed' ? { audioOff: true } : {}) };
      // A seated talent is in the show (their camera is requested by every source); an empty position is not.
      return { ...c, enabled: !!t, name: t ? talentLabel(t) : DEFAULT_SEAT_NAMES[seat], source: src };
    }) });
    db.preview = fix(db.preview); db.live = fix(db.live);
  }

  function setSeat(seatN: number, talent: string | null): string | null {
    if (!(SEATS as readonly number[]).includes(seatN)) return 'Unknown position';
    const seat = seatN as Seat;
    if (talent != null && !db.talent.some(p => p.id === talent)) return 'Unknown talent';
    if (db.seats[seat] === talent) return null;
    const from = talent ? seatOfTalent(talent) : null; // moving someone who already has a position = swap
    const affected: Seat[] = [seat, ...(from ? [from as Seat] : [])];
    const before = new Map(affected.map(s => [s, pubOf(s as CasterId)]));
    const prevInSeat = db.seats[seat];
    db.seats = { ...db.seats, [seat]: talent, ...(from ? { [from]: prevInSeat } : {}) };
    for (const s of affected) { applySeat(s); reroute(s as CasterId, before.get(s)); }
    for (const id of [talent, prevInSeat]) if (id) sendTalentInfo(id);
    save();
    broadcastLive(); // names / sources on every source (same screen: no transition)
    void audioMix?.sync('seat'); // the voice follows the person to their new position's audio source
    return null;
  }

  function editTalent(id: string, patch: TalentPatch): string | null {
    const i = db.talent.findIndex(p => p.id === id);
    if (i < 0) return 'Unknown talent';
    const t = { ...db.talent[i] };
    if (typeof patch.name === 'string') t.name = patch.name.trim().slice(0, 40);
    if (patch.role && TALENT_ROLES.some(r => r.id === patch.role)) t.role = patch.role;
    if (typeof patch.photo === 'string') { const ph = patch.photo.trim(); if (ph && !/^(\/|https?:\/\/)[^\s"'<>]{0,400}$/.test(ph)) return 'Picture: use an uploaded asset or an http(s) address'; t.photo = ph; }
    if (typeof patch.ready === 'boolean') t.ready = patch.ready;
    if (typeof patch.notes === 'string') t.notes = patch.notes.slice(0, 500);
    if (patch.audio && typeof patch.audio === 'object') {
      const a = sanitizeAudio({ ...t.audio, ...patch.audio });
      if (a.source === 'obs' && !a.input.trim()) return 'Choose the OBS audio input this person is heard through';
      t.audio = a;
    }
    if (patch.crop && typeof patch.crop === 'object') t.crop = sanitizeCrop({ ...t.crop, ...patch.crop });
    if (patch.mode === 'webrtc' || patch.mode === 'vdo') t.mode = patch.mode;
    if (patch.camQuality === '720p' || patch.camQuality === '1080p') t.camQuality = patch.camQuality;
    if (typeof patch.vdoId === 'string') {
      // A pasted VDO.Ninja link (or bare stream ID): their camera comes from that stream from now on.
      const v = parseVdoId(patch.vdoId);
      if (!v) return 'Not a VDO.Ninja link or stream ID (it needs push=… or view=…)';
      if (db.talent.some((p, j) => j !== i && p.vdoId === v)) return 'Another talent already uses this VDO.Ninja stream';
      t.vdoId = v; t.mode = 'vdo'; t.vdoSet = true;
    }
    const audioChanged = JSON.stringify(t.audio) !== JSON.stringify(db.talent[i].audio);
    db.talent = db.talent.map((p, j) => (j === i ? t : p));
    const seat = seatOfTalent(id);
    if (seat) { const before = pubOf(seat); applySeat(seat as Seat); reroute(seat, before); broadcastLive(); }
    sendTalentInfo(id);
    save();
    if (audioChanged || patch.mode) void audioMix?.sync('talent edit');
    pushState();
    return null;
  }

  /** 3.0 Add Talent: the first unused profile (else a new one, up to TALENT_MAX) with name, role, camera and position. */
  function addTalent(a: { name: string; role?: TalentRole; vdo?: string; seat?: number | null; mode?: 'webrtc' | 'vdo' }): { id: string } | { error: string } {
    const name = a.name.trim().slice(0, 40);
    if (!name) return { error: 'Type the person\'s name' };
    if (db.talent.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) return { error: `${name} already has a profile: edit it instead of adding a second one` };
    let vdo: string | null = null;
    if (a.vdo && a.vdo.trim()) {
      const info = describeVdoLink(a.vdo);
      if (!info.ok) return { error: info.problem ?? 'Not a VDO.Ninja link' };
      vdo = info.id;
      const other = db.talent.find(p => p.vdoSet && p.vdoId === vdo);
      if (other) return { error: `This VDO.Ninja stream is already ${talentLabel(other)}'s camera` };
    }
    if (a.seat != null && !(SEATS as readonly number[]).includes(a.seat)) return { error: 'Unknown position' };
    if (a.seat != null && db.seats[a.seat as Seat]) return { error: `${SEAT_LABELS[a.seat as Seat]} is taken by ${talentLabel(db.talent.find(p => p.id === db.seats[a.seat as Seat]))}: free it or pick another position` };
    let p = db.talent.find(x => !inUse(x, !!seatOfTalent(x.id)) && !talentPubs.has(x.id));
    if (!p) {
      if (db.talent.length >= TALENT_MAX) return { error: `All ${TALENT_MAX} profiles are in use: remove someone first` };
      const used = new Set(db.talent.map(x => x.id));
      let n = TALENT_COUNT + 1; while (used.has(`t${n}`)) n++;
      p = blankTalent(`t${n}`, () => newKey(), newVdoId);
      db.talent = [...db.talent, p];
    }
    const id = p.id;
    db.talent = db.talent.map(x => (x.id === id ? { ...x, name, role: a.role && TALENT_ROLES.some(r => r.id === a.role) ? a.role : 'caster', ...(vdo ? { vdoId: vdo, mode: 'vdo' as const, vdoSet: true } : a.mode === 'vdo' ? { mode: 'vdo' as const } : { mode: 'webrtc' as const }), ready: false } : x));
    if (a.seat != null) { const e = setSeat(a.seat, id); if (e) return { error: e }; }
    else { save(); pushState(); }
    void audioMix?.sync('talent added');
    return { id };
  }

  /** Clear a profile: off position, new link key (the old link dies at once), defaults. t11+ are deleted. */
  function removeTalent(id: string): string | null {
    const t = db.talent.find(p => p.id === id);
    if (!t) return 'Unknown talent';
    const seat = seatOfTalent(id);
    if (seat) { const e = setSeat(seat, null); if (e) return e; }
    const pid = talentPubs.get(id), c = pid ? clients.get(pid) : undefined;
    if (c) { send(c, { t: 'error', code: 'auth', message: 'This talent link has been removed by the producer.' }); c.ws.close(4003, 'revoked'); }
    db.talent = talentNum(id) > TALENT_COUNT ? db.talent.filter(p => p.id !== id) : db.talent.map(p => (p.id === id ? blankTalent(id, () => newKey(), newVdoId) : p));
    save(); pushState();
    void audioMix?.sync('talent removed');
    return null;
  }

  function regenTalent(id: string): string | null {
    const i = db.talent.findIndex(p => p.id === id);
    if (i < 0) return 'Unknown talent';
    db.talent = db.talent.map((p, j) => (j === i ? { ...p, key: newKey() } : p));
    const pid = talentPubs.get(id), p = pid ? clients.get(pid) : undefined;
    if (p) { send(p, { t: 'error', code: 'auth', message: 'This talent link has been replaced by the producer.' }); p.ws.close(4003, 'revoked'); }
    save();
    return null;
  }

  /** Renegotiate a position's feed for every viewer (fixes a frozen picture without the talent doing anything). */
  function resyncSeat(seatN: number): string | null {
    if (!(SEATS as readonly number[]).includes(seatN)) return 'Unknown position';
    const pid = pubOf(seatN as CasterId);
    if (!pid) return 'Nobody is connected in this position';
    let n = 0;
    for (const v of clients.values()) {
      const req = v.watching.get(seatN as CasterId);
      if (!req) continue;
      send(clients.get(pid), { t: 'rtc-viewer-leave', viewerId: v.id });
      send(clients.get(pid), { t: 'rtc-viewer-join', viewerId: v.id, req });
      n++;
    }
    return n ? null : 'No browser source is showing this position right now';
  }

  const gfxHealth: Record<string, { ok: boolean; error?: string; at: number }> = {};
  const gfxMsg = (): ServerMsg => ({ t: 'gfx', graphics: db.graphics, now: Date.now() });
  const pushGfx = () => each(c => c.role === 'output' || c.role === 'controller', gfxMsg());
  const mediaMsg = (): ServerMsg => ({ t: 'media', media: db.media, now: Date.now() });
  const pushMedia = () => each(c => c.role === 'output' || c.role === 'controller', mediaMsg());

  function relay(c: Client, to: string, data: any) {
    const target = clients.get(to);
    if (!target || !data || typeof data !== 'object') return;
    if (JSON.stringify(data).length > 200_000) return;
    const cs = c.role === 'contributor' ? (c.talent ? seatOfTalent(c.talent) : c.slot) : null;
    const ts = target.role === 'contributor' ? (target.talent ? seatOfTalent(target.talent) : target.slot) : null;
    if (cs && target.watching.has(cs) && pubOf(cs) === c.id) {
      send(target, { t: 'rtc-signal', from: c.id, slot: cs, data });
    } else if (ts && c.watching.has(ts) && pubOf(ts) === target.id) {
      send(target, { t: 'rtc-signal', from: c.id, slot: ts, data });
    }
  }

  // ---------- message handling ----------
  function onHello(c: Client, m: Extract<ClientMsg, { t: 'hello' }>) {
    if (c.role) return;
    if (m.role === 'controller') {
      if (!c.authed) {
        send(c, { t: 'error', code: 'auth', message: 'Not signed in.' });
        return c.ws.close(4003, 'auth');
      }
    } else if (m.role === 'admin') {
      if (!c.authRole) {
        send(c, { t: 'error', code: 'auth', message: 'Not signed in.' });
        return c.ws.close(4003, 'auth');
      }
    } else if (m.role === 'crew') {
      if (typeof m.key !== 'string' || !safeEq(m.key, db.crewKey)) {
        send(c, { t: 'error', code: 'auth', message: 'This crew link is invalid or has been replaced.' });
        return c.ws.close(4003, 'auth');
      }
    } else if (m.role === 'output') {
      if (config.outputKey && m.key !== config.outputKey) {
        send(c, { t: 'error', code: 'auth', message: 'Invalid output key.' });
        return c.ws.close(4003, 'auth');
      }
    } else if (m.role === 'contributor' && typeof m.talent === 'string') {
      const t = db.talent.find(p => p.id === m.talent);
      if (!t || typeof m.key !== 'string' || !safeEq(m.key, t.key)) {
        send(c, { t: 'error', code: 'auth', message: 'This talent link is invalid or has been revoked.' });
        return c.ws.close(4003, 'auth');
      }
      c.talent = t.id;
    } else if (m.role === 'contributor') {
      if (!isSlot(m.slot) || typeof m.key !== 'string' || !safeEq(m.key, db.contributorKeys[m.slot])) {
        send(c, { t: 'error', code: 'auth', message: 'This camera link is invalid or has been revoked.' });
        return c.ws.close(4003, 'auth');
      }
      c.slot = m.slot;
    } else return c.ws.close(4000, 'role');

    c.role = m.role;
    c.route = typeof m.route === 'string' ? m.route.slice(0, 64) : undefined;
    const name = c.talent ? talentLabel(db.talent.find(p => p.id === c.talent)) : c.slot ? db.live.casters[c.slot - 1].name : undefined;
    send(c, { t: 'welcome', id: c.id, role: c.role, iceServers: iceServers(c.id), slot: c.slot, name });
    if (c.role === 'output' || c.role === 'controller' || c.role === 'crew' || c.role === 'admin') send(c, liveMsg());
    if (c.role === 'controller' || c.role === 'contributor' || c.role === 'crew') send(c, { t: 'ros', ros: db.ros, now: Date.now() });
    if (c.role === 'contributor' && c.slot && !c.talent) send(c, casterInfo(c.slot));
    if (c.role === 'output' || c.role === 'controller') { send(c, mediaMsg()); send(c, gfxMsg()); }
    if (c.role === 'output') perf?.joined();
    if (c.role === 'controller' && perf) send(c, { t: 'perf', perf: perf.report() });
    if (c.role === 'controller') send(c, { t: 'state', state: controllerState() });
    if (c.role !== 'contributor') { send(c, { t: 'tournament', tournament: db.tournament }); send(c, matchDataMsg()); }
    if (wcAudience(c)) { send(c, wcMsg()); send(c, { t: 'twitch', tw: tw.pub }); }
    if (c.role === 'output' || c.role === 'controller' || c.role === 'crew') send(c, { t: 'aud', aud: aud.pub() });
    if (c.role === 'controller') send(c, { t: 'aud-private', aud: audPriv() });
    if (c.role === 'contributor') { if (c.talent) registerTalent(c); else registerPublisher(c, c.slot!); }
    pushState();
  }

  function onMessage(c: Client, m: ClientMsg) {
    if (m.t === 'ping') return send(c, { t: 'pong' });
    if (m.t === 'hello') return onHello(c, m);
    if (!c.role) return;

    // Signaling (viewers = controller + output; publisher = contributor)
    if (m.t === 'rtc-watch' && c.role !== 'contributor' && isSlot(m.slot)) {
      return watch(c, { slot: m.slot, quality: m.quality === 'lq' ? 'lq' : 'hq', video: m.video !== false, audio: m.audio === true });
    }
    if (m.t === 'rtc-unwatch' && isSlot(m.slot)) return unwatch(c, m.slot);
    if (m.t === 'rtc-signal' && typeof m.to === 'string') return relay(c, m.to, m.data);
    if (m.t === 'rtc-publish-state' && c.role === 'contributor') {
      c.pub = { publishing: !!m.publishing, hasAudio: !!m.hasAudio, label: typeof m.label === 'string' ? m.label.slice(0, 80) : undefined };
      return pushState();
    }

    if (m.t === 'media-ended' && c.role === 'output') { engine?.mediaEnded(Number(m.seq)); return; }
    if (m.t === 'out-perf' && c.role === 'output' && m.perf && typeof m.perf === 'object') {
      const p = m.perf as unknown as Record<string, unknown>, n = (k: string) => (Number.isFinite(Number(p[k])) ? Number(p[k]) : 0);
      perf?.sample(c.id, { route: String(c.route ?? p.route ?? '?').slice(0, 64), w: n('w'), h: n('h'), scale: n('scale'), raster: String(p.raster ?? '').slice(0, 12), suspended: p.suspended === true,
        fps: n('fps'), p95: n('p95'), long: n('long'), videos: n('videos'), dropped: n('dropped'), decoded: n('decoded'), fontsReady: p.fontsReady !== false, ...(p.heapMB != null ? { heapMB: n('heapMB') } : {}) });
      return;
    }
    if (m.t === 'gfx-health' && c.role === 'output' && typeof m.id === 'string' && db.graphics.some(g => g.id === m.id)) {
      gfxHealth[m.id] = { ok: m.ok === true, error: typeof m.error === 'string' ? m.error.slice(0, 300) : undefined, at: Date.now() };
      return pushState();
    }
    if (m.t === 't-op' && (c.role === 'admin' || c.role === 'controller')) return tournamentOp(m.op);
    // Picks are entered by the producer (scene dock / Major tab); caster pages no longer send them.
    if (m.t === 'caster-pick') return;
    if (c.role !== 'controller') return; // everything below mutates state
    if (m.t === 'cmd') {
      if (!engine) return send(c, { t: 'ack', id: String(m.id), ok: false, version: 0, error: 'Engine not ready' });
      const id = String(m.id);
      engine.run(m.cmd, c.id, m.source === 'auto' ? 'auto' : 'manual', typeof m.base === 'number' ? m.base : undefined)
        .catch(e => ({ ok: false as const, version: 0, error: `Server error: ${(e as Error).message}` }))
        .then(r => send(c, { t: 'ack', id, ...r }));
      return;
    }
    if (m.t === 'aud') {
      const id = String(m.id ?? '');
      if (!m.op || typeof m.op !== 'object') return send(c, { t: 'aud-ack', id, ok: false, error: 'Invalid command' });
      aud.op(m.op).catch(e => String((e as Error).message)).then(error => send(c, { t: 'aud-ack', id, ok: !error, error: error ?? undefined }));
      return;
    }
    act(m);
  }

  /** Producer actions — shared by the controller WebSocket and the HTTP control API. */
  function act(m: ClientMsg) {
    switch (m.t) {
      case 'ros-items':
        db.ros = sanitizeRos({ ...db.ros, items: m.items });
        pushRos();
        break;
      case 'ros-go': {
        const i = m.index;
        db.ros = { ...db.ros, current: typeof i === 'number' && i >= 0 && i < db.ros.items.length ? i : null, startedAt: Date.now() };
        if (db.ros.current == null) db.ros.startedAt = null;
        pushRos();
        break;
      }
      case 'ros-message':
        db.ros = { ...db.ros, message: m.text ? { text: String(m.text).slice(0, 140), at: Date.now() } : null };
        pushRos();
        break;
      case 'follow-set':
        db.follow = sanitizeFollow(m.follow);
        save();
        break;
      case 'players-set':
        db.players = ensureStreamIds(sanitizePlayers(m.players));
        pushMatchData();
        save();
        break;
      case 'stories-set':
        db.stories = sanitizeStories(m.stories);
        save();
        break;
      case 'regen-crew-key':
        db.crewKey = newKey(12);
        save();
        for (const x of clients.values()) if (x.role === 'crew') { send(x, { t: 'error', code: 'auth', message: 'This crew link has been replaced.' }); x.ws.close(4003, 'revoked'); }
        break;
      case 'set-show':
        db.showPreview = sanitizeShow(m.show);
        save();
        if (db.instant) goLive();
        break;
      case 'quick':
        if (m.op && typeof m.op === 'object') quick(m.op);
        break;
      case 'screen':
        if (!SCREEN_IDS.includes(m.screen)) break;
        db.preview = { ...db.preview, screen: m.screen };
        save();
        if (db.instant) goLive();
        else if (m.take && db.live.screen !== m.screen) {
          // Cut only the screen; other prepared preview changes stay in preview.
          const prev = db.live.screen;
          db.live = { ...db.live, screen: m.screen };
          airProgram(prev, 'stinger');
        }
        break;
      case 'set-preview':
        db.preview = sanitizeScene(m.scene);
        save();
        if (db.instant) goLive();
        break;
      case 'take':
        goLive();
        break;
      case 'set-instant':
        db.instant = !!m.on;
        save();
        if (db.instant) goLive();
        break;
      case 'reset-show': {
        const d = defaultShow();
        d.sponsors = db.showPreview.sponsors;
        d.obsScenes = db.showPreview.obsScenes;
        db.showPreview = d;
        save();
        if (db.instant) goLive();
        break;
      }
      case 'regen-api-token':
        db.apiToken = newKey(18);
        save();
        break;
      case 'reset-preview': {
        const d = defaultScene();
        // Keep camera sources: resetting the look shouldn't drop remote cameras.
        d.casters.forEach((cs, i) => (cs.source = clone(db.preview.casters[i].source)));
        db.preview = d;
        save();
        if (db.instant) goLive();
        break;
      }
      case 'preset-save': {
        const name = String(m.name ?? '').trim().slice(0, 48) || 'Untitled preset';
        const existing = m.id ? db.presets.find(p => p.id === m.id) : undefined;
        const identity = m.identity === undefined ? existing?.identity ?? false : !!m.identity;
        if (existing) Object.assign(existing, { scene: clone(db.preview), name, identity, updatedAt: Date.now() });
        else db.presets.push({ id: crypto.randomUUID(), name, identity, scene: clone(db.preview), updatedAt: Date.now() });
        save();
        break;
      }
      case 'preset-recall': {
        const p = db.presets.find(p => p.id === m.id);
        if (!p) break;
        db.preview = applyPreset(db.preview, p);
        save();
        if (m.take || db.instant) goLive();
        break;
      }
      case 'preset-delete':
        db.presets = db.presets.filter(p => p.id !== m.id);
        save();
        break;
      case 'regen-key':
        if (!isSlot(m.slot)) break;
        db.contributorKeys[m.slot] = newKey();
        save();
        { // revoke the current device immediately
          const pid = publishers.get(m.slot);
          const p = pid ? clients.get(pid) : undefined;
          if (p) { send(p, { t: 'error', code: 'auth', message: 'This camera link has been revoked.' }); p.ws.close(4003, 'revoked'); }
        }
        break;
      case 'obs-scene':
        obs.setScene(String(m.name));
        break;
      case 'obs-sync':
        obs.apply(db.live, db.showLive.theme);
        break;
      case 'event-create': {
        const id = createEvent(String(m.name ?? ''), m.from === 'copy' || m.from === 'overdrive' ? m.from : 'blank', m.theme === 'classic' ? 'classic' : 'bnl');
        if (m.activate) switchToEvent(id); else pushState();
        break;
      }
      case 'event-switch': switchToEvent(String(m.id)); break;
      case 'sheet-set': {
        const p = parseSheetUrl(String(m.url ?? ''));
        if (p) { db.sheet.id = p.id; db.sheet.gid = p.gid; db.sheet.pub = p.pub; }
        else if (!String(m.url ?? '').trim()) { db.sheet.id = ''; db.sheet.gid = ''; db.sheet.pub = false; }
        db.sheet.enabled = m.enabled === true && !!db.sheet.id;
        save();
        sheetNow();
        break;
      }
      case 'sheet-sync': sheetNow(); break;
      case 'sheet-feature': {
        db.sheet.featured = typeof m.id === 'string' ? m.id : null;
        applyFeatured();
        broadcastLive();
        pushMatchData();
        { // Featuring a wildcard match makes it the cast match on the bracket graphics too.
          const fm = db.sheet.matches.find(x => x.id === db.sheet.featured);
          const cast = fm && isWcId(fm.bracket) ? fm.bracket : db.sheet.featured ? db.wildcard.cast : null;
          if (cast !== db.wildcard.cast) { db.wildcard.cast = cast; wcChanged(false); }
        }
        break;
      }
      case 'wc': wcOp(m.op); break;
      case 'tw': if (m.op && typeof m.op === 'object') tw.op(m.op); break;
      case 'badge': {
        const k = m.kind === 'replay' || m.kind === 'highlights' ? m.kind : 'none';
        db.showLive = { ...db.showLive, badge: { kind: k, at: Date.now() } };
        db.showPreview = { ...db.showPreview, badge: db.showLive.badge };
        broadcastLive();
        break;
      }
      case 'event-rename': renameEvent(String(m.id), String(m.name ?? '')); pushState(); break;
      case 'event-delete': deleteEvent(String(m.id)); pushState(); break;
      case 'obs-connect': {
        if (config.obsUrl) break; // fixed in settings.bat
        const url = String(m.url ?? '').trim().slice(0, 200);
        if (url && !/^wss?:\/\//i.test(url)) break;
        db.obsUrl = url;
        if (typeof m.password === 'string') db.obsPassword = m.password.slice(0, 200);
        save();
        obs.configure(url, db.obsPassword ?? '');
        break;
      }
      case 'obs-build': {
        // Legacy controller button: builds the 11 legacy screen scenes with the new builder (the click confirms).
        // It no longer switches OBS afterwards. Studio Mode → OBS Setup shows the preview and every output.
        obsSetup.setOptions({ gameCapture: m.gameCapture !== false, audio: m.audio !== false });
        const ids = obsSetup.targets().filter(t => t.kind === 'screen').map(t => t.id);
        void (async () => {
          const p = await obsSetup.preview('build', ids);
          const r = typeof p === 'string' ? p : await obsSetup.apply(p.hash, false);
          const lines = typeof r === 'string' ? [r] : [r.summary, ...Object.entries(r.perTarget).flatMap(([k, v]) => v.lines.map(l => `${k}: ${l}`))];
          obs.status.build = { at: Date.now(), ok: typeof r !== 'string' && r.ok, lines: lines.slice(0, 80) };
          pushState();
        })();
        break;
      }
    }
    pushState();
  }

  function onClose(c: Client) {
    clients.delete(c.id);
    for (const slot of c.watching.keys()) {
      const pid = pubOf(slot);
      if (pid) send(clients.get(pid), { t: 'rtc-viewer-leave', viewerId: c.id });
    }
    if (c.role === 'contributor' && c.talent && talentPubs.get(c.talent) === c.id) {
      talentPubs.delete(c.talent);
      const seat = seatOfTalent(c.talent);
      if (seat && !pubOf(seat)) for (const v of clients.values()) if (v.watching.has(seat)) send(v, { t: 'rtc-publisher', slot: seat, online: false });
    }
    if (c.role === 'contributor' && c.slot && publishers.get(c.slot) === c.id) {
      publishers.delete(c.slot);
      for (const v of clients.values()) if (v.watching.has(c.slot)) send(v, { t: 'rtc-publisher', slot: c.slot, online: false });
    }
    pushState();
  }

  // ---------- wiring ----------
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith('/ws')) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => {
      // Controller rights require a valid session cookie *and* a same-origin page.
      const origin = req.headers.origin;
      const sameOrigin = !origin || new URL(origin).host === req.headers.host;
      const authRole = sameOrigin ? roleFrom(req) : null;
      const c: Client = { id: crypto.randomUUID(), ws, authed: authRole === 'producer', authRole, watching: new Map(), alive: true };
      if (authRole === 'producer') notePublicOrigin(req);
      clients.set(c.id, c);
      ws.on('pong', () => (c.alive = true));
      ws.on('message', raw => {
        let m: ClientMsg;
        try { m = JSON.parse(String(raw)); } catch { return; }
        if (m && typeof m === 'object' && typeof (m as any).t === 'string') {
          try { onMessage(c, m); } catch (e) { console.error('[ws] handler error', e); }
        }
      });
      ws.on('close', () => onClose(c));
      ws.on('error', () => {});
    });
  });

  // Heartbeat: drop half-open sockets (Wi-Fi drops, sleeping laptops).
  const hb = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch {}
    }
  }, 10_000);
  wss.on('close', () => clearInterval(hb));

  obs.apply(db.live, db.showLive.theme);

  function obsLookup() {
    return {
      setupMap: obsSetup.state().map ?? {},
      screenMap: db.showLive.obsScenes as Record<string, string | undefined>,
      graphics: db.graphics,
      registry: REGISTRY,
      scenes: obs.status.connected ? obs.status.scenes : [],
      pkgObsKey: (pkg: string) => pkgById(pkg)?.obsKey,
    };
  }
  engine = createEngine({
    db,
    save,
    goLive,
    airProgram,
    broadcastLive,
    pushWc: () => { db.wildcard.rev = Date.now(); save(); each(wcAudience, wcMsg()); matchEndCheck(); },
    wcOp,
    quickBadge: kind => act({ t: 'badge', kind }),
    clearPopups: () => wcPop({ kind: 'clear', id: '', side: 0 } as Omit<WcPop, 'seq'>),
    reloadOutputs: () => { let n = 0; for (const c of clients.values()) if (c.role === 'output' && c.ws.readyState === WebSocket.OPEN) { c.ws.send(JSON.stringify({ t: 'reload' })); n++; } return n; },
    pushState,
    pushMedia,
    pushGfx,
    onGfxPublish: g => aud.onPublish(g),
    quick,
    setSeat,
    editTalent,
    addTalent,
    removeTalent,
    audio: {
      master: async muted => { db.audioMaster = muted; save(); if (!obs.status.connected) { pushState(); return null; } await audioMix!.sync('master'); return null; },
      applyAll: () => audioMix!.applyAll(),
    },
    regenTalent,
    resyncSeat,
    camEngine: camEngineFacade,
    obsSetup: async cmd => {
      switch (cmd.action) {
        case 'scan': { const e = await obsSetup.scan(); return e ? { error: e } : { note: 'OBS scanned' }; }
        case 'verify': { const r = await obsSetup.verify(); return typeof r === 'string' ? { error: r } : { note: `${r.bad ? `${r.ok} scene${r.ok === 1 ? '' : 's'} correct, ${r.bad} need attention` : `All ${r.ok} scenes are correct`}${r.leaks ? ` · ⚠ ${r.leaks} OBS source${r.leaks === 1 ? '' : 's'} show an Overdrive controller page` : ''}${r.quality ? ` · ${r.quality} picture-quality warning${r.quality === 1 ? '' : 's'}` : ''}` }; }
        case 'preview': {
          const ids = cmd.targets === 'all' ? 'all' as const : Array.isArray(cmd.targets) ? cmd.targets.map(String).slice(0, 200) : [];
          const r = await obsSetup.preview(cmd.mode === 'repair' ? 'repair' : 'build', ids);
          return typeof r === 'string' ? { error: r } : { note: r.ops.length ? `${r.ops.length} change${r.ops.length === 1 ? '' : 's'} to confirm` : 'Nothing to change' };
        }
        case 'apply': { const r = await obsSetup.apply(String(cmd.hash ?? ''), cmd.allowLive === true); return typeof r === 'string' ? { error: r } : r.ok ? { note: r.summary } : { error: r.summary }; }
        case 'cancel': obsSetup.clearPlan(); return {};
        case 'options': { const e = obsSetup.setOptions(cmd.options ?? {}); return e ? { error: e } : {}; }
        case 'cleanup-scan': {
          const r = await obsSetup.cleanupScan();
          if (typeof r === 'string') return { error: r };
          const n = r.scenes.filter(x => x.cls === 'consolidate').length;
          return { note: `Cleanup report (dry run): ${r.scenes.filter(x => x.cls === 'main').length} main, ${n} can be consolidated, ${r.scenes.filter(x => x.cls === 'keep').length} kept, ${r.scenes.filter(x => x.cls === 'not-overdrive').length} not Overdrive's. Nothing was removed.` };
        }
        case 'cleanup-apply': {
          const list = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 200) : []);
          const r = await obsSetup.cleanupApply(String(cmd.hash ?? ''), list(cmd.remove), list(cmd.unnest), String(cmd.confirm ?? ''), list(cmd.drop), list(cmd.nestAudio));
          if (typeof r === 'string') return { error: r };
          return { note: `${r.removed.length} scene${r.removed.length === 1 ? '' : 's'} removed${r.unnested.length ? ` · legacy audio migrated in ${r.unnested.length}` : ''}${r.nested.length ? ` · audio decluttered in ${r.nested.length}` : ''}${r.lines.some(l => l.startsWith('Kept') || l.startsWith('Skipped')) ? ' · some were kept (see report)' : ''}` };
        }
        case 'audit': {
          const r = await obsSetup.audit();
          if (typeof r === 'string') return { error: r };
          if (!r) return { error: 'OBS is not connected.' };
          return { note: r.duplicates.length ? `⚠ ${r.duplicates.length} duplicate source${r.duplicates.length === 1 ? '' : 's'} found, out of ${r.checked} browser sources checked` : `No duplicate sources found (${r.checked} browser sources checked)` };
        }
        case 'validation': return {};
        case 'validation-set': {
          const r = obsSetup.setValidation(String(cmd.id ?? ''), cmd.checked === true);
          return typeof r === 'string' ? { error: r } : { note: cmd.checked ? 'Confirmed.' : 'Confirmation cleared.' };
        }
        case 'validation-new-session': { obsSetup.newValidationSession(); return { note: 'New pre-event check started: previous confirmations are kept as history.' }; }
      }
      return { error: 'Unknown OBS Setup action' };
    },
    mvp: {
      state: () => mvpFlowState(),
      op: async action => {
        const s = mvpFlowState();
        if (!s.pollId) return 'No MVP vote prepared for this match (Producer → Community MVP → Prepare)';
        const sec = Number(db.graphics.find(x => x.id === 'mvp')?.config.countdown) || 0; // Studio's default countdown
        return aud.op(action === 'open' ? { k: 'mvp-open', poll: s.pollId, ...(sec >= 10 ? { seconds: sec } : {}) } : { k: 'mvp-close', poll: s.pollId });
      },
      ready: async match => {
        const e = await aud.prepareAll(match);
        const n = aud.notice_; // the producer switched to the match a notice was about: that notice is answered
        if (!e && n && n.match === match && n.kind !== 'ready') aud.notice(null);
        return e;
      },
      demo: action => mvpDemo(action),
    },
    obsLookup,
    syncCrew: plan => {
      // Mirror the show plan to the crew / caster run of show (only when the producer turned crew sync on).
      const items = plan.segments.map(sg => ({ id: sg.id, time: '', title: sg.label, minutes: Math.round(sg.dur / 60), who: '', notes: sg.notes }));
      const cur = plan.onAir ? plan.segments.findIndex(sg => sg.id === plan.onAir!.id) : -1;
      db.ros = sanitizeRos({ ...db.ros, items, current: cur >= 0 ? cur : null, startedAt: cur >= 0 ? plan.onAir!.at : null });
      pushRos();
    },
    obsPreview: async (scene, target) => {
      if (!obs.status.connected) return { note: 'OBS not connected: preview in Overdrive only' };
      // 3.2 main-scenes layout: a layer is prepared in its main scene only while that scene is OFF Program (never
      // changes what is on air); on the Program scene it waits for TAKE.
      const lay = target ? obsSetup.layerOf(target) : null;
      let extra = '';
      // 3.3 unified scene (MVP): the view is prepared on the scene's Preview identity — a separate, muted source in
      // its own internal scene — and THAT is OBS's Preview. The Program source is never touched.
      if (lay?.role === 'state') {
        const view = mvpViewOfSel(target!.replace(/^s:/, ''));
        const g = db.graphics.find(x => x.id === 'mvp');
        if (g && view && g.prepared !== view) { g.prepared = view; save(); pushGfx(); }
        if (!lay.preview) return { note: `MVP ${view} prepared in Overdrive (Build the MVP scene's Preview identity for OBS Preview)` };
        if (!obs.status.studioMode) return { note: `MVP ${view} prepared on the Preview identity (OBS Studio Mode is off)` };
        if (!obs.status.scenes.includes(lay.preview)) return { error: `OBS has no scene named "${lay.preview}": Build the MVP scene` };
        if (obs.status.previewScene !== lay.preview) { const e = await obs.setPreview(lay.preview); if (e) return { error: e }; }
        return { note: `OBS Preview: MVP · ${view} (Preview identity) · Program untouched` };
      }
      if (lay && lay.scene === scene) {
        if (scene === obs.status.currentScene) {
          if (!lay.on) return { note: `${scene} is on air: ${target} is prepared in Overdrive only. TAKE shows it on Program.` };
        } else {
          const r = await obsSetup.layer(target!, true);
          if (typeof r === 'string') return { error: r };
          if (r?.changed) extra = ' · layer prepared off-air';
        }
      }
      if (!obs.status.studioMode) return { note: `OBS Studio Mode is off: the preview is in Overdrive (TAKE switches OBS Program)${extra}` };
      if (!obs.status.scenes.includes(scene)) return { error: `OBS has no scene named "${scene}"` };
      if (obs.status.previewScene === scene) return { note: `OBS Preview: ${scene}${extra}` };
      const e = await obs.setPreview(scene);
      return e ? { error: e } : { note: `OBS Preview: ${scene}${extra}` };
    },
    obsSwitch: async (scene, t, target) => {
      if (!obs.status.connected) return obs.status.enabled ? `OBS is not connected (${obs.status.error ?? 'offline'})` : 'OBS is not set up (Settings → OBS)';
      if (!obs.status.scenes.includes(scene)) return `OBS has no scene named "${scene}"`;
      // 3.2 main-scenes layout: the output's layer is shown in its main scene, then the scene goes to Program. When
      // the scene is already on Program the layer change IS the take (a cut inside the scene; no scene transition).
      const lay = target ? obsSetup.layerOf(target) : null;
      // 3.3 unified scene: the engine already committed the state to the Program source (with rollback on failure);
      // the Preview identity goes back to mirroring Program. Already on air → the source's own transition is the take.
      if (lay?.role === 'state' && lay.scene === scene) {
        const g = db.graphics.find(x => x.id === 'mvp');
        if (g?.prepared) { g.prepared = null; save(); pushGfx(); }
        if (scene === obs.status.currentScene) return null;
        return (await obs.setScene(scene, t)) ? null : (obs.status.error ?? 'OBS refused the scene switch');
      }
      if (lay && lay.scene === scene) {
        const r = await obsSetup.layer(target!, true);
        if (typeof r === 'string') return r;
        if (scene === obs.status.currentScene) return null;
      }
      return (await obs.setScene(scene, t)) ? null : (obs.status.error ?? 'OBS refused the scene switch');
    },
    obsLayer: async (target, on) => {
      const lay = obsSetup.layerOf(target);
      if (!lay) return { error: 'Not a layer of a main scene: build the main scenes in Studio → Sources & OBS' };
      if (!on && lay.role !== 'overlay') return { error: 'Only overlays are hidden on their own: show another layer (or the scene itself) instead' };
      const r = await obsSetup.layer(target, on);
      if (typeof r === 'string') return { error: r };
      const live = lay.scene === obs.status.currentScene;
      return { note: `${on ? 'Shown' : 'Hidden'} in ${lay.scene}${live ? ' (on air)' : ' (off air)'}` };
    },
  });

  // ---------- 3.0 MVP: one MVP match per event, in step with the results ----------
  // The MVP match is the MVP graphic's `match` (the one value the graphic, Producer, Studio, automation and the vote
  // read). It follows the results: a match that ends becomes the MVP match and its vote is prepared with all its
  // players, unless the MVP of another match is still running (voting open, or an MVP scene on Program) — then the
  // producer is told and switches when ready. Voting never opens and OBS never switches unless the producer turned
  // that automation on.
  const mvpGfx = () => db.graphics.find(x => x.id === 'mvp');
  const mvpMatchNow = () => String(mvpGfx()?.config.match ?? '');
  const mvpSources = REGISTRY.filter(x => x.gfx === 'mvp' && x.gfxView);
  /** OBS scene of each MVP view (Scene Builder / mapping), when OBS has one. */
  function mvpObsScene(view: string): string | null {
    const src = mvpSources.find(x => x.gfxView === view);
    return src ? segmentObsScene({ obsScene: null, target: `s:${src.id}` }, obsLookup()) : null;
  }
  const mvpOnProgram = () => obs.status.connected && mvpSources.some(x => { const n = mvpObsScene(x.gfxView!); return !!n && n === obs.status.currentScene; });
  /** Finished matches of this event, oldest result first. */
  function finishedMatches(): string[] {
    const wc = db.wildcard, R = wcResolve(wc.matches, wc.teams);
    return WC_IDS.filter(id => R[id].winner && R[id].loser !== 'BYE' && realTeam(R[id].t1) && realTeam(R[id].t2)).sort((a, b) => (wc.done[a] ?? 0) - (wc.done[b] ?? 0));
  }
  const matchTitle = (id: string) => { const r = wcResolve(db.wildcard.matches, db.wildcard.teams)[id]; return `${matchName(id)} · ${r?.t1 ?? '?'} vs ${r?.t2 ?? '?'}`; };
  let mvpChain: Promise<unknown> = Promise.resolve();

  async function mvpMatchEnded(id: string) {
    if (!engine) return;
    const cur = mvpMatchNow(), title = matchTitle(id);
    if (!aud.auto.prepare) { aud.notice({ kind: 'info', match: id, text: `${title} finished. Automatic MVP preparation is off: choose the match in the MVP panel.` }); return; }
    const p0 = cur && cur !== id ? aud.pollOf(cur) : null;
    if (cur && cur !== id && (p0?.status === 'open' || mvpOnProgram())) {
      aud.notice({ kind: 'queued', match: id, text: `${title} finished. Its MVP is waiting: the MVP of ${matchName(cur)} is still ${p0?.status === 'open' ? 'voting' : 'on air'}. Switch when you are done.` });
      return;
    }
    const r = await engine.run({ c: 'mvp-match', match: id }, 'MVP · match finished', 'auto');
    if (!r.ok) { aud.notice({ kind: 'error', match: id, text: `${title} finished, but the MVP could not switch to it: ${r.error ?? 'error'}` }); return; }
    const poll = aud.pollOf(id);
    if (!poll) { aud.notice({ kind: 'error', match: id, text: `${title} finished. MVP not prepared: ${r.note?.split(' · ').slice(1).join(' · ') || 'players missing'}` }); return; }
    const extra: string[] = [];
    if (aud.auto.open && poll.status === 'draft') {
      const sec = Number(mvpGfx()?.config.countdown) || 0;
      const e = await aud.op({ k: 'mvp-open', poll: poll.id, ...(sec >= 10 ? { seconds: sec } : {}) });
      extra.push(e ? `voting NOT opened (${e})` : 'voting OPEN (automation)');
    }
    if (aud.auto.preview) {
      const sc = mvpObsScene('voting');
      if (sc && obs.status.connected && obs.status.studioMode) { const e = await obs.setPreview(sc); extra.push(e ? `OBS Preview failed (${e})` : `OBS Preview: ${sc}`); }
    }
    aud.notice({ kind: 'ready', match: id, text: `MVP ready: ${title} · ${poll.players.length} players${extra.length ? ` · ${extra.join(' · ')}` : ''}` });
    pushState();
  }

  /** A team's players changed: a prepared (not yet open) vote of the MVP match picks them up. */
  function mvpRosterChanged(team: string) {
    const m = mvpMatchNow(); if (!m) return;
    const r = wcResolve(db.wildcard.matches, db.wildcard.teams)[m];
    if (r && (r.t1 === team || r.t2 === team)) mvpChain = mvpChain.then(async () => {
      const e = await aud.prepareAll(m), n = aud.notice_, poll = aud.pollOf(m);
      // the missing players were the problem: now the MVP is ready, say so
      if (!e && poll && n && n.match === m && n.kind === 'error') aud.notice({ kind: 'ready', match: m, text: `MVP ready: ${matchTitle(m)} · ${poll.players.length} players` });
    }).catch(() => {});
  }

  /** Another event: the MVP graphic takes that event's latest result (no reveal carried over), prepared if on. */
  function mvpFollowEvent() {
    const g = mvpGfx(), p = g && pkgById(g.pkg);
    if (!g || !p) return;
    const fin = finishedMatches(), cast = db.wildcard.cast, kept = db.audience.mvpMatch;
    const m = kept && fin.includes(kept) ? kept : cast && fin.includes(cast) ? cast : fin[fin.length - 1] ?? '';
    g.config = { ...g.config, match: m, step: 'voting', revealed: '' };
    if (g.draft) g.draft = { ...g.draft, match: m, step: 'voting', revealed: '' };
    save(); pushGfx();
    if (m && aud.auto.prepare) mvpChain = mvpChain.then(() => aud.prepareAll(m)).catch(() => {});
  }

  /** Rehearsal: demo event in, finish a demo match (the real result path), out. */
  async function mvpDemo(action: 'load' | 'finish' | 'leave'): Promise<{ error?: string; note?: string }> {
    if (action === 'load') {
      if (aud.openPoll() && !aud.rehearsal) return { error: 'MVP voting is open in this event: stop it before starting the rehearsal' };
      putRehearsal(demoWildcard(), db.activeEvent);
      if (db.activeEvent === REHEARSAL_ID) { // reloaded in place: start again from the demo data
        aud.swap(db.audience); resultsSeen = null; matchEndCheck(); wcSnap = wcSnapshot(db.wildcard); mvpFollowEvent();
        broadcastLive(); each(wcAudience, wcMsg()); pushState();
      } else switchToEvent(REHEARSAL_ID, { obs: false });
      return { note: 'Rehearsal loaded: DEMO Falcons vs DEMO Comets (2–1, live). Finish the demo match to see the MVP prepare itself.' };
    }
    if (!aud.rehearsal) return { error: 'Not in the rehearsal' };
    if (action === 'finish') {
      const R = wcResolve(db.wildcard.matches, db.wildcard.teams);
      const id = DEMO_MATCHES.find(x => !R[x].winner);
      if (!id) return { error: 'Both demo matches are finished: load the rehearsal again to start over' };
      // the real result path: the same score command as the controller, until the match has a winner
      for (let i = 0; i < 5 && !wcResolve(db.wildcard.matches, db.wildcard.teams)[id].winner; i++) wcOp({ k: 'score', id, side: 1, delta: 1 });
      return { note: `${matchTitle(id)} finished (demo result)` };
    }
    const back = rehearsalReturn();
    if (!back) return { error: 'No other event to go back to' };
    switchToEvent(back, { obs: false });
    return { note: 'Rehearsal closed: back to the real event (its votes and results untouched)' };
  }

  /** The MVP match (the MVP graphic's own match) and where its vote stands. */
  function mvpFlowState() {
    const g = db.graphics.find(x => x.id === 'mvp');
    const match = String(g?.config.match || ''); // 3.0: the MVP match (kept in step with the results), never the cast match
    const poll = (aud.priv().summary?.polls ?? []).filter(p => p.match === match).pop();
    return { match, pollId: poll?.id ?? null, status: poll?.status ?? null, frozen: !!poll?.frozen, desk: Object.keys(db.audience.staffMvp?.[match] ?? {}).length > 0, published: String(g?.config.step ?? '') };
  }

  // 3.1 Track Progression: Google Sheet rows (Control tab or match + track query), reloaded every 8 s when Auto is on.
  setInterval(() => { const t = db.wildcard.track; if (t.src.mode === 'sheet' && t.src.auto) void trackLoad(); }, 8000).unref();

  // 3.0: an MVP graphic saved before 3.0 followed the cast match (no match of its own): give it this event's latest result.
  if (!mvpMatchNow()) mvpFollowEvent();

  // Show plan automation (Studio Mode 2.0): countdown end, segment time up / auto-advance, clock rules.
  const planTick = setInterval(() => { engine?.tick().catch(e => console.warn('[plan] automation tick failed:', e)); }, 500);
  wss.on('close', () => clearInterval(planTick));

  const api = {
    /** Overdrive 2.0 engine for HTTP automation (Stream Deck, Companion): same commands and acks. */
    engine: (cmd: ProducerCmd, source: 'manual' | 'auto' = 'auto') => engine!.run(cmd, 'api', source),
    act,
    tournamentOp,
    spectate,
    /** Staff pick'em changed from the staff page: refresh the producer's view. */
    staffChanged: () => pushState(),
    state: () => ({
      screen: db.live.screen, previewScreen: db.preview.screen, layout: db.live.layout, instant: db.instant, dirty: !sameScene(db.live, db.preview) || JSON.stringify(db.showLive) !== JSON.stringify(db.showPreview),
      casters: db.live.casters.map(c => ({ id: c.id, enabled: c.enabled, name: c.name, cameraOn: c.cameraOn, showName: c.showName, connected: contributorStatus(c.id).publishing })),
      match: { teamA: db.showLive.teamA, teamB: db.showLive.teamB, game: db.showLive.game, bestOf: db.showLive.bestOf },
      timer: { target: db.showLive.timer.target, remaining: db.showLive.timer.target ? Math.max(0, db.showLive.timer.target - Date.now()) : null },
      presets: db.presets.map(p => ({ id: p.id, name: p.name })),
      obs: { connected: obs.status.connected, scene: obs.status.currentScene },
      wildcard: { enabled: db.wildcard.enabled, part: db.wildcard.air, autoSwitch: db.wildcard.opts.rotate, cast: db.wildcard.cast, sheetAuto: db.wildcard.sheetAuto },
    }),
  };
  return { clients, obs, api };
}

/** Presets carry the look; unless saved with identity, keep current names/roles/sources. */
function applyPreset(current: Scene, p: Preset): Scene {
  const next = clone(p.scene);
  if (!p.identity) {
    next.casters.forEach((c, i) => {
      const cur = current.casters[i];
      c.name = cur.name; c.role = cur.role; c.source = clone(cur.source);
    });
  }
  return next;
}

/** Overdrive's public origin when hosted remotely: env first, else the last producer page that connected from a non-local host. */
let seenOrigin = '';
function publicOrigin(): string {
  const env = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  if (/^https?:\/\/[^\s/?#]+$/i.test(env)) return env;
  return seenOrigin;
}
function notePublicOrigin(req: IncomingMessage) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || ((req.socket as any).encrypted ? 'https' : 'http');
  if (/^[\w.-]+(:\d+)?$/.test(host)) seenOrigin = `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

function lanUrls(): string[] {
  const found: { url: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    const n = name.toLowerCase();
    if (/virtualbox|vmware|vethernet|hyper-v|wsl|docker|loopback|bluetooth|npcap/.test(n)) continue; // virtual adapters
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/^(ethernet|wi-?fi|wlan|eth|en|wl)/.test(n)) score += 10;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) score += 5;
      if (a.address.startsWith('192.168.56.')) score -= 20; // VirtualBox host-only default
      if (/tailscale|zerotier|radmin|hamachi/.test(n)) score -= 3; // VPNs: valid, but not the first choice
      found.push({ url: `http://${a.address}:${config.port}`, score });
    }
  }
  return found.sort((x, y) => y.score - x.score).map(f => f.url);
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

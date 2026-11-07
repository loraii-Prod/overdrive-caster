import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config';
import { roleFrom, type AuthRole } from './auth';
import { applyOp, isTeam, resolve, type TournamentOp } from '../shared/tournament';
import { ensureStreamIds, matchPlayer, sanitizePlayers, sanitizeStories, STORY_LABELS } from '../shared/players';
import { db, newKey, sanitizeFollow, save } from './store';
import { iceServers } from './turn';
import { ObsBridge } from './obs';
import { createEvent, deleteEvent, renameEvent, switchEvent } from './events';
import { applyFeatured, syncSheet } from './sheet';
import { parseSheetUrl } from '../shared/sheet';
import { compose } from '../shared/layout';
import { SCREEN_LABELS, clone, defaultScene, defaultShow, sanitizeRos, sanitizeScene, sanitizeShow, sameScene } from '../shared/defaults';
import type { ClientMsg, QuickOp, Role, ServerMsg, WatchRequest } from '../shared/protocol';
import { SCREEN_IDS, type CasterId, type ContributorStatus, type ControllerState, type Preset, type Scene, type Show } from '../shared/types';

interface Client {
  id: string;
  ws: WebSocket;
  authed: boolean;
  authRole: AuthRole | null;
  role?: Role;
  route?: string;
  slot?: CasterId; // contributors
  watching: Map<CasterId, WatchRequest>;
  alive: boolean;
  pub?: { publishing: boolean; hasAudio: boolean; label?: string };
}

const isSlot = (v: unknown): v is CasterId => v === 1 || v === 2 || v === 3;

export function createHub(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  const clients = new Map<string, Client>();
  const publishers = new Map<CasterId, string>();

  let stateTimer: NodeJS.Timeout | null = null;
  const obs = new ObsBridge(() => pushState(), { url: db.obsUrl, password: db.obsPassword });

  // ---------- helpers ----------
  const send = (c: Client | undefined, m: ServerMsg) => {
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  };
  const each = (pred: (c: Client) => boolean, m: ServerMsg) => {
    const data = JSON.stringify(m);
    for (const c of clients.values()) if (pred(c) && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };

  function contributorStatus(slot: CasterId): ContributorStatus {
    const pid = publishers.get(slot);
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
      contributors: { 1: contributorStatus(1), 2: contributorStatus(2), 3: contributorStatus(3) },
      outputs: [...routes].map(([route, count]) => ({ route, count })).sort((a, b) => a.route.localeCompare(b.route)),
      obs: obs.status,
      outputKey: config.outputKey,
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
    return { t: 'caster-info', name: c.name, role: c.role, cameraVisible: !!tile && tile.kind === 'video' && c.source.type === 'webrtc' };
  }

  const liveMsg = (): ServerMsg => ({ t: 'live', scene: db.live, show: db.showLive, version: db.liveVersion, now: Date.now() });

  function broadcastLive() {
    db.liveVersion++;
    db.liveAt = Date.now();
    save();
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'crew' || c.role === 'admin', liveMsg());
    pushState();
  }

  /** TAKE: atomically copy the whole preview (scene + show data) to program. */
  function goLive() {
    const sceneChanged = !sameScene(db.live, db.preview);
    const showChanged = JSON.stringify(db.showLive) !== JSON.stringify(db.showPreview);
    if (!sceneChanged && !showChanged) return;
    const prevScreen = db.live.screen;
    db.live = clone(db.preview);
    db.showLive = clone(db.showPreview);
    broadcastLive();
    for (const slot of [1, 2, 3] as CasterId[]) send(clients.get(publishers.get(slot) ?? ''), casterInfo(slot));
    if (sceneChanged) obs.apply(db.live, db.showLive.theme);
    const obsScene = db.showLive.obsScenes[db.live.screen];
    if (prevScreen !== db.live.screen && obsScene) obs.setScene(obsScene);
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

  let sheetBusy = false;
  async function sheetNow() {
    if (sheetBusy) return;
    sheetBusy = true;
    const before = JSON.stringify([db.showLive.teamA, db.showLive.teamB, db.showLive.bestOf]);
    try { await syncSheet(); } finally { sheetBusy = false; }
    if (JSON.stringify([db.showLive.teamA, db.showLive.teamB, db.showLive.bestOf]) !== before) broadcastLive();
    pushMatchData();
    pushState();
  }
  setInterval(() => { if (db.sheet.enabled && db.sheet.id) sheetNow(); }, 60_000);

  function switchToEvent(id: string) {
    if (!switchEvent(id)) return pushState();
    broadcastLive();
    pushRos();
    pushMatchData();
    each(c => c.role === 'output' || c.role === 'controller' || c.role === 'admin' || c.role === 'crew', { t: 'tournament', tournament: db.tournament });
    obs.apply(db.live, db.showLive.theme);
    const sc = db.showLive.obsScenes[db.live.screen];
    if (sc) obs.setScene(sc);
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
    const pid = publishers.get(req.slot);
    if (pid) send(clients.get(pid), { t: 'rtc-viewer-join', viewerId: c.id, req });
    send(c, { t: 'rtc-publisher', slot: req.slot, online: !!pid });
    pushState();
  }

  function unwatch(c: Client, slot: CasterId) {
    if (!c.watching.delete(slot)) return;
    const pid = publishers.get(slot);
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

  function relay(c: Client, to: string, data: any) {
    const target = clients.get(to);
    if (!target || !data || typeof data !== 'object') return;
    if (JSON.stringify(data).length > 200_000) return;
    if (c.role === 'contributor' && c.slot && target.watching.has(c.slot) && publishers.get(c.slot) === c.id) {
      send(target, { t: 'rtc-signal', from: c.id, slot: c.slot, data });
    } else if (target.role === 'contributor' && target.slot && c.watching.has(target.slot) && publishers.get(target.slot) === target.id) {
      send(target, { t: 'rtc-signal', from: c.id, slot: target.slot, data });
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
    } else if (m.role === 'contributor') {
      if (!isSlot(m.slot) || typeof m.key !== 'string' || !safeEq(m.key, db.contributorKeys[m.slot])) {
        send(c, { t: 'error', code: 'auth', message: 'This camera link is invalid or has been revoked.' });
        return c.ws.close(4003, 'auth');
      }
      c.slot = m.slot;
    } else return c.ws.close(4000, 'role');

    c.role = m.role;
    c.route = typeof m.route === 'string' ? m.route.slice(0, 64) : undefined;
    const name = c.slot ? db.live.casters[c.slot - 1].name : undefined;
    send(c, { t: 'welcome', id: c.id, role: c.role, iceServers: iceServers(c.id), slot: c.slot, name });
    if (c.role === 'output' || c.role === 'controller' || c.role === 'crew' || c.role === 'admin') send(c, liveMsg());
    if (c.role === 'controller' || c.role === 'contributor' || c.role === 'crew') send(c, { t: 'ros', ros: db.ros, now: Date.now() });
    if (c.role === 'controller') send(c, { t: 'state', state: controllerState() });
    if (c.role !== 'contributor') { send(c, { t: 'tournament', tournament: db.tournament }); send(c, matchDataMsg()); }
    if (c.role === 'contributor') registerPublisher(c, c.slot!);
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

    if (m.t === 't-op' && (c.role === 'admin' || c.role === 'controller')) return tournamentOp(m.op);
    if (c.role !== 'controller') return; // everything below mutates state
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
          db.live = { ...db.live, screen: m.screen };
          broadcastLive();
          const obsScene = db.showLive.obsScenes[m.screen];
          if (obsScene) obs.setScene(obsScene);
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
        const id = createEvent(String(m.name ?? ''), m.from === 'copy' || m.from === 'overdrive' ? m.from : 'blank', m.theme === 'glacial' ? 'glacial' : 'bnl');
        if (m.activate) switchToEvent(id); else pushState();
        break;
      }
      case 'event-switch': switchToEvent(String(m.id)); break;
      case 'sheet-set': {
        const p = parseSheetUrl(String(m.url ?? ''));
        if (p) { db.sheet.id = p.id; db.sheet.gid = p.gid; }
        else if (!String(m.url ?? '').trim()) { db.sheet.id = ''; db.sheet.gid = ''; }
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
        break;
      }
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
        obs.build({
          base: `http://localhost:${config.port}`, key: config.outputKey,
          screens: SCREEN_IDS.map(id => ({ id, label: SCREEN_LABELS[id], route: `/output/${id}` })),
          gameCapture: m.gameCapture !== false, audio: m.audio !== false,
        }).then(map => {
          if (!map) return;
          db.showPreview = { ...db.showPreview, obsScenes: { ...db.showPreview.obsScenes, ...map } };
          db.showLive = { ...db.showLive, obsScenes: { ...db.showLive.obsScenes, ...map } };
          save();
          broadcastLive();
          const sc = map[db.live.screen];
          if (sc) obs.setScene(sc);
        });
        break;
      }
    }
    pushState();
  }

  function onClose(c: Client) {
    clients.delete(c.id);
    for (const slot of c.watching.keys()) {
      const pid = publishers.get(slot);
      if (pid) send(clients.get(pid), { t: 'rtc-viewer-leave', viewerId: c.id });
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

  const api = {
    act,
    tournamentOp,
    spectate,
    state: () => ({
      screen: db.live.screen, previewScreen: db.preview.screen, layout: db.live.layout, instant: db.instant, dirty: !sameScene(db.live, db.preview) || JSON.stringify(db.showLive) !== JSON.stringify(db.showPreview),
      casters: db.live.casters.map(c => ({ id: c.id, enabled: c.enabled, name: c.name, cameraOn: c.cameraOn, showName: c.showName, connected: contributorStatus(c.id).publishing })),
      match: { teamA: db.showLive.teamA, teamB: db.showLive.teamB, game: db.showLive.game, bestOf: db.showLive.bestOf },
      timer: { target: db.showLive.timer.target, remaining: db.showLive.timer.target ? Math.max(0, db.showLive.timer.target - Date.now()) : null },
      presets: db.presets.map(p => ({ id: p.id, name: p.name })),
      obs: { connected: obs.status.connected, scene: obs.status.currentScene },
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

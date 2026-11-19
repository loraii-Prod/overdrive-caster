/**
 * Audience interaction, broadcast side. The vote service (vote/) owns viewers' picks and votes; this module:
 *  - pushes the bracket's matches + results to it (only matches whose two teams are known),
 *  - pulls the private totals every 2 s (producer only) and keeps the last confirmed copy (survives a vote outage),
 *  - runs the producer's MVP / lock commands,
 *  - reveals a result publicly only when the producer PUBLISHES the graphic that shows it (never on close).
 * Nothing here switches OBS or airs a graphic.
 */
import { WC_IDS, wcResolve, matchName, type WildcardState } from '../shared/wildcard';
import { normHandle } from '../shared/major';
import { defaultMvpAuto, emptyAudPublic, isMajorTeam, matchRoster, qrUrlOk, sanitizeMvpCard, teamRoster, voteUrlOk, type MvpAuto, type MvpNotice, type AudLiveTotals, type MvpCards, type AudOp, type AudPublic, type AudSessionIn, type AudSummary, type QrLink, type StaffMvp } from '../shared/audience';
import type { GfxInstance } from '../shared/gfx';
import type { AudPoll } from '../shared/audience';
import { config } from './config';
import { createLocalVote, emptyLocalVote, sanitizeLocalVote, type LocalVoteStore } from './localVote';

export interface AudStore {
  lockedMatches: string[];
  championLocked: boolean;
  staffMvp: StaffMvp;
  qr: QrLink[];
  /** Extra hosts the producer approved for custom QR links (the vote service's host is always allowed). */
  qrHosts: string[];
  /** Last summary confirmed by the vote service (kept through outages and restarts). */
  last: AudSummary | null;
  /** Polls whose live totals the producer put on air (only while open). */
  liveTotals: string[];
  /** Reveal card extras (stats, achievements) per match and player. */
  mvpCards: MvpCards;
  /** Matches whose MVP session is archived (kept, no longer the module's default). */
  archived: string[];
  /** Studio override of the public voting address ('' = VOTE_PUBLIC_URL). */
  publicUrl: string;
  /** 3.0: 'auto' = online vote service when configured, else local; 'local' = always this server. */
  voteMode: 'auto' | 'local';
  /** 3.0: local voting (no vote service needed). */
  local: LocalVoteStore;
  /** 3.0: MVP chosen by the production, per match. */
  mvpOverride: Record<string, { player: string; at: number }>;
  /** 3.0: what a match result does to the MVP (prepare by default; open / OBS preview only when enabled). */
  mvpAuto: MvpAuto;
  /** 3.0: last MVP notice for the producer (ready / queued / failed). */
  mvpNotice: MvpNotice | null;
  /** 3.0: this event's MVP match, kept while another event is active (the MVP graphic holds the active one's). */
  mvpMatch: string;
}
export const emptyAudStore = (): AudStore => ({ lockedMatches: [], championLocked: false, staffMvp: {}, qr: [], qrHosts: [], last: null, liveTotals: [], mvpCards: {}, archived: [], publicUrl: '', voteMode: 'auto', local: emptyLocalVote(), mvpOverride: {}, mvpAuto: defaultMvpAuto(), mvpNotice: null, mvpMatch: '' });
export function sanitizeAudStore(v: any): AudStore {
  const d = emptyAudStore();
  if (!v || typeof v !== 'object') return d;
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  return {
    lockedMatches: Array.isArray(v.lockedMatches) ? v.lockedMatches.filter((x: unknown) => typeof x === 'string' && WC_IDS.includes(x)) : [],
    championLocked: v.championLocked === true,
    staffMvp: v.staffMvp && typeof v.staffMvp === 'object' ? Object.fromEntries(Object.entries(v.staffMvp).filter(([k]) => WC_IDS.includes(k)).map(([k, x]: [string, any]) =>
      [k, Object.fromEntries(Object.entries(x ?? {}).filter(([s, y]: [string, any]) => /^[1-5]$/.test(s) && typeof y?.player === 'string').map(([s, y]: [string, any]) => [s, { player: str(y.player, 40), reason: str(y.reason, 120) }]))])) : {},
    qr: Array.isArray(v.qr) ? v.qr.slice(0, 20).filter((q: any) => typeof q?.url === 'string' && typeof q?.id === 'string').map((q: any) => ({ id: str(q.id, 24).replace(/[^\w-]/g, ''), label: str(q.label, 40), url: str(q.url, 300), expires: Number(q.expires) || 0 })) : [],
    qrHosts: Array.isArray(v.qrHosts) ? v.qrHosts.filter((h: unknown) => typeof h === 'string' && /^[a-z0-9.-]{3,80}$/.test(h)).slice(0, 10) : [],
    last: v.last && typeof v.last === 'object' && Array.isArray(v.last.matches) ? v.last : null,
    liveTotals: Array.isArray(v.liveTotals) ? v.liveTotals.filter((x: unknown) => typeof x === 'string').slice(0, 50) : [],
    mvpCards: v.mvpCards && typeof v.mvpCards === 'object' ? Object.fromEntries(Object.entries(v.mvpCards).filter(([k]) => WC_IDS.includes(k)).map(([k, x]: [string, any]) =>
      [k, Object.fromEntries(Object.entries(x ?? {}).slice(0, 20).map(([h, c]) => [h.slice(0, 40), sanitizeMvpCard(c)]).filter(([, c]) => c))])) : {},
    archived: Array.isArray(v.archived) ? v.archived.filter((x: unknown) => typeof x === 'string' && WC_IDS.includes(x as string)) : [],
    publicUrl: typeof v.publicUrl === 'string' && !voteUrlOk(v.publicUrl) ? v.publicUrl : '',
    voteMode: v.voteMode === 'local' ? 'local' : 'auto',
    local: sanitizeLocalVote(v.local),
    mvpOverride: v.mvpOverride && typeof v.mvpOverride === 'object' ? Object.fromEntries(Object.entries(v.mvpOverride).filter(([k, x]: [string, any]) => WC_IDS.includes(k) && typeof x?.player === 'string').map(([k, x]: [string, any]) => [k, { player: str(x.player, 40), at: Number(x.at) || Date.now() }])) : {},
    mvpMatch: typeof v.mvpMatch === 'string' && WC_IDS.includes(v.mvpMatch) ? v.mvpMatch : '',
    mvpAuto: { prepare: v.mvpAuto?.prepare !== false, open: v.mvpAuto?.open === true, preview: v.mvpAuto?.preview === true },
    mvpNotice: v.mvpNotice && typeof v.mvpNotice === 'object' && typeof v.mvpNotice.text === 'string' && ['ready', 'queued', 'error', 'info'].includes(v.mvpNotice.kind)
      ? { at: Number(v.mvpNotice.at) || Date.now(), match: str(v.mvpNotice.match, 20), kind: v.mvpNotice.kind, text: str(v.mvpNotice.text, 200) } : null,
  };
}

export const SESSION_ID = 'major26';
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

export class Audience {
  online = false;
  error: string | null = null;
  private lastPush = '';
  private lastPushAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;

  /** Twitch chat voting hooks (set by the hub): ways to vote for a vote being opened, and the last chat votes before a close. */
  chatHooks: { methods: () => { web: boolean; chat: boolean; cmd: string; channel: string }; beforeClose: (poll: string) => Promise<void>; op: (op: import('../shared/twitchChat').ChatOp) => Promise<string | null> } | null = null;

  private local: ReturnType<typeof createLocalVote>;
  constructor(private store: AudStore, private save: () => void, private wc: () => WildcardState, private push: () => void) {
    this.local = createLocalVote(store.local, save);
  }
  /**
   * 3.0: another event profile became active. Votes, MVP choices, analyst picks and archives belong to ONE event:
   * the bracket slots (R1_UB1…) are the same in every event, so sharing them would carry votes from one to another.
   */
  swap(store: AudStore) {
    this.store = store; this.local = createLocalVote(store.local, this.save);
    this.lastPush = ''; this.failures = 0; this.closing.clear();
    this.tick().catch(() => {}).finally(() => this.push());
  }
  /** This event is the MVP rehearsal: everything stays on this server (never the online vote service). */
  get rehearsal() { return this.wc().rehearsal === true; }
  /** Eligible players of a match (this event's roster, else the verified profiles). */
  rosterOf(match: string) { const wc = this.wc(), r = wcResolve(wc.matches, wc.teams)[match]; return r ? matchRoster(r.t1, r.t2, wc.rosters) : []; }
  get auto() { return this.store.mvpAuto; }
  get notice_() { return this.store.mvpNotice; }
  notice(n: Omit<MvpNotice, 'at'> | null) { this.store.mvpNotice = n ? { ...n, at: Date.now() } : null; this.save(); this.push(); }
  /** Latest MVP vote of a match (with the production's choice applied). */
  pollOf(match: string): AudPoll | null { return (this.sum()?.polls ?? []).filter(p => p.match === match).pop() ?? null; }
  /** Vote service call for other server modules (chat votes). */
  internal(method: string, path: string, body?: unknown, actor = 'twitch-chat') { return this.call(method, path, body, actor); }
  /** The MVP vote currently open (latest summary). */
  openPoll(): AudPoll | null { return (this.sum()?.polls ?? []).filter(p => p.status === 'open').pop() ?? null; }

  /** The online vote service is set up (VOTE_URL + VOTE_SECRET). */
  get remoteConfigured() { return !!(config.voteUrl && config.voteSecret); }
  /** Votes go to the online service (else: counted by this server). */
  get remote() { return this.remoteConfigured && this.store.voteMode !== 'local' && !this.rehearsal; }
  get mode(): 'online' | 'local' { return this.remote ? 'online' : 'local'; }
  /** MVP voting is available (online service or local voting): always, since 3.0. */
  get configured() { return true; }

  /**
   * The summary every reader uses: the last confirmed one, with the production's MVP choices applied. A choice turns
   * that match's vote into a closed vote whose frozen result names the chosen player (`manual`): the reveal can run,
   * and it says the broadcast team chose (it never claims a community vote). Works with no vote at all.
   */
  private sum(): AudSummary | null {
    const s = this.store.last, ov = Object.entries(this.store.mvpOverride);
    if (!ov.length) return s;
    const base: AudSummary = s ?? { at: Date.now(), session: 'local', matches: [], polls: [], viewers: 0, champion: { total: 0, byTeam: {}, locked: true }, accuracy: { played: 0, right: 0, exact: 0, points: 0, marks: [] }, leaderboard: [] };
    const polls = [...base.polls];
    const R = wcResolve(this.wc().matches, this.wc().teams);
    for (const [match, o] of ov) {
      const roster = matchRoster(R[match]?.t1, R[match]?.t2, this.wc().rosters);
      const me = roster.find(p => p.handle === o.player) ?? { handle: o.player, team: '' };
      let i = -1; polls.forEach((p, j) => { if (p.match === match) i = j; });
      if (i >= 0) {
        const p = polls[i], counts = p.frozen?.counts ?? p.counts ?? Object.fromEntries(p.players.map(x => [x.handle, 0]));
        const total = p.frozen?.total ?? p.total ?? 0;
        polls[i] = { ...p, status: p.status === 'revealed' ? 'revealed' : 'closed', closedAt: p.closedAt ?? o.at, closesAt: null, players: p.players.some(x => x.handle === o.player) ? p.players : [...p.players, me],
          frozen: { total, counts, at: p.frozen?.at ?? o.at, hash: p.frozen?.hash ?? `manual-${o.at}`, manual: o.player } };
      } else {
        const st = this.wc().matches[match];
        polls.push({ id: `manual:${match}`, match, label: matchName(match), result: R[match]?.t1 ? `${R[match].t1} ${st?.s1 ?? ''}–${st?.s2 ?? ''} ${R[match].t2}` : '', players: [me], status: 'closed', openedAt: null, closedAt: o.at, closesAt: null, frozen: { total: 0, counts: { [o.player]: 0 }, at: o.at, hash: `manual-${o.at}`, manual: o.player } });
      }
    }
    return { ...base, polls };
  }
  get publicUrl() { return this.store.publicUrl || config.votePublicUrl; }
  /** Hosts a QR code may point to. */
  get hosts() { return [...new Set([host(this.publicUrl), host(config.votePublicUrl), ...this.store.qrHosts].filter(Boolean))]; }
  /** Polls already asked to close on their countdown (so a slow answer is not asked twice). */
  private closing = new Set<string>();

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, 2000);
    this.timer.unref();
    this.tick().catch(() => {});
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private async call(method: string, path: string, body?: unknown, actor = 'producer'): Promise<any> {
    if (!this.remote) return this.local.call(method, path, body);
    const r = await fetch(config.voteUrl + path, {
      method, signal: AbortSignal.timeout(4000),
      headers: { 'x-vote-secret': config.voteSecret, 'x-vote-actor': actor, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({ ok: false, error: `Vote service answered ${r.status}` }));
    if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || `Vote service answered ${r.status}`), { status: r.status });
    return j;
  }

  /** The bracket as the vote service needs it (verified teams only; matches without both teams are left out). */
  session(): AudSessionIn {
    const wc = this.wc(), R = wcResolve(wc.matches, wc.teams);
    const matches = WC_IDS.flatMap(id => {
      const r = R[id], st = wc.matches[id];
      if (!r.t1 || !r.t2 || r.t1 === 'BYE' || r.t2 === 'BYE') return [];
      const n1 = parseInt(st.s1, 10), n2 = parseInt(st.s2, 10);
      const score = r.winner && Number.isFinite(n1) && Number.isFinite(n2) ? `${Math.max(n1, n2)}-${Math.min(n1, n2)}` : null;
      const started = st.live || st.s1 !== '' || st.s2 !== '';
      return [{ id, label: matchName(id), a: r.t1, b: r.t2, bestOf: 5, live: started && !r.winner, locked: this.store.lockedMatches.includes(id), winner: r.winner, score, players: matchRoster(r.t1, r.t2, wc.rosters) }];
    });
    const anyStarted = matches.some(m => m.live || m.winner);
    return { session: SESSION_ID, name: 'Overdrive Major', matches, championLocked: this.store.championLocked || anyStarted };
  }

  async tick() {
    try {
      const s = this.session(), key = JSON.stringify(s);
      if (key !== this.lastPush || Date.now() - this.lastPushAt > 30000) {
        await this.call('PUT', '/internal/session', s, 'sync');
        this.lastPush = key; this.lastPushAt = Date.now();
      }
      const j = await this.call('GET', '/internal/summary');
      if (j.summary) { this.store.last = j.summary; this.save(); }
      // Countdown: the vote service already refuses late votes; this freezes the result right on time.
      for (const p of (j.summary?.polls ?? []) as AudPoll[]) if (p.status === 'open' && p.closesAt && p.closesAt <= Date.now() && !this.closing.has(p.id)) {
        this.closing.add(p.id);
        (this.chatHooks?.beforeClose(p.id) ?? Promise.resolve()).catch(() => {}).then(() => this.call('POST', `/internal/poll/${encodeURIComponent(p.id)}/close`, undefined, 'countdown')).then(() => this.tick()).catch(() => this.closing.delete(p.id));
      }
      this.failures = 0;
      this.setOnline(true, null, true);
    } catch (e: any) {
      this.lastPush = ''; // resend the session once it is back
      // One missed answer is not an outage: report it after two in a row (4 s).
      if (++this.failures >= 2) this.setOnline(false, e?.name === 'TimeoutError' ? 'Vote service not answering' : String(e?.message ?? e).slice(0, 120));
    }
  }
  private setOnline(on: boolean, error: string | null, force = false) {
    if (!force && on === this.online && error === this.error) return;
    this.online = on; this.error = error;
    this.push();
  }

  /** What every broadcast client gets: no live counts. */
  pub(): AudPublic & { staffMvp: StaffMvp; qr: QrLink[]; liveTotals: AudLiveTotals; mvpCards: MvpCards; archived: string[] } {
    const s = this.sum(), base = emptyAudPublic(this.publicUrl);
    const now = Date.now();
    const qr = [
      // the website QR only when votes go to the online service (a local count would never see website votes)
      ...(this.publicUrl && this.remote ? [{ id: 'vote', label: "Pick'ems & MVP", url: this.publicUrl, expires: 0 }] : []),
      ...this.store.qr.filter(q => !qrUrlOk(q.url, this.hosts) && (!q.expires || q.expires > now)),
    ];
    const extra = { mvpCards: this.store.mvpCards, archived: this.store.archived };
    if (!s) return { ...base, online: this.online, error: this.error, staffMvp: this.store.staffMvp, qr, liveTotals: {}, ...extra };
    // Live totals reach the outputs only for an OPEN vote the producer chose to show (never closed or draft ones).
    const liveTotals: AudLiveTotals = Object.fromEntries(s.polls.filter(p => p.status === 'open' && this.store.liveTotals.includes(p.id)).map(p => [p.id, { total: p.total ?? 0, counts: p.counts ?? {} }]));
    return {
      online: this.online, at: s.at, error: this.error, url: this.publicUrl,
      // Only locked / final matches: an open match's split could still change.
      matches: s.matches.filter(m => m.status !== 'open'),
      champion: s.champion.locked ? s.champion : null,
      polls: s.polls.map(({ counts: _c, total: _t, bySource: _b, ...p }) => p),
      accuracy: s.accuracy, leaderboard: s.leaderboard, staffMvp: this.store.staffMvp, qr, liveTotals, ...extra,
    };
  }
  /** Producer view: everything, live counts included. */
  priv() {
    return { mvpAuto: this.store.mvpAuto, mvpNotice: this.store.mvpNotice, rehearsal: this.rehearsal, configured: this.configured, mode: this.mode, remoteConfigured: this.remoteConfigured, voteMode: this.store.voteMode, online: this.online, error: this.error, summary: this.sum(), lockedMatches: this.store.lockedMatches, championLocked: this.store.championLocked, qrHosts: this.hosts, customQr: this.store.qr, publicUrl: this.publicUrl, publicUrlSet: this.store.publicUrl, envPublicUrl: config.votePublicUrl, liveTotals: this.store.liveTotals };
  }

  /** Producer command. Returns an error message or null. */
  async op(op: AudOp): Promise<string | null> {
    const wc = this.wc(), R = wcResolve(wc.matches, wc.teams);
    switch (op.k) {
      case 'chat': return this.chatHooks ? this.chatHooks.op(op.op) : 'Twitch chat voting is not available';
      case 'lock-match': {
        if (!WC_IDS.includes(op.match)) return 'Unknown match';
        this.store.lockedMatches = op.locked ? [...new Set([...this.store.lockedMatches, op.match])] : this.store.lockedMatches.filter(x => x !== op.match);
        this.save(); this.lastPush = ''; await this.tick(); this.push(); return null;
      }
      case 'lock-champion': this.store.championLocked = op.locked === true; this.save(); this.lastPush = ''; await this.tick(); this.push(); return null;
      case 'staff-mvp': {
        const r = R[op.match];
        if (!r?.winner) return 'Choose a finished match';
        if (!/^[1-5]$/.test(String(op.slot))) return 'Unknown position';
        const ok = matchRoster(r.t1, r.t2, wc.rosters).some(p => p.handle === op.player);
        const cur = { ...(this.store.staffMvp[op.match] ?? {}) };
        if (op.player === null) delete cur[String(op.slot)];
        else if (!ok) return 'That player did not play this match';
        else cur[String(op.slot)] = { player: op.player, reason: String(op.reason ?? '').slice(0, 120) };
        this.store.staffMvp = { ...this.store.staffMvp, [op.match]: cur };
        this.save(); this.push(); return null;
      }
      case 'mvp-totals': {
        this.store.liveTotals = op.on ? [...new Set([...this.store.liveTotals, op.poll])].slice(-50) : this.store.liveTotals.filter(x => x !== op.poll);
        this.save(); this.push(); return null;
      }
      case 'mvp-card': {
        const r = R[op.match];
        if (!r?.t1 || !r?.t2) return 'Choose a match';
        if (!matchRoster(r.t1, r.t2, wc.rosters).some(p => p.handle === op.player)) return 'That player did not play this match';
        const card = sanitizeMvpCard(op.card), cur = { ...(this.store.mvpCards[op.match] ?? {}) };
        if (card) cur[op.player] = card; else delete cur[op.player];
        this.store.mvpCards = { ...this.store.mvpCards, [op.match]: cur };
        this.save(); this.push(); return null;
      }
      case 'mvp-archive': {
        if (!WC_IDS.includes(op.match)) return 'Unknown match';
        const p = this.sum()?.polls.filter(x => x.match === op.match).pop();
        if (op.on && p && p.status === 'open') return 'Close voting before archiving';
        this.store.archived = op.on ? [...new Set([...this.store.archived, op.match])] : this.store.archived.filter(x => x !== op.match);
        this.save(); this.push(); return null;
      }
      case 'vote-url': {
        const url = String(op.url ?? '').trim(), bad = voteUrlOk(url);
        if (bad) return bad;
        this.store.publicUrl = url; this.save(); this.push(); return null;
      }
      case 'qr-set': {
        const list: QrLink[] = [];
        for (const q of op.qr.slice(0, 20)) {
          const bad = qrUrlOk(String(q.url ?? ''), this.hosts);
          if (bad) return `${q.label || q.url}: ${bad}`;
          list.push({ id: String(q.id || Math.random().toString(36).slice(2, 8)).replace(/[^\w-]/g, '').slice(0, 24), label: String(q.label ?? '').slice(0, 40), url: String(q.url), expires: Number(q.expires) || 0 });
        }
        this.store.qr = list; this.save(); this.push(); return null;
      }
    }
    switch (op.k) {
      case 'mvp-auto': {
        const p = op.patch ?? {};
        this.store.mvpAuto = { prepare: typeof p.prepare === 'boolean' ? p.prepare : this.store.mvpAuto.prepare, open: typeof p.open === 'boolean' ? p.open : this.store.mvpAuto.open, preview: typeof p.preview === 'boolean' ? p.preview : this.store.mvpAuto.preview };
        this.save(); this.push(); return null;
      }
      case 'mvp-notice-clear': this.store.mvpNotice = null; this.save(); this.push(); return null;
      case 'mvp-ready': return this.prepareAll(op.match);
      case 'vote-mode': {
        this.store.voteMode = op.mode === 'local' ? 'local' : 'auto';
        this.lastPush = ''; this.failures = 0; this.save(); await this.tick(); this.push(); return null;
      }
      case 'mvp-sim': {
        if (this.remote) return 'Simulated votes only in local voting (rehearsal): they never go into the online vote';
        try { this.local.simulate(op.poll, Number(op.votes) || 0); } catch (e: any) { return String(e?.message ?? e); }
        await this.tick(); this.push(); return null;
      }
      case 'mvp-override': {
        const r = R[op.match];
        if (op.player === null) { const { [op.match]: _x, ...rest } = this.store.mvpOverride; this.store.mvpOverride = rest; this.save(); this.push(); return null; }
        if (!r?.winner) return 'Choose a finished match';
        if (!matchRoster(r.t1, r.t2, wc.rosters).some(p => p.handle === op.player)) return 'That player did not play this match';
        // an open vote is closed first (its count is frozen and kept); if the service is unreachable the choice still stands
        const open = (this.store.last?.polls ?? []).filter(p => p.match === op.match && p.status === 'open').pop();
        let note: string | null = null;
        if (open) try { await this.chatHooks?.beforeClose(open.id).catch(() => {}); await this.call('POST', `/internal/poll/${encodeURIComponent(open.id)}/close`); await this.tick(); } catch (e: any) { note = `voting could not be closed (${String(e?.message ?? e).slice(0, 80)}): the production's choice is used anyway`; }
        this.store.mvpOverride = { ...this.store.mvpOverride, [op.match]: { player: String(op.player).slice(0, 40), at: Date.now() } };
        this.save(); this.push();
        if (note) console.warn('[mvp]', note);
        return null;
      }
    }
    if (!this.configured) return 'Voting service not configured';
    try {
      switch (op.k) {
        case 'mvp-prepare': {
          const r = R[op.match];
          if (!r?.winner) return 'MVP voting needs a finished match';
          const st = wc.matches[op.match];
          const result = `${r.t1} ${st.s1}–${st.s2} ${r.t2}`.replace(/\b(W|L|FF)\b/g, m => (m === 'W' ? 'w/o' : m === 'L' ? '' : 'FF')).replace(/\s+/g, ' ').trim();
          this.lastPush = ''; await this.tick(); // the vote service must know the result first
          // Portraits for the public page: only uploaded ones, as absolute https addresses.
          const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
          const photos: Record<string, string> = {};
          for (const h of op.players) {
            const u = wc.showcase.photos[normHandle(h)];
            const abs = !u ? '' : /^https:\/\//.test(u) ? u : u.startsWith('/') && /^https:\/\//.test(base) ? base + u : '';
            if (abs && abs.length <= 300) photos[h] = abs;
          }
          await this.call('POST', '/internal/poll', { match: op.match, label: matchName(op.match), result, players: op.players, photos });
          break;
        }
        case 'mvp-open': {
          const sec = Number(op.seconds);
          const methods = this.chatHooks?.methods();
          await this.call('POST', `/internal/poll/${encodeURIComponent(op.poll)}/open`, { ...(Number.isFinite(sec) && sec >= 10 ? { seconds: Math.min(3600, Math.round(sec)) } : {}), ...(methods ? { methods } : {}) });
          break;
        }
        case 'mvp-timer': {
          const sec = op.seconds == null ? null : Number(op.seconds);
          if (sec != null && (!Number.isFinite(sec) || sec < 10)) return 'At least 10 seconds';
          await this.call('POST', `/internal/poll/${encodeURIComponent(op.poll)}/timer`, { seconds: sec == null ? null : Math.min(3600, Math.round(sec)) });
          break;
        }
        case 'mvp-close': await this.chatHooks?.beforeClose(op.poll).catch(() => {}); await this.call('POST', `/internal/poll/${encodeURIComponent(op.poll)}/close`); break;
      }
      await this.tick(); this.push(); return null;
    } catch (e: any) { return String(e?.message ?? e).slice(0, 160); }
  }

  /**
   * 3.0: the MVP vote of a finished match with ALL its eligible players (the graphic shows up to four: Trackmania
   * teams are pairs). Nothing to do if a vote already ran (or runs) for that match; a draft is refreshed when the
   * roster changed. Never opens voting.
   */
  async prepareAll(match: string): Promise<string | null> {
    const wc = this.wc(), r = wcResolve(wc.matches, wc.teams)[match];
    if (!r?.winner || r.winner === 'BYE') return 'MVP voting needs a finished match';
    const roster = this.rosterOf(match);
    // both teams must be known: a vote with one team's players only would not be this match's MVP
    const missing = [r.t1, r.t2].filter(t => !teamRoster(t ?? '', wc.rosters).length);
    if (missing.length || roster.length < 2) return `No players known for ${missing.join(' and ') || 'this match'}: add them in the MVP panel`;
    if (this.remote && [r.t1, r.t2].some(t => !isMajorTeam(t ?? '') || wc.rosters[t ?? '']?.length))
      return 'The online vote service only knows the verified Major teams and players: set Counting to Local for this match (Twitch chat)';
    const cur = this.pollOf(match);
    if (cur && cur.status !== 'draft') return null;
    const want = roster.slice(0, 4).map(p => p.handle);
    if (cur && cur.status === 'draft' && cur.players.map(p => p.handle).join('|') === want.join('|')) return null;
    return this.op({ k: 'mvp-prepare', match, players: want });
  }

  /**
   * A graphic was published (its prepared state went to the browser source). Showing a community result on air is
   * what makes it public on the voting page too: the reveal follows the producer's take, never the close of voting.
   */
  onPublish(g: GfxInstance) {
    const step = String(g.config.step ?? ''), match = String(g.config.match ?? '');
    if (g.pkg === 'od.pickem' && (step === 'community' || step === 'verdict') && match && this.remote) this.call('POST', '/internal/reveal-match', { match }).then(() => this.tick()).catch(() => {});
    if (g.pkg === 'od.mvp' && (step === 'winner' || step === 'compare')) {
      const poll = this.store.last?.polls.filter(p => p.match === match && (p.status === 'closed' || p.status === 'revealed')).pop();
      if (poll && poll.status === 'closed' && !poll.id.startsWith('manual:')) this.call('POST', `/internal/poll/${encodeURIComponent(poll.id)}/reveal`).then(() => this.tick()).catch(() => {});
    }
  }
}

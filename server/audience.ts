/**
 * Audience interaction, broadcast side. The vote service (vote/) owns viewers' picks and votes; this module:
 *  - pushes the bracket's matches + results to it (only matches whose two teams are known),
 *  - pulls the private totals every 2 s (producer only) and keeps the last confirmed copy (survives a vote outage),
 *  - runs the producer's MVP / lock commands,
 *  - reveals a result publicly only when the producer PUBLISHES the graphic that shows it (never on close).
 * Nothing here switches OBS or airs a graphic.
 */
import { WC_IDS, wcResolve, matchName, type WildcardState } from '../shared/wildcard';
import { emptyAudPublic, qrUrlOk, teamRoster, type AudOp, type AudPublic, type AudSessionIn, type AudSummary, type QrLink, type StaffMvp } from '../shared/audience';
import type { GfxInstance } from '../shared/gfx';
import { config } from './config';

export interface AudStore {
  lockedMatches: string[];
  championLocked: boolean;
  staffMvp: StaffMvp;
  qr: QrLink[];
  /** Extra hosts the producer approved for custom QR links (the vote service's host is always allowed). */
  qrHosts: string[];
  /** Last summary confirmed by the vote service (kept through outages and restarts). */
  last: AudSummary | null;
}
export const emptyAudStore = (): AudStore => ({ lockedMatches: [], championLocked: false, staffMvp: {}, qr: [], qrHosts: [], last: null });
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

  constructor(private store: AudStore, private save: () => void, private wc: () => WildcardState, private push: () => void) {}

  get configured() { return !!(config.voteUrl && config.voteSecret); }
  get publicUrl() { return config.votePublicUrl; }
  /** Hosts a QR code may point to. */
  get hosts() { return [...new Set([host(config.votePublicUrl), ...this.store.qrHosts].filter(Boolean))]; }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, 2000);
    this.timer.unref();
    this.tick().catch(() => {});
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private async call(method: string, path: string, body?: unknown, actor = 'producer'): Promise<any> {
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
      return [{ id, label: matchName(id), a: r.t1, b: r.t2, bestOf: 5, live: started && !r.winner, locked: this.store.lockedMatches.includes(id), winner: r.winner, score }];
    });
    const anyStarted = matches.some(m => m.live || m.winner);
    return { session: SESSION_ID, name: 'Overdrive Major', matches, championLocked: this.store.championLocked || anyStarted };
  }

  async tick() {
    if (!this.configured) { this.setOnline(false, 'Voting service not configured'); return; }
    try {
      const s = this.session(), key = JSON.stringify(s);
      if (key !== this.lastPush || Date.now() - this.lastPushAt > 30000) {
        await this.call('PUT', '/internal/session', s, 'sync');
        this.lastPush = key; this.lastPushAt = Date.now();
      }
      const j = await this.call('GET', '/internal/summary');
      if (j.summary) { this.store.last = j.summary; this.save(); }
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
  pub(): AudPublic & { staffMvp: StaffMvp; qr: QrLink[] } {
    const s = this.store.last, base = emptyAudPublic(this.publicUrl);
    const now = Date.now();
    const qr = [
      ...(this.publicUrl ? [{ id: 'vote', label: "Pick'ems & MVP", url: this.publicUrl, expires: 0 }] : []),
      ...this.store.qr.filter(q => !qrUrlOk(q.url, this.hosts) && (!q.expires || q.expires > now)),
    ];
    if (!s) return { ...base, online: this.online, error: this.error, staffMvp: this.store.staffMvp, qr };
    return {
      online: this.online, at: s.at, error: this.error, url: this.publicUrl,
      // Only locked / final matches: an open match's split could still change.
      matches: s.matches.filter(m => m.status !== 'open'),
      champion: s.champion.locked ? s.champion : null,
      polls: s.polls.map(({ counts: _c, total: _t, ...p }) => p),
      accuracy: s.accuracy, leaderboard: s.leaderboard, staffMvp: this.store.staffMvp, qr,
    };
  }
  /** Producer view: everything, live counts included. */
  priv() {
    return { configured: this.configured, online: this.online, error: this.error, summary: this.store.last, lockedMatches: this.store.lockedMatches, championLocked: this.store.championLocked, qrHosts: this.hosts, customQr: this.store.qr, publicUrl: this.publicUrl };
  }

  /** Producer command. Returns an error message or null. */
  async op(op: AudOp): Promise<string | null> {
    const wc = this.wc(), R = wcResolve(wc.matches, wc.teams);
    switch (op.k) {
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
        const ok = [...teamRoster(r.t1 ?? ''), ...teamRoster(r.t2 ?? '')].some(p => p.handle === op.player);
        const cur = { ...(this.store.staffMvp[op.match] ?? {}) };
        if (op.player === null) delete cur[String(op.slot)];
        else if (!ok) return 'That player did not play this match';
        else cur[String(op.slot)] = { player: op.player, reason: String(op.reason ?? '').slice(0, 120) };
        this.store.staffMvp = { ...this.store.staffMvp, [op.match]: cur };
        this.save(); this.push(); return null;
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
    if (!this.configured) return 'Voting service not configured';
    try {
      switch (op.k) {
        case 'mvp-prepare': {
          const r = R[op.match];
          if (!r?.winner) return 'MVP voting needs a finished match';
          const st = wc.matches[op.match];
          const result = `${r.t1} ${st.s1}–${st.s2} ${r.t2}`.replace(/\b(W|L|FF)\b/g, m => (m === 'W' ? 'w/o' : m === 'L' ? '' : 'FF')).replace(/\s+/g, ' ').trim();
          this.lastPush = ''; await this.tick(); // the vote service must know the result first
          await this.call('POST', '/internal/poll', { match: op.match, label: matchName(op.match), result, players: op.players });
          break;
        }
        case 'mvp-open': await this.call('POST', `/internal/poll/${encodeURIComponent(op.poll)}/open`); break;
        case 'mvp-close': await this.call('POST', `/internal/poll/${encodeURIComponent(op.poll)}/close`); break;
      }
      await this.tick(); this.push(); return null;
    } catch (e: any) { return String(e?.message ?? e).slice(0, 160); }
  }

  /**
   * A graphic was published (its prepared state went to the browser source). Showing a community result on air is
   * what makes it public on the voting page too: the reveal follows the producer's take, never the close of voting.
   */
  onPublish(g: GfxInstance) {
    if (!this.configured) return;
    const step = String(g.config.step ?? ''), match = String(g.config.match ?? '');
    if (g.pkg === 'od.pickem' && (step === 'community' || step === 'verdict') && match) this.call('POST', '/internal/reveal-match', { match }).then(() => this.tick()).catch(() => {});
    if (g.pkg === 'od.mvp' && (step === 'winner' || step === 'compare')) {
      const poll = this.store.last?.polls.filter(p => p.match === match && (p.status === 'closed' || p.status === 'revealed')).pop();
      if (poll && poll.status === 'closed') this.call('POST', `/internal/poll/${encodeURIComponent(poll.id)}/reveal`).then(() => this.tick()).catch(() => {});
    }
  }
}

/**
 * Twitch predictions & polls (Helix API).
 *
 * Sign-in uses Twitch's Device Code flow for a "Public" app: the producer enters a short code at
 * twitch.tv/activate with the broadcaster's account. No client secret, no redirect page. Tokens stay
 * on this server (state.json) and are never sent to a browser.
 *
 * Needs a Client ID: dev.twitch.tv/console/apps → Register Your Application (OAuth Redirect URL
 * http://localhost, Client Type "Public"). Predictions and polls need an Affiliate or Partner channel.
 */
import type { TwOp, TwPoll, TwPrediction, TwShow, TwitchPublic, TwitchStatus } from '../shared/twitch';
import { defaultTwShow } from '../shared/twitch';

const SCOPES = 'channel:manage:predictions channel:manage:polls';
const ID = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';

export interface TwitchStore {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  login: string;
  show: TwShow;
}
export const emptyTwitchStore = (): TwitchStore => ({ clientId: '', accessToken: '', refreshToken: '', userId: '', login: '', show: defaultTwShow() });

export function sanitizeTwitchStore(v: any): TwitchStore {
  const d = emptyTwitchStore(), s = (x: unknown, n = 200) => (typeof x === 'string' ? x.slice(0, n) : '');
  if (!v || typeof v !== 'object') return d;
  const sh = v.show && typeof v.show === 'object' ? v.show : {};
  const b = (k: keyof TwShow) => (typeof sh[k] === 'boolean' ? sh[k] : d.show[k]);
  return {
    clientId: s(v.clientId, 64).replace(/[^a-z0-9]/gi, ''), accessToken: s(v.accessToken), refreshToken: s(v.refreshToken),
    userId: s(v.userId, 32), login: s(v.login, 64),
    show: { gameplay: b('gameplay'), casters: b('casters'), warmup: b('warmup'), intermission: b('intermission') },
  };
}

const ms = (iso: unknown) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };

/** Helix prediction → what outputs draw. */
export function mapPrediction(p: any): TwPrediction | null {
  if (!p || typeof p !== 'object') return null;
  const created = ms(p.created_at);
  return {
    id: String(p.id ?? ''), title: String(p.title ?? '').slice(0, 60),
    status: (['ACTIVE', 'LOCKED', 'RESOLVED', 'CANCELED'].includes(p.status) ? p.status : 'CANCELED') as TwPrediction['status'],
    outcomes: (Array.isArray(p.outcomes) ? p.outcomes : []).slice(0, 10).map((o: any) => ({
      id: String(o.id ?? ''), title: String(o.title ?? '').slice(0, 30), users: Number(o.users) || 0, points: Number(o.channel_points) || 0,
    })),
    winner: p.winning_outcome_id ? String(p.winning_outcome_id) : null,
    endsAt: created != null && Number(p.prediction_window) > 0 ? created + Number(p.prediction_window) * 1000 : null,
    endedAt: ms(p.ended_at) ?? ms(p.locked_at),
  };
}

/** Helix poll → what outputs draw. */
export function mapPoll(p: any): TwPoll | null {
  if (!p || typeof p !== 'object') return null;
  const started = ms(p.started_at);
  return {
    id: String(p.id ?? ''), title: String(p.title ?? '').slice(0, 80),
    status: (['ACTIVE', 'COMPLETED', 'TERMINATED', 'ARCHIVED', 'MODERATED', 'INVALID'].includes(p.status) ? p.status : 'INVALID') as TwPoll['status'],
    choices: (Array.isArray(p.choices) ? p.choices : []).slice(0, 5).map((c: any) => ({ id: String(c.id ?? ''), title: String(c.title ?? '').slice(0, 30), votes: Number(c.votes) || 0 })),
    endsAt: started != null && Number(p.duration) > 0 ? started + Number(p.duration) * 1000 : null,
    endedAt: ms(p.ended_at),
  };
}

export class Twitch {
  status: TwitchStatus = { clientId: '', connected: false, login: '', error: '', device: null, lastPoll: 0 };
  pub: TwitchPublic;
  private timer: NodeJS.Timeout | null = null;
  private deviceTimer: NodeJS.Timeout | null = null;

  /** `store` is the persisted record (mutated in place, saved via `save`). */
  constructor(private store: TwitchStore, private save: () => void, private onStatus: () => void, private onPublic: () => void, private fetchImpl: typeof fetch = fetch) {
    if (!store.clientId && process.env.TWITCH_CLIENT_ID) store.clientId = process.env.TWITCH_CLIENT_ID.replace(/[^a-z0-9]/gi, '');
    this.pub = { prediction: null, poll: null, show: store.show, connected: !!store.accessToken };
    this.status.clientId = store.clientId;
    this.status.login = store.login;
    if (store.accessToken) { this.status.connected = true; this.loop(); }
  }

  private setError(e: unknown) { this.status.error = e instanceof Error ? e.message : String(e ?? ''); this.onStatus(); }

  private async form(url: string, body: Record<string, string>) {
    const r = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  /** Helix call with the stored token; refreshes once on 401. */
  private async helix(method: string, path: string, body?: unknown, retry = true): Promise<any> {
    const r = await this.fetchImpl(`${HELIX}${path}`, {
      method, headers: { 'Client-Id': this.store.clientId, Authorization: `Bearer ${this.store.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && retry && this.store.refreshToken) { await this.refresh(); return this.helix(method, path, body, false); }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message ? `Twitch: ${j.message}` : `Twitch HTTP ${r.status}`);
    return j;
  }

  private async refresh() {
    const { ok, j } = await this.form(`${ID}/token`, { client_id: this.store.clientId, grant_type: 'refresh_token', refresh_token: this.store.refreshToken });
    if (!ok || !j.access_token) { this.signOut('Twitch sign-in expired: connect again.'); throw new Error('Twitch sign-in expired'); }
    this.store.accessToken = j.access_token;
    if (j.refresh_token) this.store.refreshToken = j.refresh_token;
    this.save();
  }

  private signOut(error = '') {
    Object.assign(this.store, { accessToken: '', refreshToken: '', userId: '', login: '' });
    this.save();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.status = { ...this.status, connected: false, login: '', error, device: null };
    this.pub = { ...this.pub, prediction: null, poll: null, connected: false };
    this.onStatus(); this.onPublic();
  }

  /** Start the device-code sign-in: the controller shows the code and the link. */
  async connect() {
    if (!this.store.clientId) return this.setError('Enter the Client ID of your Twitch app first.');
    try {
      const { ok, j } = await this.form(`${ID}/device`, { client_id: this.store.clientId, scopes: SCOPES });
      if (!ok || !j.device_code) throw new Error(j?.message ? `Twitch: ${j.message}` : 'Twitch refused the sign-in (check the Client ID, and that the app is “Public”).');
      this.status = { ...this.status, error: '', device: { code: String(j.user_code), uri: String(j.verification_uri || 'https://www.twitch.tv/activate'), expiresAt: Date.now() + (Number(j.expires_in) || 1800) * 1000 } };
      this.onStatus();
      this.waitForDevice(String(j.device_code), Math.max(2, Number(j.interval) || 5));
    } catch (e) { this.setError(e); }
  }

  private waitForDevice(deviceCode: string, interval: number) {
    if (this.deviceTimer) clearTimeout(this.deviceTimer);
    const tick = async () => {
      const dev = this.status.device;
      if (!dev) return;
      if (Date.now() > dev.expiresAt) { this.status.device = null; return this.setError('The sign-in code expired: press Connect again.'); }
      try {
        const { ok, j } = await this.form(`${ID}/token`, { client_id: this.store.clientId, scopes: SCOPES, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (ok && j.access_token) {
          this.store.accessToken = j.access_token;
          this.store.refreshToken = j.refresh_token ?? '';
          const v = await this.fetchImpl(`${ID}/validate`, { headers: { Authorization: `OAuth ${j.access_token}` } }).then(r => r.json()).catch(() => ({}));
          this.store.userId = String(v.user_id ?? ''); this.store.login = String(v.login ?? '');
          this.save();
          this.status = { ...this.status, connected: true, login: this.store.login, error: '', device: null };
          this.pub = { ...this.pub, connected: true };
          this.onStatus(); this.onPublic();
          this.loop();
          return;
        }
        const msg = String(j?.message ?? '');
        if (!/authorization_pending|slow_down/i.test(msg)) { this.status.device = null; return this.setError(msg ? `Twitch: ${msg}` : 'Sign-in failed.'); }
      } catch (e) { this.setError(e); }
      this.deviceTimer = setTimeout(tick, interval * 1000);
    };
    this.deviceTimer = setTimeout(tick, interval * 1000);
  }

  private loop() {
    if (this.timer) clearInterval(this.timer);
    this.poll();
    this.timer = setInterval(() => this.poll(), 3000);
  }

  /** Read the latest prediction and poll; push to outputs only when something changed. */
  async poll() {
    if (!this.store.accessToken || !this.store.userId) return;
    try {
      const b = encodeURIComponent(this.store.userId);
      const [pr, po] = await Promise.all([
        this.helix('GET', `/predictions?broadcaster_id=${b}&first=1`),
        this.helix('GET', `/polls?broadcaster_id=${b}&first=1`),
      ]);
      const next: TwitchPublic = { ...this.pub, prediction: mapPrediction(pr?.data?.[0]), poll: mapPoll(po?.data?.[0]) };
      const changed = JSON.stringify(next) !== JSON.stringify(this.pub);
      this.pub = next;
      this.status.lastPoll = Date.now();
      if (this.status.error) { this.status.error = ''; this.onStatus(); }
      if (changed) this.onPublic();
    } catch (e) { this.setError(e); }
  }

  async op(op: TwOp) {
    try {
      const b = this.store.userId;
      switch (op.k) {
        case 'client-id':
          this.store.clientId = String(op.clientId ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 64);
          this.status.clientId = this.store.clientId; this.save(); this.onStatus(); return;
        case 'connect': return this.connect();
        case 'disconnect': return this.signOut();
        case 'show':
          this.store.show = sanitizeTwitchStore({ ...this.store, show: { ...this.store.show, ...(op.patch ?? {}) } }).show;
          this.pub = { ...this.pub, show: this.store.show }; this.save(); this.onPublic(); return;
        case 'prediction-start': {
          const outcomes = (op.outcomes ?? []).map(t => String(t).trim().slice(0, 25)).filter(Boolean).slice(0, 10);
          if (outcomes.length < 2) throw new Error('A prediction needs at least two outcomes.');
          await this.helix('POST', '/predictions', { broadcaster_id: b, title: String(op.title ?? '').trim().slice(0, 45) || 'Who wins?', outcomes: outcomes.map(title => ({ title })), prediction_window: Math.max(30, Math.min(1800, Math.round(op.seconds) || 120)) });
          break;
        }
        case 'prediction-lock': case 'prediction-cancel': case 'prediction-resolve': {
          const p = this.pub.prediction;
          if (!p) throw new Error('No prediction to change.');
          const status = op.k === 'prediction-lock' ? 'LOCKED' : op.k === 'prediction-cancel' ? 'CANCELED' : 'RESOLVED';
          await this.helix('PATCH', '/predictions', { broadcaster_id: b, id: p.id, status, ...(op.k === 'prediction-resolve' ? { winning_outcome_id: op.outcomeId } : {}) });
          break;
        }
        case 'poll-start': {
          const choices = (op.choices ?? []).map(t => String(t).trim().slice(0, 25)).filter(Boolean).slice(0, 5);
          if (choices.length < 2) throw new Error('A poll needs at least two choices.');
          await this.helix('POST', '/polls', { broadcaster_id: b, title: String(op.title ?? '').trim().slice(0, 60) || 'Poll', choices: choices.map(title => ({ title })), duration: Math.max(15, Math.min(1800, Math.round(op.seconds) || 60)) });
          break;
        }
        case 'poll-end': {
          const p = this.pub.poll;
          if (!p) throw new Error('No poll to end.');
          await this.helix('PATCH', '/polls', { broadcaster_id: b, id: p.id, status: 'TERMINATED' });
          break;
        }
      }
      await this.poll();
    } catch (e) { this.setError(e); }
  }
}

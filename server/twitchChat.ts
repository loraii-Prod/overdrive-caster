/**
 * Twitch chat reader for MVP voting: EventSub `channel.chat.message` over Twitch's EventSub WebSocket.
 *
 * Sign-in: Device Code flow with a Public Twitch app (no client secret, no redirect page), as YOUR account or a bot
 * account, scope `user:read:chat` only. Reading another channel's chat this way needs nothing from that channel's
 * owner (no password, no token, no `channel:bot`): Twitch requires `user:read:chat` from the reading account for
 * WebSocket subscriptions. Tokens stay on this server (state.json); nothing here is ever sent to a browser.
 *
 * Twitch's rules followed here: subscribe within 10 s of the welcome message; treat silence longer than the
 * keepalive window as a lost connection; on `session_reconnect` connect to the given URL and keep the old socket
 * until the new one says welcome (subscriptions carry over); `revocation` ends the subscription; validate the token
 * every hour; refresh it on 401. Events missed while disconnected are not replayed by Twitch.
 */
import { WebSocket } from 'ws';
import { CHAT_SCOPES, chatMsgOf, defaultChatConfig, sanitizeCommand, sanitizeLogin, type ChatConn, type ChatMsg, type ChatStatus, type ChatVoteConfig, type VoteMethods } from '../shared/twitchChat';

const env = process.env;
// Overridable for tests only (a local mock of Twitch). Production uses Twitch's real endpoints.
const url = (v: string | undefined, d: string, re: RegExp) => (v && re.test(v) ? v.replace(/\/$/, '') : d);
export const TWITCH_ID = url(env.TWITCH_ID_URL, 'https://id.twitch.tv/oauth2', /^https?:\/\//);
export const TWITCH_HELIX = url(env.TWITCH_HELIX_URL, 'https://api.twitch.tv/helix', /^https?:\/\//);
export const TWITCH_EVENTSUB = url(env.TWITCH_EVENTSUB_URL, 'wss://eventsub.wss.twitch.tv/ws', /^wss?:\/\//);
const SCOPES = CHAT_SCOPES.join(' ');
const KEEPALIVE = 30;
const BACKOFF = [1, 2, 5, 10, 30];

export interface ChatStore {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  login: string;
  scopes: string[];
  config: ChatVoteConfig;
  /** Resolved target channel. */
  channelId: string;
  channelLogin: string;
  channelName: string;
}
export const emptyChatStore = (): ChatStore => ({ clientId: '', accessToken: '', refreshToken: '', userId: '', login: '', scopes: [], config: defaultChatConfig(), channelId: '', channelLogin: '', channelName: '' });

export function sanitizeChatConfig(v: any): ChatVoteConfig {
  const d = defaultChatConfig();
  if (!v || typeof v !== 'object') return d;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    channel: sanitizeLogin(v.channel),
    command: v.command === undefined ? d.command : sanitizeCommand(v.command),
    methods: (['both', 'chat', 'web'] as VoteMethods[]).includes(v.methods) ? v.methods : d.methods,
    sharedChat: v.sharedChat === true,
  };
}
export function sanitizeChatStore(v: any): ChatStore {
  const d = emptyChatStore(), s = (x: unknown, n = 200) => (typeof x === 'string' ? x.slice(0, n) : '');
  if (!v || typeof v !== 'object') return d;
  return {
    clientId: s(v.clientId, 64).replace(/[^a-z0-9]/gi, ''), accessToken: s(v.accessToken), refreshToken: s(v.refreshToken),
    userId: s(v.userId, 32).replace(/\D/g, ''), login: s(v.login, 64), scopes: Array.isArray(v.scopes) ? v.scopes.filter((x: unknown) => typeof x === 'string').slice(0, 40) : [],
    config: sanitizeChatConfig(v.config), channelId: s(v.channelId, 32).replace(/\D/g, ''), channelLogin: sanitizeLogin(v.channelLogin), channelName: s(v.channelName, 64),
  };
}

type Conn = Pick<ChatStatus, 'clientId' | 'login' | 'userId' | 'scopes' | 'device' | 'conn' | 'error' | 'authNeeded' | 'channel' | 'config' | 'listeningSince' | 'lastEventAt'>;

export class TwitchChat {
  private ws: WebSocket | null = null;
  /** Socket opened for a session_reconnect, waiting for its welcome. */
  private next: WebSocket | null = null;
  private sessionId = '';
  private keepalive = KEEPALIVE;
  private lastMsgAt = 0;
  private watch: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;
  private attempt = 0;
  private validator: NodeJS.Timeout | null = null;
  private deviceTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<boolean> | null = null;
  /** Set when Twitch refused for a reason a retry cannot fix (auth, revoked): wait for the producer. */
  private blocked = false;
  private gen = 0;
  st: Conn;

  constructor(private store: ChatStore, private save: () => void, private onStatus: () => void, private onMessage: (m: ChatMsg) => void,
    private opts: { fetch?: typeof fetch; fallbackClientId?: () => string } = {}) {
    if (!store.clientId && env.TWITCH_CLIENT_ID) store.clientId = env.TWITCH_CLIENT_ID.replace(/[^a-z0-9]/gi, '');
    this.st = {
      clientId: this.clientId, login: store.login, userId: store.userId, scopes: store.scopes, device: null,
      conn: store.accessToken ? 'connecting' : 'signed-out', error: '', authNeeded: '',
      channel: store.channelId ? { login: store.channelLogin, id: store.channelId, name: store.channelName } : null,
      config: store.config, listeningSince: null, lastEventAt: null,
    };
  }

  private get f() { return this.opts.fetch ?? fetch; }
  /** This module's Client ID, else the predictions panel's one (same Public app works for both). */
  get clientId() { return this.store.clientId || this.opts.fallbackClientId?.() || ''; }

  /** Start (server boot): check the stored sign-in, find the channel, listen. */
  async start() {
    if (!this.store.accessToken) return this.set({ conn: 'signed-out' });
    if (await this.validate()) await this.resume();
    this.validator = setInterval(() => { if (this.store.accessToken) this.validate().catch(() => {}); }, 50 * 60_000);
    this.validator.unref?.();
  }
  stop() {
    this.gen++;
    for (const t of [this.watch, this.retry, this.deviceTimer]) if (t) clearTimeout(t);
    if (this.validator) clearInterval(this.validator);
    this.watch = this.retry = this.deviceTimer = this.validator = null;
    this.closeSockets();
  }

  private set(p: Partial<Conn>) { this.st = { ...this.st, ...p, clientId: this.clientId, config: this.store.config }; this.onStatus(); }

  // ------------------------------------------------------------------ OAuth

  private async form(u: string, body: Record<string, string>) {
    const r = await this.f(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(10000) });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  async connect() {
    if (!this.clientId) return this.set({ conn: 'signed-out', error: 'Enter the Client ID of your Twitch app first (dev.twitch.tv → Your Console → Applications, Client Type “Public”).' });
    try {
      const { ok, j } = await this.form(`${TWITCH_ID}/device`, { client_id: this.clientId, scopes: SCOPES });
      if (!ok || !j.device_code) throw new Error(j?.message ? `Twitch: ${j.message}` : 'Twitch refused the sign-in: check the Client ID, and that the app is “Public”.');
      this.set({ conn: 'signing-in', error: '', authNeeded: '', device: { code: String(j.user_code), uri: String(j.verification_uri || 'https://www.twitch.tv/activate'), expiresAt: Date.now() + (Number(j.expires_in) || 1800) * 1000 } });
      this.waitForDevice(String(j.device_code), Math.max(1, Number(j.interval) || 5));
    } catch (e) { this.set({ conn: 'signed-out', error: msg(e) }); }
  }

  private waitForDevice(deviceCode: string, interval: number) {
    if (this.deviceTimer) clearTimeout(this.deviceTimer);
    const code = this.st.device?.code;
    const tick = async () => {
      const dev = this.st.device;
      if (!dev || dev.code !== code) return; // cancelled or replaced by a newer sign-in
      if (Date.now() > dev.expiresAt) return this.set({ device: null, conn: 'signed-out', error: 'The sign-in code expired: press Sign in again.' });
      try {
        const { ok, j } = await this.form(`${TWITCH_ID}/token`, { client_id: this.clientId, scopes: SCOPES, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (ok && j.access_token) {
          Object.assign(this.store, { accessToken: String(j.access_token), refreshToken: String(j.refresh_token ?? ''), clientId: this.store.clientId || this.clientId });
          this.save();
          this.set({ device: null, error: '' });
          if (await this.validate()) { this.blocked = false; await this.resume(); }
          return;
        }
        const m = String(j?.message ?? '');
        if (!/authorization_pending|slow_down/i.test(m)) return this.set({ device: null, conn: 'signed-out', error: m ? `Twitch: ${m}` : 'Sign-in failed.' });
      } catch (e) { this.set({ error: msg(e) }); }
      this.deviceTimer = setTimeout(tick, interval * 1000);
    };
    this.deviceTimer = setTimeout(tick, interval * 1000);
  }

  /** Check the token (Twitch asks apps to do this hourly): who it is, which scopes it has. */
  async validate(retry = true): Promise<boolean> {
    try {
      const r = await this.f(`${TWITCH_ID}/validate`, { headers: { Authorization: `OAuth ${this.store.accessToken}` }, signal: AbortSignal.timeout(10000) });
      if (r.status === 401) {
        if (retry && (await this.refresh())) return this.validate(false);
        this.signOut('The Twitch sign-in expired or was disconnected: sign in again.'); return false;
      }
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Twitch HTTP ${r.status}`);
      const scopes: string[] = Array.isArray(j.scopes) ? j.scopes.map(String) : [];
      const changed = this.store.userId && String(j.user_id) !== this.store.userId;
      Object.assign(this.store, { userId: String(j.user_id ?? ''), login: String(j.login ?? ''), scopes });
      this.save();
      const missing = CHAT_SCOPES.filter(s => !scopes.includes(s));
      if (missing.length) {
        this.blocked = true; this.closeSockets();
        this.set({ login: this.store.login, userId: this.store.userId, scopes, conn: 'needs-auth', authNeeded: `The sign-in of ${this.store.login} is missing the ${missing.join(', ')} permission: sign out and sign in again.` });
        return false;
      }
      this.set({ login: this.store.login, userId: this.store.userId, scopes, ...(this.st.conn === 'needs-auth' && !this.blocked ? { authNeeded: '' } : {}) });
      if (changed) this.restart();
      return true;
    } catch (e) { this.set({ error: `Twitch not reachable: ${msg(e)}` }); return !!this.store.userId; }
  }

  private refresh(): Promise<boolean> {
    if (!this.store.refreshToken) return Promise.resolve(false);
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const { ok, j } = await this.form(`${TWITCH_ID}/token`, { client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.store.refreshToken });
        if (!ok || !j.access_token) return false;
        this.store.accessToken = String(j.access_token);
        if (j.refresh_token) this.store.refreshToken = String(j.refresh_token);
        this.save(); return true;
      } catch { return false; } finally { setTimeout(() => (this.refreshing = null), 0); }
    })();
    return this.refreshing;
  }

  signOut(error = '') {
    const tok = this.store.accessToken, cid = this.clientId;
    Object.assign(this.store, { accessToken: '', refreshToken: '', userId: '', login: '', scopes: [] });
    this.save();
    this.closeSockets();
    if (this.deviceTimer) clearTimeout(this.deviceTimer);
    // Revoke on Twitch too when the producer signs out (best effort).
    if (tok && cid && !error) this.f(`${TWITCH_ID}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cid, token: tok }).toString() }).catch(() => {});
    this.set({ login: '', userId: '', scopes: [], device: null, conn: 'signed-out', error, authNeeded: '', listeningSince: null });
  }

  private async helix(method: string, path: string, body?: unknown, retry = true): Promise<{ status: number; j: any }> {
    const r = await this.f(`${TWITCH_HELIX}${path}`, {
      method, headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${this.store.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 && retry && (await this.refresh())) return this.helix(method, path, body, false);
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }

  // ------------------------------------------------------------------ channel + config

  async configure(patch: Partial<ChatVoteConfig>) {
    const prev = this.store.config;
    this.store.config = sanitizeChatConfig({ ...prev, ...patch });
    if (this.store.config.channel !== this.store.channelLogin) Object.assign(this.store, { channelId: '', channelLogin: '', channelName: '' });
    this.save();
    this.set({});
    if (prev.channel !== this.store.config.channel || prev.enabled !== this.store.config.enabled) { this.blocked = false; await this.resume(true); }
  }

  /** Find the channel's ID from its login (no permission needed). */
  private async resolveChannel(): Promise<boolean> {
    const login = this.store.config.channel;
    if (!login) { this.set({ channel: null, conn: 'no-channel', error: '' }); return false; }
    if (this.store.channelId && this.store.channelLogin === login) { this.set({ channel: { login, id: this.store.channelId, name: this.store.channelName } }); return true; }
    try {
      const { status, j } = await this.helix('GET', `/users?login=${encodeURIComponent(login)}`);
      if (status === 401) { this.signOut('The Twitch sign-in expired or was disconnected: sign in again.'); return false; }
      const u = j?.data?.[0];
      if (status !== 200 || !u?.id) { this.set({ channel: null, conn: 'error', error: status === 200 ? `No Twitch channel called “${login}”. Check the spelling.` : `Twitch: ${j?.message ?? `HTTP ${status}`}` }); return false; }
      Object.assign(this.store, { channelId: String(u.id), channelLogin: login, channelName: String(u.display_name || login) });
      this.save();
      this.set({ channel: { login, id: this.store.channelId, name: this.store.channelName }, error: '' });
      return true;
    } catch (e) { this.set({ conn: 'error', error: `Twitch not reachable: ${msg(e)}` }); this.later(); return false; }
  }

  /** (Re)start listening if everything needed is there. */
  async resume(fresh = false) {
    if (fresh) this.restart(false);
    if (!this.store.accessToken) return this.set({ conn: 'signed-out' });
    if (this.blocked) return;
    if (!(await this.resolveChannel())) return;
    if (!this.store.config.enabled) { this.closeSockets(); return this.set({ conn: 'stopped', listeningSince: null }); }
    if (!this.ws) this.open();
  }

  /** Producer pressed Reconnect, or the account changed. */
  restart(go = true) {
    this.blocked = false; this.attempt = 0;
    this.closeSockets();
    if (go) this.resume().catch(() => {});
  }

  // ------------------------------------------------------------------ EventSub WebSocket

  private closeSockets() {
    this.gen++;
    for (const s of [this.ws, this.next]) if (s) { s.removeAllListeners(); s.on('error', () => {}); try { s.close(1000); } catch { /* closing */ } }
    this.ws = this.next = null; this.sessionId = '';
    if (this.watch) clearInterval(this.watch); this.watch = null;
    if (this.retry) clearTimeout(this.retry); this.retry = null;
  }

  private open(u = `${TWITCH_EVENTSUB}?keepalive_timeout_seconds=${KEEPALIVE}`, reconnect = false) {
    const g = this.gen;
    const s = new WebSocket(u);
    if (reconnect) this.next = s; else { this.ws = s; this.set({ conn: this.st.listeningSince ? 'reconnecting' : 'connecting' }); }
    s.on('message', data => { if (g === this.gen) this.onFrame(s, String(data)).catch(e => this.set({ error: msg(e) })); });
    s.on('error', e => { if (g === this.gen && s === this.ws) this.set({ error: `Chat connection: ${msg(e)}` }); });
    s.on('close', (code, reason) => {
      if (g !== this.gen) return;
      if (s === this.next) { this.next = null; return; } // a failed reconnect: the old socket is still there
      if (s !== this.ws) return;
      this.ws = null; this.sessionId = '';
      if (this.blocked) return;
      const why: Record<number, string> = { 4000: 'Twitch server error', 4001: 'client sent a message', 4002: 'ping timeout', 4003: 'no subscription in time', 4004: 'reconnect window missed', 4005: 'network timeout', 4006: 'network error', 4007: 'invalid reconnect URL' };
      this.set({ conn: 'reconnecting', error: `Chat connection closed (${why[code] ?? `code ${code}`}${reason?.length ? `: ${String(reason)}` : ''}). Reconnecting…` });
      this.later();
    });
    if (!this.watch) {
      this.lastMsgAt = Date.now();
      this.watch = setInterval(() => {
        // Twitch: no message for longer than the keepalive window = the connection is gone.
        if (this.ws && Date.now() - this.lastMsgAt > (this.keepalive + 5) * 1000) {
          this.set({ conn: 'reconnecting', error: 'No keepalive from Twitch: reconnecting…' });
          this.closeSockets(); this.later(0);
        }
      }, 1000);
      this.watch.unref?.();
    }
  }

  private later(sec?: number) {
    if (this.retry) clearTimeout(this.retry);
    const wait = sec ?? BACKOFF[Math.min(this.attempt++, BACKOFF.length - 1)];
    this.retry = setTimeout(() => { this.retry = null; this.resume().catch(() => {}); }, wait * 1000);
    this.retry.unref?.();
  }

  private async onFrame(s: WebSocket, raw: string) {
    let m: any; try { m = JSON.parse(raw); } catch { return; }
    const type = m?.metadata?.message_type, session = m?.payload?.session;
    if (s === this.ws || (s === this.next && type === 'session_welcome')) this.lastMsgAt = Date.now();
    switch (type) {
      case 'session_welcome': {
        this.keepalive = Number(session?.keepalive_timeout_seconds) || KEEPALIVE;
        if (s === this.next) { // reconnect done: same subscriptions, drop the old socket
          const old = this.ws; this.ws = s; this.next = null; this.sessionId = String(session?.id ?? '');
          if (old) { old.removeAllListeners(); old.on('error', () => {}); try { old.close(1000); } catch { /* closing */ } }
          return this.set({ conn: 'listening', error: '' });
        }
        this.sessionId = String(session?.id ?? '');
        return this.subscribe();
      }
      case 'session_keepalive': return;
      case 'session_reconnect': if (s === this.ws && session?.reconnect_url) this.open(String(session.reconnect_url), true); return;
      case 'revocation': {
        const st = String(m?.payload?.subscription?.status ?? '');
        this.blocked = true; this.closeSockets();
        return this.set({ conn: 'needs-auth', listeningSince: null, authNeeded: st === 'authorization_revoked'
          ? `${this.store.login} removed this app's access on Twitch: sign in again.`
          : st === 'user_removed' ? `Twitch ended the chat subscription: the channel or ${this.store.login} is no longer available (banned, suspended or deleted).`
          : `Twitch ended the chat subscription (${st || 'revoked'}). Press Reconnect.` });
      }
      case 'notification': {
        if (s !== this.ws || m?.metadata?.subscription_type !== 'channel.chat.message') return;
        const c = chatMsgOf(m.payload?.event, String(m.metadata?.message_id ?? ''), Date.now());
        if (c) { this.st.lastEventAt = c.at; this.onMessage(c); }
      }
    }
  }

  private async subscribe() {
    const body = { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.store.channelId, user_id: this.store.userId }, transport: { method: 'websocket', session_id: this.sessionId } };
    try {
      const { status, j } = await this.helix('POST', '/eventsub/subscriptions', body);
      const ch = this.store.channelName || this.store.channelLogin, me = this.store.login;
      if (status === 202 || status === 409) { this.attempt = 0; return this.set({ conn: 'listening', error: '', authNeeded: '', listeningSince: Date.now() }); }
      const why = String(j?.message ?? `HTTP ${status}`);
      if (status === 401) { this.signOut('The Twitch sign-in expired or was disconnected: sign in again.'); return; }
      if (status === 403) {
        this.blocked = true; this.closeSockets();
        return this.set({ conn: 'needs-auth', listeningSince: null, authNeeded:
          `Twitch refused to let ${me} read ${ch}'s chat (${why}). Reading chat needs only the user:read:chat permission from ${me} ` +
          `(no permission from ${ch}'s owner): sign out and sign in again to grant it. If ${me} is banned or timed out in ${ch}, use another account.` });
      }
      if (status === 429) { this.closeSockets(); this.set({ conn: 'error', error: `Twitch: too many chat connections for ${me} (${why}). Close other bots or tools signed in as ${me}, then Reconnect.` }); this.later(30); return; }
      this.blocked = status === 400; this.closeSockets();
      this.set({ conn: 'error', error: `Twitch refused the chat subscription: ${why}` });
      if (!this.blocked) this.later();
    } catch (e) { this.closeSockets(); this.set({ conn: 'reconnecting', error: `Twitch not reachable: ${msg(e)}` }); this.later(); }
  }

  /** Producer view (no tokens). */
  status(): Conn { return { ...this.st, clientId: this.clientId, config: this.store.config, conn: this.st.conn as ChatConn }; }
  setClientId(id: string) { this.store.clientId = String(id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 64); this.save(); this.set({}); }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e ?? '')).slice(0, 200);

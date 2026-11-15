/**
 * A local stand-in for Twitch (tests and rehearsal only): OAuth device flow, token validation/refresh, Helix
 * users + EventSub subscriptions, and the EventSub WebSocket (welcome, keepalive, notification, session_reconnect,
 * revocation, close codes). It follows the documented behaviour; the real Twitch is the reference.
 *
 * Point the server at it with TWITCH_ID_URL=http://127.0.0.1:<port>/oauth2, TWITCH_HELIX_URL=http://127.0.0.1:<port>/helix,
 * TWITCH_EVENTSUB_URL=ws://127.0.0.1:<port>/ws.
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface MockUser { id: string; login: string; name: string }
export interface MockTwitch {
  port: number; base: string;
  users: MockUser[];
  /** token → { user, scopes } */
  tokens: Map<string, { user: string; scopes: string[] }>;
  /** Next device sign-in grants this user + scopes. */
  grant: { user: string; scopes: string[] };
  /** Channel ID → logins banned there (subscribe answers 403). */
  banned: Map<string, string[]>;
  subs: { id: string; session: string; broadcaster: string; user: string; token: string }[];
  sessions: Map<string, WebSocket>;
  /** Keepalive seconds sent in welcome (0 = never send keepalives). */
  keepalive: number;
  sendKeepalives: boolean;
  /** Next subscribe answers this status (once). */
  failNext: { status: number; message: string } | null;
  chat(channelId: string, from: MockUser, text: string, extra?: Record<string, unknown>): number;
  reconnect(): void;
  revoke(status: string): void;
  closeAll(code: number): void;
  close(): Promise<void>;
  log: string[];
}

export async function startMockTwitch(): Promise<MockTwitch> {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const m = {
    users: [], tokens: new Map(), grant: { user: '', scopes: ['user:read:chat'] }, banned: new Map(), subs: [], sessions: new Map(),
    keepalive: 10, sendKeepalives: true, failNext: null, log: [],
  } as unknown as MockTwitch;
  const pending = new Map<string, number>();
  const refresh = new Map<string, { user: string; scopes: string[] }>();
  const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const issue = (user: string, scopes: string[]) => { const t = id('tok'), r = id('ref'); m.tokens.set(t, { user, scopes }); refresh.set(r, { user, scopes }); return { access_token: t, refresh_token: r, scope: scopes, token_type: 'bearer', expires_in: 14000 }; };

  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x'), form = new URLSearchParams(raw);
      m.log.push(`${req.method} ${u.pathname}`);
      const bearer = String(req.headers.authorization ?? '').replace(/^(Bearer|OAuth) /, '');
      if (u.pathname === '/oauth2/device') { const dc = id('dc'); pending.set(dc, 0); return json(res, 200, { device_code: dc, user_code: 'ABCD-1234', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD-1234', expires_in: 1800, interval: 1 }); }
      if (u.pathname === '/oauth2/token') {
        if (form.get('grant_type') === 'refresh_token') { const r = form.get('refresh_token') ?? ''; const g = refresh.get(r); if (!g) return json(res, 400, { status: 400, message: 'Invalid refresh token' }); refresh.delete(r); return json(res, 200, issue(g.user, g.scopes)); }
        const dc = form.get('device_code') ?? '';
        if (!pending.has(dc)) return json(res, 400, { status: 400, message: 'invalid device code' });
        const tries = pending.get(dc)! + 1; pending.set(dc, tries);
        if (tries < 2) return json(res, 400, { status: 400, message: 'authorization_pending' });
        pending.delete(dc); return json(res, 200, issue(m.grant.user, m.grant.scopes));
      }
      if (u.pathname === '/oauth2/validate') { const t = m.tokens.get(bearer); if (!t) return json(res, 401, { status: 401, message: 'invalid access token' }); const usr = m.users.find(x => x.id === t.user)!; return json(res, 200, { client_id: 'cid', login: usr.login, user_id: usr.id, scopes: t.scopes, expires_in: 9000 }); }
      if (u.pathname === '/oauth2/revoke') { m.tokens.delete(form.get('token') ?? ''); return json(res, 200, {}); }
      const tok = m.tokens.get(bearer);
      if (u.pathname.startsWith('/helix/') && !tok) return json(res, 401, { error: 'Unauthorized', status: 401, message: 'Invalid OAuth token' });
      if (u.pathname === '/helix/users') { const login = u.searchParams.get('login'); return json(res, 200, { data: m.users.filter(x => x.login === login).map(x => ({ id: x.id, login: x.login, display_name: x.name })) }); }
      if (u.pathname === '/helix/eventsub/subscriptions' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}');
        if (m.failNext) { const f = m.failNext; m.failNext = null; return json(res, f.status, { error: 'x', status: f.status, message: f.message }); }
        if (b.type !== 'channel.chat.message' || b.version !== '1') return json(res, 400, { status: 400, message: 'unknown type' });
        if (!tok!.scopes.includes('user:read:chat')) return json(res, 403, { error: 'Forbidden', status: 403, message: 'subscription missing proper authorization' });
        if (b.condition?.user_id !== tok!.user) return json(res, 403, { error: 'Forbidden', status: 403, message: 'subscription missing proper authorization' });
        if (!m.users.some(x => x.id === b.condition?.broadcaster_user_id)) return json(res, 400, { status: 400, message: 'cannot create a subscription for a user that does not exist' });
        const login = m.users.find(x => x.id === tok!.user)!.login;
        if ((m.banned.get(b.condition.broadcaster_user_id) ?? []).includes(login)) return json(res, 403, { error: 'Forbidden', status: 403, message: 'subscription missing proper authorization' });
        if (!m.sessions.has(b.transport?.session_id)) return json(res, 400, { status: 400, message: 'websocket transport session does not exist or has already disconnected' });
        const s = { id: id('sub'), session: b.transport.session_id, broadcaster: b.condition.broadcaster_user_id, user: b.condition.user_id, token: bearer };
        m.subs.push(s);
        return json(res, 202, { data: [{ id: s.id, status: 'enabled', type: b.type, version: '1', condition: b.condition, transport: b.transport }], total: m.subs.length, total_cost: 0, max_total_cost: 10 });
      }
      json(res, 404, { status: 404, message: 'not found' });
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  const timers = new Map<WebSocket, NodeJS.Timeout>();
  const welcome = (ws: WebSocket, session: string) => ws.send(JSON.stringify({ metadata: { message_id: id('m'), message_type: 'session_welcome', message_timestamp: new Date().toISOString() }, payload: { session: { id: session, status: 'connected', connected_at: new Date().toISOString(), keepalive_timeout_seconds: m.keepalive, reconnect_url: null } } }));
  server.on('upgrade', (req, sock, head) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname !== '/ws') return sock.destroy();
    wss.handleUpgrade(req, sock, head, ws => {
      // A reconnect URL carries the old session: the new socket takes over its subscriptions.
      const old = u.searchParams.get('reconnect');
      const session = old ?? id('sess');
      if (old) { const prev = m.sessions.get(old); m.sessions.set(old, ws); setTimeout(() => prev?.readyState === WebSocket.OPEN && prev.close(4004), 30000).unref(); }
      else m.sessions.set(session, ws);
      (ws as any).session = session;
      welcome(ws, session);
      const t = setInterval(() => { if (m.sendKeepalives && m.sessions.get(session) === ws) ws.send(JSON.stringify({ metadata: { message_id: id('m'), message_type: 'session_keepalive', message_timestamp: new Date().toISOString() }, payload: {} })); }, Math.max(200, m.keepalive * 1000 * 0.6));
      timers.set(ws, t);
      ws.on('message', () => ws.close(4001));
      ws.on('close', () => { clearInterval(timers.get(ws)); if (m.sessions.get(session) === ws) { m.sessions.delete(session); m.subs = m.subs.filter(s => s.session !== session); } });
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  Object.assign(m, {
    port, base: `http://127.0.0.1:${port}`,
    chat(channelId: string, from: MockUser, text: string, extra: Record<string, unknown> = {}) {
      let sent = 0;
      for (const s of m.subs.filter(x => x.broadcaster === channelId)) {
        const ws = m.sessions.get(s.session); if (!ws || ws.readyState !== WebSocket.OPEN) continue;
        const ch = m.users.find(x => x.id === channelId)!;
        ws.send(JSON.stringify({ metadata: { message_id: id('evt'), message_type: 'notification', message_timestamp: new Date().toISOString(), subscription_type: 'channel.chat.message', subscription_version: '1' },
          payload: { subscription: { id: s.id, type: 'channel.chat.message', version: '1', status: 'enabled', cost: 0, condition: { broadcaster_user_id: channelId, user_id: s.user } },
            event: { broadcaster_user_id: channelId, broadcaster_user_login: ch.login, broadcaster_user_name: ch.name, chatter_user_id: from.id, chatter_user_login: from.login, chatter_user_name: from.name,
              message_id: (extra.message_id as string) ?? id('chat'), message: { text, fragments: [{ type: 'text', text }] }, message_type: 'text', badges: [], color: '', cheer: null, reply: null, channel_points_custom_reward_id: null,
              source_broadcaster_user_id: null, source_broadcaster_user_login: null, source_broadcaster_user_name: null, source_message_id: null, source_badges: null, ...extra } } }));
        sent++;
      }
      return sent;
    },
    reconnect() { for (const [s, ws] of m.sessions) ws.send(JSON.stringify({ metadata: { message_id: id('m'), message_type: 'session_reconnect', message_timestamp: new Date().toISOString() }, payload: { session: { id: s, status: 'reconnecting', keepalive_timeout_seconds: null, reconnect_url: `ws://127.0.0.1:${port}/ws?reconnect=${s}`, connected_at: new Date().toISOString() } } })); },
    revoke(status: string) { for (const s of m.subs) m.sessions.get(s.session)?.send(JSON.stringify({ metadata: { message_id: id('m'), message_type: 'revocation', message_timestamp: new Date().toISOString(), subscription_type: 'channel.chat.message', subscription_version: '1' }, payload: { subscription: { id: s.id, status, type: 'channel.chat.message', version: '1', cost: 0, condition: { broadcaster_user_id: s.broadcaster, user_id: s.user }, transport: { method: 'websocket', session_id: s.session } } } })); m.subs = []; },
    closeAll(code: number) { for (const ws of m.sessions.values()) ws.close(code); },
    async close() { for (const ws of wss.clients) ws.terminate(); for (const t of timers.values()) clearInterval(t); await new Promise<void>(r => server.close(() => r())); },
  });
  return m;
}

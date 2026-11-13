/**
 * Overdrive vote service: the public Pick'ems + Community MVP page and its API, separate from the broadcast server so
 * public traffic can never slow the graphics. Postgres is the only store (votes survive redeploys).
 *
 *   Public   GET /, /vote            the voting page (vote.html from the client build)
 *            GET /v1/state            matches, open poll, revealed results, the viewer's own picks
 *            POST /v1/pick | /v1/champion | /v1/mvp
 *            GET /auth/twitch → Twitch → /auth/callback → POST /auth/token   (sign-in; the token is checked and revoked)
 *   Internal (x-vote-secret header, broadcast server only)
 *            PUT /internal/session · POST /internal/reveal-match · POST /internal/poll · POST /internal/poll/:id/:action
 *            GET /internal/summary
 *
 * Env: DATABASE_URL, VOTE_SECRET (≥ 24 chars), TWITCH_CLIENT_ID, PUBLIC_URL, PORT.
 *      VOTE_DEV_LOGIN=1 (never in production) enables POST /auth/dev for local tests.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { audit, openDb, tx, type Db } from './db';
import { MAJOR_TEAMS } from '../shared/major';
import { PICK_SCORES_BO5, communityPick, isMajorTeam, matchStatus, pickScore, teamRoster, type AudAccuracy, type AudMatchIn, type AudMatchTotals, type AudPoll, type AudSessionIn, type AudSummary } from '../shared/audience';

const env = process.env;
const PORT = Number(env.PORT || 8790);
const SECRET = env.VOTE_SECRET || '';
const CLIENT_ID = env.TWITCH_CLIENT_ID || '';
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PROD = env.NODE_ENV === 'production' || !!env.RENDER;
const DEV_LOGIN = env.VOTE_DEV_LOGIN === '1' && !PROD;
/** Writes a minute per IP address. High on purpose: a venue's wifi or a mobile carrier puts many viewers behind one
 * address; the per-account limit (30 a minute) is what stops a single voter. */
const IP_WRITES = Number(env.VOTE_IP_LIMIT || 1200);
if (SECRET.length < 24) { console.error('[vote] VOTE_SECRET must be set (24+ characters)'); process.exit(1); }
if (!env.DATABASE_URL) { console.error('[vote] DATABASE_URL must be set'); process.exit(1); }

const db: Db = await openDb(env.DATABASE_URL);
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const small = express.json({ limit: '8kb' }), big = express.json({ limit: '64kb' });
app.use((req, res, next) => (req.path.startsWith('/internal/') ? big : small)(req, res, next));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ------------------------------------------------------------------ rate limits (single instance: memory is fine)

const buckets = new Map<string, { n: number; t: number }>();
/** Token bucket: `per` requests a minute, bursts up to `per`. */
function allow(key: string, per: number): boolean {
  const now = Date.now(), b = buckets.get(key) ?? { n: per, t: now };
  b.n = Math.min(per, b.n + ((now - b.t) / 60000) * per); b.t = now;
  if (b.n < 1) { buckets.set(key, b); return false; }
  b.n -= 1; buckets.set(key, b); return true;
}
setInterval(() => { const old = Date.now() - 120000; for (const [k, b] of buckets) if (b.t < old) buckets.delete(k); }, 60000).unref();
const ip = (req: Request) => req.ip || 'unknown';
function limit(per: number) {
  return (req: Request, res: Response, next: NextFunction) => (allow('ip:' + ip(req), per) ? next() : res.status(429).json({ ok: false, error: 'Too many requests, wait a moment' }));
}

// ------------------------------------------------------------------ viewer sessions

const COOKIE = 'odv';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const cookies = (req: Request) => Object.fromEntries((req.headers.cookie ?? '').split(';').map(x => x.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const secureCookie = PUBLIC_URL.startsWith('https://');
const setCookie = (res: Response, name: string, value: string, maxAge: number) =>
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}`);

interface Viewer { id: number; name: string }
async function viewerOf(req: Request): Promise<Viewer | null> {
  const t = cookies(req)[COOKIE];
  if (!t || t.length < 20) return null;
  const r = await db.query('select v.id, v.name from viewer_sessions s join viewers v on v.id = s.viewer where s.token_hash = $1 and s.expires > now()', [sha(t)]);
  return r.rows[0] ? { id: Number(r.rows[0].id), name: r.rows[0].name } : null;
}
async function signIn(res: Response, twitchId: string, name: string) {
  const v = await db.query('insert into viewers(twitch_id, name) values ($1,$2) on conflict (twitch_id) do update set name = excluded.name returning id', [twitchId, name.slice(0, 40)]);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("insert into viewer_sessions(token_hash, viewer, expires) values ($1,$2, now() + interval '30 days')", [sha(token), v.rows[0].id]);
  setCookie(res, COOKIE, token, 30 * 86400);
}
const needViewer = async (req: Request, res: Response): Promise<Viewer | null> => {
  const v = await viewerOf(req);
  if (!v) { res.status(401).json({ ok: false, error: 'Sign in with Twitch to vote' }); return null; }
  if (!allow('v:' + v.id, 30)) { res.status(429).json({ ok: false, error: 'Too many votes, wait a moment' }); return null; }
  return v;
};

// Twitch sign-in: implicit grant with the existing public Twitch app (no client secret). The token only proves who the
// viewer is: it is validated, the Twitch id + display name are kept, and the token is revoked at once.
app.get('/auth/twitch', limit(30), (req, res) => {
  if (!CLIENT_ID) return res.status(503).send('Twitch sign-in is not configured');
  const state = crypto.randomBytes(16).toString('base64url');
  setCookie(res, 'odv_state', state, 600);
  const u = new URL('https://id.twitch.tv/oauth2/authorize');
  u.searchParams.set('client_id', CLIENT_ID); u.searchParams.set('redirect_uri', `${PUBLIC_URL}/auth/callback`);
  u.searchParams.set('response_type', 'token'); u.searchParams.set('scope', ''); u.searchParams.set('state', state);
  res.redirect(u.toString());
});
app.get('/auth/callback', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Signing in…</title>
<body style="background:#120806;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh"><p id="m">Signing in…</p><script>
const h=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'','/auth/callback');
fetch('/auth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:h.get('access_token')||'',state:h.get('state')||''})})
.then(r=>r.json()).then(j=>{if(j.ok)location.replace('/vote');else document.getElementById('m').textContent=j.error||'Sign-in failed'})
.catch(()=>document.getElementById('m').textContent='Sign-in failed');</script>`);
});
app.post('/auth/token', limit(20), async (req, res) => {
  const { token, state } = req.body ?? {};
  if (typeof token !== 'string' || !token || typeof state !== 'string' || state !== cookies(req).odv_state) return res.status(400).json({ ok: false, error: 'Sign-in expired, try again' });
  setCookie(res, 'odv_state', '', 0);
  try {
    const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
    const j: any = await v.json();
    if (!v.ok || j.client_id !== CLIENT_ID || !j.user_id) return res.status(401).json({ ok: false, error: 'Twitch did not confirm the sign-in' });
    let name = String(j.login || 'viewer');
    const u = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${token}`, 'Client-Id': CLIENT_ID } }).catch(() => null);
    if (u?.ok) { const uj: any = await u.json(); name = uj.data?.[0]?.display_name || name; }
    fetch('https://id.twitch.tv/oauth2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `client_id=${CLIENT_ID}&token=${encodeURIComponent(token)}` }).catch(() => {});
    await signIn(res, String(j.user_id), name);
    res.json({ ok: true });
  } catch { res.status(502).json({ ok: false, error: 'Twitch is not reachable, try again' }); }
});
app.post('/auth/logout', async (req, res) => {
  const t = cookies(req)[COOKIE];
  if (t) await db.query('delete from viewer_sessions where token_hash = $1', [sha(t)]);
  setCookie(res, COOKIE, '', 0); res.json({ ok: true });
});
if (DEV_LOGIN) {
  console.warn('[vote] DEV LOGIN ENABLED (test only)');
  app.post('/auth/dev', async (req, res) => {
    const name = String(req.body?.name ?? '').replace(/[^\w-]/g, '').slice(0, 30);
    if (!name) return res.status(400).json({ ok: false });
    await signIn(res, 'dev:' + name, name); res.json({ ok: true });
  });
}

// ------------------------------------------------------------------ current session

async function current(): Promise<string | null> {
  const r = await db.query("select v from meta where k = 'session'");
  return r.rows[0]?.v ?? null;
}
const bestOf = (n: number) => (n === 5 ? PICK_SCORES_BO5 : ([] as readonly string[]));

async function matchesOf(session: string) {
  const r = await db.query('select * from matches where session = $1 and listed order by ord', [session]);
  return r.rows.map(m => ({ ...m, status: matchStatus(m) }));
}
async function totals(session: string): Promise<AudMatchTotals[]> {
  const ms = await matchesOf(session);
  const t = await db.query('select match, team, score, count(*)::int n from picks where session = $1 group by match, team, score', [session]);
  return ms.map(m => {
    const rows = t.rows.filter(r => r.match === m.id), byTeam: Record<string, number> = { [m.a]: 0, [m.b]: 0 }, byScore: Record<string, number> = {};
    for (const r of rows) { byTeam[r.team] = (byTeam[r.team] ?? 0) + r.n; if (r.score) byScore[`${r.team} ${r.score}`] = (byScore[`${r.team} ${r.score}`] ?? 0) + r.n; }
    return { id: m.id, status: m.status, total: rows.reduce((a, r) => a + r.n, 0), byTeam, byScore, revealed: m.revealed || m.status === 'final' };
  });
}
function accuracyOf(ms: { id: string; winner: string | null; score: string | null }[], tot: AudMatchTotals[]): AudAccuracy {
  const a: AudAccuracy = { played: 0, right: 0, exact: 0, points: 0, marks: [] };
  for (const m of ms) {
    if (!m.winner) continue;
    const t = tot.find(x => x.id === m.id), c = t && communityPick(t);
    if (!c) continue;
    const p = pickScore(c, m.winner, m.score ?? '');
    a.played++; a.points += p; if (p) a.right++; if (p === 3) a.exact++; a.marks.push(p ? 'y' : 'n');
  }
  return a;
}
const POINTS_SQL = `select v.id, v.name, sum(case when p.team = m.winner then case when p.score <> '' and p.score = m.score then 3 else 1 end else 0 end)::int points,
  sum(case when p.team = m.winner then 1 else 0 end)::int right_, sum(case when p.team = m.winner and p.score <> '' and p.score = m.score then 1 else 0 end)::int exact, count(*)::int played
  from picks p join matches m on m.session = p.session and m.id = p.match join viewers v on v.id = p.viewer
  where p.session = $1 and m.winner is not null group by v.id, v.name`;

async function polls(session: string, priv: boolean): Promise<AudPoll[]> {
  const r = await db.query('select * from polls where session = $1 order by created', [session]);
  const c = priv ? await db.query('select v.poll, v.player, count(*)::int n from mvp_votes v join polls p on p.id = v.poll where p.session = $1 group by v.poll, v.player', [session]) : { rows: [] as any[] };
  return r.rows.map(p => {
    const counts: Record<string, number> = {};
    for (const x of c.rows) if (x.poll === p.id) counts[x.player] = x.n;
    const base: AudPoll = { id: p.id, match: p.match, label: p.label, result: p.result, players: p.players, status: p.status, openedAt: p.opened_at ? +p.opened_at : null, closedAt: p.closed_at ? +p.closed_at : null, frozen: p.frozen };
    return priv ? { ...base, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } : base;
  });
}

// ------------------------------------------------------------------ public API

// The shared part of the page state is the same for every viewer: computed at most once every 2 s, whatever the
// traffic (a few thousand phones polling cost a handful of queries a second).
let pub: { at: number; body: any; p: Promise<any> | null } = { at: 0, body: null, p: null };
async function publicState() {
  if (pub.body && Date.now() - pub.at < 2000) return pub.body;
  if (pub.p) return pub.p;
  pub.p = (async () => {
    const s = await current();
    if (!s) return { ok: true, session: null };
    const [ses, ms, tot, ps] = await Promise.all([db.query('select * from sessions where id = $1', [s]), matchesOf(s), totals(s), polls(s, false)]);
    return {
      ok: true, session: s, name: ses.rows[0]?.name ?? '', signIn: !!CLIENT_ID || DEV_LOGIN, dev: DEV_LOGIN,
      matches: ms.map(m => { const t = tot.find(x => x.id === m.id)!; return { id: m.id, label: m.label, a: m.a, b: m.b, bestOf: m.best_of, scores: bestOf(m.best_of), status: m.status, winner: m.winner, score: m.score, split: t.revealed ? { total: t.total, byTeam: t.byTeam } : null }; }),
      champion: { locked: ses.rows[0]?.champion_locked ?? true, teams: MAJOR_TEAMS.map(t => t.name) },
      polls: ps.filter(p => p.status === 'open' || p.status === 'revealed').map(p => ({ ...p, frozen: p.status === 'revealed' ? p.frozen : null })),
      accuracy: accuracyOf(ms, tot),
    };
  })();
  try { pub.body = await pub.p; pub.at = Date.now(); return pub.body; } finally { pub.p = null; }
}
const fresh = () => { pub.at = 0; };

app.get('/v1/state', limit(IP_WRITES * 2), async (_req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); res.json(await publicState()); }
  catch (e) { console.error('[vote] state', e); bad(res, 'Voting is paused, try again shortly', 503); }
});

app.get('/v1/me', limit(IP_WRITES), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const v = await viewerOf(req), s = await current();
  if (!v || !s) return res.json({ ok: true, me: null });
  const [p, c, mv, pts] = await Promise.all([
    db.query('select match, team, score from picks where session = $1 and viewer = $2', [s, v.id]),
    db.query('select team from champion_picks where session = $1 and viewer = $2', [s, v.id]),
    db.query('select poll, player from mvp_votes where viewer = $1', [v.id]),
    db.query(`with t as (${POINTS_SQL}) select (select points from t where id = $2) mine, (select count(*)::int from t where points > coalesce((select points from t where id = $2), 0)) above, (select count(*)::int from t) n`, [s, v.id]),
  ]);
  res.json({ ok: true, me: { name: v.name, picks: Object.fromEntries(p.rows.map(r => [r.match, { team: r.team, score: r.score }])), champion: c.rows[0]?.team ?? null,
    votes: Object.fromEntries(mv.rows.map(r => [r.poll, r.player])), points: pts.rows[0].mine ?? 0, rank: pts.rows[0].mine == null ? null : pts.rows[0].above + 1, ranked: pts.rows[0].n } });
});

const bad = (res: Response, error: string, code = 409) => res.status(code).json({ ok: false, error });

app.post('/v1/pick', limit(IP_WRITES), async (req, res) => {
  const v = await needViewer(req, res); if (!v) return;
  const { match, team } = req.body ?? {}; const score = typeof req.body?.score === 'string' ? req.body.score : '';
  const s = await current();
  if (!s || typeof match !== 'string' || typeof team !== 'string') return bad(res, 'Invalid pick', 400);
  try {
    const out = await tx(db, async c => {
      const m = (await c.query('select * from matches where session = $1 and id = $2 and listed for share', [s, match])).rows[0];
      if (!m) return 'Unknown match';
      if (matchStatus(m) !== 'open') return 'Picks for this match are locked';
      if (team !== m.a && team !== m.b) return 'That team is not in this match';
      if (score && !bestOf(m.best_of).includes(score)) return 'Invalid score';
      await c.query(`insert into picks(session, match, viewer, team, score) values ($1,$2,$3,$4,$5)
        on conflict (session, match, viewer) do update set team = excluded.team, score = excluded.score, updated = now()`, [s, match, v.id, team, score]);
      return null;
    });
    out ? bad(res, out, out.startsWith('Unknown') || out.startsWith('Invalid') || out.startsWith('That') ? 400 : 409) : res.json({ ok: true });
  } catch (e) { console.error('[vote] pick', e); bad(res, 'Voting is paused, try again shortly', 503); }
});

app.post('/v1/champion', limit(IP_WRITES), async (req, res) => {
  const v = await needViewer(req, res); if (!v) return;
  const team = req.body?.team, s = await current();
  if (!s || typeof team !== 'string' || !isMajorTeam(team)) return bad(res, 'Invalid team', 400);
  try {
    const out = await tx(db, async c => {
      const ses = (await c.query('select champion_locked from sessions where id = $1 for share', [s])).rows[0];
      if (!ses || ses.champion_locked) return 'Champion picks are locked';
      await c.query('insert into champion_picks(session, viewer, team) values ($1,$2,$3) on conflict (session, viewer) do update set team = excluded.team, updated = now()', [s, v.id, team]);
      return null;
    });
    out ? bad(res, out) : res.json({ ok: true });
  } catch (e) { console.error('[vote] champion', e); bad(res, 'Voting is paused, try again shortly', 503); }
});

app.post('/v1/mvp', limit(IP_WRITES), async (req, res) => {
  const v = await needViewer(req, res); if (!v) return;
  const { poll, player } = req.body ?? {};
  if (typeof poll !== 'string' || typeof player !== 'string') return bad(res, 'Invalid vote', 400);
  try {
    const out = await tx(db, async (c): Promise<{ error: string; code: number } | { player: string; already?: boolean }> => {
      const p = (await c.query('select status, players from polls where id = $1 for share', [poll])).rows[0];
      if (!p) return { error: 'Unknown vote', code: 400 };
      if (p.status !== 'open') return { error: 'Voting is closed', code: 409 };
      if (!p.players.some((x: any) => x.handle === player)) return { error: 'That player is not eligible', code: 400 };
      const ins = await c.query('insert into mvp_votes(poll, viewer, player) values ($1,$2,$3) on conflict (poll, viewer) do nothing returning player', [poll, v.id, player]);
      if (ins.rowCount) return { player };
      const had = await c.query('select player from mvp_votes where poll = $1 and viewer = $2', [poll, v.id]);
      return { player: had.rows[0].player, already: true };
    });
    'error' in out ? bad(res, out.error, out.code) : res.json({ ok: true, ...out });
  } catch (e) { console.error('[vote] mvp', e); bad(res, 'Voting is paused, try again shortly', 503); }
});

// ------------------------------------------------------------------ internal API (broadcast server)

function internal(req: Request, res: Response, next: NextFunction) {
  const h = String(req.headers['x-vote-secret'] ?? '');
  const a = Buffer.from(sha(h)), b = Buffer.from(sha(SECRET));
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}
const actor = (req: Request) => String(req.headers['x-vote-actor'] ?? 'producer').slice(0, 60);
const ID = /^[A-Za-z0-9_:-]{1,60}$/;

app.put('/internal/session', internal, async (req, res) => {
  const b = req.body as AudSessionIn;
  if (!b || !ID.test(b.session) || !Array.isArray(b.matches)) return bad(res, 'bad session', 400);
  const ms = b.matches.filter((m: AudMatchIn) => m && ID.test(m.id) && isMajorTeam(m.a) && isMajorTeam(m.b) && m.a !== m.b);
  await tx(db, async c => {
    const before = (await c.query('select * from sessions where id = $1', [b.session])).rows[0] ?? null;
    await c.query(`insert into sessions(id, name, champion_locked) values ($1,$2,$3) on conflict (id) do update set name = excluded.name, champion_locked = excluded.champion_locked, updated = now()`, [b.session, String(b.name).slice(0, 80), !!b.championLocked]);
    if (!before || before.champion_locked !== !!b.championLocked) await audit(c, actor(req), 'champion-lock', b.session, before?.champion_locked ?? null, !!b.championLocked);
    await c.query("insert into meta(k, v) values ('session', $1) on conflict (k) do update set v = excluded.v", [b.session]);
    const old = new Map((await c.query('select * from matches where session = $1', [b.session])).rows.map(r => [r.id, r]));
    await c.query('update matches set listed = false where session = $1', [b.session]);
    for (const [i, m] of ms.entries()) {
      const score = typeof m.score === 'string' && /^\d-\d$/.test(m.score) ? m.score : null, winner = m.winner === m.a || m.winner === m.b ? m.winner : null;
      // Teams of a match only change before anyone could pick it: picks for teams no longer in the match are dropped.
      const o = old.get(m.id);
      if (o && (o.a !== m.a || o.b !== m.b)) { await c.query('delete from picks where session = $1 and match = $2 and team <> all($3)', [b.session, m.id, [m.a, m.b]]); await audit(c, actor(req), 'match-teams', m.id, { a: o.a, b: o.b }, { a: m.a, b: m.b }); }
      if (o && (o.winner !== winner || o.score !== score)) await audit(c, actor(req), 'match-result', m.id, { winner: o.winner, score: o.score }, { winner, score });
      if (o && o.locked !== !!m.locked) await audit(c, actor(req), m.locked ? 'match-lock' : 'match-unlock', m.id, o.locked, !!m.locked);
      await c.query(`insert into matches(session, id, ord, label, a, b, best_of, live, locked, winner, score, listed) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
        on conflict (session, id) do update set ord = excluded.ord, label = excluded.label, a = excluded.a, b = excluded.b, best_of = excluded.best_of, live = excluded.live,
        locked = excluded.locked, winner = excluded.winner, score = excluded.score, listed = true, updated = now()`,
        [b.session, m.id, i, String(m.label).slice(0, 60), m.a, m.b, m.bestOf === 3 || m.bestOf === 7 ? m.bestOf : 5, !!m.live, !!m.locked, winner, score]);
    }
  });
  fresh(); res.json({ ok: true, matches: ms.length });
});

app.post('/internal/reveal-match', internal, async (req, res) => {
  const s = await current(), id = req.body?.match;
  if (!s || typeof id !== 'string') return bad(res, 'bad match', 400);
  const r = await db.query('update matches set revealed = true where session = $1 and id = $2 and not revealed returning id', [s, id]);
  if (r.rowCount) await audit(db, actor(req), 'community-reveal', id, false, true);
  fresh(); res.json({ ok: true });
});

app.post('/internal/poll', internal, async (req, res) => {
  const s = await current();
  const { match, label, result, players } = req.body ?? {};
  if (!s || typeof match !== 'string' || !Array.isArray(players)) return bad(res, 'bad poll', 400);
  const m = (await db.query('select * from matches where session = $1 and id = $2', [s, match])).rows[0];
  if (!m || !m.winner) return bad(res, 'MVP voting needs a finished match');
  const eligible = [...teamRoster(m.a), ...teamRoster(m.b)];
  const chosen = eligible.filter(p => players.includes(p.handle));
  if (chosen.length < 2) return bad(res, 'Choose at least two eligible players', 400);
  const out = await tx(db, async c => {
    const ex = (await c.query("select * from polls where session = $1 and match = $2 and status <> 'draft' order by created desc limit 1", [s, match])).rows[0];
    if (ex) return { id: ex.id as string, existing: true };
    await c.query("delete from polls where session = $1 and match = $2 and status = 'draft'", [s, match]);
    const id = `${s}:${match}:${crypto.randomBytes(3).toString('hex')}`;
    await c.query("insert into polls(id, session, match, label, result, players, status) values ($1,$2,$3,$4,$5,$6,'draft')", [id, s, match, String(label ?? m.label).slice(0, 60), String(result ?? '').slice(0, 80), JSON.stringify(chosen)]);
    await audit(c, actor(req), 'mvp-prepare', id, null, chosen);
    return { id, existing: false };
  });
  res.json({ ok: true, ...out });
});

app.post('/internal/poll/:id/:action', internal, async (req, res) => {
  const id = String(req.params.id), action = String(req.params.action);
  const flow: Record<string, [string, string]> = { open: ['draft', 'open'], close: ['open', 'closed'], reveal: ['closed', 'revealed'] };
  const f = flow[action];
  if (!f) return bad(res, 'bad action', 400);
  const out = await tx(db, async c => {
    const p = (await c.query('select * from polls where id = $1 for update', [id])).rows[0];
    if (!p) return 'Unknown poll';
    if (p.status === f[1]) return null; // repeated command: nothing to do
    if (p.status !== f[0]) return `Poll is ${p.status}`;
    if (action === 'open') await c.query("update polls set status = 'open', opened_at = now() where id = $1", [id]);
    else if (action === 'close') {
      // Freeze the result in the same transaction that stops voting: what is revealed is exactly what was counted.
      const n = await c.query('select player, count(*)::int n from mvp_votes where poll = $1 group by player', [id]);
      const counts: Record<string, number> = Object.fromEntries(p.players.map((x: any) => [x.handle, 0]));
      for (const r of n.rows) counts[r.player] = r.n;
      const total = Object.values(counts).reduce((a, b) => a + b, 0), at = Date.now();
      const frozen = { total, counts, at, hash: sha(JSON.stringify({ id, counts, total, at })).slice(0, 16) };
      await c.query("update polls set status = 'closed', closed_at = now(), frozen = $2 where id = $1", [id, JSON.stringify(frozen)]);
      await audit(c, actor(req), 'mvp-close', id, null, frozen);
      return null;
    } else await c.query("update polls set status = 'revealed' where id = $1", [id]);
    await audit(c, actor(req), 'mvp-' + action, id, p.status, f[1]);
    return null;
  });
  fresh(); out ? bad(res, out) : res.json({ ok: true });
});

app.get('/internal/summary', internal, async (_req, res) => {
  const s = await current();
  if (!s) return res.json({ ok: true, summary: null });
  const [ses, ms, tot, ps, ch, lb, nv] = await Promise.all([
    db.query('select * from sessions where id = $1', [s]), matchesOf(s), totals(s), polls(s, true),
    db.query('select team, count(*)::int n from champion_picks where session = $1 group by team', [s]),
    db.query(`${POINTS_SQL} order by points desc, exact desc, name limit 10`, [s]),
    db.query('select count(distinct viewer)::int n from (select viewer from picks where session = $1 union select viewer from champion_picks where session = $1) x', [s]),
  ]);
  const byTeam = Object.fromEntries(MAJOR_TEAMS.map(t => [t.name, 0]));
  for (const r of ch.rows) byTeam[r.team] = r.n;
  const summary: AudSummary = {
    at: Date.now(), session: s, matches: tot, polls: ps, accuracy: accuracyOf(ms, tot), viewers: nv.rows[0].n,
    champion: { total: ch.rows.reduce((a, r) => a + r.n, 0), byTeam, locked: ses.rows[0]?.champion_locked ?? true },
    leaderboard: lb.rows.map(r => ({ name: r.name, points: r.points, right: r.right_, exact: r.exact, played: r.played })),
  };
  res.json({ ok: true, summary });
});

// ------------------------------------------------------------------ health + page

app.get('/healthz', async (_req, res) => {
  try { await db.query('select 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false, error: 'database unavailable' }); }
});

const here = path.dirname(fileURLToPath(import.meta.url));
const client = [path.join(here, 'client'), path.join(here, '..', 'dist', 'client')].find(p => fs.existsSync(path.join(p, 'vote.html')));
if (client) {
  for (const dir of ['assets', 'fonts', 'brand']) app.use('/' + dir, express.static(path.join(client, dir), { maxAge: '7d', fallthrough: false }));
  const page = (_req: Request, res: Response) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(client, 'vote.html')); };
  app.get('/', page); app.get('/vote', page);
} else console.warn('[vote] no client build found (vote.html): API only');

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.too.large') return bad(res, 'Request too large', 413);
  if (err?.type === 'entity.parse.failed') return bad(res, 'Invalid request', 400);
  console.error('[vote]', err?.message ?? err); bad(res, 'Voting is paused, try again shortly', 503);
});

app.listen(PORT, () => console.log(`[vote] listening on ${PORT} · public ${PUBLIC_URL}`));

/**
 * Overdrive 3.0 · LOCAL MVP voting. The same internal protocol as the online vote service (vote/server.ts), answered
 * inside this server, so MVP works with no vote service deployed (or while it is down, if the producer switches):
 *
 *   PUT  /internal/session              bracket (finished matches decide who may be voted for)
 *   GET  /internal/summary              polls with PRIVATE live counts (producer only)
 *   POST /internal/poll                 prepare candidates (draft)
 *   POST /internal/poll/:id/open|close|reveal   draft → open → closed (result FROZEN at close) → revealed
 *   POST /internal/poll/:id/timer       countdown
 *   POST /internal/poll/:id/methods     website / Twitch chat
 *   POST /internal/poll/:id/chat-votes  Twitch chat votes (one per Twitch account, first wins, late votes refused)
 *   POST /internal/reveal-match         (no public site here: accepted, nothing to do)
 *
 * Votes come from Twitch chat (the existing chat voting) and from REHEARSAL (simulated votes, clearly counted apart:
 * `bySource.sim`). A public website vote needs the online vote service (Twitch sign-in, Postgres, a public address).
 * Same rules as the service: a poll is only for a finished match, 2–4 eligible players, the result is frozen in the
 * same step that stops voting, a closed vote never changes.
 */
import crypto from 'node:crypto';
import { teamRoster, type AudPoll, type AudSessionIn, type AudSummary } from '../shared/audience';
import { MAX_CHAT_CHOICES } from '../shared/twitchChat';

export interface LocalPoll extends AudPoll {
  /** voter id → their vote (PRIVATE; never leaves the server except as counts). */
  votes: Record<string, { player: string; source: 'chat' | 'sim'; at: number }>;
}
export interface LocalVoteStore { session: AudSessionIn | null; polls: LocalPoll[] }
export const emptyLocalVote = (): LocalVoteStore => ({ session: null, polls: [] });
export function sanitizeLocalVote(v: any): LocalVoteStore {
  if (!v || typeof v !== 'object') return emptyLocalVote();
  const polls = (Array.isArray(v.polls) ? v.polls : []).filter((p: any) => p && typeof p.id === 'string' && typeof p.match === 'string' && Array.isArray(p.players) && ['draft', 'open', 'closed', 'revealed'].includes(p.status)).slice(-60)
    .map((p: any) => ({ ...p, votes: p.votes && typeof p.votes === 'object' ? p.votes : {} }));
  return { session: v.session && Array.isArray(v.session.matches) ? v.session : null, polls };
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
class Bad extends Error { constructor(msg: string, public status = 409) { super(msg); } }

export function createLocalVote(store: LocalVoteStore, save: () => void) {
  const find = (id: string) => store.polls.find(p => p.id === id);
  const counts = (p: LocalPoll) => {
    const c: Record<string, number> = Object.fromEntries(p.players.map(x => [x.handle, 0]));
    const by = { web: 0, chat: 0, sim: 0 };
    for (const v of Object.values(p.votes)) { if (v.player in c) c[v.player]++; by[v.source]++; }
    return { counts: c, total: Object.values(c).reduce((a, b) => a + b, 0), by };
  };
  /** Countdown: votes after closesAt are refused (the server's tick closes the poll right on time). */
  const accepting = (p: LocalPoll, at: number) => p.status === 'open' && (p.closesAt == null || at <= p.closesAt);

  function summary(): AudSummary {
    const voters = new Set<string>();
    const polls = store.polls.map(p => {
      const { votes, ...rest } = p;
      Object.keys(votes).forEach(v => voters.add(v));
      const c = counts(p);
      return { ...rest, total: c.total, counts: c.counts, bySource: { web: c.by.web, chat: c.by.chat, ...(c.by.sim ? { sim: c.by.sim } : {}) } } as AudPoll;
    });
    return {
      at: Date.now(), session: store.session?.session ?? 'local', matches: [], polls, viewers: voters.size,
      champion: { total: 0, byTeam: {}, locked: true }, accuracy: { played: 0, right: 0, exact: 0, points: 0, marks: [] }, leaderboard: [],
    };
  }

  function prepare(b: any) {
    const { match, label, result, players, photos } = b ?? {};
    if (typeof match !== 'string' || !Array.isArray(players)) throw new Bad('bad poll', 400);
    const m = store.session?.matches.find(x => x.id === match);
    if (!m || !m.winner) throw new Bad('MVP voting needs a finished match');
    const eligible = m.players?.length ? m.players.map(p => ({ handle: p.handle, team: p.team })) : [...teamRoster(m.a), ...teamRoster(m.b)];
    const photo = (h: string) => { const u = photos && typeof photos === 'object' ? photos[h] : undefined; return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 300 ? u : undefined; };
    const chosen = eligible.filter(p => players.includes(p.handle)).map(p => (photo(p.handle) ? { ...p, photo: photo(p.handle) } : p));
    if (chosen.length < 2) throw new Bad('Choose at least two eligible players', 400);
    const ex = [...store.polls].reverse().find(p => p.match === match && p.status !== 'draft');
    if (ex) return { id: ex.id, existing: true };
    store.polls = store.polls.filter(p => !(p.match === match && p.status === 'draft'));
    const id = `local:${match}:${crypto.randomBytes(3).toString('hex')}`;
    store.polls.push({ id, match, label: String(label ?? m.label).slice(0, 60), result: String(result ?? '').slice(0, 80), players: chosen.slice(0, 4), status: 'draft', openedAt: null, closedAt: null, closesAt: null, web: false, chat: false, frozen: null, votes: {} });
    return { id, existing: false };
  }

  function methods(p: LocalPoll, m: any) {
    if (!m || typeof m.web !== 'boolean' || typeof m.chat !== 'boolean') return;
    // No public website here: a local vote takes Twitch chat (and rehearsal votes); "web" stays off on the graphic.
    p.web = false; p.chat = m.chat;
    p.chatCmd = typeof m.cmd === 'string' && /^![a-z0-9_]{2,20}$/.test(m.cmd) ? m.cmd : '!vote';
    p.chatChannel = typeof m.channel === 'string' && /^[a-z0-9_]{1,25}$/.test(m.channel) ? m.channel : '';
  }

  function action(id: string, act: string, b: any) {
    const p = find(id);
    if (!p) throw new Bad('Unknown poll');
    const flow: Record<string, [string, string]> = { open: ['draft', 'open'], close: ['open', 'closed'], reveal: ['closed', 'revealed'] };
    const f = flow[act];
    if (!f) throw new Bad('bad action', 400);
    if (p.status === f[1]) return; // repeated command: nothing to do
    if (p.status !== f[0]) throw new Bad(`Poll is ${p.status}`);
    if (act === 'open') {
      const sec = Number(b?.seconds);
      p.status = 'open'; p.openedAt = Date.now(); p.closesAt = Number.isFinite(sec) && sec >= 10 ? Date.now() + Math.min(3600, sec) * 1000 : null;
      methods(p, b?.methods);
    } else if (act === 'close') {
      // Frozen in the same step that stops voting: what is revealed is exactly what was counted.
      const c = counts(p), at = Date.now();
      p.status = 'closed'; p.closedAt = at;
      p.frozen = { total: c.total, counts: c.counts, at, hash: sha(JSON.stringify({ id, counts: c.counts, total: c.total, at })).slice(0, 16) };
    } else p.status = 'revealed';
  }

  function chatVotes(id: string, raw: unknown[]) {
    const p = find(id);
    return raw.slice(0, 1000).map((v: any) => {
      const msg = String(v?.msg ?? '');
      if (!v || typeof v.user !== 'string' || !/^\d{1,20}$/.test(v.user) || !Number.isInteger(v.choice) || !Number.isFinite(v.at)) return { msg, result: 'invalid' };
      if (!p || !p.chat || !accepting(p, v.at)) return { msg, result: 'closed' };
      const player = v.choice >= 1 && v.choice <= Math.min(MAX_CHAT_CHOICES, p.players.length) ? p.players[v.choice - 1].handle : null;
      if (!player) return { msg, result: 'invalid' };
      const key = `tw:${v.user}`;
      if (p.votes[key]) return { msg, result: 'already-voted' };
      p.votes[key] = { player, source: 'chat', at: v.at };
      return { msg, result: 'accepted', player };
    });
  }

  /**
   * REHEARSAL: `n` simulated votes on an open poll, spread with a random leader (deterministic per seed). Counted
   * apart (bySource.sim) so the producer always sees how many votes are simulated. Never on a closed poll.
   */
  function simulate(id: string, n: number, seed = Date.now()) {
    const p = find(id);
    if (!p) throw new Bad('Unknown poll');
    if (p.status !== 'open') throw new Bad('Open voting first: simulated votes only go into an open vote');
    const k = Math.max(1, Math.min(2000, Math.round(n)));
    let s = seed % 2147483647 || 1;
    const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
    const w = p.players.map((_, i) => 1 + rnd() * 3 + (i === Math.floor(rnd() * p.players.length) ? 2 : 0));
    const sum = w.reduce((a, b) => a + b, 0);
    const base = Object.keys(p.votes).length;
    for (let i = 0; i < k; i++) {
      let r = rnd() * sum, j = 0;
      while (j < w.length - 1 && (r -= w[j]) > 0) j++;
      p.votes[`sim:${base + i}:${seed}`] = { player: p.players[j].handle, source: 'sim', at: Date.now() };
    }
    return k;
  }

  /** Same contract as the vote service's `call` (JSON body in, `{ ok, ... }` out, throws on refusal). */
  async function call(method: string, path: string, body?: any): Promise<any> {
    try {
      let m: RegExpMatchArray | null;
      if (method === 'PUT' && path === '/internal/session') { store.session = body as AudSessionIn; return { ok: true }; }
      if (method === 'GET' && path === '/internal/summary') return { ok: true, summary: summary() };
      if (method === 'POST' && path === '/internal/reveal-match') return { ok: true };
      if (method === 'POST' && path === '/internal/poll') { const r = prepare(body); save(); return { ok: true, ...r }; }
      if (method === 'POST' && (m = /^\/internal\/poll\/([^/]+)\/(timer|methods|chat-votes|open|close|reveal)$/.exec(path))) {
        const id = decodeURIComponent(m[1]), p = find(id);
        if (m[2] === 'timer') {
          const sec = body?.seconds == null ? null : Number(body.seconds);
          if (sec != null && (!Number.isFinite(sec) || sec < 10)) throw new Bad('At least 10 seconds', 400);
          if (!p || p.status !== 'open') throw new Bad('Voting is not open');
          p.closesAt = sec == null ? null : Date.now() + Math.min(3600, sec) * 1000;
        } else if (m[2] === 'methods') {
          if (!p || (p.status !== 'draft' && p.status !== 'open')) throw new Bad('Voting is closed');
          methods(p, body);
        } else if (m[2] === 'chat-votes') {
          if (!Array.isArray(body?.votes)) throw new Bad('bad votes', 400);
          const results = chatVotes(id, body.votes); save(); return { ok: true, results };
        } else action(id, m[2], body);
        save(); return { ok: true };
      }
      throw new Bad(`Not available in local voting: ${method} ${path}`, 404);
    } catch (e) {
      if (e instanceof Bad) throw Object.assign(new Error(e.message), { status: e.status });
      throw e;
    }
  }

  return { call, simulate: (id: string, n: number, seed?: number) => { const k = simulate(id, n, seed); save(); return k; }, summary };
}
export type LocalVote = ReturnType<typeof createLocalVote>;

/**
 * Twitch chat MVP votes, stored with the website's votes (same tables, same rules).
 *
 * A chat voter is identified by the Twitch user ID Twitch put in the chat event; a website voter by the Twitch user
 * ID Twitch confirmed at sign-in. Both land in `viewers.twitch_id`, so `mvp_votes`' primary key (poll, viewer) allows
 * ONE vote per Twitch account per poll, whichever way it arrives. First vote wins; later ones are ignored.
 */
import type { ChatVoteIn, ChatVoteOut } from '../shared/twitchChat';
import { MAX_CHAT_CHOICES } from '../shared/twitchChat';

/** pg's `query` (a PoolClient inside a transaction). */
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

const okVote = (v: any): v is ChatVoteIn =>
  v && typeof v === 'object' && typeof v.msg === 'string' && typeof v.user === 'string' && /^\d{1,20}$/.test(v.user) && typeof v.name === 'string'
  && Number.isInteger(v.choice) && Number.isFinite(v.at);

/** Store a batch of chat votes for one poll. Call inside a transaction. */
export async function recordChatVotes(q: Query, poll: string, raw: unknown[]): Promise<ChatVoteOut[]> {
  const votes = raw.slice(0, 1000);
  const p = (await q('select status, players, chat, extract(epoch from closes_at) * 1000 as closes_ms from polls where id = $1 for share', [poll])).rows[0];
  const out: ChatVoteOut[] = new Array(votes.length);
  const keep: (ChatVoteIn & { player: string; i: number })[] = [];
  const users = new Set<string>();
  votes.forEach((v, i) => {
    if (!okVote(v)) { out[i] = { msg: String((v as any)?.msg ?? ''), result: 'invalid' }; return; }
    // Not open, chat not accepted for this vote, or sent after the countdown ended: refused like a late website vote.
    if (!p || p.status !== 'open' || !p.chat || (p.closes_ms != null && v.at > Number(p.closes_ms))) { out[i] = { msg: v.msg, result: 'closed' }; return; }
    const players: { handle: string }[] = p.players;
    const player = v.choice >= 1 && v.choice <= Math.min(MAX_CHAT_CHOICES, players.length) ? players[v.choice - 1].handle : null;
    if (!player) { out[i] = { msg: v.msg, result: 'invalid' }; return; }
    if (users.has(v.user)) { out[i] = { msg: v.msg, result: 'already-voted' }; return; } // twice in one batch: first wins
    users.add(v.user); keep.push({ ...v, player, i });
  });
  if (!keep.length) return out;
  // Viewers by Twitch ID (the website's sign-in uses the same ID). The display name is refreshed.
  const ids = await q(`insert into viewers(twitch_id, name) select * from unnest($1::text[], $2::text[])
    on conflict (twitch_id) do update set name = excluded.name returning id, twitch_id`, [keep.map(v => v.user), keep.map(v => v.name.slice(0, 40) || 'viewer')]);
  const viewer = new Map<string, string>(ids.rows.map(r => [String(r.twitch_id), String(r.id)]));
  const ins = await q(`insert into mvp_votes(poll, viewer, player, source, at)
    select $1, x.viewer, x.player, 'chat', to_timestamp(x.at / 1000.0) from unnest($2::bigint[], $3::text[], $4::float8[]) as x(viewer, player, at)
    on conflict (poll, viewer) do nothing returning viewer`, [poll, keep.map(v => viewer.get(v.user)), keep.map(v => v.player), keep.map(v => v.at)]);
  const stored = new Set(ins.rows.map(r => String(r.viewer)));
  for (const v of keep) out[v.i] = stored.has(viewer.get(v.user)!) ? { msg: v.msg, result: 'accepted', player: v.player } : { msg: v.msg, result: 'already-voted' };
  return out;
}

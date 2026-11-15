/**
 * Twitch chat MVP voting: rules shared by the server, the vote service and the producer UI.
 *
 * Viewers type `!vote 1` … `!vote 4` in a Twitch channel's chat. The broadcast server reads that chat through
 * Twitch EventSub (channel.chat.message over a WebSocket) as YOUR account or a bot account: reading chat that way
 * needs only the `user:read:chat` scope from the reading account, never the channel owner's password or tokens.
 *
 * Deduplication policy (enforced by the vote service's database, not only here):
 *  - one vote per Twitch account (Twitch user ID) per MVP vote;
 *  - the first vote counts; later ones (another number, a repeat, a resend of the same message) are ignored;
 *  - the website also signs viewers in with Twitch, so chat and website share the same identity: a Twitch account
 *    that voted on the website cannot vote again in chat, and the other way round;
 *  - this is one vote per Twitch ACCOUNT, not per person: someone with two Twitch accounts can vote twice.
 */

export const CHAT_SCOPES = ['user:read:chat'] as const;
export type VoteMethods = 'both' | 'chat' | 'web';
export const METHOD_LABEL: Record<VoteMethods, string> = { both: 'Twitch chat + website', chat: 'Twitch chat only', web: 'Website only (QR)' };

export const DEDUP_POLICY =
  'One vote per Twitch account per MVP vote: the first vote counts, later ones are ignored. The website also signs in ' +
  'with Twitch, so chat and website share one count per account. This is per Twitch account, not per person.';

/** Highest number the chat can vote for: the voting graphic shows (and numbers) the first four candidates. */
export const MAX_CHAT_CHOICES = 4;

/** What the producer sets (persisted on the server). */
export interface ChatVoteConfig {
  /** Listen to the channel's chat (the producer can stop listening without signing out). */
  enabled: boolean;
  /** Target channel login (the event's channel), e.g. "overdrive_tm". Resolved to an ID on the server. */
  channel: string;
  /** Command word, "!vote" by default. */
  command: string;
  methods: VoteMethods;
  /** Count messages that reach this chat from other channels in a Twitch Shared Chat session (off by default). */
  sharedChat: boolean;
}
export const defaultChatConfig = (): ChatVoteConfig => ({ enabled: true, channel: '', command: '!vote', methods: 'both', sharedChat: false });

export function sanitizeCommand(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^!?[a-z0-9_]{2,20}$/.test(s) ? (s.startsWith('!') ? s : '!' + s) : '!vote';
}
export const sanitizeLogin = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//, '').replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 25);

/**
 * Read a chat message. null = not a vote command (ordinary chat, ignored silently); 'invalid' = the command with
 * a missing / wrong number; otherwise the 1-based candidate number. Accepts "!vote 2", "!VOTE 2", "!vote #2",
 * "!vote 2 gogo" (text after the number is ignored); refuses "!vote", "!vote 5" (when 4 candidates), "!vote two".
 */
export function parseVote(text: string, command: string, max: number): number | 'invalid' | null {
  const t = String(text ?? '').trim().toLowerCase();
  const cmd = sanitizeCommand(command);
  if (!t.startsWith(cmd)) return null;
  const rest = t.slice(cmd.length);
  if (rest && !/^\s/.test(rest)) return null; // "!voted", "!votes": another command
  const m = /^\s*#?(\d{1,3})(?:\s|$)/.exec(rest);
  if (!m) return 'invalid';
  const n = Number(m[1]);
  return n >= 1 && n <= Math.min(MAX_CHAT_CHOICES, max) ? n : 'invalid';
}

/** One channel.chat.message event, as the server keeps it (the fields Overdrive uses). */
export interface ChatMsg {
  messageId: string;
  /** Chat the message was read from (the target channel). */
  broadcasterId: string;
  /** Shared Chat: the channel the message was sent in, when it is not this one. */
  sourceBroadcasterId: string | null;
  userId: string;
  login: string;
  name: string;
  text: string;
  at: number;
}

export type ChatResult = 'pending' | 'accepted' | 'already-voted' | 'duplicate-message' | 'invalid' | 'not-open' | 'other-channel' | 'rejected';
export const RESULT_LABEL: Record<ChatResult, string> = {
  pending: 'Sending', accepted: 'Counted', 'already-voted': 'Already voted', 'duplicate-message': 'Duplicate message',
  invalid: 'Invalid vote', 'not-open': 'Voting not open', 'other-channel': 'Other channel (Shared Chat)', rejected: 'Refused by the vote service',
};

export interface ChatActivity { id: string; at: number; name: string; choice: number | null; player: string | null; result: ChatResult; text?: string }
export interface ChatStats { messages: number; commands: number; accepted: number; alreadyVoted: number; duplicates: number; invalid: number; notOpen: number; otherChannel: number; rejected: number; pending: number }
export const emptyStats = (): ChatStats => ({ messages: 0, commands: 0, accepted: 0, alreadyVoted: 0, duplicates: 0, invalid: 0, notOpen: 0, otherChannel: 0, rejected: 0, pending: 0 });

export type ChatConn = 'signed-out' | 'signing-in' | 'no-channel' | 'stopped' | 'connecting' | 'listening' | 'reconnecting' | 'needs-auth' | 'error';

/** Producer-only view of the chat connection (never contains a token). */
export interface ChatStatus {
  clientId: string;
  /** The reading account (yours or a bot): login + ID once signed in. */
  login: string;
  userId: string;
  scopes: string[];
  /** Pending device sign-in: open `uri`, enter `code`. */
  device: { code: string; uri: string; expiresAt: number } | null;
  conn: ChatConn;
  /** Plain-language problem, and what to do about it. */
  error: string;
  /** What authorization is missing, when Twitch refused (shown prominently). */
  authNeeded: string;
  channel: { login: string; id: string; name: string } | null;
  config: ChatVoteConfig;
  listeningSince: number | null;
  lastEventAt: number | null;
  /** The MVP vote chat is counting for (null = no vote open). */
  poll: { id: string; label: string; players: string[]; chat: boolean } | null;
  stats: ChatStats;
  activity: ChatActivity[];
  /** Votes waiting to reach the vote service (kept and retried through an outage). */
  queued: number;
}

export type ChatOp =
  | { k: 'client-id'; clientId: string }
  | { k: 'connect' }
  | { k: 'disconnect' }
  | { k: 'config'; patch: Partial<ChatVoteConfig> }
  | { k: 'reconnect' }
  /** Clear the activity list and counters (votes are not touched). */
  | { k: 'clear' };

/** Which methods a vote accepts. */
export const methodsOf = (m: VoteMethods) => ({ web: m !== 'chat', chat: m !== 'web' });

/**
 * Fast first pass, before the vote service (which enforces the same rules in its database): drops repeats of a
 * message ID, other channels' Shared Chat messages, non-commands, invalid numbers and second votes from an account
 * already seen in this vote. Memory is bounded (message IDs: last 20 000; voters: per open vote).
 */
export class ChatVoteGate {
  private seen = new Set<string>();
  private order: string[] = [];
  private voted = new Map<string, Set<string>>();
  constructor(private keep = 20000) {}

  decide(m: ChatMsg, ctx: { channelId: string; command: string; sharedChat: boolean; poll: { id: string; players: string[]; open: boolean; chat: boolean } | null }):
    { result: Exclude<ChatResult, 'accepted' | 'rejected'>; choice: number | null; player: string | null } | null {
    if (m.messageId) {
      if (this.seen.has(m.messageId)) return { result: 'duplicate-message', choice: null, player: null };
      this.seen.add(m.messageId); this.order.push(m.messageId);
      if (this.order.length > this.keep) this.seen.delete(this.order.shift()!);
    }
    const n = parseVote(m.text, ctx.command, ctx.poll?.players.length ?? MAX_CHAT_CHOICES);
    if (n === null) return null;
    if (m.broadcasterId !== ctx.channelId || (m.sourceBroadcasterId && m.sourceBroadcasterId !== ctx.channelId && !ctx.sharedChat)) return { result: 'other-channel', choice: null, player: null };
    const p = ctx.poll;
    if (!p || !p.open || !p.chat) return { result: 'not-open', choice: typeof n === 'number' ? n : null, player: null };
    if (n === 'invalid') return { result: 'invalid', choice: null, player: null };
    let s = this.voted.get(p.id);
    if (!s) { s = new Set(); this.voted.set(p.id, s); }
    if (s.has(m.userId)) return { result: 'already-voted', choice: n, player: p.players[n - 1] ?? null };
    s.add(m.userId);
    return { result: 'pending', choice: n, player: p.players[n - 1] ?? null };
  }
  /** The vote service said this account had already voted (e.g. on the website): remember it. */
  markVoted(poll: string, userId: string) { let s = this.voted.get(poll); if (!s) { s = new Set(); this.voted.set(poll, s); } s.add(userId); }
  /** The vote was not stored (refused): the account may vote again. */
  unmark(poll: string, userId: string) { this.voted.get(poll)?.delete(userId); }
  /** Forget votes of polls that are no longer open (memory). */
  keepOnly(polls: string[]) { for (const k of [...this.voted.keys()]) if (!polls.includes(k)) this.voted.delete(k); }
}

/** One chat vote as the broadcast server sends it to the vote service. */
export interface ChatVoteIn { msg: string; user: string; name: string; choice: number; at: number }
export type ChatVoteOut = { msg: string; result: 'accepted' | 'already-voted' | 'closed' | 'invalid'; player?: string };

/** Map Twitch's channel.chat.message event to ChatMsg (null when it is not one). */
export function chatMsgOf(ev: any, messageId: string, at: number): ChatMsg | null {
  if (!ev || typeof ev !== 'object' || typeof ev.chatter_user_id !== 'string') return null;
  return {
    messageId: String(ev.message_id || messageId || ''),
    broadcasterId: String(ev.broadcaster_user_id ?? ''),
    sourceBroadcasterId: ev.source_broadcaster_user_id ? String(ev.source_broadcaster_user_id) : null,
    userId: ev.chatter_user_id, login: String(ev.chatter_user_login ?? ''), name: String(ev.chatter_user_name ?? ev.chatter_user_login ?? '').slice(0, 40),
    text: String(ev.message?.text ?? '').slice(0, 500), at,
  };
}

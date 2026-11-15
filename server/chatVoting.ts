/**
 * Twitch chat → MVP votes. Reads every chat message the TwitchChat reader gets, keeps the vote commands, applies the
 * fast checks (ChatVoteGate) and sends the votes to the vote service in small batches, where the database applies
 * the same rules for good (one vote per Twitch account per MVP vote, shared with the website).
 *
 * Votes wait in a queue while the vote service is unreachable and are retried; before voting closes the queue is
 * sent first, so a vote typed before the close is counted in the frozen result.
 */
import { ChatVoteGate, MAX_CHAT_CHOICES, emptyStats, methodsOf, type ChatActivity, type ChatMsg, type ChatResult, type ChatStats, type ChatStatus, type ChatVoteIn, type ChatVoteOut } from '../shared/twitchChat';
import type { AudPoll } from '../shared/audience';
import type { TwitchChat } from './twitchChat';

const ACTIVITY = 80, BATCH = 500, QUEUE_MAX = 50000;

export interface ChatVotingDeps {
  /** The MVP vote currently open (latest summary from the vote service), or null. */
  openPoll: () => AudPoll | null;
  /** Vote service internal call (throws on failure). */
  call: (method: string, path: string, body?: unknown) => Promise<any>;
  configured: () => boolean;
  /** Something the producer sees changed (throttled by the caller). */
  onChange: () => void;
  /** Votes were stored: refresh the live totals soon. */
  onStored: () => void;
}

interface Pending { poll: string; vote: ChatVoteIn; act: ChatActivity; user: string }

export class ChatVoting {
  gate = new ChatVoteGate();
  stats: ChatStats = emptyStats();
  activity: ChatActivity[] = [];
  private queue: Pending[] = [];
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(private chat: TwitchChat, private d: ChatVotingDeps) {}

  start() { if (!this.timer) { this.timer = setInterval(() => { this.flush().catch(() => {}); }, 400); this.timer.unref?.(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Ways to vote for the vote service (`chat` only when a channel is set). */
  methods() {
    const st = this.chat.status(), m = methodsOf(st.config.methods), hasChannel = !!st.config.channel;
    return { web: m.web || !hasChannel, chat: m.chat && hasChannel, cmd: st.config.command, channel: st.channel?.login ?? st.config.channel };
  }

  private log(a: ChatActivity) { this.activity.unshift(a); if (this.activity.length > ACTIVITY) this.activity.length = ACTIVITY; }
  private count(r: ChatResult, n = 1) {
    const k: Partial<Record<ChatResult, keyof ChatStats>> = { accepted: 'accepted', 'already-voted': 'alreadyVoted', 'duplicate-message': 'duplicates', invalid: 'invalid', 'not-open': 'notOpen', 'other-channel': 'otherChannel', rejected: 'rejected', pending: 'pending' };
    const key = k[r]; if (key) this.stats[key] += n;
  }

  /** One chat message from Twitch. */
  onMessage(m: ChatMsg) {
    this.stats.messages++;
    const st = this.chat.status(), p = this.d.openPoll();
    const open = !!p && p.status === 'open' && (!p.closesAt || p.closesAt > m.at);
    const poll = p ? { id: p.id, players: p.players.slice(0, MAX_CHAT_CHOICES).map(x => x.handle), open, chat: p.chat === true } : null;
    const r = this.gate.decide(m, { channelId: st.channel?.id ?? '', command: st.config.command, sharedChat: st.config.sharedChat, poll });
    if (!r) return; // ordinary chat
    if (r.result !== 'duplicate-message') this.stats.commands++;
    const act: ChatActivity = { id: String(++this.seq), at: m.at, name: m.name || m.login, choice: r.choice, player: r.player, result: r.result, ...(r.result === 'invalid' ? { text: m.text.slice(0, 40) } : {}) };
    this.count(r.result);
    if (r.result !== 'duplicate-message') this.log(act);
    if (r.result === 'pending' && p && r.choice) {
      if (this.queue.length >= QUEUE_MAX) { act.result = 'rejected'; this.stats.pending--; this.count('rejected'); this.gate.unmark(p.id, m.userId); }
      else this.queue.push({ poll: p.id, user: m.userId, act, vote: { msg: m.messageId, user: m.userId, name: m.name || m.login, choice: r.choice, at: m.at } });
    }
    this.d.onChange();
  }

  get queued() { return this.queue.length; }

  /** Send queued votes now (also called before voting closes). */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.queue.length || !this.d.configured()) return Promise.resolve();
    this.flushing = (async () => {
      try {
        let stored = 0;
        while (this.queue.length) {
          const poll = this.queue[0].poll;
          const batch = this.queue.filter(x => x.poll === poll).slice(0, BATCH);
          const j = await this.d.call('POST', `/internal/poll/${encodeURIComponent(poll)}/chat-votes`, { votes: batch.map(b => b.vote) });
          const res: ChatVoteOut[] = Array.isArray(j?.results) ? j.results : [];
          const done = new Set(batch);
          this.queue = this.queue.filter(x => !done.has(x));
          batch.forEach((b, i) => {
            const o = res[i];
            const r: ChatResult = o?.result === 'accepted' ? 'accepted' : o?.result === 'already-voted' ? 'already-voted' : o?.result === 'closed' ? 'not-open' : 'rejected';
            this.stats.pending--; this.count(r);
            b.act.result = r; if (o?.player) b.act.player = o.player;
            if (r === 'accepted') stored++;
            if (r === 'already-voted') this.gate.markVoted(poll, b.user); else if (r !== 'accepted') this.gate.unmark(poll, b.user);
          });
          this.d.onChange();
        }
        if (stored) this.d.onStored();
      } catch { /* vote service unreachable: the queue is kept and retried */ }
      finally { this.flushing = null; }
    })();
    return this.flushing;
  }

  /** Before closing a vote: send what was typed before the close (bounded wait). */
  async beforeClose(poll: string) {
    if (!this.queue.some(x => x.poll === poll)) return;
    await Promise.race([this.flush(), new Promise(r => setTimeout(r, 3000))]);
    if (this.flushing) await Promise.race([this.flushing, new Promise(r => setTimeout(r, 2000))]);
    if (this.queue.some(x => x.poll === poll)) await Promise.race([this.flush(), new Promise(r => setTimeout(r, 3000))]);
  }

  clear() { this.stats = { ...emptyStats(), pending: this.queue.length }; this.activity = []; this.d.onChange(); }

  /** Producer view: connection + counting (no tokens). */
  status(): ChatStatus {
    const p = this.d.openPoll();
    return {
      ...this.chat.status(),
      poll: p ? { id: p.id, label: p.label, players: p.players.slice(0, MAX_CHAT_CHOICES).map(x => x.handle), chat: p.chat === true } : null,
      stats: this.stats, activity: this.activity, queued: this.queue.length,
    };
  }
}

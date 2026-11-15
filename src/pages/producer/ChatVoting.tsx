/**
 * Twitch chat MVP voting, inside the MVP module: connection, counting and activity while a vote is open, and the
 * settings (reading account sign-in, target channel, command, ways to vote). Opening and closing stay the MVP
 * module's existing buttons. Tokens never reach this page: the server sends a status without them.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { AudPoll } from '../../../shared/audience';
import { DEDUP_POLICY, METHOD_LABEL, RESULT_LABEL, type ChatActivity, type ChatOp, type ChatStatus, type VoteMethods } from '../../../shared/twitchChat';
import { Btn, Chip, Seg, Tiny, PGM, PVW, WARN } from './modules';
import type { AudCtx } from './audienceModules';

const CONN: Record<ChatStatus['conn'], [string, string]> = {
  'signed-out': ['Not signed in', 'rgba(255,255,255,.35)'], 'signing-in': ['Waiting for Twitch sign-in', WARN], 'no-channel': ['No channel set', WARN],
  stopped: ['Not listening', 'rgba(255,255,255,.35)'], connecting: ['Connecting…', WARN], listening: ['Listening to chat', PVW],
  reconnecting: ['Reconnecting…', WARN], 'needs-auth': ['Authorization needed', PGM], error: ['Problem', PGM],
};
const TONE: Partial<Record<ChatActivity['result'], string>> = { accepted: PVW, pending: 'rgba(255,255,255,.55)', 'already-voted': WARN, invalid: '#ff8a8d', rejected: '#ff8a8d', 'not-open': 'rgba(255,255,255,.45)', 'other-channel': 'rgba(255,255,255,.45)' };
const ago = (now: number, t: number | null) => (t == null ? '—' : `${Math.max(0, Math.round((now - t) / 1000))} s ago`);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center gap-2 text-[11.5px]"><span className="w-[92px] flex-none text-white/55">{label}</span>{children}</label>;
}
const inputCls = 'min-w-0 flex-1 rounded-[2px] border border-white/15 bg-black px-1.5 py-[3px] text-[12px] outline-none focus:border-white/40';

export function ChatVotingPanel({ a, poll, now }: { a: AudCtx; poll: AudPoll | undefined; now: number }) {
  const s = a.priv?.chat;
  const op = (o: ChatOp, label: string) => a.op({ k: 'chat', op: o }, label);
  const [open, setOpen] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState(s?.clientId ?? '');
  const [channel, setChannel] = useState(s?.config.channel ?? '');
  const [command, setCommand] = useState(s?.config.command ?? '!vote');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setClientId(s?.clientId ?? ''), [s?.clientId]);
  useEffect(() => setChannel(s?.config.channel ?? ''), [s?.config.channel]);
  useEffect(() => setCommand(s?.config.command ?? '!vote'), [s?.config.command]);
  if (!s) return null;
  const run = async (o: ChatOp, label: string) => { setErr(await op(o, label)); };
  const [label, tone] = CONN[s.conn];
  const listening = s.conn === 'listening';
  const chatOn = s.config.methods !== 'web' && !!s.config.channel;
  // Settings open by themselves while something needs doing (sign-in, channel, authorization), else on demand.
  const settingsOpen = open ?? (['signed-out', 'signing-in', 'no-channel', 'needs-auth'].includes(s.conn) || (chatOn && !listening && s.conn !== 'stopped'));
  const isOpen = poll?.status === 'open';
  const src = poll?.bySource;
  const cmd = s.config.command;
  return (
    <div className="space-y-1.5 rounded-[2px] border border-white/10 p-2" data-chat-voting={s.conn}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Twitch chat voting</span>
        <span className="flex items-center gap-1.5 font-bold" style={{ color: tone }} data-chat-conn={s.conn}><i className={`inline-block h-[8px] w-[8px] rounded-full ${listening ? 'animate-pulse' : ''}`} style={{ background: tone }} />{label}</span>
        {s.channel && <span className="text-white/60">twitch.tv/<b className="text-white/85">{s.channel.login}</b>{s.login && <> · read as <b className="text-white/85">{s.login}</b></>}</span>}
        <span className="text-white/45">{METHOD_LABEL[s.config.methods]}</span>
        <span className="ml-auto flex items-center gap-1">
          {s.login && <Tiny title="Reconnect to Twitch chat" onClick={() => run({ k: 'reconnect' }, 'Reconnect Twitch chat')}>↻</Tiny>}
          <Tiny title={settingsOpen ? 'Hide settings' : 'Settings: account, channel, command, ways to vote'} onClick={() => setOpen(!settingsOpen)}>{settingsOpen ? '▴' : '⚙'}</Tiny>
        </span>
      </div>
      {s.authNeeded && <div className="rounded-[2px] border px-2 py-1 text-[11.5px] font-bold" style={{ borderColor: PGM, color: '#ff8a8d' }} data-chat-auth>{s.authNeeded}</div>}
      {s.error && !s.authNeeded && <div className="text-[11.5px]" style={{ color: WARN }} data-chat-error>{s.error}</div>}
      {err && <div className="text-[11.5px]" style={{ color: '#ff8a8d' }}>{err}</div>}
      {chatOn && !listening && isOpen && poll?.chat && <div className="text-[11.5px] font-bold" style={{ color: WARN }}>Voting is open in chat but Overdrive is not reading it: chat votes typed now are missed.</div>}
      {isOpen && poll && !poll.chat && chatOn && <div className="text-[11.5px]" style={{ color: WARN }}>This vote was opened without chat voting: change “Ways to vote” to add it.</div>}

      {/* Live: totals by source + counters + latest activity (private, producer only). */}
      {poll && poll.status !== 'draft' && (poll.chat || (src?.chat ?? 0) > 0) && (
        <div className="space-y-1" data-chat-live>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums">
            <span>Chat <b data-chat-votes>{src?.chat ?? 0}</b></span><span>Website <b>{src?.web ?? 0}</b></span><span className="text-white/45">total {poll.total ?? 0}</span>
            <span className="text-white/35">|</span>
            <span style={{ color: PVW }}>counted {s.stats.accepted}</span>
            <span style={{ color: WARN }}>already voted {s.stats.alreadyVoted}</span>
            <span style={{ color: '#ff8a8d' }}>invalid {s.stats.invalid}</span>
            <span className="text-white/45">duplicates {s.stats.duplicates}</span>
            {s.stats.notOpen > 0 && <span className="text-white/45">not open {s.stats.notOpen}</span>}
            {s.queued > 0 && <span style={{ color: WARN }} data-chat-queued>sending {s.queued}</span>}
            <span className="text-white/35">last message {ago(now, s.lastEventAt)}</span>
          </div>
          {isOpen && s.poll && <div className="text-[11px] text-white/55">Viewers type {s.poll.players.map((h, i) => <span key={h} className="mr-2 whitespace-nowrap"><b className="text-white/85">{cmd} {i + 1}</b> {h}</span>)}</div>}
          <ul className="max-h-[168px] overflow-y-auto text-[11.5px]" data-chat-activity>
            {s.activity.slice(0, 40).map(x => (
              <li key={x.id} className="flex items-center gap-2 border-t border-white/[0.05] py-[2px]">
                <span className="w-[62px] flex-none tabular-nums text-white/35">{new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className="w-[120px] flex-none truncate font-semibold">{x.name}</span>
                <span className="min-w-0 flex-1 truncate text-white/70">{x.choice ? <>{cmd} {x.choice}{x.player ? <> → <b className="text-white/90">{x.player}</b></> : null}</> : <span className="text-white/45">{x.text ?? ''}</span>}</span>
                <span className="flex-none font-bold" style={{ color: TONE[x.result] ?? 'inherit' }}>{RESULT_LABEL[x.result]}</span>
              </li>
            ))}
            {!s.activity.length && <li className="py-1 text-white/40">{listening ? `No ${cmd} commands yet.` : 'Nothing read yet.'}</li>}
          </ul>
        </div>
      )}

      {settingsOpen && (
        <div className="space-y-1.5 border-t border-white/10 pt-1.5" data-chat-settings>
          <Field label="Reading account">
            {s.login ? <span className="flex flex-1 items-center gap-2"><b>{s.login}</b><span className="text-white/45">(your account or a bot · permission: user:read:chat)</span>
              <Btn onClick={() => run({ k: 'disconnect' }, 'Sign out of Twitch chat')}>Sign out</Btn></span>
              : s.device ? <span className="flex flex-1 flex-wrap items-center gap-2" data-chat-device>Open <a className="underline" href={s.device.uri} target="_blank" rel="noreferrer">{s.device.uri.replace(/^https:\/\//, '')}</a> and enter <b className="rounded-[2px] bg-white px-1.5 font-mono text-[13px] tracking-[0.15em] text-black">{s.device.code}</b>
                <span className="text-white/45">signed in as the account that will read chat</span></span>
              : <span className="flex flex-1 items-center gap-2"><Btn active disabled={!s.clientId} onClick={() => run({ k: 'connect' }, 'Sign in to Twitch chat')}>Sign in with Twitch</Btn><span className="text-white/45">Your account or a bot account. The event channel's owner signs nothing.</span></span>}
          </Field>
          {!s.login && <Field label="Twitch app">
            <input className={inputCls + ' font-mono'} value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID (Public app)" aria-label="Twitch Client ID" />
            <Btn disabled={clientId === s.clientId} onClick={() => run({ k: 'client-id', clientId }, 'Twitch chat Client ID')}>Save</Btn>
          </Field>}
          <Field label="Channel">
            <span className="text-white/45">twitch.tv/</span><input className={inputCls} value={channel} onChange={e => setChannel(e.target.value)} placeholder="the event's channel (your own channel for tests)" aria-label="Twitch channel" data-chat-channel-input />
            <Btn disabled={channel.trim().toLowerCase() === s.config.channel} onClick={() => run({ k: 'config', patch: { channel } }, `Twitch chat channel ${channel}`)}>Use channel</Btn>
          </Field>
          <Field label="Command">
            <input className={inputCls + ' max-w-[120px] font-mono'} value={command} onChange={e => setCommand(e.target.value)} aria-label="Chat command" />
            <Btn disabled={command === s.config.command} onClick={() => run({ k: 'config', patch: { command } }, `Chat command ${command}`)}>Save</Btn>
            <span className="text-white/45">viewers type “{s.config.command} 1” … “{s.config.command} 4” (card numbers)</span>
          </Field>
          <Field label="Ways to vote">
            <Seg value={s.config.methods} options={(['both', 'chat', 'web'] as VoteMethods[]).map(m => [m, METHOD_LABEL[m]])} onChange={v => run({ k: 'config', patch: { methods: v as VoteMethods } }, `Ways to vote: ${METHOD_LABEL[v as VoteMethods]}`)} />
          </Field>
          <Field label="Listening">
            <Chip on={s.config.enabled} onClick={() => run({ k: 'config', patch: { enabled: !s.config.enabled } }, s.config.enabled ? 'Stop reading Twitch chat' : 'Read Twitch chat')}>{s.config.enabled ? 'On' : 'Off'}</Chip>
            <Chip on={s.config.sharedChat} title="Twitch Shared Chat: count votes typed in the other channels of the shared session" onClick={() => run({ k: 'config', patch: { sharedChat: !s.config.sharedChat } }, 'Shared Chat votes')}>Count Shared Chat</Chip>
            <Tiny title="Clear the activity list and counters (votes are not touched)" onClick={() => run({ k: 'clear' }, 'Clear chat activity')}>Clear</Tiny>
          </Field>
          <div className="text-[11px] text-white/45" data-chat-policy>{DEDUP_POLICY} {s.config.methods === 'chat' ? 'Website: closed for MVP votes (it tells viewers to vote in chat).' : ''}</div>
        </div>
      )}
    </div>
  );
}

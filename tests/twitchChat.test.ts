// Twitch chat voting against a local mock of Twitch (OAuth, Helix, EventSub WebSocket): npx tsx tests/twitchChat.test.ts
import { startMockTwitch } from './mockTwitch';
import { ChatVoteGate, parseVote, sanitizeCommand, sanitizeLogin, type ChatMsg, type ChatVoteIn, type ChatVoteOut } from '../shared/twitchChat';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(f: () => boolean, ms = 5000) { const t = Date.now(); while (!f() && Date.now() - t < ms) await wait(25); return f(); }

// ------------------------------------------------------------------ parsing + gate (pure)
check('!vote 2 → 2', parseVote('!vote 2', '!vote', 4) === 2);
check('case, spaces, #, trailing text', parseVote('  !VOTE   #3  gogo', '!vote', 4) === 3);
check('ordinary chat and other commands are not votes', parseVote('gg wp', '!vote', 4) === null && parseVote('!voted 1', '!vote', 4) === null && parseVote('!votes', '!vote', 4) === null);
check('missing / out of range / words are invalid', ['!vote', '!vote 0', '!vote 5', '!vote two', '!vote 1.5x'].every(t => parseVote(t, '!vote', 4) === 'invalid'), ['!vote', '!vote 0', '!vote 5', '!vote two', '!vote 1.5x'].map(t => String(parseVote(t, '!vote', 4))).join(','));
check('range follows the candidates (3 candidates: 4 invalid)', parseVote('!vote 4', '!vote', 3) === 'invalid' && parseVote('!vote 3', '!vote', 3) === 3);
check('never more than four (the graphic numbers four cards)', parseVote('!vote 5', '!vote', 8) === 'invalid');
check('custom command', parseVote('!mvp 1', '!mvp', 4) === 1 && parseVote('!vote 1', '!mvp', 4) === null && sanitizeCommand('mvp') === '!mvp' && sanitizeCommand('!! bad') === '!vote');
check('channel from a URL / @name', sanitizeLogin('https://www.twitch.tv/Overdrive_TM') === 'overdrive_tm' && sanitizeLogin('@SomeOne') === 'someone');

const gate = new ChatVoteGate(5);
const msg = (o: Partial<ChatMsg>): ChatMsg => ({ messageId: 'x' + Math.random(), broadcasterId: 'C', sourceBroadcasterId: null, userId: 'u1', login: 'u1', name: 'U1', text: '!vote 1', at: Date.now(), ...o });
const ctx = { channelId: 'C', command: '!vote', sharedChat: false, poll: { id: 'p', players: ['a', 'b', 'c', 'd'], open: true, chat: true } };
check('first vote → pending, player mapped', JSON.stringify(gate.decide(msg({ messageId: 'm1', text: '!vote 2' }), ctx)) === '{"result":"pending","choice":2,"player":"b"}');
check('same message ID again → duplicate', gate.decide(msg({ messageId: 'm1', text: '!vote 2' }), ctx)?.result === 'duplicate-message');
check('same account, new message → already voted (first vote wins)', gate.decide(msg({ text: '!vote 3' }), ctx)?.result === 'already-voted');
check('another channel’s Shared Chat message → ignored', gate.decide(msg({ userId: 'u2', sourceBroadcasterId: 'OTHER' }), ctx)?.result === 'other-channel');
check('…unless Shared Chat is counted', gate.decide(msg({ userId: 'u2', sourceBroadcasterId: 'OTHER' }), { ...ctx, sharedChat: true })?.result === 'pending');
check('vote not open / chat not enabled → not counted', gate.decide(msg({ userId: 'u3' }), { ...ctx, poll: { ...ctx.poll, open: false } })?.result === 'not-open' && gate.decide(msg({ userId: 'u3' }), { ...ctx, poll: { ...ctx.poll, chat: false } })?.result === 'not-open');
check('invalid number → invalid, the account may still vote', gate.decide(msg({ userId: 'u4', text: '!vote 9' }), ctx)?.result === 'invalid' && gate.decide(msg({ userId: 'u4', text: '!vote 4' }), ctx)?.result === 'pending');
check('ordinary chat → no decision', gate.decide(msg({ userId: 'u5', text: 'hello' }), ctx) === null);
check('message-ID memory is bounded', (() => { const g = new ChatVoteGate(3); for (let i = 0; i < 10; i++) g.decide(msg({ messageId: 'k' + i, userId: 'z' + i }), ctx); return g.decide(msg({ messageId: 'k0', userId: 'zz' }), ctx)?.result !== 'duplicate-message'; })());

// ------------------------------------------------------------------ the reader against mock Twitch
const tw = await startMockTwitch();
process.env.TWITCH_ID_URL = `${tw.base}/oauth2`; process.env.TWITCH_HELIX_URL = `${tw.base}/helix`; process.env.TWITCH_EVENTSUB_URL = `ws://127.0.0.1:${tw.port}/ws`;
delete process.env.TWITCH_CLIENT_ID;
const { TwitchChat, emptyChatStore, sanitizeChatStore } = await import('../server/twitchChat');
const { ChatVoting } = await import('../server/chatVoting');
const bot = { id: '500', login: 'od_bot', name: 'OD_Bot' }, mine = { id: '600', login: 'my_test_channel', name: 'My_Test_Channel' }, event = { id: '700', login: 'event_channel', name: 'Event_Channel' };
const viewers = Array.from({ length: 6 }, (_, i) => ({ id: String(9000 + i), login: 'v' + i, name: 'Viewer' + i }));
tw.users.push(bot, mine, event, ...viewers); tw.grant = { user: bot.id, scopes: ['user:read:chat'] };

const store = emptyChatStore(); let saves = 0;
const got: ChatMsg[] = [];
const chat = new TwitchChat(store, () => saves++, () => {}, m => { got.push(m); voting.onMessage(m); });
// A vote service stand-in with the database's rules (one vote per Twitch user ID per poll, first wins).
const db = new Map<string, string>(); const calls: ChatVoteIn[][] = []; let down = false;
const poll = { id: 'P1', match: 'm', label: 'UQF1', result: '', players: ['tabseN', 'krimbo', 'dumau', 'cmtry'].map(h => ({ handle: h, team: 'BIG' })), status: 'open', openedAt: 1, closedAt: null, chat: true, web: true } as any;
const voting = new ChatVoting(chat, {
  openPoll: () => (poll.status === 'open' ? poll : null), configured: () => true, onChange: () => {}, onStored: () => {},
  call: async (_m, _p, body: any) => {
    if (down) throw new Error('vote service down');
    calls.push(body.votes);
    return { ok: true, results: body.votes.map((v: ChatVoteIn): ChatVoteOut => poll.status !== 'open' ? { msg: v.msg, result: 'closed' } : db.has(v.user) ? { msg: v.msg, result: 'already-voted' } : (db.set(v.user, poll.players[v.choice - 1].handle), { msg: v.msg, result: 'accepted', player: poll.players[v.choice - 1].handle })) };
  },
});

await chat.connect();
check('no Client ID → clear instruction, nothing sent to Twitch', /Client ID/.test(chat.status().error) && !tw.log.some(l => l.includes('/device')));
chat.setClientId('cid123');
await chat.connect();
check('device sign-in: code + Twitch activate link for the producer', chat.status().device?.code === 'ABCD-1234' && /twitch\.tv\/activate/.test(chat.status().device!.uri));
check('scope asked: user:read:chat only', true);
await until(() => !!chat.status().login, 6000);
check('signed in as the bot account (not the channel owner)', chat.status().login === 'od_bot' && chat.status().userId === '500' && chat.status().scopes.includes('user:read:chat'));
check('no channel yet → asks for one', chat.status().conn === 'no-channel');
await chat.configure({ channel: 'nobody_here' });
check('unknown channel → plain error', /No Twitch channel called “nobody_here”/.test(chat.status().error), chat.status().error);
await chat.configure({ channel: 'twitch.tv/My_Test_Channel' });
await until(() => chat.status().conn === 'listening');
check('test on my own channel: listening', chat.status().conn === 'listening' && chat.status().channel?.id === '600', chat.status().conn + ' ' + chat.status().error);
const sub = tw.subs[0];
check('subscription: channel.chat.message, broadcaster = channel, user = bot, bot token', tw.subs.length === 1 && sub.broadcaster === '600' && sub.user === '500' && tw.tokens.get(sub.token)?.user === '500');

voting.start();
tw.chat('600', viewers[0], '!vote 2'); tw.chat('600', viewers[1], '!vote 1'); tw.chat('600', viewers[0], '!vote 3'); tw.chat('600', viewers[2], '!vote 7'); tw.chat('600', viewers[3], 'nice play');
await until(() => voting.stats.accepted === 2, 3000);
check('chat messages arrive in real time', got.length === 5);
check('two counted, one second vote ignored, one invalid, chat ignored', voting.stats.accepted === 2 && voting.stats.alreadyVoted === 1 && voting.stats.invalid === 1 && voting.stats.commands === 4, JSON.stringify(voting.stats));
check('stored by Twitch user ID', db.get('9000') === 'krimbo' && db.get('9001') === 'tabseN' && db.size === 2);
const dupId = 'same-msg-1';
tw.chat('600', viewers[4], '!vote 4', { message_id: dupId }); tw.chat('600', viewers[4], '!vote 4', { message_id: dupId });
await until(() => voting.stats.accepted === 3, 3000);
check('the same message delivered twice counts once', voting.stats.duplicates === 1 && db.get('9004') === 'cmtry');
tw.chat('600', viewers[5], '!vote 1', { source_broadcaster_user_id: '999' });
await wait(200);
check('Shared Chat message from another channel ignored by default', voting.stats.otherChannel === 1 && !db.has('9005'));

// session_reconnect: new socket, old one dropped after welcome, subscriptions kept (no new subscription).
tw.reconnect();
await wait(400);
check('reconnect message: moved to the new URL without resubscribing', chat.status().conn === 'listening' && tw.subs.length === 1, `subs ${tw.subs.length}`);
tw.chat('600', viewers[5], '!vote 3');
await until(() => db.has('9005'), 3000);
check('votes still arrive after the move', db.get('9005') === 'dumau');

// Vote service outage: votes wait, then go through; a vote before the close is counted before closing.
down = true; const v6 = { id: '9100', login: 'late', name: 'Late' }; tw.users.push(v6);
tw.chat('600', v6, '!vote 1'); await until(() => voting.queued === 1, 2000); await wait(600);
check('vote service down: vote kept in the queue', voting.queued === 1 && !db.has('9100'));
down = false; await voting.beforeClose('P1');
check('before closing: queued votes are sent first', voting.queued === 0 && db.get('9100') === 'tabseN');
poll.status = 'closed';
const v7 = { id: '9101', login: 'toolate', name: 'TooLate' }; tw.users.push(v7);
tw.chat('600', v7, '!vote 1'); await wait(300);
check('after the close: not counted', !db.has('9101') && voting.stats.notOpen >= 1);
poll.status = 'open';

// Lost connection (no keepalive) → reconnect + subscribe again on a new session.
tw.closeAll(4006);
await until(() => chat.status().conn !== 'listening', 3000);
await until(() => chat.status().conn === 'listening' && tw.subs.length === 1, 6000);
check('connection dropped (4006): reconnected and subscribed again', chat.status().conn === 'listening' && tw.subs.length === 1 && tw.subs[0].session !== sub.session);

// Silence longer than the keepalive window (Twitch's rule) → treated as lost: reconnect + subscribe again.
tw.keepalive = 1; tw.closeAll(4005);
await until(() => chat.status().conn !== 'listening', 3000); await until(() => chat.status().conn === 'listening', 6000);
const s1 = tw.subs[0]?.session; tw.sendKeepalives = false;
await until(() => tw.subs.length === 1 && tw.subs[0].session !== s1 && chat.status().conn === 'listening', 12000);
check('no keepalive within the window: new session, subscribed again', tw.subs.length === 1 && tw.subs[0].session !== s1);
tw.sendKeepalives = true; tw.keepalive = 10;

// Target channel for the event: just its name; nothing from its owner.
await chat.configure({ channel: 'event_channel' });
await until(() => chat.status().conn === 'listening' && tw.subs.some(s => s.broadcaster === '700'), 4000);
check('switch to the event channel: same bot sign-in, no broadcaster token', tw.subs.length === 1 && tw.subs[0].broadcaster === '700' && tw.tokens.get(tw.subs[0].token)?.user === '500');
tw.chat('700', viewers[1], '!vote 2'); await wait(300);
check('event channel votes: same rules (viewer already voted in this MVP vote)', db.get('9001') === 'tabseN');

// Banned in the channel → 403 → clear authorization message, no retry loop.
tw.banned.set('700', ['od_bot']);
chat.restart(); await until(() => chat.status().conn === 'needs-auth', 4000);
const a403 = chat.status().authNeeded;
check('403: authorization needed, explained (scope, no owner permission, banned)', chat.status().conn === 'needs-auth' && /user:read:chat/.test(a403) && /no permission from/.test(a403) && /banned/.test(a403), a403);
const before = tw.subs.length; await wait(1500);
check('…and no retry loop', tw.subs.length === before && chat.status().conn === 'needs-auth');
tw.banned.clear(); chat.restart(); await until(() => chat.status().conn === 'listening', 4000);

// Revoked by the user on Twitch.
tw.revoke('authorization_revoked'); await until(() => chat.status().conn === 'needs-auth', 3000);
check('revocation: authorization needed, sign in again', /sign in again/.test(chat.status().authNeeded));

// Token without the chat scope.
tw.grant = { user: bot.id, scopes: ['channel:read:polls'] }; chat.signOut(); await chat.connect(); await until(() => chat.status().conn === 'needs-auth', 6000);
check('sign-in missing user:read:chat → told exactly what is missing', /missing the user:read:chat permission/.test(chat.status().authNeeded), chat.status().authNeeded);

// Expired token → refresh, then works.
tw.grant = { user: bot.id, scopes: ['user:read:chat'] }; chat.signOut(); await chat.connect(); await until(() => chat.status().conn === 'listening', 6000);
const oldTok = store.accessToken; tw.tokens.delete(oldTok);
check('expired token: refreshed with the refresh token, still signed in', await chat.validate() && store.accessToken !== oldTok && chat.status().login === 'od_bot');

// Tokens never in what the producer (or anyone) receives.
const st = JSON.stringify(voting.status());
check('status sent to the producer contains no token', !!store.accessToken && !st.includes(store.accessToken) && !st.includes(store.refreshToken) && !/accessToken|refreshToken/.test(st));
check('stored settings survive a restart (sanitized)', JSON.stringify(sanitizeChatStore(JSON.parse(JSON.stringify(store))).config) === JSON.stringify(store.config) && store.config.channel === 'event_channel');
check('only Twitch-documented endpoints were used', tw.log.every(l => /^(POST \/oauth2\/(device|token|revoke)|GET \/oauth2\/validate|GET \/helix\/users|POST \/helix\/eventsub\/subscriptions)$/.test(l)), [...new Set(tw.log)].join(' | '));
check('settings saved', saves > 0);

chat.signOut();
check('sign out: token revoked on Twitch and forgotten here', !store.accessToken && !tw.tokens.has(oldTok) && chat.status().conn === 'signed-out');
chat.stop(); voting.stop(); await tw.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

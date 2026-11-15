// Chat votes against a real Postgres (the vote service's schema + SQL). Needs psql and a scratch database:
//   PGTEST="psql -h /tmp -p 5544 -U postgres" npx tsx tests/chatVotes.pg.test.ts
// Skipped (exit 0) when PGTEST is not set. The database `od_chatvote_test` is dropped and recreated.
import { execFileSync } from 'node:child_process';
import { SCHEMA } from '../vote/db';
import { recordChatVotes, type Query } from '../vote/chatVotes';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const PG = process.env.PGTEST;
if (!PG) { console.log('SKIP: set PGTEST to run against Postgres'); process.exit(0); }
const [bin, ...base] = PG.split(/\s+/);
const run = (db: string, sql: string) => execFileSync(bin, [...base, '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { encoding: 'utf8' });
run('postgres', 'drop database if exists od_chatvote_test'); run('postgres', 'create database od_chatvote_test');
const DB = 'od_chatvote_test';

// Test-only parameter binding (psql has no bind parameters): literals, quoted.
const lit = (v: unknown): string => v == null ? 'NULL' : Array.isArray(v) ? `ARRAY[${v.map(lit).join(',')}]` : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
function csv(out: string): any[] {
  const lines = out.trim() ? out.trim().split('\n') : [];
  if (lines.length < 1) return [];
  const head = lines[0].split(',');
    // psql --csv: rebuild the types the pg driver gives (booleans, jsonb, NULL); one-line values only.
  const val = (raw: string) => { const x = /^".*"$/.test(raw) ? raw.slice(1, -1).replace(/""/g, '"') : raw; return x === 't' ? true : x === 'f' ? false : x === '' ? null : /^[\[{]/.test(x) ? JSON.parse(x) : x; };
  return lines.slice(1).map(l => Object.fromEntries(splitCsv(l).map((x, i) => [head[i], val(x)])));
}
function splitCsv(l: string): string[] {
  const out: string[] = []; let cur = '', inq = false;
  for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') { if (inq && l[i + 1] === '"') { cur += '""'; i++; } else { inq = !inq; cur += c; } } else if (c === ',' && !inq) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}
const q: Query = async (sql, params = []) => {
  const s = sql.replace(/\$(\d+)(::[a-z0-9\[\]]+)?/g, (_m, n, cast) => { const v = params[Number(n) - 1]; return Array.isArray(v) && !v.length ? `ARRAY[]${cast ?? '::text[]'}` : lit(v) + (cast ?? ''); });
  const rows = csv(run(DB, s));
  return { rows, rowCount: rows.length };
};

run(DB, SCHEMA);
run(DB, `insert into sessions(id, name) values ('s','S');
  insert into matches(session, id, label, a, b, winner) values ('s','m1','UQF1','BIG','FUT','BIG');
  insert into polls(id, session, match, label, result, players, status, chat) values
   ('p1','s','m1','UQF1','BIG 3-1 FUT','[{"handle":"tabseN"},{"handle":"krimbo"},{"handle":"dumau"},{"handle":"cmtry"},{"handle":"syrsoN"}]','open', true),
   ('p2','s','m1','UQF1','x','[{"handle":"a"},{"handle":"b"}]','draft', true),
   ('p3','s','m1','UQF1','x','[{"handle":"a"},{"handle":"b"}]','open', false);`);
const V = (msg: string, user: string, choice: number, at = Date.now()) => ({ msg, user, name: 'u' + user, choice, at });

const r1 = await recordChatVotes(q, 'p1', [V('m1', '1001', 1), V('m2', '1002', 2), V('m3', '1001', 3), V('m4', '1003', 4)]);
check('first vote per account counts; a second one in the same batch is ignored', JSON.stringify(r1.map(r => r.result)) === '["accepted","accepted","already-voted","accepted"]', JSON.stringify(r1));
check('choice number → candidate in prepared order', r1[0].player === 'tabseN' && r1[1].player === 'krimbo' && r1[3].player === 'cmtry');
const r2 = await recordChatVotes(q, 'p1', [V('m5', '1001', 2), V('m6', '1004', 5), V('m7', '1005', 0)]);
check('a later batch cannot change a vote', r2[0].result === 'already-voted');
check('!vote 5 refused (the graphic shows four candidates) and 0 refused', r2[1].result === 'invalid' && r2[2].result === 'invalid');
check('malformed entries refused, never stored', (await recordChatVotes(q, 'p1', [{ msg: 'x', user: 'not-a-number', name: 'z', choice: 1, at: 1 }, null]))[0].result === 'invalid');
const counts = csv(run(DB, "select player, source, count(*) n from mvp_votes where poll='p1' group by player, source order by player"));
check('stored with source = chat', counts.length === 3 && counts.every(r => r.source === 'chat'), JSON.stringify(counts));

// Website voter (same Twitch account) — the website stores the Twitch user ID confirmed at sign-in.
run(DB, "insert into viewers(twitch_id, name) values ('2001','webby'); insert into mvp_votes(poll, viewer, player) select 'p1', id, 'dumau' from viewers where twitch_id='2001'");
const r3 = await recordChatVotes(q, 'p1', [V('m8', '2001', 1)]);
check('voted on the website → the same Twitch account cannot vote again in chat', r3[0].result === 'already-voted');
const webAfterChat = run(DB, "insert into mvp_votes(poll, viewer, player) select 'p1', id, 'tabseN' from viewers where twitch_id='1002' on conflict (poll, viewer) do nothing returning viewer");
check('voted in chat → the website insert (same statement as /v1/mvp) is ignored', csv(webAfterChat).length === 0);

check('draft vote: chat refused', (await recordChatVotes(q, 'p2', [V('m9', '3001', 1)]))[0].result === 'closed');
check('chat not enabled for this vote: refused', (await recordChatVotes(q, 'p3', [V('m10', '3001', 1)]))[0].result === 'closed');
check('unknown vote: refused', (await recordChatVotes(q, 'nope', [V('m11', '3001', 1)]))[0].result === 'closed');
run(DB, "update polls set closes_at = now() - interval '1 second' where id='p1'");
const late = await recordChatVotes(q, 'p1', [V('m12', '3002', 1, Date.now()), V('m13', '3003', 1, Date.now() - 60000)]);
check('countdown: a vote read after the end is refused, one read before still counts', late[0].result === 'closed' && late[1].result === 'accepted', JSON.stringify(late));
run(DB, "update polls set status='closed' where id='p1'");
check('closed vote: chat refused', (await recordChatVotes(q, 'p1', [V('m14', '3004', 1)]))[0].result === 'closed');
const tot = csv(run(DB, "select count(*) n from mvp_votes where poll='p1'"))[0].n;
check('totals: 3 chat + 1 website + 1 before the countdown = 5', tot === '5', tot);

// Volume: 1 000 votes in one batch, 400 accounts voting twice.
run(DB, "update polls set status='open', closes_at = null where id='p1'");
const big = Array.from({ length: 1000 }, (_, i) => V('b' + i, String(10000 + (i % 600)), (i % 4) + 1));
const t0 = Date.now(); const rb = await recordChatVotes(q, 'p1', big); const ms = Date.now() - t0;
check('1 000-vote batch: 600 accounts counted once each', rb.filter(r => r.result === 'accepted').length === 600 && rb.filter(r => r.result === 'already-voted').length === 400, `${ms} ms`);
const names = csv(run(DB, "select count(*) n from viewers where twitch_id like '1____'"))[0].n;
check('viewers by Twitch ID created once', names === '600');

// The vote service's other new statements (same text as vote/server.ts).
const src = csv(run(DB, "select v.poll, v.player, v.source, count(*)::int n from mvp_votes v join polls p on p.id = v.poll where p.session = 's' group by v.poll, v.player, v.source"));
check('summary query: counts split by source', src.some(r => r.source === 'web') && src.some(r => r.source === 'chat'));
const upd = csv(run(DB, "update polls set web = false, chat = true, chat_cmd = '!vote', chat_channel = 'overdrive_tm' where id = 'p2' and status in ('draft','open') returning id, web, chat"));
check('methods update on a prepared vote', upd.length === 1 && upd[0].web === false && upd[0].chat === true);
check('methods refused once closed', csv(run(DB, "update polls set web = true where id = 'p1x' and status in ('draft','open') returning id")).length === 0);
check('existing website votes keep source = web (column default)', csv(run(DB, "select source from mvp_votes v join viewers w on w.id = v.viewer where w.twitch_id = '2001'"))[0].source === 'web');
run('postgres', 'drop database od_chatvote_test');
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

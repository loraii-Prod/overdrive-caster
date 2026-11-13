/** Vote service storage: Postgres (Render Postgres in production). Every write is one transaction. */
import pg from 'pg';

export const SCHEMA = `
create table if not exists meta(k text primary key, v text not null);
create table if not exists sessions(id text primary key, name text not null, champion_locked boolean not null default false, updated timestamptz not null default now());
create table if not exists matches(
  session text not null references sessions(id), id text not null, ord int not null default 0, label text not null,
  a text not null, b text not null, best_of int not null default 5, live boolean not null default false, locked boolean not null default false,
  winner text, score text, revealed boolean not null default false, listed boolean not null default true,
  updated timestamptz not null default now(), primary key(session, id));
create table if not exists viewers(id bigserial primary key, twitch_id text unique not null, name text not null, created timestamptz not null default now());
create table if not exists viewer_sessions(token_hash text primary key, viewer bigint not null references viewers(id), created timestamptz not null default now(), expires timestamptz not null);
create table if not exists picks(session text not null, match text not null, viewer bigint not null references viewers(id), team text not null, score text not null default '',
  updated timestamptz not null default now(), primary key(session, match, viewer), foreign key(session, match) references matches(session, id));
create table if not exists champion_picks(session text not null references sessions(id), viewer bigint not null references viewers(id), team text not null,
  updated timestamptz not null default now(), primary key(session, viewer));
create table if not exists polls(id text primary key, session text not null references sessions(id), match text not null, label text not null, result text not null,
  players jsonb not null, status text not null check (status in ('draft','open','closed','revealed')), opened_at timestamptz, closed_at timestamptz, frozen jsonb,
  created timestamptz not null default now());
create table if not exists mvp_votes(poll text not null references polls(id), viewer bigint not null references viewers(id), player text not null,
  at timestamptz not null default now(), primary key(poll, viewer));
create table if not exists audit(id bigserial primary key, at timestamptz not null default now(), actor text not null, action text not null, ref text not null default '',
  before jsonb, after jsonb);
create index if not exists picks_match on picks(session, match);
create index if not exists votes_poll on mvp_votes(poll);
`;

export type Db = pg.Pool;

export async function openDb(url: string): Promise<Db> {
  const ssl = /sslmode=require/.test(url) || /render\.com/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, max: 10, ssl, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  pool.on('error', e => console.error('[vote] db pool error', e.message));
  await pool.query(SCHEMA);
  return pool;
}

/** Run fn in one transaction (rolled back on any error). */
export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export const audit = (c: pg.PoolClient | Db, actor: string, action: string, ref: string, before: unknown, after: unknown) =>
  c.query('insert into audit(actor, action, ref, before, after) values ($1,$2,$3,$4,$5)', [actor, action, ref, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)]);

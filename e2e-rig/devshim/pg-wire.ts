/**
 * Test rig only (never shipped): a small PostgreSQL client speaking the v3 wire protocol, for machines where the `pg`
 * package cannot be installed. Same surface as the part of `pg` the vote service uses: Pool(query, connect → client
 * with query/release, on, end), results { rows, rowCount, fields }, text-format values parsed like pg's defaults
 * (bool, int2/int4, float, json/jsonb, timestamp(tz) → Date; int8 / numeric stay strings). Trust or cleartext auth.
 */
import net from 'node:net';

type Row = Record<string, any>;
export interface QueryResult { rows: Row[]; rowCount: number; fields: { name: string; dataTypeID: number }[] }

const parseVal = (oid: number, s: string): any => {
  switch (oid) {
    case 16: return s === 't';
    case 21: case 23: case 26: return Number(s);
    case 700: case 701: return Number(s);
    case 114: case 3802: return JSON.parse(s);
    case 1114: return new Date(s.replace(' ', 'T') + 'Z');
    case 1184: return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    case 1009: case 1015: return parseArr(s);
    case 1007: return parseArr(s).map(Number);
    default: return s;
  }
};
function parseArr(s: string): string[] {
  const out: string[] = []; if (s === '{}') return out;
  let i = 1, cur = '', q = false;
  for (; i < s.length - 1; i++) {
    const c = s[i];
    if (q) { if (c === '\\') cur += s[++i]; else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const lit = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return '{' + v.map(x => (x === null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

class Conn {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private wait: ((t: string, b: Buffer) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private o: { host: string; port: number; user: string; database: string; password?: string }) {}
  async open() {
    this.sock = net.connect(this.o.port, this.o.host);
    this.sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    await new Promise<void>((res, rej) => { this.sock.once('connect', () => res()); this.sock.once('error', rej); });
    const kv = Buffer.from(`user\0${this.o.user}\0database\0${this.o.database}\0\0`);
    const h = Buffer.alloc(8); h.writeInt32BE(8 + kv.length); h.writeInt32BE(196608, 4);
    this.sock.write(Buffer.concat([h, kv]));
    for (;;) {
      const [t, b] = await this.next();
      if (t === 'R' && b.readInt32BE(0) === 3) this.send('p', Buffer.from((this.o.password ?? '') + '\0'));
      else if (t === 'R' && b.readInt32BE(0) !== 0) throw new Error('pg-wire: unsupported authentication');
      else if (t === 'E') throw new Error(errText(b));
      else if (t === 'Z') return;
    }
  }
  private pump() {
    while (this.buf.length >= 5 && this.wait) {
      const len = this.buf.readInt32BE(1); if (this.buf.length < 1 + len) return;
      const t = String.fromCharCode(this.buf[0]), b = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      const w = this.wait; this.wait = null; w(t, b);
    }
  }
  private next(): Promise<[string, Buffer]> { return new Promise(res => { this.wait = (t, b) => res([t, b]); this.pump(); }); }
  private send(t: string, body: Buffer) { const h = Buffer.alloc(5); h.write(t); h.writeInt32BE(4 + body.length, 1); this.sock.write(Buffer.concat([h, body])); }
  query(text: string, params?: any[]): Promise<QueryResult> {
    const run = this.chain.then(() => this.run(text, params));
    this.chain = run.catch(() => {});
    return run;
  }
  private async run(text: string, params?: any[]): Promise<QueryResult> {
    if (!params || !params.length) this.send('Q', Buffer.from(text + '\0'));
    else {
      this.send('P', Buffer.concat([Buffer.from(`\0${text}\0`), Buffer.from([0, 0])]));
      const parts: Buffer[] = [Buffer.from('\0\0'), i16(0), i16(params.length)];
      for (const p of params) { const v = lit(p); if (v === null) parts.push(i32(-1)); else { const b = Buffer.from(v); parts.push(i32(b.length), b); } }
      parts.push(i16(0));
      this.send('B', Buffer.concat(parts)); this.send('D', Buffer.from('P\0')); this.send('E', Buffer.concat([Buffer.from('\0'), i32(0)])); this.send('S', Buffer.alloc(0));
    }
    let fields: { name: string; dataTypeID: number }[] = [], rows: Row[] = [], rowCount = 0, err: string | null = null;
    for (;;) {
      const [t, b] = await this.next();
      if (t === 'T') { fields = []; rows = []; let o = 2; for (let i = 0; i < b.readInt16BE(0); i++) { const e = b.indexOf(0, o); const name = b.toString('utf8', o, e); o = e + 1; const oid = b.readInt32BE(o + 6); o += 18; fields.push({ name, dataTypeID: oid }); } }
      else if (t === 'D') { const r: Row = {}; let o = 2; for (let i = 0; i < b.readInt16BE(0); i++) { const n = b.readInt32BE(o); o += 4; r[fields[i].name] = n < 0 ? null : parseVal(fields[i].dataTypeID, b.toString('utf8', o, o + n)); if (n > 0) o += n; } rows.push(r); }
      else if (t === 'C') { const m = /(\d+)\s*$/.exec(b.toString('utf8', 0, b.length - 1)); rowCount = m ? Number(m[1]) : 0; }
      else if (t === 'E') err = errText(b);
      else if (t === 'Z') break;
    }
    if (err) throw Object.assign(new Error(err), { code: 'PG' });
    return { rows, rowCount, fields };
  }
  end() { try { this.send('X', Buffer.alloc(0)); this.sock.end(); } catch { /* closed */ } }
}
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
function errText(b: Buffer) { const f: Record<string, string> = {}; let o = 0; while (o < b.length && b[o] !== 0) { const k = String.fromCharCode(b[o]); const e = b.indexOf(0, o + 1); f[k] = b.toString('utf8', o + 1, e); o = e + 1; } return f.M ?? 'database error'; }

export class Pool {
  private free: Conn[] = [];
  private cfg: { host: string; port: number; user: string; database: string; password?: string };
  constructor(o: { connectionString?: string } = {}) {
    const u = new URL(o.connectionString ?? 'postgres://postgres@127.0.0.1:5432/postgres');
    this.cfg = { host: u.hostname, port: Number(u.port) || 5432, user: decodeURIComponent(u.username) || 'postgres', database: u.pathname.slice(1) || 'postgres', password: decodeURIComponent(u.password) || undefined };
  }
  private async take() { const c = this.free.pop(); if (c) return c; const n = new Conn(this.cfg); await n.open(); return n; }
  async query(text: string, params?: any[]) { const c = await this.take(); try { return await c.query(text, params); } finally { this.free.push(c); } }
  async connect() { const c = await this.take(); return { query: (t: string, p?: any[]) => c.query(t, p), release: () => { this.free.push(c); } }; }
  on() { return this; }
  async end() { for (const c of this.free) c.end(); this.free = []; }
}
export type PoolClient = Awaited<ReturnType<Pool['connect']>>;
export default { Pool };

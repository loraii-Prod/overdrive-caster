// Minimal Express-5-compatible shim for the sandbox build only (no npm installs available here). Not shipped.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

type Next = (err?: unknown) => void;
type Handler = (req: any, res: any, next: Next) => unknown;
interface Layer { method: string | null; path: string | RegExp | null; prefix: boolean; fns: (Handler | Router)[] }

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.gif': 'image/gif', '.txt': 'text/plain', '.ttf': 'font/ttf', '.zip': 'application/zip' };

function match(p: string | RegExp, url: string, prefix: boolean): Record<string, string> | null {
  if (p instanceof RegExp) { const m = p.exec(url); return m ? { ...(m.groups ?? {}) } : null; }
  if (prefix) { if (p === '/' ) return {}; return url === p || url.startsWith(p.endsWith('/') ? p : p + '/') ? {} : null; }
  const names: string[] = [];
  const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([^}]*)\\\}/g, '(?:$1)?').replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }).replace(/\*(\w*)/g, (_, n) => { names.push(n || '0'); return '(.*)'; }) + '/?$');
  const m = re.exec(url); if (!m) return null;
  const o: Record<string, string> = {}; names.forEach((n, i) => { if (m[i + 1] !== undefined) o[n] = decodeURIComponent(m[i + 1]); }); return o;
}

function enhance(req: any, res: any) {
  if (res.__od) return; res.__od = true;
  const u = new URL(req.url, 'http://x');
  req.path = u.pathname; req.query = Object.fromEntries(u.searchParams); req.originalUrl = req.url;
  req.ip = req.socket?.remoteAddress; req.header = req.get = (n: string) => req.headers[n.toLowerCase()];
  req.params = {};
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.set = (k: string, v: string) => { res.setHeader(k, v); return res; };
  res.json = (v: unknown) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(v)); return res; };
  res.send = (v: unknown) => { if (typeof v === 'object' && !Buffer.isBuffer(v)) return res.json(v); if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', Buffer.isBuffer(v) ? 'application/octet-stream' : 'text/html; charset=utf-8'); res.end(v); return res; };
  res.sendStatus = (c: number) => { res.statusCode = c; res.end(String(c)); return res; };
  res.type = (t: string) => { res.setHeader('Content-Type', t.includes('/') ? t : MIME['.' + t] ?? t); return res; };
  res.redirect = (a: any, b?: any) => { const [c, l] = typeof a === 'number' ? [a, b] : [302, a]; res.statusCode = c; res.setHeader('Location', l); res.end(); };
  res.cookie = (n: string, v: string, o: any = {}) => { const parts = [`${n}=${encodeURIComponent(v)}`, `Path=${o.path ?? '/'}`]; if (o.httpOnly) parts.push('HttpOnly'); if (o.maxAge) parts.push(`Max-Age=${Math.floor(o.maxAge / 1000)}`); if (o.sameSite) parts.push(`SameSite=${o.sameSite}`); const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]); return res; };
  res.append = (k: string, v: string | string[]) => { const prev = res.getHeader(k); res.setHeader(k, [...(Array.isArray(prev) ? prev : prev != null ? [String(prev)] : []), ...(Array.isArray(v) ? v : [v])]); return res; };
  res.clearCookie = (n: string, o: any = {}) => res.cookie(n, '', { ...o, maxAge: 1 });
  res.sendFile = (f: string, _o?: any, cb?: (e?: unknown) => void) => { fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); cb?.(e); return; } if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream'); res.end(d); cb?.(); }); };
}

class Router {
  layers: Layer[] = [];
  settings: Record<string, unknown> = {};
  private add(method: string | null, prefix: boolean, args: any[]) {
    const p = typeof args[0] === 'string' || args[0] instanceof RegExp ? args.shift() : null;
    this.layers.push({ method, path: p, prefix, fns: args.flat() });
    return this;
  }
  use(...a: any[]) { return this.add(null, true, a); }
  get(...a: any[]) { if (a.length === 1 && typeof a[0] === 'string') return this.settings[a[0]]; return this.add('GET', false, a); }
  post(...a: any[]) { return this.add('POST', false, a); }
  put(...a: any[]) { return this.add('PUT', false, a); }
  patch(...a: any[]) { return this.add('PATCH', false, a); }
  delete(...a: any[]) { return this.add('DELETE', false, a); }
  all(...a: any[]) { return this.add('ALL', false, a); }
  disable(k: string) { this.settings[k] = false; } set(k: string, v: unknown) { this.settings[k] = v; }
  handle(req: any, res: any, done: Next) {
    enhance(req, res);
    let i = 0;
    const base = req.__base ?? '';
    const step = (err?: unknown): void => {
      const l = this.layers[i++];
      if (!l) return done(err);
      const url: string = req.path.slice(base.length) || '/';
      if (l.method && l.method !== 'ALL' && l.method !== req.method && !(l.method === 'GET' && req.method === 'HEAD')) return step(err);
      const params = l.path == null ? {} : match(l.path, url, l.prefix);
      if (!params) return step(err);
      req.params = { ...params };
      let j = 0;
      const run = (e?: unknown): void => {
        const fn = l.fns[j++];
        if (!fn) return step(e);
        try {
          if (fn instanceof Router) {
            const prevBase = req.__base; req.__base = base + (l.prefix && typeof l.path === 'string' && l.path !== '/' ? l.path : '');
            return fn.handle(req, res, er => { req.__base = prevBase; run(er); });
          }
          if (e) { if ((fn as Function).length === 4) return (fn as any)(e, req, res, run); return run(e); }
          if ((fn as Function).length === 4) return run();
          req.__mount = base + (l.prefix && typeof l.path === 'string' && l.path !== '/' ? l.path : ''); // app.use('/assets', static(...))
          const r = (fn as Handler)(req, res, run);
          if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(run);
        } catch (er) { run(er); }
      };
      run(err);
    };
    step();
  }
}

function body(kind: 'json' | 'raw' | 'text', opts: any = {}) {
  return (req: any, _res: any, next: Next) => {
    if (req.__bodyRead || req.method === 'GET' || req.method === 'HEAD') return next();
    const ct = String(req.headers['content-type'] ?? '');
    const t = opts.type;
    const ok = kind === 'json' ? /json/.test(ct) : typeof t === 'function' ? t(req) : Array.isArray(t) ? t.some((x: string) => ct.includes(x)) : typeof t === 'string' ? ct.includes(t) || t === '*/*' : kind === 'text' ? /text/.test(ct) : /octet-stream/.test(ct);
    if (!ok) { if (kind === 'json' && req.body === undefined) req.body = {}; return next(); }
    req.__bodyRead = true;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      try { req.body = kind === 'json' ? (buf.length ? JSON.parse(buf.toString('utf8')) : {}) : kind === 'text' ? buf.toString('utf8') : buf; next(); }
      catch { const e: any = new Error('bad json'); e.status = 400; next(e); }
    });
    req.on('error', next);
  };
}

function serveStatic(dir: string, opts: any = {}) {
  return (req: any, res: any, next: Next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rel = decodeURIComponent((req.path.slice((req.__mount ?? req.__base ?? '').length) || '/'));
    const f = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.resolve(dir))) return next();
    fs.stat(f, (e, s) => {
      if (e || !s.isFile()) return next();
      res.setHeader('Content-Type', MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Content-Length', s.size);
      opts.setHeaders?.(res, f, s);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f).pipe(res);
    });
  };
}

function express() {
  const r = new Router();
  const app: any = (req: http.IncomingMessage, res: http.ServerResponse) => r.handle(req, res, (err?: any) => {
    if (res.headersSent) return;
    if (err) { res.statusCode = err.status ?? 500; res.end(err.message ?? 'error'); return; }
    res.statusCode = 404; res.end('Not found');
  });
  for (const k of ['use', 'get', 'post', 'put', 'patch', 'delete', 'all', 'disable', 'set'] as const) app[k] = (...a: any[]) => { const v = (r as any)[k](...a); return v === r ? app : v; };
  app.handle = r.handle.bind(r);
  app.listen = (...a: any[]) => http.createServer(app).listen(...a);
  return app;
}
express.Router = () => new Router();
express.json = (o?: any) => body('json', o);
express.raw = (o?: any) => body('raw', o);
express.text = (o?: any) => body('text', o);
express.static = serveStatic;
export default express;
export type Request = any; export type Response = any; export type NextFunction = Next;

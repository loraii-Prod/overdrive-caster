import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { parseCookie } from 'cookie';
import { config } from './config';
import { db, newKey, save } from './store';

export const COOKIE = 'glacial_session';
const TTL = 1000 * 60 * 60 * 24 * 14; // 14 days: survives a tournament weekend + restarts

/** producer = full control (incl. tournament). admin = tournament data only. */
export type AuthRole = 'producer' | 'admin';

function producerPassword(): string {
  if (config.controllerPassword) return config.controllerPassword;
  if (!db.generatedPassword) { db.generatedPassword = newKey(9); save(); }
  return db.generatedPassword;
}

function adminPassword(): string {
  if (config.adminPassword) return config.adminPassword;
  if (!db.generatedAdminPassword) { db.generatedAdminPassword = newKey(9); save(); }
  return db.generatedAdminPassword;
}

export function announcePassword() {
  if (!config.controllerPassword) console.log(`\n  Producer password (generated, set CONTROLLER_PASSWORD to override): ${producerPassword()}`);
  if (!config.adminPassword) console.log(`  Tournament admin password (generated, set ADMIN_PASSWORD to override): ${adminPassword()}`);
  console.log('');
}

const eq = (a: string, b: string) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

export function checkPassword(attempt: string): AuthRole | null {
  const a = String(attempt);
  if (eq(a, producerPassword())) return 'producer';
  if (eq(a, adminPassword())) return 'admin';
  return null;
}

export function createSession(role: AuthRole): string {
  const token = newKey(32);
  db.sessions[token] = { exp: Date.now() + TTL, role };
  save();
  return token;
}

export function destroySession(token?: string) {
  if (token && db.sessions[token]) { delete db.sessions[token]; save(); }
}

export function sessionFrom(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (!header) return;
  const token = parseCookie(header)[COOKIE];
  if (!token) return;
  const s = db.sessions[token];
  if (!s || s.exp < Date.now()) return;
  return token;
}

export function roleFrom(req: IncomingMessage): AuthRole | null {
  const t = sessionFrom(req);
  return t ? db.sessions[t].role : null;
}

/** Producer session (full control). */
export const isAuthed = (req: IncomingMessage) => roleFrom(req) === 'producer';
/** Producer or tournament admin. */
export const isAdmin = (req: IncomingMessage) => roleFrom(req) !== null;

// Small brute-force guard for the login endpoint.
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(ip: string): boolean {
  const a = attempts.get(ip);
  return !a || a.until < Date.now() || a.n < 8;
}
export function noteFailure(ip: string) {
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { n: 1, until: Date.now() + 5 * 60_000 });
  else a.n++;
}

export function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies, maxAge: TTL, path: '/' };
}

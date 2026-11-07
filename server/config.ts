import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  /** Producer password. If unset, one is generated on first start and printed. */
  controllerPassword: env.CONTROLLER_PASSWORD ?? '',
  /** Tournament admins: can edit teams/bracket/results only (no producer controls). */
  adminPassword: env.ADMIN_PASSWORD ?? '',
  /** Optional: require ?key=... on /output/* URLs. Leave empty for open read-only outputs. */
  outputKey: env.OUTPUT_KEY ?? '',
  /** Set when serving behind HTTPS so session cookies get the Secure flag. */
  secureCookies: env.SECURE_COOKIES === '1',
  stunUrls: (env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
  turnUrls: (env.TURN_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  /** coturn `static-auth-secret` – preferred: short-lived credentials are minted per client. */
  turnSecret: env.TURN_SECRET ?? '',
  turnUsername: env.TURN_USERNAME ?? '',
  turnCredential: env.TURN_CREDENTIAL ?? '',
  obsUrl: env.OBS_WS_URL ?? '',
  obsPassword: env.OBS_WS_PASSWORD ?? '',
};

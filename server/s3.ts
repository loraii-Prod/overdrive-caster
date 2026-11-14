/**
 * Minimal S3 client (Cloudflare R2 in production; any S3-compatible store works). Server only: the access keys come
 * from the environment and are never sent to a browser, written to state.json or logged.
 *
 * Env: R2_ACCOUNT_ID (or R2_ENDPOINT for another S3 store), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 */
import { AwsClient } from 'aws4fetch';

const env = process.env;
export interface S3Conf { endpoint: string; bucket: string; key: string; secret: string; region: string }
export function s3Conf(): S3Conf | null {
  const endpoint = (env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')).replace(/\/$/, '');
  if (!endpoint || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return { endpoint, bucket: env.R2_BUCKET, key: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY, region: env.R2_REGION || 'auto' };
}

export class S3 {
  private aws: AwsClient;
  constructor(private c: S3Conf) {
    this.aws = new AwsClient({ accessKeyId: c.key, secretAccessKey: c.secret, service: 's3', region: c.region });
  }
  private url(key: string, q = '') { return `${this.c.endpoint}/${this.c.bucket}/${key.split('/').map(encodeURIComponent).join('/')}${q}`; }
  private async go(method: string, key: string, init: { body?: BodyInit; headers?: Record<string, string>; q?: string; timeout?: number } = {}) {
    const r = await this.aws.fetch(this.url(key, init.q), { method, body: init.body, headers: init.headers, signal: AbortSignal.timeout(init.timeout ?? 20000) });
    return r;
  }
  async put(key: string, body: Buffer, type: string, meta: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'content-type': type, 'content-length': String(body.length) };
    for (const [k, v] of Object.entries(meta)) headers[`x-amz-meta-${k}`] = v;
    const r = await this.go('PUT', key, { body: new Uint8Array(body), headers, timeout: 600000 });
    if (!r.ok) throw new Error(`storage PUT ${r.status}`);
  }
  async get(key: string, range?: string): Promise<Response | null> {
    const r = await this.go('GET', key, { headers: range ? { range } : {}, timeout: 60000 });
    if (r.status === 404) return null;
    if (!r.ok && r.status !== 206) throw new Error(`storage GET ${r.status}`);
    return r;
  }
  async getBuffer(key: string): Promise<Buffer | null> {
    const r = await this.get(key);
    return r ? Buffer.from(await r.arrayBuffer()) : null;
  }
  async head(key: string): Promise<{ size: number; type: string } | null> {
    const r = await this.go('HEAD', key);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`storage HEAD ${r.status}`);
    return { size: Number(r.headers.get('content-length') ?? 0), type: r.headers.get('content-type') ?? '' };
  }
  async del(key: string) {
    const r = await this.go('DELETE', key);
    if (!r.ok && r.status !== 404) throw new Error(`storage DELETE ${r.status}`);
  }
  /** Keys under a prefix (newest-last by key name; snapshot keys are time-ordered). */
  async list(prefix: string, max = 1000): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    let token = '';
    do {
      const q = `?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
      const r = await this.aws.fetch(`${this.c.endpoint}/${this.c.bucket}${q}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`storage LIST ${r.status}`);
      const x = await r.text();
      for (const m of x.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const k = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1], s = /<Size>(\d+)<\/Size>/.exec(m[1])?.[1];
        if (k) out.push({ key: k.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), size: Number(s ?? 0) });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(x) ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(x)?.[1] ?? '') : '';
    } while (token && out.length < max);
    return out.sort((a, b) => a.key.localeCompare(b.key)).slice(-max);
  }
  /** Short-lived signed GET address (large media: OBS fetches it straight from storage; the bucket stays private). */
  async presign(key: string, seconds = 3600): Promise<string> {
    const u = new URL(this.url(key));
    u.searchParams.set('X-Amz-Expires', String(seconds));
    const s = await this.aws.sign(u.toString(), { method: 'GET', aws: { signQuery: true } });
    return s.url;
  }
}

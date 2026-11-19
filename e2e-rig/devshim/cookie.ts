export function parse(s: string) { const o: Record<string, string> = {}; for (const p of (s || '').split(/;\s*/)) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1)); } return o; }
export function serialize(n: string, v: string, o: any = {}) { return `${n}=${encodeURIComponent(v)}; Path=${o.path ?? '/'}`; }
export default { parse, serialize };
export const parseCookie = parse; export const stringifySetCookie = (n: any, v?: any, o?: any) => typeof n === "object" ? `${n.name}=${encodeURIComponent(n.value)}; Path=/` : serialize(n, v, o);

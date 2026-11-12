/**
 * Game feed for casters (low-latency OBS feed from the MediaMTX stream server, played over WebRTC/WHEP).
 * Settings live on the caster app's server; the password never goes to browsers.
 */
export type GameFeedMode = 'ultra' | 'low' | 'balanced' | 'smooth';
/** Browser jitter buffer per mode (ms), as on the stream server's own caster page. */
export const GAMEFEED_MODES: Record<GameFeedMode, { name: string; buf: number }> = {
  ultra: { name: 'Ultra', buf: 0 }, low: { name: 'Low', buf: 80 }, balanced: { name: 'Balanced', buf: 150 }, smooth: { name: 'Smooth', buf: 350 },
};
export type GameFeedSource = 'whep' | 'vdo';
export interface GameFeedSettings {
  enabled: boolean;
  /** whep = the MediaMTX stream server (login kept on this app's server); vdo = a VDO.Ninja view link played in an embedded player. */
  source: GameFeedSource;
  /** VDO.Ninja view / scene link (https). It goes to the casters' browsers as is, password included. */
  vdoUrl: string;
  /** WHEP endpoint of the stream server, e.g. http://<server>/live-web/whep */
  url: string;
  user: string;
  pass: string;
  /** Default latency mode for casters (they can change it on their page). */
  mode: GameFeedMode;
}
export const defaultGameFeed = (): GameFeedSettings => ({ enabled: false, source: 'whep', vdoUrl: '', url: '', user: 'caster', pass: '', mode: 'balanced' });
export function sanitizeGameFeed(v: any): GameFeedSettings {
  const d = defaultGameFeed();
  if (!v || typeof v !== 'object') return d;
  const url = typeof v.url === 'string' && /^https?:\/\/[^\s]+$/i.test(v.url.trim()) ? v.url.trim().slice(0, 300) : '';
  const vdoUrl = typeof v.vdoUrl === 'string' && /^https:\/\/[^\s]+$/i.test(v.vdoUrl.trim()) ? v.vdoUrl.trim().slice(0, 1000) : '';
  return {
    enabled: v.enabled === true,
    source: v.source === 'vdo' ? 'vdo' : 'whep',
    vdoUrl,
    url,
    user: typeof v.user === 'string' ? v.user.trim().slice(0, 64) : d.user,
    pass: typeof v.pass === 'string' ? v.pass.slice(0, 128) : '',
    mode: v.mode in GAMEFEED_MODES ? v.mode : d.mode,
  };
}

/** Is the selected source filled in? */
export const gameFeedReady = (g: GameFeedSettings) => (g.source === 'vdo' ? !!g.vdoUrl : !!g.url);

/** The VDO.Ninja link as casters load it: clean player, the chosen buffer. Their own parameters are kept. */
export function vdoFeedUrl(link: string, bufferMs: number): string {
  try {
    const u = new URL(link);
    if (!u.searchParams.has('cleanoutput') && !u.searchParams.has('clean')) u.searchParams.set('cleanoutput', '');
    u.searchParams.set('buffer', String(bufferMs));
    return u.toString().replace(/=(&|$)/g, '$1');
  } catch { return ''; }
}

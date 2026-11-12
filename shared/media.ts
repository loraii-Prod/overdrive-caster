/** Overdrive 2.0 media playback (/output/media): one playlist, server-timed so every copy of the source is in sync. */
export interface MediaState {
  /** Playlist: file URLs from the media library (/media/...). */
  playlist: string[];
  index: number;
  status: 'stopped' | 'playing' | 'paused';
  /** Server time the current item (re)started playing, minus the offset already played. */
  startedAt: number | null;
  /** Position (ms) while paused. */
  pausedMs: number;
  volume: number;
  muted: boolean;
  /** Go to the next item when one ends (and stop after the last unless loop). */
  auto: boolean;
  loop: boolean;
  /** Changes on every start, so an "ended" report is only accepted once per play. */
  seq: number;
}

export const defaultMedia = (): MediaState => ({ playlist: [], index: 0, status: 'stopped', startedAt: null, pausedMs: 0, volume: 1, muted: false, auto: true, loop: false, seq: 0 });

export const MEDIA_EXT = /\.(mp4|webm|mov|m4v|mp3|ogg|wav|m4a|png|jpe?g|webp|gif)$/i;
export const isVideo = (u: string) => /\.(mp4|webm|mov|m4v)$/i.test(u);
export const isAudio = (u: string) => /\.(mp3|ogg|wav|m4a)$/i.test(u);
export const mediaName = (u: string) => decodeURIComponent(u.split('/').pop() ?? '').replace(/^[A-Za-z0-9_-]{6}_/, '').replace(MEDIA_EXT, '');

export function sanitizeMedia(v: any): MediaState {
  const d = defaultMedia();
  if (!v || typeof v !== 'object') return d;
  const playlist = Array.isArray(v.playlist) ? v.playlist.filter((u: unknown) => typeof u === 'string' && u.startsWith('/media/') && !u.includes('..')).slice(0, 100) : [];
  return {
    playlist,
    index: Number.isInteger(v.index) && v.index >= 0 && v.index < Math.max(1, playlist.length) ? v.index : 0,
    status: 'stopped', // never resume playback by itself after a restart
    startedAt: null,
    pausedMs: 0,
    volume: typeof v.volume === 'number' ? Math.max(0, Math.min(1, v.volume)) : 1,
    muted: v.muted === true,
    auto: v.auto !== false,
    loop: v.loop === true,
    seq: 0,
  };
}

import { useEffect, useRef, useState } from 'react';
import { useLive, useSocket, query } from '../lib/hooks';
import { sectionFor, type MusicSection } from '../../shared/music';

type Track = { name: string; url: string; shared?: boolean };
export type MusicLibrary = Record<MusicSection, Track[]>;

export function useMusicLibrary(pollMs = 15000) {
  const [lib, setLib] = useState<MusicLibrary | null>(null);
  const [folder, setFolder] = useState('');
  const load = () => fetch('/api/music', { cache: 'no-store' }).then(r => r.json()).then(j => { setLib(j.sections); setFolder(j.folder); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, pollMs); return () => clearInterval(t); }, [pollMs]);
  return { lib, folder, reload: load, setLib };
}

/**
 * /output/music: plays the music bed of the screen on air, crossfading on every
 * screen change; each scene has its own tracks and level (0 = silent). Add it to OBS as a browser source with
 * "Control audio via OBS" so it gets its own mixer fader.
 */
export function MusicOutput() {
  useEffect(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; }, []);
  const sock = useSocket({ role: 'output', route: 'music', key: query().get('key') ?? undefined });
  const live = useLive(sock);
  const { lib } = useMusicLibrary();
  const debug = query().has('debug');
  const decks = useRef<HTMLAudioElement[]>([]);
  const cur = useRef(0); // index of the deck that is (fading) in
  const state = useRef<{ section: MusicSection | null; url: string | null }>({ section: null, url: null });
  const resume = useRef(new Map<MusicSection, { url: string; t: number }>());
  const last = useRef(new Map<MusicSection, string>());
  const [np, setNp] = useState('');

  const m = live?.show.music;
  const sec0 = live && m?.enabled ? sectionFor(live.scene.screen) : null;
  const section = sec0 && m && m.levels[sec0] > 0 ? sec0 : null; // level 0 = this scene is silent
  const target = section && m ? m.volume * m.levels[section] : 0;
  const tracks = section && lib ? lib[section] : [];
  const targetRef = useRef(0); targetRef.current = target;
  const fadeMs = m?.fadeMs ?? 2500;

  // Volume fader loop: every deck glides to its goal.
  const goals = useRef<number[]>([0, 0]);
  useEffect(() => {
    let raf = 0, prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev; prev = now;
      decks.current.forEach((a, i) => {
        if (!a) return;
        const goal = i === cur.current ? goals.current[i] * targetRef.current : 0;
        const step = dt / Math.max(200, fadeMs);
        const v = a.volume + Math.max(-step, Math.min(step, goal - a.volume));
        a.volume = Math.max(0, Math.min(1, v));
        if (i !== cur.current && a.volume === 0 && !a.paused) a.pause();
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fadeMs]);

  const pick = (s: MusicSection, list: Track[]) => {
    if (list.length === 0) return null;
    const avoid = last.current.get(s);
    const pool = list.length > 1 ? list.filter(t => t.url !== avoid) : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const playOn = (url: string, s: MusicSection, at = 0) => {
    const prevDeck = decks.current[cur.current];
    if (prevDeck && state.current.section && state.current.url) resume.current.set(state.current.section, { url: state.current.url, t: prevDeck.currentTime });
    cur.current = 1 - cur.current;
    const a = decks.current[cur.current];
    a.src = url; a.currentTime = 0; a.volume = 0;
    a.onloadedmetadata = () => { if (at > 0 && at < a.duration - 8) a.currentTime = at; };
    goals.current[cur.current] = 1;
    a.play().catch(() => {});
    last.current.set(s, url);
    state.current = { section: s, url };
    setNp(decodeURIComponent(url.split('/').pop() ?? ''));
  };

  const next = (s: MusicSection, list: Track[], fresh = false) => {
    const r = resume.current.get(s);
    if (!fresh && r && list.some(t => t.url === r.url)) { playOn(r.url, s, r.t); return; }
    const t = pick(s, list);
    if (t) playOn(t.url, s);
  };

  // Section / library / skip changes
  const skip = m?.skip ?? 0;
  const skipSeen = useRef(skip);
  useEffect(() => {
    if (!lib) return;
    if (!section || tracks.length === 0) {
      if (state.current.section && state.current.url) resume.current.set(state.current.section, { url: state.current.url, t: decks.current[cur.current]?.currentTime ?? 0 });
      goals.current = [0, 0]; state.current = { section: null, url: null }; setNp('');
      return;
    }
    const skipped = skip !== skipSeen.current; skipSeen.current = skip;
    if (skipped) { resume.current.delete(section); next(section, tracks, true); return; }
    if (state.current.section !== section) next(section, tracks);
  }, [section, lib, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Crossfade into the next track before the current one ends.
  useEffect(() => {
    const t = setInterval(() => {
      const s = state.current.section; const a = decks.current[cur.current];
      if (!s || !a || !lib || !a.duration || a.paused) return;
      if (a.duration - a.currentTime < Math.max(1.5, fadeMs / 1000)) { resume.current.delete(s); next(s, lib[s], true); }
    }, 500);
    return () => clearInterval(t);
  }, [lib, fadeMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <audio ref={el => { if (el) decks.current[0] = el; }} preload="auto" />
      <audio ref={el => { if (el) decks.current[1] = el; }} preload="auto" />
      {debug && <div style={{ position: 'fixed', left: 12, top: 12, color: '#fff', font: '14px sans-serif', background: '#000a', padding: 8 }}>♪ {section ?? 'silent'} · {np || '—'} · vol {target.toFixed(2)}</div>}
    </>
  );
}

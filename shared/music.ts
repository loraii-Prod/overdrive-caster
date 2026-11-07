import type { ScreenId } from './types';

/** Music beds: one folder of tracks per section. Gameplay stays silent. */
export const MUSIC_SECTIONS = ['starting', 'desk', 'warmup', 'brb', 'results', 'ending'] as const;
export type MusicSection = (typeof MUSIC_SECTIONS)[number];

export const MUSIC_LABELS: Record<MusicSection, string> = {
  starting: 'Starting soon', desk: 'Caster desk', warmup: 'Warm-up', brb: 'Be right back', results: 'Standings / bracket', ending: 'Thanks for watching',
};

export const MUSIC_STYLE: Record<MusicSection, string> = {
  starting: 'Build-up: melodic future bass / synthwave, 120-128 BPM, rising energy',
  desk: 'Low bed under voices: lo-fi / chillhop, no vocals, 80-95 BPM',
  warmup: 'Driving: drum & bass or electro house instrumental, 170 / 126 BPM',
  brb: 'Laid-back: chill electronic / downtempo, loopable',
  results: 'Tension: cinematic hybrid / dark synth, 100-110 BPM',
  ending: 'Feel-good outro: uplifting house / melodic bass, 124 BPM',
};

export function sectionFor(screen: ScreenId): MusicSection | null {
  switch (screen) {
    case 'starting': return 'starting';
    case 'casters': return 'desk';
    case 'warmup': return 'warmup';
    case 'brb': return 'brb';
    case 'bracket': case 'matches': return 'results';
    case 'ending': return 'ending';
    case 'gameplay': return null;
  }
}

/** Per-section level relative to the master volume (beds under talking are quieter). */
export const DEFAULT_LEVELS: Record<MusicSection, number> = { starting: 1, desk: 0.3, warmup: 0.8, brb: 0.9, results: 0.5, ending: 1 };

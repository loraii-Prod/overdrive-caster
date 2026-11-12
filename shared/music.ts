import type { ScreenId } from './types';

/** Music beds: one folder of tracks per scene (same ids as the screens). */
export const MUSIC_SECTIONS = ['starting', 'casters', 'analysis', 'interview', 'veto', 'warmup', 'gameplay', 'brb', 'bracket', 'matches', 'ending'] as const satisfies readonly ScreenId[];
export type MusicSection = (typeof MUSIC_SECTIONS)[number];

/** Folders from the old grouped layout: used for a scene until it gets tracks of its own. */
export const LEGACY_FOLDER: Partial<Record<MusicSection, string>> = {
  casters: 'desk', analysis: 'desk', interview: 'desk', veto: 'desk', bracket: 'results', matches: 'results',
};
export const MUSIC_FOLDERS: readonly string[] = [...MUSIC_SECTIONS, 'desk', 'results'];

export const MUSIC_LABELS: Record<MusicSection, string> = {
  starting: 'Starting soon', casters: 'Casters', analysis: 'Pre-show / Analyst desk', interview: 'Interview', veto: 'Map veto',
  warmup: 'Player / team card', gameplay: 'Gameplay', brb: 'Be right back', bracket: 'Bracket', matches: 'Matches', ending: 'Thanks for watching',
};

export const MUSIC_STYLE: Record<MusicSection, string> = {
  starting: 'Build-up: melodic future bass / synthwave, 120-128 BPM, rising energy',
  casters: 'Low bed under voices: lo-fi / chillhop, no vocals, 80-95 BPM',
  analysis: 'Low bed under voices: lo-fi / downtempo, no vocals',
  interview: 'Very quiet bed: ambient / soft keys, no drums',
  veto: 'Tension: dark synth / cinematic pulse, 100-110 BPM',
  warmup: 'Driving: drum & bass or electro house instrumental, 170 / 126 BPM',
  gameplay: 'Usually off (the game has its own sound). Raise the level to play a bed under it',
  brb: 'Laid-back: chill electronic / downtempo, loopable',
  bracket: 'Tension: cinematic hybrid / dark synth, 100-110 BPM',
  matches: 'Mid-energy: electro / synthwave instrumental',
  ending: 'Feel-good outro: uplifting house / melodic bass, 124 BPM',
};

/** The music of a screen: every scene has its own (a level of 0 means silent). */
export function sectionFor(screen: ScreenId): MusicSection | null {
  return (MUSIC_SECTIONS as readonly string[]).includes(screen) ? (screen as MusicSection) : null;
}

/** Per-scene level relative to the master volume (beds under talking are quieter, gameplay off). */
export const DEFAULT_LEVELS: Record<MusicSection, number> = {
  starting: 1, casters: 0.3, analysis: 0.3, interview: 0.2, veto: 0.5, warmup: 0.8, gameplay: 0, brb: 0.9, bracket: 0.5, matches: 0.5, ending: 1,
};

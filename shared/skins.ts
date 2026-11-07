import type { ScreenId } from './types';

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Video "skins": an event's own animated graphics package. Frames are full-HD
 * VP9-alpha loops with transparent camera holes; the app places cameras in
 * the holes and writes names into the bar under each one.
 */
export interface Skin {
  id: string;
  label: string;
  base: string; // asset folder
  loop: string; // general background
  screen: string; // starting / brb / ending (two dark panels)
  bar: string; // background with the bottom bar (tables, bracket, warm-up)
  panels: { title: Rect; body: Rect };
  bottomBar: Rect; // text area of the bottom bar (ticker)
  plates: Record<'starting' | 'brb' | 'ending', string>;
  frames: { booth: Record<'duo' | 'trio', string>; desk: Record<'solo' | 'duo' | 'trio', string> };
  holes: Record<'solo' | 'duo' | 'trio', Rect[]>;
  nameBar: number; // height of the name bar under each hole
  stinger: { src: string; cut: number; length: number };
  overlays: Record<'replay' | 'highlights', { loop: string; transition: string; cut: number; length: number }>;
  logo: string;
  mark: string;
  accent: string;
}

const B = '/brand/overdrive';
export const SKINS: Record<string, Skin> = {
  overdrive: {
    id: 'overdrive', label: 'Overdrive Racing League', base: B,
    loop: `${B}/loop.webm`, screen: `${B}/screen.webm`, bar: `${B}/bar.webm`,
    panels: { title: { x: 210, y: 280, w: 1500, h: 200 }, body: { x: 210, y: 500, w: 1500, h: 300 } },
    bottomBar: { x: 600, y: 964, w: 1320, h: 116 },
    plates: { starting: `${B}/plate-starting.png`, brb: `${B}/plate-brb.png`, ending: `${B}/plate-ending.png` },
    frames: { booth: { duo: `${B}/booth-duo.webm`, trio: `${B}/booth-trio.webm` }, desk: { solo: `${B}/desk-solo.webm`, duo: `${B}/desk-duo.webm`, trio: `${B}/desk-trio.webm` } },
    holes: {
      solo: [{ x: 427, y: 207, w: 1067, h: 600 }],
      duo: [{ x: 177, y: 308, w: 730, h: 408 }, { x: 1013, y: 308, w: 730, h: 408 }],
      trio: [{ x: 73, y: 309, w: 564, h: 407 }, { x: 678, y: 309, w: 564, h: 407 }, { x: 1283, y: 309, w: 564, h: 407 }],
    },
    nameBar: 58,
    stinger: { src: `${B}/stinger.webm`, cut: 1000, length: 3000 },
    overlays: {
      replay: { loop: `${B}/replay.webm`, transition: `${B}/trans-replay.webm`, cut: 750, length: 1680 },
      highlights: { loop: `${B}/highlight.webm`, transition: `${B}/trans-highlight.webm`, cut: 750, length: 1680 },
    },
    logo: `${B}/logo.png`, mark: `${B}/mark.png`, accent: '#ff3b1f',
  },
};

export const skinOf = (id: string | undefined | null): Skin | null => (id && SKINS[id]) || null;

/** Which background loop a screen uses in a skin (null = none / own frame). */
export function skinBackground(s: Skin, screen: ScreenId): string | null {
  switch (screen) {
    case 'starting': case 'brb': case 'ending': return s.screen;
    case 'gameplay': return null;
    case 'casters': return null; // the frame video carries its own background
    default: return s.bar;
  }
}

// Portrait framing + native 4K fit (no server needed): npx tsx tests/portraits.test.ts
import { DEFAULT_FRAME, PORTRAIT_BOXES, fitPortrait, gradePortrait, neededSize, portraitPlayerId, sanitizeFrame, sanitizeFrames } from '../shared/portraits';
import { defaultShowcase, sanitizeShowcase } from '../shared/wildcard';
import { _resolve, outputScale, setHiResAssets } from '../shared/assetRes';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const { hero, card, cardPhoto, compare } = PORTRAIT_BOXES;

// ---- the 4K rule: never more than 1.25 device px per source px
const hiCut = { w: 1600, h: 2000, cutout: true }, lowCut = { w: 300, h: 400, cutout: true }, hiPhoto = { w: 1500, h: 2000, cutout: false }, midPhoto = { w: 600, h: 800, cutout: false };
{
  const f = fitPortrait(hiCut, hero, DEFAULT_FRAME, 2);
  check('4K hero, 1600×2000 cut-out: drawn full size, ≤1× device upscale', !f.capped && f.upscale <= 1 && near(f.h, 950) && near(f.top, 30), JSON.stringify(f));
  check('4K hero, cut-out stands on the bottom edge, centred', near(f.top + f.h, hero.h) && near(f.left + f.w / 2, hero.w / 2));
  check('grade: native at 4K', gradePortrait(hiCut, hero, DEFAULT_FRAME, 2) === 'native');
}
{
  const f1 = fitPortrait(lowCut, card, DEFAULT_FRAME, 1), f2 = fitPortrait(lowCut, card, DEFAULT_FRAME, 2);
  check('1080p card, 300×400: fills the card (0.85×)', !f1.capped && near(f1.h, 340));
  check('4K card, 300×400: NOT stretched (capped at 1.25 device px/px, drawn smaller)', f2.capped && f2.upscale <= 1.25 + 1e-9 && near(f2.h, 250), JSON.stringify(f2));
  check('grade: small at 4K', gradePortrait(lowCut, card, DEFAULT_FRAME, 2) === 'small');
}
{
  const f = fitPortrait(hiPhoto, cardPhoto, DEFAULT_FRAME, 2);
  check('framed photo covers the card from the top', near(f.frameW, cardPhoto.w) && near(f.frameH, cardPhoto.h) && f.top === 0 && f.w >= cardPhoto.w - 0.01 && f.h >= cardPhoto.h - 0.01);
  const m = fitPortrait(midPhoto, hero, DEFAULT_FRAME, 2);
  check('framed 600×800 on the 4K hero: frame shrinks to the picture (no stretch)', m.capped && m.frameW < hero.w && near(m.upscale, 1.25), JSON.stringify(m));
}
{
  const z = fitPortrait(hiCut, hero, { zoom: 1.2, x: 10, y: 5 }, 1);
  check('zoom scales the picture', near(z.h, 950 * 1.2));
  check('x / y move it by % of the box', near(z.left, (hero.w - z.w) / 2 + 76) && near(z.top, hero.h - z.h + 49));
  const zz = fitPortrait(hiCut, hero, { zoom: 3, x: 0, y: 0 }, 2);
  check('zoom past the file’s pixels at 4K is capped (never upscaled > 1.25×)', zz.capped && zz.upscale <= 1.25 + 1e-9);
  check('aspect ratio always preserved', near(z.w / z.h, 0.8) && near(zz.w / zz.h, 0.8) && near(fitPortrait(lowCut, compare, DEFAULT_FRAME, 2).w / fitPortrait(lowCut, compare, DEFAULT_FRAME, 2).h, 0.75));
}
{
  const n = neededSize(hero, true, 0.8, 2);
  check('needed size for a native 4K hero cut-out (4:5) is 1520×1900', n.w === 1520 && n.h === 1900, JSON.stringify(n));
}

// ---- framing data
check('frame sanitised: clamped, rounded', JSON.stringify(sanitizeFrame({ zoom: 9, x: -80, y: 12.3456 })) === JSON.stringify({ zoom: 3, x: -50, y: 12.35 }));
check('default frame is not stored', sanitizeFrame({ zoom: 1, x: 0, y: 0 }) === null && sanitizeFrame('x') === null);
check('frames keyed like portraits (nickname key)', Object.keys(sanitizeFrames({ 'GranaDy!': { zoom: 1.4 } }))[0] === 'granady');
check('frames survive the showcase sanitizer', sanitizeShowcase({ ...defaultShowcase(), photos: { massa: '/uploads/a.png' }, frames: { massa: { zoom: 1.3, x: 0, y: -4 } } }).frames.massa?.zoom === 1.3);
check('older saved showcase (no frames) still loads', JSON.stringify(sanitizeShowcase({ photos: {}, team: '', seconds: 12, pin: null }).frames) === '{}');
check('portrait → stable player id', portraitPlayerId('Massa') === 'P_massa' && portraitPlayerId('Nobody') === null);

// ---- output scale (set by the broadcast canvas)
setHiResAssets(true, 2); check('4K output reports device scale 2', outputScale() === 2);
setHiResAssets(false, 1); check('1080p output reports 1', outputScale() === 1);
check('4K asset swap still works', _resolve('/brand/overdrive/loop.webm', { loop: '/brand/overdrive/4k/loop.webm' }, true) === '/brand/overdrive/4k/loop.webm');

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

// 4K asset handling: image size parsing, per-role advice, 4K replacement resolver.   npx tsx tests/assets4k.test.ts
import fs from 'node:fs';
import { advice4k, imageInfo } from '../shared/assetAdvice';
import { _resolve, hiRes } from '../shared/assetRes';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra ? `  [${extra}]` : ''}`); };
const f = (p: string) => new Uint8Array(fs.readFileSync(p));
const png = imageInfo(f('public/brand/overdrive/teams/abyssal.png')), jpg = imageInfo(f('public/brand/overdrive/maps/india.jpg')), logo = imageInfo(f('public/brand/overdrive/logo.png'));
check('PNG size read from the file (team logo 64×64, logo 756×183)', png?.w === 64 && png?.h === 64 && logo?.w === 756 && logo?.h === 183, JSON.stringify([png, logo]));
check('JPEG size read from the file (map 1024×1024)', jpg?.w === 1024 && jpg?.h === 1024, JSON.stringify(jpg));
check('SVG = vector', imageInfo(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>'))?.vector === true);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00, 0, 0]);
check('GIF size', imageInfo(gif)?.w === 320 && imageInfo(gif)?.h === 240);
check('advice: a 64×64 team logo is flagged for 4K (fine at 1080p), an SVG never', /64×64/.test(advice4k('team-logo', png) ?? '') && /fine at 1080p/.test(advice4k('team-logo', png) ?? '') && advice4k('team-logo', { w: 0, h: 0, vector: true }) === null);
check('advice: a 4K background passes, a 1080p one is flagged', advice4k('background', { w: 3840, h: 2160, vector: false }) === null && !!advice4k('background', { w: 1920, h: 1080, vector: false }));
check('advice: unknown role or size never blocks or nags', advice4k('image', png) === null && advice4k('map', null) === null);
const T = { 'teams/abyssal': '/brand/overdrive/4k/teams/abyssal.svg', 'bar': '/brand/overdrive/4k/bar.webm' };
check('resolver at 4K: bundled file with a replacement → the replacement (extension may differ)', _resolve('/brand/overdrive/teams/abyssal.png', T, true) === '/brand/overdrive/4k/teams/abyssal.svg' && _resolve('/brand/overdrive/bar.webm', T, true) === '/brand/overdrive/4k/bar.webm');
check('resolver at 1080p: always the original', _resolve('/brand/overdrive/teams/abyssal.png', T, false) === '/brand/overdrive/teams/abyssal.png');
check('resolver: no replacement / uploads / other URLs untouched', _resolve('/brand/overdrive/mark.png', T, true) === '/brand/overdrive/mark.png' && _resolve('/uploads/abc.png', T, true) === '/uploads/abc.png' && _resolve('https://x.y/a.png', T, true) === 'https://x.y/a.png');
check('resolver default (server, no canvas): original', hiRes('/brand/overdrive/teams/abyssal.png') === '/brand/overdrive/teams/abyssal.png');
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

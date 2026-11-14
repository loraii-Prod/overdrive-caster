// Per-caster camera quality: defaults, sanitising, VDO.Ninja links.   npx tsx tests/camQuality.test.ts
import { sanitizeTalent, CAM_QUALITIES, camQualityOf } from '../shared/talent';
import { vdoCasterPushUrl } from '../shared/players';
import { sanitizeScene } from '../shared/defaults';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra ? `  [${extra}]` : ''}`); };
let k = 0; const key = () => `key-${'x'.repeat(16)}-${k++}`, vdo = () => `vdo_${k++}_abcdef`;

const fresh = sanitizeTalent([], key, vdo);
check('new shows: all 10 profiles default to 720p', fresh.length === 10 && fresh.every(t => t.camQuality === '720p'));
const old = sanitizeTalent([{ id: 't1', name: 'A', role: 'caster', mode: 'webrtc', key: 'k'.repeat(20), vdoId: 'abc_123456' }], key, vdo);
check('existing (pre-4K) profiles load as 720p, keeping everything else', old[0].camQuality === '720p' && old[0].name === 'A' && old[0].vdoId === 'abc_123456');
check('1080p is kept; anything else becomes 720p', sanitizeTalent([{ id: 't2', camQuality: '1080p' }], key, vdo)[1].camQuality === '1080p' && camQualityOf('4k') === '720p' && camQualityOf(undefined) === '720p');
const u720 = vdoCasterPushUrl('bnlcast1_x', 'Lexi', 'pw', ''), u1080 = vdoCasterPushUrl('bnlcast1_x', 'Lexi', 'pw', '', '1080p');
check('VDO.Ninja push link unchanged at 720p (&quality=1, as before)', u720 === 'https://vdo.ninja/?push=bnlcast1_x&webcam&label=Lexi&quality=1&autostart&password=pw', u720);
check('VDO.Ninja push link at 1080p asks for 1080p30', u1080 === 'https://vdo.ninja/?push=bnlcast1_x&webcam&label=Lexi&quality=0&maxframerate=30&autostart&password=pw', u1080);
check('WebRTC targets: 1280×720 @ 3 Mbps, 1920×1080 @ 6 Mbps, both 30 fps', CAM_QUALITIES['720p'].width === 1280 && CAM_QUALITIES['720p'].bitrate === 3e6 && CAM_QUALITIES['1080p'].height === 1080 && CAM_QUALITIES['1080p'].bitrate === 6e6 && CAM_QUALITIES['1080p'].fps === 30);
const sc = sanitizeScene({ casters: [{ id: 1, source: { type: 'vdo', vdo: 'abc_123456', quality: '1080p' } }, { id: 2, source: { type: 'vdo', vdo: 'abc_123456', quality: 'ultra' } }] } as any);
check('scene sanitizer keeps a 1080p source flag and drops invalid ones', sc.casters[0].source.quality === '1080p' && !('quality' in sc.casters[1].source), JSON.stringify(sc.casters.slice(0, 2).map(c => c.source)));
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

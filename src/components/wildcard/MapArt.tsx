/**
 * Original illustrations for the five Major maps (drawn here in SVG, no photos or third-party art):
 * a country scene + a race track sweeping through the foreground. 1160 × 1080, cropped to fit.
 */
import type { ReactNode } from 'react';

const W = 1160, H = 1080;

function Frame({ id, sky, children }: { id: string; sky: [string, string, string]; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} /><stop offset=".62" stopColor={sky[1]} /><stop offset="1" stopColor={sky[2]} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}-sky)`} />
      {children}
    </svg>
  );
}

/** The race track through the foreground (the map is a Trackmania track after all). */
function Track({ accent, y = 930 }: { accent: string; y?: number }) {
  const d = `M-60 ${y + 120} C 260 ${y - 40}, 640 ${y + 110}, ${W + 60} ${y - 70}`;
  return (
    <g>
      <path d={d} fill="none" stroke="#120d0c" strokeWidth="150" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#2a2220" strokeWidth="128" strokeLinecap="round" />
      <path d={d} fill="none" stroke={accent} strokeWidth="6" strokeDasharray="46 30" opacity=".95" />
      <path d={d} fill="none" stroke="#fff" strokeWidth="3" opacity=".25" transform="translate(0 -56)" />
      <path d={d} fill="none" stroke="#fff" strokeWidth="3" opacity=".25" transform="translate(0 56)" />
    </g>
  );
}

const Stars = ({ n = 40, seed = 3 }: { n?: number; seed?: number }) => (
  <g fill="#fff">{Array.from({ length: n }, (_, i) => {
    const x = (i * 157 * seed) % W, y = (i * 89 * seed) % 420;
    return <circle key={i} cx={x} cy={y} r={(i % 3) * 0.6 + 0.8} opacity={0.25 + (i % 4) * 0.15} />;
  })}</g>
);

function India() {
  const ink = '#2d1029';
  const taj = (
    <g fill={ink}>
      <rect x="250" y="700" width="660" height="40" />
      <rect x="380" y="520" width="400" height="180" />
      <path d="M470 522 C 430 440, 520 392, 560 350 Q 580 326 580 286 Q 580 326 600 350 C 640 392, 730 440, 690 522 Z" />
      <rect x="576" y="250" width="8" height="44" />
      <path d="M400 522 c -8 -40 30 -52 30 -76 c 0 24 38 36 30 76 Z" />
      <path d="M700 522 c -8 -40 30 -52 30 -76 c 0 24 38 36 30 76 Z" />
      {[290, 856].map(x => <g key={x}><rect x={x} y="400" width="24" height="300" /><path d={`M${x - 6} 404 h36 l-18 -34 Z`} /><rect x={x - 4} y="470" width="32" height="6" /><rect x={x - 4} y="560" width="32" height="6" /></g>)}
    </g>
  );
  return (
    <Frame id="in" sky={['#1d0b2e', '#e2622b', '#ffc56a']}>
      <circle cx="580" cy="560" r="300" fill="url(#in-glow)" />
      <circle cx="580" cy="560" r="160" fill="#ffd98a" opacity=".9" />
      {taj}
      <rect x="0" y="740" width={W} height="340" fill="#3a1630" />
      <g opacity=".22" transform="translate(0 1480) scale(1 -1)">{taj}</g>
      {[60, 150, 1010, 1090].map((x, i) => <path key={x} d={`M${x} 760 q ${i % 2 ? 30 : -30} -150 ${i % 2 ? -10 : 10} -260 q 60 30 90 10 q -60 -10 -80 -20 q 50 -40 100 -20 q -60 -30 -110 0`} fill="none" stroke={ink} strokeWidth="14" strokeLinecap="round" />)}
      <Track accent="#FF9933" />
    </Frame>
  );
}

function Czech() {
  const ink = '#0b1430';
  return (
    <Frame id="cz" sky={['#0a1430', '#2c4e8c', '#eaa27e']}>
      <Stars n={50} seed={5} />
      <circle cx="900" cy="170" r="54" fill="#f6e7c6" opacity=".95" />
      {/* castle on the hill */}
      <path d="M560 640 Q 820 520 1160 560 L1160 760 L560 760 Z" fill="#14204a" />
      <g fill={ink}>
        <rect x="760" y="470" width="300" height="110" />
        {[790, 840, 890, 940, 990].map(x => <rect key={x} x={x} y="500" width="16" height="26" fill="#ffd27a" opacity=".8" />)}
        <path d="M880 470 l18 -170 l18 170 Z" /><rect x="868" y="400" width="60" height="72" />
        <path d="M980 470 l12 -110 l12 110 Z" /><path d="M800 470 l10 -80 l10 80 Z" />
      </g>
      {/* old town: twin gothic spires + gabled houses */}
      <g fill={ink}>
        <rect x="180" y="470" width="60" height="230" /><rect x="270" y="470" width="60" height="230" />
        <path d="M172 474 l38 -170 l38 170 Z" /><path d="M262 474 l38 -170 l38 170 Z" />
        {[165, 225, 255, 315].map(x => <path key={x} d={`M${x} 480 l8 -50 l8 50 Z`} />)}
        <rect x="236" y="560" width="38" height="140" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const x = 20 + i * 70 + (i > 1 ? 180 : 0); const h = 120 + (i * 37) % 70; return <path key={i} d={`M${x} 760 V${760 - h} l32 -46 l32 46 V760 Z`} />; })}
      </g>
      {/* river + bridge arches */}
      <rect x="0" y="760" width={W} height="320" fill="#13224d" />
      <g fill="#0a1430"><rect x="0" y="770" width={W} height="34" />
        {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${i * 140 - 10} 804 h140 v80 a60 60 0 0 0 -120 0 Z`} />)}</g>
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={20 + i * 98} y="760" width="4" height="14" fill="#ffd27a" />)}
      <Track accent="#3D7DD8" y={960} />
    </Frame>
  );
}

function Egypt() {
  return (
    <Frame id="eg" sky={['#231034', '#c4532c', '#f6c06a']}>
      <circle cx="760" cy="560" r="320" fill="url(#eg-glow)" />
      <circle cx="760" cy="560" r="130" fill="#ffdf96" />
      {[[330, 760, 300], [690, 770, 230], [930, 780, 150]].map(([x, b, h]) => (
        <g key={x}><path d={`M${x - h} ${b} L${x} ${b - h * 1.25} L${x + h} ${b} Z`} fill="#7a3a22" /><path d={`M${x} ${b - h * 1.25} L${x + h} ${b} L${x + h * 0.25} ${b} Z`} fill="#4c2016" /></g>
      ))}
      <path d={`M0 770 Q 300 720 600 770 T ${W} 760 V${H} H0 Z`} fill="#c9853f" />
      <path d={`M0 840 Q 400 790 800 850 T ${W} 830 V${H} H0 Z`} fill="#a9652e" />
      {[90, 170].map((x, i) => (
        <g key={x} stroke="#2b1410" strokeWidth="12" strokeLinecap="round" fill="none">
          <path d={`M${x} 860 q ${i ? 20 : -10} -150 ${i ? 0 : 20} -300`} />
          {[-1, 1].map(s => <g key={s}><path d={`M${x + (i ? 0 : 20)} 562 q ${s * 70} -40 ${s * 130} 10`} /><path d={`M${x + (i ? 0 : 20)} 562 q ${s * 50} -70 ${s * 110} -60`} /></g>)}
        </g>
      ))}
      <Track accent="#E8B04B" />
    </Frame>
  );
}

function UK() {
  const ink = '#0d1428';
  return (
    <Frame id="uk" sky={['#0e1830', '#3d5482', '#d98f6c']}>
      <g fill="#ffffff" opacity=".1">{[[200, 160, 200], [620, 120, 260], [980, 220, 180]].map(([x, y, w]) => <ellipse key={x} cx={x} cy={y} rx={w} ry={w / 4} />)}</g>
      {/* clock tower */}
      <g fill={ink}>
        <rect x="180" y="300" width="110" height="480" />
        <rect x="168" y="290" width="134" height="140" />
        <path d="M168 292 L235 150 L302 292 Z" /><rect x="231" y="96" width="8" height="60" />
      </g>
      <circle cx="235" cy="360" r="44" fill="#f4e2b0" /><circle cx="235" cy="360" r="44" fill="none" stroke={ink} strokeWidth="6" />
      <path d="M235 360 V330 M235 360 L256 372" stroke={ink} strokeWidth="5" strokeLinecap="round" />
      {/* bascule bridge with two towers */}
      <g fill={ink}>
        {[560, 860].map(x => <g key={x}><rect x={x} y="440" width="90" height="340" /><path d={`M${x - 6} 444 L${x + 45} 360 L${x + 96} 444 Z`} />{[x + 4, x + 70].map(t => <path key={t} d={`M${t} 444 l8 -40 l8 40 Z`} />)}</g>)}
        <rect x="650" y="470" width="210" height="20" /><rect x="650" y="500" width="210" height="10" />
        <path d="M650 640 L755 640 L755 660 L650 660 Z" /><path d="M755 640 L860 640 L860 660 L755 660 Z" />
        <path d="M380 640 Q 470 520 560 470 V490 Q 480 540 400 660 Z" /><path d="M1060 640 Q 990 520 950 470 V490 Q 980 540 1040 660 Z" />
        <rect x="300" y="640" width="860" height="22" />
      </g>
      {[586, 886].map(x => <rect key={x} x={x + 30} y="520" width="30" height="50" rx="15" fill="#ffd27a" opacity=".7" />)}
      <rect x="0" y="780" width={W} height="300" fill="#1a2747" />
      <g stroke="#ffd27a" strokeWidth="3" opacity=".35">{Array.from({ length: 14 }, (_, i) => <path key={i} d={`M${40 + i * 80} ${800 + (i % 3) * 16} h40`} />)}</g>
      <Track accent="#C8102E" y={960} />
    </Frame>
  );
}

function NZ() {
  return (
    <Frame id="nz" sky={['#0b2a4a', '#5ba8c9', '#f3d9a6']}>
      <path d="M-40 760 L220 420 L330 540 L520 300 L700 560 L820 440 L1200 760 Z" fill="#3b5d7a" />
      <path d="M220 420 L262 476 L240 470 L212 500 L190 460 Z M520 300 L585 396 L556 384 L520 420 L486 380 L470 372 Z M820 440 L870 500 L846 494 L820 520 L800 494 Z" fill="#f2f6fa" />
      <path d="M-40 780 L120 600 L300 700 L460 620 L640 720 L860 610 L1200 780 Z" fill="#2c4a3a" />
      <rect x="0" y="780" width={W} height="300" fill="#2f7c8c" />
      <g opacity=".25" transform="translate(0 1560) scale(1 -1)"><path d="M-40 780 L120 600 L300 700 L460 620 L640 720 L860 610 L1200 780 Z" fill="#1d3a2e" /></g>
      {/* unfurling fern (koru) */}
      <g fill="none" stroke="#123222" strokeLinecap="round">
        <path d="M1080 1080 C 1060 900, 1000 760, 900 700 C 840 664, 780 690, 790 740 C 800 790, 860 780, 856 744 C 852 716, 820 716, 818 736" strokeWidth="16" />
        {Array.from({ length: 9 }, (_, i) => { const t = i / 9; const x = 1080 - t * 170, y = 1040 - t * 300; return <path key={i} d={`M${x} ${y} q -60 -10 -110 ${-40 + i * 4} M${x} ${y} q 40 -40 90 -70`} strokeWidth="9" />; })}
      </g>
      <Track accent="#3FB6A8" y={950} />
    </Frame>
  );
}

const ART: Record<string, () => ReactNode> = { india: India, czech: Czech, egypt: Egypt, uk: UK, nz: NZ };

export function MapArt({ id }: { id: string }) {
  const A = ART[id];
  return A ? <A /> : null;
}

/**
 * The country flag of a Major map, drawn the same way everywhere a map appears (map card, track
 * progression, veto, producer buttons). Real flag designs, not colour bars: the same height on every
 * surface, each at its own official proportions (India / Czechia / Egypt 3:2, UK / New Zealand 2:1).
 */
import { useId, type CSSProperties, type ReactElement } from 'react';

const STAR = (cx: number, cy: number, r: number) => {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.382 : r;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return p.join(' ');
};

/** Union Jack in a 60×30 box (used whole for the UK, in the canton for New Zealand). */
function Union({ id }: { id: string }) {
  return (
    <>
      <clipPath id={`${id}s`}><path d="M0,0v30h60V0z" /></clipPath>
      <clipPath id={`${id}t`}><path d="M30,15h30v15zv15H0zH0V0zV0h30z" /></clipPath>
      <g clipPath={`url(#${id}s)`}>
        <path d="M0,0v30h60V0z" fill="#012169" />
        <path d="M0,0L60,30M60,0L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0L60,30M60,0L0,30" clipPath={`url(#${id}t)`} stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0v30M0,15h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0v30M0,15h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </>
  );
}

const FLAGS: Record<string, { w: number; h: number; draw: (id: string) => ReactElement }> = {
  india: { w: 900, h: 600, draw: () => (
    <>
      <rect width="900" height="200" fill="#FF9933" /><rect y="200" width="900" height="200" fill="#FFFFFF" /><rect y="400" width="900" height="200" fill="#138808" />
      <g transform="translate(450 300)" fill="none" stroke="#000080">
        <circle r="88" strokeWidth="12" />
        {Array.from({ length: 24 }, (_, i) => <line key={i} x1="0" y1="0" x2="0" y2="-84" strokeWidth="5" transform={`rotate(${i * 15})`} />)}
        <circle r="16" fill="#000080" stroke="none" />
      </g>
    </>
  ) },
  czech: { w: 900, h: 600, draw: () => (
    <><rect width="900" height="300" fill="#FFFFFF" /><rect y="300" width="900" height="300" fill="#D7141A" /><path d="M0,0L450,300L0,600z" fill="#11457E" /></>
  ) },
  egypt: { w: 900, h: 600, draw: () => (
    <>
      <rect width="900" height="200" fill="#CE1126" /><rect y="200" width="900" height="200" fill="#FFFFFF" /><rect y="400" width="900" height="200" fill="#000000" />
      {/* Eagle of Saladin, simplified to stay crisp at small sizes */}
      <g fill="#C09300" transform="translate(450 300)">
        <path d="M0,-78c-14,0-24,10-24,24c0,8 3,14 8,18l-46,-10c-10,30-6,60 10,82l26,-12l-4,40h60l-4,-40l26,12c16,-22 20,-52 10,-82l-46,10c5,-4 8,-10 8,-18c0,-14-10,-24-24,-24z" />
        <path d="M-30,72h60l10,14h-80z" />
      </g>
    </>
  ) },
  uk: { w: 60, h: 30, draw: id => <Union id={id} /> },
  nz: { w: 1200, h: 600, draw: id => (
    <>
      <rect width="1200" height="600" fill="#00247D" />
      <svg width="600" height="300" viewBox="0 0 60 30"><Union id={id} /></svg>
      {([[900, 132, 40], [790, 272, 38], [1000, 238, 34], [900, 480, 46]] as const).map(([x, y, r], i) => (
        <g key={i}><polygon points={STAR(x, y, r + 9)} fill="#FFFFFF" /><polygon points={STAR(x, y, r)} fill="#CC142B" /></g>
      ))}
    </>
  ) },
};

export const mapFlagRatio = (id: string) => { const f = FLAGS[id]; return f ? f.w / f.h : 1.5; };

/** A map's flag at `h` px high (width follows the flag's own proportions). Nothing for an unknown map. */
export function MapFlag({ id, h, className, style }: { id: string | null | undefined; h: number; className?: string; style?: CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const f = id ? FLAGS[id] : undefined;
  if (!f) return null;
  return (
    <svg className={['map-flag', className].filter(Boolean).join(' ')} data-map-flag={id} width={Math.round((h * f.w) / f.h)} height={h} viewBox={`0 0 ${f.w} ${f.h}`}
      preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${id} flag`} style={{ display: 'inline-block', flex: 'none', verticalAlign: 'middle', boxShadow: '0 0 0 1px rgba(255,255,255,.18)', ...style }}>
      {f.draw(`mf${uid}`)}
    </svg>
  );
}

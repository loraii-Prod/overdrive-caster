import { useEffect, useRef, type CSSProperties } from 'react';
import { useTheme } from '../lib/theme';
import { skinOf } from '../../shared/skins';

/**
 * Base app identity, used only as a last-resort fallback for an event with no
 * brand kit of its own set yet (a freshly created blank event). Overdrive
 * itself always carries its own logo/mark/skin, so this path never fires for
 * it. Only height is ever set, so original proportions are always preserved.
 */
export const BRAND = {
  logo: '/brand/overdrive/logo.png',
  mark: '/brand/overdrive/mark.png',
  pattern: '',
};

export function Logo({ height, style, className }: { height: number; style?: CSSProperties; className?: string }) {
  const { brand } = useTheme();
  if (brand?.logo) return <img src={brand.logo} alt="" draggable={false} className={className} style={{ height, width: 'auto', display: 'block', ...style }} />;
  if (brand?.name || brand?.mark) {
    const words = (brand.name || '').toUpperCase().split(/\s+/).filter(Boolean);
    const l1 = words.length > 1 ? words[0] : words.join(' '), l2 = words.length > 1 ? words.slice(1).join(' ') : '';
    return (
      <div className={`flex items-center ${className ?? ''}`} style={{ height, gap: height * 0.22, ...style }}>
        <img src={brand.mark || BRAND.mark} alt="" draggable={false} style={{ height: height * 0.92, width: 'auto' }} />
        {words.length > 0 && <div className="font-display leading-[0.86] text-white" style={{ fontSize: height * (l2 ? 0.4 : 0.55), letterSpacing: '0.04em' }}>{l1}{l2 && <><br />{l2}</>}</div>}
      </div>
    );
  }
  return <img src={BRAND.logo} alt="Overdrive" draggable={false} className={className} style={{ height, width: 'auto', display: 'block', ...style }} />;
}

export function Mark({ height, style, className }: { height: number; style?: CSSProperties; className?: string }) {
  const { brand } = useTheme();
  return <img src={brand?.mark || brand?.logo || BRAND.mark} alt="" draggable={false} className={className} style={{ height, width: 'auto', display: 'block', ...style }} />;
}

/** Repeating background pattern, shown only when an event has no skin/background of its own. */
export function Pattern({ opacity = 1, drift = false, size = 560, className = '' }: { opacity?: number; drift?: boolean; size?: number; className?: string }) {
  const { brand } = useTheme();
  if (brand?.skin || brand?.bg) return null;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${drift ? 'od-drift' : ''} ${className}`}
      style={{ backgroundImage: `url(${BRAND.pattern})`, backgroundSize: `${size}px auto`, backgroundRepeat: 'repeat', opacity }}
    />
  );
}

/** The looping broadcast background: an event's video skin first, then its own
 * uploaded background, then nothing (plain pattern fallback from Pattern() above). */
export function BgVideo({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { brand } = useTheme();
  const skin = skinOf(brand?.skin);
  const src = skin ? skin.loop : brand?.bg && brand.bgKind === 'video' ? brand.bg : '';
  useEffect(() => { ref.current?.play().catch(() => {}); }, [src]);
  if (brand?.bg && brand.bgKind === 'image') {
    return <div className={`absolute inset-0 overflow-hidden bg-[#070707] ${className}`}><img src={brand.bg} alt="" className="absolute inset-0 h-full w-full object-cover" /></div>;
  }
  if (!src) return null;
  return (
    <div className={`absolute inset-0 overflow-hidden bg-[#070707] ${className}`}>
      <video ref={ref} key={src} src={src} muted loop playsInline autoPlay preload="auto" className="absolute inset-0 h-full w-full object-cover" />
    </div>
  );
}

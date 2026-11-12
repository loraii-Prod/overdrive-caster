import { motion } from 'motion/react';
import { Mark } from './Brand';
import { EASE } from '../lib/motion';
import { useTheme } from '../lib/theme';

const SIZES = {
  lg: { inset: 32, pad: '18px 30px 18px 22px', mark: 34, name: 38, role: 14, gap: 20 },
  md: { inset: 22, pad: '14px 24px 14px 18px', mark: 28, name: 30, role: 12, gap: 16 },
  sm: { inset: 16, pad: '11px 18px 11px 14px', mark: 22, name: 23, role: 10.5, gap: 12 },
};

/** Lower-third: mark │ NAME / ROLE on a dark translucent panel. */
export function Nameplate({ name, role, size }: { name: string; role: string; size: 'lg' | 'md' | 'sm' }) {
  const { theme } = useTheme();
  const s = SIZES[size];
  if (theme === 'bnl') {
    const h = size === 'sm' ? 40 : size === 'md' ? 54 : 64;
    return (
      <motion.div className="absolute inset-x-0 bottom-0 flex items-stretch bg-[#050505]" style={{ height: h }}
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.3, ease: EASE }}>
        <div className="grid flex-none place-items-center bg-[#151515]" style={{ width: h }}><Mark height={h * 0.8} /></div>
        <div className="flex min-w-0 items-center px-3">
          <span className="truncate font-display uppercase leading-none text-white" style={{ fontSize: h * 0.62, paddingTop: 3 }}>{name}</span>
          {role && size !== 'sm' && <span className="ml-3 bg-[#E8E8E8] px-2 py-1 font-display text-[#111]" style={{ fontSize: h * 0.36 }}>{role}</span>}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      className="absolute flex items-center overflow-hidden rounded-[4px]"
      style={{
        left: s.inset, bottom: s.inset, padding: s.pad, gap: s.gap, maxWidth: `calc(100% - ${s.inset * 2}px)`,
        background: 'rgba(14,14,14,0.86)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)',
      }}
      initial={{ opacity: 0, x: -18, clipPath: 'inset(0 100% 0 0)' }}
      animate={{ opacity: 1, x: 0, clipPath: 'inset(0 0% 0 0)' }}
      exit={{ opacity: 0, x: -10, clipPath: 'inset(0 100% 0 0)', transition: { duration: 0.22, ease: EASE } }}
      transition={{ duration: 0.34, ease: EASE }}
    >
      <div className="absolute left-0 top-0 h-full bg-white" style={{ width: 3 }} />
      <Mark height={s.mark} style={{ flex: 'none' }} />
      <div className="self-stretch bg-white/20" style={{ width: 1 }} />
      <div className="min-w-0">
        <div className="truncate font-display font-semibold uppercase leading-none text-white" style={{ fontSize: s.name, letterSpacing: '0.03em' }}>
          {name || '—'}
        </div>
        {role && (
          <div className="mt-[0.5em] truncate font-sans font-semibold uppercase leading-none text-[#b4b4b4]" style={{ fontSize: s.role, letterSpacing: '0.24em' }}>
            {role}
          </div>
        )}
      </div>
    </motion.div>
  );
}

import { AnimatePresence, motion } from 'motion/react';
import type { Caster } from '../../shared/types';
import { Mark, Pattern } from './Brand';
import { EASE } from '../lib/motion';
import { useTheme } from '../lib/theme';

/**
 * Branded name card used for audio-only casters, cameras that are off, and as
 * the always-present base layer under every video feed (so a failed feed
 * shows the card, never a black box). Sizes follow the tile via container units.
 */
export function IdentityCard({ caster, showName, audio }: { caster: Caster; size: 'lg' | 'md' | 'sm'; showName: boolean; audio?: boolean }) {
  const { theme } = useTheme();
  if (theme === 'bnl') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[#0b0b0b]" style={{ containerType: 'size' }}>
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 45%, #1a1a1a 0%, #0b0b0b 70%)' }} />
        <div className="absolute inset-x-0 top-[38%] h-px bg-[#d33]/40" /><div className="absolute inset-x-0 top-[62%] h-px bg-[#2b6cff]/30" />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Mark height={0} style={{ height: '34cqh', opacity: 0.9 }} />
          {showName && <div className="mt-[5cqh] font-display uppercase leading-none text-white" style={{ fontSize: 'min(12cqh, 9cqw)' }}>{caster.name}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#161616]" style={{ containerType: 'size' }}>
      <Pattern opacity={0.5} size={420} drift={audio} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(22,22,22,0.55) 0%, rgba(22,22,22,0.92) 70%)' }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ padding: '0 8cqw' }}>
        <Mark height={0} style={{ height: '22cqh', marginBottom: '6cqh', opacity: 0.95 }} />
        <AnimatePresence initial={false}>
          {showName && (
            <motion.div key="txt" className="w-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.3, ease: EASE }}>
              <div className="truncate font-display font-semibold uppercase leading-none text-white" style={{ fontSize: 'min(11cqh, 8cqw)', letterSpacing: '0.03em' }}>
                {caster.name || '—'}
              </div>
              {caster.role && (
                <div className="mx-auto mt-[4cqh] flex items-center justify-center gap-[2cqw]">
                  <span className="bg-white/25" style={{ height: 1, width: '6cqw' }} />
                  <span className="font-sans font-semibold uppercase leading-none text-[#b4b4b4]" style={{ fontSize: 'min(4.2cqh, 3cqw)', letterSpacing: '0.26em' }}>
                    {caster.role}
                  </span>
                  <span className="bg-white/25" style={{ height: 1, width: '6cqw' }} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

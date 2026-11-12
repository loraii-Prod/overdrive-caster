import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Animates an on-screen extra in and out when it's switched on / off. The wrapper covers the whole
 * 1920 × 1080 frame (absolute, inset 0, click-through), so absolutely positioned children keep their
 * coordinates while the whole group slides and fades.
 */
export function Reveal({ show, children, from = 'up', delay = 0, id = 'r' }: { show: boolean; children: ReactNode; from?: 'up' | 'down' | 'left' | 'right' | 'fade'; delay?: number; id?: string }) {
  const d = 28;
  const off = from === 'up' ? { y: d } : from === 'down' ? { y: -d } : from === 'left' ? { x: -d * 2 } : from === 'right' ? { x: d * 2 } : {};
  return (
    <AnimatePresence>
      {show && (
        <motion.div key={id} className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0, ...off }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0, ...off, transition: { duration: 0.3, ease: EASE } }}
          transition={{ duration: 0.45, ease: EASE, delay }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

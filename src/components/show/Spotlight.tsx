import { AnimatePresence, motion } from 'motion/react';
import type { SpotlightState } from '../../../shared/types';
import { EASE } from '../../lib/motion';
import { useTheme } from '../../lib/theme';
import { Mark } from '../Brand';

/**
 * Player spotlight / story card, lower-left. Styled after the BNL caster
 * frames: black panel, trophy box, light-grey tag for the label.
 */
export function SpotlightCard({ spot, now, bottom = 40, left = 40 }: { spot: SpotlightState | null; now: number; bottom?: number; left?: number }) {
  const visible = spot && (spot.until == null || spot.until > now);
  const { theme } = useTheme();
  const glacial = theme !== 'bnl';
  return (
    <AnimatePresence>
      {visible && spot && (
        <motion.div key={spot.at} className="absolute" style={{ left, bottom, width: 820 }}
          initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30, transition: { duration: 0.25, ease: EASE } }} transition={{ duration: 0.4, ease: EASE }}>
          <div className={`inline-flex h-[42px] items-center px-4 font-display uppercase leading-none ${glacial ? 'bg-white text-[#111] font-bold' : 'bg-[#E8E8E8] text-[#111]'}`}
            style={{ fontSize: glacial ? 15 : 27, letterSpacing: glacial ? '0.24em' : '0.06em', paddingTop: glacial ? 0 : 3 }}>
            {spot.kind === 'player' ? 'Player spotlight' : spot.data.label || 'Did you know'}
          </div>
          <div className="flex bg-[#050505]/95" style={{ boxShadow: '0 14px 40px rgba(0,0,0,0.45)' }}>
            <div className="grid w-[96px] flex-none place-items-center bg-[#151515]">
              {spot.data.photo ? <img src={spot.data.photo} alt="" className="h-full w-full object-cover" /> : <Mark height={64} />}
            </div>
            <div className="min-w-0 flex-1 px-6 py-4">
              {spot.kind === 'player' ? <PlayerBody d={spot.data} glacial={glacial} /> : <StoryBody d={spot.data} glacial={glacial} />}
            </div>
          </div>
          {spot.until != null && (
            <motion.div className="h-[3px] origin-left bg-white/70" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }}
              transition={{ duration: Math.max(0, (spot.until - spot.at) / 1000), ease: 'linear' }} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlayerBody({ d, glacial }: { d: Record<string, string>; glacial: boolean }) {
  const stats = [
    ['Input', d.input], ['Style', d.style], ['Age', d.age], ['Favourite player', d.favPlayer],
  ].filter(([, v]) => v);
  return (
    <>
      <div className={`truncate font-display uppercase leading-none text-white ${glacial ? 'font-bold' : ''}`} style={{ fontSize: glacial ? 46 : 64 }}>{d.name}</div>
      {stats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
          {stats.map(([k, v]) => (
            <div key={k} className="min-w-0 max-w-[300px]">
              <div className="font-sans font-bold uppercase text-white/45" style={{ fontSize: 13, letterSpacing: '0.2em' }}>{k}</div>
              <div className="truncate font-sans font-semibold text-white" style={{ fontSize: glacial ? 20 : 24 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {d.funFact && (
        <div className="mt-3 border-l-2 border-white/30 pl-3 font-sans font-medium leading-snug text-white/90" style={{ fontSize: glacial ? 19 : 23 }}>
          “{d.funFact}”
        </div>
      )}
      {d.rival && (
        <div className="mt-2.5 font-sans text-white/70" style={{ fontSize: glacial ? 16 : 20 }}>
          <span className="mr-2 font-bold uppercase text-white/45" style={{ fontSize: 13, letterSpacing: '0.2em' }}>Biggest rival</span>{d.rival}
        </div>
      )}
    </>
  );
}

function StoryBody({ d, glacial }: { d: Record<string, string>; glacial: boolean }) {
  return (
    <>
      <div className={`truncate font-display uppercase leading-none text-white ${glacial ? 'font-bold' : ''}`} style={{ fontSize: glacial ? 40 : 56 }}>{d.title}</div>
      <div className="mt-3 font-sans font-medium leading-snug text-white/90" style={{ fontSize: glacial ? 21 : 26 }}>{d.text}</div>
    </>
  );
}

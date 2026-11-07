import { AnimatePresence, motion } from 'motion/react';
import type { Show, Team } from '../../../shared/types';
import { EASE } from '../../lib/motion';
import { Score, TeamLogo } from './parts';

/** Series pips: one per win needed (BO3 → 2). */
function Pips({ team, bestOf, right }: { team: Team; bestOf: number; right?: boolean }) {
  const need = Math.ceil(bestOf / 2);
  if (bestOf < 2) return null;
  return (
    <div className={`flex gap-1.5 ${right ? 'flex-row-reverse' : ''}`}>
      {Array.from({ length: need }, (_, i) => (
        <span key={i} className={`h-[5px] w-5 rounded-full transition-colors duration-300 ${i < team.score ? 'bg-white' : 'bg-white/15'}`} />
      ))}
    </div>
  );
}

/** In-game scoreboard (transparent overlay, top centre). */
export function Scoreboard({ show }: { show: Show }) {
  const side = (team: Team, right: boolean) => (
    <div className={`flex items-center gap-4 ${right ? 'flex-row-reverse' : ''}`} style={{ padding: right ? '0 18px 0 0' : '0 0 0 18px' }}>
      <TeamLogo team={team} size={44} />
      <div className={right ? 'text-right' : ''} style={{ minWidth: 92 }}>
        <div className="font-display font-bold uppercase leading-none text-white" style={{ fontSize: 28, letterSpacing: '0.04em' }}>{team.tag || team.name}</div>
        <div className="mt-2"><Pips team={team} bestOf={show.bestOf} right={right} /></div>
      </div>
    </div>
  );
  return (
    <AnimatePresence>
      {show.showScoreboard && (
        <motion.div key="sb" className="absolute left-1/2 top-6 flex h-[76px] items-stretch overflow-hidden rounded-[6px]"
          style={{ x: '-50%', background: 'rgba(14,14,14,0.9)', boxShadow: '0 10px 30px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)' }}
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.35, ease: EASE }}>
          {side(show.teamA, false)}
          <div className="ml-5 grid w-[68px] place-items-center bg-white text-[#111]"><Score n={show.teamA.score} size={42} /></div>
          <div className="flex w-[150px] flex-col items-center justify-center">
            <span className="font-sans font-bold text-white/80" style={{ fontSize: 12, letterSpacing: '0.24em' }}>GAME {show.game}</span>
            <span className="mt-1 font-sans font-semibold text-white/40" style={{ fontSize: 11, letterSpacing: '0.2em' }}>{show.mapName ? show.mapName.toUpperCase() : `BEST OF ${show.bestOf}`}</span>
          </div>
          <div className="mr-5 grid w-[68px] place-items-center bg-white text-[#111]"><Score n={show.teamB.score} size={42} /></div>
          {side(show.teamB, true)}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Compact matchup bar above the caster cameras. */
export function MatchBar({ show }: { show: Show }) {
  const t = (team: Team, right?: boolean) => (
    <div className={`flex items-center gap-3 ${right ? 'flex-row-reverse' : ''}`}>
      <TeamLogo team={team} size={36} />
      <span className="font-display font-bold uppercase text-white" style={{ fontSize: 24, letterSpacing: '0.04em' }}>{team.tag || team.name}</span>
    </div>
  );
  return (
    <AnimatePresence>
      {show.showMatchupOnCasters && (
        <motion.div key="mb" className="absolute left-1/2 flex items-center rounded-[6px]" style={{ top: 50, x: '-50%', height: 64, padding: '0 22px', gap: 22, background: 'rgba(14,14,14,0.86)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
          initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35, ease: EASE }}>
          {t(show.teamA)}
          <div className="flex items-center gap-3 font-display font-bold text-white" style={{ fontSize: 28 }}>
            <Score n={show.teamA.score} size={28} /><span className="text-white/30">–</span><Score n={show.teamB.score} size={28} />
          </div>
          {t(show.teamB, true)}
          <div className="ml-2 border-l border-white/15 pl-5 font-sans font-semibold uppercase text-white/50" style={{ fontSize: 12, letterSpacing: '0.22em' }}>
            {show.stage}<br />GAME {show.game} · BO{show.bestOf}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

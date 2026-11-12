import { motion } from 'motion/react';
import { teamPlayers } from '../../../shared/major';
import { GRAND_FINAL, wcLogo, wcResolve, type WildcardState } from '../../../shared/wildcard';
import { Reveal } from '../Reveal';
import './wildcard.css';

const EASE = [0.22, 1, 0.36, 1] as const;
const COLORS = ['#ff4b3e', '#ffb02e', '#ffffff', '#ff7a2f', '#ffd27a'];

/** Champions takeover: on any screen once the Grand final has a winner and the producer switches it on. */
export function WcChampions({ wc }: { wc: WildcardState | null | undefined }) {
  const r = wc ? wcResolve(wc.matches, wc.teams)[GRAND_FINAL] : null;
  const on = !!(wc?.champ && r?.winner);
  const st = wc?.matches[GRAND_FINAL];
  const won = r?.winner ?? '', lost = r?.loser ?? '';
  const sw = st ? (r?.winner === r?.t1 ? st.s1 : st.s2) : '', sl = st ? (r?.winner === r?.t1 ? st.s2 : st.s1) : '';
  return (
    <Reveal show={on} from="fade" id="champ">
      <div className="wc" style={{ position: 'absolute', inset: 0, zIndex: 70 }}>
        <div className="ch">
          {/* confetti: fixed pseudo-random spread so every source matches */}
          {Array.from({ length: 70 }, (_, i) => (
            <i key={i} className="ch-c" style={{ left: `${(i * 37) % 100}%`, background: COLORS[i % COLORS.length], animationDelay: `${(i * 0.13) % 3}s`, animationDuration: `${3.2 + (i % 5) * 0.5}s`, width: 8 + (i % 3) * 4, height: 14 + (i % 4) * 4 }} />
          ))}
          <motion.div className="ch-k" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}>OverDrive 2026 Major</motion.div>
          <motion.h1 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.35 }}>Champions</motion.h1>
          {wcLogo(won) && <motion.img className="ch-logo" src={wcLogo(won)} alt="" initial={{ opacity: 0, y: 40, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.6 }} />}
          <motion.div className="ch-team" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.9 }}>{won}</motion.div>
          <motion.div className="ch-pl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 1.2 }}>
            {teamPlayers(won).map(p => <span key={p.handle}>{p.handle}</span>)}
          </motion.div>
          {sw !== '' && <motion.div className="ch-gf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 1.4 }}>Grand final {sw}–{sl} vs {lost}</motion.div>}
        </div>
      </div>
    </Reveal>
  );
}

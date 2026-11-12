import { motion } from 'motion/react';
import type { Scene, Show } from '../../../shared/types';
import { GUEST_SLOT } from '../../../shared/types';
import { MAJOR_PROFILES, normHandle, teamLogo } from '../../../shared/major';
import type { WildcardState } from '../../../shared/wildcard';
import type { RtcViewer } from '../../lib/rtcViewer';
import { Feed } from '../Feed';
import { Reveal } from '../Reveal';
import './wildcard.css';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Online interview (RLCS style): the player on their own camera (guest slot 6), big, with a lower third
 * (handle, real name, team, country); the host's camera beside it with the player's team card; the title
 * up top and an optional question banner. Host = none → the player alone, centred.
 */
export function WcInterview({ scene, show, wc, viewer, monitor }: { scene: Scene; show: Show; wc: WildcardState | null; viewer?: RtcViewer | null; monitor?: boolean }) {
  const iv = wc?.interview;
  const guest = scene.casters.find(c => c.id === GUEST_SLOT);
  const host = iv?.host != null ? scene.casters.find(c => c.id === iv.host && c.enabled) : undefined;
  const prof = iv?.player ? MAJOR_PROFILES.find(p => normHandle(p.handle) === iv.player) : undefined;
  const handle = prof?.handle || guest?.name || 'Guest';
  const team = prof?.team ?? '';
  const logo = team ? teamLogo(team) : '';
  const solo = !host;
  const g = solo ? { x: 300, y: 176, w: 1320, h: 742 } : { x: 80, y: 190, w: 1100, h: 619 };
  const sub = [prof?.name, team, prof?.country].filter(Boolean).join(' · ');
  return (
    <div className="wc">
      <div className="iv">
        <motion.div className="iv-hd" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE }}>
          <span>{show.stage || 'OverDrive 2026 Major'}</span>
          <h1>{iv?.title || 'Interview'}</h1>
        </motion.div>

        {/* the player */}
        <motion.div className="iv-cam big" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, ease: EASE, delay: 0.1 }}>
          {guest?.cameraOn ? <Feed caster={guest} viewer={viewer} size="lg" showName={false} monitor={monitor} /> : <div className="iv-off">Waiting for the player's camera</div>}
        </motion.div>
        <Reveal show={iv?.lower !== false} from="left" id="iv-lower">
          <div className="iv-lower" style={{ left: g.x, top: g.y + g.h - 112, maxWidth: g.w - 40 }}>
            {logo && <img src={logo} alt="" />}
            <div><b>{handle}</b>{sub && <span>{sub}</span>}</div>
          </div>
        </Reveal>

        {/* the host + the player's team card */}
        {host && (
          <>
            <motion.div className="iv-cam" style={{ left: 1220, top: 190, width: 620, height: 349 }}
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.55, ease: EASE, delay: 0.2 }}>
              {host.cameraOn && <Feed caster={host} viewer={viewer} size="md" showName={false} monitor={monitor} />}
            </motion.div>
            <motion.div className="iv-name" style={{ left: 1220, top: 539, width: 620 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
              <b>{host.name}</b><span>{host.role || 'Host'}</span>
            </motion.div>
            <motion.div className="iv-card" style={{ left: 1220, top: 609, width: 620, height: 200 }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.4 }}>
              {logo ? <img src={logo} alt="" /> : <i />}
              <div>
                <span>{team || 'Player'}</span>
                <b>{handle}</b>
                {prof?.winnings && <em>Career winnings {prof.winnings}</em>}
              </div>
            </motion.div>
          </>
        )}

        {/* question */}
        <Reveal show={!!(iv?.showQ && iv.question.trim())} from="up" id="iv-q">
          <div className="iv-q" style={solo ? { top: 942 } : undefined}><i>Q</i><p>{iv?.question}</p></div>
        </Reveal>
      </div>
    </div>
  );
}

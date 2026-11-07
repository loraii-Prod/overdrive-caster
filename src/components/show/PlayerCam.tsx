import { memo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Show } from '../../../shared/types';
import { vdoViewUrl } from '../../../shared/players';
import { EASE } from '../../lib/motion';
import { useTheme } from '../../lib/theme';
import { Mark } from '../Brand';

export const PLAYER_CAM_SIZES = { sm: { w: 400, h: 225 }, md: { w: 480, h: 270 }, lg: { w: 576, h: 324 } } as const;
const B = 6, BAR = 52, TROPHY = 46;

/** Outer size of the player-cam frame (camera + border + name bar). */
export function playerCamBox(show: Show) {
  const s = PLAYER_CAM_SIZES[show.playerCam.size];
  return { w: s.w + B * 2, h: s.h + B + BAR };
}

/**
 * The spectated player's camera via VDO.Ninja. Every player in the lineup
 * keeps a hidden, already-connected view, so switching is instant; only the
 * active one is visible. `embeds=false` (controller monitors, crew page)
 * shows a placeholder instead of loading the streams again.
 */
export function PlayerCam({ show, embeds = true, x, bottom }: {
  show: Show;
  embeds?: boolean;
  x: number;
  bottom: number;
}) {
  const { theme } = useTheme();
  const active = show.activePlayer;
  const size = PLAYER_CAM_SIZES[show.playerCam.size];
  const box = playerCamBox(show);
  const bnl = theme === 'bnl';
  const byId = new Map(show.lineup.map(p => [p.id, p]));
  if (active && !byId.has(active.id)) byId.set(active.id, { id: active.id, vdo: active.vdo });
  const warm = [...byId.keys()];
  const visible = show.playerCam.enabled && !!active;

  return (
    <>
      {/* Warm views: mounted off-screen-invisible so they stay connected. */}
      {embeds && show.playerCam.enabled && (
        <div className="absolute overflow-hidden" style={{ left: x + B, bottom: bottom + BAR, width: size.w, height: size.h, pointerEvents: 'none' }}>
          {warm.map(id => {
            const p = byId.get(id);
            if (!p?.vdo) return null;
            return <VdoView key={id} src={vdoViewUrl(p, show.vdo.password, show.vdo.params)} on={visible && active?.id === id} />;
          })}
        </div>
      )}
      <AnimatePresence>
        {visible && active && (
          <motion.div key="frame" className="pointer-events-none absolute" style={{ left: x, bottom, width: box.w, height: box.h }}
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} transition={{ duration: 0.32, ease: EASE }}>
            {/* Placeholder behind the video (controller monitors, or while a view loads) */}
            {!embeds && (
              <div className="absolute grid place-items-center bg-[#0b0b0b]" style={{ left: B, top: B, width: size.w, height: size.h }}>
                <div className="text-center">
                  <Mark height={56} style={{ margin: '0 auto', opacity: 0.8 }} />
                  <div className="mt-2 font-display text-[22px] text-white/50">VDO.NINJA · {active.name}</div>
                </div>
              </div>
            )}
            <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 0 ${B}px #050505${bnl ? '' : ''}`, borderRadius: bnl ? 0 : 6 }} />
            <div className="absolute inset-x-0 bottom-0 bg-[#050505]" style={{ height: BAR }}>
              <div className="absolute bottom-0 left-0 grid place-items-center bg-[#151515]" style={{ width: TROPHY, height: TROPHY }}>
                <Mark height={TROPHY * 0.82} />
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={active.id} className="absolute bottom-0 flex items-center gap-3 overflow-hidden" style={{ left: TROPHY + 14, right: 12, height: TROPHY }}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: 0.22, ease: EASE }}>
                  <span className="truncate font-display uppercase leading-none text-white" style={{ fontSize: bnl ? 36 : 26, paddingTop: bnl ? 3 : 0 }}>{active.name}</span>
                  {active.tag && <span className="flex-none bg-[#E8E8E8] px-2 py-[3px] font-display uppercase leading-none text-[#111]" style={{ fontSize: bnl ? 20 : 13 }}>{active.tag}</span>}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** One VDO.Ninja view. Memoised so switching never reloads an iframe. */
export const VdoView = memo(function VdoView({ src, on }: { src: string; on: boolean }) {
  return (
    <iframe
      src={src}
      title="player cam"
      allow="autoplay; fullscreen"
      className="absolute inset-0 h-full w-full border-0 transition-opacity duration-200"
      style={{ opacity: on ? 1 : 0, background: 'transparent' }}
    />
  );
});

/**
 * Analyst desk in a skin, as ONE composition for every panel (approved visuals unchanged at rest):
 *   - "Cameras only": the skin's analyst-desk frame video with the cameras in its holes (was SkinDesk).
 *   - Predictions / Head to head / Player stats / Pick'em: the skin's bar loop, cameras in the left column,
 *     the analysis panel on the right (was ScreenBody → WcDesk).
 * The two used to be different React trees: switching unmounted every camera and video and mounted new
 * ones, and a fresh <video> draws nothing until its first frame decodes, so the source showed ~100–350 ms
 * of nothing (black in OBS). Now the incoming background/frame video is decoded first (useStaged), the
 * same camera elements move between the frame holes and the column, the frame fades over (or off) the bar,
 * and the panel slides in/out. Camera feeds are never remounted (no WebRTC/VDO.Ninja reconnect).
 */
import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import type { Caster, Scene, Show } from '../../../shared/types';
import type { MatchData } from '../../../shared/protocol';
import type { Skin } from '../../../shared/skins';
import type { WildcardState } from '../../../shared/wildcard';
import type { RtcViewer } from '../../lib/rtcViewer';
import { EASE } from '../../lib/motion';
import { HoleBacking, StageVideo, useGfxTransition, useRecent, useStaged } from '../../gfx/transition';
import { Feed } from '../Feed';
import { Reveal } from '../Reveal';
import { DeskPanel, PickBadge, deskCasters, deskLayout } from '../wildcard/Desk';
import { boothFrame, SkinMatchStrip, SkinVsStrip } from './Skin';
import '../wildcard/wildcard.css';

const NAME = 'font-["Montserrat"] font-extrabold italic uppercase';
type Rect = { x: number; y: number; w: number; h: number };

export function SkinAnalystDesk({ skin, scene, show, wc, now, bnl, viewer, monitor }: {
  skin: Skin; scene: Scene; show: Show; wc: WildcardState | null; now: number; bnl: MatchData | null; viewer?: RtcViewer | null; monitor?: boolean;
}) {
  const tr = useGfxTransition();
  const live = deskCasters(scene, wc?.desk);
  const mode: 'cams' | 'panel' = (wc?.desk.panel ?? 'cams') === 'cams' ? 'cams' : 'panel';
  const { kind, frame } = boothFrame(skin, Math.max(1, live.length), true);
  const target = { mode, kind, frame, ids: live.map(c => c.id) };
  const asset = (t: typeof target) => (t.mode === 'cams' ? t.frame : skin.bar);
  // Warm: the bar loop and the frame for the current camera count stay decoded (paused when hidden), so
  // Cameras only <-> panel switches commit at once.
  const st = useStaged(target, t => `${t.mode}|${asset(t)}|${t.ids.join(',')}`, t => [asset(t)], { warm: [skin.bar, frame] });
  const S = st.shown;
  const cams = S.ids.map(id => scene.casters.find(c => c.id === id)).filter((c): c is Caster => !!c);
  const n = cams.length;
  const col = deskLayout(n);
  const rects: Rect[] = S.mode === 'cams' ? skin.holes[S.kind] : cams.map((_, i) => ({ x: 80, y: col.tops[i] ?? col.tops[0], w: col.w, h: col.h }));
  const panelX = 80 + col.w + 50;
  const picks = wc?.intro.picksShow ? wc.intro.picks : {};
  const ms = tr.kind === 'cut' ? 0 : tr.ms;
  const s = ms / 1000;
  const move = { duration: s, ease: EASE };
  const it = wc?.intro;
  const solo = n <= 1;
  const stripTop = solo ? 890 : 196;
  // The panel keeps its last content while it leaves (going to "Cameras only" must not flash another panel).
  const lastPanel = useRef(wc?.desk.panel && wc.desk.panel !== 'cams' ? wc.desk.panel : 'picks');
  if (wc?.desk.panel && wc.desk.panel !== 'cams') lastPanel.current = wc.desk.panel;
  const panelWc = wc && { ...wc, desk: { ...wc.desk, panel: lastPanel.current } };
  // Hole backing for the desk frames shown now or fading out (none in panel mode: the bar loop is opaque).
  // Only needed frame-over-frame: when the bar loop is (or was just) visible it already fills the holes.
  const recentModes = useRecent(S.mode, k => k, ms);
  const recentKinds = useRecent(S.kind, k => k, ms);
  const backing = recentModes.includes('panel') ? [] : recentKinds.flatMap(k => skin.holes[k]);

  return (
    <div className="wc desk" style={{ pointerEvents: 'none', isolation: 'isolate' }} data-desk-mode={S.mode} data-desk-kind={S.kind}>
      {/* Bar loop under the cameras (panel mode). It appears at once under the frame (which still covers it)
          and stays until a frame has faded fully over it. */}
      {st.mounted.filter(src => src === skin.bar).map(src => (
        <StageVideo key={src} src={src} visible={S.mode === 'panel'} ms={ms} enter="instant" leave="hold" z={0} onReady={st.ready} />
      ))}

      <HoleBacking holes={backing} z={1} />
      {/* Cameras: the same elements in both modes (keyed by position id). */}
      <div className="absolute inset-0" style={{ zIndex: 10 }}>
        <AnimatePresence>
          {cams.map((c, i) => {
            const r = rects[i];
            if (!r) return null;
            const desk = S.mode === 'panel';
            return (
              <motion.div key={c.id} data-cam={c.id} className="absolute overflow-hidden"
                style={{ background: desk ? '#120A08' : '#140a0a', boxShadow: desk ? '0 10px 30px rgba(0,0,0,.45)' : '0 10px 30px rgba(0,0,0,0)', transition: `box-shadow ${ms}ms` }}
                initial={{ opacity: 0, scale: 0.96, left: r.x, top: r.y, width: r.w, height: r.h }}
                animate={{ opacity: 1, scale: 1, left: r.x, top: r.y, width: r.w, height: r.h }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: s * 0.8, ease: EASE } }}
                transition={{ default: move, opacity: { duration: 0.35, ease: EASE, delay: 0.06 + i * 0.06 }, scale: { duration: 0.35, ease: EASE, delay: 0.06 + i * 0.06 } }}>
                {c.cameraOn && <Feed caster={c} viewer={viewer} size={n >= 3 ? 'sm' : n > 1 ? 'md' : 'lg'} showName={false} monitor={monitor} />}
                {/* The desk camera's accent top edge (.dk-cam border-top), faded instead of popping. */}
                <div className="absolute inset-x-0 top-0 h-[4px]" style={{ background: 'var(--hot)', opacity: desk ? 1 : 0, transition: `opacity ${ms}ms` }} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Desk frame videos over the cameras (cameras mode). Solo/duo/trio crossfade frame over frame;
          to the panel the frame fades off the bar; back from the panel it fades in over the bar. */}
      {st.mounted.filter(src => src !== skin.bar).map(src => (
        <StageVideo key={src} src={src} visible={S.mode === 'cams' && src === S.frame} ms={ms} wipe={tr.kind === 'wipe'}
          leave={S.mode === 'cams' ? 'hold' : 'fade'} z={src === S.frame ? 21 : 20} onReady={st.ready} />
      ))}

      <div className="absolute inset-0" style={{ zIndex: 30 }}>
        {/* Panel mode header. */}
        <AnimatePresence>
          {S.mode === 'panel' && (
            <motion.div key="top" className="dk-top" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, transition: { duration: s * 0.7 } }} transition={{ duration: Math.max(s, 0.3), ease: EASE }}>
              <div className="k">{[show.tournament || 'OverDrive', 'Analyst desk'].join(' · ')}</div>
              <div className="t">{it?.label || (it?.a && it?.b ? `${it.a} vs ${it.b}` : 'Analysis')}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Names: skin name bars (cameras mode) or desk name boxes (panel mode), crossfading while cameras move. */}
        <AnimatePresence>
          {scene.showNames && cams.map((c, i) => {
            const r = rects[i];
            if (!r || !c.showName) return null;
            const pk = picks[String(c.id)];
            if (S.mode === 'cams') {
              return (
                <motion.div key={`s${c.id}`} className="absolute flex items-center gap-3" style={{ height: skin.nameBar }}
                  initial={{ opacity: 0, x: -10, left: r.x + 18, top: r.y + r.h, width: r.w * 0.62 }}
                  animate={{ opacity: 1, x: 0, left: r.x + 18, top: r.y + r.h, width: r.w * 0.62 }}
                  exit={{ opacity: 0, transition: { duration: s * 0.5 } }}
                  transition={{ default: move, opacity: { duration: 0.35, ease: EASE, delay: 0.1 + i * 0.06 }, x: { duration: 0.35, ease: EASE, delay: 0.1 + i * 0.06 } }}>
                  <span className={`${NAME} truncate text-white`} style={{ fontSize: S.kind === 'trio' ? 26 : 30 }}>{c.name}</span>
                  {c.role && <span className="flex-none font-['Montserrat'] text-[14px] font-bold uppercase tracking-[0.12em] text-white/55">{c.role}</span>}
                </motion.div>
              );
            }
            return (
              <motion.div key={`d${c.id}`} className={`dk-name${n >= 3 ? ' sm' : ''}`} style={{ height: col.bar }}
                initial={{ opacity: 0, left: r.x, top: r.y + r.h, width: r.w }}
                animate={{ opacity: 1, left: r.x, top: r.y + r.h, width: r.w }}
                exit={{ opacity: 0, transition: { duration: s * 0.5 } }}
                transition={{ default: move, opacity: { duration: Math.max(s, 0.25), ease: EASE, delay: s * 0.4 } }}>
                <b>{c.name}</b>{c.role && <span>{c.role}</span>}
                <AnimatePresence>{pk && <motion.span key="pk" className="ml-auto" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.3 }}><PickBadge pick={pk} size="sm" logoOnly={n >= 2} /></motion.span>}</AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Cameras mode: prediction badge in each camera's corner (as on the casters booth). */}
        <AnimatePresence>
          {S.mode === 'cams' && wc?.intro.picksShow && cams.map((c, i) => {
            const r = rects[i], pk = picks[String(c.id)];
            if (!r || !pk) return null;
            return (
              <motion.div key={`p${c.id}`} className="absolute"
                initial={{ opacity: 0, y: -10, scale: 0.9, right: 1920 - (r.x + r.w - 14), top: r.y + 14 }}
                animate={{ opacity: 1, y: 0, scale: 1, right: 1920 - (r.x + r.w - 14), top: r.y + 14 }}
                exit={{ opacity: 0, y: -10, scale: 0.9, transition: { duration: 0.25 } }}
                transition={{ default: move, opacity: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.08 }, y: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.08 }, scale: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.08 } }}>
                <PickBadge pick={pk} size={S.kind === 'trio' ? 'sm' : 'md'} />
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* The analysis panel: slides in beside the cameras, content swaps inside it. */}
        <AnimatePresence>
          {S.mode === 'panel' && (
            <motion.div key="panel" className="absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 60, transition: { duration: s * 0.8, ease: EASE } }}>
              <DeskPanel wc={panelWc} scene={scene} bnl={bnl} left={panelX} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cameras mode extras (VS strip / countdown), switched on from the desk controls. */}
        <Reveal show={S.mode === 'cams' && !!(wc?.desk.strip || wc?.desk.clock)} from="down">{(it && (it.a || it.b)
          ? <SkinVsStrip a={it.a} b={it.b} teams={!!wc?.desk.strip} label={solo || !wc?.desk.strip ? '' : it.label} top={stripTop} left={wc?.desk.clock && show.timer.target != null ? show.timer.target - now : null} />
          : wc?.desk.strip && scene.showBranding && <SkinMatchStrip show={show} top={stripTop} />)}</Reveal>
      </div>
    </div>
  );
}

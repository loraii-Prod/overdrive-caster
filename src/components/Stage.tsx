import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BNL, compose, CANVAS, deviceScale } from '../../shared/layout';
import type { Caster, ForcedLayout, Rect, Scene, ThemeId, Tile } from '../../shared/types';
import type { RtcViewer } from '../lib/rtcViewer';
import { BgVideo, Logo, Mark, Pattern } from './Brand';
import { ThemeProvider, useTheme } from '../lib/theme';
import { Nameplate } from './Nameplate';
import { IdentityCard } from './IdentityCard';
import { Feed } from './Feed';
import { DUR, EASE } from '../lib/motion';


export interface Layers {
  background: boolean;
  content: boolean; // camera feeds + identity cards
  frames: boolean;
  names: boolean;
  branding: boolean;
}

export const ALL_LAYERS: Layers = { background: true, content: true, frames: true, names: true, branding: true };

interface Props {
  scene: Scene;
  forced?: ForcedLayout;
  layers?: Layers;
  viewer?: RtcViewer | null;
  /** Controller monitors: show small diagnostics that never appear on air. */
  monitor?: boolean;
  /** Overrides the surrounding theme (standalone outputs). */
  theme?: ThemeId;
}

/**
 * The 1920×1080 LOGICAL canvas, scaled to fit its parent.
 *
 * Previews (Studio, Controller, Admin) get an exact fit at any size. Broadcast outputs (`output`) render natively at
 * the browser source's size: 3840×2160 → exactly 2 device px per unit, 1920×1080 → 1. Text, SVG and CSS shapes are
 * rasterised at that device size (measured identical to Chrome's own 2× rendering), images and video keep their pixels.
 * Outputs also hold the first paint until the bundled fonts are ready (no fallback-font frame on air).
 *
 * `?raster=zoom` switches outputs from a transform to CSS zoom (layout-level scaling) for A/B tests in real OBS.
 */
export function ScaledCanvas({ children, className = '', output = false }: { children: ReactNode; className?: string; output?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: CANVAS.w, h: CANVAS.h });
  useLayoutEffect(() => {
    const el = ref.current!;
    const fit = () => { if (el.clientWidth && el.clientHeight) setBox({ w: el.clientWidth, h: el.clientHeight }); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ready = useFontsReady(output);
  const s = output ? deviceScale(box.w, box.h) : Math.min(box.w / CANVAS.w, box.h / CANVAS.h) || 1;
  // An exact whole-number fit that fills the box is anchored at 0,0: no centring offset, every unit on whole device pixels.
  const exact = output && Number.isInteger(s) && box.w === CANVAS.w * s && box.h === CANVAS.h * s;
  const zoom = exact && rasterMode() === 'zoom';
  const style: CSSProperties = zoom
    ? { position: 'absolute', left: 0, top: 0, width: CANVAS.w, height: CANVAS.h, zoom: s }
    : exact
      ? { position: 'absolute', left: 0, top: 0, width: CANVAS.w, height: CANVAS.h, transform: s === 1 ? undefined : `scale(${s})`, transformOrigin: '0 0' }
      : { position: 'absolute', left: '50%', top: '50%', width: CANVAS.w, height: CANVAS.h, transform: `translate(-50%, -50%) scale(${s})`, transformOrigin: 'center' };
  return (
    <div ref={ref} className={`relative h-full w-full overflow-hidden ${className}`}
      {...(output ? { 'data-od-canvas': `${box.w}x${box.h}`, 'data-od-scale': String(Math.round(s * 1000) / 1000), 'data-od-raster': zoom ? 'zoom' : 'transform', 'data-od-ready': ready ? '1' : '0' } : {})}>
      <div style={{ ...style, ...(ready ? {} : { visibility: 'hidden' }) }}>
        {children}
      </div>
    </div>
  );
}

const rasterMode = (): 'transform' | 'zoom' => (typeof location !== 'undefined' && new URLSearchParams(location.search).get('raster') === 'zoom' ? 'zoom' : 'transform');

/** Every bundled broadcast face (fontsource + Wildcard). Loading them up front avoids a fallback-font frame when data arrives. */
const BROADCAST_FACES = [
  '400 1em Inter', '500 1em Inter', '600 1em Inter', '700 1em Inter', '600 1em Sora', '700 1em Sora', '400 1em "Bebas Neue"',
  '500 1em "Barlow Condensed"', '600 1em "Barlow Condensed"', '700 1em "Barlow Condensed"', '400 1em "WC Anton"',
  '600 1em "WC Montserrat"', '700 1em "WC Montserrat"', '800 1em "WC Montserrat"', 'italic 600 1em "WC Montserrat"',
  'italic 700 1em "WC Montserrat"', 'italic 800 1em "WC Montserrat"', 'italic 900 1em "WC Montserrat"',
];
let fontsDone = false;
/** True once the broadcast fonts are loaded (or after 2.5 s, so a missing font never keeps a source blank). */
function useFontsReady(enabled: boolean) {
  const [ok, setOk] = useState(!enabled || fontsDone || typeof document === 'undefined' || !document.fonts);
  useEffect(() => {
    if (ok) return;
    let live = true;
    const done = () => { fontsDone = true; if (live) setOk(true); };
    const t = setTimeout(done, 2500);
    Promise.allSettled(BROADCAST_FACES.map(f => document.fonts.load(f))).then(() => document.fonts.ready).then(() => { clearTimeout(t); done(); });
    return () => { live = false; clearTimeout(t); };
  }, [ok]);
  return ok;
}

export function Stage(props: Props) {
  const ctx = useTheme();
  const theme = props.theme ?? ctx.theme;
  return (
    <ThemeProvider theme={theme} bgProvided={ctx.bgProvided && !props.theme} brand={ctx.brand}>
      <StageInner {...props} theme={theme} />
    </ThemeProvider>
  );
}

function StageInner({ scene, forced, layers = ALL_LAYERS, viewer, monitor, theme = 'classic' }: Props) {
  const { bgProvided } = useTheme();
  const comp = useMemo(() => compose(scene, forced, theme), [scene, forced, theme]);
  const sting = useSting(comp.arrangement, layers.branding && scene.showBranding);
  const bnl = theme === 'bnl';

  return (
    <div className="od-stage relative overflow-hidden" data-theme={theme} style={{ width: CANVAS.w, height: CANVAS.h }}>
      {/* Background */}
      <AnimatePresence>
        {layers.background && comp.background && !(bnl && bgProvided) && (
          <motion.div key="bg" className="absolute inset-0 bg-[#141414]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            {bnl ? <BgVideo /> : (
              <>
                <Pattern drift opacity={comp.audioMode ? 0.55 : 0.4} size={620} />
                <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(20,20,20,0) 35%, rgba(12,12,12,0.85) 100%)' }} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tiles */}
      <AnimatePresence>
        {comp.tiles.map(t => (
          bnl
            ? <BnlTile key={t.casterId} tile={t} caster={scene.casters[t.casterId - 1]} layers={layers} viewer={viewer} monitor={monitor} count={comp.tiles.length} />
            : <TileView key={t.casterId} tile={t} caster={scene.casters[t.casterId - 1]} layers={layers} viewer={viewer} monitor={monitor} count={comp.tiles.length} audio={comp.audioMode} />
        ))}
      </AnimatePresence>

      {/* Branding */}
      <AnimatePresence>
        {layers.branding && scene.showBranding && !bnl && (
          <motion.div key="brand" className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Logo height={84} style={{ position: 'absolute', left: 64, top: 44 }} />
            <div className="absolute" style={{ left: 64, right: 64, top: 1022, height: 1, background: 'rgba(255,255,255,0.16)' }} />
            <div className="absolute bg-white" style={{ left: 64, top: 1018, width: 56, height: 3 }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logo sting on major layout changes */}
      <AnimatePresence>
        {sting > 0 && (
          <motion.div key={`sting-${sting}`} className="pointer-events-none absolute left-1/2 top-1/2"
            style={{ x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: [0, 0.95, 0.95, 0], scale: [0.92, 1, 1, 1.02] }}
            transition={{ duration: 0.9, times: [0, 0.3, 0.6, 1], ease: 'easeInOut' }}>
            <Mark height={120} style={{ filter: 'drop-shadow(0 6px 24px rgba(0,0,0,0.6))' }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function useSting(arrangement: string, enabled: boolean) {
  const prev = useRef(arrangement);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== arrangement && enabled && arrangement !== 'none' && prev.current !== 'none') setN(x => x + 1);
    prev.current = arrangement;
  }, [arrangement, enabled]);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => setN(0), 1000);
    return () => clearTimeout(t);
  }, [n]);
  return n;
}

const rectStyle = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });

function TileView({ tile, caster, layers, viewer, monitor, count, audio }: {
  tile: Tile; caster: Caster; layers: Layers; viewer?: RtcViewer | null; monitor?: boolean; count: number; audio: boolean;
}) {
  const size: 'lg' | 'md' | 'sm' = count === 1 ? 'lg' : count === 2 ? 'md' : 'sm';
  const isCard = tile.kind === 'card';
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={{ ...rectStyle(tile.rect), opacity: 0, scale: 0.97 }}
      animate={{ ...rectStyle(tile.rect), opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.24, ease: EASE } }}
      transition={{ duration: DUR, ease: EASE }}
    >
      {layers.content && (
        <div className="absolute inset-0 overflow-hidden rounded-[6px]" style={{ background: tile.kind === 'obs' ? 'transparent' : '#161616' }}>
          {isCard && <IdentityCard caster={caster} size={size} showName={tile.showName} audio={audio} />}
          {tile.kind === 'video' && <Feed caster={caster} viewer={viewer} size={size} showName={tile.showName} monitor={monitor} />}
          {tile.kind === 'obs' && monitor && (
            <div className="absolute inset-0 grid place-items-center" style={{ background: 'repeating-linear-gradient(45deg, #1b1b1b 0 14px, #202020 14px 28px)' }}>
              <span className="font-display text-[22px] tracking-[0.2em] text-white/40">OBS · {caster.source.obsSource || 'source'}</span>
            </div>
          )}
        </div>
      )}
      {layers.frames && <Frame />}
      {/* Cards carry their own name; nameplates belong to camera tiles. */}
      {layers.names && !isCard && (
        <AnimatePresence>
          {tile.showName && <Nameplate key="np" name={caster.name} role={caster.role} size={size} />}
        </AnimatePresence>
      )}
    </motion.div>
  );
}

/** Boxed caster tile (used only when an event has no video skin). */
function BnlTile({ tile, caster, layers, viewer, monitor, count }: {
  tile: Tile; caster: Caster; layers: Layers; viewer?: RtcViewer | null; monitor?: boolean; count: number;
}) {
  const size: 'lg' | 'md' | 'sm' = count === 1 ? 'lg' : count === 2 ? 'md' : 'sm';
  const b = BNL.border, bar = BNL.bar, tb = BNL.trophy;
  const drawBar = layers.frames || layers.names;
  const nameSize = count === 3 ? 40 : 44;
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={{ ...rectStyle(tile.rect), opacity: 0, scale: 0.98 }}
      animate={{ ...rectStyle(tile.rect), opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.24, ease: EASE } }}
      transition={{ duration: DUR, ease: EASE }}
    >
      {layers.content && (
        <div className="absolute overflow-hidden" style={{ left: b, top: b, right: b, bottom: bar, background: tile.kind === 'obs' ? 'transparent' : '#0b0b0b' }}>
          {tile.kind === 'card' && <IdentityCard caster={caster} size={size} showName={false} />}
          {tile.kind === 'video' && <Feed caster={caster} viewer={viewer} size={size} showName={false} monitor={monitor} />}
          {tile.kind === 'obs' && monitor && (
            <div className="absolute inset-0 grid place-items-center" style={{ background: 'repeating-linear-gradient(45deg, #1b1b1b 0 14px, #202020 14px 28px)' }}>
              <span className="font-display text-[26px] tracking-[0.1em] text-white/40">OBS · {caster.source.obsSource || 'source'}</span>
            </div>
          )}
        </div>
      )}
      {layers.frames && (
        <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 0 ${b}px #050505` }} />
      )}
      {drawBar && (
        <div className="absolute inset-x-0 bottom-0 bg-[#050505]" style={{ height: bar }}>
          <div className="absolute bottom-0 left-0 grid place-items-center bg-[#151515]" style={{ width: tb, height: tb }}>
            <Mark height={tb * 0.85} />
          </div>
          {layers.names && (
            <AnimatePresence>
              {tile.showName && (
                <motion.div key="n" className="absolute bottom-0 flex items-center overflow-hidden" style={{ left: tb + 18, right: 16, height: tb }}
                  initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.3, ease: EASE }}>
                  <span className="truncate font-display uppercase leading-none text-white" style={{ fontSize: nameSize, letterSpacing: '0.03em', paddingTop: 4 }}>{caster.name || '—'}</span>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      )}
      {layers.names && (
        <AnimatePresence>
          {tile.showName && caster.role && (
            <motion.div key="tag" className="absolute flex items-center overflow-hidden bg-[#E8E8E8] px-3.5"
              style={{ left: tb, top: tile.rect.h, width: BNL.tagW, height: BNL.tagH, transformOrigin: 'top' }}
              initial={{ opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }} exit={{ opacity: 0, scaleY: 0 }} transition={{ duration: 0.28, ease: EASE, delay: 0.06 }}>
              <span className="truncate font-display uppercase leading-none text-[#111]" style={{ fontSize: 27, letterSpacing: '0.04em', paddingTop: 3 }}>{caster.role}</span>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );
}

function Frame() {
  const tick = 'absolute border-white';
  const L = 22;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 rounded-[6px] border border-white/15" />
      <div className={tick} style={{ left: -1, top: -1, width: L, height: L, borderLeftWidth: 2, borderTopWidth: 2, borderTopLeftRadius: 6 }} />
      <div className={tick} style={{ right: -1, top: -1, width: L, height: L, borderRightWidth: 2, borderTopWidth: 2, borderTopRightRadius: 6 }} />
      <div className={tick} style={{ left: -1, bottom: -1, width: L, height: L, borderLeftWidth: 2, borderBottomWidth: 2, borderBottomLeftRadius: 6 }} />
      <div className={tick} style={{ right: -1, bottom: -1, width: L, height: L, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 6 }} />
    </div>
  );
}

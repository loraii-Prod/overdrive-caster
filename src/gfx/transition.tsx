/**
 * Overdrive Graphics Engine — internal graphic transitions (NOT OBS transitions).
 *
 * Why this exists: a graphic used to change by unmounting what was on screen and mounting the next thing.
 * A freshly mounted <video> (skin frames, background loops) draws nothing until its first frame is decoded,
 * and an AnimatePresence "wait" fades the old layout to nothing before the new one exists: both left the
 * browser source transparent (black in OBS) for 100–350 ms. The rules here:
 *   1. What is on screen stays on screen until what replaces it can draw (videos decoded, images loaded).
 *   2. Incoming content is mounted early and hidden; the swap is committed only when it is ready
 *      (or after a safety timeout, so a broken asset can never freeze a graphic).
 *   3. Elements that exist in both states (cameras, panels) are not remounted: they move.
 *   4. Rapid changes always settle on the latest target; nothing is left half-way.
 * Only opacity, transform and clip-path are animated.
 */
import { hiRes } from '../../shared/assetRes';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type TransitionKind = 'crossfade' | 'slide' | 'wipe' | 'scale' | 'cut';
export interface GfxTransition { kind: TransitionKind; ms: number }
export const TRANSITION_KINDS: TransitionKind[] = ['crossfade', 'slide', 'wipe', 'scale', 'cut'];
export const DEFAULT_TRANSITION: GfxTransition = { kind: 'crossfade', ms: 300 };

const Ctx = createContext<GfxTransition>(DEFAULT_TRANSITION);
export const TransitionProvider = ({ value, children }: { value: GfxTransition; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
/** The transition of the graphic being rendered (from its package properties, or the default). */
export const useGfxTransition = () => useContext(Ctx);
/** Reads `transition` / `transitionMs` from a graphics instance config. */
export function transitionOf(cfg: Record<string, unknown> | null | undefined): GfxTransition {
  const kind = TRANSITION_KINDS.includes(cfg?.transition as TransitionKind) ? (cfg!.transition as TransitionKind) : DEFAULT_TRANSITION.kind;
  const ms = typeof cfg?.transitionMs === 'number' && Number.isFinite(cfg.transitionMs) ? Math.max(0, Math.min(1000, cfg.transitionMs)) : DEFAULT_TRANSITION.ms;
  return { kind, ms };
}

export const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';

/** True when every video in `el` has a decoded frame and every image is loaded. */
export function visualsReady(el: Element | null): boolean {
  if (!el) return true;
  for (const v of el.querySelectorAll('video')) if ((v.currentSrc || v.srcObject) && v.readyState < 2 && !v.error) return false;
  for (const i of el.querySelectorAll('img')) if (i.getAttribute('src') && !i.complete) return false;
  return true;
}

/** Resolves when `el`'s visuals can draw, or after `maxWait` ms (never blocks a graphic for good). */
export function whenVisualsReady(get: () => Element | null, maxWait = 700): Promise<void> {
  return new Promise(res => {
    const t0 = performance.now();
    const tick = () => (visualsReady(get()) || performance.now() - t0 > maxWait ? res() : requestAnimationFrame(tick));
    tick();
  });
}

// ---------------------------------------------------------------------------------------------- staged commit

/**
 * Staged commit for compositions backed by videos: returns the state to SHOW, which lags `target` until the
 * assets `target` needs are ready (reported through `ready(src)`), then switches in one render so every
 * element animates together. `mounted` = assets to keep in the DOM: the shown ones, the incoming ones, and
 * the outgoing ones for `linger` ms (quick toggles back are instant and nothing is reloaded), and `warm`
 * ones (kept decoded and paused while hidden, so switching to them needs no loading at all).
 */
export function useStaged<T>(target: T, keyOf: (t: T) => string, assetsOf: (t: T) => string[], { maxWait = 900, linger = 2500, warm = [] as string[] } = {}) {
  const tk = keyOf(target);
  const [shownKey, setShownKey] = useState(tk);
  const shown = useRef(target);
  if (tk === shownKey) shown.current = target; // same layout: data changes apply immediately
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const [lingering, setLingering] = useState<string[]>([]);
  const need = assetsOf(target);
  const allReady = need.every(a => ready.has(a));

  const commit = () => {
    const before = assetsOf(shown.current);
    shown.current = target;
    setShownKey(tk);
    const now = assetsOf(target);
    const gone = before.filter(a => !now.includes(a));
    if (gone.length) {
      setLingering(l => [...new Set([...l, ...gone])]);
      window.setTimeout(() => setLingering(l => l.filter(a => !gone.includes(a))), linger);
    }
  };
  // Commit as soon as the target's assets can draw…
  useEffect(() => { if (tk !== shownKey && allReady) commit(); }); // eslint-disable-line react-hooks/exhaustive-deps
  // …or after maxWait, whatever happens (a missing file must not freeze the graphic).
  useEffect(() => {
    if (tk === shownKey) return;
    const t = window.setTimeout(() => commit(), maxWait);
    return () => clearTimeout(t);
  }, [tk, shownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable order (first seen first): reordering would MOVE a <video> in the DOM, and a moved element loses
  // its running CSS transition (the outgoing frame would vanish instead of holding under the incoming one).
  const order = useRef<string[]>([]);
  const want = new Set([...assetsOf(shown.current), ...need, ...lingering, ...warm]);
  for (const a of want) if (!order.current.includes(a)) order.current.push(a);
  order.current = order.current.filter(a => want.has(a));
  const mounted = order.current.slice();
  return {
    shown: shown.current,
    /** Changing: the target is not on screen yet. */
    pending: tk !== shownKey,
    mounted,
    ready: (src: string, ok = true) => setReady(r => { if (ok === r.has(src)) return r; const n = new Set(r); ok ? n.add(src) : n.delete(src); return n; }),
  };
}

/**
 * A looping, muted, full-frame skin video that reports when it can draw. Visibility is an opacity, so a
 * hidden layer keeps decoding and can come back without a black frame.
 *   enter = 'fade' (fades in over ms) | 'instant' (appears at once: something above still covers it)
 *   leave = 'fade' (fades out over ms) | 'hold' (stays fully visible for ms, then disappears: something
 *           above is fading in over it)
 */
export function StageVideo({ src, visible, ms, enter = 'fade', leave = 'fade', wipe = false, z, onReady }: {
  src: string; visible: boolean; ms: number; enter?: 'fade' | 'instant'; leave?: 'fade' | 'hold'; wipe?: boolean; z?: number; onReady: (src: string, ok: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current!;
    const ok = () => onReady(src, true);
    if (v.readyState >= 2) ok();
    v.addEventListener('loadeddata', ok);
    v.addEventListener('error', ok); // a broken file must not block the commit
    v.play().catch(() => {});
    return () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', ok); onReady(src, false); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hidden layers pause once their exit is over (no decoding cost; the decoded frame stays, so they can come back instantly).
  useEffect(() => {
    const v = ref.current!;
    if (visible) { v.play().catch(() => {}); return; }
    const t = window.setTimeout(() => { if (v.readyState >= 2) v.pause(); }, ms + 150);
    return () => clearTimeout(t);
  }, [visible, ms]);
  const style: CSSProperties = visible
    ? { opacity: 1, transition: enter === 'instant' ? 'none' : `opacity ${ms}ms ${EASE_OUT}${wipe ? `, clip-path ${ms}ms ${EASE_OUT}` : ''}`, clipPath: wipe ? 'inset(0 0 0 0)' : undefined }
    : { opacity: 0, transition: leave === 'hold' ? `opacity 0s linear ${ms}ms` : `opacity ${ms}ms ${EASE_OUT}`, clipPath: wipe ? 'inset(0 100% 0 0)' : undefined };
  return <video ref={ref} src={hiRes(src)} muted loop playsInline autoPlay preload="auto" data-stage-video={src} data-visible={visible ? '1' : '0'}
    className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={{ ...style, zIndex: z, willChange: 'opacity' }} />;
}

/** The current value plus the previous ones for `ms` after they changed (to keep their backing while animating). */
export function useRecent<T>(value: T, keyOf: (t: T) => string, ms: number): T[] {
  const k = keyOf(value);
  const [old, setOld] = useState<{ k: string; v: T }[]>([]);
  const last = useRef({ k, v: value });
  if (last.current.k !== k) {
    const prev = last.current;
    last.current = { k, v: value };
    setOld(o => [...o.filter(x => x.k !== prev.k && x.k !== k), prev]);
    window.setTimeout(() => setOld(o => o.filter(x => x !== prev)), ms + 120);
  }
  last.current.v = value;
  return [value, ...old.filter(x => x.k !== k).map(x => x.v)];
}

/**
 * Opaque backing for the camera holes of every frame video visible right now (the shown frame and, while
 * it fades away, the previous one). Cameras move between holes; without this the parts of a hole a camera
 * has not reached yet (or a hole whose camera is still fading in) would be transparent.
 */
export function HoleBacking({ holes, color = '#140a0a', z = 0 }: { holes: { x: number; y: number; w: number; h: number }[]; color?: string; z?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: z }} data-hole-backing={holes.length}>
      {holes.map((r, i) => <div key={i} className="absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: color }} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- content swap

const enterFrames = (kind: TransitionKind): Keyframe[] => {
  switch (kind) {
    case 'slide': return [{ opacity: 0, transform: 'translateX(48px)' }, { opacity: 1, transform: 'none' }];
    case 'wipe': return [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }];
    case 'scale': return [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }];
    case 'cut': return [{ opacity: 1 }, { opacity: 1 }];
    default: return [{ opacity: 0 }, { opacity: 1 }];
  }
};
const leaveFrames = (kind: TransitionKind): Keyframe[] => {
  switch (kind) {
    case 'slide': return [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-32px)' }];
    case 'scale': return [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.02)' }];
    case 'wipe': case 'cut': return [{ opacity: 1 }, { opacity: 1 }]; // stays under the incoming wipe, removed after
    default: return [{ opacity: 1 }, { opacity: 0 }];
  }
};

interface Layer { k: string; id: number }

/**
 * Swaps content keyed by `k` without a blank frame: the outgoing layer stays mounted (and visible) while the
 * incoming one is mounted, waits until it can draw, then animates in (`kind`, `ms`). Rapid changes settle on
 * the latest key: a layer that never started showing is dropped, one still animating is finished at once.
 * The current layer always renders the live `children`; outgoing layers keep their last content.
 */
export function Swap({ k, children, kind, ms, className = 'absolute inset-0', style, layerStyle, onShow, flow = false }: {
  k: string; children: ReactNode; kind?: TransitionKind; ms?: number; className?: string; style?: CSSProperties; layerStyle?: CSSProperties;
  /** Flow mode: the current layer stays in the document flow (its height sizes the box); outgoing layers overlay it. */
  flow?: boolean;
  /** Called when the layer for `k` starts showing (after it is ready). */
  onShow?: (k: string) => void;
}) {
  const tr = useGfxTransition();
  const K = kind ?? tr.kind, MS = ms ?? tr.ms;
  const seq = useRef(1);
  const [layers, setLayers] = useState<Layer[]>(() => [{ k, id: 0 }]);
  const nodes = useRef(new Map<number, ReactNode>());
  const els = useRef(new Map<number, HTMLDivElement>());
  const running = useRef(new Map<number, Animation[]>());
  const shown = useRef(new Set<number>([0]));

  const top = layers[layers.length - 1];
  if (top.k === k) nodes.current.set(top.id, children);
  else {
    // Key changed: the old top keeps its last content; a top that never showed is dropped (nobody saw it).
    const keep = shown.current.has(top.id) ? layers : layers.slice(0, -1);
    const id = seq.current++;
    nodes.current.set(id, children);
    setLayers([...keep, { k, id }]);
  }

  useLayoutEffect(() => {
    const incoming = layers[layers.length - 1];
    if (layers.length < 2 || shown.current.has(incoming.id)) return;
    let cancelled = false;
    const inEl = () => els.current.get(incoming.id) ?? null;
    const el = inEl();
    if (el) el.style.opacity = '0';
    whenVisualsReady(inEl).then(() => {
      if (cancelled) return;
      const e = inEl();
      if (!e) return;
      // Anything still animating ends in its final state now (rapid changes never stack up).
      for (const anims of running.current.values()) anims.forEach(a => a.finish());
      shown.current.add(incoming.id);
      e.style.opacity = '';
      const outs = layers.slice(0, -1).map(l => els.current.get(l.id)).filter((x): x is HTMLDivElement => !!x);
      const dur = K === 'cut' ? 0 : MS;
      const a = e.animate(enterFrames(K), { duration: dur, easing: EASE_OUT, fill: 'backwards' });
      const b = outs.map(o => o.animate(leaveFrames(K), { duration: dur, easing: 'ease-in', fill: 'forwards' }));
      running.current.set(incoming.id, [a, ...b]);
      onShow?.(incoming.k);
      a.finished.catch(() => {}).then(() => {
        running.current.delete(incoming.id);
        setLayers(ls => {
          const i = ls.findIndex(x => x.id === incoming.id);
          if (i <= 0) return ls;
          for (const l of ls.slice(0, i)) { nodes.current.delete(l.id); shown.current.delete(l.id); }
          return ls.slice(i);
        });
      });
    });
    return () => { cancelled = true; };
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={flow ? `relative ${className === 'absolute inset-0' ? '' : className}` : className} style={style} data-swap={k}>
      {layers.map((l, i) => (
        <div key={l.id} ref={e => { if (e) els.current.set(l.id, e); else els.current.delete(l.id); }}
          data-swap-layer={l.k} data-swap-state={i === layers.length - 1 ? 'in' : 'out'}
          className={flow ? (i === layers.length - 1 ? 'relative' : 'absolute inset-x-0 top-0') : 'absolute inset-0'} style={{ ...layerStyle, zIndex: i + 1, pointerEvents: 'none' }}>
          {i === layers.length - 1 ? children : nodes.current.get(l.id)}
        </div>
      ))}
    </div>
  );
}

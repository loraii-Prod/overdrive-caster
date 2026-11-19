// Sandbox stub of motion/react: renders plain elements (no animation). The real build uses the motion package.
import { createElement, forwardRef, Fragment, type ReactNode } from 'react';
const DROP = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'whileInView', 'layout', 'layoutId', 'onAnimationComplete', 'onAnimationStart', 'custom', 'inherit', 'drag', 'dragConstraints', 'viewport', 'whileFocus', 'whileDrag', 'layoutDependency', 'onUpdate']);
const cache = new Map<string, any>();
const make = (tag: string) => {
  if (!cache.has(tag)) cache.set(tag, forwardRef<any, any>((p, ref) => {
    const o: any = { ref };
    for (const k in p) if (!DROP.has(k)) o[k] = p[k];
    const a = p.animate && typeof p.animate === 'object' && !Array.isArray(p.animate) ? p.animate : null;
    if (a) { const st: any = { ...(p.style ?? {}) }; for (const k of ['opacity']) if (typeof a[k] === 'number') st[k] = a[k]; o.style = st; }
    queueMicrotask(() => p.onAnimationComplete?.());
    return createElement(tag, o);
  }));
  return cache.get(tag);
};
export const motion: any = new Proxy({}, { get: (_t, k: string) => make(k) });
export const AnimatePresence = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);
export const LayoutGroup = AnimatePresence;
export const MotionConfig = AnimatePresence;
export const useReducedMotion = () => true;
export const useAnimate = () => [{ current: null }, async () => {}];
export const animate = (..._a: unknown[]) => ({ stop() {}, then: (r: () => void) => r(), finished: Promise.resolve() });
export const useMotionValue = (v: unknown) => ({ get: () => v, set() {}, on: () => () => {} });
export const useTransform = (v: any) => v;
export const useSpring = (v: any) => v;

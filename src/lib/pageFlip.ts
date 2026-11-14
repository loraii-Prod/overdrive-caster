/**
 * Page transitions for paged broadcast graphics (brackets). Every page stays mounted (so logos are
 * decoded and nothing re-lays out on a change); only visibility flips. On a change the pieces of the
 * old page (elements with `data-c` = column index) fade and slide out column by column while the new
 * page's pieces arrive in a stagger. A change during a transition continues from wherever every piece
 * is at that moment (commitStyles), so rapid changes never stack, overlap or blank the frame.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Timing (ms): out 220 + stagger 30/col; in starts at 160, 260 + 40/col (tightened for wide brackets): ≤ 600 ms in all. */
export const PAGE_T = { out: 220, outStagger: 30, inAt: 160, in: 260, inStagger: 40, shift: 64 };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pieces = (el: HTMLElement | null) => (el ? Array.from(el.querySelectorAll<HTMLElement>('[data-c]')) : []);
/** Freeze a piece where it is right now, so an interrupted transition carries on from there. */
const settle = (el: HTMLElement) => { for (const a of el.getAnimations()) { if (a.constructor.name !== 'Animation') continue; try { a.commitStyles(); } catch { /* not rendered */ } a.cancel(); } };

export function usePageFlip(count: number, page: number): { refs: RefObject<HTMLDivElement | null>[]; shown: boolean[]; settled: boolean; prev: number | null } {
  const refs = useRef<RefObject<HTMLDivElement | null>[]>([]);
  while (refs.current.length < count) refs.current.push({ current: null });
  const [shown, setShown] = useState<boolean[]>(() => Array.from({ length: count }, (_, i) => i === page));
  const [prev, setPrev] = useState<number | null>(null);
  const shownRef = useRef(shown), gen = useRef(0), last = useRef(page);
  const show = (v: boolean[]) => { shownRef.current = v; setShown(v); };
  useLayoutEffect(() => {
    const from = last.current;
    if (page === from) return;
    last.current = page;
    const g = ++gen.current, R = refs.current;
    setPrev(from);
    const out = pieces(R[from]?.current ?? null), inn = pieces(R[page]?.current ?? null);
    const T = PAGE_T, dir = page > from ? -1 : 1; // a later page comes in from the right
    const wasHidden = !shownRef.current[page];
    show(Array.from({ length: count }, (_, i) => i === page || i === from));
    const only = Array.from({ length: count }, (_, i) => i === page);
    if (!inn.length || !inn[0].animate || reducedMotion()) {
      for (const el of [...out, ...inn]) { settle(el); el.style.opacity = ''; el.style.translate = ''; }
      show(only); setPrev(null);
      return;
    }
    const c = (el: HTMLElement) => Number(el.dataset.c) || 0;
    // Wide brackets (many rounds) tighten the stagger so the whole change stays within ~600 ms.
    const maxC = Math.max(1, ...out.map(c), ...inn.map(c));
    const sOut = Math.min(T.outStagger, 120 / maxC), sIn = Math.min(T.inStagger, (600 - T.inAt - T.in) / maxC);
    for (const el of out) {
      settle(el);
      el.animate([{ opacity: 0, translate: `${dir * T.shift}px 0` }], { duration: T.out, delay: c(el) * sOut, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    }
    const ends: Promise<unknown>[] = [];
    for (const el of inn) {
      settle(el);
      if (wasHidden) { el.style.opacity = '0'; el.style.translate = `${-dir * T.shift}px 0`; }
      ends.push(el.animate([{ opacity: 1, translate: '0 0' }], { duration: T.in, delay: T.inAt + c(el) * sIn, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' }).finished.catch(() => null));
    }
    Promise.all(ends).then(() => {
      if (g !== gen.current) return; // a newer change took over
      for (const el of inn) { settle(el); el.style.opacity = ''; el.style.translate = ''; }
      for (const el of out) { settle(el); el.style.opacity = '0'; }
      show(only); setPrev(null);
    });
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  return { refs: refs.current, shown, settled: prev == null, prev };
}

/**
 * Graphics workstation UI atoms (operator interface only; the broadcast graphics are untouched).
 * One visual language for states, used everywhere:
 *   IN (visible on its source) · OUT (hidden) · DRAFT (prepared, not published) · LIVE data (goes straight out)
 *   OBS PGM (red = on air in OBS) · OBS PVW (green = OBS Studio Mode preview)
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export const C = {
  bg: '#09090a', panel: '#111113', head: '#17171a', line: 'rgba(255,255,255,.08)', text: '#e9e9ec', dim: 'rgba(233,233,236,.55)', faint: 'rgba(233,233,236,.32)',
  in: '#e5484d', draft: '#f5a524', ok: '#2fbf71', pvw: '#2fbf71', pgm: '#e5484d', brand: '#ff3b1f', sel: '#2a6df4',
} as const;

export const LABEL = "font-['Barlow_Condensed'] font-bold uppercase tracking-[0.12em]";

/** Visible / hidden state of a graphic on its own source. */
export function VisBadge({ out, small }: { out: boolean; small?: boolean }) {
  return (
    <span data-vis={out ? 'out' : 'in'} title={out ? 'OUT: hidden on its browser source' : 'IN: visible on its browser source'}
      className={`inline-flex items-center justify-center rounded-[2px] font-['Barlow_Condensed'] font-bold leading-none ${small ? 'h-[15px] min-w-[26px] px-1 text-[10.5px]' : 'h-[18px] min-w-[32px] px-1.5 text-[12px]'}`}
      style={out ? { border: `1px solid rgba(255,255,255,.22)`, color: C.faint } : { background: C.in, color: '#fff' }}>{out ? 'OUT' : 'IN'}</span>
  );
}
export function DraftBadge({ small, title = 'Prepared changes: not on the source until published' }: { small?: boolean; title?: string }) {
  return <span title={title} className={`inline-flex items-center rounded-[2px] font-['Barlow_Condensed'] font-bold leading-none text-black ${small ? 'h-[15px] px-1 text-[10.5px]' : 'h-[18px] px-1.5 text-[12px]'}`} style={{ background: C.draft }}>DRAFT</span>;
}
export function Dot({ color, title }: { color: string; title?: string }) {
  return <span title={title} className="inline-block h-[7px] w-[7px] flex-none rounded-full" style={{ background: color }} />;
}

/** Panel header: label, optional count / info, actions on the right. */
export function PanelHead({ label, info, children, style }: { label: string; info?: ReactNode; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="flex h-[28px] flex-none items-center gap-2 border-b px-2.5" style={{ background: C.head, borderColor: C.line, ...style }}>
      <span className={`${LABEL} text-[13px] text-white/85`}>{label}</span>
      {info != null && <span className="truncate text-[11px] text-white/40">{info}</span>}
      <span className="ml-auto flex items-center gap-1">{children}</span>
    </div>
  );
}

/** Compact workstation button. kind: default · primary (publish) · in · out · danger · ghost */
export function B({ children, onClick, disabled, kind = 'default', active, title, wide, h = 24, ...rest }: {
  children: ReactNode; onClick: () => unknown; disabled?: boolean; kind?: 'default' | 'primary' | 'in' | 'out' | 'danger' | 'ghost'; active?: boolean; title?: string; wide?: boolean; h?: number; [k: `data-${string}`]: string | undefined;
}) {
  const st: CSSProperties = kind === 'primary' ? { background: C.draft, color: '#000', borderColor: C.draft }
    : kind === 'in' ? (active ? { background: C.in, color: '#fff', borderColor: C.in } : { borderColor: 'rgba(229,72,77,.55)', color: '#ff9b9e' })
    : kind === 'out' ? (active ? { background: '#3a3a40', color: '#fff', borderColor: '#55555c' } : { borderColor: 'rgba(255,255,255,.18)' })
    : kind === 'danger' ? { borderColor: 'rgba(229,72,77,.5)', color: '#ff8a8d' }
    : kind === 'ghost' ? { borderColor: 'transparent', color: C.dim }
    : active ? { background: '#fff', color: '#000', borderColor: '#fff' } : { borderColor: 'rgba(255,255,255,.16)' };
  return (
    <button type="button" title={title} disabled={disabled} onClick={() => onClick()} {...rest}
      className={`inline-flex flex-none items-center justify-center gap-1 rounded-[2px] border px-2 font-['Barlow_Condensed'] text-[13px] font-bold uppercase tracking-[0.06em] transition-colors hover:brightness-125 disabled:pointer-events-none disabled:opacity-30 ${wide ? 'flex-1' : ''}`}
      style={{ height: h, ...st }}>{children}</button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[2px] border border-white/20 bg-white/[0.06] px-1 font-mono text-[10px] text-white/70">{children}</kbd>;
}

/**
 * Uniform fit of a fixed logical canvas into the window: one scale for both axes
 * (min(vw / W, vh / H)), centred. Follows window resizes and browser zoom changes.
 */
export function useFitCanvas(W: number, H: number) {
  const calc = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.min(vw / W, vh / H);
    return { s, x: Math.max(0, (vw - W * s) / 2), y: Math.max(0, (vh - H * s) / 2) };
  };
  const [f, setF] = useState(calc);
  useEffect(() => {
    const on = () => setF(calc());
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); window.visualViewport?.removeEventListener('resize', on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return f;
}

/** Column widths that the operator can drag; saved per browser. Deltas are divided by the canvas scale. */
export function useColumns(key: string, init: number[], min: number[], max: number[]) {
  const [w, setW] = useState<number[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); if (Array.isArray(v) && v.length === init.length && v.every(n => typeof n === 'number')) return v.map((n, i) => Math.max(min[i], Math.min(max[i], n))); } catch {}
    return init;
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(w)); } catch {} }, [key, w]);
  const drag = useRef<{ i: number; x: number; w: number; sign: 1 | -1; s: number } | null>(null);
  useEffect(() => {
    const mv = (e: PointerEvent) => { const d = drag.current; if (!d) return; const nw = Math.max(min[d.i], Math.min(max[d.i], d.w + d.sign * (e.clientX - d.x) / d.s)); setW(a => a.map((v, k) => (k === d.i ? Math.round(nw) : v))); };
    const up = () => { drag.current = null; document.body.style.cursor = ''; };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = useCallback((i: number, sign: 1 | -1, scale: number) => (e: React.PointerEvent) => { drag.current = { i, x: e.clientX, w: w[i], sign, s: scale }; document.body.style.cursor = 'col-resize'; e.preventDefault(); }, [w]);
  const reset = () => setW(init);
  return { w, start, reset };
}

/** A 5 px drag handle between two columns. */
export function Splitter({ onPointerDown, onDoubleClick }: { onPointerDown: (e: React.PointerEvent) => void; onDoubleClick?: () => void }) {
  return <div role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset" onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}
    className="group relative z-10 cursor-col-resize" style={{ background: C.bg }}><div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 group-hover:bg-white/40" /></div>;
}

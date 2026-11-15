/**
 * Studio Mode 2.0 UI kit. Operator interface only (the broadcast graphics are untouched).
 * Real-pixel layout (no scaled canvas): readable 13–15 px text, 34–40 px controls, resizable and collapsible
 * panels whose sizes are remembered per browser. Same state language as the Producer workstation
 * (IN red, DRAFT amber, OK green, OBS PGM red / PVW green) plus the Overdrive accent for Studio actions.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';

export const S = {
  bg: '#08080a', rail: '#0c0c0f', panel: '#111115', raised: '#16161b', card: '#1a1a20', line: 'rgba(255,255,255,.08)', line2: 'rgba(255,255,255,.14)',
  text: '#ececf0', dim: 'rgba(236,236,240,.62)', faint: 'rgba(236,236,240,.38)',
  accent: '#ff3b1f', accentSoft: 'rgba(255,59,31,.14)', ok: '#2fbf71', warn: '#f5a524', bad: '#e5484d', pgm: '#e5484d', pvw: '#2fbf71', info: '#4c8dff',
} as const;
export const COND = "font-['Barlow_Condensed'] font-bold uppercase";

// ------------------------------------------------------------------ persisted UI state (per browser, never shared)
export function useLocal<T>(key: string, init: T, ok: (v: unknown) => boolean = () => true) {
  const [v, setV] = useState<T>(() => { try { const r = localStorage.getItem(key); if (r != null) { const p = JSON.parse(r); if (ok(p)) return p as T; } } catch {} return init; });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV] as const;
}

/** Drag handle sizing a panel in real pixels. dir: which way a positive drag grows the panel. */
export function useDrag(value: number, set: (n: number) => void, min: number, max: number, axis: 'x' | 'y', dir: 1 | -1 = 1) {
  const d = useRef<{ p: number; v: number } | null>(null);
  useEffect(() => {
    const mv = (e: PointerEvent) => { const s = d.current; if (!s) return; const delta = (axis === 'x' ? e.clientX : e.clientY) - s.p; set(Math.round(Math.max(min, Math.min(max, s.v + dir * delta)))); };
    const up = () => { if (d.current) { d.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  }, [set, min, max, axis, dir]);
  return useCallback((e: RPointerEvent) => {
    d.current = { p: axis === 'x' ? e.clientX : e.clientY, v: value };
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
  }, [value, axis]);
}

export function Handle({ axis, onPointerDown, onDoubleClick }: { axis: 'x' | 'y'; onPointerDown: (e: RPointerEvent) => void; onDoubleClick?: () => void }) {
  return (
    <div role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} title="Drag to resize · double-click to collapse / restore" onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}
      className={`group relative z-20 flex-none ${axis === 'x' ? 'w-[6px] cursor-col-resize' : 'h-[6px] cursor-row-resize'}`} style={{ background: S.bg }} data-handle={axis}>
      <div className={`absolute bg-white/[0.07] transition-colors group-hover:bg-[#ff3b1f] ${axis === 'x' ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2'}`} />
    </div>
  );
}

// ------------------------------------------------------------------ 16:9 fit of the 1920×1080 renderers
export function Fit169({ children, className = '', style, onSize, onClick, w: W = 1920, h: H = 1080 }: { children: ReactNode; className?: string; style?: CSSProperties; onSize?: (w: number, h: number) => void; onClick?: () => void; w?: number; h?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [f, setF] = useState({ s: 0, w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current!; const on = () => { const r = el.getBoundingClientRect(); const s = Math.min(r.width / W, r.height / H); setF({ s, w: W * s, h: H * s }); onSize?.(W * s, H * s); };
    on(); const ro = new ResizeObserver(on); ro.observe(el); return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={`relative grid min-h-0 min-w-0 place-items-center overflow-hidden ${className}`} style={style} onClick={onClick}>
      <div className="relative overflow-hidden" style={{ width: f.w, height: f.h }}>
        {f.s > 0 && <div className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${f.s})` }}>{children}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ atoms
export function Btn({ children, onClick, kind = 'default', size = 'md', disabled, active, title, className = '', icon, ...rest }: {
  children?: ReactNode; onClick: () => unknown; kind?: 'default' | 'accent' | 'ghost' | 'danger' | 'go' | 'pgm' | 'draft'; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; active?: boolean; title?: string; className?: string; icon?: ReactNode;
  [k: `data-${string}`]: string | undefined;
}) {
  const h = size === 'sm' ? 'h-[34px] px-3 text-[14px]' : size === 'lg' ? 'h-[50px] px-6 text-[18px]' : 'h-[40px] px-4 text-[15.5px]';
  const st: CSSProperties = kind === 'accent' ? { background: S.accent, borderColor: S.accent, color: '#fff' }
    : kind === 'go' ? { background: S.ok, borderColor: S.ok, color: '#04140b' }
    : kind === 'pgm' ? { background: S.pgm, borderColor: S.pgm, color: '#fff' }
    : kind === 'draft' ? { background: S.warn, borderColor: S.warn, color: '#120c00' }
    : kind === 'danger' ? { borderColor: 'rgba(229,72,77,.55)', color: '#ff9a9d' }
    : kind === 'ghost' ? { borderColor: 'transparent', color: S.dim }
    : active ? { background: S.accentSoft, borderColor: S.accent, color: '#fff' } : { borderColor: S.line2, background: 'rgba(255,255,255,.035)' };
  return (
    <button type="button" title={title} disabled={disabled} onClick={() => onClick()} {...rest}
      className={`${COND} inline-flex flex-none items-center justify-center gap-2 whitespace-nowrap rounded-[6px] border tracking-[0.06em] transition hover:brightness-125 disabled:pointer-events-none disabled:opacity-35 ${h} ${className}`} style={st}>
      {icon}{children}
    </button>
  );
}

export function IconBtn({ children, onClick, title, active, disabled, size = 36 }: { children: ReactNode; onClick: () => unknown; title: string; active?: boolean; disabled?: boolean; size?: number }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={() => onClick()}
      className="grid flex-none place-items-center rounded-[6px] border text-white/75 transition hover:border-white/30 hover:text-white disabled:opacity-30"
      style={{ width: size, height: size, borderColor: active ? S.accent : S.line, background: active ? S.accentSoft : 'transparent' }}>{children}</button>
  );
}

const fieldCls = 'h-[40px] w-full min-w-0 rounded-[6px] border bg-[#0a0a0d] px-3 text-[15px] text-white outline-none transition focus:border-white/45 disabled:opacity-40';
export function Input({ value, onCommit, placeholder, ariaLabel, mono, className = '', type = 'text', warn }: { value: string; onCommit: (v: string) => unknown; placeholder?: string; ariaLabel: string; mono?: boolean; className?: string; type?: string; warn?: boolean }) {
  // Local while typing; commits on blur / Enter (one acknowledged command, not one per key).
  const [v, setV] = useState<string | null>(null);
  return <input aria-label={ariaLabel} type={type} value={v ?? value} placeholder={placeholder} onChange={e => setV(e.target.value)}
    onBlur={() => { if (v !== null && v !== value) onCommit(v); setV(null); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(null); (e.target as HTMLInputElement).blur(); } }}
    className={`${fieldCls} ${mono ? 'font-mono text-[13px]' : ''} ${className}`} style={{ borderColor: warn ? 'rgba(245,165,36,.7)' : S.line2 }} />;
}
export function Select({ value, onChange, options, ariaLabel, className = '', disabled }: { value: string; onChange: (v: string) => unknown; options: [string, string][]; ariaLabel: string; className?: string; disabled?: boolean }) {
  return (
    <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${fieldCls} pr-7 ${className}`} style={{ borderColor: S.line2 }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
export function Toggle({ on, onChange, label, title, disabled }: { on: boolean; onChange: (v: boolean) => unknown; label?: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title} disabled={disabled} onClick={() => onChange(!on)} className="inline-flex flex-none items-center gap-2.5 text-[14px] text-white/85 disabled:opacity-35">
      <span className="relative h-[22px] w-[40px] rounded-full transition-colors" style={{ background: on ? S.accent : 'rgba(255,255,255,.16)' }}>
        <span className="absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all" style={{ left: on ? 21 : 3 }} />
      </span>
      {label}
    </button>
  );
}
export function Seg<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => unknown; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex flex-none overflow-hidden rounded-[6px] border" style={{ borderColor: S.line2 }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => v !== value && onChange(v)} aria-pressed={v === value}
          className={`${COND} whitespace-nowrap tracking-[0.06em] transition ${size === 'sm' ? 'h-[34px] px-3 text-[14px]' : 'h-[40px] px-4 text-[15px]'} ${v === value ? 'text-white' : 'text-white/60 hover:bg-white/[0.06]'}`}
          style={v === value ? { background: S.accent } : undefined}>{l}</button>
      ))}
    </div>
  );
}
export function Pill({ children, tone = 'dim', title }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'dim' | 'accent' | 'info' | 'pgm' | 'pvw'; title?: string }) {
  const c = tone === 'ok' || tone === 'pvw' ? S.ok : tone === 'warn' ? S.warn : tone === 'bad' || tone === 'pgm' ? S.bad : tone === 'accent' ? S.accent : tone === 'info' ? S.info : 'rgba(255,255,255,.45)';
  return <span title={title} className={`${COND} inline-flex h-[24px] flex-none items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2 text-[12.5px] tracking-[0.08em]`} style={{ borderColor: `${c}66`, color: c, background: `${c}14` }}>{children}</span>;
}
export function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'dim' }) {
  return <span className="inline-block h-[8px] w-[8px] flex-none rounded-full" style={{ background: tone === 'ok' ? S.ok : tone === 'warn' ? S.warn : tone === 'bad' ? S.bad : 'rgba(255,255,255,.3)' }} />;
}
export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${COND} text-[13.5px] tracking-[0.14em] text-white/55 ${className}`}>{children}</div>;
}
export function Field({ label, children, hint, className = '' }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}><Label>{label}</Label>{children}{hint && <span className="text-[12.5px] text-white/45">{hint}</span>}</label>;
}

/** A titled card inside a section. */
export function Card({ title, icon, actions, children, className = '', bodyClass = 'p-5', fill = false, ...rest }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; /** fills its grid cell / flex parent and scrolls inside; otherwise keeps its content height */ fill?: boolean; [k: `data-${string}`]: string | undefined }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-[10px] border ${fill ? 'min-h-0' : 'flex-none'} ${className}`} style={{ background: S.panel, borderColor: S.line }} {...rest}>
      {title != null && (
        <header className="flex h-[54px] flex-none items-center gap-2.5 border-b px-5" style={{ borderColor: S.line }}>
          {icon && <span className="text-white/55">{icon}</span>}
          <h3 className={`${COND} text-[17px] tracking-[0.1em] text-white/90`}>{title}</h3>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Collapsible block in the inspector column. */
export function Fold({ id, title, icon, extra, children, defaultOpen = true }: { id: string; title: ReactNode; icon?: ReactNode; extra?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useLocal<boolean>(`od.studio.fold.${id}`, defaultOpen, v => typeof v === 'boolean');
  return (
    <section className="flex-none border-b" style={{ borderColor: S.line }} data-fold={id}>
      <div className="flex h-[50px] items-center gap-2 px-4">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {icon && <span className="text-white/50">{icon}</span>}
          <span className={`${COND} truncate text-[16px] tracking-[0.1em] text-white/90`}>{title}</span>
          <span className={`ml-1 text-white/40 transition-transform ${open ? '' : '-rotate-90'}`}>{I.chevron}</span>
        </button>
        {extra}
      </div>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/** Large view of anything (camera feed, portrait, graphic) over the workspace. Esc or a click outside closes it. */
export function LargeView({ title, onClose, children, w = 1920, h = 1080 }: { title: ReactNode; onClose: () => void; children: ReactNode; w?: number; h?: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-black/85 p-6" onClick={onClose} data-large-view>
      <div className="mb-3 flex flex-none items-center gap-3" onClick={e => e.stopPropagation()}>
        <span className={`${COND} text-[20px] tracking-[0.08em]`}>{title}</span>
        <Btn size="sm" className="ml-auto" onClick={onClose} icon={I.x}>Close (Esc)</Btn>
      </div>
      <div className="min-h-0 flex-1" onClick={e => e.stopPropagation()}><Fit169 w={w} h={h} className="h-full w-full">{children}</Fit169></div>
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="grid h-full min-h-[120px] place-items-center p-6 text-center"><div className="max-w-[520px] text-[14px] leading-relaxed text-white/50">{children}{action && <div className="mt-4 flex justify-center">{action}</div>}</div></div>;
}

// ------------------------------------------------------------------ icons (stroke, 18 px)
const ic = (d: ReactNode, s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
export const I = {
  scenes: ic(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>),
  talent: ic(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2" /><path d="M16 4.5a3 3 0 0 1 0 6M18 14.6c1.7.6 2.8 2.4 3 5.4" /></>),
  data: ic(<><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v6c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-6M4.5 11.5v6c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-6" /></>),
  auto: ic(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  rundown: ic(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.3" /><circle cx="4.5" cy="12" r="1.3" /><circle cx="4.5" cy="18" r="1.3" /></>),
  media: ic(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></>),
  audio: ic(<><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /></>),
  obs: ic(<><circle cx="12" cy="12" r="2.2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></>),
  audience: ic(<><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></>),
  file: ic(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>),
  search: ic(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, 16),
  star: ic(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />, 16),
  chevron: ic(<path d="m6 9 6 6 6-6" />, 16),
  left: ic(<path d="m15 6-6 6 6 6" />, 16),
  right: ic(<path d="m9 6 6 6-6 6" />, 16),
  up: ic(<path d="m6 15 6-6 6 6" />, 16),
  down: ic(<path d="m6 9 6 6 6-6" />, 16),
  plus: ic(<path d="M12 5v14M5 12h14" />, 16),
  x: ic(<path d="M6 6l12 12M18 6 6 18" />, 16),
  copy: ic(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>, 16),
  link: ic(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>, 16),
  refresh: ic(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>, 16),
  play: ic(<path d="m7 4 13 8-13 8V4Z" />, 16),
  stop: ic(<rect x="6" y="6" width="12" height="12" rx="1.5" />, 16),
  eye: ic(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>, 16),
  grid: ic(<><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>, 16),
  expand: ic(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />, 16),
  panel: ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>, 16),
  sidebar: ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>, 16),
  clock: ic(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>, 16),
  bolt: ic(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />, 16),
  check: ic(<path d="m5 12 4.5 4.5L19 7" />, 16),
  warn: ic(<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17.5v.01" /></>, 16),
  drag: ic(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>, 16),
  trash: ic(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />, 16),
  mic: ic(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>, 16),
  cam: ic(<><rect x="3" y="7" width="13" height="10" rx="2" /><path d="m16 11 5-3v8l-5-3" /></>, 16),
  logout: ic(<><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></>, 16),
  flask: ic(<><path d="M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></>, 16),
};

/**
 * Resolution-aware size for the reused workstation panels (designed for a scaled 1920×1480 canvas): bigger on
 * 1440p and wider screens, never smaller than the 1080p size. Follows window resizes.
 */
export function useUiScale(base = 1.2) {
  const calc = () => (typeof window === 'undefined' ? base : base * Math.max(1, Math.min(1.3, window.innerWidth / 1920)));
  const [z, setZ] = useState(calc);
  useEffect(() => { const on = () => setZ(calc()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return Math.round(z * 100) / 100;
}

export const fmtClock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`; };
export const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

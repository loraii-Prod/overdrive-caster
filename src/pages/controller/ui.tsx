import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Switch({ on, onChange, label, disabled, title }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={() => onChange(!on)}
      className={`group flex items-center gap-2.5 text-[13px] font-medium ${disabled ? 'opacity-40' : ''}`}>
      <span className={`relative h-[18px] w-[32px] flex-none rounded-full transition-colors duration-200 ${on ? 'bg-white' : 'bg-white/15'}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all duration-200 ${on ? 'left-[16px] bg-[#111]' : 'left-[2px] bg-white/70'}`} />
      </span>
      {label && <span className={on ? 'text-white' : 'text-white/55'}>{label}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-md border border-white/10 bg-black/30 p-[3px]">
      {options.map(o => (
        <button key={o.value} type="button" title={o.hint} onClick={() => onChange(o.value)}
          className={`rounded-[4px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ${size === 'sm' ? 'px-2.5 py-1 text-[10.5px]' : 'px-3.5 py-1.5 text-[11.5px]'} ${value === o.value ? 'bg-white text-[#111]' : 'text-white/60 hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text input that doesn't fight remote updates while focused. */
export function TextField({ value, onChange, placeholder, list, className = '', mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; list?: string; className?: string; mono?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(value); }, [value]);
  return (
    <input className={`input w-full min-w-0 ${mono ? 'font-mono text-[12px]' : ''} ${className}`} value={local} placeholder={placeholder} list={list} spellCheck={false}
      onFocus={() => (focused.current = true)}
      onBlur={() => { focused.current = false; setLocal(value); }}
      onChange={e => { setLocal(e.target.value); onChange(e.target.value); }} />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/45">{children}</div>;
}

export function Panel({ title, right, children, className = '' }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-white/[0.08] bg-[#171717] ${className}`}>
      <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'off' }) {
  const c = { ok: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-500', off: 'bg-white/25' }[tone];
  return <span className={`inline-block h-2 w-2 flex-none rounded-full ${c}`} />;
}

/** Two-step button for destructive actions (no browser dialogs during a show). */
export function ConfirmButton({ children, onConfirm, className = 'btn-sm', confirmLabel = 'Confirm?' }: { children: ReactNode; onConfirm: () => void; className?: string; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 2500); return () => clearTimeout(t); }, [armed]);
  return (
    <button type="button" className={`${className} ${armed ? '!border-red-400/60 !text-red-300' : ''}`}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirmLabel : children}
    </button>
  );
}

export function CopyField({ value, label }: { value: string; label?: ReactNode }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); }
    catch { ref.current?.select(); document.execCommand?.('copy'); }
    setDone(true); setTimeout(() => setDone(false), 1200);
  };
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div className="flex gap-1.5">
        <input ref={ref} readOnly value={value} className="input min-w-0 flex-1 font-mono text-[11px] text-white/70" onFocus={e => e.target.select()} />
        <button type="button" className="btn-sm w-16" onClick={copy}>{done ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

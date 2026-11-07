import { AnimatePresence, motion } from 'motion/react';
import type { RunOfShow } from '../../shared/types';
import { formatRemaining } from './show/parts';
import { EASE } from '../lib/motion';

const fmtElapsed = (ms: number) => formatRemaining(Math.max(0, ms));

/**
 * Run of show as casters see it: producer message, the segment that's on now
 * (with elapsed / remaining time), what's next, and the full rundown.
 */
export function RosView({ ros, now, compact = false }: { ros: RunOfShow; now: number; compact?: boolean }) {
  const cur = ros.current;
  const item = cur != null ? ros.items[cur] : null;
  const next = ros.items[cur == null ? 0 : cur + 1] ?? null;
  const elapsed = ros.startedAt ? now - ros.startedAt : 0;
  const planned = item?.minutes ? item.minutes * 60_000 : 0;
  const over = planned > 0 && elapsed > planned;
  const msgFresh = ros.message && now - ros.message.at < 10 * 60_000;

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {msgFresh && ros.message && (
          <motion.div key={ros.message.at} initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}
            className="rounded-lg bg-amber-400 px-5 py-4 text-black">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.24em] opacity-60">From the producer · {new Date(ros.message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div className={`mt-1 font-display font-bold uppercase leading-tight ${compact ? 'text-[22px]' : 'text-[34px]'}`}>{ros.message.text}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-[1.3fr_1fr] gap-3">
        <div className={`rounded-lg border p-4 ${item ? 'border-[#e5484d]/60 bg-[#e5484d]/10' : 'border-white/10 bg-white/[0.03]'}`}>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.24em] text-white/50">Now</div>
          {item ? (
            <>
              <div className={`mt-1 font-display font-semibold leading-tight ${compact ? 'text-[19px]' : 'text-[26px]'}`}>{item.title || 'Untitled segment'}</div>
              {item.who && <div className="mt-1 text-[13px] text-white/60">{item.who}</div>}
              <div className="mt-3 flex items-baseline gap-3">
                <span className={`font-display font-semibold tabular-nums ${compact ? 'text-[24px]' : 'text-[34px]'} ${over ? 'text-[#ff6b6b]' : ''}`}>{fmtElapsed(elapsed)}</span>
                {planned > 0 && <span className="text-[12px] text-white/45">{over ? `${fmtElapsed(elapsed - planned)} over` : `${fmtElapsed(planned - elapsed)} left of ${item.minutes} min`}</span>}
              </div>
              {item.notes && <div className="mt-2 text-[13px] leading-relaxed text-white/70">{item.notes}</div>}
            </>
          ) : (
            <div className="mt-1 text-[15px] text-white/45">Show hasn't started</div>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.24em] text-white/50">Next</div>
          {next ? (
            <>
              <div className={`mt-1 font-display font-semibold leading-tight ${compact ? 'text-[16px]' : 'text-[20px]'}`}>{next.title}</div>
              <div className="mt-1 text-[12.5px] text-white/50">{[next.time, next.minutes ? `${next.minutes} min` : '', next.who].filter(Boolean).join(' · ')}</div>
            </>
          ) : <div className="mt-1 text-[14px] text-white/40">End of show</div>}
        </div>
      </div>

      {!compact && (
        <div className="overflow-hidden rounded-lg border border-white/10">
          {ros.items.map((it, i) => {
            const state = cur == null ? 'todo' : i < cur ? 'done' : i === cur ? 'now' : 'todo';
            return (
              <div key={it.id} className={`grid grid-cols-[64px_1fr_auto] items-start gap-3 border-b border-white/[0.06] px-4 py-2.5 last:border-b-0 ${state === 'now' ? 'bg-[#e5484d]/15' : ''} ${state === 'done' ? 'opacity-40' : ''}`}>
                <span className="pt-[1px] font-display text-[13px] font-semibold text-white/55">{it.time || '—'}</span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{it.title}</div>
                  {(it.who || it.notes) && <div className="mt-0.5 text-[12px] text-white/50">{[it.who, it.notes].filter(Boolean).join(' · ')}</div>}
                </div>
                <span className="text-[11.5px] text-white/40">{state === 'now' ? <b className="text-[#ff8a8d]">ON NOW</b> : it.minutes ? `${it.minutes} min` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

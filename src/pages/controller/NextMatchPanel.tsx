import type { Show } from '../../../shared/types';
import type { QuickOp } from '../../../shared/protocol';
import type { BnlData } from '../../components/show/BnlGraphics';
import { fmtLeft, resolveNextMatch } from '../../components/show/NextMatch';
import { Label, Segmented, Switch, TextField } from './ui';

/** Always-on "next match" counter. Changes are instant (no TAKE). */
export function NextMatchPanel({ live, quick, bnl, now }: { live: Show; quick: (op: QuickOp) => void; bnl: BnlData | null; now: number }) {
  const nm = live.nextMatch;
  const set = (patch: Partial<Show['nextMatch']>) => quick({ k: 'next-match', patch });
  const auto = resolveNextMatch({ ...live, nextMatch: { ...nm, label: '', time: '' } }, bnl, now);
  const cur = resolveNextMatch(live, bnl, now);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch on={nm.enabled} onChange={v => set({ enabled: v })} label="Show on every scene" />
        <Segmented size="sm" value={nm.corner} onChange={v => set({ corner: v })}
          options={[{ value: 'tl', label: 'Top left' }, { value: 'tr', label: 'Top right' }, { value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' }]} />
        <span className="text-[12px] text-white/50">
          {cur ? <>On air: <b className="text-white/80">{cur.label}</b> {cur.time && `at ${cur.time}`} · {fmtLeft(cur.target - now) ?? 'starting now'}</> : 'Nothing upcoming today (hidden)'}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-end">
        <div className="min-w-0"><Label>Manual match name</Label><TextField value={nm.label} onChange={v => set({ label: v })} placeholder={auto ? `auto: ${auto.label}` : 'e.g. Lower Final'} /></div>
        <div><Label>Start time</Label><input className="input w-full" type="time" value={nm.time} onChange={e => set({ time: e.target.value })} /></div>
        <div className="flex gap-1.5">
          {[5, 10, 15].map(m => (
            <button key={m} type="button" className="btn-sm" onClick={() => { const d = new Date(Date.now() + m * 60_000); set({ time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }); }}>+{m} min</button>
          ))}
          {(nm.label || nm.time) && <button type="button" className="btn-sm" onClick={() => set({ label: '', time: '' })}>Back to auto</button>}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-white/40">
        Auto picks the first playoff match that isn't done (times from Tournament admin → Playoffs), otherwise the next entry of the day schedule. Uses this PC's clock. Also available alone as /output/nextmatch.
      </p>
    </div>
  );
}

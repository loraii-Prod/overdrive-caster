/**
 * Overdrive 3.0 · BROADCAST HEALTH (Studio → Health, and the Producer header's HEALTH indicator).
 * What is broken right now, with a recovery action, and the pre-show checklist. Computed from the shared state
 * (shared/health.ts): every operator sees the same answer.
 */
import { useState, type ReactNode } from 'react';
import type { ControllerState } from '../../../shared/types';
import { AREA_LABEL, checklist, computeHealth, worst, type Fix, type HealthItem, type Tone } from '../../../shared/health';
import { usePerfReport } from '../../lib/perfStore';
import type { Run } from '../producer/modules';
import type { AudCtx } from '../producer/audienceModules';
import { Btn, COND, Card, I, Pill, S } from './kit';

const toneC = (t: Tone) => (t === 'ok' ? S.ok : t === 'warn' ? S.warn : t === 'bad' ? S.bad : 'rgba(255,255,255,.3)');
const toneWord = (t: Tone) => (t === 'ok' ? 'OK' : t === 'warn' ? 'Check' : t === 'bad' ? 'Problem' : 'Off');

/** Where a "go" fix leads (Studio section + page), for consoles that are not the Studio page itself. */
export function openStudioAt(go: { section: string; tab?: string }) {
  try {
    localStorage.setItem('od.studio.section', JSON.stringify(go.section));
    if (go.tab) { const t = JSON.parse(localStorage.getItem('od.studio.tabs') ?? '{}'); localStorage.setItem('od.studio.tabs', JSON.stringify({ ...t, [go.section]: go.tab })); }
  } catch { /* storage unavailable: Studio opens on its last section */ }
}

function FixBtn({ fix, run, go, size = 'sm' }: { fix: Fix; run: Run; go: (s: string, t?: string) => void; size?: 'sm' | 'md' }) {
  return <Btn size={size} kind={fix.cmd ? 'accent' : 'default'} onClick={() => (fix.cmd ? run(fix.cmd, fix.label) : fix.go ? go(fix.go.section, fix.go.tab) : null)} data-health-fix={fix.label}>{fix.label}</Btn>;
}

export function HealthSection({ st, run, conn, rtt, aud, go }: { st: ControllerState; run: Run; conn: string; rtt: number | null; aud?: AudCtx; go: (section: string, tab?: string) => void }) {
  const perf = usePerfReport();
  const items = computeHealth({ st, conn, rtt, perf, aud: aud?.priv ?? null });
  const list = checklist(st, aud?.priv ?? null);
  const w = worst(items), done = list.filter(c => c.done).length, required = list.filter(c => !c.optional), reqDone = required.filter(c => c.done).length;
  const order: Tone[] = ['bad', 'warn', 'ok', 'off'];
  return (
    <div className="grid h-full min-h-0 gap-3" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(380px, 1fr)' }} data-health>
      <Card fill title="Broadcast health" icon={I.warn} bodyClass="overflow-y-auto"
        actions={<><Pill tone={w === 'ok' ? 'ok' : w === 'warn' ? 'warn' : 'bad'}>{w === 'ok' ? 'All systems OK' : `${items.filter(i => i.tone === 'bad').length} problem${items.filter(i => i.tone === 'bad').length === 1 ? '' : 's'} · ${items.filter(i => i.tone === 'warn').length} to check`}</Pill>
          <Btn size="sm" onClick={() => run({ c: 'reload-outputs' }, 'Reload every browser source')} title="Every browser source reloads and resyncs (talent does not reconnect)">Reload sources</Btn></>}>
        <div className="divide-y" style={{ borderColor: S.line }}>
          {[...items].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone)).map((i, n) => <Row key={n} i={i} run={run} go={go} />)}
        </div>
      </Card>
      <Card fill title="Pre-show checklist" icon={I.check} bodyClass="overflow-y-auto p-2" actions={<Pill tone={reqDone === required.length ? 'ok' : 'warn'}>{reqDone}/{required.length} required · {done}/{list.length}</Pill>} data-checklist>
        {list.map(c => (
          <button key={c.id} type="button" onClick={() => c.go && go(c.go.section, c.go.tab)} disabled={!c.go} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left transition hover:bg-white/[0.04] disabled:hover:bg-transparent" data-check={c.id} data-done={c.done ? '1' : '0'}>
            <span className="grid h-[24px] w-[24px] flex-none place-items-center rounded-full border text-[13px]" style={c.done ? { background: S.ok, borderColor: S.ok, color: '#04140b' } : { borderColor: c.optional ? S.line2 : S.warn, color: S.warn }}>{c.done ? '✓' : ''}</span>
            <span className="min-w-0 flex-1"><span className={`text-[14.5px] ${c.done ? 'text-white/60' : 'text-white'}`}>{c.label}</span>{c.optional && <span className="ml-2 text-[12px] text-white/35">optional</span>}
              {c.detail && <span className="block truncate text-[12.5px] text-white/40">{c.detail}</span>}</span>
            {c.go && !c.done && <span className="text-white/35">{I.right}</span>}
          </button>
        ))}
      </Card>
    </div>
  );
}

function Row({ i, run, go, compact }: { i: HealthItem; run: Run; go: (s: string, t?: string) => void; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? 'px-3 py-2' : 'px-5 py-3'}`} style={{ borderColor: S.line }} data-health-item={i.area} data-tone={i.tone}>
      <span className="h-[10px] w-[10px] flex-none rounded-full" style={{ background: toneC(i.tone), boxShadow: i.tone === 'bad' ? `0 0 0 4px ${S.bad}33` : undefined }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className={`${COND} text-[14.5px] tracking-[0.08em]`}>{i.label}</span>{!compact && AREA_LABEL[i.area].toLowerCase() !== i.label.toLowerCase() && <span className="text-[12px] text-white/35">{AREA_LABEL[i.area]}</span>}<span className={`${COND} text-[12px] tracking-[0.1em]`} style={{ color: toneC(i.tone) }}>{toneWord(i.tone)}</span></div>
        <div className={`text-[13px] ${i.tone === 'off' ? 'text-white/40' : 'text-white/70'} ${compact ? 'line-clamp-2' : ''}`}>{i.detail}</div>
      </div>
      {i.fix && (i.tone === 'bad' || i.tone === 'warn' || i.tone === 'off') && <FixBtn fix={i.fix} run={run} go={go} />}
    </div>
  );
}

/** Producer header: one dot for the whole show, and the problems with their recovery actions on click. */
export function HealthIndicator({ st, run, conn, rtt, aud, onGo, render }: { st: ControllerState; run: Run; conn: string; rtt: number | null; aud?: AudCtx; onGo: (section: string, tab?: string) => void; render: (tone: Tone, count: number, toggle: () => void) => ReactNode }) {
  const perf = usePerfReport();
  const [open, setOpen] = useState(false);
  const items = computeHealth({ st, conn, rtt, perf, aud: aud?.priv ?? null });
  const w = worst(items), alerts = items.filter(i => i.tone === 'bad' || i.tone === 'warn');
  return (
    <>
      {render(w, alerts.length, () => setOpen(v => !v))}
      {open && (
        <div className="fixed right-3 top-[1118px] z-[60] w-[640px] overflow-hidden rounded-[6px] border shadow-2xl" style={{ background: S.panel, borderColor: S.line2 }} data-health-popover>
          <div className="flex h-[40px] items-center gap-2 border-b px-3" style={{ borderColor: S.line }}><span className={`${COND} text-[15px] tracking-[0.1em]`}>Broadcast health</span>
            <Pill tone={w === 'ok' ? 'ok' : w === 'warn' ? 'warn' : 'bad'}>{alerts.length ? `${alerts.length} to look at` : 'All OK'}</Pill>
            <button type="button" className="ml-auto text-white/60" onClick={() => setOpen(false)} title="Close">{I.x}</button></div>
          <div className="max-h-[300px] divide-y overflow-y-auto" style={{ borderColor: S.line }}>
            {(alerts.length ? alerts : items.filter(i => i.tone === 'ok')).map((i, n) => <Row key={n} i={i} run={run} go={(s, t) => { setOpen(false); onGo(s, t); }} compact />)}
          </div>
        </div>
      )}
    </>
  );
}

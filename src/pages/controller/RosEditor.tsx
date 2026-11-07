import { useEffect, useRef, useState } from 'react';
import type { RosItem, RunOfShow } from '../../../shared/types';
import { ROS_MESSAGES } from '../../../shared/defaults';
import { RosView } from '../../components/RosView';
import { formatRemaining } from '../../components/show/parts';
import { ConfirmButton, CopyField } from './ui';

type Send = (m: any) => void;

/** One-line run-of-show control shown under the monitors in every section. */
export function RosBar({ ros, now, send, onOpen }: { ros: RunOfShow; now: number; send: Send; onOpen: () => void }) {
  const cur = ros.current;
  const item = cur != null ? ros.items[cur] : null;
  const next = ros.items[cur == null ? 0 : cur + 1];
  const elapsed = ros.startedAt ? now - ros.startedAt : 0;
  const over = !!item?.minutes && elapsed > item.minutes * 60_000;
  return (
    <div className="flex items-center gap-4 rounded-md border border-white/10 bg-[#171717] px-4 py-2.5">
      <button type="button" className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-white" onClick={onOpen}>Run of show</button>
      <div className="min-w-0 flex-1 truncate text-[13px]">
        {item ? (
          <>
            <span className="mr-2 rounded-[3px] bg-[#e5484d] px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.16em]">NOW</span>
            <b>{item.title}</b>
            <span className={`ml-2 tabular-nums ${over ? 'text-[#ff6b6b]' : 'text-white/50'}`}>{formatRemaining(elapsed)}{item.minutes ? ` / ${item.minutes}:00` : ''}</span>
            {next && <span className="ml-4 text-white/40">Next: {next.title}</span>}
          </>
        ) : <span className="text-white/40">Not started{next ? ` · first: ${next.title}` : ''}</span>}
      </div>
      <button type="button" className="btn-sm" disabled={cur == null || cur === 0} onClick={() => send({ t: 'ros-go', index: (cur ?? 1) - 1 })}>◂ Prev</button>
      <button type="button" className="btn-sm !border-white !bg-white !text-[#111]" disabled={cur != null && cur >= ros.items.length - 1}
        onClick={() => send({ t: 'ros-go', index: cur == null ? 0 : cur + 1 })}>{cur == null ? 'Start show' : 'Next ▸'}</button>
    </div>
  );
}

const blank = (): RosItem => ({ id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, time: '', title: 'New segment', minutes: 0, who: '', notes: '' });

/** Full run-of-show section: rundown editor, caster messages, crew link and caster preview. */
export function RosEditor({ ros, now, crewUrl, otherUrls = [], send }: { ros: RunOfShow; now: number; crewUrl: string; otherUrls?: string[]; send: Send }) {
  const [items, setItems] = useState<RosItem[]>(ros.items);
  const editing = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { if (Date.now() - editing.current > 800) setItems(ros.items); }, [ros.items]);
  const commit = (next: RosItem[]) => {
    editing.current = Date.now();
    setItems(next);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send({ t: 'ros-items', items: next }), 300);
  };
  const upd = (i: number, p: Partial<RosItem>) => commit(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; commit(n); };
  const [msg, setMsg] = useState('');

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">Message the casters</h2>
          <span className="text-[11px] text-white/35">Shows big on their camera page and the crew page</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ROS_MESSAGES.map(m => <button key={m} type="button" className="btn-sm" onClick={() => send({ t: 'ros-message', text: m })}>{m}</button>)}
          {ros.message && <button type="button" className="btn-sm !text-white/50" onClick={() => send({ t: 'ros-message', text: '' })}>Clear</button>}
        </div>
        <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); if (msg.trim()) { send({ t: 'ros-message', text: msg.trim() }); setMsg(''); } }}>
          <input className="input min-w-0 flex-1" placeholder="Type a message and press Enter…" value={msg} onChange={e => setMsg(e.target.value)} />
          <button type="submit" className="btn-sm" disabled={!msg.trim()}>Send</button>
        </form>
        {ros.message && <p className="mt-2 text-[11.5px] text-amber-300/80">Showing: “{ros.message.text}”</p>}
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">Rundown</h2>
          <span className="text-[11px] text-white/35">Click ▶ to make a segment “now”</span>
        </div>
        <div className="mb-1.5 grid grid-cols-[36px_72px_minmax(0,1.6fr)_64px_minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
          <span /> <span>Time</span> <span>Segment</span> <span>Min</span> <span>Who</span> <span>Notes</span> <span />
        </div>
        <div className="space-y-1.5">
          {items.map((it, i) => {
            const isNow = ros.current === i;
            return (
              <div key={it.id} className={`grid grid-cols-[36px_72px_minmax(0,1.6fr)_64px_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-1.5 rounded-md p-1 ${isNow ? 'bg-[#e5484d]/15 ring-1 ring-[#e5484d]/60' : ''}`}>
                <button type="button" title="Make this segment now" onClick={() => send({ t: 'ros-go', index: i })}
                  className={`h-8 rounded-md text-[12px] ${isNow ? 'bg-[#e5484d] text-white' : 'border border-white/14 text-white/60 hover:bg-white/10'}`}>▶</button>
                <input className="input h-8 px-2" value={it.time} placeholder="18:30" onChange={e => upd(i, { time: e.target.value })} />
                <input className="input h-8" value={it.title} onChange={e => upd(i, { title: e.target.value })} />
                <input className="input h-8 px-2" type="number" min={0} value={it.minutes || ''} placeholder="–" onChange={e => upd(i, { minutes: Math.max(0, +e.target.value || 0) })} />
                <input className="input h-8" value={it.who} placeholder="Who" onChange={e => upd(i, { who: e.target.value })} />
                <input className="input h-8" value={it.notes} placeholder="Notes for casters" onChange={e => upd(i, { notes: e.target.value })} />
                <div className="flex gap-1">
                  <button type="button" className="btn-xs" onClick={() => move(i, -1)}>▲</button>
                  <button type="button" className="btn-xs" onClick={() => move(i, 1)}>▼</button>
                  <button type="button" className="btn-xs" onClick={() => commit(items.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-sm" onClick={() => commit([...items, blank()])}>+ Add segment</button>
          {ros.current != null && <button type="button" className="btn-sm" onClick={() => send({ t: 'ros-go', index: null })}>End / reset show</button>}
        </div>
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">Share with casters & crew</h2>
          <span className="text-[11px] text-white/35">Read-only</span>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><CopyField value={crewUrl} label="Crew link: run of show + what's on air (no camera needed)" /></div>
          <ConfirmButton onConfirm={() => send({ t: 'regen-crew-key' })} confirmLabel="Replace link?">New link</ConfirmButton>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
          Remote casters already see the run of show and your messages on their camera link. Use the crew link for anyone else: co-casters on site, observers, admins.
          The link uses this PC's network address, so it works for anyone on the same network.
        </p>
        {otherUrls.length > 0 && (
          <p className="mt-1 text-[11px] text-white/35">If it doesn't open for them, try another address of this PC: {otherUrls.map(u => u.replace('http://', '')).join(' · ')}</p>
        )}
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">What casters see</h2>
        <RosView ros={{ ...ros, items }} now={now} compact />
      </section>
    </div>
  );
}

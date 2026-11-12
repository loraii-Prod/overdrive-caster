/**
 * Graphics Rundown (Live Graphics Mode, area D). Items reference a graphics instance and the data it carries
 * (a preset, a snapshot, or the graphic's own data). IN / UPDATE / OUT act inside that graphic's own browser
 * source through the engine (acked); nothing here switches OBS. The list, order and cue are server state.
 */
import { useEffect, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { ProducerCmd } from '../../../shared/engine';
import type { GfxInstance } from '../../../shared/gfx';
import type { RundownItem } from '../../../shared/rundown';
import type { Ack } from './modules';
import { B, C, DraftBadge, Kbd, PanelHead } from './ws';

type Run = (c: ProducerCmd, l: string) => Promise<Ack>;

function Item({ it, i, n, g, cued, run, onSelect, selected }: { it: RundownItem; i: number; n: number; g?: GfxInstance; cued: boolean; run: Run; onSelect: (id: string) => void; selected: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  const out = !g || g.anim.action === 'out';
  const data = it.preset ? `preset · ${it.preset}` : it.data ? 'snapshot' : 'graphic data';
  const missingPreset = !!(it.preset && g && !g.presets.some(q => q.name === it.preset));
  return (
    <div data-rundown-row={it.id} data-rundown-gfx={it.gfx} data-cued={cued ? '1' : '0'} draggable
      onDragStart={e => { e.dataTransfer.setData('text/od-rundown', it.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { if (e.dataTransfer.types.includes('text/od-rundown')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={e => { const id = e.dataTransfer.getData('text/od-rundown'); if (id && id !== it.id) run({ c: 'rd-move', id, to: i }, 'Rundown order'); }}
      className="group flex items-center gap-1.5 border-b px-1.5" style={{ height: 34, borderColor: C.line, background: cued ? 'rgba(245,165,36,.10)' : selected ? 'rgba(42,109,244,.14)' : undefined, boxShadow: cued ? `inset 3px 0 0 ${C.draft}` : undefined }}>
      <span className="w-[18px] cursor-grab text-center font-mono text-[10.5px] text-white/35" title="Drag to reorder">{i + 1}</span>
      <button type="button" title={cued ? 'Cued: TAKE NEXT plays this item' : 'Cue this item'} onClick={() => run({ c: 'rd-cue', id: cued ? null : it.id }, cued ? 'Cue cleared' : `Cued: ${it.label}`)}
        className="w-[14px] text-[11px]" style={{ color: cued ? C.draft : 'rgba(255,255,255,.2)' }}>▶</button>
      <div className="min-w-0 flex-1" onDoubleClick={() => setEdit(it.label)}>
        {edit != null
          ? <input autoFocus aria-label="Item name" value={edit} onChange={e => setEdit(e.target.value)} onBlur={() => { if (edit.trim() && edit !== it.label) run({ c: 'rd-edit', id: it.id, label: edit }, 'Rename item'); setEdit(null); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null); }} className="w-full rounded-[2px] border border-white/20 bg-black px-1 text-[12px]" />
          : <button type="button" className="block w-full truncate text-left text-[12.5px] font-semibold text-white/90" title="Select its graphic · double-click to rename" onClick={() => onSelect(it.gfx)}>{it.label}</button>}
        <div className="flex items-center gap-1.5 truncate text-[10.5px] text-white/40">
          <span className="truncate">{g ? g.name : 'graphic deleted'}</span><span>·</span><span style={{ color: missingPreset ? C.draft : undefined }}>{missingPreset ? 'preset missing' : data}</span>
        </div>
      </div>
      {g?.draft && <DraftBadge small title="Its graphic has prepared changes" />}
      <span className="flex gap-0.5">
        <B h={22} kind="in" active={!out} title={out ? 'Take IN with its data' : 'Visible now: IN again replays with its data'} disabled={!g || missingPreset} onClick={() => run({ c: 'rd-take', id: it.id, action: 'in' }, `${it.label} IN`)} data-rd-in={it.id}>In</B>
        <B h={22} disabled={!g || missingPreset} onClick={() => run({ c: 'rd-take', id: it.id, action: 'update' }, `${it.label} UPDATE`)} title="Publish this item's data into its graphic (UPDATE animation if visible)">Upd</B>
        <B h={22} kind="out" disabled={!g || out} onClick={() => run({ c: 'rd-take', id: it.id, action: 'out' }, `${it.label} OUT`)} data-rd-out={it.id}>Out</B>
      </span>
      <span className="flex flex-col opacity-40 group-hover:opacity-100">
        <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => run({ c: 'rd-move', id: it.id, to: i - 1 }, 'Rundown order')} className="h-[13px] text-[8px] leading-none disabled:opacity-20">▲</button>
        <button type="button" aria-label="Move down" disabled={i === n - 1} onClick={() => run({ c: 'rd-move', id: it.id, to: i + 1 }, 'Rundown order')} className="h-[13px] text-[8px] leading-none disabled:opacity-20">▼</button>
      </span>
      <button type="button" aria-label={`Remove ${it.label}`} title="Remove from the rundown" onClick={() => run({ c: 'rd-remove', id: it.id }, `Removed ${it.label}`)} className="w-[14px] text-[12px] text-white/30 hover:text-white">✕</button>
    </div>
  );
}

export function RundownPanel({ st, run, sel, onSelect }: { st: ControllerState; run: Run; sel: GfxInstance | undefined; onSelect: (gfxId: string) => void }) {
  const rd = st.rundown ?? { items: [], cue: null };
  const gs = st.graphics ?? [];
  const [mode, setMode] = useState<'live' | 'snapshot' | string>('live');
  useEffect(() => setMode('live'), [sel?.id]); // a preset choice belongs to the graphic it was made for
  const cuedItem = rd.items.find(x => x.id === rd.cue);
  const add = () => sel && run(mode === 'live' ? { c: 'rd-add', gfx: sel.id } : mode === 'snapshot' ? { c: 'rd-add', gfx: sel.id, snapshot: true } : { c: 'rd-add', gfx: sel.id, preset: mode.slice(2) }, `Rundown + ${sel.name}`);
  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.panel }} data-rundown>
      <PanelHead label="Rundown" info={`${rd.items.length} item${rd.items.length === 1 ? '' : 's'}${cuedItem ? ` · next: ${cuedItem.label}` : ''}`}>
        <B h={22} kind="primary" disabled={!cuedItem} onClick={() => run({ c: 'rd-next' }, `TAKE NEXT${cuedItem ? `: ${cuedItem.label}` : ''}`)} title="Take the cued item IN, cue the next (F8)" data-rd-next>Take next <Kbd>F8</Kbd></B>
      </PanelHead>
      <div className="flex h-[30px] flex-none items-center gap-1 border-b px-1.5" style={{ borderColor: C.line }}>
        <span className="min-w-0 flex-1 truncate text-[11px] text-white/50">{sel ? <>Add <b className="text-white/80">{sel.name}</b> with</> : 'Select a graphic to add it'}</span>
        <select aria-label="Item data" disabled={!sel} value={mode} onChange={e => setMode(e.target.value)} className="h-[22px] max-w-[130px] rounded-[2px] border border-white/15 bg-black px-1 text-[11px]">
          <option value="live">its data at take</option>
          <option value="snapshot">a snapshot now</option>
          {sel?.presets.map(q => <option key={q.name} value={`p:${q.name}`}>preset · {q.name}</option>)}
        </select>
        <B h={22} disabled={!sel} onClick={add} data-rd-add>+ Add</B>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rd.items.map((it, i) => <Item key={it.id} it={it} i={i} n={rd.items.length} g={gs.find(g => g.id === it.gfx)} cued={rd.cue === it.id} run={run} onSelect={onSelect} selected={sel?.id === it.gfx} />)}
        {!rd.items.length && <div className="p-3 text-[11.5px] leading-relaxed text-white/35">Build the show's graphics sequence: select a graphic in the library, choose its data (as it is when taken, a snapshot of what is prepared now, or a preset) and add it. <b className="text-white/55">Take next</b> plays the cued item and cues the following one.</div>}
      </div>
      {rd.items.length > 0 && (
        <div className="flex h-[26px] flex-none items-center gap-2 border-t px-2 text-[10.5px] text-white/35" style={{ borderColor: C.line }}>
          <span>Drag rows to reorder · double-click to rename</span>
          <button type="button" className="ml-auto underline hover:text-white" onClick={() => { if (confirm('Remove every item from the rundown?')) run({ c: 'rd-clear' }, 'Rundown cleared'); }}>Clear</button>
        </div>
      )}
    </div>
  );
}

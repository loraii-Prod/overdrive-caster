/**
 * Graphics Inspector, Rundown and Package library — generated from the package declarations (shared/gfx.ts).
 * No control here is written for a specific graphic: properties, bindings, animations and commands all come
 * from the package, and every action is an acknowledged engine command.
 */
import { useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { ProducerCmd, EngineState } from '../../../shared/engine';
import { PACKAGES, pkgById, type GfxInstance, type PackageDef, type PropDef } from '../../../shared/gfx';
import { SEAT_LABELS, talentLabel, type Seat } from '../../../shared/talent';
import { sourceById } from '../../../shared/registry';
import type { WildcardState } from '../../../shared/wildcard';
import { Btn, MatchModule, PredictionsModule, ScoreRow, Seg, Tiny, PGM, PVW, WARN, type Ack, type Ctx } from './modules';
import { B } from './ws';

type Run = (c: ProducerCmd, l: string) => Promise<Ack>;

export function GfxBadge({ g, st }: { g: GfxInstance; st: ControllerState }) {
  const h = st.gfxHealth?.[g.id];
  return (
    <>
      {g.draft && <span className="rounded-[2px] px-1 text-[9px] font-black text-black" style={{ background: WARN }} title="Prepared changes">DRAFT</span>}
      <span className="rounded-[2px] px-1 text-[9px] font-black" style={g.anim.action === 'out' ? { background: '#333', color: '#aaa' } : { background: PGM }}>{g.anim.action === 'out' ? 'OUT' : 'IN'}</span>
      {h && !h.ok && <span className="text-[10px] font-black" style={{ color: WARN }} title={h.error}>⚠</span>}
    </>
  );
}

function PropInput({ d, value, changed, onChange }: { d: PropDef; value: string | number | boolean; changed: boolean; onChange: (v: string | number | boolean) => void }) {
  const [txt, setTxt] = useState<string | null>(null);
  const opts = d.options ?? [];
  const segFits = d.type === 'select' && opts.reduce((n, o) => n + o.label.length + 3, 0) <= 30;
  return (
    <div className="flex min-h-[26px] items-center gap-2" data-prop={d.key} title={d.help}>
      <span className="w-[112px] flex-none truncate text-[11.5px] text-white/65">{d.label}{changed && <span className="ml-1" style={{ color: WARN }} title="Prepared, not published">●</span>}</span>
      {d.type === 'boolean' && <Seg value={value ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={v => onChange(v === 'on')} />}
      {d.type === 'select' && (segFits
        ? <Seg value={String(value)} options={opts.map(o => [o.value, o.label])} onChange={onChange} />
        : <select aria-label={d.label} value={String(value)} onChange={e => onChange(e.target.value)} className="h-[24px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5 text-[12px]">{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>)}
      {(d.type === 'text' || d.type === 'number') && <input aria-label={d.label} type={d.type === 'number' ? 'number' : 'text'} min={d.min} max={d.max} value={txt ?? String(value)} onChange={e => setTxt(e.target.value)} onBlur={() => { if (txt != null && txt !== String(value)) onChange(d.type === 'number' ? Number(txt) : txt); setTxt(null); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(null); (e.target as HTMLInputElement).blur(); } }} className="h-[24px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-2 text-[12px]" />}
      {d.type === 'color' && <>
        <input aria-label={d.label} type="color" value={String(value) || '#ff4b2e'} onChange={e => onChange(e.target.value)} className="h-[24px] w-10 cursor-pointer rounded-[2px] border border-white/15 bg-transparent" />
        {value ? <Tiny onClick={() => onChange('')} title="Back to the brand colour">✕</Tiny> : <span className="text-[11px] text-white/40">brand</span>}
      </>}
    </div>
  );
}

function SeatBinding({ st, seats, run }: { st: ControllerState; seats: number[]; run: Run }) {
  const talent = st.talent ?? [];
  return (
    <div className="space-y-1">
      {seats.map(s => {
        const t = talent.find(p => p.id === st.seats?.[s as Seat]);
        return (
          <div key={s} data-seat={s} className="flex items-center gap-2 text-[12px]">
            <span className="w-[112px] flex-none truncate text-[11.5px] text-white/60">{SEAT_LABELS[s as Seat]}</span>
            <select aria-label={`Talent in ${SEAT_LABELS[s as Seat]}`} value={t?.id ?? ''} onChange={e => run({ c: 'seat', seat: s, talent: e.target.value || null }, `${SEAT_LABELS[s as Seat]}: ${e.target.value || 'empty'}`)} className="h-[24px] min-w-0 flex-1 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5">
              <option value="">— empty —</option>
              {talent.map(p => <option key={p.id} value={p.id}>{talentLabel(p)} · {p.role}{p.publishing ? ' · ●' : ''}{p.seat && p.seat !== s ? ` (swap with ${p.seat})` : ''}</option>)}
            </select>
            <span className="w-[54px] flex-none text-[10.5px]" style={{ color: t?.publishing ? PVW : t?.online ? WARN : 'rgba(255,255,255,.35)' }}>{!t ? '' : t.mode === 'vdo' ? '● VDO' : t.publishing ? `● cam${t.hasAudio ? '+mic' : ''}` : t.online ? '● no cam' : '● offline'}</span>
          </div>
        );
      })}
    </div>
  );
}

const SECTION = 'flex min-w-0 flex-col gap-1 border-b border-r border-white/[0.07] px-2.5 py-2';
const SEC_H = "mb-0.5 flex items-center gap-1.5 font-['Barlow_Condensed'] text-[12.5px] font-bold uppercase tracking-[0.12em] text-white/80";

/**
 * Generated Inspector for one graphics instance: animations, publish, presets and "add to rundown" in one
 * bar; then every property group and data binding of its package, laid out in columns that wrap (no
 * horizontal scrolling; each area scrolls vertically inside the 400 px control strip).
 */
export function Inspector({ g, st, run, ctxBase }: { g: GfxInstance; st: ControllerState; eng?: EngineState; wc?: WildcardState; pv?: WildcardState; run: Run; ctxBase: Omit<Ctx, 'src'> }) {
  const p = pkgById(g.pkg)!;
  const cur = g.draft ?? g.config;
  const [preset, setPreset] = useState('');
  const groups = [...new Set(p.props.map(d => d.group ?? 'Properties'))];
  const h = st.gfxHealth?.[g.id];
  const conns = st.outputs.find(o => o.route === `g/${g.id}`)?.count ?? 0;
  const out = g.anim.action === 'out';
  const changed = g.draft ? Object.keys(g.draft).filter(k => g.draft![k] !== g.config[k]).length : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-inspector={g.id}>
      <div className="flex h-[28px] flex-none items-center gap-2 border-b border-white/[0.08] bg-[#17171a] px-2.5 text-[11.5px]">
        <span className="font-['Barlow_Condensed'] text-[13px] font-bold uppercase tracking-[0.12em]">Inspector</span>
        <b className="truncate text-white">{g.name}</b><span className="truncate text-white/40">{p.name} v{p.version}</span>
        <span className="ml-auto flex flex-none items-center gap-2">
          <span style={{ color: h && !h.ok ? WARN : conns ? PVW : 'rgba(255,255,255,.4)' }} title={h && !h.ok ? h.error : undefined}>{h && !h.ok ? `⚠ ${h.error}` : conns ? `● ${conns} source${conns === 1 ? '' : 's'} OK` : '○ no source connected'}</span>
          <button type="button" className="font-mono text-white/55 underline hover:text-white" title="Copy the OBS browser source URL" onClick={() => navigator.clipboard?.writeText(`${location.origin}/g/${g.id}`)}>/g/{g.id}</button>
        </span>
      </div>
      <div className="flex h-[36px] flex-none items-center gap-1 border-b border-white/[0.08] px-2" data-anims>
        {p.animations.map(a => (
          <B key={a.action} h={26} kind={a.action === 'in' ? 'in' : a.action === 'out' ? 'out' : 'default'} active={a.action === 'in' ? !out : a.action === 'out' ? out : false}
            title={a.action === 'in' ? 'Animate IN on its own source (F2)' : a.action === 'update' ? 'Play the UPDATE animation (F3)' : a.action === 'out' ? 'Animate OUT (F4)' : 'Back to package defaults'}
            onClick={() => run({ c: 'gfx-anim', id: g.id, action: a.action }, `${g.name} ${a.label}`)}>{a.label}</B>
        ))}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <B h={26} kind="primary" disabled={!g.draft} onClick={() => run({ c: 'gfx-publish', id: g.id }, `Publish ${g.name}`)} title="Send this graphic's prepared changes to its source">Publish{changed ? ` ${changed}` : ''}</B>
        <B h={26} disabled={!g.draft} onClick={() => run({ c: 'gfx-revert', id: g.id }, `Revert ${g.name}`)}>Revert</B>
        {p.commands.map(c => <B key={c.id} h={26} onClick={() => run({ c: 'graphic', g: c.id as 'replay' }, c.label)}>{c.label}</B>)}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <select aria-label="Load preset" value="" disabled={!g.presets.length} onChange={e => e.target.value && run({ c: 'gfx-preset', id: g.id, op: 'load', name: e.target.value }, `Load preset ${e.target.value}`)} className="h-[26px] w-[118px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1 text-[11.5px]">
          <option value="">{g.presets.length ? `Presets (${g.presets.length})…` : 'No presets'}</option>{g.presets.map(q => <option key={q.name} value={q.name}>{q.name}</option>)}
        </select>
        <input aria-label="Preset name" value={preset} onChange={e => setPreset(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && preset.trim()) run({ c: 'gfx-preset', id: g.id, op: 'save', name: preset }, `Save preset ${preset}`).then(a => a.ok && setPreset('')); }} placeholder="Save as preset…" className="h-[26px] w-[120px] min-w-0 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-2 text-[11.5px]" />
        <B h={26} disabled={!preset.trim()} onClick={() => run({ c: 'gfx-preset', id: g.id, op: 'save', name: preset }, `Save preset ${preset}`).then(a => a.ok && setPreset(''))}>Save</B>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {groups.map(gr => (
            <section key={gr} className={SECTION} data-prop-group={gr}>
              <div className={SEC_H}>{gr} <span className="rounded-[2px] px-1 text-[9.5px] text-black" style={{ background: WARN }} title="Prepared: Publish sends it to the source">DRAFT</span></div>
              {p.props.filter(d => (d.group ?? 'Properties') === gr).map(d => <PropInput key={d.key} d={d} value={cur[d.key]} changed={!!g.draft && g.draft[d.key] !== g.config[d.key]} onChange={v => run({ c: 'gfx-set', id: g.id, patch: { [d.key]: v } }, `${g.name}: ${d.label}`)} />)}
            </section>
          ))}
          {p.bindings.map((b, i) => (
            <section key={i} className={SECTION} data-binding={b.kind}>
              <div className={SEC_H}>{b.label} <span className="rounded-[2px] px-1 text-[9.5px] text-white" style={{ background: PGM }} title="Shared show data: goes straight to every graphic using it">LIVE DATA</span></div>
              {b.kind === 'seats' && <SeatBinding st={st} seats={b.seats} run={run} />}
              {b.kind === 'match' && <MatchModule x={{ ...ctxBase, src: sourceById('gameplay')! }} />}
              {b.kind === 'score' && <ScoreRow x={{ ...ctxBase, src: sourceById('scoreboard')! }} />}
              {b.kind === 'bracket' && <div className="text-[11.5px] text-white/55">Results come from the match scores (Match / Scoreboard) and the sheet sync. Every bracket graphic uses the same results.</div>}
              {b.kind === 'predictions' && <PredictionsModule x={{ ...ctxBase, src: sourceById(b.seats[0] >= 4 ? 'analyst-desk' : 'caster-desk')! }} />}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PackageLibrary({ st, run, onSelect }: { st: ControllerState; run: Run; onSelect: (id: string) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const gs = st.graphics ?? [];
  const isDefault = (g: GfxInstance) => PACKAGES.some(p => p.id.replace(/^od\./, '') === g.id);
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" data-packages>
      <div className="text-[11px] font-black uppercase tracking-[0.14em]">Installed graphics packages</div>
      {PACKAGES.map((p: PackageDef) => (
        <div key={p.id} data-package={p.id} className="rounded-[2px] border border-white/10 px-2 py-1.5 text-[12px]">
          <div className="flex items-center gap-2"><b>{p.name}</b><span className="text-white/45">v{p.version} · {p.collection} · {p.resolution.join('×')} · needs {p.permissions.join(', ')}</span>
            <input aria-label={`New ${p.name} name`} value={names[p.id] ?? ''} onChange={e => setNames(n => ({ ...n, [p.id]: e.target.value }))} placeholder="New instance name" className="ml-auto w-[170px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-2 py-0.5 text-[11.5px]" />
            <Btn onClick={() => run({ c: 'gfx-create', pkg: p.id, name: names[p.id] ?? '' }, `New ${p.name}`).then(a => a.ok && setNames(n => ({ ...n, [p.id]: '' })))}>+ Instance</Btn></div>
          <div className="text-[11px] text-white/45">{p.description}</div>
          <div className="mt-1 flex flex-wrap gap-1">{gs.filter(g => g.pkg === p.id).map(g => (
            <span key={g.id} className="flex items-center gap-1 rounded-[2px] border border-white/10 px-1.5 py-0.5 text-[11.5px]"><button type="button" className="underline" onClick={() => onSelect(g.id)}>{g.name}</button><span className="font-mono text-white/40">/g/{g.id}</span>{!isDefault(g) && <Tiny onClick={() => run({ c: 'gfx-delete', id: g.id }, `Delete ${g.name}`)}>✕</Tiny>}</span>
          ))}</div>
        </div>
      ))}
    </div>
  );
}

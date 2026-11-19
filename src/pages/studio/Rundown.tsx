/**
 * Studio Mode 2.0 · SHOW RUNDOWN. The running order of the whole show (segments): scene, OBS scene,
 * expected duration, transition, media, GO confirmation and auto-advance, with readiness per item.
 * Every edit is an acknowledged engine command shared live with Producer Mode. Nothing here switches OBS:
 * Producer Mode takes segments (GO); "Mark on air" only records that OBS was switched by hand.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import { SEG_TRANSITIONS, fmtDur, parseDur, planLength, type Segment, type SegTransition } from '../../../shared/showplan';
import { mediaName } from '../../../shared/media';
import type { Run } from '../producer/modules';
import { Btn, COND, Empty, I, IconBtn, Input, Pill, S, Select, Toggle, fmtClock } from './kit';
import { sceneCatalogue, segReady, selToTarget, targetName } from './model';

export function useMediaLibrary() {
  const [lib, setLib] = useState<{ url: string; name: string }[]>([]);
  useEffect(() => { fetch('/api/media').then(r => (r.ok ? r.json() : null)).then(j => j?.items && setLib(j.items)).catch(() => {}); }, []);
  return lib;
}

export function targetOptions(st: ControllerState): [string, string][] {
  const cat = sceneCatalogue(st);
  return [['', '— choose a scene —'], ...cat.filter(c => c.kind === 'scene').map(c => [c.target, `Scene · ${c.name}`] as [string, string]), ...cat.filter(c => c.kind === 'graphic').map(c => [c.target, `Graphic · ${c.name}`] as [string, string])];
}

export function ShowRundown({ st, run, now, sel, onSelect }: { st: ControllerState; run: Run; now: number; sel: string; onSelect: (t: string) => void }) {
  const plan = st.plan;
  const segs = plan?.segments ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const lib = useMediaLibrary();
  const tOpts = useMemo(() => targetOptions(st), [st]);
  const obsOpts: [string, string][] = useMemo(() => [['', 'Mapped scene (auto)'], ...st.obs.scenes.map(n => [n, n] as [string, string])], [st.obs.scenes]);
  const mediaOpts: [string, string][] = useMemo(() => {
    const urls = [...new Set([...(st.media?.playlist ?? []), ...lib.map(l => l.url)])];
    return [['', 'No media'], ...urls.map(u => [u, mediaName(u)] as [string, string])];
  }, [st.media?.playlist, lib]);
  const edit = (s: Segment, patch: Partial<Segment>, l: string) => run({ c: 'sp-seg-edit', id: s.id, patch }, `${s.label}: ${l}`);
  const onAir = plan?.onAir ? segs.find(s => s.id === plan.onAir!.id) : undefined;
  const elapsed = plan?.onAir ? now - plan.onAir.at : 0;
  const addCur = () => run({ c: 'sp-seg-add', seg: { label: targetName(st, selToTarget(sel)), target: selToTarget(sel), dur: 120, transition: 'stinger' } }, 'Add segment');

  if (!plan) return <Empty>The server did not send a show plan (older server?).</Empty>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-show-rundown>
      <div className="flex flex-none flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[14.5px] text-white/65">{segs.length} segment{segs.length === 1 ? '' : 's'} · planned {fmtClock(planLength(plan) * 1000)}</span>
        </div>
        {onAir && <Pill tone="pgm">On air · {onAir.label} · {fmtClock(elapsed)}{onAir.dur ? ` / ${fmtDur(onAir.dur)}` : ''}</Pill>}
        {plan.next && <Pill tone="pvw">Next · {segs.find(s => s.id === plan.next)?.label}</Pill>}
        <div className="ml-auto flex items-center gap-2">
          <Toggle on={plan.crewSync} onChange={v => run({ c: 'sp-opts', crewSync: v }, `Crew run of show sync ${v ? 'on' : 'off'}`)} label={<span className="text-[13.5px] text-white/70">Mirror to crew run of show</span>}
            title="The talent pages and /crew show this rundown (replaces the run of show written in the Controller)" />
          {!segs.length && <Btn onClick={() => run({ c: 'sp-starter' }, 'Starter show')} icon={I.plus}>Starter show</Btn>}
          <Btn kind="accent" onClick={addCur} icon={I.plus} title="Adds the scene selected in the library">Add segment</Btn>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-[10px] border" style={{ borderColor: S.line, background: S.panel }}>
        {!segs.length ? (
          <Empty action={<div className="flex gap-2"><Btn onClick={() => run({ c: 'sp-starter' }, 'Starter show')}>Load a starter show</Btn><Btn kind="accent" onClick={addCur}>Add the selected scene</Btn></div>}>
            Build the show in order: each segment picks a scene, the OBS scene to switch to, a transition, how long it should last and the media it starts. Producer Mode takes each one with GO.
          </Empty>
        ) : (
          <div className="min-w-[960px]">
            <div className={`${COND} sticky top-0 z-10 grid h-[40px] items-center gap-3 border-b px-3 text-[12.5px] tracking-[0.12em] text-white/45`} style={{ gridTemplateColumns: GRID, background: S.raised, borderColor: S.line }}>
              <span /><span>#</span><span>Segment</span><span>Scene</span><span>Duration</span><span>Transition</span><span>Readiness</span><span className="text-right">Actions</span>
            </div>
            {segs.map((s, i) => {
              const r = segReady(st, s), isAir = plan.onAir?.id === s.id, isNext = plan.next === s.id, exp = open === s.id;
              const bar = r.level === 'error' ? S.bad : r.level === 'warn' ? S.warn : S.ok;
              return (
                <div key={s.id} data-segment={s.id} draggable onDragStart={e => { setDrag({ id: s.id, over: i }); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={e => { e.preventDefault(); if (drag && drag.over !== i) setDrag({ ...drag, over: i }); }}
                  onDrop={e => { e.preventDefault(); if (drag && drag.id !== s.id) run({ c: 'sp-seg-move', id: drag.id, to: i }, 'Reorder'); setDrag(null); }} onDragEnd={() => setDrag(null)}
                  className="border-b" style={{ borderColor: S.line, background: isAir ? 'rgba(229,72,77,.09)' : isNext ? 'rgba(47,191,113,.07)' : undefined, boxShadow: drag && drag.over === i && drag.id !== s.id ? `inset 0 2px 0 ${S.accent}` : undefined }}>
                  <div className="grid min-h-[58px] items-center gap-3 px-3" style={{ gridTemplateColumns: GRID }}>
                    <span className="cursor-grab text-white/30" title="Drag to reorder">{I.drag}</span>
                    <span className="flex items-center gap-2"><span className="h-[30px] w-[4px] rounded-full" style={{ background: bar }} /><span className="font-mono text-[15px] text-white/60">{String(i + 1).padStart(2, '0')}</span></span>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input ariaLabel={`Name of segment ${i + 1}`} value={s.label} onCommit={v => edit(s, { label: v }, 'renamed')} />
                      {isAir && <Pill tone="pgm">On air</Pill>}{isNext && !isAir && <Pill tone="pvw">Next</Pill>}
                    </div>
                    <Select ariaLabel={`Scene of ${s.label}`} value={s.target ?? ''} options={tOpts} onChange={v => edit(s, { target: v || null }, 'scene')} />
                    <Input ariaLabel={`Duration of ${s.label}`} value={fmtDur(s.dur)} onCommit={v => edit(s, { dur: parseDur(v) }, 'duration')} placeholder="m:ss" mono />
                    <Select ariaLabel={`Transition of ${s.label}`} value={s.transition} options={SEG_TRANSITIONS} onChange={v => edit(s, { transition: v as SegTransition }, 'transition')} />
                    <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => setOpen(exp ? null : s.id)} title={r.issues.map(x => x.text).join('\n') || 'Ready'}>
                      {r.level === 'ready' ? <Pill tone="ok">{I.check} Ready</Pill> : <Pill tone={r.level === 'error' ? 'bad' : 'warn'}>{I.warn} {r.issues.length} issue{r.issues.length === 1 ? '' : 's'}</Pill>}
                      <span className="truncate text-[13px] text-white/45">{r.scene ? `OBS → ${r.scene}` : 'no OBS scene'}</span>
                    </button>
                    <div className="flex items-center justify-end gap-1.5">
                      <IconBtn title="Show in the preview" onClick={() => s.target && onSelect(s.target)} disabled={!s.target}>{I.eye}</IconBtn>
                      <Btn size="sm" disabled={isNext || isAir} onClick={() => run({ c: 'sp-next', id: s.id }, `Prepare ${s.label}`)} title="Prepare: Producer Mode's GO takes this one next">Prepare</Btn>
                      <IconBtn title={exp ? 'Hide details' : 'Details: OBS scene, media, GO, notes'} active={exp} onClick={() => setOpen(exp ? null : s.id)}><span className={`transition-transform ${exp ? 'rotate-180' : ''}`}>{I.chevron}</span></IconBtn>
                    </div>
                  </div>
                  {exp && (
                    <div className="grid gap-4 px-3 pb-4 pl-[86px]" style={{ gridTemplateColumns: 'minmax(220px,1fr) minmax(220px,1fr) minmax(260px,1.2fr)' }} data-segment-details={s.id}>
                      <div className="space-y-3">
                        <div><div className={`${COND} mb-1.5 text-[12.5px] tracking-[0.14em] text-white/50`}>OBS scene</div>
                          <Select ariaLabel={`OBS scene of ${s.label}`} value={s.obsScene ?? ''} options={s.obsScene && !st.obs.scenes.includes(s.obsScene) ? [...obsOpts, [s.obsScene, `${s.obsScene} (not in OBS)`]] : obsOpts} onChange={v => edit(s, { obsScene: v || null }, 'OBS scene')} />
                          <div className="mt-1 text-[12.5px] text-white/45">{s.obsScene ? 'Explicit scene' : r.scene ? `Auto: ${r.scene}` : 'Map the scene in Sources & OBS, or pick one here'}</div></div>
                        <div><div className={`${COND} mb-1.5 text-[12.5px] tracking-[0.14em] text-white/50`}>Media on GO</div>
                          <Select ariaLabel={`Media of ${s.label}`} value={s.media ?? ''} options={s.media && !mediaOpts.some(o => o[0] === s.media) ? [...mediaOpts, [s.media, mediaName(s.media)]] : mediaOpts} onChange={v => edit(s, { media: v || null }, 'media')} />
                          <div className="mt-1 text-[12.5px] text-white/45">Added to the playlist if needed and started on /output/media.</div></div>
                      </div>
                      <div className="space-y-3 pt-6">
                        <Toggle on={s.confirm} onChange={v => edit(s, { confirm: v }, v ? 'needs GO' : 'no GO needed')} label="Automation needs producer GO" title="Automation prepares this segment and waits for GO in Producer Mode" />
                        <Toggle on={s.autoNext} onChange={v => edit(s, { autoNext: v }, v ? 'auto-advance on' : 'auto-advance off')} label="When time is up, take the next segment" />
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Btn size="sm" disabled={i === 0} onClick={() => run({ c: 'sp-seg-move', id: s.id, to: i - 1 }, 'Move up')} icon={I.up}>Up</Btn>
                          <Btn size="sm" disabled={i === segs.length - 1} onClick={() => run({ c: 'sp-seg-move', id: s.id, to: i + 1 }, 'Move down')} icon={I.down}>Down</Btn>
                          <Btn size="sm" disabled={isAir} onClick={() => run({ c: 'sp-onair', id: s.id }, `Marked on air: ${s.label}`)} title="Records that this segment is on air (you switched OBS yourself). Does not switch OBS.">Mark on air</Btn>
                          <Btn size="sm" kind="danger" disabled={isAir} onClick={() => { if (confirm(`Remove “${s.label}” from the rundown?`)) run({ c: 'sp-seg-remove', id: s.id }, `Remove ${s.label}`); }} icon={I.trash}>Remove</Btn>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div><div className={`${COND} mb-1.5 text-[12.5px] tracking-[0.14em] text-white/50`}>Notes for the crew</div>
                          <Input ariaLabel={`Notes of ${s.label}`} value={s.notes} onCommit={v => edit(s, { notes: v }, 'notes')} placeholder="Talking points, sponsor read…" /></div>
                        <ul className="space-y-1 text-[13.5px]" data-issues>
                          {r.issues.length ? r.issues.map((x, k) => <li key={k} className="flex items-start gap-2" style={{ color: x.level === 'error' ? '#ff8f92' : S.warn }}>{I.warn}<span>{x.text}</span></li>)
                            : <li className="flex items-center gap-2 text-[#5fd99a]">{I.check} Ready: scene, OBS scene{s.target?.includes('desk') ? ', talent' : ''} and browser source are in place</li>}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
const GRID = '20px 52px minmax(190px,1.4fr) minmax(170px,1fr) 92px 132px minmax(180px,1fr) 190px';

/** Compact "next up" view for the inspector column. */
export function RundownMini({ st, now }: { st: ControllerState; now: number }) {
  const p = st.plan; if (!p) return null;
  const segs = p.segments, air = p.onAir ? segs.find(s => s.id === p.onAir!.id) : undefined, nextI = p.next ? segs.findIndex(s => s.id === p.next) : -1;
  const el = p.onAir ? now - p.onAir.at : 0, over = !!air?.dur && el > air.dur * 1000;
  return (
    <div className="space-y-2 text-[14px]" data-rundown-mini>
      <div className="flex items-center gap-2"><span className={`${COND} w-[62px] text-[12.5px] tracking-[0.12em] text-white/45`}>On air</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{air ? air.label : '—'}</span>
        {air && <span className="font-mono text-[14px]" style={{ color: over ? S.bad : S.dim }}>{fmtClock(el)}{air.dur ? ` / ${fmtDur(air.dur)}` : ''}</span>}</div>
      {segs.slice(Math.max(0, nextI), Math.max(0, nextI) + 3).filter(() => nextI >= 0).map((s, k) => {
        const r = segReady(st, s);
        return (
          <div key={s.id} className="flex items-center gap-2 rounded-[7px] border px-2.5 py-2" style={{ borderColor: k === 0 ? 'rgba(47,191,113,.45)' : S.line, background: k === 0 ? 'rgba(47,191,113,.07)' : 'transparent' }}>
            <span className={`${COND} w-[52px] text-[12.5px] tracking-[0.12em]`} style={{ color: k === 0 ? S.ok : S.faint }}>{k === 0 ? 'Next' : `+${k}`}</span>
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="font-mono text-[13px] text-white/50">{fmtDur(s.dur)}</span>
            <span className="h-[8px] w-[8px] rounded-full" style={{ background: r.level === 'error' ? S.bad : r.level === 'warn' ? S.warn : S.ok }} title={r.issues.map(i => i.text).join('\n') || 'Ready'} />
          </div>
        );
      })}
      {nextI < 0 && <div className="text-[13px] text-white/45">{segs.length ? 'Nothing prepared.' : 'No show rundown yet.'}</div>}
    </div>
  );
}

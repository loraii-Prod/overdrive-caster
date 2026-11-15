/**
 * OVERDRIVE · STUDIO MODE 2.0 — the full-screen show preparation workspace (/producer in Studio mode, /studio).
 *
 *   top bar      mode switch (Studio / Producer), event, readiness, on-air indicator
 *   left rail    sections + the Scene Library (search, filters, favourites)          resizable · collapsible
 *   centre       PREVIEW (Draft / Live, 16:9) + PROGRAM (what OBS has on air)        resizable · collapsible
 *                the section workspace with its sub-tabs
 *   inspector    selected scene, show control (next / on air / pending GO), automation, prepared changes, activity
 *   status bar   Studio · OBS · outputs · talent · automation · engine
 *
 * Studio configures, prepares and tests. It never switches OBS, never takes a segment and never plays a graphic
 * IN or OUT: those are Producer Mode's. Both modes are the same page over the same server state, so every
 * change here is an acknowledged engine command that Producer Mode (and every other operator) sees at once.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ControllerState } from '../../../shared/types';
import { draftLabel, type EngineState } from '../../../shared/engine';
import { triggerLabel, actionLabel } from '../../../shared/showplan';
import { sourceSizeLabel } from '../../../shared/layout';
import type { RtcViewer } from '../../lib/rtcViewer';
import type { Ctx, Run } from '../producer/modules';
import { CATEGORIES } from '../producer/Library';
import { AutomationBuilder, NotesLog } from './Automation';
import { RundownMini, ShowRundown } from './Rundown';
import { TalentManager } from './Talent';
import { DATA_TABS, DataSection, MEDIA_TABS, MediaSection, OBS_TABS, ObsSection, SCENE_TABS, SHOW_TABS, ScenesSection, ShowSection, type SubTab } from './Sections';
import { Btn, COND, Dot, Fit169, Fold, Handle, I, IconBtn, Pill, S, Seg, Toggle, fmtClock, useDrag, useLocal } from './kit';
import { sceneCatalogue, segReady, studioIssues, targetToSel, type SceneEntry } from './model';

export type LogLine = { at: number; ok: boolean; text: string };
export type Section = 'scenes' | 'talent' | 'data' | 'automation' | 'rundown' | 'media' | 'obs' | 'show';

const SECTIONS: { id: Section; label: string; icon: ReactNode; about: string; tabs?: SubTab[] }[] = [
  { id: 'scenes', label: 'Scenes', icon: I.scenes, about: 'Scene settings, controls, presets, packages and instances', tabs: SCENE_TABS },
  { id: 'talent', label: 'Talent & Cameras', icon: I.talent, about: 'Casters, analysts and hosts, camera links, positions and desk layouts' },
  { id: 'data', label: 'Graphics & Data', icon: I.data, about: 'Match, scores, bracket, players, predictions, Pick\'ems, MVP, bindings', tabs: DATA_TABS },
  { id: 'rundown', label: 'Show Rundown', icon: I.rundown, about: 'The running order: scenes, durations, transitions, media, readiness' },
  { id: 'automation', label: 'Automation', icon: I.auto, about: 'Triggers, steps, producer GO confirmation, safe testing' },
  { id: 'media', label: 'Media & Audio', icon: I.media, about: 'Media library, sponsor ads, music per scene, audio routing', tabs: MEDIA_TABS },
  { id: 'obs', label: 'OBS & Outputs', icon: I.obs, about: 'OBS connection, scene builder and mapping, browser sources, transitions', tabs: OBS_TABS },
  { id: 'show', label: 'Audience & Show File', icon: I.file, about: 'Public voting page and QR, show file export / import, recovery', tabs: SHOW_TABS },
];

const FILTERS: [string, string][] = [['all', 'All'], ['fav', '★'], ['Desks', 'Desks'], ['Gameplay', 'Game'], ['Tournament graphics', 'Bracket'], ['Media', 'Breaks & media'], ['MVP & Awards', 'MVP'], ['Audience', 'Audience']];

export interface StudioProps {
  st: ControllerState; eng: EngineState; ctx: Ctx; run: Run; log: LogLine[]; conn: string; rtt: number | null; busy: number; now: number;
  viewer: RtcViewer | null; sel: string; setSel: (s: string) => void;
  renderTarget: (key: string, view: 'draft' | 'live') => ReactNode;
  programKey: string | null;
  onProducer: () => void; onLogout: () => void; setCams: (ids: number[]) => void;
}

export type Layout = 'overview' | 'focus' | 'preview';
export const LAYOUTS: { id: Layout; label: string; key: string; about: string }[] = [
  { id: 'overview', label: 'Overview', key: 'O', about: 'Scene preview alongside the configuration' },
  { id: 'focus', label: 'Focus', key: 'F', about: 'Large configuration workspace, small preview in the inspector' },
  { id: 'preview', label: 'Preview', key: 'P', about: 'Large scene preview, compact properties inspector' },
];
/** Monitor height per layout, as a share of the centre column (scales between 1080p and 1440p screens). */
const MON_DEFAULT: Record<Layout, number> = { overview: 0.42, focus: 0, preview: 0.7 };

export function StudioWorkspace(p: StudioProps) {
  const { st, eng, run, now, sel, setSel } = p;
  const [section, setSection] = useLocal<Section>('od.studio.section', 'scenes', v => SECTIONS.some(s => s.id === v));
  const [tabs, setTabs] = useLocal<Record<string, string>>('od.studio.tabs', {}, v => !!v && typeof v === 'object');
  const [layout, setLayout] = useLocal<Layout>('od.studio.layout', 'overview', v => LAYOUTS.some(l => l.id === v));
  const [widths, setWidths] = useLocal<Record<string, number>>('od.studio.widths.v2', {}, v => !!v && typeof v === 'object');
  const [monFrac, setMonFrac] = useLocal<Record<string, number>>('od.studio.monitors.v2', {}, v => !!v && typeof v === 'object');
  const [leftOpen, setLeftOpen] = useLocal('od.studio.leftOpen', true, v => typeof v === 'boolean');
  const [rightOpen, setRightOpen] = useLocal('od.studio.rightOpen', true, v => typeof v === 'boolean');
  const [monOpen, setMonOpen] = useLocal('od.studio.monOpen', true, v => typeof v === 'boolean');
  const [pgmOpen, setPgmOpen] = useLocal('od.studio.pgmOpen', true, v => typeof v === 'boolean');
  const [maxWs, setMaxWs] = useState(false); // the whole window for the workspace (Esc)
  const [palette, setPalette] = useState(false);
  const [view, setView] = useState<'draft' | 'live'>('draft');
  const [guides, setGuides] = useState(false);
  const [musicScene, setMusicScene] = useLocal('od.studio.music', 'caster-desk', v => typeof v === 'string');
  const [full, setFull] = useState(false);
  const [mainH, setMainH] = useState(800);
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => { const el = mainRef.current; if (!el) return; const on = () => setMainH(el.clientHeight); on(); const ro = new ResizeObserver(on); ro.observe(el); return () => ro.disconnect(); }, []);
  // Each layout keeps its own panel sizes (saved per browser).
  const wide = typeof window !== 'undefined' && window.innerWidth >= 2300;
  const left = widths[`${layout}.left`] ?? (wide ? 340 : 300);
  const right = widths[`${layout}.right`] ?? (layout === 'focus' ? (wide ? 520 : 440) : layout === 'preview' ? (wide ? 480 : 400) : (wide ? 480 : 420));
  const setW = (k: 'left' | 'right') => (n: number) => setWidths({ ...widths, [`${layout}.${k}`]: n });
  const monH = Math.round(Math.max(220, Math.min(mainH - 160, (monFrac[layout] ?? MON_DEFAULT[layout]) * mainH)));
  const setMonH = (n: number) => setMonFrac({ ...monFrac, [layout]: Math.round((n / Math.max(1, mainH)) * 1000) / 1000 });
  const dragL = useDrag(left, setW('left'), 230, 520, 'x', 1);
  const dragR = useDrag(right, setW('right'), 340, 760, 'x', -1);
  const dragM = useDrag(monH, setMonH, 220, Math.max(240, mainH - 160), 'y', 1);
  const sec = SECTIONS.find(s => s.id === section)!;
  const tab = sec.tabs ? (sec.tabs.some(t => t.id === tabs[section]) ? tabs[section] : sec.tabs[0].id) : '';
  const page = sec.tabs?.find(t => t.id === tab);
  const cat = useMemo(() => sceneCatalogue(st), [st]);
  const entry = cat.find(c => c.key === sel) ?? cat[0];
  const issues = useMemo(() => studioIssues(st), [st]);
  const go = (s: Section, t?: string) => { setSection(s); if (t) setTabs({ ...tabs, [s]: t }); };
  const addSegment = (target: string, name: string) => run({ c: 'sp-seg-add', seg: { label: name, target, dur: 120, transition: 'stinger' } }, `${name} → show rundown`);
  const ctx: Ctx = { ...p.ctx, prepare: true, studio: true }; // Studio prepares live data: nothing reaches the sources before Publish
  const showLeft = leftOpen && !maxWs, showRight = rightOpen && !maxWs;
  const centreMonitors = !maxWs && layout !== 'focus' && monOpen;

  useEffect(() => { document.title = 'Overdrive · Studio Mode'; return () => { document.title = 'Overdrive'; }; }, []);
  // Keyboard: Ctrl/Cmd+K quick switcher · Alt+O / Alt+F / Alt+P layouts · Esc leaves full screen / the maximised workspace.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null, typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); return; }
      if (e.key === 'Escape') { if (palette) setPalette(false); else if (full) setFull(false); else if (maxWs) setMaxWs(false); return; }
      if (typing || !e.altKey || e.ctrlKey || e.metaKey) return;
      const l = LAYOUTS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
      if (l) { e.preventDefault(); setLayout(l.id); setMaxWs(false); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [palette, full, maxWs, setLayout]);

  const previewBody = (big: boolean) => entry && (
    <div className="absolute inset-0" style={{ background: 'repeating-conic-gradient(#151519 0% 25%, #0f0f12 0% 50%) 50% / 40px 40px' }} data-preview={entry.key} data-preview-view={view}>
      {p.renderTarget(entry.key, view)}{guides && big && <Guides />}
    </div>
  );
  const previewTools = <>
    <Seg size="sm" value={view} options={[['draft', 'Draft'], ['live', 'Live']]} onChange={setView} />
    <IconBtn title="Safe-area guides" active={guides} onClick={() => setGuides(!guides)}>{I.grid}</IconBtn>
    <IconBtn title="Full-screen preview (Esc to close)" onClick={() => setFull(true)}>{I.expand}</IconBtn>
  </>;

  return (
    <div className="fixed inset-0 flex flex-col font-['Inter'] text-[15px] text-white antialiased" style={{ background: S.bg, color: S.text }} data-studio-workspace={section} data-studio-layout={maxWs ? 'workspace' : layout}>
      <TopBar {...p} issues={issues} onIssues={w => go(w as Section)} layout={layout} setLayout={l => { setLayout(l); setMaxWs(false); }} maxWs={maxWs} setMaxWs={setMaxWs} onPalette={() => setPalette(true)} />
      <div className="flex min-h-0 flex-1">
        {/* ============ left rail: sections (with their pages) + scene library */}
        {showLeft ? <>
          <aside className="flex min-h-0 flex-none flex-col" style={{ width: left, background: S.rail }} data-rail>
            <nav className="flex-none overflow-y-auto px-2.5 pt-3" style={{ maxHeight: '58%' }} aria-label="Studio sections">
              {SECTIONS.map(s => {
                const badge = s.id === 'rundown' ? st.plan?.segments.length || null : s.id === 'automation' ? (st.plan?.pending ? 'GO' : st.plan?.rules.filter(r => r.on).length || null) : s.id === 'talent' ? `${(st.talent ?? []).filter(t => t.seat && (t.mode === 'vdo' || t.publishing)).length}/${(st.talent ?? []).filter(t => t.seat).length}` : null;
                const err = issues.some(i => i.where === s.id && i.level === 'error');
                const on = section === s.id;
                return (
                  <div key={s.id}>
                    <button type="button" onClick={() => setSection(s.id)} title={s.about} data-nav={s.id} aria-current={on ? 'page' : undefined}
                      className="mb-0.5 flex h-[44px] w-full items-center gap-3 rounded-[8px] px-3 text-left text-[15.5px] font-medium transition hover:bg-white/[0.04]"
                      style={on ? { background: S.accentSoft, color: '#fff', boxShadow: `inset 3px 0 0 ${S.accent}` } : { color: S.dim }}>
                      <span style={{ color: on ? S.accent : undefined }}>{s.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {err && <Dot tone="bad" />}
                      {badge != null && <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[12px]" style={{ background: badge === 'GO' ? S.accent : 'rgba(255,255,255,.08)', color: badge === 'GO' ? '#fff' : S.dim }}>{badge}</span>}
                    </button>
                    {/* The section's pages live here (one level of navigation: no tabs inside tabs). */}
                    {on && s.tabs && (
                      <div className="mb-1.5 ml-[22px] border-l pl-2" style={{ borderColor: S.line2 }} role="tablist" aria-label={`${s.label} pages`}>
                        {s.tabs.map(t => (
                          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTabs({ ...tabs, [s.id]: t.id })} data-subnav={t.id} data-subtab={t.id}
                            className="flex h-[36px] w-full items-center rounded-[6px] px-3 text-left text-[14.5px] transition hover:bg-white/[0.05]"
                            style={tab === t.id ? { color: '#fff', background: 'rgba(255,255,255,.07)', fontWeight: 600 } : { color: S.dim }}>{t.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
            <SceneLibrary cat={cat} sel={sel} onSelect={setSel} st={st} onAdd={addSegment} />
          </aside>
          <Handle axis="x" onPointerDown={dragL} onDoubleClick={() => setLeftOpen(false)} />
        </> : !maxWs ? (
          <aside className="flex w-[62px] flex-none flex-col items-center gap-1 border-r py-3" style={{ background: S.rail, borderColor: S.line }} data-rail="collapsed">
            <IconBtn title="Show the sidebar" onClick={() => setLeftOpen(true)} size={42}>{I.sidebar}</IconBtn>
            <span className="my-1 h-px w-8 bg-white/10" />
            {SECTIONS.map(s => <IconBtn key={s.id} title={s.label} active={section === s.id} onClick={() => setSection(s.id)} size={42}>{s.icon}</IconBtn>)}
          </aside>
        ) : null}

        {/* ============ centre: monitors (Overview / Preview layouts) + workspace */}
        <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {centreMonitors ? <>
            <section className="flex flex-none flex-col" style={{ height: monH }} data-monitors={layout}>
              <div className="flex min-h-0 flex-1 gap-[6px] px-3 pt-3">
                <Monitor kind="preview" title={entry?.name ?? '—'} extra={previewTools}
                  note={view === 'draft' ? (entry?.gfx?.draft || eng.dirty ? 'Prepared changes shown · not on air' : 'Same as the live source') : 'What the browser source shows now'}>
                  {previewBody(true)}
                </Monitor>
                {pgmOpen && (
                  <div className="flex min-h-0 flex-none flex-col gap-[6px]" style={{ width: layout === 'preview' ? '30%' : '36%', maxWidth: 760 }}>
                    <Monitor kind="program" title={st.obs.connected ? st.obs.currentScene ?? '—' : 'No live output'} extra={<IconBtn title="Hide the Program monitor" onClick={() => setPgmOpen(false)}>{I.x}</IconBtn>}
                      note={p.programKey ? 'Overdrive source on air in OBS (live data)' : st.obs.connected ? 'OBS Program is not an Overdrive scene' : 'OBS not connected'}>
                      <div className="absolute inset-0 bg-black" data-program={p.programKey ?? ''}>{p.programKey ? p.renderTarget(p.programKey, 'live') : <div className="grid h-full place-items-center text-[44px] tracking-[0.2em] text-white/25">{st.obs.connected ? st.obs.currentScene : 'NO LIVE OUTPUT'}</div>}</div>
                    </Monitor>
                    <OnAirStrip st={st} now={now} />
                  </div>
                )}
              </div>
              <div className="flex h-[32px] flex-none items-center gap-3 px-4 text-[13px] text-white/45">
                <span className="font-mono">{entry?.route}</span><span>· {sourceSizeLabel(st.obsSetup?.options.profile)}</span>
                <span className="ml-auto flex items-center gap-2">
                  {!pgmOpen && <Btn size="sm" kind="ghost" onClick={() => setPgmOpen(true)}>Show Program</Btn>}
                  <Btn size="sm" kind="ghost" onClick={() => setMonOpen(false)} icon={I.up}>Collapse monitors</Btn>
                </span>
              </div>
            </section>
            <Handle axis="y" onPointerDown={dragM} onDoubleClick={() => setMonOpen(false)} />
          </> : !maxWs && layout !== 'focus' ? (
            <div className="flex h-[44px] flex-none items-center gap-3 border-b px-4" style={{ borderColor: S.line }}>
              <span className={`${COND} text-[14px] tracking-[0.12em] text-white/60`}>Preview</span><b>{entry?.name}</b>
              <Btn size="sm" kind="ghost" className="ml-auto" onClick={() => setMonOpen(true)} icon={I.down}>Show monitors</Btn>
            </div>
          ) : null}

          <section className="flex min-h-0 flex-1 flex-col px-4 pb-3" data-workspace={section}>
            <div className="flex flex-none items-center gap-3 py-2.5">
              <span style={{ color: S.accent }}>{sec.icon}</span>
              <h2 className={`${COND} text-[23px] tracking-[0.08em]`}>{sec.label}{page && <span className="text-white/45"> · {page.label}</span>}</h2>
              <span className="truncate text-[14px] text-white/45">{sec.about}</span>
              <span className="ml-auto flex flex-none items-center gap-2">
                {maxWs && <Btn size="sm" onClick={() => setMaxWs(false)} icon={I.x}>Exit full workspace (Esc)</Btn>}
                {!maxWs && <IconBtn title="Full workspace: this section fills the window (Esc to leave)" onClick={() => setMaxWs(true)}>{I.expand}</IconBtn>}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {section === 'scenes' && <ScenesSection tab={tab} st={st} run={run} x={ctx} entry={entry} onAddSegment={addSegment} />}
              {section === 'talent' && <TalentManager st={st} eng={eng} run={run} viewer={p.viewer} setCams={p.setCams} />}
              {section === 'data' && <DataSection tab={tab} st={st} x={ctx} />}
              {section === 'rundown' && <ShowRundown st={st} run={run} now={now} sel={sel} onSelect={t => setSel(targetToSel(t))} />}
              {section === 'automation' && <AutomationBuilder st={st} eng={eng} run={run} now={now} openProducer={p.onProducer} />}
              {section === 'media' && <MediaSection tab={tab} st={st} x={ctx} musicScene={musicScene} setMusicScene={setMusicScene} />}
              {section === 'obs' && <ObsSection tab={tab} st={st} eng={eng} run={run} />}
              {section === 'show' && <ShowSection tab={tab} st={st} run={run} x={ctx} />}
            </div>
          </section>
        </main>

        {/* ============ inspector (Focus layout: with a compact preview on top) */}
        {showRight ? <>
          <Handle axis="x" onPointerDown={dragR} onDoubleClick={() => setRightOpen(false)} />
          <aside className="flex min-h-0 flex-none flex-col overflow-y-auto" style={{ width: right, background: S.rail }} data-inspector-column>
            {(layout === 'focus' || !monOpen) && entry && (
              <div className="flex-none border-b p-3" style={{ borderColor: S.line }} data-compact-preview>
                <div className="mb-2 flex items-center gap-2"><Pill tone="pvw">Preview</Pill><b className="min-w-0 flex-1 truncate text-[14.5px]">{entry.name}</b>{previewTools}</div>
                <Fit169 className="aspect-video w-full rounded-[8px] bg-black">{previewBody(false)}</Fit169>
              </div>
            )}
            <InspectorColumn {...p} entry={entry} go={go} onCollapse={() => setRightOpen(false)} />
          </aside>
        </> : !maxWs ? (
          <aside className="flex w-[54px] flex-none flex-col items-center border-l py-3" style={{ background: S.rail, borderColor: S.line }}>
            <IconBtn title="Show the inspector" onClick={() => setRightOpen(true)} size={42}>{I.panel}</IconBtn>
            {st.plan?.pending && <span className="mt-3 rounded-[5px] px-1.5 py-1 text-[11px] font-bold" style={{ background: S.accent }}>GO</span>}
          </aside>
        ) : null}
      </div>
      <StatusBar {...p} issues={issues} />
      {full && entry && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" data-fullscreen>
          <div className="flex h-[52px] flex-none items-center gap-3 px-4"><Pill tone="pvw">Preview · {view}</Pill><b className="text-[17px]">{entry.name}</b><Btn size="sm" className="ml-auto" onClick={() => setFull(false)} icon={I.x}>Close (Esc)</Btn></div>
          <Fit169 className="flex-1">{previewBody(true)}</Fit169>
        </div>
      )}
      {palette && <QuickSwitcher cat={cat} sections={SECTIONS} onClose={() => setPalette(false)}
        onScene={k => { setSel(k); setPalette(false); }} onPage={(s, t) => { go(s, t); setPalette(false); }} onLayout={l => { setLayout(l); setMaxWs(false); setPalette(false); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ quick switcher (Ctrl/Cmd+K)
function QuickSwitcher({ cat, sections, onClose, onScene, onPage, onLayout }: { cat: SceneEntry[]; sections: typeof SECTIONS; onClose: () => void; onScene: (k: string) => void; onPage: (s: Section, t?: string) => void; onLayout: (l: Layout) => void }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0);
  const items = useMemo(() => {
    const all: { kind: string; label: string; sub: string; run: () => void }[] = [
      ...sections.flatMap(s => s.tabs ? s.tabs.map(t => ({ kind: 'Page', label: `${s.label} › ${t.label}`, sub: s.about, run: () => onPage(s.id, t.id) })) : [{ kind: 'Page', label: s.label, sub: s.about, run: () => onPage(s.id) }]),
      ...cat.map(c => ({ kind: c.kind === 'graphic' ? 'Graphic' : 'Scene', label: c.name, sub: `${c.category} · ${c.route}`, run: () => onScene(c.key) })),
      ...LAYOUTS.map(l => ({ kind: 'Layout', label: `Layout: ${l.label}`, sub: `${l.about} · Alt+${l.key}`, run: () => onLayout(l.id) })),
    ];
    const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Name matches first (scenes/pages whose title contains the words), then matches in the description.
    const hit = all.filter(x => w.every(t => `${x.kind} ${x.label} ${x.sub}`.toLowerCase().includes(t)));
    const inName = (x: typeof all[number]) => w.every(t => `${x.kind} ${x.label}`.toLowerCase().includes(t)) ? 0 : 1;
    return hit.map((x, k) => ({ x, k, r: inName(x) })).sort((a, b) => a.r - b.r || a.k - b.k).map(e => e.x).slice(0, 14);
  }, [q, cat, sections, onPage, onScene, onLayout]);
  useEffect(() => setI(0), [q]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center bg-black/60 pt-[12vh]" onClick={onClose} data-quick-switcher>
      <div className="w-[min(760px,92vw)] overflow-hidden rounded-[12px] border shadow-2xl" style={{ background: S.raised, borderColor: S.line2 }} onClick={e => e.stopPropagation()}>
        <label className="flex h-[60px] items-center gap-3 border-b px-5" style={{ borderColor: S.line }}>
          <span className="text-white/45">{I.search}</span>
          <input autoFocus aria-label="Jump to a scene, page or layout" value={q} onChange={e => setQ(e.target.value)} placeholder="Jump to a scene, page or layout…"
            onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(n => Math.min(items.length - 1, n + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI(n => Math.max(0, n - 1)); } if (e.key === 'Enter') items[i]?.run(); }}
            className="min-w-0 flex-1 bg-transparent text-[18px] outline-none" />
          <kbd className="rounded border border-white/20 px-1.5 text-[12px] text-white/50">Esc</kbd>
        </label>
        <ul className="max-h-[56vh] overflow-y-auto p-2">
          {items.map((x, k) => (
            <li key={`${x.kind}-${x.label}`}><button type="button" onMouseEnter={() => setI(k)} onClick={x.run} data-qs-item={x.label}
              className="flex w-full items-center gap-4 rounded-[8px] px-4 py-3 text-left" style={k === i ? { background: S.accentSoft } : undefined}>
              <span className={`${COND} w-[70px] flex-none text-[12.5px] tracking-[0.12em]`} style={{ color: x.kind === 'Scene' ? S.ok : x.kind === 'Graphic' ? '#ff8a72' : x.kind === 'Layout' ? S.info : S.dim }}>{x.kind}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{x.label}</span><span className="block truncate text-[13px] text-white/45">{x.sub}</span></span>
            </button></li>
          ))}
          {!items.length && <li className="px-4 py-6 text-center text-white/45">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ top bar
function TopBar(p: StudioProps & { issues: ReturnType<typeof studioIssues>; onIssues: (where: string) => void; layout: Layout; setLayout: (l: Layout) => void; maxWs: boolean; setMaxWs: (v: boolean) => void; onPalette: () => void }) {
  const { st } = p;
  const [open, setOpen] = useState(false);
  const errs = p.issues.filter(i => i.level === 'error').length;
  const event = st.events.find(e => e.id === st.activeEvent)?.name ?? 'Overdrive';
  return (
    <header className="relative z-30 flex h-[64px] flex-none items-center gap-4 whitespace-nowrap border-b px-5" style={{ background: '#0b0b0e', borderColor: S.line }} data-topbar>
      <img src="/brand/overdrive/logo.png" alt="Overdrive" className="h-[26px] w-auto" draggable={false} />
      <span className="h-[30px] w-px bg-white/10" />
      <div className="hidden leading-tight min-[2200px]:block"><div className={`${COND} text-[22px] tracking-[0.08em]`}>Studio Mode</div><div className="text-[11.5px] uppercase tracking-[0.22em] text-white/45">Configure · Prepare · Build · Test</div></div>
      <div className="flex items-center gap-2" role="group" aria-label="Mode">
        <Btn kind="accent" onClick={() => {}} icon={I.scenes} data-mode-btn="studio" title="Studio Mode (Alt+2)">Studio<span className="hidden min-[2200px]:inline">&nbsp;Mode</span></Btn>
        <Btn onClick={p.onProducer} icon={I.play} data-mode-btn="producer" title="Producer Mode: operate the show live (Alt+1)">Producer<span className="hidden min-[2200px]:inline">&nbsp;Mode</span></Btn>
        <div className="ml-1 flex h-[40px] items-center gap-2 rounded-[6px] border px-3" style={{ borderColor: st.obs.connected ? 'rgba(229,72,77,.5)' : S.line }} title="OBS Program" data-onair>
          <span className={`h-[9px] w-[9px] rounded-full ${st.obs.connected ? 'animate-pulse' : ''}`} style={{ background: st.obs.connected ? S.pgm : 'rgba(255,255,255,.3)' }} />
          <span className={`${COND} hidden text-[14px] tracking-[0.1em] min-[2200px]:inline`}>On air</span>
          <span className="max-w-[170px] truncate text-[14px] text-white/75 min-[2200px]:max-w-[260px]">{st.obs.connected ? st.obs.currentScene ?? '—' : 'OBS offline'}</span>
        </div>
      </div>
      {/* Workspace layouts: instant switching (Alt+O / Alt+F / Alt+P), sizes remembered per layout */}
      <div className="ml-auto flex items-center gap-2" data-layouts>
        <div className="inline-flex overflow-hidden rounded-[8px] border" style={{ borderColor: S.line2 }} role="group" aria-label="Workspace layout">
          {LAYOUTS.map(l => (
            <button key={l.id} type="button" onClick={() => p.setLayout(l.id)} aria-pressed={!p.maxWs && p.layout === l.id} title={`${l.about} (Alt+${l.key})`} data-layout-btn={l.id}
              className={`${COND} h-[40px] px-3.5 text-[14.5px] tracking-[0.08em] transition ${!p.maxWs && p.layout === l.id ? 'text-white' : 'text-white/55 hover:bg-white/[0.05]'}`}
              style={!p.maxWs && p.layout === l.id ? { background: 'rgba(255,255,255,.12)', boxShadow: `inset 0 -3px 0 ${S.accent}` } : undefined}>{l.label}</button>
          ))}
        </div>
        <IconBtn title="Full workspace: the configuration fills the window (Esc to leave)" active={p.maxWs} onClick={() => p.setMaxWs(!p.maxWs)} size={40}>{I.expand}</IconBtn>
        <button type="button" onClick={p.onPalette} title="Jump to any scene, page or layout (Ctrl+K)" data-open-switcher className="flex h-[40px] items-center gap-2 rounded-[8px] border px-3 text-[14px] text-white/60 hover:text-white" style={{ borderColor: S.line2 }}>
          {I.search}<span className="hidden min-[2200px]:inline">Jump to…</span><kbd className="rounded border border-white/20 px-1 text-[11.5px]">Ctrl K</kbd></button>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden h-[40px] items-center gap-2 rounded-[8px] border px-3 min-[1800px]:flex" style={{ borderColor: S.line, background: S.panel }} title="Active event (switch events in the Controller)">
          <span className="text-white/45">{I.file}</span><div className="leading-tight"><div className="max-w-[180px] truncate text-[14px] font-semibold min-[2200px]:max-w-[260px]">{event}</div><div className="max-w-[180px] truncate text-[11.5px] text-white/45">{st.showLive.tournament || 'Event'}</div></div>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setOpen(!open)} className={`${COND} flex h-[40px] items-center gap-2 rounded-[8px] border px-3.5 text-[15px] tracking-[0.06em]`} data-readiness
            style={{ borderColor: errs ? 'rgba(229,72,77,.55)' : p.issues.length ? 'rgba(245,165,36,.55)' : 'rgba(47,191,113,.5)', color: errs ? '#ff8f92' : p.issues.length ? S.warn : '#5fd99a' }}>
            {errs ? I.warn : p.issues.length ? I.warn : I.check}{errs ? `${errs} blocking` : p.issues.length ? `${p.issues.length} to check` : 'Studio ready'}
          </button>
          {open && (
            <div className="absolute right-0 top-[48px] w-[420px] rounded-[10px] border p-3 shadow-2xl" style={{ background: S.raised, borderColor: S.line2 }} data-readiness-list>
              {p.issues.length ? p.issues.map((i, k) => (
                <button key={k} type="button" onClick={() => { setOpen(false); p.onIssues(i.where); }} className="flex w-full items-start gap-2 rounded-[6px] px-2 py-2 text-left text-[14px] hover:bg-white/[0.05]" style={{ color: i.level === 'error' ? '#ff8f92' : S.warn }}>{I.warn}<span>{i.text}</span></button>
              )) : <div className="p-2 text-[14px] text-white/60">Everything the show needs is in place.</div>}
            </div>
          )}
        </div>
        <IconBtn title="Sign out" onClick={() => fetch('/api/logout', { method: 'POST' }).finally(p.onLogout)} size={40}>{I.logout}</IconBtn>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ scene library
function SceneLibrary({ cat, sel, onSelect, st, onAdd }: { cat: SceneEntry[]; sel: string; onSelect: (k: string) => void; st: ControllerState; onAdd: (target: string, name: string) => void }) {
  const [open, setOpen] = useLocal('od.studio.libOpen', true, v => typeof v === 'boolean');
  const [q, setQ] = useState('');
  const [f, setF] = useLocal('od.studio.libFilter', 'all', v => typeof v === 'string');
  const [fav, setFav] = useLocal<string[]>('od.studio.fav', [], Array.isArray);
  const list = cat.filter(c => (f === 'all' || (f === 'fav' ? fav.includes(c.key) : c.category === f)) && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  const pgm = st.obs.currentScene;
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t" style={{ borderColor: S.line }} data-scene-library>
      <button type="button" onClick={() => setOpen(!open)} className="flex h-[46px] flex-none items-center gap-2 px-4 text-left" aria-expanded={open}>
        <span className="text-white/50">{I.grid}</span><span className={`${COND} text-[15px] tracking-[0.1em]`}>Scene library</span><span className="text-[13px] text-white/40">({cat.length})</span>
        <span className={`ml-auto text-white/40 transition-transform ${open ? '' : '-rotate-90'}`}>{I.chevron}</span>
      </button>
      {open && <>
        <div className="flex-none space-y-2 px-3 pb-2">
          <label className="flex h-[36px] items-center gap-2 rounded-[6px] border px-2.5" style={{ borderColor: S.line2, background: '#0a0a0d' }}>
            <span className="text-white/40">{I.search}</span><input aria-label="Search scenes" value={q} onChange={e => setQ(e.target.value)} placeholder="Search scenes…  ↑ ↓ to move"
              onKeyDown={e => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const i = list.findIndex(c => c.key === sel); const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) onSelect(n.key); }}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
          </label>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(([k, l]) => <button key={k} type="button" onClick={() => setF(k)} className="h-[28px] rounded-[5px] px-2.5 text-[12.5px] font-semibold transition" style={f === k ? { background: S.accent, color: '#fff' } : { background: 'rgba(255,255,255,.05)', color: S.dim }}>{l}</button>)}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {list.map((c, i) => {
            const on = c.key === sel, isFav = fav.includes(c.key);
            const head = f === 'all' && !q && (i === 0 || list[i - 1].category !== c.category);
            const live = !!pgm && (c.gfx?.obsScene === pgm || (st.obsSetup?.map?.[c.target]?.scene === pgm));
            return (
              <Fragment key={c.key}>{head && <li className={`${COND} px-2 pb-1 pt-3 text-[12px] tracking-[0.16em] text-white/40`} data-lib-group={c.category}>{c.category}</li>}
              <li data-lib-item={c.key} className="group mb-0.5 flex h-[50px] cursor-pointer items-center gap-2.5 rounded-[7px] px-2 transition" onClick={() => onSelect(c.key)}
                onDoubleClick={() => onAdd(c.target, c.name)} title="Click: preview & inspect · double-click: add to the show rundown"
                style={on ? { background: S.accentSoft, boxShadow: `inset 0 0 0 1px ${S.accent}` } : undefined}>
                <span className={`${COND} grid h-[30px] w-[48px] flex-none place-items-center rounded-[4px] text-[11.5px] tracking-[0.06em]`} style={{ background: c.kind === 'graphic' ? 'rgba(255,59,31,.16)' : 'rgba(255,255,255,.07)', color: c.kind === 'graphic' ? '#ff8a72' : S.dim }}>{c.kind === 'graphic' ? 'GFX' : 'SCN'}</span>
                <div className="min-w-0 flex-1"><div className={`truncate text-[15px] ${on ? 'font-semibold text-white' : 'text-white/85'}`}>{c.name}</div><div className="truncate text-[12px] text-white/40">{c.kind === 'graphic' ? 'Graphic' : 'Scene'} · {c.route}</div></div>
                {live && <span className="rounded-[4px] px-1 text-[10.5px] font-bold" style={{ background: S.pgm }}>PGM</span>}
                {c.gfx?.draft && <span className="rounded-[4px] px-1 text-[10.5px] font-bold text-black" style={{ background: S.warn }}>DRAFT</span>}
                <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: c.conns ? S.ok : 'rgba(255,255,255,.2)' }} title={c.conns ? `${c.conns} browser source(s) open` : 'No browser source open'} />
                <button type="button" aria-label={isFav ? 'Unstar' : 'Star'} onClick={e => { e.stopPropagation(); setFav(isFav ? fav.filter(x => x !== c.key) : [...fav, c.key]); }} className={`flex-none transition ${isFav ? 'text-[#ffb020]' : 'text-white/25 opacity-0 group-hover:opacity-100'}`} style={isFav ? { fill: '#ffb020' } : undefined}>{I.star}</button>
              </li></Fragment>
            );
          })}
          {!list.length && <li className="px-3 py-4 text-[13px] text-white/45">No scene matches.</li>}
        </ul>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ monitors
function Monitor({ kind, title, extra, note, children }: { kind: 'preview' | 'program'; title: string; extra?: ReactNode; note: string; children: ReactNode }) {
  const c = kind === 'preview' ? S.pvw : S.pgm;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border" style={{ borderColor: S.line, background: S.panel }} data-monitor={kind}>
      <div className="flex h-[44px] flex-none items-center gap-2.5 border-b px-3" style={{ borderColor: S.line }}>
        <span className={`${COND} rounded-[4px] px-2 py-0.5 text-[13px] tracking-[0.12em]`} style={{ background: `${c}22`, color: c, boxShadow: `inset 0 0 0 1px ${c}66` }}>{kind === 'preview' ? 'Preview' : 'Program'}</span>
        <b className="min-w-0 truncate text-[15px]">{title}</b>
        <span className="hidden truncate text-[12.5px] text-white/40 xl:inline">{note}</span>
        <div className="ml-auto flex flex-none items-center gap-1.5">{extra}</div>
      </div>
      <Fit169 className="min-h-0 flex-1 bg-black/60">{children}</Fit169>
    </div>
  );
}

function OnAirStrip({ st, now }: { st: ControllerState; now: number }) {
  const p = st.plan;
  const air = p?.onAir ? p.segments.find(s => s.id === p.onAir!.id) : undefined, nxt = p?.next ? p.segments.find(s => s.id === p.next) : undefined;
  const el = p?.onAir ? now - p.onAir.at : 0, left = air?.dur ? air.dur * 1000 - el : null;
  return (
    <div className="grid flex-none grid-cols-2 gap-[6px]" data-onair-strip>
      <div className="rounded-[10px] border px-3 py-2" style={{ borderColor: 'rgba(229,72,77,.35)', background: 'rgba(229,72,77,.07)' }}>
        <div className={`${COND} text-[12px] tracking-[0.14em] text-[#ff8f92]`}>On air</div>
        <div className="truncate text-[15px] font-semibold">{air?.label ?? '—'}</div>
        <div className="font-mono text-[14px]" style={{ color: left != null && left < 0 ? S.bad : S.dim }}>{air ? (left != null ? `${left < 0 ? '+' : '−'}${fmtClock(Math.abs(left))}` : fmtClock(el)) : 'no segment'}</div>
      </div>
      <div className="rounded-[10px] border px-3 py-2" style={{ borderColor: 'rgba(47,191,113,.35)', background: 'rgba(47,191,113,.06)' }}>
        <div className={`${COND} text-[12px] tracking-[0.14em] text-[#5fd99a]`}>Next</div>
        <div className="truncate text-[15px] font-semibold">{nxt?.label ?? '—'}</div>
        <div className="truncate text-[13px] text-white/50">{nxt ? (segReady(st, nxt).level === 'ready' ? 'ready' : `${segReady(st, nxt).issues.length} issue(s)`) : 'nothing prepared'}</div>
      </div>
    </div>
  );
}

function Guides() {
  const box = (pc: number, c: string) => <div className="absolute border-2" style={{ left: `${(100 - pc) / 2}%`, top: `${(100 - pc) / 2}%`, width: `${pc}%`, height: `${pc}%`, borderColor: c }} />;
  return <div className="pointer-events-none absolute inset-0" data-guides>{box(93, 'rgba(0,200,255,.55)')}{box(90, 'rgba(255,220,0,.55)')}<div className="absolute left-1/2 top-1/2 h-[60px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-white/50" /><div className="absolute left-1/2 top-1/2 h-[2px] w-[60px] -translate-x-1/2 -translate-y-1/2 bg-white/50" /></div>;
}

// ------------------------------------------------------------------ inspector column
function InspectorColumn(p: StudioProps & { entry: SceneEntry | undefined; go: (s: Section, t?: string) => void; onCollapse: () => void }) {
  const { st, eng, run, now, entry } = p;
  const plan = st.plan;
  const [confirmPub, setConfirmPub] = useState(false);
  useEffect(() => { if (!confirmPub) return; const t = setTimeout(() => setConfirmPub(false), 4000); return () => clearTimeout(t); }, [confirmPub]);
  const prepared = [...eng.draft.map(draftLabel), ...(st.graphics ?? []).filter(g => g.draft).map(g => `${g.name} (graphic)`), ...(eng.dirty && !eng.draft.length && !(st.graphics ?? []).some(g => g.draft) ? ['scene / desk changes'] : [])];
  const segName = (id: string) => plan?.segments.find(s => s.id === id)?.label ?? 'removed';
  return (
    <>
      <div className="flex h-[48px] flex-none items-center gap-2 border-b px-4" style={{ borderColor: S.line }}>
        <span className={`${COND} text-[16px] tracking-[0.12em]`}>Inspector</span>
        <IconBtn title="Hide the inspector" onClick={p.onCollapse}>{I.right}</IconBtn>
      </div>

      {plan?.pending && (
        <div className="m-3 rounded-[10px] border p-3" style={{ borderColor: S.accent, background: S.accentSoft }} data-inspector-pending>
          <div className="flex items-center gap-2 text-[#ff8a72]">{I.bolt}<span className={`${COND} text-[14px] tracking-[0.12em]`}>Waiting for producer GO</span><span className="ml-auto font-mono text-[13px]">{fmtClock(now - plan.pending.at)}</span></div>
          <div className="mt-1.5 text-[15px] font-semibold">{plan.pending.text}</div>
          <div className="mt-1 text-[12.5px] text-white/55">Then: {plan.pending.rest.map(a => actionLabel(a, segName)).join(' → ') || 'GO'}</div>
          <div className="mt-3 flex gap-2"><Btn size="sm" kind="accent" onClick={p.onProducer}>Open Producer Mode</Btn><Btn size="sm" kind="danger" onClick={() => run({ c: 'sp-cancel' }, 'Cancel automation step')}>Cancel</Btn></div>
        </div>
      )}

      <Fold id="selected" title="Selected scene" icon={I.eye} extra={entry ? <Btn size="sm" kind="ghost" onClick={() => p.go('scenes', 'settings')}>Edit</Btn> : undefined}>
        {entry ? (
          <div className="space-y-2.5 text-[14px]" data-inspector-selected={entry.key}>
            <div className="text-[17px] font-semibold">{entry.name}</div>
            <div className="flex flex-wrap gap-1.5">
              <Pill>{entry.kind === 'graphic' ? 'Graphic' : 'Scene source'}</Pill><Pill>{entry.category}</Pill>
              {entry.gfx?.draft && <Pill tone="warn">Draft</Pill>}
              {entry.gfx && <Pill tone={entry.gfx.anim.action === 'out' ? 'dim' : 'pgm'}>{entry.gfx.anim.action === 'out' ? 'Out' : 'In'} on its source</Pill>}
            </div>
            <Row k="Source" v={<span className="font-mono text-[13px]">{entry.route}</span>} />
            <Row k="Open in OBS" v={<span style={{ color: entry.conns ? S.ok : S.faint }}>{entry.conns ? `${entry.conns} browser source${entry.conns === 1 ? '' : 's'}` : 'none'}</span>} />
            {entry.gfx && <Row k="Presets" v={entry.gfx.presets.length ? entry.gfx.presets.map(q => q.name).join(', ') : '—'} />}
            <Btn size="sm" className="w-full" onClick={() => run({ c: 'sp-seg-add', seg: { label: entry.name, target: entry.target, dur: 120, transition: 'stinger' } }, `${entry.name} → show rundown`)} icon={I.plus}>Add to show rundown</Btn>
          </div>
        ) : <div className="text-white/45">Nothing selected.</div>}
      </Fold>

      <Fold id="show" title="Show rundown" icon={I.rundown} extra={<Btn size="sm" kind="ghost" onClick={() => p.go('rundown')}>Open</Btn>}>
        <RundownMini st={st} now={now} />
      </Fold>

      <Fold id="auto" title={<>Automation <span className="text-white/40">({plan?.rules.filter(r => r.on).length ?? 0} armed)</span></>} icon={I.auto} extra={<Btn size="sm" kind="ghost" onClick={() => p.go('automation')}>Edit</Btn>}>
        <div className="space-y-2">
          <Toggle on={!eng.autoHold} onChange={v => run({ c: 'automation', hold: !v }, v ? 'Automation resumed' : 'Automation held')} label={eng.autoHold ? 'Held (safe override)' : 'Automation armed'} />
          {(plan?.rules ?? []).slice(0, 6).map(r => (
            <div key={r.id} className="flex items-center gap-2 rounded-[7px] border px-2.5 py-2 text-[13.5px]" style={{ borderColor: S.line, opacity: r.on ? 1 : 0.5 }}>
              <span className="text-[#ff7a62]">{I.clock}</span><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="max-w-[45%] truncate text-[12px] text-white/45">{triggerLabel(r.when)}</span>
            </div>
          ))}
          {!plan?.rules.length && <div className="text-[13px] text-white/45">No automation yet.</div>}
        </div>
      </Fold>

      <Fold id="prepared" title={<>Prepared changes <span className="text-white/40">({prepared.length})</span></>} icon={I.check}>
        <div className="space-y-2.5">
          <div className="text-[13.5px] text-white/60" data-prepared-list>{prepared.length ? prepared.join(' · ') : 'Nothing prepared: every source shows the live content.'}</div>
          <div className="flex gap-2">
            <Btn size="sm" kind={confirmPub ? 'pgm' : 'draft'} disabled={!eng.dirty} className="flex-1" data-studio-publish
              title="Sends every prepared change to its browser source (what is on air in OBS changes). Never switches OBS."
              onClick={() => { if (!confirmPub) return setConfirmPub(true); setConfirmPub(false); run({ c: 'publish' }, 'Publish all (from Studio)'); }}>{confirmPub ? 'Confirm: publish to sources' : 'Publish…'}</Btn>
            <Btn size="sm" disabled={!eng.dirty} onClick={() => run({ c: 'revert' }, 'Revert prepared changes')}>Revert</Btn>
            <Btn size="sm" disabled={!eng.undo.length} onClick={() => run({ c: 'undo' }, 'Undo')} title={eng.undo[0] ? `Undo: ${eng.undo[0].label}` : undefined}>Undo</Btn>
          </div>
        </div>
      </Fold>

      <Fold id="activity" title="Activity" icon={I.clock} defaultOpen={true}>
        <NotesLog st={st} />
        <div className="mt-3 border-t pt-2 font-mono text-[12px] leading-[1.6]" style={{ borderColor: S.line }} data-log>
          {p.log.length ? p.log.slice(0, 10).map((l, i) => <div key={i} className="truncate" title={l.text} style={{ color: l.ok ? 'rgba(255,255,255,.55)' : S.warn }}>{new Date(l.at).toLocaleTimeString()} {l.ok ? '✓' : '✗'} {l.text}</div>) : <div className="text-white/35">Every command is acknowledged by the server; refusals show here.</div>}
        </div>
      </Fold>
    </>
  );
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex items-baseline gap-3"><span className="w-[96px] flex-none text-[13px] text-white/45">{k}</span><span className="min-w-0 truncate">{v}</span></div>;
}

// ------------------------------------------------------------------ status bar
function StatusBar(p: StudioProps & { issues: ReturnType<typeof studioIssues> }) {
  const { st, eng } = p;
  const open = st.outputs.reduce((a, o) => a + o.count, 0);
  const seated = (st.talent ?? []).filter(t => t.seat), live = seated.filter(t => t.mode === 'vdo' || t.publishing).length;
  const errs = p.issues.filter(i => i.level === 'error').length;
  const Item = ({ tone, children, title }: { tone: 'ok' | 'warn' | 'bad' | 'dim'; children: ReactNode; title?: string }) => <span className="flex items-center gap-2 whitespace-nowrap" title={title}><Dot tone={tone} />{children}</span>;
  return (
    <footer className="flex h-[36px] flex-none items-center gap-6 border-t px-5 text-[13px] text-white/70" style={{ background: '#0b0b0e', borderColor: S.line }} data-statusbar>
      <Item tone={errs ? 'bad' : p.issues.length ? 'warn' : 'ok'}>Studio: {errs ? `${errs} blocking` : p.issues.length ? `${p.issues.length} to check` : 'Ready'}</Item>
      <Item tone={st.obs.connected ? 'ok' : st.obs.enabled ? 'bad' : 'dim'}>OBS: {st.obs.connected ? `Connected · ${st.obs.currentScene ?? '—'}` : st.obs.enabled ? 'Offline' : 'Not set up'}</Item>
      <Item tone={open ? 'ok' : 'dim'}>Outputs: {open} source{open === 1 ? '' : 's'} ({sourceSizeLabel(st.obsSetup?.options.profile)})</Item>
      <Item tone={seated.length && live === seated.length ? 'ok' : seated.length ? 'warn' : 'dim'}>Talent: {live}/{seated.length} cameras</Item>
      <Item tone={eng.autoHold ? 'warn' : st.plan?.pending ? 'bad' : 'ok'}>Automation: {eng.autoHold ? 'Held' : st.plan?.pending ? 'GO pending' : `${st.plan?.rules.filter(r => r.on).length ?? 0} armed`}</Item>
      <Item tone={eng.dirty ? 'warn' : 'ok'}>{eng.dirty ? 'Prepared changes not published' : 'Draft = live'}</Item>
      <span className="ml-auto flex items-center gap-2"><Dot tone={p.conn === 'open' ? 'ok' : 'bad'} />Engine {p.conn === 'open' ? `${p.rtt != null ? `${p.rtt} ms` : 'online'} · v${eng.version}${p.busy ? ' · …' : ''}` : p.conn}</span>
    </footer>
  );
}

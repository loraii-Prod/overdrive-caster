/**
 * Overdrive 3.1 · PRODUCER CONTROL ROOM (prototype for approval: /producer?ui=room, or "Control room" in the header).
 *
 * A real-pixel, responsive layout (no scaled 1920×1480 canvas): it fills any window from 1920×1080 to 3840×2160.
 *
 *   top bar      brand · event · MATCH STRIP (teams, series, track, round, status) · MVP · health · OBS · clock
 *   monitors     PREVIEW (this console / OBS Preview, green tally) · TRANSPORT (CUT · AUTO · TAKE) · PROGRAM (OBS, red, LIVE)
 *   scene bank   Main scenes (thumbnails, tally) · Favourites · Library (every graphic, IN / OUT)
 *   context      the controls of the selected scene only (Gameplay: match, scoreboard, track… · Desks: talent, cameras…
 *                · MVP: the MVP panel) + its graphic settings
 *   right rail   Show rundown (on air, next + GO, upcoming, HOLD, automation) · Graphics rundown · Talent & audio
 *   status bar   Publish all · Revert · Undo · Live / Prepare data · Clear GFX · Reload sources · Hold auto · log
 *
 * Every control is an existing one (same commands, same modules, same server state); nothing here keeps its own copy
 * of match, MVP, rundown or audio data. Workspace (rail width, monitor height, thumbnails, open sections) is saved
 * per browser. The OBS Custom Browser Dock keeps its compact layout.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { EngineState, ProducerCmd } from '../../../shared/engine';
import type { ModuleId } from '../../../shared/registry';
import { sourceById } from '../../../shared/registry';
import { WINS_NEEDED, matchName, shortCode, wcLogo, wcResolve } from '../../../shared/wildcard';
import { MVP_SOURCE, MVP_VIEW_LABEL, isMvpSel, isShowSel, mainSceneOf, mvpViewOfSel, showModeOfSel, type MainScene } from '../../../shared/mainScenes';
import { isRevealView, mvpStage } from '../../../shared/mvpFlow';
import { majorMap } from '../../../shared/maps';
import { trackStory } from '../../../shared/trackProgress';
import { ModuleView, type Ack, type Ctx } from './modules';
import { MvpPanel } from './MvpPanel';
import { layerOf, obsSceneOfGfx, obsSceneOfSource } from './Library';
import { obsSceneOfMain } from './MainScenes';

type Run = (c: ProducerCmd, l: string) => Promise<Ack>;
type LogLine = { at: number; ok: boolean; text: string };
type Tr = 'obs' | 'stinger' | 'fade' | 'cut';

// ---------------------------------------------------------------- look
const K = {
  bg: '#070708', panel: '#0f0f11', raise: '#151518', line: '#232328', line2: '#2e2e35', text: '#f2f2f4', dim: '#a1a1aa', faint: '#62626b',
  red: '#E3261B', pgm: '#ff3030', pvw: '#22c55e', amber: '#f5a524', sel: '#e9e9ec',
};
const COND = "font-['Barlow_Condensed'] font-bold uppercase";
/** Scene order of the bank (the brief's order). */
// 3.3: ids after the Producer scene bank restructure (Show Screens consolidates starting/brb/ending/safe).
const ORDER = ['show', 'gameplay', 'caster-desk', 'analyst-desk', 'team-intro', 'mvp', 'veto', 'bracket', 'matches'];
/** Controls shown for each main scene (existing modules). */
const CONTEXT: Record<string, ModuleId[]> = {
  show: ['countdown', 'music', 'media', 'talent-casters'],
  gameplay: ['match', 'scoreboard', 'track', 'graphics'],
  'caster-desk': ['talent-casters', 'cameras', 'predictions'],
  'analyst-desk': ['talent-analysts', 'stats', 'h2h'],
  'team-intro': ['intro', 'showcase', 'predictions'],
  veto: ['veto', 'match', 'music'],
  bracket: ['bracket', 'match', 'music'],
  matches: ['match', 'bracket', 'music'],
};
const DESK = new Set(['caster-desk', 'analyst-desk', 'show']);

function useStored<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : init; } catch { return init; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }, [key, v]);
  return [v, setV];
}

/** A 1920×1080 renderer scaled into whatever box it gets. */
function Fit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / 1920)); ro.observe(el); setK(el.clientWidth / 1920);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="absolute inset-0 overflow-hidden">{k > 0 && <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${k})` }}>{children}</div>}</div>;
}

export interface RoomProps {
  st: ControllerState; eng: EngineState; ctx: Ctx; run: Run; log: LogLine[]; busy: boolean; conn: string; rtt: number | null; now: number;
  sel: string; setSel: (s: string) => void; mains: MainScene[];
  mvpD: { flow: import('../../../shared/mvpFlow').MvpFlowIn; match: string; poll?: { status: string; total?: number; closesAt?: number | null } | null } | null;
  thumb: (key: string) => ReactNode; renderTarget: (key: string, v: 'draft' | 'live') => ReactNode; programKey: string | null;
  obsTr: Tr; setObsTr: (t: Tr) => void; prepare: boolean; setPrepare: (v: boolean) => void; prepared: string[];
  selName: string; selObs?: string; inspector: ReactNode | null; mods: ModuleId[];
  library: ReactNode; rundownGfx: ReactNode; talent: ReactNode; health: ReactNode;
  onInstant: () => void; onLogout: () => void; onClassic: () => void; onStudio: () => void;
}

export function ControlRoom(p: RoomProps) {
  const { st, eng, ctx, run, sel, setSel, now } = p;
  const wc = ctx.wc;
  const [railW, setRailW] = useStored('od3.room.rail', 420);
  const [monVh, setMonVh] = useStored('od3.room.mon', 38);
  const [thumbs, setThumbs] = useStored<'all' | 'active'>('od3.room.thumbs', 'all');
  const [bankTab, setBankTab] = useStored<'main' | 'fav' | 'lib'>('od3.room.bank', 'main');
  const [favs, setFavs] = useStored<string[]>('od3.room.favs', []);
  const [open, setOpen] = useStored<{ talent: boolean; gfx: boolean }>('od3.room.open', { talent: true, gfx: false });
  const [ctxTab, setCtxTab] = useState<'controls' | 'graphic'>('controls');
  const [logOpen, setLogOpen] = useState(false);
  // interface scale: auto grows the console on very large viewports (a 4K screen at 100 % OS scaling); saved choice wins
  const [uiScale, setUiScale] = useStored<number>('od3.room.scale', 0);
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const zoom = uiScale > 0 ? uiScale : vw > 2600 ? Math.min(1.75, Math.round((vw / 2400) * 20) / 20) : 1;
  const [matchOpen, setMatchOpen] = useState(false);
  const scenes = [...p.mains].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const cur = mainSceneOf(sel, scenes);
  useEffect(() => { setCtxTab('controls'); }, [cur?.id]);
  // the desks' talent and voices open with the desk (context-sensitive), without changing the saved choice otherwise
  const talentOpen = open.talent || (!!cur && DESK.has(cur.id));

  // ---------------- transport (same commands as the classic Producer)
  const pgm = st.obs.currentScene, pvw = st.obs.studioMode ? st.obs.previewScene : undefined;
  const [armed, setArmed] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setArmed(false), [sel]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t); }, [msg]);
  const reveal = !!cur && cur.id === 'mvp' && isRevealView(mvpViewOfSel(sel) ?? 'voting');
  const confirm = st.graphics?.find(g => g.id === 'mvp')?.config.confirmReveal !== false;
  const selTarget = cur ? (cur.id === 'mvp' ? `s:${sel}` : cur.target) : sel.startsWith('g:') ? sel : `s:${sel}`;
  const go = async (tr: Tr, label: string) => {
    if (moving) return;
    if (reveal && confirm && !armed) { setArmed(true); return; }
    setArmed(false); setMoving(label);
    const r = cur || p.selObs ? await run({ c: 'scene-take', target: selTarget, transition: tr }, `${label} · ${cur?.label ?? p.selName}`) : { ok: false, error: 'No OBS scene for this selection' } as Ack;
    setMoving(null);
    setMsg(r.ok ? { ok: true, text: r.note ?? `${cur?.label ?? p.selName} on air` } : { ok: false, text: r.error ?? 'TAKE failed' });
  };
  const preview = (s: string) => {
    setSel(s);
    const m = mainSceneOf(s, scenes);
    const src = !m ? sourceById(s.replace(/^s:/, '')) : undefined, g = s.startsWith('g:') ? st.graphics?.find(x => x.id === s.slice(2)) : undefined;
    const o = m ? obsSceneOfMain(m, st) : g ? obsSceneOfGfx(g, st) : src ? obsSceneOfSource(src, st) : undefined;
    // the output being prepared: in the main-scenes layout its layer is shown in its scene when that scene is off air
    const target = m ? (m.id === 'mvp' ? `s:${s}` : m.target) : s.startsWith('g:') ? s : `s:${s}`;
    if (o && st.obs.connected) void run({ c: 'obs-preview', scene: o, target }, `OBS Preview: ${o}`);
  };
  const canTake = st.obs.connected && !!p.selObs;
  const selLayer = layerOf(selTarget, st);
  // on air = its scene is on Program AND (main layout) its layer is the one OBS shows
  const onAir = !!p.selObs && p.selObs === pgm && (!selLayer || selLayer.on || selTarget.startsWith('main:'));
  // 3.3: Show Screens covers 4 modes (sel/target vary); fall back on the active mode's own id (e.g. 'brb' → 'intermission'), not the 'show' wrapper id.
  const mainKey = st.obsSetup?.map?.[selTarget]?.main ?? (cur ? ({ brb: 'intermission' } as Record<string, string>)[isShowSel(sel) ? showModeOfSel(sel).id : cur.id] ?? (isShowSel(sel) ? showModeOfSel(sel).id : cur.id) : undefined);
  const mainRep = st.obsSetup?.mains?.find(x => x.key === mainKey && x.exists);

  // ---------------- match strip (the event's own match data: the cast match, its series, the current track)
  const R = wcResolve(wc.matches, wc.teams);
  const castId = wc.cast, m = castId ? R[castId] : null, raw = castId ? wc.matches[castId] : null;
  const s1 = Number(raw?.s1) || 0, s2 = Number(raw?.s2) || 0;
  const tk = wc.track.data, story = tk ? trackStory(tk) : null;
  const event = st.events?.find(e => e.id === st.activeEvent)?.name ?? st.showLive.brand.name;
  const status = !m ? '' : m.winner ? 'Final' : raw?.live || s1 + s2 > 0 ? 'Live' : 'Up next';

  // ---------------- resizing (saved)
  const drag = useRef<{ kind: 'rail' | 'mon'; x: number; y: number; v: number } | null>(null);
  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const d = drag.current; if (!d) return;
      if (d.kind === 'rail') setRailW(Math.round(Math.max(340, Math.min(720, d.v - (e.clientX - d.x) / zoomRef.current))));
      else setMonVh(Math.round(Math.max(24, Math.min(62, d.v + ((e.clientY - d.y) / window.innerHeight) * 100))));
    };
    const up = () => { drag.current = null; document.body.style.cursor = ''; };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  }, [setRailW, setMonVh]);
  const startDrag = (kind: 'rail' | 'mon') => (e: ReactPointerEvent) => { drag.current = { kind, x: e.clientX, y: e.clientY, v: kind === 'rail' ? railW : monVh }; document.body.style.cursor = kind === 'rail' ? 'col-resize' : 'row-resize'; e.preventDefault(); };

  // monitors: two 16:9 pictures as large as the row allows (height AND width), transport between them
  const monRef = useRef<HTMLElement>(null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const [monW, setMonW] = useState(640);
  useEffect(() => {
    const el = monRef.current; if (!el) return;
    // the row is only as tall as the monitors: the saved size is their maximum height (vh), the width can limit it
    const f = () => { const w = el.clientWidth - 24 - 148 - 24, h = (monVh / 100) * (window.innerHeight / zoomRef.current) - 12 - 50; setMonW(Math.max(320, Math.floor(Math.min(w / 2, (Math.max(200, h) * 16) / 9)))); };
    const ro = new ResizeObserver(f); ro.observe(el); window.addEventListener('resize', f); f();
    return () => { ro.disconnect(); window.removeEventListener('resize', f); };
  }, [monVh, zoom]);
  const fav = favs.includes(sel);
  const programLabel = pgm ?? (st.obs.connected ? '—' : 'OBS offline');
  const plan = st.plan;
  const air = plan?.onAir ? plan.segments.find(s => s.id === plan.onAir!.id) : undefined;
  const nxt = plan?.next ? plan.segments.find(s => s.id === plan.next) : undefined;
  const upcoming = plan ? plan.segments.slice(Math.max(0, plan.segments.findIndex(s => s.id === (nxt?.id ?? air?.id)) + 1)).slice(0, 4) : [];
  const el = plan?.onAir ? Math.round((now - plan.onAir.at) / 1000) : 0;
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const last = p.log[0];

  return (
    <div className="fixed left-0 top-0 flex flex-col overflow-hidden font-['Inter'] text-[13px] antialiased" style={{ background: K.bg, color: K.text, zoom, width: `${100 / zoom}vw`, height: `${100 / zoom}vh` }} data-control-room data-zoom={zoom}>
      {/* ================= top bar ================= */}
      <header className="flex h-[52px] flex-none items-stretch border-b" style={{ borderColor: K.line, background: `linear-gradient(180deg,#121214,#0b0b0d), repeating-linear-gradient(90deg,transparent 0 3px,rgba(255,255,255,.015) 3px 4px)` }}>
        <div className="flex items-center gap-3 px-4" style={{ borderRight: `1px solid ${K.line}` }}>
          <span className="h-[22px] w-[5px]" style={{ background: K.red }} />
          <span className={`${COND} text-[20px] tracking-[0.14em]`}>Overdrive</span>
          <div className="flex h-[26px] overflow-hidden rounded-[2px] border" style={{ borderColor: K.line2 }} data-room-mode>
            <span className={`${COND} grid place-items-center px-2.5 text-[12.5px] tracking-[0.1em]`} style={{ background: K.red }}>Producer</span>
            <button type="button" onClick={p.onStudio} className={`${COND} px-2.5 text-[12.5px] tracking-[0.1em] text-white/55 hover:bg-white/10`} title="Studio: prepare the show (Alt+2)">Studio</button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center px-4 max-[2200px]:max-w-[190px]" style={{ borderRight: `1px solid ${K.line}` }}>
          <span className={`${COND} text-[10.5px] tracking-[0.16em]`} style={{ color: K.faint }}>Event</span>
          <span className="max-w-[220px] truncate text-[13.5px] font-semibold" data-room-event>{event}{wc.rehearsal ? ' · REHEARSAL' : ''}</span>
        </div>
        {/* match strip */}
        <button type="button" onClick={() => setMatchOpen(v => !v)} className="relative flex min-w-0 flex-1 items-center gap-4 px-4 text-left hover:bg-white/[0.03]" data-match-strip title="Change the match being cast">
          {m ? <>
            <span className="flex flex-none flex-col">
              <span className={`${COND} whitespace-nowrap text-[10.5px] tracking-[0.16em]`} style={{ color: K.faint }}>{castId ? shortCode(castId) : ''} · Bo{WINS_NEEDED * 2 - 1}</span>
              <span className="max-w-[170px] truncate text-[12px] max-[2200px]:hidden" style={{ color: K.dim }}>{castId ? matchName(castId) : ''}</span>
            </span>
            <span className="flex flex-none items-center gap-2.5" data-match-teams>
              <Team name={m.t1} />
              <span className={`${COND} flex items-center gap-1 text-[26px] tabular-nums`} data-match-series>
                <span style={{ color: s1 > s2 ? K.text : K.dim }}>{s1}</span><span className="text-[16px]" style={{ color: K.faint }}>–</span><span style={{ color: s2 > s1 ? K.text : K.dim }}>{s2}</span>
              </span>
              <Team name={m.t2} right />
            </span>
            {tk && story && <span className="flex flex-none flex-col whitespace-nowrap" data-match-track>
              <span className={`${COND} text-[10.5px] tracking-[0.16em]`} style={{ color: K.faint }}>Track {tk.mapNumber ?? '?'} · {majorMap(tk.mapId)?.country ?? tk.track}</span>
              <span className="whitespace-nowrap text-[12.5px]"><b className="tabular-nums">{story.scoreA}–{story.scoreB}</b> <span style={{ color: K.dim }}>{story.done ? 'track won' : `round ${story.steps.length + 1}`}</span></span>
            </span>}
            <span className={`${COND} rounded-[2px] px-2 py-0.5 text-[12px] tracking-[0.12em]`} style={status === 'Live' ? { background: K.pgm, color: '#fff' } : { border: `1px solid ${K.line2}`, color: K.dim }} data-match-status>{status}</span>
          </> : <span style={{ color: K.dim }}>No match being cast · click to choose</span>}
          <span className="ml-auto text-[11px]" style={{ color: K.faint }}>▾</span>
        </button>
        <div className="flex items-center gap-3 px-4" style={{ borderLeft: `1px solid ${K.line}` }} data-room-status>
          <Pill hideBelow ok={p.conn === 'open'} label="Engine" value={p.conn === 'open' ? `${p.rtt ?? '–'} ms` : p.conn} />
          <Pill ok={st.obs.connected} warn={st.obs.enabled && !st.obs.connected} label="OBS" value={st.obs.connected ? (st.obs.studioMode ? 'Studio Mode' : 'connected') : st.obs.enabled ? 'offline' : 'off'} />
          <Pill ok={!eng.autoHold} warn={eng.autoHold} label="Auto" value={eng.autoHold ? 'held' : 'armed'} />
          {p.mvpD && <MvpChip p={p} onClick={() => { setBankTab('main'); preview(isMvpSel(sel) ? sel : MVP_SOURCE.voting); }} />}
          {p.health}
          <span className="font-mono text-[15px] tabular-nums" style={{ color: K.dim }}>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <button type="button" onClick={p.onClassic} className={`${COND} rounded-[2px] border px-2 py-0.5 text-[11px] tracking-[0.1em]`} style={{ borderColor: K.line2, color: K.dim }} title="Back to the current Producer layout" data-room-classic>Classic</button>
        </div>
        {matchOpen && <div className="absolute left-[480px] top-[56px] z-40 w-[460px] rounded-[3px] border p-3 shadow-2xl" style={{ background: K.raise, borderColor: K.line2 }} data-match-popover>
          <div className="mb-2 flex items-center"><span className={`${COND} text-[13px] tracking-[0.12em]`}>Match being cast</span><button type="button" className="ml-auto text-white/50" onClick={() => setMatchOpen(false)}>✕</button></div>
          <ModuleView id="match" x={ctx} pinned={false} />
        </div>}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ================= main column ================= */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* monitors + transport */}
          <section ref={monRef} className="flex flex-none items-start justify-center gap-3 px-3 pt-3" data-monitors>
            <Monitor w={monW} kind="pvw" title={cur ? `${cur.label}${cur.id === 'mvp' ? ` · ${MVP_VIEW_LABEL[mvpViewOfSel(sel) ?? 'voting']}` : ''}` : p.selName}
              tally={p.selObs && p.selObs === pvw ? 'OBS Preview' : st.obs.studioMode ? 'Not in OBS Preview' : 'This console'} live={p.selObs === pgm} sub={p.selObs ?? 'no OBS scene'}>
              {p.renderTarget(sel.startsWith('g:') ? sel : `s:${sel}`, 'draft')}
            </Monitor>
            <div className="flex w-[148px] flex-none flex-col justify-center gap-2" data-transport>
              <TBtn onClick={() => go('cut', 'CUT')} disabled={!canTake || !!moving} label="Cut" sub="instant" data-room-cut />
              <TBtn onClick={() => go('obs', 'AUTO')} disabled={!canTake || !!moving} label="Auto" sub="OBS transition" data-room-auto />
              <TBtn onClick={() => go(p.obsTr, armed ? 'CONFIRM' : 'TAKE')} disabled={!canTake || !!moving} big label={armed ? 'Confirm' : reveal ? 'Reveal' : 'Take'} sub={armed ? 'reveal on air' : p.obsTr === 'obs' ? 'OBS transition' : p.obsTr} take armed={armed} data-room-take={armed ? 'armed' : 'ready'} />
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border" style={{ borderColor: K.line2, background: K.line2 }} data-room-tr>
                {(['obs', 'stinger', 'fade', 'cut'] as Tr[]).map(t => <button key={t} type="button" onClick={() => p.setObsTr(t)} title={`TAKE uses: ${t}`} className={`${COND} h-[24px] text-[11.5px] tracking-[0.08em]`} style={p.obsTr === t ? { background: K.sel, color: '#000' } : { color: K.dim, background: '#111114' }}>{t === 'stinger' ? 'Sting' : t === 'obs' ? 'OBS' : t}</button>)}
              </div>
              <div className="min-h-[30px] text-center text-[11px] leading-tight" style={{ color: msg ? (msg.ok ? K.pvw : '#ff8a8d') : K.faint }} data-room-msg title={msg?.text}>
                {moving ? `${moving}…` : msg ? msg.text : !st.obs.connected ? 'OBS not connected' : onAir ? 'Selection is on air' : !p.selObs ? 'No OBS scene for this' : 'Preview → Program'}</div>
            </div>
            <Monitor w={monW} kind="pgm" title={programLabel} tally={moving ? 'Transition…' : 'LIVE'} live sub={st.obs.connected ? `OBS Program${st.obs.studioMode ? ' · Studio Mode' : ''}` : 'OBS not connected'}>
              {p.programKey ? p.renderTarget(p.programKey, 'live') : <div className="grid h-full place-items-center text-[40px] text-white/40" style={{ background: '#050506' }}>{st.obs.connected ? `${pgm ?? '—'} (not an Overdrive scene: game / camera capture)` : 'OBS not connected'}</div>}
            </Monitor>
          </section>
          <div role="separator" aria-orientation="horizontal" title="Drag: monitor size (saved)" onPointerDown={startDrag('mon')} onDoubleClick={() => setMonVh(38)} className="group flex h-[10px] flex-none cursor-row-resize items-center justify-center" data-room-mon-split>
            <span className="h-[3px] w-[60px] rounded-full bg-white/10 group-hover:bg-white/40" />
          </div>

          {/* scene bank */}
          <section className="mx-3 flex flex-none flex-col rounded-[3px] border" style={{ borderColor: K.line, background: K.panel }} data-scene-bank>
            <div className="flex h-[30px] items-stretch border-b" style={{ borderColor: K.line }}>
              {(['main', 'fav', 'lib'] as const).map(t => <button key={t} type="button" onClick={() => setBankTab(t)} data-bank-tab={t}
                className={`${COND} px-4 text-[13px] tracking-[0.12em]`} style={bankTab === t ? { color: K.text, boxShadow: `inset 0 -2px 0 ${K.red}` } : { color: K.faint }}>{t === 'main' ? 'Main scenes' : t === 'fav' ? `Favourites${favs.length ? ` · ${favs.length}` : ''}` : 'All graphics'}</button>)}
              <span className="ml-auto flex items-center gap-2 pr-3 text-[11px]" style={{ color: K.faint }}>
                Thumbnails
                {(['all', 'active'] as const).map(t => <button key={t} type="button" onClick={() => setThumbs(t)} className={`${COND} rounded-[2px] px-1.5 text-[11px] tracking-[0.06em]`} style={thumbs === t ? { background: K.line2, color: K.text } : undefined}>{t === 'all' ? 'live' : 'active only'}</button>)}
              </span>
            </div>
            {bankTab === 'lib' ? <div className="h-[220px] overflow-y-auto" data-bank-library>{p.library}</div> : (
              <div className="grid gap-2 p-2" style={{ gridTemplateColumns: `repeat(${Math.max(scenes.length, 7)}, minmax(0, 1fr))` }} data-bank-tiles>
                {(bankTab === 'main' ? scenes.map(s => ({ key: s.sel, label: s.label, s })) : favs.map(f => ({ key: f, label: labelOf(f, st, scenes), s: mainSceneOf(f, scenes) }))).map(({ key, label, s }) => {
                  const o = s ? obsSceneOfMain(s, st) : key.startsWith('g:') ? (st.graphics?.find(g => g.id === key.slice(2)) ? obsSceneOfGfx(st.graphics.find(g => g.id === key.slice(2))!, st) : undefined) : (sourceById(key) ? obsSceneOfSource(sourceById(key)!, st) : undefined);
                  const isP = !!o && o === pgm, isV = !!o && o === pvw, on = s ? cur?.id === s.id : sel === key;
                  const live = thumbs === 'all' || isP || isV || on || s?.id === 'mvp';
                  const stage = s?.id === 'mvp' && p.mvpD ? mvpStage(p.mvpD.flow) : null;
                  return (
                    <button key={key} type="button" onClick={() => preview(s?.id === 'mvp' && isMvpSel(sel) ? sel : key)} data-room-scene={s?.id ?? key} data-tally={isP ? 'pgm' : isV ? 'pvw' : on ? 'sel' : 'off'}
                      className="group flex min-w-0 flex-col overflow-hidden rounded-[3px] text-left" title={o ? `OBS: ${o}` : 'No OBS scene yet (Scene Builder)'}
                      style={{ background: on ? '#1b1b1f' : K.raise, boxShadow: `inset 0 0 0 ${isP || isV || on ? 3 : 1}px ${isP ? K.pgm : isV ? K.pvw : on ? K.sel : K.line}` }}>
                      <div className="relative m-[3px] aspect-video overflow-hidden rounded-[2px] bg-black">
                        {live ? <Fit>{p.thumb(s?.id === 'mvp' && isMvpSel(sel) ? sel : key)}</Fit> : <div className="h-full" style={{ background: 'linear-gradient(135deg,#1d1d22,#0b0b0e)' }} />}
                        {(isP || isV) && <span className={`${COND} absolute left-1 top-1 rounded-[2px] px-1.5 text-[11px] tracking-[0.08em] text-white`} style={{ background: isP ? K.pgm : K.pvw }}>{isP ? 'Program' : 'Preview'}</span>}
                        {!o && <span className="absolute right-1 top-1 text-[12px] font-black" style={{ color: K.amber }}>⚠</span>}
                      </div>
                      <div className="flex items-center gap-1 px-2 pb-1.5">
                        <span className={`${COND} min-w-0 flex-1 truncate text-[15px] tracking-[0.06em]`} style={{ color: on ? K.text : '#cfcfd4' }}>{label}</span>
                        {stage && <span className={`${COND} text-[11px] tracking-[0.06em]`} style={{ color: stage === 'open' ? K.pgm : stage === 'none' ? K.faint : K.pvw }} data-room-mvp-stage={stage}>{stage === 'none' ? '—' : stage === 'prepared' ? 'Ready' : stage}</span>}
                      </div>
                    </button>
                  );
                })}
                {bankTab === 'fav' && !favs.length && <div className="col-span-7 py-6 text-center text-[12.5px]" style={{ color: K.faint }}>Star a scene or graphic (☆ next to its name in the controls) to keep it here.</div>}
              </div>
            )}
          </section>

          {/* context controls */}
          <section className="m-3 flex min-h-0 flex-1 flex-col rounded-[3px] border" style={{ borderColor: K.line, background: K.panel }} data-context={cur?.id ?? sel}>
            <div className="flex h-[36px] flex-none items-center gap-3 border-b px-3" style={{ borderColor: K.line }}>
              <span className="h-[16px] w-[4px]" style={{ background: K.red }} />
              <span className={`${COND} text-[17px] tracking-[0.1em]`} data-context-title>{cur?.label ?? p.selName}</span>
              <button type="button" onClick={() => setFavs(f => (f.includes(sel) ? f.filter(x => x !== sel) : [...f, sel]))} title={fav ? 'Remove from favourites' : 'Add to favourites'} className="text-[16px]" style={{ color: fav ? K.amber : K.faint }} data-room-fav={fav ? '1' : '0'}>{fav ? '★' : '☆'}</button>
              {p.inspector && cur?.id !== 'mvp' && <div className="ml-2 flex h-[24px] overflow-hidden rounded-[2px] border" style={{ borderColor: K.line2 }}>
                {(['controls', 'graphic'] as const).map(t => <button key={t} type="button" onClick={() => setCtxTab(t)} data-ctx-tab={t} className={`${COND} px-3 text-[12px] tracking-[0.08em]`} style={ctxTab === t ? { background: K.sel, color: '#000' } : { color: K.dim }}>{t === 'controls' ? 'Scene controls' : 'Graphic settings'}</button>)}
              </div>}
              <span className="ml-auto truncate text-[11.5px]" style={{ color: K.faint }}>{p.selObs ? `OBS scene: ${p.selObs}` : 'No OBS scene mapped'}</span>
            </div>
            {mainRep && mainRep.layers.length > 1 && (
              <div className="flex flex-none flex-wrap items-center gap-1.5 border-b px-3 py-1.5" style={{ borderColor: K.line }} data-room-layers={mainRep.key}>
                <span className={`${COND} mr-1 text-[11.5px] tracking-[0.14em]`} style={{ color: K.faint }}>OBS layers</span>
                <span className="mr-1 rounded-[2px] px-1.5 text-[10.5px] font-bold" style={mainRep.scene === pgm ? { background: K.pgm, color: '#fff' } : { border: `1px solid ${K.line2}`, color: K.faint }} title={mainRep.scene === pgm ? 'This scene is on Program: a layer change is seen live' : 'Off air: layer changes are prepared without touching Program'}>{mainRep.scene === pgm ? 'ON AIR' : 'OFF AIR'}</span>
                {mainRep.layers.map(l => (
                  <button key={l.target} type="button" data-room-layer={l.target} data-on={l.on ? '1' : '0'} data-role={l.role}
                    onClick={() => {
                      // a base / panel becomes the selection too, so TAKE takes what is shown; an overlay just toggles
                      if (l.role !== 'overlay' && !l.target.startsWith('main:')) setSel(l.target.startsWith('g:') ? l.target : l.target.replace(/^s:/, ''));
                      void run({ c: 'obs-layer', target: l.target, on: l.role === 'overlay' ? !l.on : true }, `${l.role === 'overlay' ? (l.on ? 'Hide' : 'Show') : 'Show'} ${l.name}`);
                    }}
                    title={`${l.role === 'overlay' ? 'Overlay: shown on its own' : l.role === 'panel' ? 'Panel: replaces the scene picture' : 'The scene picture'} · ${l.on ? 'shown in OBS' : 'hidden in OBS'}${mainRep.scene === pgm ? ' · ON AIR' : ''}`}
                    className="flex h-[24px] items-center gap-1.5 rounded-[2px] border px-2 text-[12px]" style={{ borderColor: l.on ? (mainRep.scene === pgm ? K.pgm : K.pvw) : K.line2, color: l.on ? '#fff' : K.dim }}>
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: l.on ? (mainRep.scene === pgm ? K.pgm : K.pvw) : '#3a3a40' }} />
                    {l.name}<span className="text-[10px]" style={{ color: K.faint }}>{l.role === 'overlay' ? 'overlay' : l.role === 'panel' ? 'panel' : 'base'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto" data-context-body>
              {cur?.id === 'mvp' && ctx.aud ? <MvpPanel x={ctx} a={ctx.aud} sel={isMvpSel(sel) ? sel : MVP_SOURCE.voting} onSelect={preview} obsTr={p.obsTr} />
                : ctxTab === 'graphic' && p.inspector ? p.inspector
                : (() => {
                  const ids = cur && CONTEXT[cur.id] ? CONTEXT[cur.id] : p.mods;
                  if (!ids.length) return p.inspector ?? <div className="p-4" style={{ color: K.faint }}>No controls for this source.</div>;
                  return <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(430px, 1fr))' }}>
                    {ids.map(id => <div key={id} className="flex min-h-[200px] min-w-0 border-b border-r [&>section]:w-full [&>section]:min-w-0 [&>section]:border-0" style={{ borderColor: K.line }} data-context-module={id}><ModuleView id={id} x={ctx} pinned={false} /></div>)}
                  </div>;
                })()}
            </div>
          </section>
        </div>

        {/* ================= right rail ================= */}
        <div role="separator" aria-orientation="vertical" title="Drag: rail width (saved)" onPointerDown={startDrag('rail')} onDoubleClick={() => setRailW(420)} className="group w-[6px] flex-none cursor-col-resize" data-room-rail-split>
          <div className="mx-auto h-full w-px bg-white/10 group-hover:bg-white/40" />
        </div>
        <aside className="flex min-h-0 flex-none flex-col gap-3 py-3 pr-3" style={{ width: railW }} data-rail>
          {/* show rundown */}
          <section className="flex-none rounded-[3px] border" style={{ borderColor: K.line, background: K.panel }} data-room-rundown>
            <div className="flex h-[34px] items-center gap-2 border-b px-3" style={{ borderColor: K.line }}>
              <span className={`${COND} text-[15px] tracking-[0.12em]`}>Rundown</span>
              <span className="text-[11.5px]" style={{ color: plan?.pending ? K.amber : eng.autoHold ? K.amber : K.faint }} data-room-auto-status>{plan?.pending ? `Automation waits: ${plan.pending.name}` : eng.autoHold ? 'Automation held' : 'Automation armed'}</span>
              <button type="button" onClick={() => run({ c: 'automation', hold: !eng.autoHold }, eng.autoHold ? 'Automation resumed' : 'Automation held')} data-room-hold
                className={`${COND} ml-auto h-[24px] rounded-[2px] border px-2.5 text-[12px] tracking-[0.1em]`} style={eng.autoHold ? { background: K.amber, borderColor: K.amber, color: '#000' } : { borderColor: K.line2, color: K.dim }}>{eng.autoHold ? 'Held' : 'Hold'}</button>
            </div>
            <div className="space-y-1.5 p-2.5">
              <Row tag="On air" color={K.pgm}>{air ? <><b className="truncate">{air.label}</b><span className="ml-auto font-mono tabular-nums" style={{ color: air.dur && el > air.dur ? K.pgm : K.dim }}>{fmt(el)}{air.dur ? ` / ${fmt(air.dur)}` : ''}</span></> : <span style={{ color: K.faint }}>nothing marked on air</span>}</Row>
              <Row tag="Next" color={K.pvw}>{nxt ? <b className="truncate">{nxt.label}</b> : <span style={{ color: K.faint }}>end of the rundown</span>}</Row>
              <button type="button" disabled={!nxt && !plan?.pending} onClick={() => run({ c: 'sp-go' }, plan?.pending ? `GO · ${plan.pending.name}` : `GO · ${nxt?.label}`)} data-room-go
                className={`${COND} h-[40px] w-full rounded-[2px] text-[20px] tracking-[0.14em] disabled:opacity-30 ${plan?.pending ? 'animate-pulse' : ''}`} style={{ background: plan?.pending ? K.red : K.pvw, color: plan?.pending ? '#fff' : '#03140a' }}>
                GO{nxt ? ` · ${nxt.label}` : ''} <span className="text-[11px] opacity-60">F9</span></button>
              {plan?.pending && <button type="button" onClick={() => run({ c: 'sp-cancel' }, 'Cancel automation step')} className="w-full text-[11.5px] text-white/60 underline">Cancel the automation step</button>}
              {upcoming.length > 0 && <div className="pt-1" data-room-upcoming>{upcoming.map((s, i) => (
                <button key={s.id} type="button" onClick={() => run({ c: 'sp-next', id: s.id }, `Next: ${s.label}`)} title="Make this the next segment" className="flex w-full items-center gap-2 py-0.5 text-left text-[12.5px] hover:text-white" style={{ color: K.dim }}>
                  <span className="w-[16px] font-mono text-[11px]" style={{ color: K.faint }}>{i + 1}</span><span className="truncate">{s.label}</span>{s.dur ? <span className="ml-auto font-mono text-[11px]" style={{ color: K.faint }}>{fmt(s.dur)}</span> : null}
                </button>))}</div>}
            </div>
          </section>
          {/* graphics rundown */}
          <Collapse title="Graphics rundown" open={open.gfx} onToggle={() => setOpen(o => ({ ...o, gfx: !o.gfx }))} grow={open.gfx && !talentOpen} data="gfx">{p.rundownGfx}</Collapse>
          {/* talent & audio */}
          <Collapse title="Talent & audio" open={talentOpen} onToggle={() => setOpen(o => ({ ...o, talent: !talentOpen }))} grow data="talent" note={!open.talent && talentOpen ? 'opened for this desk' : undefined}>{p.talent}</Collapse>
        </aside>
      </div>

      {/* ================= status bar ================= */}
      <footer className="flex h-[40px] flex-none items-center gap-2 border-t px-3" style={{ borderColor: K.line, background: '#0b0b0d' }} data-room-status-bar>
        <button type="button" disabled={!eng.dirty} onClick={() => run({ c: 'publish' }, 'Publish all')} data-room-publish title={p.prepared.join(' · ') || 'Nothing prepared'}
          className={`${COND} h-[28px] rounded-[2px] px-4 text-[15px] tracking-[0.12em] text-black disabled:opacity-30`} style={{ background: eng.dirty ? K.amber : '#3a3220' }}>Publish all{eng.dirty ? ` · ${p.prepared.length || ''}` : ''}</button>
        <SB disabled={!eng.dirty} onClick={() => run({ c: 'revert' }, 'Revert draft')} data-room-revert>Revert</SB>
        <SB disabled={!eng.undo.length} onClick={() => run({ c: 'undo' }, 'Undo')} data-room-undo title={eng.undo[0] ? `Undo: ${eng.undo[0].label}` : ''}>Undo</SB>
        <span className="mx-1 h-5 w-px" style={{ background: K.line2 }} />
        <span className="text-[11.5px]" style={{ color: K.faint }}>Live data</span>
        <div className="flex h-[26px] overflow-hidden rounded-[2px] border" style={{ borderColor: K.line2 }} data-room-prepare>
          {([false, true] as const).map(v => <button key={String(v)} type="button" onClick={() => p.setPrepare(v)} data-room-prepare-opt={v ? 'prepare' : 'live'} className={`${COND} px-2.5 text-[12px] tracking-[0.08em]`} style={p.prepare === v ? { background: K.sel, color: '#000' } : { color: K.dim }}>{v ? 'Prepare' : 'Live'}</button>)}
        </div>
        <span className="mx-1 h-5 w-px" style={{ background: K.line2 }} />
        <SB danger onClick={() => run({ c: 'panic' }, 'Clear graphics')} data-room-clear title="Map card, badges, popups, PB panel, Champions off">Clear GFX</SB>
        <SB onClick={() => run({ c: 'reload-outputs' }, 'Reload sources')} data-room-reload>Reload sources</SB>
        <SB active={st.instant} onClick={p.onInstant} title="Prepared changes publish immediately">Instant</SB>
        <button type="button" onClick={() => setLogOpen(v => !v)} className="ml-2 flex min-w-0 flex-1 items-center gap-2 truncate text-left font-mono text-[11.5px]" style={{ color: last ? (last.ok ? K.dim : K.amber) : K.faint }} data-room-log>
          {last ? <>{new Date(last.at).toLocaleTimeString()} {last.ok ? '✓' : '✗'} {last.text}</> : 'Every command is acknowledged by the server'}{p.busy ? ' · …' : ''}</button>
        <select aria-label="Interface size" value={String(uiScale)} onChange={e => setUiScale(Number(e.target.value))} className="h-[28px] rounded-[2px] border bg-transparent px-1 text-[12px]" style={{ borderColor: K.line2, color: K.dim }} title="Interface size (saved in this browser)" data-room-scale>
          <option value="0">Size: auto ({Math.round(zoom * 100)}%)</option>{[0.9, 1, 1.25, 1.5, 1.75, 2].map(z => <option key={z} value={z}>Size: {Math.round(z * 100)}%</option>)}
        </select>
        <SB onClick={() => { for (const k of ['od3.room.rail', 'od3.room.mon', 'od3.room.thumbs', 'od3.room.open', 'od3.room.scale']) localStorage.removeItem(k); location.reload(); }} title="Back to the default workspace (favourites kept)">Reset layout</SB>
        <SB onClick={() => window.open('/controller', '_blank')}>Controller ↗</SB>
        <SB onClick={() => fetch('/api/logout', { method: 'POST' }).finally(p.onLogout)}>Sign out</SB>
        {logOpen && <div className="absolute bottom-[44px] right-3 z-40 max-h-[360px] w-[620px] overflow-y-auto rounded-[3px] border p-2 font-mono text-[11.5px] shadow-2xl" style={{ background: K.raise, borderColor: K.line2 }} data-room-log-list>
          {p.log.slice(0, 60).map((l, i) => <div key={i} className="truncate" style={{ color: l.ok ? K.dim : K.amber }}>{new Date(l.at).toLocaleTimeString()} {l.ok ? '✓' : '✗'} {l.text}</div>)}
        </div>}
      </footer>
    </div>
  );
}

function labelOf(key: string, st: ControllerState, scenes: MainScene[]) {
  const m = mainSceneOf(key, scenes); if (m) return m.label;
  if (key.startsWith('g:')) return st.graphics?.find(g => g.id === key.slice(2))?.name ?? key;
  return sourceById(key)?.name ?? key;
}

function Team({ name, right }: { name: string | null; right?: boolean }) {
  const logo = wcLogo(name);
  return (
    <span className={`flex items-center gap-2 ${right ? 'flex-row-reverse' : ''}`}>
      {logo ? <img src={logo} alt="" className="h-[28px] w-[28px] object-contain" /> : <span className="h-[28px] w-[28px] rounded-[2px] bg-white/10" />}
      <span className={`${COND} whitespace-nowrap text-[18px] tracking-[0.04em] max-[2200px]:text-[16px]`}>{name ?? 'TBD'}</span>
    </span>
  );
}

function Pill({ ok, warn, label, value, hideBelow }: { ok: boolean; warn?: boolean; label: string; value: string; /** hidden on narrow screens (Health covers it) */ hideBelow?: boolean }) {
  return <span className={`flex items-center gap-1.5 whitespace-nowrap text-[12px] ${hideBelow ? 'max-[2200px]:hidden' : ''}`} data-room-pill={label}>
    <span className="h-[8px] w-[8px] rounded-full" style={{ background: ok ? K.pvw : warn ? K.amber : '#555' }} />
    <span className={`${COND} text-[11px] tracking-[0.12em]`} style={{ color: K.faint }}>{label}</span><span style={{ color: K.dim }}>{value}</span>
  </span>;
}

function MvpChip({ p, onClick }: { p: RoomProps; onClick: () => void }) {
  const n = p.ctx.aud?.priv?.mvpNotice, stg = p.mvpD ? mvpStage(p.mvpD.flow) : 'none';
  const tone = n?.kind === 'error' ? K.pgm : n?.kind === 'queued' ? K.amber : n?.kind === 'ready' ? K.pvw : K.line2;
  return (
    <button type="button" onClick={onClick} title={n?.text ?? 'MVP scene'} data-mvp-chip={n?.kind ?? 'none'}
      className={`${COND} flex h-[26px] items-center gap-1.5 rounded-[2px] border px-2 text-[12px] tracking-[0.08em] ${n ? 'animate-pulse' : ''}`} style={{ borderColor: tone, color: n ? tone : K.dim }}>
      MVP{p.mvpD?.match ? ` ${shortCode(p.mvpD.match).replace(/\s+/g, '')}` : ''} · {n?.kind === 'ready' ? 'Ready' : n?.kind === 'queued' ? 'Waiting' : n?.kind === 'error' ? 'Check' : stg === 'none' ? '—' : stg}
    </button>
  );
}

function Monitor({ w, kind, title, tally, sub, live, children }: { w: number; kind: 'pvw' | 'pgm'; title: string; tally: string; sub: string; live?: boolean; children: ReactNode }) {
  const c = kind === 'pgm' ? K.pgm : K.pvw;
  return (
    <div className="flex flex-none flex-col" style={{ width: w }} data-monitor={kind}>
      <div className="flex h-[30px] flex-none items-center gap-2 px-2.5" style={{ background: kind === 'pgm' ? 'linear-gradient(90deg,#3a0b0b,#160707)' : 'linear-gradient(90deg,#0a2a16,#07140c)', borderTop: `3px solid ${c}` }}>
        <span className={`${COND} text-[15px] tracking-[0.16em]`} style={{ color: c }}>{kind === 'pgm' ? 'Program' : 'Preview'}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" data-monitor-title>{title}</span>
        {kind === 'pgm' ? <span className={`${COND} flex items-center gap-1.5 rounded-[2px] px-2 text-[12px] tracking-[0.12em] text-white`} style={{ background: K.pgm }} data-monitor-tally>
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-white" />{tally}</span>
          : <span className={`${COND} rounded-[2px] border px-2 text-[11.5px] tracking-[0.1em]`} style={{ borderColor: tally === 'OBS Preview' ? K.pvw : K.line2, color: tally === 'OBS Preview' ? K.pvw : K.dim }} data-monitor-tally>{live ? 'On air' : tally}</span>}
      </div>
      <div className="relative w-full" style={{ height: Math.round((w * 9) / 16), boxShadow: `inset 0 0 0 2px ${c}`, background: 'repeating-conic-gradient(#121214 0% 25%, #0d0d0f 0% 50%) 50% / 24px 24px' }}>
        <div className="absolute inset-[2px]"><Fit>{children}</Fit></div>
      </div>
      <div className="flex h-[20px] flex-none items-center px-2 text-[11px]" style={{ color: K.faint, background: '#0b0b0d' }}>{sub}</div>
    </div>
  );
}

function TBtn({ label, sub, onClick, disabled, take, big, armed, ...data }: { label: string; sub: string; onClick: () => void; disabled?: boolean; take?: boolean; big?: boolean; armed?: boolean } & { [k: `data-${string}`]: string | boolean | undefined }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} {...data}
      className={`${COND} flex flex-col items-center justify-center rounded-[3px] border tracking-[0.16em] transition active:translate-y-px disabled:opacity-30 ${armed ? 'animate-pulse' : ''}`}
      style={{ height: big ? 92 : 58, fontSize: big ? 32 : 22, background: take ? (armed ? '#ff6a13' : K.red) : '#18181c', borderColor: take ? 'transparent' : K.line2, color: '#fff', boxShadow: take ? '0 6px 24px rgba(227,38,27,.35), inset 0 -3px 0 rgba(0,0,0,.25)' : 'inset 0 -3px 0 rgba(0,0,0,.4)' }}>
      {label}<span className="font-['Inter'] text-[10.5px] font-medium normal-case tracking-normal opacity-60">{sub}</span>
    </button>
  );
}

function Row({ tag, color, children }: { tag: string; color: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-2 text-[13px]"><span className={`${COND} w-[56px] flex-none text-[11.5px] tracking-[0.12em]`} style={{ color }}>{tag}</span><span className="flex min-w-0 flex-1 items-center gap-2">{children}</span></div>;
}

function Collapse({ title, open, onToggle, grow, children, data, note }: { title: string; open: boolean; onToggle: () => void; grow?: boolean; children: ReactNode; data: string; note?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-[3px] border ${open && grow ? 'flex-1' : 'flex-none'}`} style={{ borderColor: K.line, background: K.panel }} data-room-section={data} data-open={open ? '1' : '0'}>
      <button type="button" onClick={onToggle} className="flex h-[34px] flex-none items-center gap-2 border-b px-3 text-left" style={{ borderColor: open ? K.line : 'transparent' }}>
        <span className="text-[10px]" style={{ color: K.faint }}>{open ? '▼' : '▶'}</span><span className={`${COND} text-[15px] tracking-[0.12em]`}>{title}</span>
        {note && <span className="text-[11px]" style={{ color: K.faint }}>{note}</span>}
      </button>
      {open && <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>}
    </section>
  );
}

function SB({ children, onClick, disabled, active, danger, title, ...data }: { children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; title?: string } & { [k: `data-${string}`]: string | boolean | undefined }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title} {...data}
    className={`${COND} h-[28px] whitespace-nowrap rounded-[2px] border px-2.5 text-[12.5px] tracking-[0.08em] disabled:opacity-30`}
    style={active ? { background: K.sel, color: '#000', borderColor: K.sel } : danger ? { borderColor: '#5c1d1b', color: '#ff8a80' } : { borderColor: K.line2, color: K.dim }}>{children}</button>;
}


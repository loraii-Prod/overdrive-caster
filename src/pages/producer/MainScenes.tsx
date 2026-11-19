/**
 * Overdrive 3.0 · MAIN SCENES (Producer Mode, first column: Scenes | Library).
 *
 * The show's core scenes as tiles: Starting Soon · Caster Desk · Analyst Desk · Gameplay · MVP · Intermission · Ending.
 *   click   = Preview: the 1920×1080 preview + that scene's controls (and OBS's own Preview in OBS Studio Mode).
 *             Program is never touched, so the next scene (MVP included) is prepared while another one is on air.
 *   TAKE    = Program with the transition chosen in the Publish column (OBS / Sting / Fade / Cut)
 *   AUTO    = Program with OBS's own transition        CUT = Program, cut
 * Tally: red = OBS Program, green = OBS Preview, blue outline = the scene in this console's preview.
 * MVP is one tile for its five views; a reveal asks for a second click (CONFIRM) unless the Studio turned that off.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { ProducerCmd } from '../../../shared/engine';
import { MVP_VIEW_LABEL, SHOW_MODES, isMvpSel, isShowSel, mainSceneOf, mvpViewOfSel, showModeOfSel, type MainScene } from '../../../shared/mainScenes';
import { isRevealView, mvpStage, type MvpFlowIn } from '../../../shared/mvpFlow';
import { REGISTRY } from '../../../shared/registry';
import { obsSceneOfGfx, obsSceneOfSource } from './Library';
import { shortCode } from '../../../shared/wildcard';
import type { Ack } from './modules';
import { C, LABEL } from './ws';

/** 3.3: scene health dot (left-side tally stays the PGM/PVW/selection ring; this is "can this scene even air"). */
function health(hasObsScene: boolean, obsConnected: boolean): { color: string; title: string } {
  if (!obsConnected) return { color: C.faint, title: 'OBS not connected: health unknown' };
  if (!hasObsScene) return { color: C.draft, title: 'No OBS scene mapped yet (Scene Builder)' };
  return { color: C.ok, title: 'OBS scene mapped and reachable' };
}

const STAGE_TEXT: Record<string, string> = { none: 'Not prepared', prepared: 'Ready · open voting', open: 'Voting open', closed: 'Counting', ready: 'Results ready', community: 'Community revealed', analyst: 'Analyst revealed', compare: 'Comparison' };

/** OBS scene a main scene switches to (the same lookup as the library and the rundown). */
export function obsSceneOfMain(s: MainScene, st: ControllerState): string | undefined {
  if (s.target.startsWith('main:')) { const e = st.obsSetup?.map?.[s.target]; const n = e?.scene ?? `Overdrive · ${s.label}`; return st.obs.scenes.includes(n) ? n : undefined; }
  if (s.sel.startsWith('g:')) { const g = st.graphics?.find(x => x.id === s.sel.slice(2)); return g ? obsSceneOfGfx(g, st) : undefined; }
  const src = REGISTRY.find(x => x.id === s.sel);
  return src ? obsSceneOfSource(src, st) : undefined;
}

/**
 * 3.8: the Show Screens mode switcher (Starting Soon · Be Right Back · Intermission · Thanks for Watching) as its
 * own small bar, usable anywhere a producer might be: the main tile row below (MainScenes), the single-scene
 * module panel, Studio, and an OBS Custom Browser Dock. Same mode list, same preview/TAKE calls as the tile row —
 * no second switching system. Clicking a mode only moves this console's Preview + OBS Studio-Mode Preview;
 * Program is only touched by CUT/AUTO/TAKE, exactly like every other main scene.
 */
export function ShowModeBar({ st, sel, onSelect, run, obsTr, compact = false }: {
  st: ControllerState; sel: string; onSelect: (sel: string) => void;
  run: (c: ProducerCmd, l: string) => Promise<Ack>; obsTr: 'obs' | 'stinger' | 'fade' | 'cut';
  /** Narrower layout for an OBS dock: smaller chips, no message line. */
  compact?: boolean;
}) {
  const mode = isShowSel(sel) ? showModeOfSel(sel) : SHOW_MODES[0];
  const asMain = (m: typeof mode): MainScene => ({ id: 'show', label: 'Show Screens', sel: m.sel, target: m.target });
  const o = obsSceneOfMain(asMain(mode), st);
  const onAir = !!o && o === st.obs.currentScene;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t); }, [msg]);

  const prepare = (m: typeof mode) => {
    onSelect(m.sel);
    const oo = obsSceneOfMain(asMain(m), st);
    if (oo && st.obs.connected) void run({ c: 'obs-preview', scene: oo, target: m.target }, `OBS Preview: ${m.label}`);
  };
  const go = async (transition: 'obs' | 'stinger' | 'fade' | 'cut', label: string) => {
    if (busy) return;
    setBusy(true);
    const r = await run({ c: 'scene-take', target: mode.target, transition }, `${label} · ${mode.label}`);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: r.note ?? `${mode.label} on air` } : { ok: false, text: r.error ?? 'TAKE failed' });
  };

  return (
    <div data-show-mode-bar>
      <div className="mb-1.5 flex flex-wrap items-center gap-1" data-show-modes>
        {SHOW_MODES.map(m => (
          <button key={m.id} type="button" onClick={() => prepare(m)} data-show-mode={m.id}
            className={`${LABEL} rounded-[2px] px-1.5 py-0.5 ${compact ? 'text-[10px]' : 'text-[10.5px]'}`}
            style={mode.id === m.id ? { background: C.sel, color: '#fff' } : { border: '1px solid rgba(255,255,255,.14)', color: 'rgba(255,255,255,.6)' }}>
            {m.label}
          </button>
        ))}
        {onAir && <span className={`${LABEL} rounded-[2px] px-1 text-[10px] text-white`} style={{ background: C.pgm }} data-show-mode-onair>On air</span>}
      </div>
      <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-1">
        <button type="button" disabled={busy || !st.obs.connected} onClick={() => go('cut', 'CUT')} data-show-mode-cut className={`${LABEL} h-[28px] rounded-[2px] border border-white/15 bg-[#1b1b1f] text-[12.5px] text-white disabled:opacity-35`} title="Program, cut">CUT</button>
        <button type="button" disabled={busy || !st.obs.connected} onClick={() => go('obs', 'AUTO')} data-show-mode-auto className={`${LABEL} h-[28px] rounded-[2px] border border-white/15 bg-[#1b1b1f] text-[12.5px] text-white disabled:opacity-35`} title="Program with OBS's own transition">AUTO</button>
        <button type="button" disabled={busy || !st.obs.connected} onClick={() => go(obsTr, 'TAKE')} data-show-mode-take
          className={`${LABEL} h-[28px] rounded-[2px] text-[12.5px] text-white disabled:opacity-35`} style={{ background: C.pgm }} title={`Program with: ${obsTr === 'obs' ? 'OBS transition' : obsTr === 'stinger' ? 'Sting' : obsTr === 'fade' ? 'Fade' : 'Cut'}`}>TAKE</button>
      </div>
      {!compact && <div className="mt-1 min-h-[14px] truncate text-[10.5px]" style={{ color: msg ? (msg.ok ? C.ok : '#ff8a8d') : 'rgba(255,255,255,.35)' }} data-show-mode-msg title={msg?.text}>
        {msg ? msg.text : !st.obs.connected ? 'OBS not connected: preview only' : `Preview: ${mode.label} · prepares in Preview, never touches Program until CUT/AUTO/TAKE`}</div>}
    </div>
  );
}

export function MainScenes({ st, scenes, sel, onSelect, run, obsTr, mvp, thumb }: {
  st: ControllerState; scenes: MainScene[]; sel: string; onSelect: (sel: string) => void;
  run: (c: ProducerCmd, l: string) => Promise<Ack>; obsTr: 'obs' | 'stinger' | 'fade' | 'cut';
  mvp: { flow: MvpFlowIn; votes: number | null; left: number | null; confirm: boolean; /** 3.0: the MVP match (short code on the tile) */ match?: string };
  /** Live thumbnail of a selection (rendered for MVP, Program and Preview tiles). */
  thumb: (sel: string) => ReactNode;
}) {
  const pgm = st.obs.currentScene, pvw = st.obs.studioMode ? st.obs.previewScene : undefined;
  const cur = mainSceneOf(sel, scenes);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setArmed(false), [sel]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t); }, [msg]);

  const curObs = cur ? obsSceneOfMain(cur, st) : undefined;
  const onAir = !!curObs && curObs === pgm;
  const reveal = !!cur && cur.id === 'mvp' && isRevealView(mvpViewOfSel(sel) ?? 'voting');

  const preview = (s: MainScene) => {
    onSelect(s.sel);
    const o = obsSceneOfMain(s, st);
    if (o && st.obs.connected) void run({ c: 'obs-preview', scene: o, target: s.target }, `OBS Preview: ${o}`);
  };
  const go = async (transition: 'obs' | 'stinger' | 'fade' | 'cut', label: string) => {
    if (!cur || busy) return;
    if (reveal && mvp.confirm && !armed) { setArmed(true); return; }
    setArmed(false); setBusy(true);
    const target = cur.id === 'mvp' ? `s:${sel}` : cur.target;
    const r = await run({ c: 'scene-take', target, transition }, `${label} · ${cur.label}`);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: r.note ?? `${cur.label} on air` } : { ok: false, text: r.error ?? 'TAKE failed' });
  };
  const trLabel = obsTr === 'obs' ? 'OBS transition' : obsTr === 'stinger' ? 'Sting' : obsTr === 'fade' ? 'Fade' : 'Cut';

  const showMode = cur?.id === 'show' && isShowSel(sel) ? showModeOfSel(sel) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-main-scenes>
      {/* 3.3: bigger, less-cramped grid (recognizable preview, name, PGM/PVW tag, health dot) */}
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}>
        {scenes.map(s => {
          const o = obsSceneOfMain(s, st), isP = !!o && o === pgm, isV = !!o && o === pvw;
          const on = cur?.id === s.id, isMvp = s.id === 'mvp';
          const stage = isMvp ? mvpStage(mvp.flow) : null;
          const h = health(!!o, st.obs.connected);
          return (
            <button key={s.id} type="button" onClick={() => preview(s)} data-main-scene={s.id} data-tally={isP ? 'pgm' : isV ? 'pvw' : on ? 'sel' : 'off'} title={o ? `OBS scene: ${o}` : 'No OBS scene yet: Studio → Sources & OBS → Scene Builder'}
              className="flex min-w-0 flex-col overflow-hidden rounded-[4px] text-left transition"
              style={{ boxShadow: `inset 0 0 0 2px ${isP ? C.pgm : isV ? C.pvw : on ? C.sel : 'rgba(255,255,255,.08)'}`, background: on ? 'rgba(42,109,244,.14)' : '#141417' }}>
              <div className="relative m-[3px] aspect-video overflow-hidden rounded-[3px] bg-black">
                {isMvp || isP || isV || on ? <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: 'scale(var(--k))' }} ref={el => { if (el) { const w = el.parentElement!.clientWidth; el.style.setProperty('--k', String(w / 1920)); } }}>{thumb(isMvp ? (isMvpSel(sel) ? sel : s.sel) : s.sel)}</div>
                  : <div className="h-full" style={{ background: 'linear-gradient(135deg,#1d1d22,#0b0b0e)' }} title="Live thumbnail when selected, in Preview or on Program" />}
                {(isP || isV) && <span className={`${LABEL} absolute left-1 top-1 rounded-[2px] px-1.5 py-0.5 text-[10px] text-white`} style={{ background: isP ? C.pgm : C.pvw }}>{isP ? 'PGM' : 'PVW'}</span>}
                <span className="absolute right-1 top-1 h-[8px] w-[8px] rounded-full" style={{ background: h.color, boxShadow: '0 0 0 2px rgba(0,0,0,.45)' }} title={h.title} data-scene-health={s.id} />
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-1.5 pt-0.5">
                <span className={`${LABEL} min-w-0 flex-1 truncate text-[12px] leading-[1.1] tracking-[0.04em] ${on ? 'text-white' : 'text-white/80'}`}>{s.label}</span>
                <span className="truncate text-[10px]" style={{ color: 'rgba(255,255,255,.4)' }}>
                  {isMvp ? `${mvp.match ? `${shortCode(mvp.match)} · ` : ''}${STAGE_TEXT[stage ?? 'none']}`
                    : s.id === 'show' ? showModeOfSel(on ? sel : s.sel).label
                    : o ? 'Ready' : 'No OBS scene'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {/* transport: what is in this console's preview → Program */}
      <div className="flex-none border-t p-1.5" style={{ borderColor: C.line, background: '#0d0d0f' }} data-transport>
        {cur && cur.id === 'show' && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1" data-show-modes>
            {SHOW_MODES.map(m => (
              <button key={m.id} type="button" onClick={() => preview({ ...cur, sel: m.sel, target: m.target })} data-show-mode={m.id}
                className={`${LABEL} rounded-[2px] px-1.5 py-0.5 text-[10.5px]`}
                style={showMode?.id === m.id ? { background: C.sel, color: '#fff' } : { border: '1px solid rgba(255,255,255,.14)', color: 'rgba(255,255,255,.6)' }}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        <div className="mb-1 flex items-center gap-1.5 text-[11px]">
          <span className={`${LABEL} text-white/40`}>Preview</span>
          <b className="min-w-0 flex-1 truncate text-white" data-transport-preview>{cur ? `${cur.label}${cur.id === 'mvp' ? ` · ${MVP_VIEW_LABEL[mvpViewOfSel(sel) ?? 'voting']}` : cur.id === 'show' && showMode ? ` · ${showMode.label}` : ''}` : '— not a main scene —'}</b>
          {onAir && <span className={`${LABEL} rounded-[2px] px-1 text-[10px] text-white`} style={{ background: C.pgm }}>On air</span>}
        </div>
        <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-1">
          <button type="button" disabled={!cur || busy || !st.obs.connected} onClick={() => go('cut', 'CUT')} data-transport-cut className={`${LABEL} h-[30px] rounded-[2px] border border-white/15 bg-[#1b1b1f] text-[13px] text-white disabled:opacity-35`} title="Program, cut">CUT</button>
          <button type="button" disabled={!cur || busy || !st.obs.connected} onClick={() => go('obs', 'AUTO')} data-transport-auto className={`${LABEL} h-[30px] rounded-[2px] border border-white/15 bg-[#1b1b1f] text-[13px] text-white disabled:opacity-35`} title="Program with OBS's own transition">AUTO</button>
          <button type="button" disabled={!cur || busy || !st.obs.connected} onClick={() => go(obsTr, armed ? 'CONFIRM' : 'TAKE')} data-transport-take={armed ? 'armed' : 'ready'}
            className={`${LABEL} h-[30px] rounded-[2px] text-[13px] text-white disabled:opacity-35 ${armed ? 'animate-pulse' : ''}`} style={{ background: armed ? '#ff6a13' : C.pgm }} title={`Program with: ${trLabel}`}>
            {armed ? 'CONFIRM REVEAL' : reveal ? 'REVEAL' : 'TAKE'}</button>
        </div>
        <div className="mt-1 min-h-[14px] truncate text-[10.5px]" style={{ color: msg ? (msg.ok ? C.ok : '#ff8a8d') : 'rgba(255,255,255,.35)' }} data-transport-msg title={msg?.text}>
          {msg ? msg.text : !st.obs.connected ? 'OBS not connected: preview only' : `TAKE uses: ${trLabel}${st.obs.studioMode ? ' · OBS Studio Mode' : ''}`}</div>
      </div>
    </div>
  );
}

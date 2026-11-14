/**
 * Overdrive — Graphics Workstation (/producer). A broadcast graphics management console, not a switcher:
 * OBS switches scenes and plays transitions; Overdrive prepares, publishes and animates graphics inside their
 * own independent browser sources.
 *
 * Fixed logical canvas 1920×1480, scaled uniformly (one factor, min(vw/1920, vh/1480)) and centred:
 *   top    1920×1080  the selected graphic, rendered by the same renderer its source uses (Draft or Live), clean
 *   bottom 1920×400   30 px header (mode, selection state, status) + 370 px of resizable panels:
 *     LIVE GRAPHICS  Library · Inspector (generated) · Rundown · Publish / OBS / Recovery / acks
 *     STUDIO         Library · Studio tabs (packages, instances & OBS, talent, bindings, modules, assets, show) · Publish …
 * Selecting anything only changes this workspace: it never airs, never switches OBS, never animates.
 */
import { feedPerf } from '../../lib/perfStore';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CasterId, ControllerState, ScreenId } from '../../../shared/types';
import { applyDraft, draftLabel, type EngineState, type ProducerCmd } from '../../../shared/engine';
import { REGISTRY, sourceById, studioFor } from '../../../shared/registry';
import { ScreenView } from '../../components/show/Program';
import { Scoreboard } from '../../components/show/Overlays';
import { WcBracket } from '../../components/wildcard/Wildcard';
import { MediaView } from '../../components/media/MediaView';
import { useConnState, useMatchData, useMedia, useNow, useSocket, useTournament, useViewer, useWildcard } from '../../lib/hooks';
import type { Socket } from '../../lib/socket';
import { ModuleView, Seg, type Ack, type Ctx } from './modules';
import { Inspector } from './Inspector';
import { Library, libraryOrder, obsSceneOfGfx, obsSceneOfSource } from './Library';
import { RundownPanel } from './RundownPanel';
import { StudioMode, type StudioTab } from './Studio';
import { B, C, Dot, DraftBadge, Kbd, LABEL, PanelHead, Splitter, VisBadge, useColumns, useFitCanvas } from './ws';
import { GraphicHost } from '../../gfx/Graphic';
import { pkgById } from '../../../shared/gfx';

const W = 1920, H = 1480;
type LogLine = { at: number; ok: boolean; text: string };

function useCommands(sock: Socket, version: number | undefined) {
  const pending = useRef(new Map<string, (a: Ack) => void>());
  const [busy, setBusy] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const add = useCallback((l: LogLine) => setLog(p => [l, ...p].slice(0, 40)), []);
  useEffect(() => sock.on(m => { if (m.t === 'ack') { const r = pending.current.get(m.id); if (r) { pending.current.delete(m.id); r(m); } } }), [sock]);
  const vRef = useRef(version); vRef.current = version;
  const run = useCallback(async (cmd: ProducerCmd, label: string): Promise<Ack> => {
    if (sock.state !== 'open') { const a = { ok: false, error: 'Not connected to the server', version: 0 }; add({ at: Date.now(), ok: false, text: `${label}: ${a.error}` }); return a; }
    const id = Math.random().toString(36).slice(2);
    setBusy(b => b + 1);
    const a = await new Promise<Ack>(res => {
      pending.current.set(id, res);
      sock.send({ t: 'cmd', id, cmd, source: 'manual', base: vRef.current });
      setTimeout(() => { if (pending.current.delete(id)) res({ ok: false, error: 'No answer from the server (8 s)', version: 0 }); }, 8000);
    });
    setBusy(b => b - 1);
    add({ at: Date.now(), ok: a.ok, text: a.ok ? `${label}${a.note ? ` · ${a.note}` : ''}` : `${label}: ${a.error}` });
    return a;
  }, [sock, add]);
  return { run, busy, log };
}

function useRtt(sock: Socket) {
  const [rtt, setRtt] = useState<number | null>(null);
  const sent = useRef(0);
  useEffect(() => {
    const off = sock.on(m => { if (m.t === 'pong' && sent.current) { setRtt(Date.now() - sent.current); sent.current = 0; } });
    const t = setInterval(() => { if (sock.state === 'open') { if (sent.current) setRtt(null); sent.current = Date.now(); sock.send({ t: 'ping' }); } }, 3000);
    return () => { off(); clearInterval(t); };
  }, [sock]);
  return rtt;
}

type Mode = 'live' | 'studio';
const ls = { get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} } };

/** OBS scene → the Overdrive output that owns it (Scene Builder mapping, then graphic / screen mappings). */
function targetOfObsScene(scene: string | undefined, st: ControllerState): string | null {
  if (!scene) return null;
  for (const [id, e] of Object.entries(st.obsSetup?.map ?? {})) if (e.scene === scene && id !== 'support:audio') return id;
  const g = (st.graphics ?? []).find(x => obsSceneOfGfx(x, st) === scene);
  if (g) return `g:${g.id}`;
  const s = REGISTRY.find(x => obsSceneOfSource(x, st) === scene);
  return s ? `s:${s.id}` : null;
}
const selOfTarget = (t: string) => (t.startsWith('g:') ? t : t.replace(/^s:/, ''));

/**
 * Producer Console. With `dock` it is the CONTROLLER OF ONE OBS SCENE (/producer/scene/<target>, meant for an OBS
 * Custom Browser Dock): that scene's graphic on top, only its controls below, no library / rundown / Studio. With
 * dock = 'follow' it shows whichever Overdrive scene OBS has in Preview (Studio Mode) or Program: it follows OBS,
 * it never switches OBS. A dock never writes the shared localStorage (OBS docks share one storage).
 */
export function Producer({ onLogout, dock }: { onLogout: () => void; dock?: string }) {
  const sock = useSocket({ role: 'controller' });
  useEffect(() => feedPerf(sock), [sock]);
  const conn = useConnState(sock);
  const [st, setSt] = useState<ControllerState | null>(null);
  const [skew, setSkew] = useState(0);
  const viewer = useViewer(sock, 'lq');
  const tournament = useTournament(sock);
  const bnl = useMatchData(sock);
  const wc = useWildcard(sock);
  const media = useMedia(sock);
  const now = useNow(skew, 250);
  const rtt = useRtt(sock);
  const fit = useFitCanvas(W, H);
  const follow = dock === 'follow';
  const [sel, setSel] = useState(() => { if (dock && !follow) return selOfTarget(dock); const v = ls.get('od2.sel', 'g:caster-desk'); return v === 'caster-desk' ? 'g:caster-desk' : v; });
  const [mode, setModeRaw] = useState<Mode>(() => (!dock && ls.get('od2.mode', 'live') === 'studio' ? 'studio' : 'live'));
  const setMode = (m: Mode) => { if (!dock) setModeRaw(m); };
  const [studioTab, setStudioTab] = useState<StudioTab>(() => (ls.get('od2.studioTab', 'instances') as StudioTab));
  const [modSrc, setModSrc] = useState('caster-desk');
  const [view, setView] = useState<'draft' | 'live'>('draft');
  const [prepare, setPrepare] = useState(false);
  const [obsTr, setObsTr] = useState<'obs' | 'stinger' | 'fade' | 'cut'>('obs');
  const [guides, setGuides] = useState(false);
  const [help, setHelp] = useState(false);
  const [details, setDetails] = useState(false);
  const cols = useColumns('od2.cols.v2', [300, 450, 372], [230, 360, 330], [440, 660, 480]);
  useEffect(() => { if (!dock) ls.set('od2.sel', sel); }, [sel, dock]);
  useEffect(() => { if (!dock) ls.set('od2.mode', mode); }, [mode, dock]);
  useEffect(() => { if (!dock) ls.set('od2.studioTab', studioTab); }, [studioTab, dock]);
  // Follow-OBS dock: show the Overdrive scene OBS has in Preview (Studio Mode) or else Program. Never switches OBS.
  const obsFocus = st ? (st.obs.studioMode ? st.obs.previewScene : st.obs.currentScene) : undefined;
  const followTarget = follow && st ? targetOfObsScene(obsFocus, st) : null;
  useEffect(() => { if (followTarget) setSel(selOfTarget(followTarget)); }, [followTarget]);
  useEffect(() => { if (dock) document.title = `Overdrive · ${follow ? 'Follow OBS' : dock} controller`; }, [dock, follow]);

  useEffect(() => sock.on(m => {
    if (m.t === 'state') setSt(m.state);
    else if (m.t === 'live') { setSkew(m.now - Date.now()); setSt(s => (s ? { ...s, live: m.scene, showLive: m.show, liveVersion: m.version } : s)); }
    else if (m.t === 'error' && m.code === 'auth') onLogout();
  }), [sock, onLogout]);

  const eng = st?.engine;
  const { run, busy, log } = useCommands(sock, eng?.version);
  const gInst = sel.startsWith('g:') ? st?.graphics?.find(g => g.id === sel.slice(2)) : undefined;
  const gPkg = gInst ? pkgById(gInst.pkg) : undefined;
  const src = (gPkg?.obsKey ? REGISTRY.find(s => s.obsKey === gPkg.obsKey) : undefined) ?? sourceById(sel) ?? REGISTRY[0];

  // Draft = preview scene/show + staged desk/booth + prepared live data. Live = exactly what the sources show.
  const draft = useMemo(() => {
    if (!wc || !eng || !st) return null;
    const staged = { ...wc.state, booth: eng.stage.booth, desk: { ...wc.state.desk, ...eng.stage.desk } };
    const d = applyDraft(staged, st.showPreview, eng.draft);
    return { wc: { ...wc, state: d.wc }, show: d.show, scene: st.preview };
  }, [wc, eng, st]);

  // Cameras: only the positions the selected graphic can show (never all ten talent).
  const camKey = useMemo(() => {
    if (!st || !eng || !wc) return '';
    const ids = new Set<number>();
    if (gInst) {
      if (gPkg?.renderer === 'caster-desk') [1, 2, 3].forEach(i => ids.add(i));
      if (gPkg?.renderer === 'analyst-desk') { [4, 5].forEach(i => ids.add(i)); const gu = Number((gInst.draft ?? gInst.config).guest); if (gu) ids.add(gu); }
      if (gPkg?.renderer === 'gameplay' && (gInst.draft ?? gInst.config).cams) [1, 2, 3].forEach(i => ids.add(i));
      return [...ids].sort().join(',');
    }
    if (src.screen === 'casters' || src.screen === 'warmup' || src.screen === 'starting' || src.screen === 'brb' || src.screen === 'ending') [1, 2, 3].forEach(i => ids.add(i));
    if (src.screen === 'analysis') { [4, 5].forEach(i => ids.add(i)); const g = view === 'draft' ? eng.stage.desk.guest : wc.state.desk.guest; if (g) ids.add(g); }
    if (src.screen === 'interview') { ids.add(6); if (wc.state.interview.host) ids.add(wc.state.interview.host); }
    if (src.screen === 'gameplay' && st.showLive.gameplay.cams) [1, 2, 3].forEach(i => ids.add(i));
    return [...ids].sort().join(',');
  }, [st, eng, wc, src, view, gInst, gPkg]);
  useEffect(() => { const ids = camKey.split(',').filter(Boolean).map(Number) as CasterId[]; viewer.setWanted(new Map(ids.map(id => [id, { video: true, audio: false }]))); }, [viewer, camKey]);

  // Keyboard: graphics operations on the selected graphic + global publish/undo/rundown. Never while typing.
  const keyState = useRef({ st, gInst, sel, mode, dock });
  keyState.current = { st, gInst, sel, mode, dock };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const { st, gInst, sel } = keyState.current;
      const mod = e.ctrlKey || e.metaKey;
      const act = (fn: () => void) => { e.preventDefault(); fn(); };
      if (mod && e.key === 'Enter') return act(() => run({ c: 'publish' }, 'Publish all'));
      if (mod && e.key.toLowerCase() === 'z') return act(() => run({ c: 'undo' }, 'Undo'));
      if (e.altKey && (e.key === '1' || e.key === '2')) return act(() => setMode(e.key === '1' ? 'live' : 'studio'));
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && st && !keyState.current.dock) return act(() => { const o = libraryOrder(st); const i = o.indexOf(sel); setSel(o[(i + (e.key === 'ArrowDown' ? 1 : -1) + o.length) % o.length]); });
      if (mod || e.altKey) return;
      if (e.key === 'F8') return act(() => run({ c: 'rd-next' }, 'TAKE NEXT'));
      if (gInst && e.key === 'F2') return act(() => run({ c: 'gfx-anim', id: gInst.id, action: 'in' }, `${gInst.name} IN`));
      if (gInst && e.key === 'F3') return act(() => (gInst.draft ? run({ c: 'gfx-publish', id: gInst.id }, `Publish ${gInst.name}`) : run({ c: 'gfx-anim', id: gInst.id, action: 'update' }, `${gInst.name} UPDATE`)));
      if (gInst && e.key === 'F4') return act(() => run({ c: 'gfx-anim', id: gInst.id, action: 'out' }, `${gInst.name} OUT`));
      if (e.key === 'd' || e.key === 'D') return act(() => setView(v => (v === 'draft' ? 'live' : 'draft')));
      if (e.key === 'g' || e.key === 'G') return act(() => setGuides(v => !v));
      if (e.key === '?') return act(() => setHelp(v => !v));
      if (e.key === 'Escape') { setHelp(false); setDetails(false); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [run]);

  if (!st || !eng || !wc || !draft) return <div className="grid h-screen place-items-center bg-[#0b0b0c] text-[13px] tracking-[0.2em] text-white/50">{conn === 'open' ? 'LOADING SHOW…' : 'CONNECTING TO SERVER…'}</div>;

  const outputs = (route: string) => st.outputs.find(o => `/output/${o.route}` === route.split('?')[0])?.count ?? 0;
  const obsProgram = st.obs.currentScene, obsPreview = st.obs.studioMode ? st.obs.previewScene : undefined;
  const selObs = gInst ? obsSceneOfGfx(gInst, st) : obsSceneOfSource(src, st);
  const showDraft = view === 'draft';
  const scene = showDraft ? draft.scene : st.live, show = showDraft ? draft.show : st.showLive, wcv = showDraft ? draft.wc : wc;
  const ctx: Ctx = { st, eng, wc: wc.state, pv: draft.wc.state, run, prepare, src, now, media: media?.media ?? null, mediaSkew: media?.skew ?? 0 };
  const layout = studioFor(st.studio, src.id);
  const mods = [...layout.pinned, ...layout.modules.filter(m => !layout.pinned.includes(m))];
  const selConns = gInst ? (st.outputs.find(o => o.route === `g/${gInst.id}`)?.count ?? 0) : outputs(src.route);
  const selDraft = gInst ? !!gInst.draft : eng.dirty;
  const gfxOut = st.outputs.filter(o => o.route.startsWith('g/'));
  const gfxWithSrc = (st.graphics ?? []).filter(g => gfxOut.some(o => o.route === `g/${g.id}`)).length;
  const gfxErr = Object.values(st.gfxHealth ?? {}).filter(h => !h.ok).length;
  const seated = (st.talent ?? []).filter(t => t.seat), pubs = seated.filter(t => t.publishing || t.mode === 'vdo').length;
  const [wLib, wRd, wPub] = cols.w;
  const grid = dock ? `minmax(0,1fr) 5px ${wPub}px` : mode === 'live' ? `${wLib}px 5px minmax(0,1fr) 5px ${wRd}px 5px ${wPub}px` : `${wLib}px 5px minmax(0,1fr) 5px ${wPub}px`;
  const dockMissing = !!dock && !follow && (dock.startsWith('g:') ? !gInst : !sourceById(dock.replace(/^s:/, '')));
  const dockIdle = follow && !followTarget;
  const selectGfx = (id: string) => setSel(`g:${id}`);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#000' }}>
      <div data-console-canvas className="absolute origin-top-left overflow-hidden font-['Inter'] text-white antialiased" style={{ width: W, height: H, left: fit.x, top: fit.y, transform: `scale(${fit.s})`, background: C.bg }}>
        {/* ===== 1920×1080: the selected graphic, exactly as its source renders it (nothing painted over it) ===== */}
        <div className="absolute left-0 top-0 overflow-hidden" style={{ width: 1920, height: 1080, background: 'repeating-conic-gradient(#151517 0% 25%, #101012 0% 50%) 50% / 40px 40px' }} data-preview={gInst ? `g:${gInst.id}` : src.id} data-preview-view={view}>
          {gInst && <GraphicHost key={gInst.id} inst={gInst} preview forceShow={showDraft} cfgOverride={showDraft ? gInst.draft : null} d={{ scene: st.live, show: st.showLive, wc, now, tournament, bnl, viewer, monitor: true }} />}
          {!gInst && src.screen && <ScreenView key={src.screen} id={src.screen} scene={{ ...scene, screen: src.screen }} show={show} now={now} tournament={tournament} viewer={viewer} monitor bnl={bnl} wc={wcv} />}
          {!gInst && src.view === 'scoreboard' && <Scoreboard show={show} />}
          {!gInst && src.view === 'standings' && <WcBracket wc={wcv.state} part={2} />}
          {!gInst && src.view === 'media' && <MediaView media={media?.media ?? null} skew={media?.skew ?? 0} preview />}
          {guides && <SafeGuides />}
          {(dockMissing || dockIdle) && (
            <div className="absolute inset-0 grid place-items-center bg-black/80 text-center" data-dock-message>
              <div><div className={`${LABEL} text-[40px] text-white/80`}>{dockMissing ? 'This scene no longer exists in Overdrive' : 'OBS is not showing an Overdrive scene'}</div>
                <div className="mt-2 text-[22px] text-white/45">{dockMissing ? `${dock}: rebuild the docks in Studio → OBS Setup.` : `OBS ${st.obs.studioMode ? 'Preview' : 'Program'}: ${obsFocus ?? '—'}. This controller follows OBS; it never switches it.`}</div></div>
            </div>
          )}
        </div>

        {/* ===== 1920×400: controls ===== */}
        <div className="absolute left-0 flex flex-col" style={{ top: 1080, width: 1920, height: 400, background: C.bg }} data-controls>
          {/* header 30 px: mode · selection · preview view · status */}
          <div className="flex h-[30px] flex-none items-center gap-2 border-b px-2" style={{ background: '#0d0d0f', borderColor: C.line }} data-header>
            {dock ? (
              <span className={`${LABEL} inline-flex h-[22px] items-center rounded-[2px] bg-[#e5484d] px-2.5 text-[12px] text-white`} data-dock={dock} title="Controller of one OBS scene (OBS Custom Browser Dock). Never shown on air.">
                {follow ? `Follows OBS ${st.obs.studioMode ? 'Preview' : 'Program'}` : 'Scene controller'}
              </span>
            ) : (
            <div className="inline-flex h-[22px] overflow-hidden rounded-[2px] border border-white/15" data-mode={mode}>
              {(['live', 'studio'] as const).map(m => <button key={m} type="button" onClick={() => setMode(m)} title={m === 'live' ? 'Live Graphics (Alt+1)' : 'Studio: prepare the show (Alt+2)'}
                className={`${LABEL} px-2.5 text-[12px] ${mode === m ? (m === 'live' ? 'bg-[#e5484d] text-white' : 'bg-white text-black') : 'text-white/55 hover:bg-white/10'}`}>{m === 'live' ? 'Live graphics' : 'Studio'}</button>)}
            </div>
            )}
            <span className="mx-1 h-4 w-px bg-white/10" />
            <span className={`${LABEL} text-[11px] text-white/40`}>Preview</span>
            <b className="max-w-[300px] truncate text-[13px]" data-selected={sel}>{gInst ? gInst.name : src.name}</b>
            <span className="font-mono text-[11px] text-white/40">{gInst ? `/g/${gInst.id}` : src.route}</span>
            {gInst ? <VisBadge out={gInst.anim.action === 'out'} /> : <span className="font-['Barlow_Condensed'] text-[11px] font-bold tracking-[0.08em] text-white/35">SCENE SOURCE</span>}
            {selDraft && <DraftBadge />}
            {selObs && selObs === obsProgram ? <span className={`${LABEL} rounded-[2px] px-1.5 text-[11px] text-white`} style={{ background: C.pgm }}>OBS PGM</span>
              : selObs && selObs === obsPreview ? <span className={`${LABEL} rounded-[2px] border px-1.5 text-[11px]`} style={{ borderColor: C.pvw, color: C.pvw }}>OBS PVW</span> : null}
            <span className="font-mono text-[11px]" style={{ color: selConns ? C.ok : C.faint }} title="Browser sources showing this graphic">{selConns ? `●${selConns}` : '○ no source'}</span>
            <span className="mx-1 h-4 w-px bg-white/10" />
            <span className={`${LABEL} text-[11px] text-white/40`}>View</span>
            <div className="inline-flex h-[22px] overflow-hidden rounded-[2px] border border-white/15" title="D: toggle" data-view-toggle>
              {(['draft', 'live'] as const).map(v => <button key={v} type="button" onClick={() => setView(v)} className={`${LABEL} px-2 text-[11.5px] ${view === v ? (v === 'draft' ? 'text-black' : 'bg-white text-black') : 'text-white/55 hover:bg-white/10'}`} style={view === v && v === 'draft' ? { background: C.draft } : undefined}>{v === 'draft' ? 'Draft' : 'Live'}</button>)}
            </div>
            <span className="text-[11px] text-white/40">{showDraft ? (selDraft ? 'showing prepared changes (not on the source yet)' : gInst?.anim.action === 'out' ? 'hidden on its source: shown here to prepare it' : 'same as the source') : gInst?.anim.action === 'out' ? 'hidden on its source (nothing shown)' : 'what the source shows now'}</span>
            <button type="button" onClick={() => setGuides(v => !v)} className={`${LABEL} ml-1 rounded-[2px] border px-1.5 text-[11px] ${guides ? 'border-white bg-white text-black' : 'border-white/15 text-white/50'}`} title="Safe-area guides (G)">Guides</button>
            <span className="ml-auto flex items-center gap-3 text-[11px]" data-status>
              <StatusChip ok={conn === 'open'} label="Engine" value={conn === 'open' ? `${rtt != null ? `${rtt} ms` : 'online'} · v${eng.version}${busy ? ' · …' : ''}` : conn} />
              <StatusChip ok={st.obs.connected} warn={!st.obs.connected && st.obs.enabled} label="OBS" value={st.obs.connected ? (obsProgram ?? '—') : st.obs.enabled ? 'offline' : 'not set up'} />
              <StatusChip ok={gfxErr === 0 && gfxWithSrc > 0} warn={gfxErr > 0} label="Sources" value={`${gfxWithSrc}/${(st.graphics ?? []).length}${gfxErr ? ` · ⚠${gfxErr}` : ''}`} />
              <StatusChip ok={seated.length > 0 && pubs === seated.length} warn={pubs < seated.length} label="Talent" value={`${pubs}/${seated.length} cams`} />
              <StatusChip ok={!eng.autoHold} warn={eng.autoHold} label="Auto" value={eng.autoHold ? 'held' : 'armed'} />
              <button type="button" onClick={() => setDetails(v => !v)} className={`${LABEL} rounded-[2px] border px-1.5 text-[11px] ${details ? 'border-white bg-white text-black' : 'border-white/15 text-white/55'}`} data-details-toggle>Details</button>
              <button type="button" onClick={() => setHelp(v => !v)} className="grid h-[20px] w-[20px] place-items-center rounded-full border border-white/20 text-[11px] text-white/60" title="Shortcuts (?)">?</button>
            </span>
          </div>

          {/* body 370 px */}
          <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: grid }}>
            {!dock && <>
              <Library st={st} sel={sel} onSelect={setSel} run={run} />
              <Splitter onPointerDown={cols.start(0, 1, fit.s)} onDoubleClick={cols.reset} />
            </>}
            {mode === 'live' ? (
              <div className="flex min-h-0 min-w-0 flex-col" style={{ background: C.panel }}>
                {gInst && <Inspector g={gInst} st={st} eng={eng} wc={wc.state} pv={draft.wc.state} run={run} ctxBase={{ st, eng, wc: wc.state, pv: draft.wc.state, run, prepare, now, media: media?.media ?? null, mediaSkew: media?.skew ?? 0 }} />}
                {!gInst && (
                  <div className="flex min-h-0 flex-1 flex-col" data-scene-panel={src.id}>
                    <PanelHead label="Scene controls" info={<>{src.name} · <span className="font-mono">{src.route}</span>{src.note ? ` · ${src.note}` : ''}</>}>
                      <span className="text-[10.5px] text-white/35">scene source (not migrated to the graphics engine yet)</span>
                      {!dock && <B h={20} kind="ghost" onClick={() => { setMode('studio'); setStudioTab('modules'); setModSrc(src.id); }}>Modules…</B>}
                      <B h={20} kind="ghost" onClick={() => navigator.clipboard?.writeText(location.origin + src.route)}>Copy URL</B>
                    </PanelHead>
                    <div className="min-h-0 flex-1 overflow-y-auto" data-modules={src.id}>
                      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gridAutoRows: 312 }}>
                        {mods.map(m => <div key={m} className="flex min-h-0 min-w-0 [&>section]:w-full [&>section]:min-w-0">{<ModuleView id={m} x={ctx} pinned={layout.pinned.includes(m)} />}</div>)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <StudioMode st={st} run={run} tab={studioTab} setTab={setStudioTab} sel={sel} onSelectGfx={selectGfx} srcForModules={sourceById(modSrc) ?? REGISTRY[0]} setSrcForModules={setModSrc} x={ctx} />
            )}
            {mode === 'live' && !dock && <><Splitter onPointerDown={cols.start(1, -1, fit.s)} onDoubleClick={cols.reset} /><RundownPanel st={st} run={run} sel={gInst} onSelect={selectGfx} /></>}
            <Splitter onPointerDown={cols.start(2, -1, fit.s)} onDoubleClick={cols.reset} />
            <PublishPanel st={st} eng={eng} wc={wc.state} run={run} prepare={prepare} setPrepare={setPrepare} obsTr={obsTr} setObsTr={setObsTr} selObs={selObs} selName={gInst ? gInst.name : src.name}
              log={log} onInstant={() => sock.send({ t: 'set-instant', on: !st.instant })} onLogout={onLogout} />
          </div>
        </div>

        {details && <DetailsPopover st={st} eng={eng} rtt={rtt} conn={conn} onClose={() => setDetails(false)} />}
        {help && <HelpOverlay onClose={() => setHelp(false)} />}
      </div>
    </div>
  );
}

function StatusChip({ ok, warn, label, value }: { ok: boolean; warn?: boolean; label: string; value: string }) {
  return <span className="flex items-center gap-1.5 whitespace-nowrap" data-status-chip={label}><Dot color={ok ? C.ok : warn ? C.draft : 'rgba(255,255,255,.3)'} /><span className={`${LABEL} text-[11px] text-white/40`}>{label}</span><span className="max-w-[170px] truncate text-white/80">{value}</span></span>;
}

/** Title-safe (90 %) and action-safe (93 %) areas, centre cross. Operator aid only (never on the sources). */
function SafeGuides() {
  const box = (p: number, c: string) => <div className="absolute border" style={{ left: `${(100 - p) / 2}%`, top: `${(100 - p) / 2}%`, width: `${p}%`, height: `${p}%`, borderColor: c }} />;
  return (
    <div className="pointer-events-none absolute inset-0" data-guides>
      {box(93, 'rgba(0,200,255,.55)')}{box(90, 'rgba(255,220,0,.55)')}
      <div className="absolute left-1/2 top-1/2 h-[40px] w-px -translate-x-1/2 -translate-y-1/2 bg-white/50" /><div className="absolute left-1/2 top-1/2 h-px w-[40px] -translate-x-1/2 -translate-y-1/2 bg-white/50" />
    </div>
  );
}

/** Area E: publish, OBS (explicit only), recovery and the command acknowledgments. */
function PublishPanel({ st, eng, wc, run, prepare, setPrepare, obsTr, setObsTr, selObs, selName, log, onInstant, onLogout }: {
  st: ControllerState; eng: EngineState; wc: import('../../../shared/wildcard').WildcardState; run: (c: ProducerCmd, l: string) => Promise<Ack>; prepare: boolean; setPrepare: (v: boolean) => void;
  obsTr: 'obs' | 'stinger' | 'fade' | 'cut'; setObsTr: (v: 'obs' | 'stinger' | 'fade' | 'cut') => void; selObs?: string; selName: string; log: LogLine[]; onInstant: () => void; onLogout: () => void;
}) {
  const obsProgram = st.obs.currentScene;
  const prepared = [...draftDiff(st, wc, eng), ...eng.draft.map(draftLabel), ...(st.graphics ?? []).filter(g => g.draft).map(g => `${g.name} (graphic)`)];
  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.panel }} data-publish>
      <PanelHead label="Publish" info={eng.dirty ? `${prepared.length} prepared` : 'nothing prepared'}>
        <span className="text-[10.5px] text-white/35">Live data:</span>
        <Seg value={prepare ? 'prep' : 'live'} options={[['live', 'Live'], ['prep', 'Prepare']]} onChange={v => setPrepare(v === 'prep')} />
      </PanelHead>
      <div className="flex flex-none items-center gap-1 px-2 pt-2">
        <button type="button" disabled={!eng.dirty} onClick={() => run({ c: 'publish' }, 'Publish all')} title="Every prepared change to its source (Ctrl+Enter). Never switches OBS."
          className={`h-[38px] flex-1 rounded-[2px] font-['Barlow_Condensed'] text-[19px] font-bold tracking-[0.1em] text-black disabled:opacity-30`} style={{ background: eng.dirty ? C.draft : '#3a3220' }} data-publish-all>PUBLISH ALL <span className="text-[11px] font-semibold opacity-60">Ctrl+↵</span></button>
        <B h={38} disabled={!eng.dirty} onClick={() => run({ c: 'revert' }, 'Revert draft')}>Revert</B>
        <B h={38} disabled={!eng.undo.length} title={eng.undo[0] ? `Undo: ${eng.undo[0].label} (Ctrl+Z)` : 'Ctrl+Z'} onClick={() => run({ c: 'undo' }, 'Undo')}>Undo</B>
      </div>
      <div className="mx-2 mt-1 h-[30px] flex-none overflow-y-auto text-[11px] leading-[15px] text-white/55" data-draft-list>{eng.dirty ? prepared.join(' · ') || 'changes' : 'Nothing prepared: every source shows the live content.'}</div>

      <div className="mx-2 mt-1 flex-none border-t pt-1.5" style={{ borderColor: C.line }} data-obs>
        <div className="mb-1 flex items-center gap-1.5 text-[11px]">
          <span className={`${LABEL} text-[12px] text-white/80`}>OBS</span>
          <span className="truncate" style={{ color: st.obs.connected ? C.ok : C.draft }}>{st.obs.connected ? `● PGM ${obsProgram ?? '—'}${st.obs.studioMode ? ` · PVW ${st.obs.previewScene ?? '—'}` : ''}` : st.obs.enabled ? `● ${st.obs.error ?? 'offline'}` : '● not set up (Controller → Settings → OBS)'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Seg value={obsTr} options={[['obs', 'OBS'], ['stinger', 'Sting'], ['fade', 'Fade'], ['cut', 'Cut']]} onChange={v => setObsTr(v as typeof obsTr)} />
          <button type="button" disabled={!st.obs.connected || !selObs || selObs === obsProgram} onClick={() => run({ c: 'obs-switch', scene: selObs!, transition: obsTr }, `OBS → ${selObs}`)} title="Explicit OBS switch: OBS plays the transition"
            className={`${LABEL} h-[24px] min-w-0 flex-1 truncate rounded-[2px] px-1 text-[12px] text-white disabled:opacity-30`} style={{ background: C.pgm }} data-obs-switch>{selObs ? (selObs === obsProgram ? 'On air in OBS' : `Switch OBS → ${selName}`) : 'No OBS scene mapped'}</button>
          <select aria-label="Any OBS scene" value="" disabled={!st.obs.connected} onChange={e => e.target.value && run({ c: 'obs-switch', scene: e.target.value, transition: obsTr }, `OBS → ${e.target.value}`)} className="h-[24px] w-[64px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-0.5 text-[11px]">
            <option value="">Other…</option>{st.obs.scenes.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="mx-2 mt-1.5 grid flex-none grid-cols-3 gap-1 border-t pt-1.5" style={{ borderColor: C.line }} data-recovery>
        <B h={22} kind="danger" onClick={() => run({ c: 'panic' }, 'Clear graphics')} title="Map card, badges, popups, PB panel, Champions off">Clear GFX</B>
        <B h={22} onClick={() => run({ c: 'reload-outputs' }, 'Reload sources')} title="Every browser source reloads and resyncs">Reload srcs</B>
        <B h={22} active={eng.autoHold} onClick={() => run({ c: 'automation', hold: !eng.autoHold }, eng.autoHold ? 'Automation resumed' : 'Automation held')}>{eng.autoHold ? 'Auto held' : 'Hold auto'}</B>
        <B h={22} active={st.instant} title="Prepared changes publish immediately (never a scene selection)" onClick={onInstant}>Instant</B>
        <B h={22} onClick={() => window.open('/controller', '_blank')}>Controller ↗</B>
        <B h={22} kind="ghost" onClick={() => fetch('/api/logout', { method: 'POST' }).finally(onLogout)}>Sign out</B>
      </div>

      <div className="mx-2 mb-1.5 mt-1.5 min-h-0 flex-1 overflow-y-auto border-t pt-1 font-mono text-[10.5px] leading-[1.5]" style={{ borderColor: C.line }} data-log>
        {log.length ? log.slice(0, 30).map((l, i) => <div key={i} className="truncate" title={l.text} style={{ color: l.ok ? 'rgba(255,255,255,.55)' : C.draft }}>{new Date(l.at).toLocaleTimeString()} {l.ok ? '✓' : '✗'} {l.text}</div>) : <div className="text-white/30">Every command is acknowledged by the server; failures show here in amber.</div>}
      </div>
    </div>
  );
}

/** Advanced technical status, on demand (kept out of the live operator's way). */
function DetailsPopover({ st, eng, rtt, conn, onClose }: { st: ControllerState; eng: EngineState; rtt: number | null; conn: string; onClose: () => void }) {
  return (
    <div className="absolute right-2 z-50 flex w-[560px] flex-col overflow-hidden rounded-[3px] border border-white/15 shadow-2xl" style={{ bottom: 404, maxHeight: 640, background: '#0f0f11' }} data-details>
      <PanelHead label="System details"><B h={20} kind="ghost" onClick={onClose}>Close ✕</B></PanelHead>
      <div className="grid min-h-0 grid-cols-2 gap-x-4 overflow-y-auto p-2.5 text-[11.5px]">
        <div>
          <div className={`${LABEL} mb-1 text-[12px] text-white/70`}>Engine</div>
          <div>Server: {conn}{rtt != null ? ` · ${rtt} ms round trip` : ''}</div>
          <div>Engine version v{eng.version} · {eng.dirty ? 'draft differs from live' : 'draft = live'}</div>
          <div>Automation: {eng.autoHold ? 'held' : 'armed'} (waits 8 s after a manual action)</div>
          <div>Undo steps: {eng.undo.length}{eng.undo[0] ? ` · last: ${eng.undo[0].label}` : ''}</div>
          <div className={`${LABEL} mb-1 mt-2 text-[12px] text-white/70`}>OBS</div>
          <div>{st.obs.connected ? 'Connected' : st.obs.enabled ? `Offline: ${st.obs.error ?? '—'}` : 'Not set up'}{st.obs.studioMode ? ' · Studio Mode' : ''}</div>
          <div>Program: {st.obs.currentScene ?? '—'}{st.obs.studioMode ? ` · Preview: ${st.obs.previewScene ?? '—'}` : ''}</div>
          <div>{st.obs.scenes.length} scenes</div>
          <div className={`${LABEL} mb-1 mt-2 text-[12px] text-white/70`}>Talent (WebRTC / VDO.Ninja)</div>
          {(st.talent ?? []).filter(t => t.seat || t.online).map(t => <div key={t.id}>{t.id} {t.name || 'name needed'} · {t.seat ? `pos ${t.seat}` : 'no position'} · {t.mode === 'vdo' ? 'VDO push' : t.publishing ? `publishing${t.hasAudio ? ' + mic' : ''}` : t.online ? 'online, no camera' : 'offline'}</div>)}
        </div>
        <div>
          <div className={`${LABEL} mb-1 text-[12px] text-white/70`}>Browser sources connected</div>
          {st.outputs.length ? st.outputs.map(o => <div key={o.route} className="flex justify-between font-mono"><span>/{o.route.startsWith('g/') ? o.route : `output/${o.route}`}</span><span>{o.count}</span></div>) : <div className="text-white/40">none</div>}
          <div className={`${LABEL} mb-1 mt-2 text-[12px] text-white/70`}>Graphics health</div>
          {(st.graphics ?? []).map(g => { const h = st.gfxHealth?.[g.id]; return <div key={g.id} className="flex justify-between"><span>{g.name}</span><span style={{ color: !h ? C.faint : h.ok ? C.ok : C.draft }}>{!h ? 'no report' : h.ok ? 'OK' : `⚠ ${h.error}`}</span></div>; })}
        </div>
      </div>
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const K = ({ k, d }: { k: string; d: string }) => <div className="flex items-center justify-between gap-6 py-[3px]"><span className="text-white/75">{d}</span><Kbd>{k}</Kbd></div>;
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose} data-help>
      <div className="w-[760px] rounded-[3px] border border-white/15 p-5 text-[13px]" style={{ background: '#111113' }} onClick={e => e.stopPropagation()}>
        <div className={`${LABEL} mb-3 text-[18px]`}>Workstation shortcuts</div>
        <div className="grid grid-cols-2 gap-x-10">
          <div>
            <K k="F2" d="Selected graphic IN" /><K k="F3" d="Selected graphic UPDATE (publishes its draft)" /><K k="F4" d="Selected graphic OUT" /><K k="F8" d="Rundown: TAKE NEXT" />
            <K k="Ctrl+Enter" d="Publish all prepared changes" /><K k="Ctrl+Z" d="Undo" />
          </div>
          <div>
            <K k="Alt+↑ / Alt+↓" d="Previous / next graphic" /><K k="Alt+1 / Alt+2" d="Live graphics / Studio" /><K k="D" d="Preview: Draft ↔ Live" /><K k="G" d="Safe-area guides" /><K k="?" d="This help" /><K k="Esc" d="Close" />
          </div>
        </div>
        <div className={`${LABEL} mb-2 mt-4 text-[14px] text-white/80`}>States</div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/70">
          <span className="flex items-center gap-1.5"><VisBadge out={false} /> visible on its source</span>
          <span className="flex items-center gap-1.5"><VisBadge out /> hidden on its source</span>
          <span className="flex items-center gap-1.5"><DraftBadge /> prepared, not published</span>
          <span className="flex items-center gap-1.5"><span className="rounded-[2px] px-1.5 font-['Barlow_Condensed'] text-[12px] font-bold text-white" style={{ background: C.pgm }}>OBS PGM</span> its OBS scene is on air</span>
          <span className="flex items-center gap-1.5"><span className="rounded-[2px] bg-[#e5484d] px-1 text-[9.5px] font-bold text-white">LIVE DATA</span> shared data, goes straight out</span>
        </div>
        <p className="mt-4 text-[12px] text-white/45">Selecting a graphic only changes this workspace. Overdrive never switches OBS unless you press “Switch OBS”; OBS plays every scene transition.</p>
      </div>
    </div>
  );
}

/** What the draft changes besides prepared live data (shown next to PUBLISH). */
function draftDiff(st: ControllerState, wc: import('../../../shared/wildcard').WildcardState, eng: EngineState): string[] {
  const out: string[] = [], p = st.showPreview, l = st.showLive;
  if (JSON.stringify(eng.stage.booth) !== JSON.stringify(wc.booth)) out.push('caster desk layout');
  if (JSON.stringify(eng.stage.desk.slots) !== JSON.stringify(wc.desk.slots) || eng.stage.desk.guest !== wc.desk.guest) out.push('analyst desk');
  if (eng.stage.desk.panel !== wc.desk.panel) out.push(`desk panel → ${eng.stage.desk.panel}`);
  if (eng.stage.desk.strip !== wc.desk.strip) out.push(`VS strip ${eng.stage.desk.strip ? 'on' : 'off'}`);
  if (eng.stage.desk.clock !== wc.desk.clock) out.push(`desk countdown ${eng.stage.desk.clock ? 'on' : 'off'}`);
  if (p.showScoreboard !== l.showScoreboard) out.push(`scoreboard ${p.showScoreboard ? 'on' : 'off'}`);
  if (p.showMatchupOnScreens !== l.showMatchupOnScreens) out.push('matchup bar');
  if (p.ticker.onScreens !== l.ticker.onScreens) out.push('ticker');
  st.preview.casters.forEach((c, i) => { const lc = st.live.casters[i]; if (lc && c.cameraOn !== lc.cameraOn) out.push(`camera ${c.id} ${c.cameraOn ? 'on' : 'off'}`); });
  if (st.preview.showNames !== st.live.showNames) out.push('names');
  return out;
}

export type { ScreenId, ReactNode };

/**
 * Overdrive Graphics Engine — browser side.
 * GraphicHost renders one graphics instance: its renderer (looked up by the package's `renderer` id), inside an
 * error boundary (a failing graphic shows nothing and reports itself; other graphics keep running) and the
 * IN / UPDATE / OUT / RESET lifecycle driven by the engine's `anim.seq` (Web Animations API on the graphic's own
 * layer; the approved components keep their own internal animations). These are graphic animations, never
 * scene transitions: no stinger is ever played here.
 */
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Scene, Show } from '../../shared/types';
import type { MatchData } from '../../shared/protocol';
import type { Tournament } from '../../shared/tournament';
import type { GfxInstance } from '../../shared/gfx';
import { pkgById } from '../../shared/gfx';
import type { RtcViewer } from '../lib/rtcViewer';
import type { AudLive, WcLive } from '../lib/hooks';
import { AUD_RENDERERS } from './audience';
import { ScreenView } from '../components/show/Program';
import { Scoreboard } from '../components/show/Overlays';
import { Swap, TransitionProvider, transitionOf, whenVisualsReady } from './transition';

export interface GfxData { scene: Scene; show: Show; wc: WcLive | null; aud?: AudLive | null; now: number; tournament: Tournament | null; bnl: MatchData | null; viewer?: RtcViewer | null; monitor?: boolean }
type Cfg = GfxInstance['config'];
type Renderer = (p: { cfg: Cfg; d: GfxData }) => ReactNode;

const seated = (scene: Scene, ids: number[]) => ids.filter(id => scene.casters.find(c => c.id === id)?.enabled);

/** The official Overdrive collection: each renderer reuses the approved scene components unchanged. */
export const RENDERERS: Record<string, Renderer> = {
  ...AUD_RENDERERS,
  'caster-desk': ({ cfg, d }) => {
    const on = seated(d.scene, [1, 2, 3]);
    const n = cfg.layout === 'solo' ? 1 : cfg.layout === 'duo' ? 2 : cfg.layout === 'trio' ? 3 : on.length;
    const booth = on.slice(0, n);
    const wc = d.wc && { ...d.wc, state: { ...d.wc.state, booth, intro: { ...d.wc.state.intro, picksShow: cfg.picks === true } } };
    return <ScreenView id="casters" scene={{ ...d.scene, screen: 'casters', showNames: cfg.names !== false }} show={{ ...d.show, showMatchupOnCasters: cfg.matchup === true, ticker: { ...d.show.ticker, onScreens: cfg.ticker !== false } }}
      now={d.now} tournament={d.tournament} viewer={d.viewer} monitor={d.monitor} bnl={d.bnl} wc={wc} />;
  },
  'analyst-desk': ({ cfg, d }) => {
    const slots = cfg.layout === 'solo' ? [4] : [4, 5];
    const guest = cfg.guest === 'none' ? null : Number(cfg.guest);
    const wc = d.wc && { ...d.wc, state: { ...d.wc.state, desk: { ...d.wc.state.desk, slots, guest, panel: String(cfg.panel) as 'cams', strip: cfg.strip === true, clock: cfg.clock === true } } };
    return <ScreenView id="analysis" scene={{ ...d.scene, screen: 'analysis', showNames: cfg.names !== false }} show={{ ...d.show, ticker: { ...d.show.ticker, onScreens: cfg.ticker !== false } }}
      now={d.now} tournament={d.tournament} viewer={d.viewer} monitor={d.monitor} bnl={d.bnl} wc={wc} />;
  },
  scoreboard: ({ cfg, d }) => <Scoreboard show={{ ...d.show, showScoreboard: true, mapName: cfg.map === false ? '' : d.show.mapName }} />,
  gameplay: ({ cfg, d }) => (
    <ScreenView id="gameplay" scene={{ ...d.scene, screen: 'gameplay' }} show={{ ...d.show, showScoreboard: cfg.scoreboard !== false, gameplay: { ...d.show.gameplay, cams: cfg.cams === true, ticker: cfg.ticker === true } }}
      now={d.now} tournament={d.tournament} viewer={d.viewer} monitor={d.monitor} bnl={d.bnl} wc={d.wc} />
  ),
  bracket: ({ cfg, d }) => {
    // Cycling is computed from the server-synced clock: every copy of the source shows the same half.
    const sec = Math.max(5, Number(cfg.cycleSec) || 20);
    const part: 1 | 2 = cfg.cycle === true ? ((Math.floor(d.now / (sec * 1000)) % 2) + 1) as 1 | 2 : cfg.part === '2' ? 2 : 1;
    const view = cfg.view === 'matches' ? 'matches' : 'bracket';
    const wc = d.wc && { ...d.wc, state: { ...d.wc.state, air: part, opts: { ...d.wc.state.opts, inBracket: true, rotate: false } } };
    return (
      <Swap k={view}>
        <ScreenView id={view} scene={{ ...d.scene, screen: view }} show={d.show} now={d.now} tournament={d.tournament} viewer={d.viewer} monitor={d.monitor} bnl={d.bnl} wc={wc} />
      </Swap>
    );
  },
};

class Isolate extends Component<{ id: string; onError: (e: string) => void; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  componentDidCatch(e: unknown) { this.props.onError(e instanceof Error ? e.message : String(e)); }
  render() { return this.state.error ? null : this.props.children; }
}

/**
 * One graphics instance. `cfgOverride` = render a draft (operator preview) instead of the published config.
 * `onHealth` is called with ok/error so the source can report its health to the engine.
 */
export function GraphicHost({ inst, d, cfgOverride, onHealth, preview = false, forceShow = false }: { inst: GfxInstance; d: GfxData; cfgOverride?: Cfg | null; onHealth?: (ok: boolean, error?: string) => void; preview?: boolean; /** Operator Draft view: render even when OUT, to inspect and prepare it. */ forceShow?: boolean }) {
  const pkg = pkgById(inst.pkg);
  const R = pkg ? RENDERERS[pkg.renderer] : undefined;
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef(inst.anim.seq);
  const [shown, setShown] = useState(inst.anim.action !== 'out');
  const [epoch, setEpoch] = useState(0); // remount = replay the approved components' own entrances

  useEffect(() => { onHealth?.(!!R, R ? undefined : `No renderer for package ${inst.pkg}`); }, [R]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lifecycle: react only to new commands (a refresh shows the published state without re-animating).
  useLayoutEffect(() => {
    if (inst.anim.seq === seen.current) return;
    seen.current = inst.anim.seq;
    const el = layer.current;
    const a = inst.anim.action;
    if (preview) { setShown(a !== 'out'); return; } // the operator preview never animates
    if (a === 'in') {
      // Remount (replays the approved entrances), keep the layer hidden until its videos/images can draw,
      // then animate IN: the IN never starts on a half-loaded (transparent) graphic.
      el?.getAnimations().forEach(x => x.cancel());
      setShown(true); setEpoch(e => e + 1);
      const seq = inst.anim.seq;
      requestAnimationFrame(() => {
        const l = layer.current;
        if (!l) return;
        l.style.opacity = '0';
        whenVisualsReady(() => layer.current, 700).then(() => {
          const x = layer.current;
          if (!x || seen.current !== seq) return; // a newer command took over
          x.style.opacity = '';
          x.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
        });
      });
    }
    else if (a === 'out') { if (el) el.style.opacity = ''; if (el) el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-16px)' }], { duration: 400, easing: 'ease-in', fill: 'forwards' }).finished.then(() => setShown(false)).catch(() => setShown(false)); else setShown(false); }
    else if (a === 'update') { el?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }], { duration: 350 }); }
    else if (a === 'reset') { el?.getAnimations().forEach(x => x.cancel()); if (el) el.style.opacity = ''; setShown(true); setEpoch(e => e + 1); }
  }, [inst.anim.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!R || (!shown && !forceShow)) return <div ref={layer} data-gfx={inst.id} data-gfx-state="out" className="absolute inset-0" />;
  const cfg = cfgOverride ?? inst.config;
  const accent = typeof cfg.accent === 'string' && cfg.accent ? cfg.accent : undefined;
  return (
    <div ref={layer} data-gfx={inst.id} data-gfx-state="in" className="absolute inset-0" style={accent ? ({ ['--brand-accent' as string]: accent, ['--accent' as string]: accent, ['--hot' as string]: accent }) : undefined}>
      <TransitionProvider value={transitionOf(cfg)}>
        <Isolate key={epoch} id={inst.id} onError={e => onHealth?.(false, e)}><R cfg={cfg} d={d} /></Isolate>
      </TransitionProvider>
    </div>
  );
}

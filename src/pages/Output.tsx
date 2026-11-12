import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { CASTER_IDS, SCREEN_IDS } from '../../shared/types';
import { boothScene } from '../components/wildcard/Desk';
import { ScaledCanvas, Stage, type Layers } from '../components/Stage';
import { Program, ScreenView } from '../components/show/Program';
import { BracketView, MatchesBoard } from '../components/show/Bracket';
import { MatchBar, Scoreboard } from '../components/show/Overlays';
import { Ticker } from '../components/show/parts';
import { SpotlightCard } from '../components/show/Spotlight';
import { PlayerCam, playerCamBox } from '../components/show/PlayerCam';
import { ThemeProvider } from '../lib/theme';
import { useGraphics, useMatchData, useConnState, useLive, useNow, useSocket, useTournament, useViewer, useWantedCameras, useWildcard, query } from '../lib/hooks';
import { GraphicHost } from '../gfx/Graphic';
import { pkgById } from '../../shared/gfx';
import { WcBracket, WcCasters, WcPopups, WcWaiting } from '../components/wildcard/Wildcard';
import { TwitchCard } from '../components/wildcard/Twitch';
import { SceneDock } from './controller/SceneDock';
import type { ClientMsg } from '../../shared/protocol';
import { NextMatchCorner } from '../components/show/NextMatch';
import { VdoContext } from '../lib/vdo';
import { SheetBracket, SheetMatches } from '../components/show/SheetBracket';
import { vdoViewUrl } from '../../shared/players';
import type { CasterId, ForcedLayout, ScreenId } from '../../shared/types';

function useTransparentPage() {
  useEffect(() => {
    document.documentElement.classList.add('output');
    return () => document.documentElement.classList.remove('output');
  }, []);
}

/** Small corner label only when ?debug=1 — never on air by default. */
function Debug({ state, version }: { state: string; version?: number }) {
  if (!query().has('debug')) return null;
  return (
    <div className="fixed right-2 top-2 z-50 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white">
      {state} · v{version ?? '-'}
    </div>
  );
}

export type OutputKind =
  | { k: 'stage'; forced?: ForcedLayout; layers: Layers }
  | { k: 'program' }
  | { k: 'screen'; id: ScreenId }
  | { k: 'scoreboard' }
  | { k: 'ticker' }
  | { k: 'bracket' }
  | { k: 'matches' }
  | { k: 'player' }
  | { k: 'playercam' }
  | { k: 'nextmatch' }
  // OverDrive Wildcard graphics (always available, whether or not the wildcard is used in the program)
  | { k: 'wildcard' }
  | { k: 'wc-gameplay' }
  | { k: 'wc-waiting' }
  | { k: 'wc-casters' }
  | { k: 'twitch' };

/** ?part=1|2 pins a wildcard source to one part; ?cast=R2_UB1 pins the cast match. */
const wcPart = (): 1 | 2 | null => { const p = query().get('part'); return p === '1' ? 1 : p === '2' ? 2 : null; };
const wcCastPin = () => query().get('cast');

/**
 * OBS browser source. Renders 1:1 on a 1920x1080 canvas with a transparent
 * page. Keeps showing the last live state through disconnects and heals itself.
 */
export function Output({ route, kind }: { route: string; kind: OutputKind }) {
  useTransparentPage();
  const sock = useSocket({ role: 'output', route, key: query().get('key') ?? undefined });
  const state = useConnState(sock);
  const live = useLive(sock);
  const tournament = useTournament(sock);
  const bnl = useMatchData(sock);
  const wc = useWildcard(sock);
  const now = useNow(live?.skew ?? 0, 250);
  const viewer = useViewer(sock, 'hq');
  const needsCams = (kind.k === 'stage' && kind.layers.content) || kind.k === 'program' || (kind.k === 'screen' && (kind.id === 'casters' || kind.id === 'analysis' || kind.id === 'interview' || kind.id === 'gameplay'));
  useWantedCameras(viewer, [live?.scene], needsCams);

  let body = null;
  if (live) {
    const { scene, show } = live;
    switch (kind.k) {
      case 'stage':
        body = (
          <>
            <VdoContext.Provider value={{ password: show.vdo.password, params: show.vdo.params, embeds: true }}><Stage scene={boothScene(scene, wc?.state.booth ?? [])} forced={kind.forced} layers={kind.layers} viewer={viewer} /></VdoContext.Provider>
            {kind.layers.branding && scene.showBranding && route === 'casters' && <MatchBar show={show} />}
          </>
        );
        break;
      case 'program': body = <Program scene={scene} show={show} now={now} tournament={tournament} viewer={viewer} bnl={bnl} wc={wc} transition={live?.transition} />; break;
      case 'screen': body = <ScreenView id={kind.id} scene={scene} show={show} now={now} tournament={tournament} viewer={viewer} bnl={bnl} wc={wc} />; break;
      case 'wildcard': body = wc && <WcBracket wc={wc.state} part={wcPart() ?? wc.state.air} pin={wcCastPin()} />; break;
      case 'wc-gameplay': body = wc && <WcPopups pop={wc.pop} />; break;
      // ?corner=left|right, ?top=<px> : the card on its own (any OBS scene)
      case 'twitch': {
        const q = query(), left = q.get('corner') === 'left', top = Number(q.get('top')) || 60;
        body = wc && <TwitchCard tw={wc.tw} now={now} style={{ [left ? 'left' : 'right']: 40, top, width: 440 }} />;
        break;
      }
      case 'wc-casters': body = wc && <WcCasters wc={wc.state} now={now} pin={wcCastPin()} />; break;
      case 'wc-waiting': {
        // Title: ?title=… or ?title=none, else the screen text of the intermission on air (Starting soon by default).
        const t = query().get('title');
        const kindOnAir = scene.screen === 'brb' || scene.screen === 'ending' ? scene.screen : 'starting';
        body = wc && <WcWaiting wc={wc.state} now={now} title={t === 'none' ? '' : t ?? show.screens[kindOnAir].title} timer={show.timer.target} pin={wcCastPin()} />;
        break;
      }
      case 'nextmatch': body = <NextMatchCorner show={{ ...show, nextMatch: { ...show.nextMatch, enabled: true } }} bnl={bnl} now={now} screen="gameplay" />; break;
      case 'scoreboard': body = <Scoreboard show={show} />; break;
      case 'ticker': body = <div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div>; break;
      case 'bracket': if (wc?.state.enabled) { body = <WcBracket wc={wc.state} part={wcPart() ?? wc.state.air} pin={wcCastPin()} />; break; } if (bnl?.sheet?.matches.length) { body = <SheetBracket sheet={bnl.sheet} show={show} />; break; } {
        // ?view=upper/lower overrides the controller's bracket-view pick (e.g. for a
        // dedicated OBS source), otherwise it follows show.bracketView.
        const v = query().get('view');
        const view = v === 'upper' || v === 'lower' ? v : show.bracketView;
        body = tournament && <BracketView t={tournament} view={view} transparent={query().has('transparent')} />;
        break;
      }
      case 'matches': body = bnl?.sheet?.matches.length ? <SheetMatches sheet={bnl.sheet} show={show} /> : tournament && <MatchesBoard t={tournament} show={show} transparent={query().has('transparent')} />; break;
      case 'player': body = <SpotlightCard spot={show.spotlight} now={now} />; break;
      case 'playercam': {
        // Standalone: frame anchored bottom-right by default; ?corner=left to flip.
        const box = playerCamBox(show), left = query().get('corner') === 'left';
        body = <PlayerCam show={{ ...show, playerCam: { ...show.playerCam, enabled: true } }} x={left ? 40 : 1920 - 40 - box.w} bottom={40} />;
        break;
      }
    }
  }

  // ?controls&token=… : 1920×1480 source, picture on top, controls in the 400 px below (crop them in OBS, click via Interact).
  const q = query(), withControls = q.has('controls');
  if (withControls && live) {
    const token = q.get('token') ?? '';
    const post = (m: ClientMsg) => { fetch(`/api/v1/msg?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {}); };
    const screen = kind.k === 'screen' ? kind.id : live.scene.screen;
    return (
      <div className="fixed inset-0 flex flex-col">
        <div className="relative flex-none" style={{ height: '56.25vw' }}>
          <ScaledCanvas>
            <ThemeProvider theme={live.show.theme} brand={live.show.brand}>
              <div className="od-stage relative h-[1080px] w-[1920px] overflow-hidden" data-theme={live.show.theme}>{body}</div>
            </ThemeProvider>
          </ScaledCanvas>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#101010] p-3 text-white" style={{ zoom: 1.6 }}>
          {!token && <div className="mb-2 text-[12px] text-amber-300">Add &amp;token=… (Controller → Settings → Integrations) to this address so these buttons can change the show.</div>}
          <SceneDock live={screen} preview={screen} show={live.show} wc={wc} now={now} send={post} quick={op => post({ t: 'quick', op })}
            twConnected={!!wc?.tw?.connected} casters={live.scene.casters} screens={kind.k === 'program'} />
        </div>
        <Debug state={state} version={live?.version} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0">
      <ScaledCanvas>
        <ThemeProvider theme={live?.show.theme ?? 'bnl'} brand={live?.show.brand ?? null}>
          <div className="od-stage relative h-[1080px] w-[1920px] overflow-hidden" data-theme={live?.show.theme ?? 'bnl'}>{body}</div>
        </ThemeProvider>
      </ScaledCanvas>
      <Debug state={state} version={live?.version} />
    </div>
  );
}

/** /output/screen/:id — one screen exactly as /output/program draws it (used by "Build scenes in OBS"). */
export function ScreenOutput() {
  const id = useParams().id as ScreenId;
  if (!SCREEN_IDS.includes(id)) return null;
  return <Output key={id} route={`screen/${id}`} kind={{ k: 'screen', id }} />;
}

/**
 * /output/audio/:slot — the caster's microphone only, for a dedicated OBS
 * browser source ("Control audio via OBS"). Nothing is mixed in the browser.
 */
export function AudioOutput() {
  useTransparentPage();
  const slot = Number(useParams().slot) as CasterId;
  const valid = CASTER_IDS.includes(slot);
  const sock = useSocket({ role: 'output', route: `audio/${slot}`, key: query().get('key') ?? undefined });
  const state = useConnState(sock);
  const live = useLive(sock);
  const viewer = useViewer(sock, 'hq');
  const ref = useRef<HTMLAudioElement>(null);
  const isRemote = valid && live?.scene.casters[slot - 1].source.type === 'webrtc';

  useEffect(() => {
    viewer.setWanted(isRemote ? new Map([[slot, { video: false, audio: true }]]) : new Map());
  }, [viewer, slot, isRemote]);

  useEffect(() => {
    if (!valid) return;
    return viewer.subscribe(slot, s => {
      const a = ref.current!;
      a.srcObject = s;
      if (s) a.play().catch(() => {});
    });
  }, [viewer, slot, valid]);

  const vdoSrc = valid && live?.scene.casters[slot - 1].source.type === 'vdo' ? live.scene.casters[slot - 1].source.vdo : '';
  return (
    <>
      <audio ref={ref} autoPlay />
      {vdoSrc && <iframe src={vdoViewUrl({ vdo: vdoSrc }, live!.show.vdo.password, '&novideo&cleanoutput')} title="caster audio" allow="autoplay" style={{ width: 1, height: 1, border: 0, opacity: 0 }} />}
      <Debug state={`${state} · audio ${slot}`} version={live?.version} />
    </>
  );
}

/**
 * /g/:id — a graphics-engine instance as its own OBS browser source (stable URL per instance).
 * Renders only that graphic, reports its health, and keeps running on its own if the controller is closed.
 */
export function GraphicOutput() {
  const id = useParams().id ?? '';
  useTransparentPage();
  const sock = useSocket({ role: 'output', route: `g/${id}`, key: query().get('key') ?? undefined });
  const state = useConnState(sock);
  const live = useLive(sock);
  const tournament = useTournament(sock);
  const bnl = useMatchData(sock);
  const wc = useWildcard(sock);
  const graphics = useGraphics(sock);
  const now = useNow(live?.skew ?? 0, 250);
  const viewer = useViewer(sock, 'hq');
  const inst = graphics?.find(g => g.id === id);
  const needsCams = !!inst && (pkgById(inst.pkg)?.permissions.includes('cameras') ?? false) && inst.anim.action !== 'out';
  useWantedCameras(viewer, [live?.scene], needsCams);
  const lastHealth = useRef('');
  const health = (ok: boolean, error?: string) => {
    const k = `${ok}|${error ?? ''}`;
    if (k === lastHealth.current) return;
    lastHealth.current = k;
    sock.send({ t: 'gfx-health', id, ok, error });
  };
  useEffect(() => { if (state === 'open') { const k = lastHealth.current; lastHealth.current = ''; if (k) { const [ok, e] = k.split('|'); health(ok === 'true', e || undefined); } } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (graphics && !inst) return <div className="fixed inset-0 grid place-items-center font-mono text-[14px] text-white/60">Unknown graphic “{id}”</div>;
  return (
    <div className="fixed inset-0">
      <ScaledCanvas>
        <ThemeProvider theme={live?.show.theme ?? 'bnl'} brand={live?.show.brand ?? null}>
          <div className="od-stage relative h-[1080px] w-[1920px] overflow-hidden" data-theme={live?.show.theme ?? 'bnl'}>
            {inst && live && <GraphicHost inst={inst} d={{ scene: live.scene, show: live.show, wc, now, tournament, bnl, viewer }} onHealth={health} />}
          </div>
        </ThemeProvider>
      </ScaledCanvas>
      <Debug state={state} version={live?.version} />
    </div>
  );
}

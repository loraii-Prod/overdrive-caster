import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ScaledCanvas, Stage, type Layers } from '../components/Stage';
import { Program, ScreenView } from '../components/show/Program';
import { BracketView, MatchesBoard } from '../components/show/Bracket';
import { MatchBar, Scoreboard } from '../components/show/Overlays';
import { Ticker } from '../components/show/parts';
import { SpotlightCard } from '../components/show/Spotlight';
import { PlayerCam, playerCamBox } from '../components/show/PlayerCam';
import { ThemeProvider } from '../lib/theme';
import { useBnl, useConnState, useLive, useNow, useSocket, useTournament, useViewer, useWantedCameras, query } from '../lib/hooks';
import { PlayoffsScreen, StandingsScreen } from '../components/show/BnlGraphics';
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
  | { k: 'standings' }
  | { k: 'nextmatch' }
  | { k: 'playoffs' };

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
  const bnl = useBnl(sock);
  const now = useNow(live?.skew ?? 0, 250);
  const viewer = useViewer(sock, 'hq');
  const needsCams = (kind.k === 'stage' && kind.layers.content) || kind.k === 'program' || (kind.k === 'screen' && (kind.id === 'casters' || kind.id === 'gameplay'));
  useWantedCameras(viewer, [live?.scene], needsCams);

  let body = null;
  if (live) {
    const { scene, show } = live;
    switch (kind.k) {
      case 'stage':
        body = (
          <>
            <VdoContext.Provider value={{ password: show.vdo.password, params: show.vdo.params, embeds: true }}><Stage scene={scene} forced={kind.forced} layers={kind.layers} viewer={viewer} /></VdoContext.Provider>
            {kind.layers.branding && scene.showBranding && route === 'casters' && <MatchBar show={show} />}
          </>
        );
        break;
      case 'program': body = <Program scene={scene} show={show} now={now} tournament={tournament} viewer={viewer} bnl={bnl} />; break;
      case 'screen': body = <ScreenView id={kind.id} scene={scene} show={show} now={now} tournament={tournament} viewer={viewer} bnl={bnl} />; break;
      case 'nextmatch': body = <NextMatchCorner show={{ ...show, nextMatch: { ...show.nextMatch, enabled: true } }} bnl={bnl} now={now} screen="gameplay" />; break;
      case 'standings': body = <StandingsScreen data={bnl} show={show} />; break;
      case 'playoffs': body = <PlayoffsScreen data={bnl} show={show} />; break;
      case 'scoreboard': body = <Scoreboard show={show} />; break;
      case 'ticker': body = <div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div>; break;
      case 'bracket': if (bnl?.sheet?.matches.length) { body = <SheetBracket sheet={bnl.sheet} show={show} />; break; } {
        const v = query().get('view');
        body = tournament && <BracketView t={tournament} view={v === 'upper' || v === 'lower' ? v : 'full'} transparent={query().has('transparent')} />;
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

  return (
    <div className="fixed inset-0">
      <ScaledCanvas>
        <ThemeProvider theme={live?.show.theme ?? 'bnl'} brand={live?.show.brand ?? null}>
          <div className="glacial-stage relative h-[1080px] w-[1920px] overflow-hidden" data-theme={live?.show.theme ?? 'bnl'}>{body}</div>
        </ThemeProvider>
      </ScaledCanvas>
      <Debug state={state} version={live?.version} />
    </div>
  );
}

/**
 * /output/audio/:slot — the caster's microphone only, for a dedicated OBS
 * browser source ("Control audio via OBS"). Nothing is mixed in the browser.
 */
export function AudioOutput() {
  useTransparentPage();
  const slot = Number(useParams().slot) as CasterId;
  const valid = slot === 1 || slot === 2 || slot === 3;
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

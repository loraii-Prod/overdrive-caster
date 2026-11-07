import { useEffect, useRef, useState } from 'react';
import type { CasterId } from '../../../shared/types';
import { AnimatePresence, motion } from 'motion/react';
import type { Scene, ScreenId, Show } from '../../../shared/types';
import type { Tournament } from '../../../shared/tournament';
import type { RtcViewer } from '../../lib/rtcViewer';
import { Stage, ALL_LAYERS } from '../Stage';
import { BgVideo, Mark, Pattern } from '../Brand';
import { ThemeProvider } from '../../lib/theme';
import { SpotlightCard } from './Spotlight';
import { PlayerCam, playerCamBox } from './PlayerCam';
import { CamStrip, WarmupScreen } from './Warmup';
import { SheetBracket, SheetMatches } from './SheetBracket';
import { NextMatchCorner } from './NextMatch';
import { VdoContext } from '../../lib/vdo';
import { skinBackground, skinOf } from '../../../shared/skins';
import { SkinBadge, SkinCasters, SkinIntermission, SkinStinger, SkinTicker, SkinVideo } from './Skin';
import { PlayoffsScreen, RcBar, RcBoard, StandingsScreen, type BnlData } from './BnlGraphics';
import { BrbScreen, EndingScreen, StartingScreen } from './Screens';
import { BracketView, MatchesBoard } from './Bracket';
import { MatchBar, Scoreboard } from './Overlays';
import { Feed } from '../Feed';
import { Nameplate } from '../Nameplate';
import { ScreenBackground, Ticker } from './parts';

const STING_IN = 380; // ms until the panel fully covers the frame
const STING_HOLD = 160;

/** Renders one full-screen scene by id. */
export function ScreenView(props: Parameters<typeof ScreenViewInner>[0]) {
  const v = props.show.vdo;
  return <VdoContext.Provider value={{ password: v.password, params: v.params, embeds: props.embeds !== false && !props.monitor }}><ScreenViewInner {...props} /></VdoContext.Provider>;
}

function ScreenViewInner(props: {
  id: ScreenId; scene: Scene; show: Show; now: number; tournament: Tournament | null; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: BnlData | null;
}) {
  const skin = skinOf(props.show.brand.skin);
  if (!skin) return <ScreenBody {...props} />;
  const { id, scene, show, now, viewer, monitor, bnl = null } = props;
  const bg = skinBackground(skin, id);
  const body = id === 'starting' || id === 'brb' || id === 'ending'
    ? <SkinIntermission skin={skin} kind={id} show={show} now={now} bnl={bnl} />
    : id === 'casters' ? <SkinCasters skin={skin} scene={scene} show={show} viewer={viewer} monitor={monitor} />
    : <ScreenBody {...props} />;
  return (
    <div className="absolute inset-0">
      {bg && <SkinVideo src={bg} />}
      {body}
      {id !== 'gameplay' && show.ticker.onScreens && <SkinTicker skin={skin} show={show} />}
    </div>
  );
}

function ScreenBody({ id, scene, show, now, tournament, viewer, monitor, embeds = true, bnl = null }: {
  id: ScreenId; scene: Scene; show: Show; now: number; tournament: Tournament | null; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: BnlData | null;
}) {
  switch (id) {
    case 'starting': return <StartingScreen show={show} now={now} tournament={tournament} />;
    case 'brb': return <BrbScreen show={show} now={now} />;
    case 'ending': return <EndingScreen show={show} now={now} />;
    case 'bracket': return bnl?.sheet?.matches.length ? <><ScreenBackground /><SheetBracket sheet={bnl.sheet} show={show} /></> : tournament ? <BracketView t={tournament} /> : <ScreenBackground />;
    case 'matches': return bnl?.sheet?.matches.length ? <><ScreenBackground /><SheetMatches sheet={bnl.sheet} show={show} /></> : tournament ? <MatchesBoard t={tournament} show={show} /> : <ScreenBackground />;
    case 'warmup': return <WarmupScreen show={show} now={now} bnl={bnl} embeds={embeds && !monitor} />;
    case 'standings': return <StandingsScreen data={bnl} show={show} />;
    case 'playoffs': return <PlayoffsScreen data={bnl} show={show} />;
    case 'gameplay': return <GameplayScreen scene={scene} show={show} now={now} viewer={viewer} monitor={monitor} embeds={embeds && !monitor} bnl={bnl} />;
    default: {
      const ticker = show.ticker.enabled && show.ticker.onScreens && show.ticker.items.length > 0;
      return (
        <div className="absolute inset-0">
          <ScreenBackground />
          <Stage scene={{ ...scene, showBackground: false }} viewer={viewer} monitor={monitor} layers={{ ...ALL_LAYERS, background: false }} />
          {scene.showBranding && (show.rc.enabled ? (show.showMatchupOnCasters && <RcBar rc={show.rc} />) : <MatchBar show={show} />)}
          {ticker && <div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div>}
        </div>
      );
    }
  }
}

function useConnectedCams(viewer?: RtcViewer | null) {
  const [ids, setIds] = useState<Set<CasterId>>(new Set());
  useEffect(() => {
    if (!viewer) return;
    const offs = ([1, 2, 3] as CasterId[]).map(id => viewer.subscribe(id, s => {
      setIds(prev => {
        const has = !!s && s.getVideoTracks().length > 0;
        if (has === prev.has(id)) return prev;
        const n = new Set(prev); has ? n.add(id) : n.delete(id); return n;
      });
    }));
    return () => offs.forEach(o => o());
  }, [viewer]);
  return ids;
}

/**
 * Gameplay: fully transparent so the game capture underneath in OBS shows
 * through. Scoreboard on top, optional caster cams in a corner, optional ticker.
 */
export function GameplayScreen({ scene, show, now, viewer, monitor, embeds = true, bnl = null }: { scene: Scene; show: Show; now: number; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: BnlData | null }) {
  const g = show.gameplay;
  const ticker = g.ticker && show.ticker.enabled && show.ticker.items.length > 0;
  const connected = useConnectedCams(viewer);
  // Only casters actually sending video: no empty boxes over the game.
  const cams = g.cams
    ? scene.casters.filter(c => c.enabled && c.cameraOn && (
        c.source.type === 'url' ? !!c.source.url : c.source.type === 'webrtc' ? connected.has(c.id) : c.source.type === 'obs'))
    : [];
  const W = 320, H = 180, GAP = 12, M = 28;
  const stripH = show.playerCam.enabled && show.playerCam.mode === 'strip' && (show.lineup.length > 0 || show.rc.enabled) ? 236 : 0;
  const bottom = 1080 - M - H - (ticker ? 56 : 0) - stripH;
  const gskin = skinOf(show.brand.skin);
  return (
    <div className="absolute inset-0">
      {gskin && <SkinBadge skin={gskin} show={show} />}
      {show.rc.enabled ? (show.showScoreboard && <RcBoard rc={show.rc} activeId={show.activePlayer?.id} now={now} />) : <Scoreboard show={show} />}
      <AnimatePresence>
        {cams.map((c, i) => {
          const x = g.corner === 'right' ? 1920 - M - W - (cams.length - 1 - i) * (W + GAP) : M + i * (W + GAP);
          return (
            <motion.div key={c.id} className="absolute overflow-hidden rounded-[6px]"
              style={{ left: x, top: bottom, width: W, height: H, boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.12)' }}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}>
              {c.source.type === 'obs'
                ? (monitor ? <div className="absolute inset-0 grid place-items-center bg-[#1b1b1b] text-[14px] text-white/40">OBS · {c.source.obsSource}</div> : null)
                : <Feed caster={c} viewer={viewer} size="sm" showName={false} monitor={monitor} />}
              <AnimatePresence>{scene.showNames && c.showName && <Nameplate key="np" name={c.name} role="" size="sm" />}</AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {(() => {
        const pc = show.playerCam, box = playerCamBox(show), t = ticker ? 56 : 0;
        const stack = cams.length > 0 && g.corner === pc.corner ? H + 20 : 0;
        if (pc.mode === 'strip') return <CamStrip show={show} bnl={bnl} embeds={embeds} bottom={t + 24} />;
        return <PlayerCam show={show} embeds={embeds} x={pc.corner === 'right' ? 1920 - 40 - box.w : 40} bottom={t + 32 + stack} />;
      })()}
      <SpotlightCard spot={show.spotlight} now={now} bottom={(ticker ? 56 : 0) + 40}
        left={(g.cams && cams.length > 0 && g.corner === 'left') || (show.playerCam.enabled && show.activePlayer && show.playerCam.corner === 'left') ? 1920 - 40 - 820 : 40} />
      {ticker && <div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div>}
    </div>
  );
}

/**
 * /output/program — the complete show in one browser source. Switching
 * screens plays a Glacial stinger: a panel wipes across, the mark holds
 * for a beat, and the new screen is revealed underneath.
 */
export function Program(props: { scene: Scene; show: Show; now: number; tournament: Tournament | null; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: BnlData | null }) {
  const target = props.scene.screen;
  const [shown, setShown] = useState<ScreenId>(target);
  const [sting, setSting] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; setShown(target); return; }
    if (target === shown) return;
    setSting(n => n + 1);
    const t = setTimeout(() => setShown(target), skinOf(props.show.brand.skin)?.stinger.cut ?? STING_IN);
    return () => clearTimeout(t);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sting) return;
    const t = setTimeout(() => setSting(0), skinOf(props.show.brand.skin)?.stinger.length ?? STING_IN * 2 + STING_HOLD + 50);
    return () => clearTimeout(t);
  }, [sting]);

  const theme = props.show.theme;
  const bnl = theme === 'bnl';
  const skin = skinOf(props.show.brand.skin);
  return (
    <ThemeProvider theme={theme} bgProvided={bnl || !!props.show.brand.bg || !!skin} brand={props.show.brand}>
    <div className="glacial-stage absolute inset-0 overflow-hidden" data-theme={theme}>
      {/* One continuous background video behind every screen (not restarted per cut). */}
      {(bnl || !!props.show.brand.bg || !!skin) && <div className="absolute inset-0 transition-opacity duration-300" style={{ opacity: shown === 'gameplay' ? 0 : 1 }}><BgVideo /></div>}
      <AnimatePresence initial={false}>
        <motion.div key={shown} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.01 }}>
          <ScreenView id={shown} {...props} />
        </motion.div>
      </AnimatePresence>
      {/* Always-on "next match" counter, above every screen (stays put through cuts). */}
      <NextMatchCorner show={props.show} bnl={props.bnl ?? null} now={props.now} screen={shown} />
      {skin && <SkinStinger skin={skin} n={sting} />}
      <AnimatePresence>
        {sting > 0 && !skin && (
          <motion.div key={`st-${sting}`} className={`absolute inset-0 overflow-hidden ${bnl ? 'bg-[#060606]' : 'bg-[#161616]'}`}
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)', 'inset(0 0% 0 0)', 'inset(0 0% 0 100%)'] }}
            transition={{ duration: (STING_IN * 2 + STING_HOLD) / 1000, times: [0, 0.42, 0.58, 1], ease: [0.65, 0, 0.35, 1] }}>
            <Pattern opacity={0.45} size={620} />
            {bnl && (
              <>
                <div className="absolute inset-x-0 top-[44%] h-[3px] bg-[var(--accent)]" />
                <div className="absolute inset-x-0 top-[56%] h-[3px] bg-[#2b6cff]" />
              </>
            )}
            <motion.div className="absolute left-1/2 top-1/2" style={{ x: '-50%', y: '-50%' }}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 1.04] }}
              transition={{ duration: (STING_IN * 2 + STING_HOLD) / 1000, times: [0.2, 0.42, 0.62, 0.85] }}>
              <Mark height={150} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </ThemeProvider>
  );
}

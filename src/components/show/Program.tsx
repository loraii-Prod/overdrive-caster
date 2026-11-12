import type { TransitionKind } from '../../../shared/engine';
import { Reveal } from '../Reveal';
import { useEffect, useRef, useState } from 'react';
import { CASTER_IDS, type CasterId } from '../../../shared/types';
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
import { NextMatchCorner, OtherMatchPopout } from './NextMatch';
import { VdoContext } from '../../lib/vdo';
import { skinBackground, skinOf } from '../../../shared/skins';
import { SkinAnalystDesk } from './AnalystDesk';
import { SkinBadge, SkinCasters, SkinIntermission, SkinStinger, SkinTicker, SkinVideo } from './Skin';
import type { MatchData } from '../../../shared/protocol';
import { BrbScreen, EndingScreen, StartingScreen } from './Screens';
import { BracketView, MatchesBoard } from './Bracket';
import { MatchBar, Scoreboard } from './Overlays';
import { Feed } from '../Feed';
import { Nameplate } from '../Nameplate';
import { ScreenBackground, Ticker } from './parts';
import { WcMapCard } from '../wildcard/MapCard';
import { WcChampions } from '../wildcard/Champions';
import { WcInterview } from '../wildcard/Interview';
import { WcVeto } from '../wildcard/Veto';
import { WcBracket, WcCasters, WcMatchesBoard, WcPopups, WcWaiting } from '../wildcard/Wildcard';
import { TwitchOnScreen } from '../wildcard/Twitch';
import { WcDesk, boothScene } from '../wildcard/Desk';
import { EASE } from '../../lib/motion';
import type { WcLive } from '../../lib/hooks';
import type { Skin } from '../../../shared/skins';

type WcPlace = 'inBracket' | 'inIntermission' | 'inCasters' | 'inGameplay' | 'inWarmup';
/** Whether the OverDrive Wildcard graphics replace the generic ones in this part of the program. */
const wcOn = (wc: WcLive | null | undefined, k: WcPlace): wc is WcLive => !!wc && wc.state.enabled && wc.state.opts[k];

/** Starting soon / BRB / Thanks with the wildcard: skin plate (title) on top, up next + countdown, latest result in the bottom bar. */
function WcIntermission({ skin, kind, show, now, wc }: { skin: Skin; kind: 'starting' | 'brb' | 'ending'; show: Show; now: number; wc: WcLive }) {
  const timer = show.timer.target != null && show.timer.showOn[kind] ? show.timer.target : null;
  return (
    <div className="absolute inset-0">
      <motion.img src={skin.plates[kind]} alt="" className="pointer-events-none absolute inset-0 h-full w-full" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} />
      <WcWaiting wc={wc.state} now={now} title="" timer={timer} />
    </div>
  );
}

const STING_IN = 380; // ms until the panel fully covers the frame
const STING_HOLD = 160;

/** Renders one full-screen scene by id. */
export function ScreenView(props: Parameters<typeof ScreenViewInner>[0]) {
  const v = props.show.vdo;
  return (
    <VdoContext.Provider value={{ password: v.password, params: v.params, embeds: props.embeds !== false && !props.monitor, monitorFeeds: !!props.monitorFeeds }}>
      {/* The desk picks its own people; every other screen shows the booth (up to 3 of the 5 slots). */}
      <ScreenViewInner {...props} scene={props.id === 'analysis' || props.id === 'interview' ? props.scene : boothScene(props.scene, props.wc?.state.booth ?? [])} />
      {/* Twitch prediction / poll card on the screens switched on in the Twitch settings. */}
      <TwitchOnScreen tw={props.wc?.tw} id={props.id} now={props.now} />
      <WcChampions wc={props.wc?.state} />
    </VdoContext.Provider>
  );
}

function ScreenViewInner(props: {
  id: ScreenId; scene: Scene; show: Show; now: number; tournament: Tournament | null; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: MatchData | null; wc?: WcLive | null; monitorFeeds?: boolean;
}) {
  const skin = skinOf(props.show.brand.skin);
  if (!skin) return <ScreenBody {...props} />;
  const { id, scene, show, now, viewer, monitor, bnl = null, wc = null } = props;
  const inter = id === 'starting' || id === 'brb' || id === 'ending';
  const wcInter = inter && wcOn(wc, 'inIntermission');
  // The wildcard bracket fills the whole frame: plain loop (no bottom bar) and no ticker under it.
  const wcBracket = ((id === 'bracket' || id === 'matches') && wcOn(wc, 'inBracket')) || id === 'interview' || id === 'veto';
  // Analyst desk: one composition for every panel; it owns its frame and background videos (no remount on panel changes).
  const desk = id === 'analysis';
  const bg = wcBracket ? skin.loop : desk ? null : skinBackground(skin, id);
  const body = inter
    ? (wcInter && wc ? <WcIntermission skin={skin} kind={id} show={show} now={now} wc={wc} /> : <SkinIntermission skin={skin} kind={id} show={show} now={now} bnl={bnl} />)
    : id === 'casters' ? <><SkinCasters skin={skin} scene={scene} show={show} viewer={viewer} monitor={monitor} picks={wc?.state.intro.picksShow ? wc.state.intro.picks : undefined} /><Reveal show={wcOn(wc, 'inCasters')} from="left">{wc && <WcCasters wc={wc.state} now={now} />}</Reveal></>
    : desk ? <SkinAnalystDesk skin={skin} scene={scene} show={show} wc={wc?.state ?? null} now={now} bnl={bnl} viewer={viewer} monitor={monitor} />
    : <ScreenBody {...props} />;
  return (
    <div className="absolute inset-0">
      {bg && <SkinVideo src={bg} />}
      {body}
      <Reveal show={id !== 'gameplay' && !wcInter && !wcBracket && show.ticker.onScreens} from="up" id="s-ticker"><SkinTicker skin={skin} show={show} /></Reveal>
    </div>
  );
}

function ScreenBody({ id, scene, show, now, tournament, viewer, monitor, embeds = true, bnl = null, wc = null }: {
  id: ScreenId; scene: Scene; show: Show; now: number; tournament: Tournament | null; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: MatchData | null; wc?: WcLive | null;
}) {
  if (id === 'bracket' && wcOn(wc, 'inBracket')) return <><ScreenBackground /><WcBracket wc={wc.state} part={wc.state.air} /></>;
  if (id === 'matches' && wcOn(wc, 'inBracket')) return <><ScreenBackground /><WcMatchesBoard wc={wc.state} /></>;
  switch (id) {
    case 'starting': return <StartingScreen show={show} now={now} tournament={tournament} />;
    case 'brb': return <BrbScreen show={show} now={now} />;
    case 'ending': return <EndingScreen show={show} now={now} />;
    case 'bracket': return bnl?.sheet?.matches.length ? <><ScreenBackground /><SheetBracket sheet={bnl.sheet} show={show} /></> : tournament ? <BracketView t={tournament} view={show.bracketView} /> : <ScreenBackground />;
    case 'matches': return bnl?.sheet?.matches.length ? <><ScreenBackground /><SheetMatches sheet={bnl.sheet} show={show} /></> : tournament ? <MatchesBoard t={tournament} show={show} /> : <ScreenBackground />;
    case 'warmup': return <WarmupScreen show={show} now={now} bnl={bnl} embeds={embeds && !monitor} showcase={wcOn(wc, 'inWarmup') ? wc.state : null} casters={scene.casters} />;
    case 'veto': return <><ScreenBackground />{wc && <WcVeto wc={wc.state} show={show} now={now} />}</>;
    case 'interview': return <><ScreenBackground /><WcInterview scene={scene} show={show} wc={wc?.state ?? null} viewer={viewer} monitor={monitor} /></>;
    case 'analysis': return <><ScreenBackground /><WcDesk scene={scene} show={show} wc={wc?.state ?? null} bnl={bnl} viewer={viewer} monitor={monitor} /></>;
    case 'gameplay': return (
      <>
        <GameplayScreen scene={scene} show={show} now={now} viewer={viewer} monitor={monitor} embeds={embeds && !monitor} bnl={bnl} />
        {wcOn(wc, 'inGameplay') && <WcPopups pop={wc.pop} />}
        {wc && <WcMapCard wc={wc.state} show={show} now={now} />}
      </>
    );
    default: {
      const ticker = show.ticker.enabled && show.ticker.onScreens && show.ticker.items.length > 0;
      return (
        <div className="absolute inset-0">
          <ScreenBackground />
          <Stage scene={{ ...scene, showBackground: false }} viewer={viewer} monitor={monitor} layers={{ ...ALL_LAYERS, background: false }} />
          {scene.showBranding && <MatchBar show={show} />}
          <Reveal show={!!ticker} from="up" id="g-ticker"><div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div></Reveal>
        </div>
      );
    }
  }
}

function useConnectedCams(viewer?: RtcViewer | null) {
  const [ids, setIds] = useState<Set<CasterId>>(new Set());
  useEffect(() => {
    if (!viewer) return;
    const offs = CASTER_IDS.map(id => viewer.subscribe(id, s => {
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
export function GameplayScreen({ scene, show, now, viewer, monitor, embeds = true, bnl = null }: { scene: Scene; show: Show; now: number; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: MatchData | null }) {
  const g = show.gameplay;
  const ticker = g.ticker && show.ticker.enabled && show.ticker.items.length > 0;
  const connected = useConnectedCams(viewer);
  // Only casters actually sending video: no empty boxes over the game.
  const cams = g.cams
    ? scene.casters.filter(c => c.enabled && c.cameraOn && (
        c.source.type === 'url' ? !!c.source.url : c.source.type === 'webrtc' ? connected.has(c.id) : c.source.type === 'obs'))
    : [];
  const W = 320, H = 180, GAP = 12, M = 28;
  const stripH = show.playerCam.enabled && show.playerCam.mode === 'strip' && show.lineup.length > 0 ? 236 : 0;
  const bottom = 1080 - M - H - (ticker ? 56 : 0) - stripH;
  const gskin = skinOf(show.brand.skin);
  return (
    <div className="absolute inset-0">
      {gskin && <SkinBadge skin={gskin} show={show} />}
      <Scoreboard show={show} />
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
      <OtherMatchPopout show={show} bnl={bnl} />
    </div>
  );
}

/**
 * /output/program — the complete show in one browser source. Switching
 * screens plays an Overdrive stinger: a panel wipes across, the mark holds
 * for a beat, and the new screen is revealed underneath.
 */
export function Program(props: { scene: Scene; show: Show; now: number; tournament: Tournament | null; viewer?: RtcViewer | null; monitor?: boolean; embeds?: boolean; bnl?: MatchData | null; wc?: WcLive | null; monitorFeeds?: boolean; /** transition of the TAKE that changed the screen (default stinger) */ transition?: TransitionKind; /** Preview monitors: screen changes are instant, never a transition */ instant?: boolean }) {
  const target = props.scene.screen;
  const [shown, setShown] = useState<ScreenId>(target);
  const [sting, setSting] = useState(0);
  const [fade, setFade] = useState(0.01);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; setShown(target); return; }
    if (target === shown) return;
    // Preview is instant: selecting / preparing a scene never plays a broadcast transition.
    if (props.instant) { setSting(0); setFade(0.01); setShown(target); return; }
    // CUT: straight swap. FADE: crossfade. STINGER (default): the skin's stinger covers the swap.
    if (props.transition === 'cut') { setFade(0.01); setShown(target); return; }
    if (props.transition === 'fade') { setFade(0.45); setShown(target); return; }
    setFade(0.01);
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
    <div className="od-stage absolute inset-0 overflow-hidden" data-theme={theme}>
      {/* One continuous background video behind every screen (not restarted per cut). */}
      {(bnl || !!props.show.brand.bg || !!skin) && <div className="absolute inset-0 transition-opacity duration-300" style={{ opacity: shown === 'gameplay' ? 0 : 1 }}><BgVideo /></div>}
      <AnimatePresence initial={false}>
        <motion.div key={shown} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: fade }}>
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

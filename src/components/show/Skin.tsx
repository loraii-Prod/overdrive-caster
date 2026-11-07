import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Scene, Show } from '../../../shared/types';
import type { RtcViewer } from '../../lib/rtcViewer';
import { skinOf, type Skin } from '../../../shared/skins';
import { visibleCasters } from '../../../shared/layout';
import { useTheme } from '../../lib/theme';
import { EASE } from '../../lib/motion';
import { Feed } from '../Feed';
import { Countdown, formatRemaining, Socials, TeamLogo } from './parts';
import { fmtLeft, resolveNextMatch, type NextMatchInfo } from './NextMatch';
import type { MatchData } from '../../../shared/protocol';

export function useSkin(): Skin | null {
  const { brand } = useTheme();
  return skinOf(brand?.skin);
}

/** A looping, muted, full-frame skin video (VP9 alpha keeps transparency). */
export function SkinVideo({ src, style, loop = true, onEnded }: { src: string; style?: CSSProperties; loop?: boolean; onEnded?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const v = ref.current; if (v) { v.currentTime = 0; v.play().catch(() => {}); } }, [src]);
  return <video ref={ref} key={src} src={src} muted loop={loop} playsInline autoPlay preload="auto" onEnded={onEnded}
    className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={style} />;
}

const NAME = 'font-["Montserrat"] font-extrabold italic uppercase';

// ------------------------------------------------------------------ Casters

/** Casters screen in a skin: cameras in the frame holes, frame video on top, names in the bars. */
export function SkinCasters({ skin, scene, show, viewer, monitor }: { skin: Skin; scene: Scene; show: Show; viewer?: RtcViewer | null; monitor?: boolean }) {
  const cams = visibleCasters(scene).slice(0, 3);
  const n = Math.max(1, cams.length);
  const kind = n === 1 ? 'solo' : n === 2 ? 'duo' : 'trio';
  const desk = show.brand.desk || kind === 'solo';
  const frame = desk ? skin.frames.desk[kind] : skin.frames.booth[kind as 'duo' | 'trio'];
  const holes = skin.holes[kind];
  return (
    <div className="absolute inset-0">
      {cams.map((c, i) => {
        const r = holes[i];
        if (!r) return null;
        return (
          <div key={c.id} className="absolute overflow-hidden bg-[#140a0a]" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
            {c.cameraOn && <Feed caster={c} viewer={viewer} size={kind === 'solo' ? 'lg' : 'md'} showName={false} monitor={monitor} />}
          </div>
        );
      })}
      <SkinVideo src={frame} />
      {scene.showNames && cams.map((c, i) => {
        const r = holes[i];
        if (!r || !c.showName) return null;
        return (
          <motion.div key={`n${c.id}`} className="absolute flex items-center gap-3" style={{ left: r.x + 18, top: r.y + r.h, height: skin.nameBar, width: r.w * 0.62 }}
            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: EASE, delay: 0.1 + i * 0.06 }}>
            <span className={`${NAME} truncate text-white`} style={{ fontSize: kind === 'trio' ? 26 : 30 }}>{c.name}</span>
            {c.role && <span className="flex-none font-['Montserrat'] text-[14px] font-bold uppercase tracking-[0.12em] text-white/55">{c.role}</span>}
          </motion.div>
        );
      })}
      {scene.showBranding && <SkinMatchStrip show={show} />}
    </div>
  );
}

/** Match strip under the screen header (teams + score), skin styled. */
export function SkinMatchStrip({ show, top = 190 }: { show: Show; top?: number }) {
  const a = show.teamA, b = show.teamB;
  if (!a.name && !b.name) return null;
  return (
    <motion.div className="absolute left-1/2 flex items-stretch" style={{ top, x: '-50%', height: 64 }} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      <SkinTeam name={a.name} logo={a.logo} tag={a.tag} align="right" />
      <div className="flex items-center gap-3 bg-[var(--accent)] px-5 font-['Russo_One'] text-[38px] leading-none text-white" style={{ clipPath: 'polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%)' }}>
        <span className="tabular-nums">{a.score}</span><span className="text-white/60">-</span><span className="tabular-nums">{b.score}</span>
      </div>
      <SkinTeam name={b.name} logo={b.logo} tag={b.tag} align="left" />
    </motion.div>
  );
}

function SkinTeam({ name, logo, tag, align }: { name: string; logo: string; tag: string; align: 'left' | 'right' }) {
  return (
    <div className={`flex w-[360px] items-center gap-3 bg-[#0c0606]/90 px-4 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo team={{ name, tag, logo }} size={44} />
      <span className={`${NAME} min-w-0 flex-1 truncate text-[26px] text-white`}>{name}</span>
    </div>
  );
}

// ------------------------------------------------------------ Intermissions

/** Starting soon / BRB / Thanks: plate (title + logo) over the panel loop, live info in the lower panel. */
export function SkinIntermission({ skin, kind, show, now, bnl }: { skin: Skin; kind: 'starting' | 'brb' | 'ending'; show: Show; now: number; bnl: MatchData | null }) {
  const p = skin.panels.body;
  const nm = resolveNextMatch(show, bnl, now);
  const timer = show.timer.target != null && show.timer.showOn[kind];
  const left = timer ? show.timer.target! - now : 0;
  const a = show.teamA, b = show.teamB;
  const hasMatch = show.showMatchupOnScreens && (a.name || b.name);
  return (
    <div className="absolute inset-0">
      <motion.img src={skin.plates[kind]} alt="" className="pointer-events-none absolute inset-0 h-full w-full" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} />
      <div className="absolute flex items-center gap-10 px-12" style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
        {timer && (
          // Fixed width keeps the divider + matchup panel from drifting as the
          // digit string's rendered width flexes slightly every second.
          <div className="flex-none" style={{ minWidth: 420 }}>
            <div className={`${NAME} text-[22px] text-white/60`}>{kind === 'brb' ? 'BACK IN' : kind === 'ending' ? 'NEXT BROADCAST' : 'STARTING IN'}</div>
            <div className="font-['Russo_One'] text-[120px] leading-none tabular-nums text-white">{left > 0 ? formatRemaining(left) : <span className="text-[64px]">{show.timer.endText}</span>}</div>
          </div>
        )}
        {timer && <div className="h-[200px] w-[3px] flex-none bg-[var(--accent)]" />}
        <div className="min-w-0 flex-1">
          {kind !== 'ending' && hasMatch ? (
            <>
              <div className={`${NAME} text-[22px] text-white/60`}>{kind === 'brb' ? 'CURRENT MATCH' : 'UP NEXT'} {show.bestOf ? `· BO${show.bestOf}` : ''}</div>
              <div className="mt-3 flex items-center gap-5">
                <TeamLogo team={a} size={84} />
                <span className={`${NAME} min-w-0 truncate text-[44px] text-white`}>{a.name}</span>
                {kind === 'brb' ? <span className="flex-none font-['Russo_One'] text-[52px] text-[var(--accent)]">{a.score} - {b.score}</span> : <span className="flex-none font-['Russo_One'] text-[40px] text-[var(--accent)]">VS</span>}
                <span className={`${NAME} min-w-0 truncate text-[44px] text-white`}>{b.name}</span>
                <TeamLogo team={b} size={84} />
              </div>
            </>
          ) : nm ? (
            <SkinNext info={nm} now={now} />
          ) : (
            <div><div className={`${NAME} text-[22px] text-white/60`}>FOLLOW US</div><div className="mt-4"><Socials show={show} size={26} gap={48} /></div></div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkinNext({ info, now }: { info: NextMatchInfo; now: number }) {
  const left = fmtLeft(info.target - now);
  return (
    <div>
      <div className={`${NAME} text-[22px] text-white/60`}>NEXT MATCH {info.time && `· ${info.time}`}</div>
      <div className={`${NAME} mt-2 truncate text-[46px] leading-tight text-white`}>{info.label}</div>
      {info.players.length > 0 && <div className="mt-1 truncate font-['Montserrat'] text-[20px] font-bold text-white/60">{info.players.join(' · ')}</div>}
      <div className="mt-2 font-['Russo_One'] text-[40px] text-[var(--accent)]">{left ? `IN ${left}` : 'STARTING NOW'}</div>
    </div>
  );
}

/** Scrolling ticker text inside the skin's bottom bar. */
export function SkinTicker({ skin, show }: { skin: Skin; show: Show }) {
  const items = show.ticker.items;
  if (!show.ticker.enabled || !items.length) return null;
  const r = skin.bottomBar;
  const text = items.join('     ◆     ');
  const w = show.nextMatch.enabled ? r.w - 410 : r.w;
  return (
    <div className="pointer-events-none absolute overflow-hidden" style={{ left: r.x, top: r.y, width: w, height: r.h, maskImage: 'linear-gradient(90deg, transparent, #000 40px, #000 calc(100% - 40px), transparent)' }}>
      <div className={`glacial-ticker absolute top-0 flex h-full items-center whitespace-nowrap ${NAME} text-[30px] text-white/90`}
        style={{ animationDuration: `${Math.max(20, text.length / 4)}s`, ['--ticker-w' as string]: `${text.length * 18 + 200}px` }}>
        <span className="pr-[200px]">{text}</span><span className="pr-[200px]">{text}</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Gameplay badge

/** Replay / Highlights package on gameplay: transition stinger, then the looping badge. */
export function SkinBadge({ skin, show }: { skin: Skin; show: Show }) {
  const { kind, at } = show.badge;
  const [shown, setShown] = useState(kind);
  const [trans, setTrans] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; setShown(kind); return; }
    const pkg = kind !== 'none' ? skin.overlays[kind] : shown !== 'none' ? skin.overlays[shown] : null;
    if (!pkg) { setShown(kind); return; }
    setTrans(`${pkg.transition}#${at}`);
    const t1 = setTimeout(() => setShown(kind), pkg.cut);
    const t2 = setTimeout(() => setTrans(null), pkg.length + 50);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [kind, at]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {shown !== 'none' && <SkinVideo src={skin.overlays[shown].loop} />}
      {trans && <SkinVideo src={trans.split('#')[0]} loop={false} style={{ zIndex: 40 }} />}
    </>
  );
}

/** Skin stinger video (covers the cut). */
export function SkinStinger({ skin, n }: { skin: Skin; n: number }) {
  return (
    <AnimatePresence>
      {n > 0 && <motion.div key={n} className="pointer-events-none absolute inset-0" style={{ zIndex: 60 }} exit={{ opacity: 0 }}><SkinVideo src={skin.stinger.src} loop={false} /></motion.div>}
    </AnimatePresence>
  );
}

export { Countdown };

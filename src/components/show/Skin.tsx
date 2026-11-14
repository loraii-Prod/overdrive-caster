import { hiRes } from '../../../shared/assetRes';
import { Reveal } from '../Reveal';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Caster, Scene, Show } from '../../../shared/types';
import type { RtcViewer } from '../../lib/rtcViewer';
import { skinOf, type Skin } from '../../../shared/skins';
import { visibleCasters } from '../../../shared/layout';
import { useTheme } from '../../lib/theme';
import { EASE } from '../../lib/motion';
import { Feed } from '../Feed';
import { Countdown, formatRemaining, Score, Socials, TeamLogo } from './parts';
import { fmtLeft, resolveNextMatch, type NextMatchInfo } from './NextMatch';
import type { MatchData } from '../../../shared/protocol';
import type { WcPick } from '../../../shared/wildcard';
import { PickBadge } from '../wildcard/Desk';
import { teamLogo } from '../../../shared/major';
import { EASE_OUT, HoleBacking, StageVideo, useGfxTransition, useRecent, useStaged } from '../../gfx/transition';

const EASE_OUT_ARR = [0.22, 1, 0.36, 1] as const; // = EASE_OUT (the frame-video crossfade curve)

export function useSkin(): Skin | null {
  const { brand } = useTheme();
  return skinOf(brand?.skin);
}

/** A looping, muted, full-frame skin video (VP9 alpha keeps transparency). */
export function SkinVideo({ src, style, loop = true, onEnded }: { src: string; style?: CSSProperties; loop?: boolean; onEnded?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const v = ref.current; if (v) { v.currentTime = 0; v.play().catch(() => {}); } }, [src]);
  return <video ref={ref} key={src} src={hiRes(src)} muted loop={loop} playsInline autoPlay preload="auto" onEnded={onEnded}
    className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={style} />;
}

const NAME = 'font-["Montserrat"] font-extrabold italic uppercase';

// ------------------------------------------------------------------ Casters

/** Which frame video and hole set a booth of `n` cameras uses. */
export function boothFrame(skin: Skin, n: number, desk: boolean) {
  const kind: 'solo' | 'duo' | 'trio' = n <= 1 ? 'solo' : n === 2 ? 'duo' : 'trio';
  const d = desk || kind === 'solo';
  return { kind, frame: d ? skin.frames.desk[kind] : skin.frames.booth[kind as 'duo' | 'trio'] };
}

/**
 * Casters screen in a skin: cameras in the frame holes, frame video on top, names in the bars.
 * Solo / Duo / Trio: the incoming frame video is decoded before anything changes, then it crossfades over
 * the outgoing one while the cameras MOVE to their new holes (camera elements are never remounted, so feeds
 * keep playing and VDO.Ninja views don't reconnect). No frame is ever left without a frame video.
 */
export function SkinCasters({ skin, scene, show, viewer, monitor, picks, casters, desk: forceDesk, strip = true }: { skin: Skin; scene: Scene; show: Show; viewer?: RtcViewer | null; monitor?: boolean; /** Caster predictions by slot, shown in the name bars. */ picks?: Record<string, WcPick>; /** Who is on camera (default: visible casters). */ casters?: Caster[]; /** Always use the analyst desk frames. */ desk?: boolean; strip?: boolean }) {
  const tr = useGfxTransition();
  const live = (casters ?? visibleCasters(scene)).slice(0, 3);
  const target = { ...boothFrame(skin, Math.max(1, live.length), !!(forceDesk || show.brand.desk)), ids: live.map(c => c.id) };
  const st = useStaged(target, t => `${t.frame}|${t.ids.join(',')}`, t => [t.frame]);
  const { kind, frame, ids } = st.shown;
  const holes = skin.holes[kind];
  const cams = ids.map(id => live.find(c => c.id === id) ?? scene.casters.find(c => c.id === id)).filter((c): c is Caster => !!c);
  const s = tr.ms / 1000;
  // Cameras, names and badges move on the SAME curve and clock as the frame-video crossfade (StageVideo: CSS
  // opacity over tr.ms with EASE_OUT). Before, the cameras used a slower ease-in-out driven from JS a frame or more
  // after the frame fade had started, so the new frame was already showing while the camera was still in its old
  // hole (measured: camera half-way ~120 ms after the frame).
  const cut = tr.kind === 'cut';
  const move = { duration: cut ? 0 : s, ease: EASE_OUT_ARR };
  const backing = useRecent(kind, k => k, tr.ms).flatMap(k => skin.holes[k]);
  // Every seated booth camera stays mounted (hidden ones at opacity 0): a camera leaving the layout keeps its
  // video/VDO.Ninja view, so coming back is instant and never reconnects.
  const pool = [...cams, ...live.filter(c => !ids.includes(c.id)), ...scene.casters.filter(c => (c.enabled || c.standby) && c.id <= 3 && !ids.includes(c.id) && !live.some(l => l.id === c.id))].slice(0, 3);
  // what each camera showed at the last COMMITTED render (written after commit, so a re-render never misreads it)
  const last = useRef(new Map<number, { r: { x: number; y: number; w: number; h: number }; on: boolean }>());
  const next = new Map<number, { r: { x: number; y: number; w: number; h: number }; on: boolean; fresh?: boolean }>();
  const [, bump] = useState(0);
  // a camera mounted straight into a hole is first committed hidden, then entered with the transition
  useLayoutEffect(() => { const fresh = [...next].some(([id, v]) => v.fresh); last.current = next; if (fresh) bump(n => n + 1); });
  return (
    <div className="absolute inset-0" style={{ isolation: 'isolate' }} data-booth={kind}>
      <HoleBacking holes={backing} />
      {/* Cameras: one persistent element per caster, moving between holes. */}
      {pool.map(c => {
        const i = ids.indexOf(c.id), r = i >= 0 ? holes[i] : undefined;
        const prev = last.current.get(c.id);
        const on = !!r && !!prev; // never shown before: one hidden commit first, so it can enter like the others
        const rect = r ?? prev?.r ?? holes[0];
        const entering = on && !prev?.on;
        next.set(c.id, { r: rect, on, fresh: !prev && !!r });
        const geo = cut || entering ? 'none' : `left ${tr.ms}ms ${EASE_OUT}, top ${tr.ms}ms ${EASE_OUT}, width ${tr.ms}ms ${EASE_OUT}, height ${tr.ms}ms ${EASE_OUT}`;
        // an entering camera is already live (kept mounted), so it fades in WITH its new hole (same curve and clock as
        // the frame video) instead of 60-180 ms later: the hole is never shown empty
        const fd = cut ? 0 : tr.ms;
        const fade = on ? `opacity ${fd}ms ${EASE_OUT}, transform ${fd}ms ${EASE_OUT}` : `opacity ${Math.round(fd * 0.8)}ms ${EASE_OUT}, transform ${Math.round(fd * 0.8)}ms ${EASE_OUT}`;
        return (
          <div key={c.id} data-cam={c.id} data-cam-on={on ? '1' : '0'} className="absolute overflow-hidden bg-[#140a0a]"
            style={{ zIndex: 1, left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: on ? 1 : 0, transform: on ? 'none' : 'scale(0.96)', transition: geo === 'none' ? fade : `${geo}, ${fade}`, visibility: on || prev?.on || (!prev && r) ? undefined : 'hidden' }}>
            {c.cameraOn && <Feed caster={c} viewer={viewer} size={kind === 'solo' ? 'lg' : 'md'} showName={false} monitor={monitor} />}
          </div>
        );
      })}
      {/* Frame videos: the shown one on top; the outgoing one stays fully visible under it until the crossfade ends. */}
      {st.mounted.map(src => (
        <StageVideo key={src} src={src} visible={src === frame} ms={tr.kind === 'cut' ? 0 : tr.ms} wipe={tr.kind === 'wipe'} leave="hold" z={src === frame ? 3 : 2} onReady={st.ready} />
      ))}
      <div className="absolute inset-0" style={{ zIndex: 4 }}>
        <AnimatePresence>
          {scene.showNames && cams.map((c, i) => {
            const r = holes[i];
            if (!r || !c.showName) return null;
            return (
              <motion.div key={`n${c.id}`} className="absolute flex items-center gap-3" style={{ height: skin.nameBar }}
                initial={{ opacity: 0, x: -10, left: r.x + 18, top: r.y + r.h, width: r.w * 0.62 }}
                animate={{ opacity: 1, x: 0, left: r.x + 18, top: r.y + r.h, width: r.w * 0.62 }}
                exit={{ opacity: 0, transition: { duration: s * 0.6 } }}
                transition={{ default: move, opacity: { duration: 0.35, ease: EASE, delay: 0.1 + i * 0.06 }, x: { duration: 0.35, ease: EASE, delay: 0.1 + i * 0.06 } }}>
                <span className={`${NAME} truncate text-white`} style={{ fontSize: kind === 'trio' ? 26 : 30, transition: `font-size ${tr.ms}ms` }}>{c.name}</span>
                {c.role && <span className="flex-none font-['Montserrat'] text-[14px] font-bold uppercase tracking-[0.12em] text-white/55">{c.role}</span>}
              </motion.div>
            );
          })}
        </AnimatePresence>
        {/* Caster predictions: top-right corner of each camera. */}
        <AnimatePresence>
          {picks && cams.map((c, i) => {
            const r = holes[i], pk = picks[String(c.id)];
            if (!r || !pk) return null;
            return (
              <motion.div key={`p${c.id}`} className="absolute"
                initial={{ opacity: 0, y: -10, scale: 0.9, right: 1920 - (r.x + r.w - 14), top: r.y + 14 }}
                animate={{ opacity: 1, y: 0, scale: 1, right: 1920 - (r.x + r.w - 14), top: r.y + 14 }}
                exit={{ opacity: 0, y: -10, scale: 0.9, transition: { duration: 0.25 } }}
                transition={{ default: move, opacity: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.08 }, y: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.08 }, scale: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.08 } }}>
                <PickBadge pick={pk} size={kind === 'trio' ? 'sm' : 'md'} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="absolute inset-0" style={{ zIndex: 5 }}>
        <Reveal show={!!(strip && scene.showBranding && show.showMatchupOnCasters)} from="down"><SkinMatchStrip show={show} /></Reveal>
      </div>
    </div>
  );
}

/** Team A vs Team B strip (match intro teams), skin styled, with an optional round label above. */
export function SkinVsStrip({ a, b, label, top, left = null, teams = true }: { a: string; b: string; label: string; top: number; /** ms to the match (countdown), or null */ left?: number | null; teams?: boolean }) {
  const cd = left == null ? '' : left > 0 ? `Starts in ${formatRemaining(left)}` : 'Starting now';
  if (cd) label = label ? `${label} · ${cd}` : cd;
  return (
    <motion.div className="absolute inset-x-0 flex flex-col items-center" style={{ top: label ? top - 32 : top }} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      {label && <div className="mb-2 font-['Montserrat'] text-[16px] font-extrabold uppercase italic tracking-[0.14em] text-[var(--accent)]">{label}</div>}
      {teams && <div className="flex items-stretch" style={{ height: 64 }}>
        <SkinTeam name={a || 'TBD'} logo={teamLogo(a) ?? ''} tag="" align="right" width={470} />
        <div className="flex items-center bg-[var(--accent)] px-6 font-['Russo_One'] text-[30px] leading-none text-white" style={{ clipPath: 'polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%)' }}>VS</div>
        <SkinTeam name={b || 'TBD'} logo={teamLogo(b) ?? ''} tag="" align="left" width={470} />
      </div>}
    </motion.div>
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
        <Score n={a.score} size={38} inherit /><span className="text-white/60">-</span><Score n={b.score} size={38} inherit />
      </div>
      <SkinTeam name={b.name} logo={b.logo} tag={b.tag} align="left" />
    </motion.div>
  );
}

function SkinTeam({ name, logo, tag, align, width = 360 }: { name: string; logo: string; tag: string; align: 'left' | 'right'; width?: number }) {
  return (
    <div style={{ width }} className={`flex items-center gap-3 bg-[#0c0606]/90 px-4 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
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
      <motion.img src={hiRes(skin.plates[kind])} alt="" className="pointer-events-none absolute inset-0 h-full w-full" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} />
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
      <div className={`od-ticker absolute top-0 flex h-full items-center whitespace-nowrap ${NAME} text-[30px] text-white/90`}
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

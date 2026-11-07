import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Show, Team } from '../../../shared/types';
import { SOCIAL_LABELS } from '../../../shared/defaults';
import { EASE } from '../../lib/motion';
import { BgVideo, Mark, Pattern } from '../Brand';
import { useTheme } from '../../lib/theme';

/** Shrinks a single line of text to fit its box instead of wrapping or clipping. */
export function FitText({ children, max, className = '', style }: { children: ReactNode; max: number; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const w = inner.current?.scrollWidth ?? 0;
    setScale(w > max ? max / w : 1);
  }, [children, max]);
  return (
    <div ref={box} className={className} style={{ ...style, maxWidth: max, whiteSpace: 'nowrap' }}>
      <span ref={inner} style={{ display: 'inline-block', transform: `scale(${scale})`, transformOrigin: style?.textAlign === 'center' ? 'center' : 'left center' }}>{children}</span>
    </div>
  );
}

/** Glacial backdrop for full-screen scenes: two pattern layers drifting in opposite directions. */
export function ScreenBackground() {
  const { theme, bgProvided, brand } = useTheme();
  if (brand?.skin) return null;
  if (theme === 'bnl' || brand?.bg) return bgProvided ? null : <BgVideo />;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#141414]">
      <Pattern drift opacity={0.5} size={620} />
      <div className="glacial-drift-rev absolute inset-0" style={{ backgroundImage: 'url(/brand/glacial-pattern.svg)', backgroundSize: '1100px auto', opacity: 0.12 }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 45%, rgba(20,20,20,0.35) 0%, rgba(14,14,14,0.92) 100%)' }} />
    </div>
  );
}

/** Staggered fade-up used by screen content. */
export function Rise({ i = 0, children, className, style }: { i?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <motion.div className={className} style={style} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 + i * 0.07, ease: EASE }}>
      {children}
    </motion.div>
  );
}

export function TeamLogo({ team, size }: { team: Pick<Team, 'name' | 'tag' | 'logo'>; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [team.logo]);
  if (team.logo && !broken) {
    return <img src={team.logo} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }} />;
  }
  return (
    <div className="grid flex-none place-items-center rounded-[6px] border border-white/15 bg-[#1e1e1e] font-display font-bold text-white/85"
      style={{ width: size, height: size, fontSize: size * (team.tag.length > 3 ? 0.24 : 0.3), letterSpacing: '0.04em' }}>
      {team.tag || team.name.slice(0, 3).toUpperCase() || '?'}
    </div>
  );
}

/** Digits in fixed-width cells so the countdown never jitters. */
export function Digits({ text, size, className = '' }: { text: string; size: number; className?: string }) {
  const { theme } = useTheme();
  const dw = theme === 'bnl' ? '0.46em' : '0.64em', cw = theme === 'bnl' ? '0.22em' : '0.32em';
  return (
    <span className={`inline-flex font-display font-semibold leading-none ${className}`} style={{ fontSize: size }}>
      {[...text].map((ch, i) => (
        <span key={i} style={{ width: /\d/.test(ch) ? dw : cw, textAlign: 'center', display: 'inline-block' }}>{ch}</span>
      ))}
    </span>
  );
}

export function formatRemaining(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** Countdown or end text. Returns null when no timer is set. */
export function Countdown({ show, now, size, align = 'left', label }: { show: Show; now: number; size: number; align?: 'left' | 'center'; label?: string }) {
  const t = show.timer;
  if (t.target == null) return null;
  const left = t.target - now;
  return (
    <div style={{ textAlign: align }}>
      <div className="mb-[0.6em] font-sans font-semibold uppercase text-white/55" style={{ fontSize: size * 0.16, letterSpacing: '0.3em' }}>{label ?? t.label}</div>
      <AnimatePresence mode="wait" initial={false}>
        {left > 0 ? (
          <motion.div key="t" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}><Digits text={formatRemaining(left)} size={size} /></motion.div>
        ) : (
          <motion.div key="e" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}
            className="font-display font-semibold uppercase leading-none" style={{ fontSize: size * 0.62, letterSpacing: '0.02em' }}>
            {t.endText}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


/** Team A vs Team B card. `mode`: up next (no score) / live score / final result. `stacked` suits narrow columns. */
export function Matchup({ show, mode, scale = 1, width = 860, stacked = false }: { show: Show; mode: 'next' | 'score' | 'final'; scale?: number; width?: number; stacked?: boolean }) {
  const s = (n: number) => n * scale;
  const label = mode === 'next' ? 'UP NEXT' : mode === 'final' ? 'FINAL RESULT' : `GAME ${show.game} · BO${show.bestOf}`;
  const winA = mode === 'final' && show.teamA.score > show.teamB.score;
  const winB = mode === 'final' && show.teamB.score > show.teamA.score;
  const pad = 26, gap = 20, logo = stacked ? 104 : 88;
  const center = mode === 'next' ? (stacked ? 70 : 90) : 190;
  const sideW = (width - pad * 2 - center - gap * 2) / 2;
  const nameMax = s(stacked ? sideW : sideW - logo - 22);
  const side = (team: Team, right: boolean, win: boolean) => (
    <div className={`flex min-w-0 items-center ${stacked ? 'flex-col text-center' : right ? 'flex-row-reverse text-right' : ''}`}
      style={{ width: s(sideW), gap: s(stacked ? 16 : 22), opacity: mode === 'final' && !win ? 0.55 : 1 }}>
      <TeamLogo team={team} size={s(logo)} />
      <div className="min-w-0">
        <FitText max={nameMax} className="font-display font-semibold uppercase leading-none text-white" style={{ fontSize: s(stacked ? 28 : 34), letterSpacing: '0.02em', textAlign: stacked ? 'center' : right ? 'right' : 'left' }}>{team.name}</FitText>
        <div className="mt-[0.5em] font-sans font-semibold uppercase text-white/45" style={{ fontSize: s(13), letterSpacing: '0.26em' }}>{team.tag}</div>
      </div>
    </div>
  );
  return (
    <div className="relative overflow-hidden rounded-[8px] border border-white/10" style={{ width: s(width), background: 'rgba(16,16,16,0.82)', backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between border-b border-white/[0.07]" style={{ padding: `${s(12)}px ${s(pad)}px` }}>
        <span className="font-sans font-bold text-white/70" style={{ fontSize: s(12), letterSpacing: '0.3em' }}>{label}</span>
        <span className="font-sans font-semibold text-white/40" style={{ fontSize: s(12), letterSpacing: '0.22em' }}>{[show.stage, show.mapName].filter(Boolean).join(' · ').toUpperCase()}</span>
      </div>
      <div className="flex items-center" style={{ padding: `${s(26)}px ${s(pad)}px`, gap: s(gap) }}>
        {side(show.teamA, false, winA)}
        <div className="flex flex-none items-center justify-center" style={{ width: s(center), gap: s(14) }}>
          {mode === 'next' ? (
            <span className="font-display font-bold text-white/40" style={{ fontSize: s(30), letterSpacing: '0.1em' }}>VS</span>
          ) : (
            <>
              <Score n={show.teamA.score} size={s(64)} dim={mode === 'final' && !winA} />
              <span className="font-display text-white/30" style={{ fontSize: s(40) }}>–</span>
              <Score n={show.teamB.score} size={s(64)} dim={mode === 'final' && !winB} />
            </>
          )}
        </div>
        {side(show.teamB, true, winB)}
      </div>
    </div>
  );
}

function Score({ n, size, dim }: { n: number; size: number; dim?: boolean }) {
  return (
    <span className="relative inline-block overflow-hidden text-center font-display font-bold leading-none" style={{ fontSize: size, width: '0.8em', height: '1em', opacity: dim ? 0.5 : 1 }}>
      <AnimatePresence initial={false}>
        <motion.span key={n} className="absolute inset-0" initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.35, ease: EASE }}>{n}</motion.span>
      </AnimatePresence>
    </span>
  );
}
export { Score };

export function Socials({ show, size = 18, gap = 40 }: { show: Show; size?: number; gap?: number }) {
  if (!show.socials.length) return null;
  return (
    <div className="flex items-center" style={{ gap }}>
      {show.socials.map((s, i) => (
        <div key={i} className="flex items-baseline" style={{ gap: size * 0.6 }}>
          <span className="font-sans font-bold text-white/45" style={{ fontSize: size * 0.62, letterSpacing: '0.24em' }}>{SOCIAL_LABELS[s.platform]}</span>
          <span className="font-display font-semibold text-white" style={{ fontSize: size }}>{s.handle}</span>
        </div>
      ))}
    </div>
  );
}

/** Rotates sponsor logos with a crossfade. */
export function Sponsors({ show, height = 56, label = 'PARTNERS' }: { show: Show; height?: number; label?: string }) {
  const [i, setI] = useState(0);
  const list = show.sponsors;
  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => setI(x => (x + 1) % list.length), show.sponsorSeconds * 1000);
    return () => clearInterval(t);
  }, [list.length, show.sponsorSeconds]);
  if (!list.length) return null;
  const src = list[i % list.length];
  return (
    <div className="flex items-center" style={{ gap: 22 }}>
      <span className="font-sans font-bold text-white/40" style={{ fontSize: 11, letterSpacing: '0.3em' }}>{label}</span>
      <div className="relative" style={{ height, width: height * 3.2 }}>
        <AnimatePresence initial={false}>
          <motion.img key={src} src={src} alt="" className="absolute inset-0 h-full w-full object-contain object-left"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45, ease: EASE }} />
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Continuous news ticker. Speed is in px/s, so long and short text move alike. */
export function Ticker({ show, height = 48 }: { show: Show; height?: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const items = show.ticker.items;
  const key = items.join('\u0001');
  useLayoutEffect(() => { setW((track.current?.scrollWidth ?? 0) / 2); }, [key]);
  if (!show.ticker.enabled || !items.length || show.brand.skin) return null;
  const row = (dup: boolean) => items.map((t, i) => (
    <span key={`${dup}-${i}`} className="inline-flex items-center" aria-hidden={dup}>
      <Mark height={height * 0.42} style={{ margin: `0 ${height * 0.6}px`, opacity: 0.7, display: 'inline-block' }} />
      <span>{t}</span>
    </span>
  ));
  return (
    <div className="relative flex overflow-hidden border-t border-white/10" style={{ height, background: 'rgba(12,12,12,0.9)' }}>
      <div className="z-10 flex flex-none items-center bg-white px-6 font-sans font-bold text-[#111]" style={{ fontSize: height * 0.27, letterSpacing: '0.26em' }}>
        {show.tournament || 'GLACIAL'}
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div ref={track} className="glacial-ticker absolute top-0 flex h-full items-center whitespace-nowrap font-sans font-medium text-white/90"
          style={{ fontSize: height * 0.4, animationDuration: `${Math.max(5, w / show.ticker.speed)}s`, ['--ticker-w' as string]: `${w}px` }}>
          {row(false)}{row(true)}
        </div>
      </div>
    </div>
  );
}

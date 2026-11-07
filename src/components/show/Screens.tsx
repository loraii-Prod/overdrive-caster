import type { ReactNode } from 'react';
import type { Show } from '../../../shared/types';
import type { Tournament } from '../../../shared/tournament';
import { isTeam, resolve, upcoming } from '../../../shared/tournament';
import { Logo } from '../Brand';
import { useTheme } from '../../lib/theme';
import { Countdown, FitText, Matchup, PrizeCard, Rise, ScreenBackground, Socials, Sponsors, Ticker } from './parts';

/** Shared frame for full-screen scenes: background, top bar, bottom bar, ticker. */
export function ScreenChrome({ show, children, footer = true }: { show: Show; children: ReactNode; footer?: boolean }) {
  const ticker = show.ticker.enabled && show.ticker.onScreens && show.ticker.items.length > 0;
  const { theme } = useTheme();
  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScreenBackground />
      <Rise className="absolute flex items-start justify-between" style={{ left: 80, right: 80, top: 56 }}>
        {theme === 'bnl' ? <span /> : <Logo height={92} />}
        <div className="text-right">
          <div className="font-display font-semibold uppercase text-white" style={{ fontSize: 24, letterSpacing: '0.22em' }}>{show.tournament}</div>
          <div className="mt-2 font-sans font-semibold uppercase text-white/45" style={{ fontSize: 14, letterSpacing: '0.3em' }}>{show.stage}</div>
        </div>
      </Rise>
      {children}
      {footer && (
        <Rise i={6} className="absolute flex items-center justify-between" style={{ left: 80, right: 80, bottom: ticker ? 84 : 52, height: 64 }}>
          <Socials show={show} size={20} />
          <Sponsors show={show} height={52} />
        </Rise>
      )}
      {footer && <div className="absolute" style={{ left: 80, right: 80, bottom: ticker ? 160 : 128, height: 1, background: 'rgba(255,255,255,0.12)' }} />}
      {ticker && <div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div>}
    </div>
  );
}

function Title({ text, size, align = 'left', max }: { text: string; size: number; align?: 'left' | 'center'; max: number }) {
  return (
    <FitText max={max} className="font-display font-bold uppercase leading-[0.92] text-white" style={{ fontSize: size, letterSpacing: '-0.01em', textAlign: align }}>
      {text}
    </FitText>
  );
}

function Subtitle({ text, align = 'left' }: { text: string; align?: 'left' | 'center' }) {
  if (!text) return null;
  return <div className="font-sans font-medium text-white/60" style={{ fontSize: 30, textAlign: align }}>{text}</div>;
}

/** Up-next list: bracket matches when available, otherwise the manual schedule. */
function Schedule({ show, tournament }: { show: Show; tournament: Tournament | null }) {
  const rows: { time: string; label: string; detail?: string; live?: boolean }[] = [];
  if (show.scheduleFromBracket && tournament) {
    const res = resolve(tournament);
    for (const { m, r } of upcoming(tournament, res, 4)) {
      const n = (s: typeof r.a) => (isTeam(s) ? s.tag || s.name : 'TBD');
      rows.push({ time: m.status === 'live' ? 'LIVE' : m.time || '—', label: `${n(r.a)}  vs  ${n(r.b)}`, detail: m.label, live: m.status === 'live' });
    }
  }
  if (!rows.length) show.schedule.forEach(s => rows.push({ time: s.time, label: s.label }));
  if (!rows.length) return null;
  return (
    <div style={{ width: 560 }}>
      <div className="mb-5 font-sans font-bold text-white/50" style={{ fontSize: 13, letterSpacing: '0.32em' }}>SCHEDULE</div>
      <div className="border-t border-white/10">
        {rows.slice(0, 4).map((r, i) => (
          <Rise key={i} i={3 + i} className="flex items-center border-b border-white/10" style={{ height: 70, gap: 24 }}>
            <span className={`font-display font-semibold ${r.live ? 'text-[#ff5d62]' : 'text-white/55'}`} style={{ fontSize: 20, width: 92, letterSpacing: '0.04em' }}>{r.time}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display font-semibold uppercase text-white" style={{ fontSize: 22, letterSpacing: '0.03em' }}>{r.label}</div>
              {r.detail && <div className="mt-1 truncate font-sans font-semibold uppercase text-white/40" style={{ fontSize: 12, letterSpacing: '0.24em' }}>{r.detail}</div>}
            </div>
          </Rise>
        ))}
      </div>
    </div>
  );
}

export function StartingScreen({ show, now, tournament }: { show: Show; now: number; tournament: Tournament | null }) {
  const s = show.screens.starting;
  return (
    <ScreenChrome show={show}>
      <div className="absolute" style={{ left: 80, top: 270, width: 1060 }}>
        <Rise i={1}><div className="mb-6 h-[3px] w-16 bg-white" /></Rise>
        <Rise i={1}><Title text={s.title} size={148} max={1060} /></Rise>
        <Rise i={2} className="mt-6"><Subtitle text={s.subtitle} /></Rise>
        {show.timer.showOn.starting && (
          <Rise i={3} className="mt-14"><Countdown show={show} now={now} size={132} /></Rise>
        )}
      </div>
      {show.prize.enabled && <Rise i={5} className="absolute" style={{ left: 80, bottom: show.ticker.enabled && show.ticker.onScreens ? 190 : 160 }}><PrizeCard show={show} width={1000} /></Rise>}
      <div className="absolute flex flex-col items-end" style={{ right: 80, top: 270, gap: 48 }}>
        {show.showMatchupOnScreens && <Rise i={2}><Matchup show={show} mode="next" width={560} stacked /></Rise>}
        <Schedule show={show} tournament={tournament} />
      </div>
    </ScreenChrome>
  );
}

export function BrbScreen({ show, now }: { show: Show; now: number }) {
  const s = show.screens.brb;
  return (
    <ScreenChrome show={show}>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: 250 }}>
        <Rise i={1}><Title text={s.title} size={168} align="center" max={1500} /></Rise>
        <Rise i={2} className="mt-6"><Subtitle text={s.subtitle} align="center" /></Rise>
        {show.showMatchupOnScreens && <Rise i={3} className="mt-14"><Matchup show={show} mode="score" width={900} /></Rise>}
        {show.timer.showOn.brb && (
          <Rise i={4} className="mt-10"><Countdown show={show} now={now} size={72} align="center" label="BACK IN" /></Rise>
        )}
      </div>
    </ScreenChrome>
  );
}

export function EndingScreen({ show, now }: { show: Show; now: number }) {
  const s = show.screens.ending;
  return (
    <ScreenChrome show={show} footer={false}>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: 250 }}>
        <Rise i={1}><Title text={s.title} size={132} align="center" max={1700} /></Rise>
        <Rise i={2} className="mt-6"><Subtitle text={s.subtitle} align="center" /></Rise>
        {show.showMatchupOnScreens && <Rise i={3} className="mt-14"><Matchup show={show} mode="final" width={900} /></Rise>}
        {show.timer.showOn.ending && <Rise i={4} className="mt-10"><Countdown show={show} now={now} size={64} align="center" /></Rise>}
      </div>
      <Rise i={5} className="absolute inset-x-0 flex flex-col items-center" style={{ bottom: show.ticker.enabled && show.ticker.onScreens ? 120 : 84, gap: 26 }}>
        <div className="font-sans font-bold text-white/50" style={{ fontSize: 13, letterSpacing: '0.34em' }}>FOLLOW US</div>
        <Socials show={show} size={26} gap={56} />
        <Sponsors show={show} height={48} />
      </Rise>
    </ScreenChrome>
  );
}

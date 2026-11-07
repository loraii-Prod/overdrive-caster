import { motion } from 'motion/react';
import type { Show } from '../../../shared/types';
import type { MatchData } from '../../../shared/protocol';
import { EASE } from '../../lib/motion';

export interface NextMatchInfo { label: string; time: string; target: number; players: string[]; live: boolean }

/** "HH:MM" today (this PC's clock) → epoch ms. */
export function todayAt(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  return d.getTime();
}

const GRACE = 10 * 60_000; // keep showing "starting now" for 10 min after the scheduled time

/**
 * The next match: manual override if set, else the first playoff match that isn't
 * done (by its time), else the first schedule entry later today.
 */
export function resolveNextMatch(show: Show, bnl: MatchData | null, now: number): NextMatchInfo | null {
  const nm = show.nextMatch;
  if (nm.label.trim() || nm.time) {
    const target = todayAt(nm.time, now) ?? now;
    return { label: nm.label.trim() || 'NEXT MATCH', time: nm.time, target, players: [], live: false };
  }
  const sm = bnl?.sheet?.matches ?? [];
  if (sm.length) {
    const live = bnl?.sheet?.featured;
    const c = sm.filter(m => m.at && m.status !== 'COMPLETED' && m.status.toLowerCase() !== 'not played' && m.id !== live && m.at + GRACE > now).sort((a, b) => a.at! - b.at! || a.id.localeCompare(b.id))[0];
    if (c) {
      const sameDay = new Date(c.at!).toDateString() === new Date(now).toDateString();
      return { label: `${c.t1.name} vs ${c.t2.name}`, time: sameDay ? c.time.split(' ')[1] : c.time, target: c.at!, players: [], live: false };
    }
  }
  const s = show.schedule.map(x => ({ x, t: todayAt(x.time, now) })).filter(c => c.t !== null && c.t + GRACE > now).sort((a, b) => a.t! - b.t!)[0];
  if (s) return { label: s.x.label, time: s.x.time, target: s.t!, players: [], live: false };
  return null;
}

export function fmtLeft(ms: number) {
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

const TAG = 'bg-[#E8E8E8] text-[#111]';
export const NM_W = 300, NM_H = 78;

/** Small always-on corner counter: "NEXT MATCH · 15:00 / Lower Final / 12:34". */
export function NextMatchCorner({ show, bnl, now, screen }: { show: Show; bnl: MatchData | null; now: number; screen?: string }) {
  if (!show.nextMatch.enabled) return null;
  const info = resolveNextMatch(show, bnl, now);
  if (!info) return null;
  const left = fmtLeft(info.target - now);
  const c = show.nextMatch.corner;
  const chrome = screen === 'starting' || screen === 'brb' || screen === 'ending';
  const ticker = show.ticker.enabled && show.ticker.items.length > 0 && (screen === 'gameplay' ? show.gameplay.ticker : show.ticker.onScreens);
  const inBar = !!show.brand.skin && screen !== 'gameplay';
  if (show.brand.skin) return <SkinNextBox info={info} left={left} pos={inBar ? { right: 20, bottom: 12 } : c[0] === 't' ? { [c[1] === 'l' ? 'left' : 'right']: 24, top: 24 } : { [c[1] === 'l' ? 'left' : 'right']: 24, bottom: 24 }} />;
  const pos: React.CSSProperties = inBar ? { right: 24, bottom: 19 } : {
    [c[1] === 'l' ? 'left' : 'right']: 24,
    [c[0] === 't' ? 'top' : 'bottom']: c[0] === 't' ? (show.brand.skin ? (screen === 'gameplay' ? 24 : 96) : chrome ? 130 : 24) : (show.brand.skin && screen !== 'gameplay' ? 140 : (ticker ? 56 : 0) + 24),
  };
  return (
    <motion.div className="pointer-events-none absolute flex" style={{ ...pos, width: NM_W, height: NM_H, filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.45))' }}
      initial={{ opacity: 0, y: c[0] === 't' ? -12 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      <div className="flex min-w-0 flex-1 flex-col justify-center bg-[#050505] px-3.5">
        <div className="flex items-center gap-2">
          <span className={`${TAG} px-1.5 pt-[2px] font-display text-[16px] leading-[20px]`}>NEXT MATCH</span>
          {info.time && <span className="font-display text-[17px] text-white/55">{info.time}</span>}
        </div>
        <div className="mt-1 truncate font-display text-[25px] leading-none text-white">{info.label}</div>
      </div>
      <div className="flex w-[104px] flex-none flex-col items-center justify-center bg-[#151515]">
        <span className="font-display text-[15px] leading-none text-white/45">{left ? 'IN' : ''}</span>
        <span className="font-display tabular-nums leading-none text-white" style={{ fontSize: left && left.length > 5 ? 26 : 34, paddingTop: 2 }}>{left ?? 'NOW'}</span>
      </div>
    </motion.div>
  );
}

/** Skin version: a framed box (accent border, cut corner) with the countdown in its own inner box. */
function SkinNextBox({ info, left, pos }: { info: NextMatchInfo; left: string | null; pos: React.CSSProperties }) {
  const clip = 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)';
  return (
    <motion.div className="pointer-events-none absolute" style={{ ...pos, width: 380, height: 92, filter: 'drop-shadow(0 8px 22px rgba(0,0,0,0.55))' }}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      <div className="absolute inset-0 bg-[var(--accent)]" style={{ clipPath: clip }} />
      <div className="absolute inset-[2px] flex overflow-hidden" style={{ clipPath: clip, background: 'linear-gradient(135deg, #1d0d0b 0%, #0b0606 100%)' }}>
        <div className="flex min-w-0 flex-1 flex-col justify-center pl-4 pr-2">
          <div className="flex items-center gap-2">
            <span className="bg-[var(--accent)] px-2 pt-[1px] font-['Montserrat'] text-[13px] font-extrabold italic uppercase leading-[19px] text-white">Next match</span>
            {info.time && <span className="font-['Montserrat'] text-[14px] font-bold uppercase text-white/60">{info.time}</span>}
          </div>
          <div className="mt-1.5 truncate font-['Montserrat'] text-[19px] font-extrabold italic uppercase leading-tight text-white">{info.label}</div>
        </div>
        <div className="m-2 flex w-[118px] flex-none flex-col items-center justify-center border border-white/15 bg-black/45">
          <span className="font-['Montserrat'] text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">{left ? 'starts in' : 'status'}</span>
          <span className="font-['Russo_One'] leading-none tabular-nums text-white" style={{ fontSize: left && left.length > 5 ? 22 : 30 }}>{left ?? 'LIVE SOON'}</span>
        </div>
      </div>
    </motion.div>
  );
}

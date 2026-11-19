import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { Show } from '../../../shared/types';
import { BYE, champion, isTeam, resolve, results, upcoming, type BMatch, type Resolved, type Slot, type SlotRef, type Tournament } from '../../../shared/tournament';
import { EASE } from '../../lib/motion';
import { Logo, Mark } from '../Brand';
import { Rise, ScreenBackground, TeamLogo } from './parts';
import { useTheme } from '../../lib/theme';

interface Box { m: BMatch; r: Resolved; x: number; y: number; w: number; h: number }

const AREA = { x: 80, y: 196, w: 1760, h: 800 };

// Program-aligned data-graphics identity (matches the on-air score bug in Skin.tsx):
// Russo One for numerals/titles, italic Montserrat for labels, var(--accent) for the event's theme color,
// angular two-corner cuts in place of rounded corners, near-black panels.
const DISP = "font-['Russo_One']";
const LABEL = "font-['Montserrat'] font-extrabold italic uppercase";
const CUT = { clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%)' } as const;
const CUT_SM = { clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%)' } as const;

/** Column of each match: UB/LB/GF aligned so finals line up. */
function column(m: BMatch, t: Tournament) {
  const R = Math.log2(t.size);
  if (t.format === 'single') return m.round - 1;
  if (m.side === 'LB') return m.round - 1;
  if (m.side === 'GF') return 2 * (R - 1) + (m.round - 1);
  return m.round === 1 ? 0 : 2 * m.round - 3;
}

function layout(t: Tournament, res: Map<string, Resolved>, view: 'full' | 'upper' | 'lower', withFinal = false) {
  const R = Math.log2(t.size);
  const visible = t.matches.filter(m => {
    const r = res.get(m.id)!;
    if (m.id === 'GF-2' && r.skipped) return false;
    if (view === 'upper') return m.side === 'UB' || (withFinal && m.side === 'GF');
    if (view === 'lower') return m.side === 'LB';
    return true;
  });
  const cols = Math.max(...visible.map(m => column(m, t))) + 1;
  const minCol = Math.min(...visible.map(m => column(m, t)));
  const ncols = cols - minCol;
  const colW = AREA.w / ncols;
  const w = Math.min(300, colW - 40);
  const double = t.format === 'double' && view === 'full';
  // Upper gets more room: its first round has twice the matches of the lower one.
  const upperH = double ? AREA.h * (t.size >= 16 ? 0.6 : 0.56) : AREA.h;
  const divider = AREA.y + upperH;
  const sections = {
    UB: { y: AREA.y + 34, h: upperH - 34 - 20 },
    LB: { y: double ? divider + 76 : AREA.y + 34, h: double ? AREA.y + AREA.h - (divider + 76) : AREA.h - 34 },
  };
  const count = (side: string, round: number) => visible.filter(m => m.side === side && m.round === round).length;
  const spacing = Math.min(...visible.filter(m => m.side !== 'GF').map(m => sections[m.side as 'UB' | 'LB'].h / count(m.side, m.round)));
  const h = Math.max(34, Math.min(76, spacing - 24));

  const boxes = new Map<string, Box>();
  for (const m of visible) {
    const x = AREA.x + (column(m, t) - minCol) * colW;
    let cy: number;
    if (m.side === 'GF') {
      const ub = boxes.get(`UB-${R}-0`), lb = boxes.get(`LB-${2 * (R - 1)}-0`);
      cy = ub && lb ? (ub.y + ub.h / 2 + lb.y + lb.h / 2) / 2 : ub ? ub.y + ub.h / 2 : AREA.y + AREA.h / 2;
    } else {
      const sec = sections[m.side];
      const n = count(m.side, m.round);
      cy = sec.y + ((m.index + 0.5) * sec.h) / n;
    }
    boxes.set(m.id, { m, r: res.get(m.id)!, x, y: cy - h / 2, w, h });
  }
  return { boxes: [...boxes.values()], byId: boxes, colW, minCol, sections, double, h, divider };
}

function slotText(slot: Slot, ref: SlotRef, t: Tournament) {
  if (isTeam(slot)) return slot.name;
  if (slot === BYE) return 'BYE';
  if (ref.k === 'seed') return `Seed ${ref.seed}`;
  const src = t.matches.find(x => x.id === ref.m);
  return `${ref.k === 'win' ? 'Winner' : 'Loser'} of ${src?.label ?? ref.m}`;
}

function Row({ slot, refSlot, t, score, state, h, showScore }: { slot: Slot; refSlot: SlotRef; t: Tournament; score: number; state: 'win' | 'lose' | 'none'; h: number; showScore: boolean }) {
  const team = isTeam(slot);
  return (
    <div className="flex items-center" style={{ height: h, gap: 10, padding: '0 0 0 10px', opacity: state === 'lose' ? 0.45 : 1 }}>
      {team ? <TeamLogo team={slot} size={h * 0.62} /> : <div style={{ width: h * 0.62 }} />}
      <div className={`min-w-0 flex-1 truncate ${team ? `${LABEL} text-white` : 'font-sans italic text-white/35'}`}
        style={{ fontSize: team ? Math.min(17, h * 0.46) : Math.min(13, h * 0.36), letterSpacing: team ? '0.01em' : 0 }}>
        {slotText(slot, refSlot, t)}
      </div>
      <div className={`grid h-full flex-none place-items-center ${DISP} ${state === 'win' ? 'bg-[var(--accent)] text-white' : 'bg-white/[0.06] text-white/80'}`}
        style={{ width: h * 1.05, fontSize: h * 0.5, ...CUT_SM }}>
        {showScore ? score : ''}
      </div>
    </div>
  );
}

function MatchBox({ b, t, i }: { b: Box; t: Tournament; i: number }) {
  const { m, r } = b;
  const done = !!r.winner && (m.status === 'done' || r.auto);
  const showScore = m.status !== 'upcoming' && !r.auto;
  const rowH = b.h / 2;
  const featured = t.featured === m.id;
  return (
    <motion.div className="absolute" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.1 + i * 0.015, ease: EASE }}>
      <div className={`h-full overflow-hidden border-l-4 ${featured ? 'border-white' : m.status === 'live' ? 'border-[var(--accent)]' : 'border-white/12'}`}
        style={{ background: 'rgba(8,8,8,.92)', boxShadow: '0 10px 26px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04)', ...CUT_SM }}>
        <Row slot={r.a} refSlot={m.a} t={t} score={m.scoreA} state={done ? (r.winner === 'A' ? 'win' : 'lose') : 'none'} h={rowH} showScore={showScore} />
        <div className="h-px bg-white/[0.07]" />
        <Row slot={r.b} refSlot={m.b} t={t} score={m.scoreB} state={done ? (r.winner === 'B' ? 'win' : 'lose') : 'none'} h={rowH - 1} showScore={showScore} />
      </div>
      <div className={`absolute flex w-full items-center justify-between ${LABEL}`} style={{ top: -18, fontSize: 10.5, letterSpacing: '0.1em' }}>
        {m.status === 'live'
          ? <span className="bg-[var(--accent)] px-1.5 text-white" style={CUT_SM}>LIVE</span>
          : <span className="text-white/40 not-italic font-semibold">{m.time}</span>}
        <span className="text-white/30 not-italic font-semibold">{m.bestOf > 1 ? `BO${m.bestOf}` : ''}</span>
      </div>
    </motion.div>
  );
}

/**
 * Full bracket graphic. `view` lets big brackets be shown per side. `res` = results already resolved by another
 * engine (the Major's rules); `withFinal` adds the grand final to the upper view; `title` replaces the line under it.
 */
export function BracketView({ t, view = 'full', transparent = false, res: given, withFinal = false, subtitle }: { t: Tournament; view?: 'full' | 'upper' | 'lower'; transparent?: boolean; res?: Map<string, Resolved>; withFinal?: boolean; subtitle?: string }) {
  const res = useMemo(() => given ?? resolve(t), [t, given]);
  const L = useMemo(() => layout(t, res, view, withFinal), [t, res, view, withFinal]);
  const champ = champion(t, res);

  // Winner-path connectors (same-side feeds + finals into the grand final).
  const lines: string[] = [];
  for (const b of L.boxes) {
    ([['a', 0.25], ['b', 0.75]] as const).forEach(([k, f]) => {
      const ref = b.m[k];
      if (ref.k !== 'win') return;
      const src = L.byId.get(ref.m);
      if (!src) return;
      const x1 = src.x + src.w, y1 = src.y + src.h / 2;
      const x2 = b.x, y2 = b.y + b.h * f;
      const mx = x2 - Math.min(24, (x2 - x1) / 2);
      lines.push(`M${x1} ${y1}H${mx}V${y2}H${x2}`);
    });
  }

  const colLabels = new Map<string, { x: number; y: number; label: string }>();
  for (const b of L.boxes) {
    if (b.m.side === 'GF') continue;
    const key = `${b.m.side}-${b.m.round}`;
    if (!colLabels.has(key)) colLabels.set(key, { x: b.x, y: L.sections[b.m.side].y - 30, label: b.m.label });
  }

  const gf = L.byId.get('GF-2') ?? L.byId.get('GF-1');
  const { theme } = useTheme();

  return (
    <div className="absolute inset-0 overflow-hidden">
      {!transparent && <ScreenBackground />}
      {!transparent && (
        <Rise className="absolute flex items-center justify-between" style={{ left: 80, right: 80, top: 52 }}>
          <div className="flex items-center gap-8" style={{ marginTop: theme === 'bnl' ? 22 : 0 }}>
            {theme !== 'bnl' && <Logo height={80} />}
            <div>
              <div className={`${DISP} text-white`} style={{ fontSize: 44, letterSpacing: '0.01em' }}>{view === 'lower' ? 'Lower Bracket' : view === 'upper' ? 'Upper Bracket' : 'Bracket'}</div>
              <div className={`mt-1 ${LABEL} text-white/45`} style={{ fontSize: 14, letterSpacing: '0.2em' }}>{subtitle ?? `${t.name} · ${t.format === 'double' ? 'Double elimination' : 'Single elimination'}`}</div>
            </div>
          </div>
        </Rise>
      )}
      {L.double && (
        <>
          <SectionTitle y={L.sections.UB.y - 62} text="UPPER BRACKET" />
          <div className="absolute bg-white/10" style={{ left: AREA.x, right: 80, top: L.divider, height: 1 }} />
          <SectionTitle y={L.divider + 14} text="LOWER BRACKET" />
        </>
      )}
      {[...colLabels.values()].map(c => (
        <div key={`${c.x}-${c.y}`} className={`absolute ${LABEL} not-italic text-white/50`} style={{ left: c.x, top: c.y, fontSize: 11, letterSpacing: '0.18em', width: L.colW - 20 }}>
          {c.label}
        </div>
      ))}
      <svg className="pointer-events-none absolute inset-0" width={1920} height={1080}>
        {lines.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} />)}
      </svg>
      {L.boxes.map((b, i) => <MatchBox key={b.m.id} b={b} t={t} i={i} />)}
      {gf && (view === 'full' || withFinal) && (
        <div className={`absolute ${LABEL} not-italic text-white/50`} style={{ left: L.byId.get('GF-1')!.x, top: L.byId.get('GF-1')!.y - 44, fontSize: 11, letterSpacing: '0.18em' }}>Grand Final</div>
      )}
      {champ && gf && (view === 'full' || withFinal) && (
        <motion.div className="absolute flex flex-col items-center border border-[var(--accent)]/40 text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}
          style={{ left: gf.x, top: gf.y + gf.h + 36, width: gf.w, padding: '20px 16px', background: 'rgba(8,8,8,.92)', boxShadow: '0 10px 26px rgba(0,0,0,.5)', ...CUT }}>
          <Mark height={34} />
          <div className={`mt-3 ${LABEL} not-italic text-white/50`} style={{ fontSize: 11, letterSpacing: '0.26em' }}>CHAMPION</div>
          <div className={`mt-2 ${DISP} text-white`} style={{ fontSize: 24 }}>{champ.name}</div>
        </motion.div>
      )}
    </div>
  );
}

function SectionTitle({ y, text }: { y: number; text: string }) {
  return (
    <div className="absolute flex items-center gap-3" style={{ left: AREA.x, top: y }}>
      <span className="h-[3px] w-6 bg-[var(--accent)]" />
      <span className={`${DISP} text-white`} style={{ fontSize: 15, letterSpacing: '0.18em' }}>{text}</span>
    </div>
  );
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1">
      <div className="mb-5 flex items-center gap-3"><span className="h-[3px] w-6 bg-[var(--accent)]" /><span className={`${DISP} text-white`} style={{ fontSize: 18, letterSpacing: '0.18em' }}>{title}</span></div>
      <div className="border-t border-white/10">{children}</div>
    </div>
  );
}

/** Upcoming + results board (full-screen or transparent panel). */
export function MatchesBoard({ t, show, transparent = false }: { t: Tournament; show: Show; transparent?: boolean }) {
  const res = useMemo(() => resolve(t), [t]);
  const next = upcoming(t, res, 6);
  const done = results(t, res, 6);
  const name = (s: Slot) => (isTeam(s) ? s.name : 'TBD');
  const { theme } = useTheme();
  const team = (s: Slot, right = false) => (
    <div className={`flex min-w-0 flex-1 items-center gap-4 ${right ? 'flex-row-reverse text-right' : ''}`}>
      {isTeam(s) && <TeamLogo team={s} size={40} />}
      <span className={`truncate ${isTeam(s) ? `${LABEL} text-white` : 'font-sans italic text-white/35'}`} style={{ fontSize: 22 }}>{name(s)}</span>
    </div>
  );
  return (
    <div className="absolute inset-0 overflow-hidden">
      {!transparent && <ScreenBackground />}
      {!transparent && (
        <Rise className="absolute flex items-start justify-between" style={{ left: 80, right: 80, top: 56 }}>
          {theme === 'bnl' ? <span /> : <Logo height={92} />}
          <div className="text-right">
            <div className={`${DISP} text-white`} style={{ fontSize: 24, letterSpacing: '0.1em' }}>{t.name}</div>
            <div className={`mt-2 ${LABEL} text-white/45`} style={{ fontSize: 14, letterSpacing: '0.2em' }}>{show.stage}</div>
          </div>
        </Rise>
      )}
      <div className="absolute flex" style={{ left: 80, right: 80, top: 250, gap: 80 }}>
        <Col title="UPCOMING">
          {next.length === 0 && <div className="py-6 font-sans text-white/40" style={{ fontSize: 20 }}>No matches scheduled</div>}
          {next.map(({ m, r }, i) => (
            <Rise key={m.id} i={1 + i} className="flex items-center border-b border-white/10" style={{ height: 96, gap: 22 }}>
              <div style={{ width: 120 }}>
                <div className={`${DISP} ${m.status === 'live' ? 'text-[var(--accent)]' : 'text-white'}`} style={{ fontSize: 22 }}>{m.status === 'live' ? 'LIVE' : m.time || '—'}</div>
                <div className={`mt-1 truncate ${LABEL} not-italic text-white/40`} style={{ fontSize: 11, letterSpacing: '0.14em' }}>{m.label}</div>
              </div>
              {team(r.a)}
              <span className={`${DISP} text-white/35`} style={{ fontSize: 18 }}>{m.status === 'live' ? `${m.scoreA} – ${m.scoreB}` : 'VS'}</span>
              {team(r.b, true)}
            </Rise>
          ))}
        </Col>
        <Col title="RESULTS">
          {done.length === 0 && <div className="py-6 font-sans text-white/40" style={{ fontSize: 20 }}>No results yet</div>}
          {done.map(({ m, r }, i) => (
            <Rise key={m.id} i={1 + i} className="flex items-center border-b border-white/10" style={{ height: 96, gap: 22 }}>
              <div className={`truncate ${LABEL} not-italic text-white/40`} style={{ width: 120, fontSize: 11, letterSpacing: '0.14em' }}>{m.label}</div>
              <div className="flex min-w-0 flex-1 items-center gap-4" style={{ opacity: r.winner === 'A' ? 1 : 0.5 }}>{team(r.a)}</div>
              <div className={`flex items-center gap-3 ${DISP}`} style={{ fontSize: 30 }}>
                <span className={r.winner === 'A' ? 'text-[var(--accent)]' : 'text-white/45'}>{m.scoreA}</span>
                <span className="text-white/25">–</span>
                <span className={r.winner === 'B' ? 'text-[var(--accent)]' : 'text-white/45'}>{m.scoreB}</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-4" style={{ opacity: r.winner === 'B' ? 1 : 0.5 }}>{team(r.b, true)}</div>
            </Rise>
          ))}
        </Col>
      </div>
    </div>
  );
}

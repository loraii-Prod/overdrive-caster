import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { SheetMatch, SheetState, SheetTeam } from '../../../shared/sheet';
import type { Show } from '../../../shared/types';
import { EASE } from '../../lib/motion';
import { TeamLogo } from './parts';

const NAME = "font-['Montserrat'] font-extrabold italic uppercase";
const done = (m: SheetMatch) => m.status === 'COMPLETED';

function Row({ name, score, win, lose, team, h }: { name: string; score: string; win: boolean; lose: boolean; team?: SheetTeam; h: number }) {
  const tbd = !team && name !== 'BYE';
  return (
    <div className="flex items-center gap-2 px-2" style={{ height: h, opacity: lose ? 0.45 : 1 }}>
      {team ? <TeamLogo team={{ name: team.name, tag: team.name.slice(0, 3).toUpperCase(), logo: team.logo }} size={h - 8} /> : <div style={{ width: h - 8 }} />}
      <span className={`min-w-0 flex-1 truncate ${tbd ? "font-['Montserrat'] text-white/40" : `${NAME} text-white`}`} style={{ fontSize: tbd ? h * 0.5 : h * 0.56 }}>{name}</span>
      <span className={`w-7 text-center font-['Russo_One'] ${win ? 'text-[var(--accent)]' : 'text-white/80'}`} style={{ fontSize: h * 0.62 }}>{score}</span>
    </div>
  );
}

function Box({ m, teams, x, y, w, h, live, i, compact = false }: { m: SheetMatch; teams: Map<string, SheetTeam>; x: number; y: number; w: number; h: number; live: boolean; i: number; compact?: boolean }) {
  const w1 = done(m) && m.winner === m.t1.id, w2 = done(m) && m.winner === m.t2.id;
  return (
    <motion.div className="absolute" style={{ left: x, top: y, width: w }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.05 + i * 0.015, ease: EASE }}>
      {!compact && <div className="flex h-[18px] items-center justify-between font-['Montserrat'] text-[12px] font-bold uppercase tracking-[0.08em] text-white/50">
        <span>{m.bracket.replace('_', ' ')}{m.bo ? ` · BO${m.bo}` : ''}</span>
        <span className={live ? 'text-[var(--accent)]' : ''}>{live ? '● LIVE' : done(m) ? 'FINAL' : m.time}</span>
      </div>}
      <div className={`bg-[#0d0707]/92 ${live ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-white/10'}`} style={{ clipPath: 'polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%)' }}>
        <Row name={m.t1.name} score={m.s1} win={w1} lose={w2} team={teams.get(m.t1.id)} h={h} />
        <div className="h-px bg-white/10" />
        <Row name={m.t2.name} score={m.s2} win={w2} lose={w1} team={teams.get(m.t2.id)} h={h} />
      </div>
    </motion.div>
  );
}

/** A full-height column layout for one bracket side (used by both pages below). */
function sideLayout(cols: SheetMatch[][], teams: Map<string, SheetTeam>, top: number, height: number, x0: number, width: number, featured: string | null, n0: number) {
  const maxRows = Math.max(1, ...cols.map(c => c.length));
  const rowH = Math.min(30, Math.floor((height / maxRows - 22) / 2));
  const cw = width / Math.max(1, cols.length);
  const bw = Math.min(320, cw - 24);
  return cols.flatMap((c, ci) => c.map((m, k) => {
    const slot = height / c.length;
    const compact = slot < 74;
    const rh = compact ? Math.min(26, Math.floor((slot - 8) / 2)) : rowH;
    const boxH = (compact ? 0 : 18) + rh * 2 + 1;
    return <Box key={m.id} m={m} teams={teams} x={x0 + ci * cw} y={top + k * slot + (slot - boxH) / 2} w={bw} h={rh} live={featured === m.id} i={n0 + ci * 8 + k} compact={compact} />;
  }));
}

const PAGE_TITLE = "font-['Russo_One'] text-[52px] leading-none text-white";
const SECTION_TAG = "font-['Montserrat'] font-extrabold italic uppercase absolute left-[60px] top-[142px] text-[16px] text-[var(--accent)]";

/** Page 1: upper bracket, full height. */
function UpperPage({ upper, teams, sheet, show }: { upper: SheetMatch[][]; teams: Map<string, SheetTeam>; sheet: SheetState; show: Show }) {
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[60px] top-[52px]">
        <div className="font-['Montserrat'] text-[20px] font-extrabold italic uppercase text-white/60">{show.tournament}</div>
        <div className={PAGE_TITLE}>{sheet.title || 'BRACKET'}</div>
      </div>
      <div className={SECTION_TAG}>UPPER BRACKET</div>
      {sideLayout(upper, teams, 170, 860, 60, 1920 - 120, sheet.featured, 0)}
    </div>
  );
}

/** Page 2: lower bracket, plus the qualified / grand-final column when there is one. */
function LowerPage({ upper, lower, finals, qualSlots, qualified, teams, sheet, show }: {
  upper: SheetMatch[][]; lower: SheetMatch[][]; finals: SheetMatch[]; qualSlots: SheetMatch[]; qualified: (SheetTeam | null)[]; teams: Map<string, SheetTeam>; sheet: SheetState; show: Show;
}) {
  const sideCol = finals.length || qualSlots.length ? 320 : 0;
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[60px] top-[52px]">
        <div className="font-['Montserrat'] text-[20px] font-extrabold italic uppercase text-white/60">{show.tournament}</div>
        <div className={PAGE_TITLE}>{sheet.title || 'BRACKET'}</div>
      </div>
      <div className={SECTION_TAG}>LOWER BRACKET</div>
      {sideLayout(lower, teams, 170, 860, 60, 1920 - 120 - sideCol, sheet.featured, 40)}
      {qualSlots.length > 0 && (
        <div className="absolute" style={{ left: 1920 - 60 - 300, top: 160, width: 300 }}>
          <div className={`${NAME} text-[16px] text-[var(--accent)]`}>QUALIFIED</div>
          <div className={`${NAME} mb-3 text-[24px] leading-tight text-white`}>{sheet.title ? 'TO THE MAJOR' : 'NEXT STAGE'}</div>
          {qualified.map((t, i) => (
            <motion.div key={i} className="mb-2 flex h-[64px] items-center gap-3 bg-[#0d0707]/92 px-3 ring-1 ring-white/10" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08 }}>
              <span className="w-6 font-['Russo_One'] text-[22px] text-[var(--accent)]">{i + 1}</span>
              {t ? <><TeamLogo team={{ name: t.name, tag: '', logo: t.logo }} size={44} /><span className={`${NAME} truncate text-[22px] text-white`}>{t.name}</span></>
                : <span className="font-['Montserrat'] text-[16px] font-bold text-white/35">{i < (upper.at(-1)?.length ?? 0) ? 'Upper' : 'Lower'} qualifier · TBD</span>}
            </motion.div>
          ))}
        </div>
      )}
      {finals.length > 0 && (
        <div className="absolute" style={{ left: 1920 - 60 - 300, top: 160, width: 300 }}>
          <div className={`${NAME} text-[16px] text-[var(--accent)]`}>GRAND FINAL</div>
          <div className="mt-3">
            {finals.map((m, i) => <Box key={m.id} m={m} teams={teams} x={0} y={i * 96} w={300} h={30} live={sheet.featured === m.id} i={80 + i} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small pill dots marking which of the 2 pages is on screen. */
function PageDots({ n, i }: { n: number; i: number }) {
  if (n < 2) return null;
  return (
    <div className="absolute flex gap-2" style={{ left: 60, bottom: 36 }}>
      {Array.from({ length: n }).map((_, k) => (
        <div key={k} className="h-[6px] rounded-full transition-all duration-300" style={{ width: k === i ? 28 : 12, background: k === i ? 'var(--accent)' : 'rgba(255,255,255,0.25)' }} />
      ))}
    </div>
  );
}

/** Bracket straight from the sheet's match list. Upper and lower+qualified are
 * each a full screen, auto-rotating every 10s (there's too much to legibly fit
 * side-by-side on one screen with 15+ teams). Stays on one page if there's
 * nothing yet to show on the other. */
export function SheetBracket({ sheet, show }: { sheet: SheetState; show: Show }) {
  const teams = new Map(sheet.teams.map(t => [t.id, t]));
  const played = sheet.matches.filter(m => m.status.toLowerCase() !== 'not played');
  const col = (side: SheetMatch['side']) => {
    const ms = played.filter(m => m.side === side);
    const rounds = [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
    return rounds.map(r => ms.filter(m => m.round === r).sort((a, b) => a.bracket.localeCompare(b.bracket, undefined, { numeric: true })));
  };
  const upper = col('winners'), lower = col('losers'), finals = col('grandfinal').flat();
  // Last round of each side feeds the next stage when no finals are played (e.g. wildcard → Major).
  const qualSlots = finals.length ? [] : [...(upper.at(-1) ?? []), ...(lower.at(-1) ?? [])];
  const qualified = qualSlots.map(m => (m.status === 'COMPLETED' ? teams.get(m.winner) ?? null : null));

  const hasLowerPage = lower.flat().length > 0 || qualSlots.length > 0 || finals.length > 0;
  const pages = hasLowerPage ? 2 : 1;
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages < 2) { setPage(0); return; }
    const t = setInterval(() => setPage(p => (p + 1) % pages), 10_000);
    return () => clearInterval(t);
  }, [pages]);

  return (
    <div className="absolute inset-0">
      <AnimatePresence mode="wait">
        <motion.div key={page} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          {page === 0
            ? <UpperPage upper={upper} teams={teams} sheet={sheet} show={show} />
            : <LowerPage upper={upper} lower={lower} finals={finals} qualSlots={qualSlots} qualified={qualified} teams={teams} sheet={sheet} show={show} />}
        </motion.div>
      </AnimatePresence>
      <PageDots n={pages} i={page} />
    </div>
  );
}

/** One results/upcoming column. Hoisted to module scope: defining this inside
 * SheetMatches would give React a new component identity every render (every
 * ~250ms, since the screen re-renders on each clock tick), forcing a full
 * remount of every row and replaying their entrance animation — i.e. a
 * constant flicker. */
function MatchList({ title, ms, x, teams, featured }: { title: string; ms: SheetMatch[]; x: number; teams: Map<string, SheetTeam>; featured?: string | null }) {
  return (
    <div className="absolute" style={{ left: x, top: 170, width: 860 }}>
      <div className={`${NAME} mb-3 text-[22px] text-[var(--accent)]`}>{title}</div>
      {ms.map((m, i) => {
        const w1 = done(m) && m.winner === m.t1.id, w2 = done(m) && m.winner === m.t2.id;
        const live = featured === m.id;
        return (
          <motion.div key={m.id} className={`mb-2 flex h-[80px] items-center gap-4 bg-[#0d0707]/92 px-4 ${live ? 'ring-2 ring-[var(--accent)]' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 * i, ease: EASE }}>
            <div className="w-[110px] flex-none font-['Montserrat'] text-[15px] font-bold uppercase leading-tight text-white/55">{live ? <span className="text-[var(--accent)]">● LIVE</span> : m.time || m.bracket}<br /><span className="text-white/35">{m.bracket.replace('_', ' ')}</span></div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3" style={{ opacity: w2 ? 0.5 : 1 }}>
              <span className={`${NAME} truncate text-[26px] text-white`}>{m.t1.name}</span>
              {teams.get(m.t1.id) && <TeamLogo team={{ name: m.t1.name, tag: '', logo: teams.get(m.t1.id)!.logo }} size={46} />}
            </div>
            <div className="w-[110px] flex-none text-center font-['Russo_One'] text-[34px] text-white">{done(m) ? `${m.s1} - ${m.s2}` : <span className="text-[var(--accent)]">VS</span>}</div>
            <div className="flex min-w-0 flex-1 items-center gap-3" style={{ opacity: w1 ? 0.5 : 1 }}>
              {teams.get(m.t2.id) && <TeamLogo team={{ name: m.t2.name, tag: '', logo: teams.get(m.t2.id)!.logo }} size={46} />}
              <span className={`${NAME} truncate text-[26px] text-white`}>{m.t2.name}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Results + upcoming list from the sheet. */
export function SheetMatches({ sheet, show }: { sheet: SheetState; show: Show }) {
  const teams = new Map(sheet.teams.map(t => [t.id, t]));
  const results = sheet.matches.filter(m => done(m) && m.t1.id !== 'BYE' && m.t2.id !== 'BYE').sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || b.id.localeCompare(a.id)).slice(0, 8);
  const upcoming = sheet.matches.filter(m => !done(m) && m.status.toLowerCase() !== 'not played').sort((a, b) => (a.at ?? 9e15) - (b.at ?? 9e15) || a.id.localeCompare(b.id)).slice(0, 8);
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[60px] top-[52px]">
        <div className={`${NAME} text-[20px] text-white/60`}>{show.tournament}</div>
        <div className="font-['Russo_One'] text-[52px] leading-none text-white">MATCHES</div>
      </div>
      <MatchList title="RESULTS" ms={results} x={60} teams={teams} featured={sheet.featured} />
      <MatchList title="UPCOMING" ms={upcoming} x={1000} teams={teams} featured={sheet.featured} />
    </div>
  );
}

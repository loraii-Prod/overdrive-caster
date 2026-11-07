import { AnimatePresence, motion } from 'motion/react';
import type { Show } from '../../../shared/types';
import { PLAYOFF_DEFS, playoffPlacements, playoffPlayers, standings, type League, type Playoffs, type PlayoffDef, type RcPlayer, type ReverseCup } from '../../../shared/bnl';
import type { PlayerCard } from '../../../shared/protocol';
import { EASE } from '../../lib/motion';
import { Mark } from '../Brand';
import { Rise, ScreenBackground } from './parts';

export interface BnlData { league: League; playoffs: Playoffs; names: Record<string, string>; info: Record<string, PlayerCard>; sheet?: import('../../../shared/sheet').SheetState }

const ord = (n: number) => `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;
const TAG = 'bg-[#E8E8E8] text-[#111]';

/** Alive first (by points), then eliminated by place. */
function sortRc(players: RcPlayer[]) {
  const key = (p: RcPlayer) => (p.place === null ? 0 : p.place);
  return players.filter(p => p.id).sort((a, b) => {
    if ((a.place === null) !== (b.place === null)) return a.place === null ? -1 : 1;
    return a.place === null ? b.points - a.points || b.prev - a.prev : key(a) - key(b);
  });
}

// ------------------------------------------------------------ Reverse Cup board

/** In-game scoreboard for a 4-player Reverse Cup match (top centre, transparent). */
export function RcBoard({ rc, activeId, now }: { rc: ReverseCup; activeId?: string | null; now: number }) {
  const players = sortRc(rc.players);
  const fresh = now - rc.roundAt < 3500;
  const map = rc.maps[rc.mapIndex] ?? '';
  return (
    <motion.div className="absolute left-1/2 top-6 flex items-stretch" style={{ x: '-50%', height: 78, filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.45))' }}
      initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      <div className="flex w-[252px] flex-col justify-center bg-[#050505] px-4">
        <div className="flex items-center gap-2">
          <span className={`${TAG} px-2 pt-[3px] font-display text-[19px] leading-[22px]`}>{rc.finished ? 'FINAL' : `MAP ${rc.mapIndex + 1}/${rc.maps.length}`}</span>
          {!rc.finished && <span className="font-display text-[19px] text-white/60">ROUND {rc.round}</span>}
        </div>
        <div className="mt-1 truncate font-display text-[24px] leading-none text-white">{map || rc.title}</div>
      </div>
      <div className="grid w-[60px] place-items-center bg-[#151515]"><Mark height={52} /></div>
      <div className="flex">
        {players.map(p => {
          const out = p.place !== null && !(rc.finished && p.place <= rc.winners);
          const win = rc.finished && p.place !== null && p.place <= rc.winners;
          const active = activeId === p.id;
          const pct = Math.max(0, Math.min(1, p.points / rc.start));
          return (
            <motion.div layout key={p.id} transition={{ layout: { duration: 0.45, ease: EASE } }}
              className={`relative flex w-[236px] items-center border-l border-white/10 px-4 ${win ? 'bg-[#E8E8E8]' : 'bg-[#050505]'}`} style={{ opacity: out ? 0.5 : 1 }}>
              {active && !out && <div className="absolute inset-x-0 top-0 h-[4px] bg-[var(--accent)]" />}
              <div className="min-w-0 flex-1">
                <div className={`truncate font-display text-[30px] leading-none ${win ? 'text-[#111]' : 'text-white'}`} style={{ paddingTop: 3 }}>{p.name}</div>
                {!out && !win && (
                  <div className="mt-2 h-[4px] w-full bg-white/10"><motion.div className="h-full origin-left bg-white" animate={{ scaleX: pct }} transition={{ duration: 0.6, ease: EASE }} /></div>
                )}
                {(out || win) && <div className={`mt-1 font-display text-[18px] leading-none ${win ? 'text-[#111]/70' : 'text-white/60'}`}>{win ? (p.place === 1 ? 'WINNER' : `${ord(p.place!)} · QUALIFIED`) : `${ord(p.place!)} PLACE`}</div>}
              </div>
              <div className="relative ml-3 text-right">
                <span className={`font-display text-[46px] leading-none ${win ? 'text-[#111]' : 'text-white'}`} style={{ paddingTop: 4 }}>{out ? ord(p.place!) : p.points}</span>
                <AnimatePresence>
                  {fresh && p.delta !== null && p.delta > 0 && !out && (
                    <motion.span key={rc.roundAt} className="absolute right-full top-[14px] mr-2 bg-[var(--accent)] px-1.5 font-display text-[17px] leading-[20px] text-white"
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>−{p.delta}</motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/** Compact match bar above the caster cams. */
export function RcBar({ rc }: { rc: ReverseCup }) {
  const players = sortRc(rc.players);
  if (players.length === 0) return null;
  return (
    <motion.div className="absolute left-1/2 flex items-stretch" style={{ top: 50, x: '-50%', height: 58 }}
      initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      <div className="grid w-[58px] place-items-center bg-[#151515]"><Mark height={46} /></div>
      <div className="flex items-center bg-[#050505] px-4 font-display text-[24px] text-white/70">{rc.title}</div>
      {players.map(p => (
        <div key={p.id} className="flex items-center gap-3 border-l border-white/10 bg-[#050505] px-4" style={{ opacity: p.place && !(rc.finished && p.place <= rc.winners) ? 0.45 : 1 }}>
          <span className="max-w-[170px] truncate font-display text-[26px] text-white">{p.name}</span>
          <span className={`${TAG} min-w-[44px] px-2 pt-[2px] text-center font-display text-[24px]`}>{p.place && (rc.finished || p.place > rc.winners) ? ord(p.place) : p.points}</span>
        </div>
      ))}
    </motion.div>
  );
}

/** Match card for full screens: up next / current / final result. */
export function RcCard({ rc, mode, width = 560 }: { rc: ReverseCup; mode: 'next' | 'live' | 'final'; width?: number }) {
  const players = mode === 'next' ? rc.players.filter(p => p.id) : sortRc(rc.players);
  const label = mode === 'next' ? 'UP NEXT' : mode === 'final' || rc.finished ? 'MATCH RESULT' : `MAP ${rc.mapIndex + 1}/${rc.maps.length} · ROUND ${rc.round}`;
  return (
    <div style={{ width }}>
      <div className="flex items-end">
        <span className={`${TAG} px-3 pt-[4px] font-display text-[24px] leading-[34px]`}>{label}</span>
        <span className="ml-3 truncate pb-1 font-display text-[26px] text-white/80">{rc.title}</span>
      </div>
      <div className="bg-[#050505]/95">
        {players.length === 0 && <div className="px-5 py-6 font-display text-[26px] text-white/40">Players to be announced</div>}
        {players.map((p, i) => (
          <div key={p.id} className="flex h-[58px] items-center border-b border-white/[0.07] last:border-b-0">
            <div className="grid h-full w-[58px] flex-none place-items-center bg-[#151515] font-display text-[26px] text-white/70">
              {mode === 'next' ? <Mark height={40} /> : p.place ? ord(p.place) : i + 1}
            </div>
            <span className="min-w-0 flex-1 truncate px-4 font-display text-[32px] text-white" style={{ paddingTop: 3 }}>{p.name}</span>
            {mode !== 'next' && <span className="px-5 font-display text-[34px] text-white">{p.place && p.points <= 0 ? '' : p.points}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Standings

function StandingsTable({ data, divIndex, x, width }: { data: BnlData; divIndex: number; x: number; width: number }) {
  const div = data.league.divisions[divIndex];
  if (!div) return null;
  const rows = standings(div, Object.entries(data.names).map(([id, name]) => ({ id, name } as any)));
  const n = data.league.matches;
  const qualifyLabel = div.id === 'd1' ? 'PLAYOFFS' : 'PROMOTION MATCH';
  return (
    <Rise i={1} className="absolute" style={{ left: x, top: 214, width }}>
      <div className="flex items-end">
        <span className={`${TAG} px-3 pt-[4px] font-display text-[28px] leading-[38px]`}>{div.name.toUpperCase()}</span>
        <span className="ml-3 pb-1 font-display text-[22px] text-white/50">TOP {div.qualify} → {qualifyLabel}</span>
      </div>
      <div className="bg-[#050505]/92">
        <div className="flex h-[34px] items-center border-b border-white/10 font-display text-[18px] text-white/45">
          <span className="w-[56px] text-center">#</span>
          <span className="flex-1 pl-3">PLAYER</span>
          {Array.from({ length: n }, (_, i) => <span key={i} className="w-[44px] text-center">M{i + 1}</span>)}
          <span className="w-[72px] text-center text-white/70">PTS</span>
        </div>
        {rows.map(r => {
          const q = r.pos <= div.qualify;
          return (
            <div key={r.player} className={`relative flex h-[38px] items-center ${r.pos === div.qualify ? 'border-b-2 border-white/50' : 'border-b border-white/[0.06]'}`}>
              {q && <div className="absolute inset-y-0 left-0 w-[4px] bg-white" />}
              <span className={`w-[56px] text-center font-display text-[24px] ${q ? 'text-white' : 'text-white/45'}`}>{r.pos}</span>
              <span className={`min-w-0 flex-1 truncate pl-3 font-display text-[26px] ${q ? 'text-white' : 'text-white/60'}`} style={{ paddingTop: 2 }}>{r.name}</span>
              {r.results.map((v, i) => (
                <span key={i} className="w-[44px] text-center font-display text-[22px]" style={{ color: v == null ? 'rgba(255,255,255,0.2)' : `rgba(255,255,255,${0.35 + (v / 4) * 0.65})` }}>{v ?? '–'}</span>
              ))}
              <span className={`w-[72px] text-center font-display text-[28px] ${q ? 'text-white' : 'text-white/60'}`}>{r.total}</span>
            </div>
          );
        })}
      </div>
    </Rise>
  );
}

export function StandingsScreen({ data, show }: { data: BnlData | null; show: Show }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScreenBackground />
      <Rise className="absolute" style={{ left: 80, top: 92 }}>
        <div className="font-display text-[78px] leading-none text-white">LEAGUE PHASE STANDINGS</div>
        <div className="mt-1 font-display text-[26px] text-white/50">{show.tournament} · {data?.league.name ?? show.stage} · 4 / 3 / 2 / 1 POINTS PER MATCH</div>
      </Rise>
      {data && (
        <>
          <StandingsTable data={data} divIndex={0} x={80} width={860} />
          <StandingsTable data={data} divIndex={1} x={980} width={860} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Playoffs

const BOX_W = 340;
const POS: Record<string, { x: number; y: number }> = {
  'USF-A': { x: 80, y: 236 }, 'USF-B': { x: 80, y: 486 }, LSF: { x: 80, y: 760 },
  UF: { x: 520, y: 361 }, LF: { x: 520, y: 760 }, GF: { x: 960, y: 560 }, PROMO: { x: 1460, y: 236 },
};

function refLabel(def: PlayoffDef, i: number) {
  const r = def.refs[i];
  if (r.k === 'seed') return `Seed ${r.n}`;
  const src = PLAYOFF_DEFS.find(d => d.id === r.m);
  return `${src?.short ?? r.m} · ${ord(r.p)}`;
}

function PlayoffBox({ def, data, i, live }: { def: PlayoffDef; data: BnlData; i: number; live: boolean }) {
  const ids = playoffPlayers(data.playoffs, def);
  const res = data.playoffs.results[def.id];
  const done = res?.status === 'done';
  const advance = def.side === 'final' ? 1 : def.side === 'promo' ? 2 : 2;
  const rows = done ? res.order.map(id => ({ id, place: res.order.indexOf(id) + 1, pts: res.points[id] })) : ids.map((id, k) => ({ id, place: 0, pts: undefined as number | undefined, k }));
  const p = POS[def.id];
  return (
    <motion.div className="absolute" style={{ left: p.x, top: p.y, width: BOX_W }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 + i * 0.06, ease: EASE }}>
      <div className="flex items-end justify-between">
        <span className={`${TAG} px-2.5 pt-[3px] font-display text-[22px] leading-[30px]`}>{def.label.toUpperCase()}</span>
        <span className={`pb-0.5 font-display text-[20px] ${live || res?.status === 'live' ? 'text-[#ff5d5d]' : 'text-white/45'}`}>{live || res?.status === 'live' ? '● LIVE' : res?.time ?? ''}</span>
      </div>
      <div className={`bg-[#050505]/95 ${live || res?.status === 'live' ? 'ring-2 ring-[var(--accent)]' : ''}`}>
        {rows.map((r, k) => {
          const name = r.id ? data.names[r.id] ?? r.id : null;
          const adv = done && r.place <= advance;
          return (
            <div key={k} className="flex h-[40px] items-center border-b border-white/[0.06] last:border-b-0" style={{ opacity: done && !adv ? 0.5 : 1 }}>
              <span className={`grid h-full w-[46px] flex-none place-items-center font-display text-[20px] ${adv ? 'bg-[#E8E8E8] text-[#111]' : 'bg-[#151515] text-white/60'}`}>{done ? ord(r.place) : ''}</span>
              <span className={`min-w-0 flex-1 truncate px-3 font-display text-[25px] ${name ? 'text-white' : 'text-white/30'}`} style={{ paddingTop: 2 }}>{name ?? refLabel(def, k)}</span>
              {done && r.pts !== undefined && r.pts > 0 && <span className="px-3 font-display text-[24px] text-white/80">{r.pts}</span>}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export function PlayoffsScreen({ data, show }: { data: BnlData | null; show: Show }) {
  const liveId = show.rc.enabled && show.rc.source?.kind === 'playoff' && !show.rc.finished ? show.rc.source.id : null;
  const place = data ? playoffPlacements(data.playoffs) : [];
  const champ = place[0] && data ? data.names[place[0]] : null;
  // connector paths (box right-middle → next box left)
  const mid = (id: string, row = 2) => ({ x: POS[id].x, y: POS[id].y + 30 + row * 40 });
  const right = (id: string) => ({ x: POS[id].x + BOX_W, y: POS[id].y + 30 + 80 });
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y}H${(a.x + b.x) / 2}V${b.y}H${b.x}`;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScreenBackground />
      <Rise className="absolute" style={{ left: 80, top: 92 }}>
        <div className="font-display text-[78px] leading-none text-white">PLAYOFFS</div>
        <div className="mt-1 font-display text-[26px] text-white/50">DIVISION 1 · DOUBLE ELIMINATION · TOP 2 ADVANCE</div>
      </Rise>
      <svg className="pointer-events-none absolute inset-0" width={1920} height={1080}>
        {[[right('USF-A'), mid('UF', 1)], [right('USF-B'), mid('UF', 3)], [right('LSF'), mid('LF', 3)], [right('UF'), mid('GF', 1)], [right('LF'), mid('GF', 3)]].map(([a, b], i) => (
          <path key={i} d={line(a, b)} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={2} />
        ))}
        <path d={`M${POS.UF.x + BOX_W / 2} ${POS.UF.y + 190}V${POS.LF.y - 6}`} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeDasharray="6 6" />
      </svg>
      {data && PLAYOFF_DEFS.map((d, i) => <PlayoffBox key={d.id} def={d} data={data} i={i} live={liveId === d.id} />)}
      {data && (
        <Rise i={6} className="absolute" style={{ left: POS.PROMO.x, top: 520, width: BOX_W + 40 }}>
          <span className={`${TAG} px-2.5 pt-[3px] font-display text-[22px] leading-[30px]`}>FINAL STANDINGS</span>
          <div className="bg-[#050505]/95">
            {place.map((id, i) => (
              <div key={i} className="flex h-[38px] items-center border-b border-white/[0.06] last:border-b-0">
                <span className={`grid h-full w-[46px] flex-none place-items-center font-display text-[20px] ${i === 0 ? 'bg-[#E8E8E8] text-[#111]' : 'bg-[#151515] text-white/60'}`}>{ord(i + 1)}</span>
                <span className={`flex-1 truncate px-3 font-display text-[24px] ${id ? 'text-white' : 'text-white/30'}`}>{id ? data.names[id] ?? id : 'TBD'}</span>
                <span className="px-3 font-display text-[20px] text-white/45">{show.prize.splits[Math.min(i, 4)]?.pct}%</span>
              </div>
            ))}
          </div>
        </Rise>
      )}
      {champ && (
        <motion.div className="absolute flex items-center gap-4" style={{ left: POS.GF.x, top: POS.GF.y + 218 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
          <Mark height={58} />
          <div>
            <div className="font-display text-[20px] text-white/50">BENELUX CHAMPION</div>
            <div className="font-display text-[44px] leading-none text-white">{champ}</div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Prizepool

export function PrizeCard({ show, width = 900 }: { show: Show; width?: number }) {
  const p = show.prize;
  if (!p.enabled) return null;
  const max = Math.max(1, ...p.goals.map(g => g.amount));
  const pct = Math.min(1, p.raised / max);
  return (
    <div style={{ width }}>
      <div className="flex items-end gap-3">
        <span className={`${TAG} px-3 pt-[4px] font-display text-[24px] leading-[34px]`}>PRIZEPOOL</span>
        {p.raised > 0 && <span className="pb-0.5 font-display text-[34px] leading-none text-white">{p.currency}{p.raised.toLocaleString('nl-NL')}</span>}
        <span className="ml-auto pb-1 font-display text-[22px] text-white/60">CONTRIBUTE · {p.link}</span>
      </div>
      <div className="bg-[#050505]/92 px-5 py-4">
        <div className="relative h-[8px] bg-white/10">
          <div className="h-full bg-white" style={{ width: `${pct * 100}%` }} />
          {p.goals.map(g => <div key={g.amount} className="absolute -top-1 h-[16px] w-[2px] bg-white/60" style={{ left: `${(g.amount / max) * 100}%` }} />)}
        </div>
        <div className="mt-3 grid gap-x-4" style={{ gridTemplateColumns: `repeat(${p.goals.length}, minmax(0, 1fr))` }}>
          {p.goals.map(g => {
            const hit = p.raised >= g.amount;
            return (
              <div key={g.amount} className={hit ? '' : 'opacity-60'}>
                <div className="font-display text-[24px] leading-none text-white">{p.currency}{g.amount}{hit ? ' ✓' : ''}</div>
                <div className="mt-1 truncate font-sans text-[16px] text-white/70">{g.label}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 font-display text-[19px] text-white/45">{p.splits.map(s => `${s.place} ${s.pct}%`).join(' · ')} · Contributors get a custom Benelux skin</div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Show } from '../../../shared/types';
import { standings } from '../../../shared/bnl';
import { vdoViewUrl } from '../../../shared/players';
import { EASE } from '../../lib/motion';
import { Mark } from '../Brand';
import { VdoView } from './PlayerCam';
import { Countdown, Rise, ScreenBackground, Ticker } from './parts';
import type { BnlData } from './BnlGraphics';

const TAG = 'bg-[#E8E8E8] text-[#111]';
const ord = (n: number) => `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;

export interface LobbyPlayer { id: string; name: string; vdo: string; points: number | null; place: number | null; tag: string; sub: string; fact: string }

/** The players of the match on air: the Reverse Cup lobby, else the player-cam lineup. */
export function useLobby(show: Show, bnl: BnlData | null): LobbyPlayer[] {
  return useMemo(() => {
    const info = bnl?.info ?? {};
    const lineupVdo = new Map(show.lineup.map(l => [l.id, l.vdo]));
    const rcById = new Map(show.rc.players.filter(p => p.id).map(p => [p.id, p]));
    let ids = show.rc.enabled && rcById.size > 0 ? [...rcById.keys()] : show.lineup.map(l => l.id);
    // Team events: the featured sheet match's rosters
    const fm = bnl?.sheet?.featured ? bnl.sheet.matches.find(m => m.id === bnl.sheet!.featured) : undefined;
    if (fm && !(show.rc.enabled && rcById.size > 0)) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const byName = new Map(Object.entries(info).map(([id, p]) => [norm(p.name), id]));
      const roster = [fm.t1.id, fm.t2.id].flatMap(tid => (bnl!.sheet!.teams.find(t => t.id === tid)?.players ?? []).slice(0, 2));
      const found = roster.map(n => byName.get(norm(n))).filter(Boolean) as string[];
      if (found.length) ids = found;
    }
    const pos = new Map<string, string>();
    if (bnl) {
      const pl = Object.entries(bnl.names).map(([id, name]) => ({ id, name } as any));
      for (const d of bnl.league.divisions) for (const r of standings(d, pl)) pos.set(r.player, `${d.id.toUpperCase()} · #${r.pos} · ${r.total} PTS`);
    }
    return ids.slice(0, 6).map(id => {
      const i = info[id], rc = rcById.get(id);
      return {
        id, name: i?.name ?? rc?.name ?? bnl?.names[id] ?? id,
        vdo: i?.vdo || lineupVdo.get(id) || '',
        points: show.rc.enabled && rc ? rc.points : null,
        place: show.rc.enabled && rc ? rc.place : null,
        tag: pos.get(id) ?? '',
        sub: [i?.input, i?.style].filter(Boolean).join(' · '),
        fact: i?.funFact ?? '',
      };
    });
  }, [show.lineup, show.rc, bnl]);
}

function CamBox({ p, show, embeds, w, h, active }: { p: LobbyPlayer; show: Show; embeds: boolean; w: number; h: number; active: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b0b0b]" style={{ width: w, height: h }}>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <Mark height={Math.min(72, h * 0.28)} style={{ margin: '0 auto', opacity: 0.55 }} />
          <div className="mt-2 font-display text-white/35" style={{ fontSize: Math.max(14, h * 0.07) }}>{p.vdo ? (embeds ? 'CONNECTING…' : 'PLAYER CAM') : 'NO CAM'}</div>
        </div>
      </div>
      {embeds && p.vdo && <VdoView src={vdoViewUrl({ vdo: p.vdo }, show.vdo.password, show.vdo.params)} on />}
      {active && <div className="pointer-events-none absolute inset-0" style={{ boxShadow: 'inset 0 0 0 4px var(--accent)' }} />}
    </div>
  );
}

// ------------------------------------------------------------- Warm-up screen

/**
 * Pre-match "lobby cam" screen (think RLCS player-cam intros): every player of the
 * upcoming match on camera while they warm up on the map, with their league form,
 * setup and a rotating fun fact.
 */
export function WarmupScreen({ show, now, bnl, embeds = true }: { show: Show; now: number; bnl: BnlData | null; embeds?: boolean }) {
  const lobby = useLobby(show, bnl);
  const [fi, setFi] = useState(0);
  const facts = lobby.filter(p => p.fact);
  useEffect(() => { const t = setInterval(() => setFi(i => i + 1), 9000); return () => clearInterval(t); }, []);
  const fact = facts.length ? facts[fi % facts.length] : null;
  const ticker = show.ticker.enabled && show.ticker.onScreens && show.ticker.items.length > 0;
  const rc = show.rc;
  const map = rc.maps[rc.mapIndex];

  // grid geometry (right side)
  const n = Math.max(1, lobby.length);
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const GX = 640, GW = 1840 - GX, GAP = 18, BAR = 62, B = 6;
  const tw = (GW - GAP * (cols - 1)) / cols;
  const maxH = (ticker ? 900 : 950) - 120;
  let camW = tw - B * 2, camH = camW * 9 / 16;
  const fitH = (maxH - GAP * (rows - 1)) / rows - BAR - B;
  if (camH > fitH) { camH = fitH; camW = camH * 16 / 9; }
  const tileW = camW + B * 2, tileH = camH + B + BAR;
  const gridH = rows * tileH + (rows - 1) * GAP;
  const top = 120 + (maxH - gridH) / 2;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScreenBackground />
      <Rise className="absolute" style={{ left: 80, top: 170, width: 500 }}>
        <span className={`${TAG} px-3 pt-[4px] font-display text-[26px] leading-[36px]`}>{rc.enabled ? rc.title : show.stage}</span>
        <div className="mt-4 font-display text-[110px] leading-[0.9] text-white">WARM<br />UP</div>
        <div className="mt-4 font-display text-[28px] text-white/60">
          {rc.enabled ? <>{map ? `${map.toUpperCase()} · ` : ''}{rc.maps.length} MAPS · {rc.start} PTS</> : show.tournament}
        </div>
      </Rise>
      {show.timer.target != null && (
        <Rise i={1} className="absolute" style={{ left: 80, top: 520 }}>
          <Countdown show={show} now={now} size={92} label="MATCH STARTS IN" />
        </Rise>
      )}
      <AnimatePresence mode="wait">
        {fact && (
          <motion.div key={fact.id + fi} className="absolute" style={{ left: 80, top: ticker ? 700 : 740, width: 500 }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4, ease: EASE }}>
            <span className={`${TAG} px-2.5 pt-[3px] font-display text-[20px] leading-[28px]`}>DID YOU KNOW</span>
            <div className="bg-[#050505]/92 px-4 py-3">
              <div className="font-display text-[30px] leading-none text-white">{fact.name}</div>
              <div className="mt-2 font-sans text-[19px] leading-snug text-white/80">{fact.fact}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {lobby.length === 0 && (
        <div className="absolute grid place-items-center font-display text-[34px] text-white/40" style={{ left: GX, top: 120, width: GW, height: maxH }}>
          Load a Reverse Cup match or set the player-cam lineup
        </div>
      )}
      {lobby.map((p, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, n - r * cols);
        const rowW = inRow * tileW + (inRow - 1) * GAP;
        const x = GX + (GW - rowW) / 2 + c * (tileW + GAP);
        const y = top + r * (tileH + GAP);
        const active = show.activePlayer?.id === p.id;
        return (
          <motion.div key={p.id} className="absolute bg-[#050505]" style={{ left: x, top: y, width: tileW, height: tileH, boxShadow: '0 14px 36px rgba(0,0,0,0.5)' }}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 + i * 0.07, ease: EASE }}>
            <div className="absolute" style={{ left: B, top: B, width: camW, height: camH }}>
              <CamBox p={p} show={show} embeds={embeds} w={camW} h={camH} active={active} />
              {active && <span className="absolute left-3 top-3 bg-[var(--accent)] px-2 pt-[2px] font-display text-[18px] leading-[24px] text-white">● ON STREAM</span>}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center" style={{ height: BAR }}>
              <div className="grid h-full w-[62px] flex-none place-items-center bg-[#151515]"><Mark height={48} /></div>
              <div className="min-w-0 flex-1 px-4">
                <div className="truncate font-display text-[34px] leading-none text-white" style={{ paddingTop: 3 }}>{p.name}</div>
                {p.sub && <div className="mt-0.5 truncate font-sans text-[14px] text-white/50">{p.sub}</div>}
              </div>
              {p.tag && <span className="mr-3 flex-none bg-white/10 px-2 pt-[2px] font-display text-[19px] leading-[26px] text-white/80">{p.tag}</span>}
              {p.points !== null && <span className={`${TAG} mr-3 min-w-[64px] flex-none px-2 pt-[3px] text-center font-display text-[28px] leading-[36px]`}>{p.place ? ord(p.place) : p.points}</span>}
            </div>
          </motion.div>
        );
      })}
      {ticker && <div className="absolute inset-x-0 bottom-0"><Ticker show={show} height={56} /></div>}
    </div>
  );
}

// ------------------------------------------------------- Gameplay cam strip

/** RLCS-style strip with every lobby cam along the bottom of the gameplay overlay. */
export function CamStrip({ show, bnl, embeds, bottom }: { show: Show; bnl: BnlData | null; embeds: boolean; bottom: number }) {
  const lobby = useLobby(show, bnl);
  if (!show.playerCam.enabled || lobby.length === 0) return null;
  const W = lobby.length > 4 ? 256 : 300, H = Math.round(W * 9 / 16), BAR = 40, B = 4, GAP = 10;
  const total = lobby.length * (W + B * 2) + (lobby.length - 1) * GAP;
  const x0 = (1920 - total) / 2;
  return (
    <>
      {lobby.map((p, i) => {
        const active = show.activePlayer?.id === p.id;
        const out = p.place !== null && !(show.rc.finished && p.place <= show.rc.winners);
        return (
          <motion.div key={p.id} className="absolute bg-[#050505]" style={{ left: x0 + i * (W + B * 2 + GAP), bottom, width: W + B * 2, height: H + B + BAR, opacity: out ? 0.55 : 1, boxShadow: '0 10px 26px rgba(0,0,0,0.45)' }}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: out ? 0.55 : 1, y: active ? -8 : 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <div className="absolute" style={{ left: B, top: B, width: W, height: H }}>
              <CamBox p={p} show={show} embeds={embeds} w={W} h={H} active={active} />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center" style={{ height: BAR }}>
              {active && <div className="absolute inset-y-0 left-0 w-[4px] bg-[var(--accent)]" />}
              <span className="min-w-0 flex-1 truncate px-3 font-display text-[24px] leading-none text-white" style={{ paddingTop: 2 }}>{p.name}</span>
              {p.points !== null && <span className={`${TAG} mr-2 min-w-[48px] px-1.5 pt-[2px] text-center font-display text-[22px] leading-[28px]`}>{p.place && (out || show.rc.finished) ? ord(p.place) : p.points}</span>}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

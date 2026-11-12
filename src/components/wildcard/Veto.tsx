import { motion } from 'motion/react';
import type { Show } from '../../../shared/types';
import { MAJOR_MAPS, mapPhoto } from '../../../shared/maps';
import { teamLogo } from '../../../shared/major';
import { fmtMs, pbMs, vetoRows, type WildcardState } from '../../../shared/wildcard';
import type { MajorMap } from '../../../shared/maps';
import { Reveal } from '../Reveal';
import { PB_SOURCE, seedTeamPb, teamPlayerPbs } from '../../../shared/pbs';
import { MapArt } from './MapArt';
import './wildcard.css';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Map veto: the five maps as cards; each called step stamps its card (BANNED / PICKED BY · MAP N /
 * DECIDER) with the team's logo. The header says who acts next; the strip at the bottom lists the order.
 */
export function WcVeto({ wc, show, now }: { wc: WildcardState; show: Show; now: number }) {
  const v = wc.veto, rows = vetoRows(v);
  const a = wc.intro.a || show.teamA.name || 'Team A', b = wc.intro.b || show.teamB.name || 'Team B';
  const who = (by: 'a' | 'b' | 'd') => (by === 'a' ? a : by === 'b' ? b : 'Decider');
  const next = v.order[v.done.length];
  const fresh = v.at != null && now - v.at < 1500;
  const last = v.done[v.done.length - 1];
  const pbMap = MAJOR_MAPS.find(m => m.id === v.pb.map);
  const pbOn = !!pbMap;
  return (
    <div className="wc">
      <div className="vt">
        <div className="vt-hd">
          <span>{wc.intro.label || show.stage || 'OverDrive 2026 Major'}</span>
          <h1>Map veto</h1>
        </div>
        <div className="vt-teams">
          <Team name={a} on={next?.by === 'a'} />
          <em>VS</em>
          <Team name={b} on={next?.by === 'b'} right />
        </div>
        <div className="vt-next">
          {next ? <><b>{who(next.by)}</b> {next.by === 'd' ? 'is the last map' : next.act === 'ban' ? 'to ban' : 'to pick'}</> : 'Veto complete'}
        </div>

        <div className="vt-cards">
          {MAJOR_MAPS.map((m, i) => {
            const r = rows.find(x => x.map === m.id), photo = mapPhoto(m.id, wc.mapPhotos);
            const kind = !r ? '' : r.step.by === 'd' ? 'dec' : r.step.act;
            const t = r && r.step.by !== 'd' ? who(r.step.by) : '';
            return (
              <motion.div key={m.id} className={`vt-card ${kind}`} style={{ ['--mc' as string]: m.accent }}
                initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.08 * i }}>
                <div className="vt-art">{photo ? <img src={photo} alt="" /> : <MapArt id={m.id} />}</div>
                <div className="vt-name"><span>{m.title.replace(/^OverDrive |\s2026$/g, '')}</span><small>by {m.author}</small></div>
                {r && (
                  <motion.div key={`${m.id}-${r.n}`} className="vt-stamp"
                    initial={fresh && last === m.id ? { opacity: 0, scale: 1.6, rotate: -8 } : false} animate={{ opacity: 1, scale: 1, rotate: kind === 'ban' ? -8 : 0 }} transition={{ duration: 0.45, ease: EASE }}>
                    {t && teamLogo(t) && <img src={teamLogo(t)} alt="" />}
                    <b>{kind === 'ban' ? 'Banned' : kind === 'dec' ? 'Decider' : 'Picked'}</b>
                    <small>{kind === 'ban' ? `by ${t}` : kind === 'dec' ? `Map ${r.mapNo}` : `by ${t} · Map ${r.mapNo}`}</small>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* PB comparison: shown from the controls (PBs → map), until hidden. */}
        <Reveal show={pbOn} from="up" id={`pb-${v.pb.map}-${v.pb.at}`}>
          <div className="pb-dim" />
          {pbMap && <PbCompare map={pbMap} a={a} b={b} wc={wc} mapNo={rows.find(r => r.map === pbMap.id)?.mapNo ?? null} />}
        </Reveal>

        <div className="vt-order">
          {v.order.map((st, i) => {
            const d = v.done[i], m = d ? MAJOR_MAPS.find(x => x.id === d) : null;
            return (
              <div key={i} className={`vt-step ${st.act}${d ? ' done' : ''}${i === v.done.length ? ' now' : ''}`}>
                <i>{i + 1}</i><span>{who(st.by)} {st.by === 'd' ? '' : st.act}</span><b>{m ? m.country : '—'}</b>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Team({ name, on, right }: { name: string; on: boolean; right?: boolean }) {
  const logo = teamLogo(name);
  return (
    <div className={`vt-team${on ? ' on' : ''}${right ? ' rt' : ''}`}>
      {logo && <img src={logo} alt="" />}<b>{name}</b>
    </div>
  );
}

/** Team PBs on the picked map, side by side: best time, who set it, and the gap. */
function PbCompare({ map, a, b, wc, mapNo }: { map: MajorMap; a: string; b: string; wc: WildcardState; mapNo: number | null }) {
  // Typed-in times win; otherwise the team's fastest player on the trackmania.io leaderboard.
  const pbs: Record<string, { time: string; player: string } | null> = Object.fromEntries([a, b].map(t => [t, wc.pbs[map.id]?.[t] ?? seedTeamPb(map.id, t)]));
  const ms = [a, b].map(t => (pbs[t] ? pbMs(pbs[t]!.time) : null));
  const best = ms[0] != null && ms[1] != null ? (ms[0] <= ms[1] ? 0 : 1) : ms[0] != null ? 0 : ms[1] != null ? 1 : -1;
  const gap = ms[0] != null && ms[1] != null ? Math.abs(ms[0] - ms[1]) : null;
  return (
    <div className="pb" style={{ ['--mc' as string]: map.accent }}>
      <div className="pb-art"><img src={mapPhoto(map.id, wc.mapPhotos)} alt="" /></div>
      <div className="pb-body">
        <div className="pb-k">Personal bests{mapNo ? ` · Map ${mapNo}` : ''}</div>
        <h2>{map.country}</h2>
        <div className="pb-src">Leaderboard: {PB_SOURCE}</div>
        {[a, b].map((t, i) => {
          const pb = pbs[t], logo = teamLogo(t);
          return (
            <div key={t} className={`pb-row${best === i ? ' best' : ''}`}>
              {logo ? <img src={logo} alt="" /> : <i />}
              <div className="pb-who"><b>{t}</b><span>{teamPlayerPbs(map.id, t).some(p => p.time) ? teamPlayerPbs(map.id, t).map(p => `${p.handle} ${p.time ?? '—'}`).join('  ·  ') : pb?.player || (pb ? 'Team best' : 'No PB yet')}</span></div>
              <div className="pb-t">{pb ? fmtMs(ms[i]!) : '—'}</div>
              <div className="pb-d">{best === i ? (gap != null ? 'Faster' : '') : gap != null ? `+${fmtMs(gap)}` : ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

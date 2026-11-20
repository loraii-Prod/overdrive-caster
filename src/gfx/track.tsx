/**
 * Overdrive 3.1 · TRACK PROGRESSION graphic (native 1920×1080, ×2 at 4K), in the Major identity: fire loop,
 * WC Anton / WC Montserrat, orange accents, charcoal panels. Integrated from the "broadcast_overlays" Track
 * Progression overlay (same data and reading of the rounds); drawn here in plain SVG, no external library or font.
 *
 * Header (map shot, track, teams, score, fastest lap) · step chart of the cumulative points (lead area, threshold,
 * aces, labels; level stretches alternate both colours) · one cell per round · key takeaway.
 * Draws only data that exists: no track → nothing; a demo track carries a DEMO tag.
 */
import type { ReactNode } from 'react';
import type { GfxInstance } from '../../shared/gfx';
import { majorMap, mapPhoto } from '../../shared/maps';
import { MapFlag } from '../components/MapFlag';
import { lapTime, teamLogoUrl, trackStory, type TrackMapData, type TrackStory, type TrackTeam } from '../../shared/trackProgress';
import { BgVideo } from '../components/Brand';
import type { GfxData } from './Graphic';
import '../components/wildcard/wildcard.css';
import './audience.css';
import './track.css';

type Cfg = GfxInstance['config'];
const PALETTES: Record<string, [string, string]> = {
  game: ['#3898FF', '#FF4757'], // in-game blue / red teams
  brand: ['#FF6A13', '#F4F2EF'], // Overdrive orange / bone
};

export function TrackProgression({ cfg, d }: { cfg: Cfg; d: GfxData }) {
  const t = d.wc?.state.track;
  const data = t?.data;
  if (!data) return null;
  const [ca, cb] = PALETTES[String(cfg.colors)] ?? PALETTES.game;
  const s = trackStory(data);
  const bg = String(cfg.bg || 'brand');
  const photo = data.mapId ? mapPhoto(data.mapId, d.wc?.state.mapPhotos ?? {}) : '';
  const map = majorMap(data.mapId);
  return (
    <div className="aud trk" data-track={data.track} data-track-rounds={data.rounds.length} data-track-state={s.done ? 'final' : 'live'} style={{ ['--ta' as string]: ca, ['--tb' as string]: cb }}>
      {bg === 'brand' && <><BgVideo /><div className="aud-dim" /></>}
      {bg === 'dim' && <div className="trk-shade" />}
      <header className="trk-head">
        <div className="trk-map">
          {photo && <div className="trk-shot" style={{ backgroundImage: `url(${photo})` }} />}
          <div className="trk-map-txt">
            {map && <MapFlag id={map.id} h={30} className="trk-flag" />}
            <div className="kick" data-track-kicker>{[data.mapNumber ? `Track ${data.mapNumber}` : '', data.pickedBy].filter(Boolean).join(' · ') || 'Track'}</div>
            <div className="trk-title" style={{ fontSize: fitTitle(map?.country ?? data.track) }}>{map?.country ?? data.track}</div>
            {map && <div className="trk-sub">{map.title}</div>}
          </div>
        </div>
        <div className="trk-board">
          <Side team={data.teamA} color={ca} />
          <div className="trk-scores">
            <Score n={s.scoreA} lead={s.leader === 'a'} color={ca} />
            <div className={`trk-state ${s.done ? 'final' : ''} ${s.overtime && !s.done ? 'ot' : ''}`} data-track-status>{s.done ? (s.overtime ? 'Final · OT' : 'Final') : s.steps.length ? (s.overtime ? 'Overtime' : `Live · R${s.steps.length}`) : 'Track start'}</div>
            <Score n={s.scoreB} lead={s.leader === 'b'} color={cb} />
          </div>
          <Side team={data.teamB} color={cb} right />
        </div>
        <div className="trk-fast">
          {data.fastest && cfg.fastest !== false && (
            <div className="trk-fl" data-track-fastest style={{ ['--fl' as string]: flColor(data, ca, cb) }}>
              <div className="trk-fl-pat" />
              <small>Fastest lap{data.fastest.round ? ` · R${data.fastest.round}` : ''}</small>
              <b><span>{data.fastest.player}</span> {lapTime(data.fastest.timeMs)}</b>
            </div>
          )}
        </div>
      </header>

      <section className="trk-chart panel"><Chart data={data} s={s} ca={ca} cb={cb} anim={cfg.reveal !== false} /></section>

      <Tape data={data} s={s} ca={ca} cb={cb} />

      <footer className="trk-foot">
        <span className="trk-tag">{s.done ? 'Key takeaway' : 'Track story'}</span>
        <span className="trk-txt" data-track-narrative>{s.narrative}</span>
        <span className="trk-legend"><i>◆</i> Ace +3 · first to {data.pointLimit} with the lead</span>
        {cfg.ecmLogo !== false && (
          <div className="trk-sponsor" data-track-sponsor>
            <img src="/brand/ecm/logo.png" alt="" />
            <span>Powered by ECM</span>
          </div>
        )}
      </footer>
      {t?.demo && <div className="mv-rehearsal" data-track-demo>Demo data</div>}
    </div>
  );
}

/** Anton is ~0.43 em wide per capital: the map name fits its 340 px column. */
const fitTitle = (t: string) => Math.max(34, Math.min(66, Math.floor(340 / (Math.max(1, t.length) * 0.43))));
const flColor = (d: TrackMapData, ca: string, cb: string) => {
  const p = d.fastest?.player.toLowerCase() ?? '';
  return p && d.teamA.roster.toLowerCase().includes(p) ? ca : p && d.teamB.roster.toLowerCase().includes(p) ? cb : '#FF6A13';
};

function Side({ team, color, right }: { team: TrackTeam; color: string; right?: boolean }) {
  const logo = teamLogoUrl(team);
  const lines = nameLines(team.name);
  const size = lines.length > 1 ? 31 : team.name.length <= 9 ? 44 : 38;
  return (
    <div className={`trk-side ${right ? 'r' : ''}`}>
      <div className="trk-logo" style={{ borderColor: color }}>{logo ? <img src={logo} alt="" /> : <b>{team.tag.slice(0, 4)}</b>}</div>
      <div className="trk-who">
        <b style={{ fontSize: size }}>{lines.map((l, i) => <span key={i}>{l}</span>)}</b>
        {team.roster && <span style={{ color }}>{team.roster}</span>}
      </div>
    </div>
  );
}
/** Long team names on two balanced lines ("All Gamers / Global"), as the original overlay did. */
function nameLines(name: string): string[] {
  const w = name.trim().split(/\s+/);
  if (name.length <= 12 || w.length < 2) return [name];
  let best = 1, dist = Infinity;
  for (let i = 1; i < w.length; i++) { const dd = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length); if (dd < dist) { dist = dd; best = i; } }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}
const Score = ({ n, lead, color }: { n: number; lead: boolean; color: string }) => (
  <div className={`trk-score ${lead ? 'lead' : ''}`} style={{ borderBottomColor: lead ? color : 'rgba(255,255,255,.14)', ['--c' as string]: color }}>{n}</div>
);

// ------------------------------------------------------------------ chart

const W = 1728, H = 560, M = { l: 78, r: 44, t: 40, b: 56 };
const IW = W - M.l - M.r, IH = H - M.t - M.b;

function Chart({ data, s, ca, cb, anim }: { data: TrackMapData; s: TrackStory; ca: string; cb: string; anim: boolean }) {
  const n = s.steps.length;
  const xMax = Math.max(n, 6) + 0.5; // a fixed minimum: early rounds don't fill the whole width
  const top = Math.max(data.pointLimit, s.scoreA, s.scoreB) + 2;
  const x = (v: number) => M.l + (v / xMax) * IW;
  const y = (v: number) => M.t + IH - (v / top) * IH;
  const pts = [{ a: 0, b: 0 }, ...s.steps.map(t => ({ a: t.cumA, b: t.cumB }))];
  /** Step line of one team: flat through each round, rising between rounds. */
  const line = (k: 'a' | 'b') => {
    let p = `M ${x(0)} ${y(0)} H ${x(0.5)}`;
    for (let r = 1; r <= n; r++) p += ` V ${y(pts[r][k])} H ${x(r + 0.5)}`;
    return p;
  };
  // where both lines run together: flat stretches with a level score, and shared parts of the risers
  const shared: string[] = [];
  for (let r = 0; r <= n; r++) if (pts[r].a === pts[r].b) shared.push(`M ${x(r === 0 ? 0 : r - 0.5)} ${y(pts[r].a)} H ${x(r + 0.5)}`);
  for (let r = 1; r <= n; r++) {
    const lo = Math.max(pts[r - 1].a, pts[r - 1].b), hi = Math.min(pts[r].a, pts[r].b);
    if (pts[r].a > pts[r - 1].a && pts[r].b > pts[r - 1].b && hi > lo) shared.push(`M ${x(r - 0.5)} ${y(lo)} V ${y(hi)}`);
  }
  const yTicks = Array.from({ length: Math.floor(top / 2) + 1 }, (_, i) => i * 2);
  const last = n ? s.steps[n - 1] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trk-svg" data-track-chart>
      <defs><clipPath id="trk-reveal"><rect x={0} y={0} width={W} height={H} className={anim ? 'trk-reveal' : ''} key={`rv-${n}`} /></clipPath></defs>
      {yTicks.map(v => <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="trk-grid" /><text x={M.l - 18} y={y(v) + 7} className="trk-ax" textAnchor="end">{v}</text></g>)}
      {Array.from({ length: n + 1 }, (_, r) => <text key={r} x={x(r)} y={H - 16} className="trk-ax x" textAnchor="middle">{r === 0 ? 'START' : `R${r}`}</text>)}
      <line x1={M.l} x2={W - M.r} y1={y(data.pointLimit)} y2={y(data.pointLimit)} className="trk-limit" />
      <text x={M.l + 12} y={y(data.pointLimit) - 12} className="trk-limit-t">Threshold · {data.pointLimit} pts</text>
      <g clipPath="url(#trk-reveal)">
        {/* the leader's lead, between the two lines */}
        {pts.map((p, r) => p.a !== p.b && <rect key={r} x={x(r === 0 ? 0 : r - 0.5)} width={x(r + 0.5) - x(r === 0 ? 0 : r - 0.5)} y={y(Math.max(p.a, p.b))} height={y(Math.min(p.a, p.b)) - y(Math.max(p.a, p.b))} fill={p.a > p.b ? ca : cb} opacity={0.2} />)}
        <path d={line('b')} className="trk-line" stroke={cb} />
        <path d={line('a')} className="trk-line" stroke={ca} />
        {shared.length > 0 && <path d={shared.join(' ')} className="trk-line dash" stroke={cb} />}
        {s.steps.map((t, i) => {
          const cx = x(t.round), level = t.cumA === t.cumB, aUp = t.cumA >= t.cumB;
          return (
            <g key={i} className={i === n - 1 && anim ? 'trk-new' : ''}>
              {t.ptsA === 3 && <Diamond cx={cx} cy={y(t.cumA)} c={ca} />}
              {t.ptsB === 3 && <Diamond cx={cx} cy={y(t.cumB)} c={cb} />}
              {level ? (t.cumA > 0 && <text x={cx} y={y(t.cumA) - 18} className="trk-pt" fill="#fff">{t.cumA}</text>) : <>
                <text x={cx} y={y(t.cumA) + labelDy(aUp, t.cumA, t.cumB)} className="trk-pt" fill={ca}>{t.cumA}</text>
                <text x={cx} y={y(t.cumB) + labelDy(!aUp, t.cumB, t.cumA)} className="trk-pt" fill={cb}>{t.cumB}</text>
              </>}
            </g>
          );
        })}
        {last && !s.done && <><circle cx={x(last.round + 0.5)} cy={y(last.cumA)} r={9} fill={ca} className="trk-now" /><circle cx={x(last.round + 0.5)} cy={y(last.cumB)} r={9} fill={cb} className="trk-now" /></>}
      </g>
    </svg>
  );
}
/** Leader's label above its line, the other below; at 0 (the axis is just under) above too, when the lines are apart. */
const labelDy = (leads: boolean, v: number, other: number) => (leads || (v === 0 && other - v >= 2) ? -18 : 36);
const Diamond = ({ cx, cy, c }: { cx: number; cy: number; c: string }) => <polygon points={`${cx},${cy - 14} ${cx + 14},${cy} ${cx},${cy + 14} ${cx - 14},${cy}`} fill={c} stroke="#160A07" strokeWidth={3} />;

// ------------------------------------------------------------------ one cell per round

function Tape({ s, ca, cb }: { data: TrackMapData; s: TrackStory; ca: string; cb: string }) {
  const MAX = 14, from = Math.max(0, s.steps.length - MAX);
  const cells = s.steps.slice(from);
  if (!cells.length) return <div className="trk-tape empty">Round 1 coming up</div>;
  const cell = (t: TrackStory['steps'][number]): ReactNode => {
    const c = t.winner === 'a' ? ca : t.winner === 'b' ? cb : 'rgba(255,255,255,.35)';
    return (
      <div key={t.round} className={`trk-cell ${t.outcome.toLowerCase()}`} data-track-round={t.round} data-outcome={t.outcome} style={{ borderTopColor: c, ['--c' as string]: c }}>
        <div className="trk-cell-h"><span>R{t.round}</span><span>{t.cumA}–{t.cumB}</span></div>
        <div className="trk-cell-p"><b style={{ color: t.ptsA > t.ptsB ? ca : undefined }}>+{t.ptsA}</b><i>vs</i><b style={{ color: t.ptsB > t.ptsA ? cb : undefined }}>+{t.ptsB}</b></div>
        <div className="trk-badge">{t.outcome === 'ACE' ? '◆ Ace' : t.outcome === 'DRAW' ? 'Draw' : 'Win'}</div>
      </div>
    );
  };
  return <div className="trk-tape" style={{ gridTemplateColumns: `repeat(${Math.max(cells.length, 6)}, 1fr)` }}>{cells.map(cell)}</div>;
}

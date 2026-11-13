import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Swap, useGfxTransition } from '../../gfx/transition';
import './wildcard.css';
import type { Caster, Scene, Show } from '../../../shared/types';
import type { MatchData } from '../../../shared/protocol';
import type { RtcViewer } from '../../lib/rtcViewer';
import { Feed } from '../Feed';
import { MAJOR_PROFILES, normHandle, teamLogo, teamPlayers, majorTeam } from '../../../shared/major';
import { pickemTable, type WcPick, type WildcardState } from '../../../shared/wildcard';
import { showcasePhoto } from './Profiles';
import { seasonOf } from '../../../shared/season';

const money = (s: string) => Number(String(s).replace(/[^\d.]/g, '')) || 0;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** "BIG 3–1" with the team logo: a caster's pick, for name bars and lists. */
export function PickBadge({ pick, size = 'md', logoOnly = false }: { pick: WcPick; size?: 'sm' | 'md'; logoOnly?: boolean }) {
  const logo = teamLogo(pick.team);
  return (
    <span className={`wc-pick ${size}`}>
      {logo && <img src={logo} alt="" />}
      {!(logoOnly && logo) && <b>{pick.team}</b>}{pick.score && <i>{pick.score.replace('-', '–')}</i>}
    </span>
  );
}

/** Slots 1–3 are casters, 4–5 analysts (fixed by slot, whatever the role text says). */
export const isAnalyst = (c: { id: number }) => c.id === 4 || c.id === 5;
export const isCaster = (c: { id: number }) => c.id >= 1 && c.id <= 3;
export const CASTER_SLOTS = [1, 2, 3], ANALYST_SLOTS = [4, 5];

/** Casters on the Casters screen and the other camera screens: the picked ones, else every caster in the show. */
export function boothIds(casters: Caster[], booth: number[] = []): number[] {
  const on = casters.filter(c => c.enabled && isCaster(c));
  // The booth's order is the camera position order (left to right).
  return (booth.length ? booth.map(id => on.find(c => c.id === id)).filter((c): c is Caster => !!c) : on).slice(0, 3).map(c => c.id);
}

/** The scene as the booth sees it: only the booth's casters count as on screen (analysts never). */
export function boothScene(scene: Scene, booth: number[] = []): Scene {
  const ids = boothIds(scene.casters, booth);
  const pos = (c: Caster) => (ids.includes(c.id) ? ids.indexOf(c.id) : 99);
  return { ...scene, casters: [...scene.casters].sort((a, b) => pos(a) - pos(b)).map(c => (ids.includes(c.id) ? c : { ...c, enabled: false, standby: c.enabled && isCaster(c) })) };
}

/** Analysts at the desk: the picked ones, else every analyst in the show. */
export function deskAnalystIds(casters: Caster[], slots: number[] = []): number[] {
  const on = casters.filter(c => c.enabled && isAnalyst(c));
  const ids = (slots.length ? on.filter(c => slots.includes(c.id)) : on).map(c => c.id);
  // Nobody switched on yet: show both analyst seats (names + placeholder) rather than an empty frame.
  return ids.length ? ids : casters.filter(isAnalyst).map(c => c.id);
}

/** Who sits at the desk (1–3 cameras): the caster who joined (if any), then the analysts. */
export function deskCasters(scene: Scene, desk: { slots?: number[]; guest?: number | null } = {}): Caster[] {
  const an = deskAnalystIds(scene.casters, desk.slots ?? []);
  const g = scene.casters.find(c => c.id === desk.guest && c.enabled && isCaster(c));
  return [...(g ? [g] : []), ...scene.casters.filter(c => an.includes(c.id))].slice(0, 3);
}

/** Camera size, name-bar height and top of each camera for 1, 2 or 3 analysts (left column). */
export function deskLayout(n: number) {
  if (n >= 3) return { w: 384, h: 216, bar: 36, tops: [176, 436, 696] };
  if (n === 2) return { w: 600, h: 338, bar: 44, tops: [172, 572] };
  return { w: 900, h: 506, bar: 46, tops: [190] };
}

/** Pick'em standings: every finished match's picks scored (1 = right winner, 3 = exact score). */
function PickemPanel({ wc, scene }: { wc: WildcardState; scene: Scene }) {
  const rows = pickemTable(wc);
  const name = (slot: string) => scene.casters.find(c => String(c.id) === slot)?.name || `Slot ${slot}`;
  return (
    <>
      <div className="dk-h">Pick'em standings</div>
      <div className="dk-sub">1 point for the winner · 3 for the exact score</div>
      <div className="dk-picks">
        {rows.length === 0 && <div className="dk-empty">Scores appear after the first match with picks</div>}
        {rows.map((r, i) => (
          <div key={r.slot} className={`dk-pk pe${i === 0 ? ' lead' : ''}`} style={{ ['--i' as string]: String(i) }}>
            <div className="who"><b>{i + 1}. {name(r.slot)}</b><span>{r.right}/{r.played} right · {r.exact} exact</span></div>
            <div className="sc">{r.points}<small> pts</small></div>
          </div>
        ))}
      </div>
    </>
  );
}

function PicksPanel({ wc, scene }: { wc: WildcardState; scene: Scene }) {
  const it = wc.intro;
  // Everyone at the desk (incl. the default analyst seats and a joining caster), in desk order.
  const rows = deskCasters(scene, wc.desk).filter(c => it.picks[String(c.id)]);
  const count = (t: string) => rows.filter(c => it.picks[String(c.id)].team === t).length;
  return (
    <>
      <div className="dk-h">Our casters predict</div>
      <div className="dk-sub">{it.a && it.b ? `${it.a} vs ${it.b}` : 'Pick the teams in the match intro'}</div>
      <div className="dk-picks">
        {rows.length === 0 && <div className="dk-empty">Waiting for the casters' picks…</div>}
        {rows.map((c, i) => {
          const p = it.picks[String(c.id)], logo = teamLogo(p.team);
          return (
            <div key={c.id} className="dk-pk" style={{ ['--i' as string]: String(i) }}>
              <div className="who"><b>{c.name || `Caster ${c.id}`}</b>{c.role && <span>{c.role}</span>}</div>
              <div className="pick">{logo && <img src={logo} alt="" />}<b>{p.team}</b></div>
              <div className="sc">{p.score ? p.score.replace('-', '–') : '—'}</div>
            </div>
          );
        })}
      </div>
      {rows.length > 1 && it.a && it.b && (
        <div className="dk-cons">
          <span>{it.a} <b>{count(it.a)}</b></span><i />
          <span><b>{count(it.b)}</b> {it.b}</span>
        </div>
      )}
    </>
  );
}

function H2hPanel({ wc }: { wc: WildcardState }) {
  const { a, b } = wc.intro;
  if (!a || !b) return <><div className="dk-h">Head to head</div><div className="dk-empty">Pick the teams in the match intro</div></>;
  const side = (t: string) => {
    const pl = teamPlayers(t);
    const titles = pl.flatMap(p => p.results).filter(r => r[1].startsWith('1st')).length;
    const best = pl.flatMap(p => p.results).find(r => /esports world cup|world cup|world tour|ascension/i.test(r[2]) && /^(1st|2nd|3rd|4th)/.test(r[1]));
    return { pl, how: majorTeam(t)?.how ?? '', win: usd(pl.reduce((s, p) => s + money(p.winnings), 0)), titles, best: best ? `${best[1]} ${best[2]}` : '—' };
  };
  const A = side(a), B = side(b);
  const row = (label: string, x: ReactNode, y: ReactNode) => <div className="dk-row"><span className="l">{x}</span><span className="m">{label}</span><span className="r">{y}</span></div>;
  return (
    <>
      <div className="dk-h">Head to head</div>
      <div className="dk-teams">
        <div>{teamLogo(a) && <img src={teamLogo(a)} alt="" />}<b>{a}</b></div>
        <i>VS</i>
        <div>{teamLogo(b) && <img src={teamLogo(b)} alt="" />}<b>{b}</b></div>
      </div>
      {row('Qualified', A.how, B.how)}
      {row('Players', A.pl.map(p => p.handle).join(' & '), B.pl.map(p => p.handle).join(' & '))}
      {row('Split 1', seasonOf(a)?.split1 || '—', seasonOf(b)?.split1 || '—')}
      {row('Split 2', seasonOf(a)?.split2 || '—', seasonOf(b)?.split2 || '—')}
      {row('Wildcards', seasonOf(a)?.wildcards || '—', seasonOf(b)?.wildcards || '—')}
      {row('Career winnings', <em>{A.win}</em>, <em>{B.win}</em>)}
      {row('Big-stage best', A.best, B.best)}
      <div className="dk-note">OverDrive 2026 season and players' combined career winnings (Liquipedia).</div>
    </>
  );
}

function PlayerPanel({ wc, bnl }: { wc: WildcardState; bnl: MatchData | null }) {
  const p = (wc.desk.player && MAJOR_PROFILES.find(x => normHandle(x.handle) === wc.desk.player)) || teamPlayers(wc.intro.a)[0] || MAJOR_PROFILES[0];
  const photo = showcasePhoto(wc, bnl, p.handle);
  return (
    <>
      <div className="dk-h">Player in focus</div>
      <div className="dk-pl">
        {photo ? <img src={photo} alt="" /> : <div className="ph">{p.handle.slice(0, 2)}</div>}
        <div>
          <div className="t">{p.team} · {p.how}</div>
          <div className="n">{p.handle}</div>
          <div className="r">{[p.name, p.country, p.age && `${p.age}`].filter(Boolean).join(' · ')}</div>
          <div className="w">Career winnings <b>{p.winnings}</b></div>
        </div>
      </div>
      <div className="dk-pal">
        {p.results.slice(0, 5).map(([y, place, ev], k) => <div key={k}><span>{y}</span><b className={place.startsWith('1st') ? 'gold' : ''}>{place}</b><i>{ev}</i></div>)}
      </div>
      <div className="dk-note big">{p.note}</div>
    </>
  );
}

/**
 * Analyst desk: the analyst cameras on the left, a large analysis panel on the right
 * (caster predictions, head to head, or the player in focus; chosen in the controller).
 */
export function WcDesk({ scene, show, wc, bnl, viewer, monitor }: { scene: Scene; show: Show; wc: WildcardState | null; bnl: MatchData | null; viewer?: RtcViewer | null; monitor?: boolean }) {
  const cams = deskCasters(scene, wc?.desk);
  const cam = deskLayout(cams.length);
  const small = cams.length > 1;
  const panelX = 80 + cam.w + 50;
  const picks = wc?.intro.picksShow ? wc.intro.picks : {};
  return (
    <div className="wc desk" style={{ pointerEvents: 'none' }}>
      <div className="dk-top">
        <div className="k">{[show.tournament || 'OverDrive', 'Analyst desk'].join(' · ')}</div>
        <div className="t">{wc?.intro.label || (wc?.intro.a && wc?.intro.b ? `${wc.intro.a} vs ${wc.intro.b}` : 'Analysis')}</div>
      </div>
      {cams.length === 0 && <div className="dk-cam" style={{ left: 80, top: 190, width: cam.w, height: cam.h }}><div className="dk-nocam">No analyst on screen: enable a caster (role “Analyst” goes here first)</div></div>}
      {cams.map((c, i) => {
        const top = cam.tops[i] ?? cam.tops[0];
        const pk = picks[String(c.id)];
        return (
          <div key={c.id}>
            <div className="dk-cam" style={{ left: 80, top, width: cam.w, height: cam.h }}>
              {c.cameraOn && <Feed caster={c} viewer={viewer} size={cams.length >= 3 ? 'sm' : small ? 'md' : 'lg'} showName={false} monitor={monitor} />}
            </div>
            {scene.showNames && c.showName && (
              <div className={`dk-name${cams.length >= 3 ? ' sm' : ''}`} style={{ left: 80, top: top + cam.h, width: cam.w, height: cam.bar }}>
                <b>{c.name}</b>{c.role && <span>{c.role}</span>}
                <AnimatePresence>{pk && <motion.span key="pk" className="ml-auto" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.3 }}><PickBadge pick={pk} size="sm" logoOnly={cams.length >= 2} /></motion.span>}</AnimatePresence>
              </div>
            )}
          </div>
        );
      })}
      <DeskPanel wc={wc} scene={scene} bnl={bnl} left={panelX} />
    </div>
  );
}

/** What the analysis panel shows (one of the desk panels). */
export function DeskPanelContent({ wc, scene, bnl }: { wc: WildcardState | null; scene: Scene; bnl: MatchData | null }) {
  return !wc ? <div className="dk-empty">Waiting for the server…</div>
    : wc.desk.panel === 'h2h' ? <H2hPanel wc={wc} />
    : wc.desk.panel === 'player' ? <PlayerPanel wc={wc} bnl={bnl} />
    : wc.desk.panel === 'pickem' ? <PickemPanel wc={wc} scene={scene} />
    : <PicksPanel wc={wc} scene={scene} />;
}

/**
 * The analysis panel box. It is never remounted when the panel changes (that used to make it vanish and
 * re-enter): the box stays, its height and position animate, and the content swaps inside it with the
 * graphic's transition (the rows keep their own approved staggered entrances).
 */
export function DeskPanel({ wc, scene, bnl, left }: { wc: WildcardState | null; scene: Scene; bnl: MatchData | null; left: number }) {
  const tr = useGfxTransition();
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setH(el.offsetHeight);
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div className="absolute" style={{ top: 176 }} initial={false} animate={{ left, width: 1840 - left }} transition={{ duration: tr.ms / 1000, ease: [0.22, 1, 0.36, 1] }}>
      <div className="dk-panel" data-desk-panel={wc?.desk.panel ?? 'none'}
        style={{ position: 'relative', top: 0, left: 0, width: '100%', height: h == null ? undefined : h + 60, transition: `height ${tr.ms}ms cubic-bezier(.22,1,.36,1)` }}>
        <div ref={inner}>
          <Swap k={wc?.desk.panel ?? 'none'} flow><DeskPanelContent wc={wc} scene={scene} bnl={bnl} /></Swap>
        </div>
      </div>
    </motion.div>
  );
}

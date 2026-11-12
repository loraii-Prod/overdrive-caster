import type { CSSProperties, ReactNode } from 'react';
import './wildcard.css';
import { MAJOR_PROFILES, introScreen, majorTeam, normHandle, teamLogo, teamPlayers, type MajorProfile } from '../../../shared/major';
import type { MatchData } from '../../../shared/protocol';
import type { Caster, Show } from '../../../shared/types';
import { PickBadge } from './Desk';
import { countdownText, STARTING_SOON, type WildcardState } from '../../../shared/wildcard';

/** Players the showcase cycles through: every Major player, or one team's. */
export function showcaseList(wc: WildcardState): MajorProfile[] {
  const t = wc.showcase.team;
  const l = t ? MAJOR_PROFILES.filter(p => p.team === t) : MAJOR_PROFILES;
  return l.length ? l : MAJOR_PROFILES;
}

/** Photo for a player: uploaded in the Wildcard tab, else the Players tab photo under the same name. */
export function showcasePhoto(wc: WildcardState, bnl: MatchData | null, handle: string): string {
  const k = normHandle(handle);
  return wc.showcase.photos[k] || Object.values(bnl?.info ?? {}).find(x => normHandle(x.name) === k)?.photo || '';
}

/** One player, full frame: info on the left, photo panel on the right. `kicker` / `corner` vary per use. */
function PlayerSlide({ p, photo, show, now, kicker, corner }: { p: MajorProfile; photo: string; show: Show; now: number; kicker: string; corner?: ReactNode }) {
  const partner = MAJOR_PROFILES.find(x => x.team === p.team && x.handle !== p.handle);
  const cd = countdownText(show.timer.target, now), soon = cd === STARTING_SOON;
  const v = (i: number) => ({ '--i': String(i) }) as CSSProperties;
  return (
    <>
      <div key={`ph-${p.handle}`}>
        <div className="sc-ph">
          {photo ? <img src={photo} alt="" />
            : <><div className="ghost" style={{ fontSize: Math.min(250, Math.floor(620 / (0.46 * Math.max(1, p.handle.length)))) }}>{p.handle}</div><div className="ghost-t">{p.team}</div></>}
        </div>
        <div className="sc-edge" />
      </div>
      {show.timer.target != null && (
        <div className="sc-cd"><span>Match starts in</span><b className={soon ? 'soon' : ''}>{soon ? 'Starting soon' : cd}</b></div>
      )}
      {corner}
      <div key={`l-${p.handle}`} className="sc-l">
        <div className="sc-k" style={v(0)}>{kicker}</div>
        <div className="sc-team" style={v(1)}><b>{p.team}</b><span>{p.how}</span></div>
        <div className="sc-h" style={v(2)}>{p.handle}</div>
        <div className="sc-real" style={v(3)}>
          {[p.name, p.country].filter(Boolean).join(' · ')}{partner && <i> · with {partner.handle}</i>}
        </div>
        <div className="sc-stats" style={v(4)}>
          <div className="sc-stat"><small>Career winnings</small><b className="hot">{p.winnings}</b></div>
          {p.age && <div className="sc-stat"><small>Age</small><b>{p.age}</b></div>}
          <div className="sc-stat"><small>Qualified via</small><b>{p.how.startsWith('Wildcard') ? 'Wildcards' : 'Division 1'}</b></div>
        </div>
        <div className="sc-pal" style={v(5)}>
          <h3>Palmarès</h3>
          {p.results.slice(0, 4).map(([y, place, ev], k) => (
            <div key={k} className="sc-r"><span>{y}</span><b className={place.startsWith('1st') ? 'gold' : ''}>{place}</b><i>{ev}</i></div>
          ))}
        </div>
        <div className="sc-note" style={v(6)}>{p.note}</div>
      </div>
    </>
  );
}

/**
 * Warm-up screen: one Major player at a time, full frame. Info on the left, photo panel on the right.
 * The rotation runs on the server clock, so every source shows the same player at the same moment.
 */
export function WcShowcase({ wc, show, bnl, now }: { wc: WildcardState; show: Show; bnl: MatchData | null; now: number }) {
  const list = showcaseList(wc), period = wc.showcase.seconds * 1000;
  const pinned = wc.showcase.pin ? MAJOR_PROFILES.find(p => normHandle(p.handle) === wc.showcase.pin) : undefined;
  const idx = pinned ? list.indexOf(pinned) : Math.floor(now / period) % list.length;
  const p = pinned ?? list[idx];
  const next = !pinned && list.length > 1 ? list[(idx + 1) % list.length] : null;
  return (
    <div className="wc showcase" style={{ pointerEvents: 'none' }}>
      <PlayerSlide p={p} photo={showcasePhoto(wc, bnl, p.handle)} show={show} now={now}
        kicker={[show.tournament || 'OverDrive', 'Major · Player showcase'].join(' · ')}
        corner={(next || (pinned && list.length > 1)) ? (
          <div className="sc-next">
            <div><span>{idx + 1} / {list.length}</span>{next && <span>Next · <b>{next.handle}</b></span>}</div>
            {next && <div className="sc-bar"><i style={{ width: `${((now % period) / period) * 100}%` }} /></div>}
          </div>
        ) : null} />
    </div>
  );
}

function VsSide({ team, road, side }: { team: string; road: string; side: 'a' | 'b' }) {
  const t = majorTeam(team), players = teamPlayers(team).map(p => p.handle).join(' & ');
  const logo = teamLogo(team);
  return (
    <div className={`vs-side ${side}`}>
      {logo ? <img className="vs-logo" src={logo} alt="" /> : <div className="vs-logo" />}
      <div className="vs-name" style={{ fontSize: Math.min(100, Math.floor(680 / (0.5 * Math.max(1, team.length)))) }}>{team}</div>
      {players && <div className="vs-pl">{players}</div>}
      <div className="vs-road">{road || t?.how || ''}</div>
    </div>
  );
}

/** Match intro on the Warm-up screen: VS, each player in turn, then VS again (held until stopped). */
export function WcIntro({ wc, show, bnl, now, casters = [] }: { wc: WildcardState; show: Show; bnl: MatchData | null; now: number; casters?: Caster[] }) {
  const intro = wc.intro, ph = introScreen(intro, now, !!wc.showcase.pin);
  if (!ph) return null;
  const head = [show.tournament || 'OverDrive', 'Major'].join(' · ');
  if (ph.kind === 'player') {
    const p = ph.profile;
    return (
      <div className="wc showcase" style={{ pointerEvents: 'none' }}>
        <PlayerSlide p={p} photo={showcasePhoto(wc, bnl, p.handle)} show={show} now={now}
          kicker={`${head} · ${intro.a} vs ${intro.b}`}
          corner={
            <div className="sc-next">
              <div><span>Player {ph.n} / {ph.of}</span><span>{ph.side === 'a' ? intro.a : intro.b}</span></div>
              <div className="sc-bar"><i style={{ width: `${((ph.n - 1 + ph.t) / ph.of) * 100}%` }} /></div>
            </div>
          } />
      </div>
    );
  }
  const cd = countdownText(show.timer.target, now), soon = cd === STARTING_SOON;
  return (
    <div className={`wc vs${ph.end ? ' end' : ''}`} style={{ pointerEvents: 'none' }}>
      <div className="vs-pa" /><div className="vs-pb" />
      <div className="vs-top">
        <div className="vs-k">{head}</div>
        <div className="vs-lbl">{intro.label || 'Up next'}</div>
        <div className="vs-bo">Best of {show.bestOf || 5}</div>
      </div>
      <VsSide team={intro.a} road={intro.roadA} side="a" />
      <div className="vs-x">VS</div>
      <VsSide team={intro.b} road={intro.roadB} side="b" />
      {intro.picksShow && casters.some(c => c.enabled && intro.picks[String(c.id)]) && (
        <div className="vs-picks">
          <span>Our casters predict</span>
          {casters.filter(c => c.enabled && intro.picks[String(c.id)]).map(c => (
            <div key={c.id} className="p">{c.name || `Caster ${c.id}`}<PickBadge pick={intro.picks[String(c.id)]} size="sm" /></div>
          ))}
        </div>
      )}
      {show.timer.target != null && <div className="vs-cd"><span>Match starts in</span><b className={soon ? 'soon' : ''}>{soon ? 'Starting soon' : cd}</b></div>}
    </div>
  );
}

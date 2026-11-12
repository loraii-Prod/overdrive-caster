import type { Show } from '../../../shared/types';
import { MAP_CARD_MS, majorMap, mapPhoto } from '../../../shared/maps';
import type { WildcardState } from '../../../shared/wildcard';
import { wcLogo } from '../../../shared/wildcard';
import { MapArt } from './MapArt';
import './wildcard.css';

/**
 * Map switch card (gameplay screen): full frame for MAP_CARD_MS after the producer picks the next map.
 * Left: the country artwork (or the uploaded photo); right: map number, country, map name and author,
 * flag stripe and the series score. Timed on the server clock, so every source shows it together.
 */
export function WcMapCard({ wc, show, now }: { wc: WildcardState; show: Show; now: number }) {
  const m = majorMap(wc.map.id), at = wc.map.at;
  if (!m || at == null) return null;
  const t = now - at;
  if (t < 0 || t > MAP_CARD_MS) return null;
  const leaving = t > MAP_CARD_MS - 650;
  const photo = mapPhoto(m.id, wc.mapPhotos);
  const A = show.teamA, B = show.teamB;
  const team = (x: typeof A) => (
    <span className="mc-team">{(wcLogo(x.name) || x.logo) && <img src={wcLogo(x.name) || x.logo} alt="" />}<b>{x.name || x.tag}</b></span>
  );
  return (
    <div className="wc" style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div key={at} className={`mc ${leaving ? 'out' : 'in'}`} style={{ ['--mc' as string]: m.accent }}>
        <div className="mc-art">{photo ? <img src={photo} alt="" /> : <MapArt id={m.id} />}</div>
        <div className="mc-panel">
          <div className="mc-k">Map {show.game}{show.bestOf ? <span> · Best of {show.bestOf}</span> : null}</div>
          <div className="mc-flag">{m.flag.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
          <h2>{m.country}</h2>
          <div className="mc-t">{m.title}</div>
          <div className="mc-a">by {m.author}</div>
          {A.name && B.name && (
            <div className="mc-series">
              {team(A)}<em>{A.score}<small>–</small>{B.score}</em>{team(B)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

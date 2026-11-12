import { useRef } from 'react';
import { Reveal } from '../Reveal';
import type { CSSProperties } from 'react';
import './wildcard.css';
import { twVisible, type TwitchPublic, type TwShow } from '../../../shared/twitch';
import type { ScreenId } from '../../../shared/types';

const fmt = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const n = (v: number) => v.toLocaleString('en-US');

/** Twitch prediction or poll card, in the overlay style. Shows only while one is running or just finished. */
export function TwitchCard({ tw, now, style, compact = false }: { tw: TwitchPublic | null | undefined; now: number; style: CSSProperties; compact?: boolean }) {
  const v = twVisible(tw, now);
  if (!v) return null;
  if (v.kind === 'prediction') {
    const p = v.p, total = p.outcomes.reduce((a, o) => a + o.points, 0) || 1;
    const state = p.status === 'ACTIVE' ? (p.endsAt ? `Closes in ${fmt(p.endsAt - now)}` : 'Open') : p.status === 'LOCKED' ? 'Locked' : 'Result';
    return (
      <div className="wc" style={{ pointerEvents: 'none' }}>
        <div key={p.id} className={`tw in${compact ? ' compact' : ''}`} style={style}>
          <div className="tw-top"><span className="tw-k">Prediction</span><span className="tw-s">{state}</span></div>
          <div className="tw-q">{p.title}</div>
          {p.outcomes.map(o => {
            const pct = Math.round((o.points / total) * 100), win = p.status === 'RESOLVED' && p.winner === o.id;
            return (
              <div key={o.id} className={`tw-o${win ? ' win' : ''}${p.status === 'RESOLVED' && !win ? ' lose' : ''}`}>
                <i style={{ width: `${pct}%` }} />
                <span>{win ? '✓ ' : ''}{o.title}</span><b>{pct}%</b>
                <small>{n(o.points)} pts · {n(o.users)} {o.users === 1 ? 'viewer' : 'viewers'}</small>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  const p = v.p, total = p.choices.reduce((a, c) => a + c.votes, 0) || 1, top = Math.max(...p.choices.map(c => c.votes));
  const state = p.status === 'ACTIVE' ? (p.endsAt ? `Ends in ${fmt(p.endsAt - now)}` : 'Open') : 'Result';
  return (
    <div className="wc" style={{ pointerEvents: 'none' }}>
      <div key={p.id} className={`tw in${compact ? ' compact' : ''}`} style={style}>
        <div className="tw-top"><span className="tw-k">Poll</span><span className="tw-s">{state}</span></div>
        <div className="tw-q">{p.title}</div>
        {p.choices.map(c => {
          const pct = Math.round((c.votes / total) * 100), lead = c.votes === top && c.votes > 0;
          return (
            <div key={c.id} className={`tw-o${lead && p.status !== 'ACTIVE' ? ' win' : ''}`}>
              <i style={{ width: `${pct}%` }} />
              <span>{c.title}</span><b>{pct}%</b>
              <small>{n(c.votes)} {c.votes === 1 ? 'vote' : 'votes'}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Where the card sits on each screen (free corners of each layout). */
const PLACE: Partial<Record<ScreenId, { key: keyof TwShow; style: CSSProperties; compact?: boolean }>> = {
  gameplay: { key: 'gameplay', style: { right: 40, top: 340, width: 440 } },
  // above the camera frames (they start at y≈308), compact so two outcomes fit
  casters: { key: 'casters', style: { left: 72, top: 112, width: 440 }, compact: true },
  warmup: { key: 'warmup', style: { right: 56, top: 150, width: 440 } },
  starting: { key: 'intermission', style: { right: 60, top: 120, width: 420 } },
  brb: { key: 'intermission', style: { right: 60, top: 120, width: 420 } },
  ending: { key: 'intermission', style: { right: 60, top: 120, width: 420 } },
};

/** The card for a program screen, if that screen is switched on in the Twitch settings. */
export function TwitchOnScreen({ tw, id, now }: { tw: TwitchPublic | null | undefined; id: ScreenId; now: number }) {
  const pl = PLACE[id];
  const on = !!(tw && pl && tw.show[pl.key] && twVisible(tw, now));
  // Keep the last card on while it animates out.
  const last = useRef<{ tw: TwitchPublic; now: number } | null>(null);
  if (on && tw) last.current = { tw, now };
  const card = on && tw ? { tw, now } : last.current;
  return <Reveal show={on} from="right">{card && pl && <TwitchCard tw={card.tw} now={card.now} style={pl.style} compact={pl.compact} />}</Reveal>;
}

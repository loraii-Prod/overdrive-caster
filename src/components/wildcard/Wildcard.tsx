import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './wildcard.css';
import {
  GRAND_FINAL, STARTING_SOON, WC_IDS, WC_PARTS, realTeam, WC_QUALIFIERS, WC_TEAMS, WINS_NEEDED, castId, colTime, countdownText, doneList, matchName, matchStart,
  nextFrom, nextMatchId, wcLayout, wcLogo, wcResolve, type WcPop, type WcResolved, type WildcardState,
} from '../../../shared/wildcard';

/**
 * OverDrive Wildcard 2026 graphics, ported 1:1 from the standalone overlay (same markup and
 * stylesheet, see wildcard.css). Every component draws on the 1920×1080 output canvas.
 */

const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Img({ name }: { name: string | null }) {
  const src = wcLogo(name);
  return src ? <img src={src} alt="" /> : null;
}

/** Countdown digits in fixed-width slots so the clock doesn't jiggle (the display font has proportional digits). */
function CdText({ text }: { text: string }) {
  if (!/^[\d:]+$/.test(text)) return <>{text}</>;
  return <>{text.split('').map((c, i) => <i key={i} className={c === ':' ? 'cd-col' : 'cd-num'}>{c}</i>)}</>;
}

// ===================================================================== bracket

function Row({ name, score, r, hint, c, i }: { name: string | null; score: string; r: WcResolved; hint: string; c: number; i: number }) {
  const v = vars({ '--c': String(c), '--r': String(i) });
  if (!name) return <div className="row tbd" style={v}><span className="seed" /><span className="name">{hint || 'To be decided'}</span></div>;
  if (name === 'BYE') return <div className="row bye" style={v}><span className="seed" /><span className="name">Bye</span></div>;
  let sc = score;
  if (!sc && r.winner === name && r.loser === 'BYE') sc = 'W';
  return (
    <div className={cls('row', r.winner === name ? 'win' : r.loser === name && 'lose')} style={v}>
      <span className="seed">{WC_TEAMS[name]?.seed ?? ''}</span>
      <span className="logo"><Img name={name} /></span>
      <span className="name">{name}</span>
      <span className="score"><i key={sc} className="pop">{sc}</i></span>
    </div>
  );
}

/** One part of the bracket (1 = upper, 2 = lower + the four qualified teams). */
export function WcStage({ wc, part, enter = false, pin }: { wc: WildcardState; part: 1 | 2; enter?: boolean; pin?: string | null }) {
  const P = WC_PARTS[part], R = wcResolve(wc.matches, wc.teams), pos = wcLayout(part), o = wc.opts, cast = castId(wc, R, pin);
  const box = `rgba(33,26,24,${o.opacity / 100})`;
  return (
    <div className={cls('stage', 'mj', `p${part}`, o.bg && 'bg', enter && 'enter', !o.title && 'hide-title', !o.times && 'hide-times', !o.seeds && 'hide-seeds')}
      style={vars({ '--box': box, '--box-dim': box })}>
      <div className="hdr"><h1>{P.title}</h1></div>
      <div className="dash" />
      {P.cols.map(col => <div key={col.name} className="colh" style={{ left: col.x, top: Math.min(...col.ids.map(id => pos[id].y)) - 40, width: col.w }}>{col.name}</div>)}
      {part === 2 && (
        <div className="qcol" style={{ left: 1600, top: 290 }}>
          <div className="qt">Final standings</div>
          {([[GRAND_FINAL, 'winner', 'Grand final winner'], [GRAND_FINAL, 'loser', 'Grand final loser'], ['R4_LB1', 'loser', 'Lower final loser'], ['R3_LB1', 'loser', 'Lower semi-final loser']] as const).map(([id, k, open], i) => {
            const w = R[id][k];
            return realTeam(w)
              ? <div key={i} className="qi"><span className="n">{i + 1}</span><Img name={w} /><b>{w}</b></div>
              : <div key={i} className="qi open"><span className="n">{i + 1}</span><b>{open} · TBD</b></div>;
          })}
        </div>
      )}
      {Object.entries(pos).map(([id, p]) => {
        const st = wc.matches[id], r = R[id], col = P.cols[p.c];
        const live = st.live && !r.winner, onCast = cast === id;
        const t = colTime(wc, col.ids);
        return (
          <div key={id} className={cls('match', col.major && 'major', live && 'is-live')} style={{ left: p.x, top: p.y, width: p.w }}>
            {(live || onCast) && (
              <span className={cls('live', onCast && 'oncast', !live && 'nolive')}>{live ? 'Live' : ''}{live && onCast ? ' · ' : ''}{onCast ? 'On cast' : ''}</span>
            )}
            {col.major && <span className="qual">Champion<small>OverDrive Major</small></span>}
            {!t && st.time && <span className="mtime">{st.time} CET</span>}
            <Row name={r.t1} score={st.s1} r={r} hint={r.hints[0]} c={p.c} i={0} />
            <Row name={r.t2} score={st.s2} r={r} hint={r.hints[1]} c={p.c} i={1} />
          </div>
        );
      })}
    </div>
  );
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The bracket as it goes on air: follows the part on air (or `pin`), and slides the parts across
 * when it changes (Part 2 comes in from the right, Part 1 from the left), as the old overlay did.
 */
export function WcBracket({ wc, part, pin }: { wc: WildcardState; part: 1 | 2; pin?: string | null }) {
  const [v, setV] = useState<{ cur: 1 | 2; prev: 1 | 2 | null; n: number }>({ cur: part, prev: null, n: 0 });
  const curRef = useRef<HTMLDivElement>(null), prevRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (part !== v.cur) setV(x => ({ cur: part, prev: x.cur, n: x.n + 1 })); }, [part]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (v.prev == null) return;
    const a = prevRef.current, b = curRef.current;
    if (!a || !b || !b.animate || reducedMotion()) { setV(x => ({ ...x, prev: null })); return; }
    const dir = v.cur > v.prev ? -1 : 1, w = 1920;
    const opts: KeyframeAnimationOptions = { duration: 750, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
    const out = a.animate([{ translate: '0 0' }, { translate: `${dir * w}px 0` }], opts);
    const inn = b.animate([{ translate: `${-dir * w}px 0` }, { translate: '0 0' }], opts);
    inn.onfinish = () => { out.cancel(); inn.cancel(); setV(x => ({ ...x, prev: null })); };
    return () => { out.cancel(); inn.cancel(); };
  }, [v.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wc">
      {v.prev != null && <div key={`s${v.n - 1}`} ref={prevRef} className="sliding" style={{ position: 'absolute', inset: 0, willChange: 'translate' }}><WcStage wc={wc} part={v.prev} enter={v.n - 1 === 0} pin={pin} /></div>}
      <div key={`s${v.n}`} ref={curRef} style={{ position: 'absolute', inset: 0 }}><WcStage wc={wc} part={v.cur} enter={v.n === 0} pin={pin} /></div>
    </div>
  );
}

// ============================================================ gameplay popups

const HOLD = { map: 8000, match: 11000, clear: 0 };

function TeamRow({ name, score, c }: { name: string; score: string; c: string }) {
  return <div className={cls('r', c)}><span className="logo"><Img name={name} /></span><span className="name">{name}</span><span className="score">{score}</span></div>;
}

/** The popup card for one event (values frozen at the moment it happened). */
export function WcPopCard({ pop: e, out = false }: { pop: WcPop; out?: boolean }) {
  const ctx = matchName(e.id) + (WC_QUALIFIERS.has(e.id) ? ' · OverDrive Major' : '');
  const anim = out ? 'out' : 'in';
  if (e.kind === 'map') {
    const s1 = parseInt(e.s1, 10) || 0, s2 = parseInt(e.s2, 10) || 0, mapNo = s1 + s2;
    const who = e.side === 1 ? e.t1 : e.t2;
    const lead = s1 === s2 ? `Series tied ${s1}–${s2}` : `${s1 > s2 ? e.t1 : e.t2} lead ${Math.max(s1, s2)}–${Math.min(s1, s2)}`;
    const point = [s1, s2].some(x => x === WINS_NEEDED - 1) ? (s1 === s2 ? 'Decider next' : 'Match point') : '';
    const update = e.side === 0 || e.jump > 1;
    return (
      <div className={cls('gp gp-map', anim)}>
        <div className="tag">{update ? <><small>After map {mapNo}</small><b>Score</b></> : <><small>Map {mapNo}</small><b>Won</b></>}</div>
        <div className="body">
          <div className="ctx">{ctx}</div>
          <div className="rows">
            <TeamRow name={e.t1} score={e.s1 || '0'} c={e.side === 1 ? 'up' : ''} />
            <TeamRow name={e.t2} score={e.s2 || '0'} c={e.side === 2 ? 'up' : ''} />
          </div>
          <div className="line">{update ? 'Score update' : `Map ${mapNo} to ${who}`} · {lead}{point && <> · <em>{point}</em></>}</div>
        </div>
      </div>
    );
  }
  const W = e.winner ?? e.t1, L = e.loser ?? e.t2, wo = e.s1 === 'W' || e.s2 === 'W';
  const wn = nextFrom(e.id, 'w'), ln = nextFrom(e.id, 'l');
  let fate: ReactNode;
  if (WC_QUALIFIERS.has(e.id)) fate = <><em>{W} win the OverDrive Major</em> · {L} finish 2nd</>;
  else fate = <>{W} advance to {wn ? matchName(wn) : 'the next round'} · {ln ? `${L} drop to the lower bracket` : <em>{L} are eliminated</em>}</>;
  const a = W === e.t1 ? e.s1 : e.s2, b = W === e.t1 ? e.s2 : e.s1;
  return (
    <div className={cls('gp gp-match', anim)}>
      <div className="tag"><small>{wo ? 'Walkover' : 'Match over'}</small><b>{a}–{b}</b></div>
      <div className="body">
        <div className="ctx">{ctx}</div>
        <div className="rows">
          <TeamRow name={e.t1} score={e.s1} c={W === e.t1 ? 'up' : 'down'} />
          <TeamRow name={e.t2} score={e.s2} c={W === e.t2 ? 'up' : 'down'} />
        </div>
        <div className="line">{fate}</div>
      </div>
    </div>
  );
}

/**
 * Gameplay scene: a popup top-left when a map is won or a match ends. Events come from the server
 * (detected once there); only the ones that arrive while this is on screen are shown, one after another.
 */
export function WcPopups({ pop }: { pop: WcPop | null }) {
  const seen = useRef<WcPop | null>(pop);
  const queue = useRef<WcPop[]>([]);
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const [cur, setCur] = useState<{ pop: WcPop; out: boolean } | null>(null);
  const next = () => {
    if (busy.current || !queue.current.length) return;
    busy.current = true;
    const p = queue.current.shift()!, hold = HOLD[p.kind];
    setCur({ pop: p, out: false });
    timers.current.push(window.setTimeout(() => setCur(c => (c ? { ...c, out: true } : c)), hold));
    timers.current.push(window.setTimeout(() => { setCur(null); busy.current = false; next(); }, hold + 500));
  };
  useEffect(() => {
    if (!pop || pop === seen.current) return;
    seen.current = pop;
    if (pop.kind === 'clear') {
      queue.current = []; timers.current.forEach(t => clearTimeout(t)); timers.current = [];
      setCur(c => (c ? { ...c, out: true } : c));
      timers.current.push(window.setTimeout(() => { setCur(null); busy.current = false; }, 500));
      return;
    }
    queue.current.push(pop);
    next();
  }, [pop]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(t => clearTimeout(t)), []);
  return <div className="wc gameplay"><div className="gp-stage">{cur && <WcPopCard key={cur.pop.seq} pop={cur.pop} out={cur.out} />}</div></div>;
}

// ============================================================= waiting screen

function Splash({ wc, R }: { wc: WildcardState; R: Record<string, WcResolved> }) {
  const list = doneList(wc);
  const key = list.join();
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(list);
  const [shown, setShown] = useState<{ id: string; label: string; n: number } | null>(() => (list[0] ? { id: list[0], label: 'Latest result', n: 0 } : null));
  const [hiding, setHiding] = useState(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    // A brand-new result interrupts with "Just in"; otherwise the latest result stays up.
    const fresh = list.find(id => !seen.current!.has(id));
    list.forEach(id => seen.current!.add(id));
    const cur = shownRef.current;
    let target: { id: string; label: string } | null = null;
    if (fresh) target = { id: fresh, label: 'Just in' };
    else if (list.length && (!cur || !list.includes(cur.id))) target = { id: list[0], label: 'Latest result' };
    else if (!list.length && cur) target = null;
    else return;
    clearTimeout(timer.current);
    if (!cur) { if (target) setShown({ ...target, n: 0 }); return; }
    setHiding(true);
    timer.current = window.setTimeout(() => { setHiding(false); setShown(target ? { ...target, n: cur.n + 1 } : null); }, 550);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!shown) return <div className="splash" />;
  const id = shown.id, r = R[id], st = wc.matches[id];
  if (!r?.winner || !r.t1 || !r.t2) return <div key={shown.n} className={cls('splash', hiding ? 'hide' : 'show')} />;
  const w1 = r.winner === r.t1, num = /^\d+$/.test(st.s1 || '') && /^\d+$/.test(st.s2 || '');
  const ln = nextFrom(id, 'l');
  const note = (num ? '' : `${r.winner} win by forfeit · `) + (WC_QUALIFIERS.has(id) ? `${r.winner} win the OverDrive Major` : ln ? `${r.loser} drop to the lower bracket` : `${r.loser} are eliminated`);
  return (
    <div key={shown.n} className={cls('splash', hiding ? 'hide' : 'show')}>
      <div className="in-wrap">
        <div className="top"><span className="lbl">{shown.label}</span><span className="rd">{matchName(id)}</span></div>
        <div className="res">
          {wcLogo(r.t1) ? <Img name={r.t1} /> : <span />}
          <span className={cls('a', !w1 && 'dim')}>{r.t1}</span>
          <span className="sc">{num ? `${st.s1}–${st.s2}` : 'FF'}</span>
          <span className={cls('b', w1 && 'dim')}>{r.t2}</span>
          {wcLogo(r.t2) ? <Img name={r.t2} /> : <span />}
        </div>
        <div className="note">{note}</div>
      </div>
    </div>
  );
}

/**
 * Waiting screen, laid out on the Overdrive Start/BRB/End panels: title (top panel), the live or next
 * match with a countdown (middle panel), the latest result in the bottom bar.
 * `timer`: a manual countdown target (the show's countdown); without one it counts down to the match start.
 */
/** Matches screen for the Major: up next (live first) and latest results, straight from the bracket. */
export function WcMatchesBoard({ wc, pin }: { wc: WildcardState; pin?: string | null }) {
  const R = wcResolve(wc.matches, wc.teams), cast = castId(wc, R, pin);
  const open = WC_IDS.filter(id => !R[id].winner && (realTeam(R[id].t1) || realTeam(R[id].t2)))
    .sort((a, b) => (Number(wc.matches[b].live) - Number(wc.matches[a].live)) || (Number(b === cast) - Number(a === cast)) || (WC_IDS.indexOf(a) - WC_IDS.indexOf(b)))
    .slice(0, 5);
  const done = doneList(wc).slice(0, 5);
  const card = (id: string, result: boolean, n = 0) => {
    const r = R[id], st = wc.matches[id];
    const status = result ? 'Final' : st.live ? '● Live' : id === cast ? 'On cast' : st.time ? `${st.time} CET` : 'Up next';
    const side = (k: 1 | 2) => {
      const name = k === 1 ? r.t1 : r.t2, sc = k === 1 ? st.s1 : st.s2;
      const cls2 = cls('mb-team', k === 2 && 'rt', result && r.winner === name && 'win', result && r.loser === name && 'lose', !realTeam(name) && 'tbd');
      return (
        <div className={cls2}>
          {realTeam(name) && <span className="logo"><Img name={name} /></span>}
          <b>{realTeam(name) ? name : r.hints[k - 1] || 'TBD'}</b>
          {(result || st.live || sc) && <i key={sc || '0'} className="pop">{sc || '0'}</i>}
        </div>
      );
    };
    return (
      <div key={id} className={cls('mb-card', st.live && !result && 'is-on', id === cast && !result && 'cast')} style={vars({ '--i': String(n + (result ? 1 : 0)) })}>
        <div className="mb-top"><span>{matchName(id)}</span><em>{status}</em></div>
        <div className="mb-row">{side(1)}<span className="mb-vs">VS</span>{side(2)}</div>
      </div>
    );
  };
  return (
    <div className="wc">
      <div className="mb">
        <h1>OverDrive Major</h1>
        <section style={{ left: 60 }}><h2>Up next</h2>{open.length ? open.map((id, n) => card(id, false, n)) : <div className="mb-empty">{done.length ? 'All matches played' : 'Set the first round in the Major tab'}</div>}</section>
        <section style={{ left: 990 }}><h2>Results</h2>{done.length ? done.map((id, n) => card(id, true, n)) : <div className="mb-empty">No results yet</div>}</section>
      </div>
    </div>
  );
}

export function WcWaiting({ wc, now, title, timer, pin }: { wc: WildcardState; now: number; title: string; timer: number | null; pin?: string | null }) {
  const R = wcResolve(wc.matches, wc.teams), next = nextMatchId(wc, R, pin);
  let body: ReactNode = null;
  if (next) {
    const st = wc.matches[next], onCast = castId(wc, R, pin) === next;
    const at = timer ?? (!st.live ? matchStart(st) : null);
    const txt = countdownText(at, now), soon = txt === STARTING_SOON;
    body = (
      <>
        <div className={cls('lbl', st.live && 'on-air')}>{st.live ? 'Live now' : 'Up next'}{onCast ? ' · On cast' : ''}</div>
        <div className="line"><Img name={R[next].t1} /><span>{R[next].t1}</span><span className="vs">vs</span><span>{R[next].t2}</span><Img name={R[next].t2} /></div>
        <div className="sub">{matchName(next)}{!st.live && st.time ? ` · ${st.time} CET` : ''}</div>
        {at != null && (
          <div className={cls('cdwrap', soon && 'is-soon')}><span className="cdl">Starts in</span><span className={cls('cd', soon && 'soon')} data-at=""><CdText text={txt} /></span></div>
        )}
      </>
    );
  }
  return (
    <div className="wc waiting">
      <div className="gp-stage">
        <div className="wv-title">{title}</div>
        <div className="ws2 next">{body}</div>
        <Splash wc={wc} R={R} />
      </div>
    </div>
  );
}

// ============================================================== casters card

/** Casters booth: live or next match with a countdown, bottom-left above the bottom bar. */
export function WcCasters({ wc, now, pin }: { wc: WildcardState; now: number; pin?: string | null }) {
  const R = wcResolve(wc.matches, wc.teams), id = nextMatchId(wc, R, pin);
  let card: ReactNode = null;
  if (id) {
    const st = wc.matches[id], r = R[id], at = matchStart(st), onCast = castId(wc, R, pin) === id;
    const txt = countdownText(at, now), soon = txt === STARTING_SOON;
    card = (
      <div key={`${id}|${st.live}|${onCast}|${r.t1}|${r.t2}`} className="cs in">
        <div className="cs-top"><span className={cls('cs-lbl', st.live && 'on-air')}>{st.live ? 'Live now' : 'Up next'}{onCast ? ' · On cast' : ''}</span><span className="cs-rd">{matchName(id)}</span></div>
        <div className="cs-teams"><Img name={r.t1} /><b>{r.t1}</b><i>vs</i><b>{r.t2}</b><Img name={r.t2} /></div>
        {!st.live && at != null && (
          <div className={cls('cs-cd', soon && 'is-soon')}><span>Starts in</span><b className={cls(soon && 'soon')} data-at=""><CdText text={txt} /></b></div>
        )}
      </div>
    );
  }
  return <div className="wc waiting casters"><div className="gp-stage">{card}</div></div>;
}

/**
 * Audience graphics (Pick'ems + Community MVP + QR), native 1920×1080, in the approved Overdrive identity (fire loop,
 * WC Anton / WC Montserrat, orange underline accents). They draw only what the producer published: desk picks up to
 * the published reveal step, community splits only once a match is locked, MVP winners only from the result frozen
 * when voting closed. Anything not ready draws nothing rather than a guess.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GfxInstance } from '../../shared/gfx';
import { communityPick, pcts, teamRoster, type AudPlayer, type AudPoll, type MvpCard } from '../../shared/audience';
import { matchName, wcResolve } from '../../shared/wildcard';
import { normHandle, teamLogo } from '../../shared/major';
import { BgVideo } from '../components/Brand';
import { hiRes, outputScale } from '../../shared/assetRes';
import { DEFAULT_FRAME, fitPortrait, portraitKey, type PortraitFrame } from '../../shared/portraits';
import { Qr } from '../components/Qr';
import type { GfxData } from './Graphic';
import '../components/wildcard/wildcard.css';
import './audience.css';

type Cfg = GfxInstance['config'];
type R = (p: { cfg: Cfg; d: GfxData }) => ReactNode;

const Logo = ({ team, size }: { team: string; size: number }) => { const s = teamLogo(team); return s ? <img className="logo" src={s} alt="" style={{ width: size, height: size }} /> : null; };
const short = (t: string) => (t === 'FUT Esports' ? 'FUT' : t === 'Natus Vincere' ? 'NAVI' : t === 'All Gamers Global' ? 'AG' : t);

function matchOf(cfg: Cfg, d: GfxData) {
  const wc = d.wc?.state;
  if (!wc) return null;
  const id = String(cfg.match || wc.cast || '');
  const r = id ? wcResolve(wc.matches, wc.teams)[id] : undefined;
  if (!r || !r.t1 || !r.t2) return null;
  const st = wc.matches[id];
  return { id, a: r.t1, b: r.t2, winner: r.winner, s1: st.s1, s2: st.s2, label: matchName(id), cast: wc.cast === id };
}
const nameOf = (d: GfxData, slot: string) => d.scene.casters.find(c => String(c.id) === slot)?.name || `Position ${slot}`;
const roleOf = (slot: string) => (Number(slot) >= 4 ? 'Analyst' : 'Caster');

function Head({ kick, title, sub }: { kick: string; title?: string; sub?: string }) {
  return <div className="aud-head"><div className="kick">{kick}</div>{title && <div className="h1">{title}</div>}{sub && <div className="sub">{sub}</div>}</div>;
}

// ------------------------------------------------------------------ Pick'ems: match prediction

const pickem: R = ({ cfg, d }) => {
  const m = matchOf(cfg, d);
  if (!m) return null;
  const wc = d.wc!.state, step = String(cfg.step || 'intro');
  const picks = (m.cast ? wc.intro.picks : wc.pickem[m.id]) ?? {};
  const desk = Object.entries(picks).filter(([, p]) => p.team === m.a || p.team === m.b).sort(([x], [y]) => Number(x) - Number(y)).slice(0, 4);
  const shown = /^d(\d)$/.test(step) ? Number(step.slice(1)) : step === 'intro' ? 0 : desk.length;
  const community = step === 'community' || step === 'verdict';
  const tot = d.aud?.matches.find(x => x.id === m.id);
  const nA = desk.slice(0, shown).filter(([, p]) => p.team === m.a).length, nB = desk.slice(0, shown).filter(([, p]) => p.team === m.b).length;
  const split = tot ? pcts([tot.byTeam[m.a] ?? 0, tot.byTeam[m.b] ?? 0]) : null;
  const scores = tot ? Object.entries(tot.byScore).sort((x, y) => y[1] - x[1]).slice(0, 5) : [];
  const cp = tot && communityPick(tot);
  const dTeam = nA > nB ? m.a : nB > nA ? m.b : null;
  const verdict = step === 'verdict' && cp ? (dTeam === cp.team ? { small: 'Desk & community', big: `Both back ${cp.team}` } : dTeam ? { small: 'Split', big: `Desk ${short(dTeam)} · Community ${short(cp.team)}` } : { small: 'Community backs', big: cp.team }) : null;
  return (
    <div className="aud">
      <BgVideo />
      <div className="aud-dim" />
      <Head kick="Pick'ems · Staff vs Community" title={String(cfg.title || 'Who takes it?')} sub={`${m.label} · Best of 5`} />
      <div className="mp-match">
        <div className="mp-team ul"><Logo team={m.a} size={62} /><b>{m.a}</b></div><div className="vs">VS</div>
        <div className="mp-team ul2"><b>{m.b}</b><Logo team={m.b} size={62} /></div>
      </div>
      <div className="mp-cols">
        <div>
          <div className="colh"><div className="h2">The desk</div><div className="tag">{shown ? (nA === nB ? `${nA} – ${nB}` : `${Math.max(nA, nB)} – ${Math.min(nA, nB)} for ${short(nA > nB ? m.a : m.b)}`) : 'Picks sealed'}</div></div>
          {desk.length === 0 && <div className="an-empty">No desk picks entered</div>}
          {desk.map(([slot, p], i) => (
            <div className="an" key={slot}>
              <div className="who"><b>{nameOf(d, slot)}</b><span>{roleOf(slot)}</span></div>
              {i < shown ? <div className="pick rev" key="r"><Logo team={p.team} size={58} /><b>{p.score || short(p.team)}</b></div> : <div className="pick hidden" key="h"><b>?</b></div>}
            </div>
          ))}
        </div>
        <div>
          <div className="colh"><div className="h2">The community</div><div className="tag">{community && tot ? `${tot.total.toLocaleString('en-US')} picks` : tot ? 'Voting closed' : 'Voting open'}</div></div>
          {community && tot && split ? (
            <div className="panel cm" key="cm">
              <div className="meta"><span>Winner</span><span>{tot.total.toLocaleString('en-US')} picks</span></div>
              <div className="split"><div className="a" style={{ ['--w' as string]: `${Math.max(split[0], 12)}%` }}><Logo team={m.a} size={54} /><b>{split[0]}%</b></div><div className="b"><b>{split[1]}%</b><Logo team={m.b} size={54} /></div></div>
              {scores.length > 0 && <><div className="meta"><span>Most picked scores</span><span /></div>
                <div className="scores">{scores.map(([k, n], i) => { const sp = k.lastIndexOf(' '); return <div key={k} className={i === 0 ? 'top' : ''} style={{ animationDelay: `${300 + i * 70}ms` }}><small>{short(k.slice(0, sp))}</small><b>{k.slice(sp + 1)}</b><em>{Math.round((n / Math.max(1, tot.total)) * 100)}%</em></div>; })}</div></>}
            </div>
          ) : <div className="panel cm locked" key="lk"><div className="h2 big">{tot ? 'Results locked' : 'Voting open'}</div><div className="sub">{tot ? 'Revealed after the desk' : 'Picks close when the match starts'}</div></div>}
        </div>
      </div>
      {verdict && <div className="verdict"><small>{verdict.small}</small>{verdict.big}</div>}
    </div>
  );
};

// ------------------------------------------------------------------ Community MVP

/** The frozen winner(s) of a poll: null until voting has closed. */
function mvpResult(p: AudPoll | undefined) {
  if (!p?.frozen) return null;
  const rows = p.players.map(x => ({ ...x, n: p.frozen!.counts[x.handle] ?? 0 })).sort((a, b) => b.n - a.n);
  const share = pcts(rows.map(r => r.n));
  const out = rows.map((r, i) => ({ ...r, pct: share[i] }));
  const top = out.filter(r => r.n === out[0].n && r.n > 0);
  return { total: p.frozen.total, rows: out, top };
}

// Portraits: the Studio asset library's photo for the player (same association as the player showcase), preloaded
// and measured before the reveal plays so it never pops in half-loaded.
interface PInfo { url: string; w: number; h: number; cutout: boolean }
const pcache = new Map<string, Promise<PInfo | null>>(), pdone = new Map<string, PInfo | null>();
function preload(url: string): Promise<PInfo | null> {
  let p = pcache.get(url);
  if (!p) {
    p = new Promise<PInfo | null>(res => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = async () => {
        try { await im.decode(); } catch { /* already decoded */ }
        // Cut-out = transparent border (a portrait with its background removed); otherwise it is framed.
        let cutout = false;
        try {
          const c = document.createElement('canvas'), n = 48; c.width = n; c.height = n;
          const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(im, 0, 0, n, n);
          const px = g.getImageData(0, 0, n, n).data; let clear = 0, edge = 0;
          for (let i = 0; i < n; i++) for (const [x, y] of [[i, 0], [0, i], [n - 1, i]]) { edge++; if (px[(y * n + x) * 4 + 3] < 24) clear++; }
          cutout = clear / edge > 0.6;
        } catch { /* cross-origin: framed */ }
        const info = { url, w: im.naturalWidth, h: im.naturalHeight, cutout };
        pdone.set(url, info); res(info);
      };
      im.onerror = () => { pdone.set(url, null); res(null); };
      im.src = url;
    });
    pcache.set(url, p);
  }
  return p;
}
function usePortraits(urls: string[]) {
  const [, bump] = useState(0);
  const [late, setLate] = useState(false);
  const key = urls.join('|');
  useEffect(() => {
    let on = true;
    setLate(false);
    Promise.all(urls.map(preload)).then(() => on && bump(n => n + 1));
    const t = setTimeout(() => on && setLate(true), 1500); // a portrait that never answers: play with the fallback
    return () => { on = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ready: late || urls.every(u => pdone.has(u)), info: (u: string | null) => (u ? pdone.get(u) ?? null : null) };
}
const portraitUrl = (d: GfxData, handle: string) => d.wc?.state.showcase.photos[normHandle(handle)] || '';

const frameOf = (d: GfxData, handle: string): PortraitFrame => d.wc?.state.showcase.frames?.[portraitKey(handle)] ?? DEFAULT_FRAME;

/**
 * A player portrait in a box, the same way on every MVP graphic: the producer's framing (zoom / position), cut-outs
 * standing on the bottom edge, photos covering the frame from the top. Never drawn larger than 1.25 device px per
 * source px (2 device px per layout unit at 4K): a small file is drawn smaller, never stretched.
 */
function PortraitImg({ info, box, frame, mirror, className = '', scale }: { info: PInfo; box: { w: number; h: number }; frame: PortraitFrame; mirror?: boolean; className?: string; /** device scale override (Studio preview of a 4K show) */ scale?: number }) {
  const f = fitPortrait({ w: info.w, h: info.h, cutout: info.cutout }, box, frame, scale ?? outputScale());
  const W = info.cutout ? box.w : f.frameW, H = info.cutout ? box.h : f.frameH;
  return (
    <div className={`mv-box ${info.cutout ? 'cut' : 'photo'} ${className}`} style={{ width: W, height: H }} data-portrait-fit={f.capped ? 'capped' : 'native'} data-portrait-upscale={f.upscale.toFixed(2)}>
      <img src={info.url} alt="" decoding="async" draggable={false}
        style={{ position: 'absolute', left: f.left, top: info.cutout ? f.top : f.top, width: f.w, height: f.h, maxWidth: 'none', transform: mirror ? 'scaleX(-1)' : undefined }} />
    </div>
  );
}

/** Large portrait (reveals, comparison): cut-out in the whole box; a photo in a 3:4 frame of at most frameW. */
function Portrait({ info, team, box, mirror, frameW = 640, frame = DEFAULT_FRAME, scale }: { info: PInfo | null; team: string; box: { w: number; h: number }; mirror?: boolean; frameW?: number; frame?: PortraitFrame; scale?: number }) {
  // Fallback: the team mark, kept small enough that today's 64 px logos are not blown up (larger once the official
  // vector logos are approved), under the outlined MVP.
  if (!info) return <div className="mv-fb" style={{ width: box.w, height: box.h }}><Logo team={team} size={Math.min(160, box.w * 0.25)} /><div className="mv-fbx">MVP</div></div>;
  if (info.cutout) return <PortraitImg info={info} box={box} frame={frame} mirror={mirror} className="mv-cutbox" scale={scale} />;
  const fw = Math.min(box.w, box.h * 0.75, frameW);
  return <div className="mv-frame"><PortraitImg info={info} box={{ w: fw, h: fw / 0.75 }} frame={frame} scale={scale} /></div>;
}

/**
 * Studio: one portrait exactly as a graphic draws it (same component, same CSS, same fit), at a chosen device scale
 * (2 = what a 4K show puts on air). Laid out on the 1920-grid size of its part of the graphic.
 */
export function PortraitPreview({ url, handle, team, frame, kind, scale }: { url: string; handle: string; team: string; frame: PortraitFrame; kind: 'card' | 'hero' | 'compare'; scale: number }) {
  const pr = usePortraits(url ? [url] : []);
  const info = url ? pr.info(url) : null;
  if (kind === 'card') return (
    <div className="aud" style={{ width: 300, height: 470 }} data-portrait-preview="card">
      <div className="pc" style={{ position: 'absolute', inset: 0, animation: 'none' }}>
        <div className="num">01</div><Logo team={team} size={70} />
        {info ? <PortraitImg info={info} frame={frame} box={info.cutout ? { w: 280, h: 340 } : { w: 300, h: 360 }} className="pc-port" scale={scale} /> : <div className="sil" />}
        <b>{handle}</b><small>{team}</small><div className="tm" />
      </div>
    </div>
  );
  const box = kind === 'hero' ? { w: 760, h: 980 } : { w: 640, h: 830 };
  return (
    <div className="aud" style={{ width: box.w, height: 1080, background: 'radial-gradient(closest-side, rgba(255,106,19,.35), #160A07)' }} data-portrait-preview={kind}>
      <div className={kind === 'hero' ? 'mvx-pic' : 'mvc-pic'} style={{ position: 'absolute', left: 0, right: 'auto', bottom: 0, transform: 'none', animation: 'none' }}>
        <Portrait info={info} team={team} box={box} frameW={kind === 'hero' ? 640 : 460} frame={frame} scale={scale} />
      </div>
    </div>
  );
}
export { preload as preloadPortrait };

function deskMvp(d: GfxData, matchId: string, roster: AudPlayer[]) {
  const picks = Object.values(d.aud?.staffMvp[matchId] ?? {});
  if (!picks.length) return null;
  const tally = new Map<string, number>();
  for (const p of picks) tally.set(p.player, (tally.get(p.player) ?? 0) + 1);
  const [player, n] = [...tally].sort((a, b) => b[1] - a[1])[0];
  return { player, n, of: picks.length, team: roster.find(p => p.handle === player)?.team ?? '', reason: picks.find(p => p.player === player && p.reason)?.reason ?? '' };
}

/** Mode C extras: the producer's stats and achievements for the revealed player (nothing when none were entered). */
function CardExtras({ card }: { card?: MvpCard }) {
  if (!card || (!card.stats.length && !card.achievements.length)) return null;
  return (
    <div className="mvx-extras" data-mvp-extras>
      {card.stats.length > 0 && <div className="mvx-stats">{card.stats.map((x, i) => <div key={i} style={{ animationDelay: `${2.6 + i * 0.09}s` }}><b>{x.value}</b><small>{x.label}</small></div>)}</div>}
      {card.achievements.length > 0 && <div className="mvx-ach">{card.achievements.map((x, i) => <span key={i} style={{ animationDelay: `${2.95 + i * 0.09}s` }}>{x}</span>)}</div>}
    </div>
  );
}

/**
 * Reveal animation settings (MVP 1.2): the approved reveal sequence, played at a chosen pace (the browser's own
 * animation clock: every beat keeps its order and relative timing) and optionally without its opening sweep.
 */
const PACE: Record<string, number> = { cinematic: 1, standard: 1.4, quick: 2 };
function Paced({ rate, sweep, children }: { rate: number; sweep: boolean; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (rate !== 1) el.current?.getAnimations({ subtree: true }).forEach(a => { if (a.playbackRate !== rate) a.playbackRate = rate; }); });
  return <div ref={el} className={sweep ? undefined : 'mvx-nosweep'} style={{ position: 'absolute', inset: 0 }} data-reveal-pace={rate}>{children}</div>;
}
const mvp: R = ({ cfg, d }) => {
  const step = String(cfg.step || 'voting');
  if (step === 'voting') return <MvpInner cfg={cfg} d={d} />;
  return <Paced rate={PACE[String(cfg.revealPace)] ?? 1} sweep={cfg.revealSweep !== false}><MvpInner cfg={cfg} d={d} /></Paced>;
};
const MvpInner: R = ({ cfg, d }) => {
  const m = matchOf(cfg, d);
  const step = String(cfg.step || 'voting');
  const poll = m ? d.aud?.polls.filter(p => p.match === m.id).pop() : undefined;
  const roster = m ? [...teamRoster(m.a), ...teamRoster(m.b)] : [];
  const res = mvpResult(poll);
  const desk = m ? deskMvp(d, m.id, roster) : null;
  // Everything this graphic could reveal is preloaded while it is on screen (the voting step included).
  const urls = [...new Set(roster.map(p => portraitUrl(d, p.handle)).filter(Boolean))];
  const pr = usePortraits(urls);
  if (!m || !m.winner) return null;
  const result = `${m.a} ${m.s1}–${m.s2} ${m.b}`;
  const label = m.label;
  if (step === 'voting') {
    const all = poll?.players.length ? poll.players : roster;
    const qr = d.aud?.qr.find(q => q.id === 'vote');
    const open = poll?.status === 'open', closed = poll?.status === 'closed' || poll?.status === 'revealed';
    // Mode A extras: a countdown when the producer set one; live totals only when the producer put them on air.
    const left = open && poll?.closesAt ? Math.max(0, Math.ceil((poll.closesAt - d.now) / 1000)) : null;
    const live = open && poll ? d.aud?.liveTotals?.[poll.id] : undefined;
    // Order: as prepared. Ranking by live votes only when the producer asked for it (and the totals are on air).
    const players = (live && cfg.liveOrder === true ? [...all.slice(0, 4)].sort((p, q) => (live.counts[q.handle] ?? 0) - (live.counts[p.handle] ?? 0)) : all).slice(0, 4);
    const share = live ? pcts(players.map(p => live.counts[p.handle] ?? 0)) : null;
    const n = Math.max(1, players.length);
    const chatCmd = poll?.chatCmd || '!vote';
    return (
      <div className={'aud' + (closed ? ' mv-closed' : '')} data-mvp-mode={open ? 'A' : closed ? 'B' : 'pre'}>
        <BgVideo /><div className="aud-dim" />
        <Head kick={`Community MVP · ${result}`} title={closed ? 'Voting closed' : 'Vote for the MVP'} />
        {/* 1–4 candidates: same card size, centred in the four-card area (the QR box keeps its place). */}
        <div className="aud-left mv" data-candidates={players.length} style={{ gridTemplateColumns: `repeat(${n}, 300px)`, width: 4 * 300 + 3 * 22, justifyContent: 'center' }}>
          {players.map((p, i) => {
            const info = pr.info(portraitUrl(d, p.handle));
            const num = (all.findIndex(x => x.handle === p.handle) + 1) || i + 1; // a candidate keeps its number when ranked
            return (
              <div className={'pc' + (p.team === m.b ? ' b' : '')} key={p.handle} style={{ animationDelay: `${i * 70}ms` }} data-candidate={p.handle}>
                <div className="num">{String(num).padStart(2, '0')}</div><Logo team={p.team} size={70} />
                {info ? <PortraitImg info={info} frame={frameOf(d, p.handle)} box={info.cutout ? { w: 280, h: 340 } : { w: 300, h: 360 }} className="pc-port" /> : <div className="sil" />}
                <b>{p.handle}</b><small>{p.team}</small>
                {share && <div className="pc-live" data-live-total><span>{share[i]}%{cfg.liveCounts === true && <em> · {(live!.counts[p.handle] ?? 0).toLocaleString('en-US')}</em>}</span><i style={{ width: `${share[i]}%` }} /></div>}
                <div className="tm" />
              </div>
            );
          })}
        </div>
        {/* Ways to vote: website (QR), Twitch chat, or both — as the producer opened this vote. */}
        {!closed && poll?.chat && poll.web === false ? <div className="qrbox chat" data-chat-box><span className="k">Vote in Twitch chat</span><b className="cmd">{chatCmd} 1–{n}</b><span>Type the player's number{poll.chatChannel ? <> in <em>twitch.tv/{poll.chatChannel}</em></> : null}</span></div>
          : qr && !closed && <div className="qrbox"><Qr url={qr.url} size={300} /><b>Scan to vote</b><span>{qr.url.replace(/^https:\/\//, '')}</span>{poll?.chat && <span className="chatline" data-chat-line>or type <em>{chatCmd} 1–{n}</em> in chat</span>}</div>}
        {closed && <div className="qrbox done"><div className="lock" /><b>Votes are in</b><span>{poll?.frozen ? `${poll.frozen.total.toLocaleString('en-US')} votes counted` : 'Counting'}</span></div>}
        <div className="status"><div className={'live' + (open ? '' : ' off')}><i />{open ? 'VOTING OPEN' : closed ? 'VOTING CLOSED' : 'VOTING OPENS SOON'}</div>
          {left != null && <div className="cd" data-countdown>{left > 0 ? <>Closes in <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b></> : <b>Closing…</b>}</div>}
          <div className="t">{closed ? 'The MVP is revealed on air' : live ? `Live count · ${live.total.toLocaleString('en-US')} votes · one vote per viewer` : poll?.chat ? 'One vote per Twitch account · results revealed on air' : 'One vote per viewer · results revealed on air'}</div></div>
      </div>
    );
  }
  // The reveal waits for its portraits (they were preloaded during the voting step; 1.5 s cap, then the fallback).
  const wait = !pr.ready;
  const hero = (who: { handle: string; team: string }, badges: ReactNode, body: ReactNode, tint?: 'desk') => {
    const info = pr.info(portraitUrl(d, who.handle));
    return (
      <div className={'aud mvx mvx-seq' + (tint ? ' mvx-desk' : '') + (wait ? ' mvx-wait' : '')} data-mvp-portrait={info ? (info.cutout ? 'cutout' : 'framed') : 'fallback'}>
        <BgVideo /><div className="mvx-dim" />
        {/* 1. red angular sweep · 2. MVP title · 3. portrait · 4. name · 5. team · 6–7. share + votes · 8. stats · 9. brand */}
        <div className="mvx-wipe" aria-hidden><i /><i /><i /></div>
        <div className="mvx-glow" />
        <div className="mvx-ghost">MVP</div>
        <div className="mvx-pic"><Portrait info={info} team={who.team} box={{ w: 760, h: 980 }} frame={frameOf(d, who.handle)} /><div className="mvx-flare" /></div>
        <div className="mvx-brand" data-mvp-brand><img src={hiRes('/brand/overdrive/logo.png')} alt="Overdrive" draggable={false} /></div>
        <div className="mvx-L">
          <div className="mvx-badges">{badges}</div>
          <div className="mvx-name">{who.handle}</div>
          <div className="mvx-tm"><Logo team={who.team} size={54} /><b>{who.team}</b></div>
          {body}
        </div>
      </div>
    );
  };
  const extras = (handle: string) => <CardExtras card={d.aud?.mvpCards?.[m.id]?.[handle]} />;
  if (step === 'winner') {
    if (!res || !res.top.length) return null; // never a guess: nothing until the result is frozen
    const win = res.top[0];
    return hero(win, <div className="mvx-badge"><small>Community</small>MVP</div>, <>
      <div className="mvx-res">{label} · <b>{result}</b></div>
      <div className="mvx-share"><div className="lbl"><span>Community vote<em className="mvx-votes" data-mvp-total> · {res.total.toLocaleString('en-US')} votes</em></span><b>{win.pct}%</b></div><div className="bar"><i style={{ ['--w' as string]: `${win.pct}%` }} /></div></div>
      <div className="mvx-rest">{res.rows.filter(r => !res.top.includes(r)).slice(0, 3).map(r => <div key={r.handle}><b>{r.handle}</b><span>{r.pct}%</span></div>)}</div>
      {extras(win.handle)}
    </>);
  }
  if (step === 'desk') {
    if (!desk) return null;
    return hero({ handle: desk.player, team: desk.team }, <div className="mvx-badge desk"><small>Analyst</small>MVP</div>, <>
      <div className="mvx-res">{label} · <b>{result}</b></div>
      {desk.reason && <div className="mvx-quote">“{desk.reason}”</div>}
      <div className="mvx-quote-by">Picked by {desk.n} of {desk.of} analysts</div>
      {extras(desk.player)}
    </>, 'desk');
  }
  // compare: one portrait when they agree, both side by side when they differ
  if (!res || !res.top.length || !desk) return null;
  const win = res.top[0];
  if (res.top.some(t => t.handle === desk.player)) {
    return hero(win, <><div className="mvx-badge"><small>Community</small>MVP</div><div className="mvx-badge desk"><small>Analyst</small>MVP</div></>, <>
      <div className="mvx-res">Community and analysts agree · <b>{result}</b></div>
      <div className="mvx-share"><div className="lbl"><span>Community {win.pct}% · Analysts {desk.n} of {desk.of}</span><b>{desk.n === desk.of ? 'Unanimous' : 'They agree'}</b></div><div className="bar"><i style={{ ['--w' as string]: `${win.pct}%` }} /></div></div>
      {extras(win.handle)}
    </>);
  }
  const half = (side: 'l' | 'r', who: { handle: string; team: string }, tag: string, line: string) => (
    <div className={`mvc-half ${side}`}>
      <div className="mvc-glow" />
      <div className="mvc-pic"><Portrait info={pr.info(portraitUrl(d, who.handle))} team={who.team} box={{ w: 640, h: 830 }} mirror={side === 'r'} frameW={460} frame={frameOf(d, who.handle)} /></div>
      <div className="mvc-plate"><span className="who">{tag}</span><div className="n">{who.handle}</div><div className="m"><Logo team={who.team} size={40} />{who.team}<span> · {line}</span></div></div>
    </div>
  );
  return (
    <div className={'aud mvc' + (wait ? ' mvx-wait' : '')}>
      <BgVideo /><div className="mvx-dim" />
      {half('l', win, 'Community MVP', `${win.pct}% of ${res.total.toLocaleString('en-US')} votes`)}
      {half('r', { handle: desk.player, team: desk.team }, 'Analyst MVP', `${desk.n} of ${desk.of} analysts`)}
      <div className="mvc-div" />
      <div className="mvc-head"><div className="kick">MVP · {result}</div><div className="t">Community vs Analysts</div></div>
      <div className="mvc-vs">Split<small>{desk.team === win.team ? 'Same team, different player' : 'Different teams'}</small></div>
    </div>
  );
};

// ------------------------------------------------------------------ QR

/**
 * Analyst desk: the MVP vote's state next to the code (open + countdown, candidates, closed). The winner only once the
 * producer REVEALED it on air (poll status 'revealed') and only when the desk asks for it: never from a closed vote.
 */
function deskVote(d: GfxData, winner: boolean) {
  const wc = d.wc?.state, polls = d.aud?.polls ?? [];
  const poll = (wc?.cast ? polls.filter(p => p.match === wc.cast).pop() : undefined) ?? polls.filter(p => p.status !== 'draft').pop();
  if (!poll || poll.status === 'draft') return null;
  if (poll.status === 'open') {
    const left = poll.closesAt ? Math.max(0, Math.ceil((poll.closesAt - d.now) / 1000)) : null;
    return { state: 'open' as const, line: left != null ? `Voting open · closes ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Voting open', who: poll.players.slice(0, 4).map(p => p.handle) };
  }
  const res = poll.status === 'revealed' && winner ? mvpResult(poll) : null;
  if (res?.top.length) return { state: 'winner' as const, line: `Community MVP · ${res.top[0].handle} ${res.top[0].pct}%`, who: [] };
  return { state: 'closed' as const, line: 'Voting closed · MVP revealed on air', who: [] };
}
const DeskVote = ({ v, who }: { v: ReturnType<typeof deskVote>; who: boolean }) => !v ? null : (
  <div className={`qr-st ${v.state}`} data-desk-vote={v.state}><i />{v.line}{who && v.who.length > 0 && <small>{v.who.join(' · ')}</small>}</div>
);

const qr: R = ({ cfg, d }) => {
  const link = d.aud?.qr.find(q => q.id === String(cfg.qr || 'vote'));
  if (!link) return null; // invalid, expired or not approved: draw nothing
  const pos = String(cfg.position || 'lower-third'), title = String(cfg.title || ''), url = link.url.replace(/^https:\/\//, '');
  if (pos === 'corner') return <div className="aud"><div className="qr-corner"><div className="q"><Qr url={link.url} size={170} /></div><b>{title || link.label}</b></div></div>;
  // Inside the Analyst Desk graphic: smaller, in the band between the camera boxes and the ticker (never over a camera).
  const v = pos.startsWith('desk-inline') ? deskVote(d, cfg.winner === true) : null;
  if (pos === 'desk-inline-solo') return <div className="aud"><div className="qr-corner in-desk-solo"><div className="q"><Qr url={link.url} size={176} /></div><b>{title || link.label}</b><DeskVote v={v} who={false} /></div></div>;
  if (pos === 'desk-inline') return <div className="aud"><div className="qr-desk in-desk"><div className="q"><Qr url={link.url} size={160} /></div><div className="tx"><b>{title || link.label}</b>{cfg.showUrl !== false && <span>{url}</span>}<DeskVote v={v} who /></div></div></div>;
  if (pos === 'desk') return <div className="aud"><div className="qr-desk"><div className="q"><Qr url={link.url} size={200} /></div><div className="tx"><b>{title || link.label}</b>{cfg.showUrl !== false && <span>{url}</span>}</div></div></div>;
  return (
    <div className="aud">
      <div className="l3"><div className="q"><Qr url={link.url} size={168} /></div>
        <div className="tx"><b>{title || link.label}</b>{cfg.showUrl !== false && <span>{url}</span>}</div></div>
    </div>
  );
};

export const AUD_RENDERERS: Record<string, R> = { pickem, mvp, qr };

/**
 * Audience graphics (Pick'ems + Community MVP + QR), native 1920×1080, in the approved Overdrive identity (fire loop,
 * WC Anton / WC Montserrat, orange underline accents). They draw only what the producer published: desk picks up to
 * the published reveal step, community splits only once a match is locked, MVP winners only from the result frozen
 * when voting closed. Anything not ready draws nothing rather than a guess.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { GfxInstance } from '../../shared/gfx';
import { communityPick, pcts, teamRoster, type AudPlayer, type AudPoll } from '../../shared/audience';
import { matchName, wcResolve } from '../../shared/wildcard';
import { normHandle, teamLogo } from '../../shared/major';
import { BgVideo } from '../components/Brand';
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

/** Never enlarged more than 1.25×: a smaller picture is drawn smaller (bottom-anchored), not stretched. */
const MAX_UP = 1.25;
function Portrait({ info, team, box, mirror, frameW = 640 }: { info: PInfo | null; team: string; box: { w: number; h: number }; mirror?: boolean; frameW?: number }) {
  // Fallback: the team mark, kept small enough that today's 64 px logos are not blown up (larger once the official
  // vector logos are approved), under the outlined MVP.
  if (!info) return <div className="mv-fb" style={{ width: box.w, height: box.h }}><Logo team={team} size={Math.min(160, box.w * 0.25)} /><div className="mv-fbx">MVP</div></div>;
  if (info.cutout) {
    const s = Math.min(box.h / info.h, box.w / info.w, MAX_UP);
    return <img className="mv-cut" src={info.url} alt="" style={{ width: info.w * s, height: info.h * s, transform: mirror ? 'scaleX(-1)' : undefined }} />;
  }
  // Framed 3:4, cropped from the top (faces stay in), never enlarged past the limit.
  const fw = Math.min(box.w, box.h * 0.75, frameW), fh = fw / 0.75;
  const s = Math.min(1, (MAX_UP * info.w) / fw, (MAX_UP * info.h) / fh);
  return <div className="mv-frame" style={{ width: fw * s, height: fh * s }}><img src={info.url} alt="" /></div>;
}

function deskMvp(d: GfxData, matchId: string, roster: AudPlayer[]) {
  const picks = Object.values(d.aud?.staffMvp[matchId] ?? {});
  if (!picks.length) return null;
  const tally = new Map<string, number>();
  for (const p of picks) tally.set(p.player, (tally.get(p.player) ?? 0) + 1);
  const [player, n] = [...tally].sort((a, b) => b[1] - a[1])[0];
  return { player, n, of: picks.length, team: roster.find(p => p.handle === player)?.team ?? '', reason: picks.find(p => p.player === player && p.reason)?.reason ?? '' };
}

const mvp: R = ({ cfg, d }) => {
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
    const players = poll?.players.length ? poll.players : roster;
    const qr = d.aud?.qr.find(q => q.id === 'vote');
    const open = poll?.status === 'open';
    return (
      <div className="aud">
        <BgVideo /><div className="aud-dim" />
        <Head kick={`Community MVP · ${result}`} title="Vote for the MVP" />
        <div className="aud-left mv">
          {players.slice(0, 4).map((p, i) => {
            const info = pr.info(portraitUrl(d, p.handle));
            return (
              <div className={'pc' + (p.team === m.b ? ' b' : '')} key={p.handle} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="num">{String(i + 1).padStart(2, '0')}</div><Logo team={p.team} size={70} />
                {info ? <img className={info.cutout ? 'pc-cut' : 'pc-photo'} src={info.url} alt="" /> : <div className="sil" />}
                <b>{p.handle}</b><small>{p.team}</small><div className="tm" />
              </div>
            );
          })}
        </div>
        {qr && <div className="qrbox"><Qr url={qr.url} size={300} /><b>Scan to vote</b><span>{qr.url.replace(/^https:\/\//, '')}</span></div>}
        <div className="status"><div className={'live' + (open ? '' : ' off')}><i />{open ? 'VOTING OPEN' : poll?.status === 'closed' || poll?.status === 'revealed' ? 'VOTING CLOSED' : 'VOTING OPENS SOON'}</div>
          <div className="t">One vote per viewer · results revealed on air</div></div>
      </div>
    );
  }
  // The reveal waits for its portraits (they were preloaded during the voting step; 1.5 s cap, then the fallback).
  const wait = !pr.ready;
  const hero = (who: { handle: string; team: string }, badges: ReactNode, body: ReactNode, tint?: 'desk') => {
    const info = pr.info(portraitUrl(d, who.handle));
    return (
      <div className={'aud mvx' + (tint ? ' mvx-desk' : '') + (wait ? ' mvx-wait' : '')} data-mvp-portrait={info ? (info.cutout ? 'cutout' : 'framed') : 'fallback'}>
        <BgVideo /><div className="mvx-dim" />
        <div className="mvx-glow" />
        <div className="mvx-ghost">MVP</div>
        <div className="mvx-pic"><Portrait info={info} team={who.team} box={{ w: 760, h: 980 }} /></div>
        <div className="mvx-L">
          <div className="mvx-badges">{badges}</div>
          <div className="mvx-name">{who.handle}</div>
          <div className="mvx-tm"><Logo team={who.team} size={54} /><b>{who.team}</b></div>
          {body}
        </div>
      </div>
    );
  };
  if (step === 'winner') {
    if (!res || !res.top.length) return null; // never a guess: nothing until the result is frozen
    const win = res.top[0];
    return hero(win, <div className="mvx-badge"><small>Community</small>MVP</div>, <>
      <div className="mvx-res">{label} · <b>{result}</b></div>
      <div className="mvx-share"><div className="lbl"><span>Community vote · {res.total.toLocaleString('en-US')} votes</span><b>{win.pct}%</b></div><div className="bar"><i style={{ ['--w' as string]: `${win.pct}%` }} /></div></div>
      <div className="mvx-rest">{res.rows.filter(r => !res.top.includes(r)).slice(0, 3).map(r => <div key={r.handle}><b>{r.handle}</b><span>{r.pct}%</span></div>)}</div>
    </>);
  }
  if (step === 'desk') {
    if (!desk) return null;
    return hero({ handle: desk.player, team: desk.team }, <div className="mvx-badge desk"><small>Analyst</small>MVP</div>, <>
      <div className="mvx-res">{label} · <b>{result}</b></div>
      {desk.reason && <div className="mvx-quote">“{desk.reason}”</div>}
      <div className="mvx-quote-by">Picked by {desk.n} of {desk.of} analysts</div>
    </>, 'desk');
  }
  // compare: one portrait when they agree, both side by side when they differ
  if (!res || !res.top.length || !desk) return null;
  const win = res.top[0];
  if (res.top.some(t => t.handle === desk.player)) {
    return hero(win, <><div className="mvx-badge"><small>Community</small>MVP</div><div className="mvx-badge desk"><small>Analyst</small>MVP</div></>, <>
      <div className="mvx-res">Community and analysts agree · <b>{result}</b></div>
      <div className="mvx-share"><div className="lbl"><span>Community {win.pct}% · Analysts {desk.n} of {desk.of}</span><b>{desk.n === desk.of ? 'Unanimous' : 'They agree'}</b></div><div className="bar"><i style={{ ['--w' as string]: `${win.pct}%` }} /></div></div>
    </>);
  }
  const half = (side: 'l' | 'r', who: { handle: string; team: string }, tag: string, line: string) => (
    <div className={`mvc-half ${side}`}>
      <div className="mvc-glow" />
      <div className="mvc-pic"><Portrait info={pr.info(portraitUrl(d, who.handle))} team={who.team} box={{ w: 640, h: 830 }} mirror={side === 'r'} frameW={460} /></div>
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

const qr: R = ({ cfg, d }) => {
  const link = d.aud?.qr.find(q => q.id === String(cfg.qr || 'vote'));
  if (!link) return null; // invalid, expired or not approved: draw nothing
  const pos = String(cfg.position || 'lower-third'), title = String(cfg.title || ''), url = link.url.replace(/^https:\/\//, '');
  if (pos === 'corner') return <div className="aud"><div className="qr-corner"><div className="q"><Qr url={link.url} size={170} /></div><b>{title || link.label}</b></div></div>;
  if (pos === 'desk') return <div className="aud"><div className="qr-desk"><div className="q"><Qr url={link.url} size={200} /></div><div className="tx"><b>{title || link.label}</b>{cfg.showUrl !== false && <span>{url}</span>}</div></div></div>;
  return (
    <div className="aud">
      <div className="l3"><div className="q"><Qr url={link.url} size={168} /></div>
        <div className="tx"><b>{title || link.label}</b>{cfg.showUrl !== false && <span>{url}</span>}</div></div>
    </div>
  );
};

export const AUD_RENDERERS: Record<string, R> = { pickem, mvp, qr };

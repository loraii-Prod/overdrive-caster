/**
 * Audience graphics (Pick'ems + Community MVP + QR), native 1920×1080, in the approved Overdrive identity (fire loop,
 * WC Anton / WC Montserrat, orange underline accents). They draw only what the producer published: desk picks up to
 * the published reveal step, community splits only once a match is locked, MVP winners only from the result frozen
 * when voting closed. Anything not ready draws nothing rather than a guess.
 */
import type { ReactNode } from 'react';
import type { GfxInstance } from '../../shared/gfx';
import { communityPick, pcts, teamRoster, type AudPoll } from '../../shared/audience';
import { matchName, wcResolve } from '../../shared/wildcard';
import { teamLogo } from '../../shared/major';
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

const mvp: R = ({ cfg, d }) => {
  const m = matchOf(cfg, d);
  if (!m || !m.winner) return null;
  const step = String(cfg.step || 'voting');
  const poll = d.aud?.polls.filter(p => p.match === m.id).pop();
  const result = `${m.a} ${m.s1}–${m.s2} ${m.b}`;
  if (step === 'voting') {
    const players = poll?.players.length ? poll.players : [...teamRoster(m.a), ...teamRoster(m.b)];
    const qr = d.aud?.qr.find(q => q.id === 'vote');
    const open = poll?.status === 'open';
    return (
      <div className="aud">
        <BgVideo /><div className="aud-dim" />
        <Head kick={`Community MVP · ${result}`} title="Vote for the MVP" />
        <div className="aud-left mv">
          {players.slice(0, 4).map((p, i) => (
            <div className={'pc' + (p.team === m.b ? ' b' : '')} key={p.handle} style={{ animationDelay: `${i * 70}ms` }}>
              <div className="num">{String(i + 1).padStart(2, '0')}</div><Logo team={p.team} size={70} /><div className="sil" />
              <b>{p.handle}</b><small>{p.team}</small><div className="tm" />
            </div>
          ))}
        </div>
        {qr && <div className="qrbox"><Qr url={qr.url} size={300} /><b>Scan to vote</b><span>{qr.url.replace(/^https:\/\//, '')}</span></div>}
        <div className="status"><div className={'live' + (open ? '' : ' off')}><i />{open ? 'VOTING OPEN' : poll?.status === 'closed' || poll?.status === 'revealed' ? 'VOTING CLOSED' : 'VOTING OPENS SOON'}</div>
          <div className="t">One vote per viewer · results revealed on air</div></div>
      </div>
    );
  }
  const res = mvpResult(poll);
  if (!res || !res.top.length) return null; // never a guess: nothing until the result is frozen
  const win = res.top[0];
  if (step === 'winner') {
    return (
      <div className="aud">
        <BgVideo /><div className="aud-dim" />
        <div className="win">
          <div className="glow" />
          <Head kick={`Community MVP · ${result}`} sub={`Voted by ${res.total.toLocaleString('en-US')} viewers`} />
          <div className="name">{res.top.map(t => t.handle).join(' & ')}</div>
          <div className="wtm"><Logo team={win.team} size={56} /><b>{win.team}</b></div>
          <div className="share"><div className="lbl"><span>Share of the vote</span><b>{win.pct}%</b></div><div className="bar"><i style={{ ['--w' as string]: `${win.pct}%` }} /></div></div>
          <div className="rest">{res.rows.filter(r => !res.top.includes(r)).slice(0, 3).map(r => <div key={r.handle}><b>{r.handle}</b><span>{r.pct}%</span></div>)}</div>
        </div>
      </div>
    );
  }
  // compare: community vs desk
  const picks = Object.values(d.aud?.staffMvp[m.id] ?? {});
  if (!picks.length) return null;
  const tally = new Map<string, number>();
  for (const p of picks) tally.set(p.player, (tally.get(p.player) ?? 0) + 1);
  const [deskPlayer, deskN] = [...tally].sort((a, b) => b[1] - a[1])[0];
  const deskTeam = [...teamRoster(m.a), ...teamRoster(m.b)].find(p => p.handle === deskPlayer)?.team ?? '';
  const reason = picks.find(p => p.player === deskPlayer && p.reason)?.reason;
  const agree = res.top.some(t => t.handle === deskPlayer);
  return (
    <div className="aud">
      <BgVideo /><div className="aud-dim" />
      <Head kick={`MVP · ${result}`} title="Community vs Desk" />
      <div className="cmp">
        <div className="h l"><div className="who kick">Community MVP</div><div className="bigp">{win.pct}%<small>of {res.total.toLocaleString('en-US')} votes</small></div>
          <div className="nm">{res.top.map(t => t.handle).join(' & ')}</div><div className="tmn"><Logo team={win.team} size={46} />{win.team}</div></div>
        <div className="h r"><div className="who kick">Desk MVP</div><div className="bigp">{deskN}/{picks.length}<small>desk votes</small></div>
          <div className="nm">{deskPlayer}</div><div className="tmn"><Logo team={deskTeam} size={46} />{deskTeam}</div>{reason && <div className="why">“{reason}”</div>}</div>
      </div>
      <div className="agree">{agree ? 'They agree' : 'Split decision'}{!agree && deskTeam === win.team && <span>Same team, different player</span>}</div>
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

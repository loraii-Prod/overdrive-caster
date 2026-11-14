/** Public voting page (served by the vote service): Pick'ems, Community MVP, Results. Mobile first. */
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { teamLogo } from '../../shared/major';
import './vote.css';

interface Match { id: string; label: string; a: string; b: string; bestOf: number; scores: string[]; status: 'open' | 'locked' | 'final'; winner: string | null; score: string | null; split: { total: number; byTeam: Record<string, number> } | null }
interface Poll { id: string; match: string; label: string; result: string; players: { handle: string; team: string; photo?: string }[]; status: 'open' | 'closed' | 'revealed'; closesAt?: number | null; frozen: { total: number; counts: Record<string, number> } | null }
interface State { ok: boolean; session: string | null; name: string; signIn: boolean; dev?: boolean; matches: Match[]; champion: { locked: boolean; teams: string[] }; polls: Poll[]; accuracy: { played: number; right: number; points: number } }
interface Me { name: string; picks: Record<string, { team: string; score: string }>; champion: string | null; votes: Record<string, string>; points: number; rank: number | null; ranked: number }

const api = async (path: string, body?: unknown) => {
  let r: Response;
  try {
    r = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { return { status: 0, ok: false, error: 'No connection. Nothing was sent: try again.' }; }
  const j = await r.json().catch(() => ({ ok: false, error: 'Voting is unavailable right now' }));
  return { status: r.status, ...j };
};
/** Player portrait (uploaded by the production) with the silhouette as the fallback. */
function Face({ src }: { src?: string }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img className="face" src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : <div className="sil" aria-hidden />;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
const Logo = ({ team, size = 32 }: { team: string; size?: number }) => { const src = teamLogo(team); return src ? <img src={src} alt="" width={size} height={size} className="logo" /> : null; };

function App() {
  const [st, setSt] = useState<State | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<'picks' | 'mvp' | 'results'>('picks');
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [champOpen, setChampOpen] = useState(false);
  const [mvpChoice, setMvpChoice] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async (withMe = false) => {
    try {
      const s = await api('/v1/state');
      if (!s.ok) throw new Error(); setSt(s); setOffline(false);
      if (withMe) { const m = await api('/v1/me'); if (m.ok) setMe(m.me); }
    } catch { setOffline(true); }
  }, []);
  useEffect(() => { load(true); const t = setInterval(() => load(false), 8000); return () => clearInterval(t); }, [load]);
  const openPoll = st?.polls.find(p => p.status === 'open') ?? null;
  const closedPoll = !openPoll ? [...(st?.polls ?? [])].reverse().find(p => p.status === 'closed') ?? null : null;
  const lastReveal = [...(st?.polls ?? [])].reverse().find(p => p.status === 'revealed' && p.frozen) ?? null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!openPoll?.closesAt) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [openPoll?.closesAt]);
  const left = openPoll?.closesAt ? Math.max(0, Math.ceil((openPoll.closesAt - now) / 1000)) : null;
  const seenPoll = useRef<string | null>(null);
  useEffect(() => { if (openPoll && seenPoll.current !== openPoll.id) { seenPoll.current = openPoll.id; setMvpChoice(null); setTab('mvp'); } }, [openPoll]);

  const say = (text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 2600); };
  const act = async (path: string, body: unknown, ok: string): Promise<boolean> => {
    if (busy.current) return false; busy.current = true;
    try {
      const r = await api(path, body);
      if (r.ok) { say(r.already ? 'You already voted in this one' : ok); await load(true); }
      else if (r.status === 401) say('Sign in with Twitch first', true);
      else { say(r.error || 'Not saved, try again', true); await load(true); } // show what the server really has
      return !!r.ok;
    } finally { busy.current = false; }
  };
  const pick = (m: Match, team: string, score = '') => {
    if (!me) return say('Sign in with Twitch first', true);
    const cur = me.picks[m.id];
    const sc = score || (cur?.team === team ? cur.score : '');
    setMe({ ...me, picks: { ...me.picks, [m.id]: { team, score: sc } } }); // answer the tap at once; the server confirms
    act('/v1/pick', { match: m.id, team, score: sc }, 'Saved');
  };

  if (!st) return <div className="wrap"><Header me={null} st={null} /><p className="empty">{offline ? 'Voting is unavailable right now. Try again in a moment.' : 'Loading…'}</p></div>;
  if (!st.session) return <div className="wrap"><Header me={me} st={st} /><p className="empty">Voting opens with the broadcast.</p></div>;
  const open = st.matches.filter(m => m.status === 'open'), locked = st.matches.filter(m => m.status === 'locked');
  const revealed = st.polls.filter(p => p.status === 'revealed' && p.frozen);

  return (
    <div className="wrap">
      <Header me={me} st={st} onOut={async () => { await api('/auth/logout', {}); setMe(null); }} />
      {offline && <div className="banner" role="status">Connection lost. Your saved picks are safe; retrying…</div>}
      <nav className="tabs" role="tablist">
        {([['picks', "Pick'ems"], ['mvp', 'MVP'], ['results', 'Results']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'mvp' && openPoll ? <i className="dot" aria-label="voting open" /> : null}</button>
        ))}
      </nav>
      <main className="sc">
        {tab === 'picks' && <>
          <h1>Pick the winners</h1><p className="s">Picks lock when each match starts · 1 point for the winner, 3 for the exact score</p>
          {!open.length && !locked.length && <p className="empty">No matches to pick right now.</p>}
          {open.map(m => { const p = me?.picks[m.id]; return (
            <section className="m" key={m.id} aria-label={`${m.a} vs ${m.b}`}>
              <div className="r"><span>{m.label} · Bo{m.bestOf}</span><em>Open</em></div>
              <div className="tt">{[m.a, m.b].map(t => <button key={t} className={'t' + (p?.team === t ? ' on' : '')} aria-pressed={p?.team === t} onClick={() => pick(m, t)}><Logo team={t} /><b>{t}</b></button>)}</div>
              {p && m.scores.length > 0 && <div className="chips" role="group" aria-label="Score (optional)">{m.scores.map(sc => <button key={sc} className={p.score === sc ? 'on' : ''} aria-pressed={p.score === sc} onClick={() => pick(m, p.team, p.score === sc ? '' : sc)}>{sc}</button>)}</div>}
              {p ? <div className="ok">✓ Saved: {p.team}{p.score ? ' ' + p.score : ''} · you can change it until the match starts</div> : <div className="lock">Pick a winner, then a score (optional)</div>}
            </section>); })}
          {locked.map(m => { const p = me?.picks[m.id]; return (
            <section className="m dim" key={m.id}><div className="r"><span>{m.label}</span><span>Live · locked</span></div>
              <div className="tt">{[m.a, m.b].map(t => <div key={t} className={'t' + (p?.team === t ? ' mine' : '')}><Logo team={t} /><b>{t}</b></div>)}</div>
              <div className="lock">{p ? `Your pick: ${p.team}${p.score ? ' ' + p.score : ''}` : 'No pick made'}</div></section>); })}
          <button className="btn ghost" onClick={() => setChampOpen(v => !v)} aria-expanded={champOpen}>Champion pick{me?.champion ? ` · ${me.champion}` : ''} {st.champion.locked ? '(locked)' : '›'}</button>
          {champOpen && <div className="champ">{st.champion.teams.map(t => <button key={t} disabled={st.champion.locked} className={'t' + (me?.champion === t ? ' on' : '')} aria-pressed={me?.champion === t}
            onClick={() => me ? act('/v1/champion', { team: t }, `Champion pick: ${t}`) : say('Sign in with Twitch first', true)}><Logo team={t} /><b>{t}</b></button>)}</div>}
        </>}

        {tab === 'mvp' && (openPoll ? (() => { const mine = me?.votes[openPoll.id]; const over = left === 0; return <>
          <div className="live"><i />{over ? 'Voting closing…' : left != null ? <>Voting open · closes in <b className="cd">{mmss(left)}</b></> : 'Voting open · closes on air'}</div>
          <h1>Who was the MVP?</h1><p className="s">{openPoll.result || openPoll.label}</p>
          <div className="pl" role="radiogroup" aria-label="MVP candidates">{openPoll.players.map(p => { const on = (mine ?? mvpChoice) === p.handle; return (
            <button key={p.handle} role="radio" className={'p' + (on ? ' on' : '')} aria-checked={on} disabled={!!mine || over} onClick={() => setMvpChoice(p.handle)}>
              <Face src={p.photo} /><Logo team={p.team} size={26} /><b>{p.handle}</b><small>{p.team}</small></button>); })}</div>
          {mine ? <p className="ok center" data-voted>✓ Vote received: {mine}. The result is revealed on stream.</p>
            : <button className="btn" disabled={!mvpChoice || over} onClick={() => me ? act('/v1/mvp', { poll: openPoll.id, player: mvpChoice }, `Vote received: ${mvpChoice}`) : say('Sign in with Twitch first', true)}>{over ? 'Voting closed' : mvpChoice ? `Vote ${mvpChoice}` : 'Choose a player'}</button>}
          <p className="lock center">One vote per Twitch account · results are revealed on stream</p>
        </>; })() : closedPoll ? (() => { const mine = me?.votes[closedPoll.id]; return <>
          <div className="live off"><i />Voting closed</div>
          <h1>Votes are in</h1><p className="s">{closedPoll.result || closedPoll.label}</p>
          <p className="empty" data-closed>The Community MVP is revealed on stream.{mine ? ` You voted for ${mine}.` : ''}</p>
        </>; })() : lastReveal ? (() => { const [w, n] = Object.entries(lastReveal.frozen!.counts).sort((a, b) => b[1] - a[1])[0] ?? ['', 0]; const p = lastReveal.players.find(x => x.handle === w); const mine = me?.votes[lastReveal.id]; return <>
          <div className="live off"><i />Revealed on stream</div>
          <h1>Community MVP</h1><p className="s">{lastReveal.result || lastReveal.label}</p>
          <div className="win" data-winner><Face src={p?.photo} /><div><b>{w}</b><small>{p?.team}</small><em>{pct(n, lastReveal.frozen!.total)}% of {lastReveal.frozen!.total.toLocaleString('en-US')} votes</em></div></div>
          {mine && <p className="lock center">You voted for {mine}{mine === w ? ': you called it' : ''}.</p>}
          <p className="empty">The next vote opens on stream after the next match.</p>
        </>; })() : <><h1>Community MVP</h1><p className="empty">Voting opens on stream after each match.</p></>)}

        {tab === 'results' && <>
          <div className="stat">
            <div><small>Your score</small><b>{me ? `${me.points} pts` : '–'}</b><span>{me?.rank ? `#${me.rank} of ${me.ranked}` : me ? 'No finished matches yet' : 'Sign in to play'}</span></div>
            <div><small>Community accuracy</small><b>{st.accuracy.played ? `${pct(st.accuracy.right, st.accuracy.played)}%` : '–'}</b><span>{st.accuracy.right} of {st.accuracy.played} right</span></div>
          </div>
          <h2>Your picks</h2>
          {st.matches.filter(m => me?.picks[m.id]).map(m => { const p = me!.picks[m.id]; const pts = m.winner ? (p.team !== m.winner ? 0 : p.score && p.score === m.score ? 3 : 1) : null; return (
            <div className="yr" key={m.id}><span className="l"><Logo team={p.team} size={24} />{p.team}{p.score ? ' ' + p.score : ''}</span>
              <span className={'v ' + (pts == null ? 'w' : pts ? 'y' : 'n')}>{pts == null ? 'Pending' : pts === 3 ? 'Exact · +3' : pts ? 'Right · +1' : 'Wrong'}</span></div>); })}
          {me && !Object.keys(me.picks).length && <p className="empty">No picks yet.</p>}
          {st.matches.filter(m => m.split).map(m => (
            <div className="m" key={m.id}><div className="r"><span>Community · {m.label}</span><span>{m.split!.total} picks</span></div>
              {[m.a, m.b].map(t => <div className="bar2" key={t}><span>{t}</span><div className="bar"><i style={{ width: pct(m.split!.byTeam[t] ?? 0, m.split!.total) + '%' }} /></div><b>{pct(m.split!.byTeam[t] ?? 0, m.split!.total)}%</b></div>)}</div>))}
          {revealed.map(p => { const [w, n] = Object.entries(p.frozen!.counts).sort((a, b) => b[1] - a[1])[0] ?? ['', 0]; return (
            <div className="m" key={p.id}><div className="r"><span>Community MVP · {p.label}</span><em>{pct(n, p.frozen!.total)}%</em></div><div className="big">{w}</div><div className="bar"><i style={{ width: pct(n, p.frozen!.total) + '%' }} /></div></div>); })}
        </>}
      </main>
      {toast && <div className={'toast' + (toast.bad ? ' bad' : '')} role="status" aria-live="polite">{toast.text}</div>}
    </div>
  );
}

function Header({ me, st, onOut }: { me: Me | null; st: State | null; onOut?: () => void }) {
  const [dev, setDev] = useState('');
  return (
    <header className="top">
      <img src="/brand/overdrive/logo.png" alt="Overdrive" className="brand" />
      {me ? <button className="u" onClick={onOut} title="Sign out">{me.name} · sign out</button>
        : st?.dev ? <form onSubmit={async e => { e.preventDefault(); await api('/auth/dev', { name: dev }); location.reload(); }}><input aria-label="Test name" value={dev} onChange={e => setDev(e.target.value)} placeholder="test name" className="u" /></form>
        : st?.signIn ? <a className="u tw" href="/auth/twitch">Sign in with Twitch</a> : null}
    </header>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

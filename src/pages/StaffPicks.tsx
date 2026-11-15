/**
 * /staff-picks?key=… — internal staff pick'em. Each caster / staff member chooses their name, then picks the winner
 * and the series score of every match whose teams are known. Picks lock when the match starts; until then you see
 * only your own picks and who has picked. Points: 1 for the winner, 3 for the winner and the exact score.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Logo } from '../components/Brand';
import { PICK_SCORES, wcLogo } from '../../shared/wildcard';
import type { StaffBoard, StaffMatch } from '../../shared/staffPicks';
import { query } from '../lib/hooks';

const ACCENT = '#ff3b1f';
const NAME_KEY = 'od.staffpicks.name';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };
const when = (t: number | null) => (t ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const GROUPS: [string, (id: string) => boolean][] = [['Upper bracket', id => id.includes('_UB')], ['Lower bracket', id => id.includes('_LB')], ['Grand final', id => id.includes('_GF')]];

export function StaffPicks() {
  const key = query().get('key') ?? '';
  const [me, setMe] = useState<string | null>(() => read(NAME_KEY));
  const [board, setBoard] = useState<StaffBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<'picks' | 'table'>('picks');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/staff-picks?key=${encodeURIComponent(key)}${me ? `&name=${encodeURIComponent(me)}` : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (r.status === 403) { setDenied(true); return; }
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setBoard(j); setErr(null);
    } catch (e) { setErr(`Cannot reach the server: ${(e as Error).message}`); }
  }, [key, me]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  // The chosen name must still be on the staff list.
  useEffect(() => { if (board && me && !board.roster.some(n => n.toLowerCase() === me.toLowerCase())) { setMe(null); write(NAME_KEY, null); } }, [board, me]);

  const pick = async (m: StaffMatch, team: string | null, score: string | null) => {
    if (!me) return;
    const cur = board?.mine[m.id];
    const next = team === null && score === null ? null : { team: team ?? cur?.team ?? '', score: score ?? cur?.score ?? '' };
    // Local first (a half-made pick: team without score, or score without team, is kept here until complete).
    setBoard(b => (b ? { ...b, mine: next ? { ...b.mine, [m.id]: next } : Object.fromEntries(Object.entries(b.mine).filter(([k]) => k !== m.id)) } : b));
    if (next && (!next.team || !next.score)) return;
    setBusy(m.id);
    try {
      const r = await fetch('/api/staff-picks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, name: me, match: m.id, pick: next }) });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error ?? 'Not saved'); load(); } else { setBoard(j); setErr(null); }
    } catch (e) { setErr(`Not saved: ${(e as Error).message}`); } finally { setBusy(null); }
  };

  const open = useMemo(() => board?.matches.filter(m => m.ready && !m.locked) ?? [], [board]);
  const missing = open.filter(m => { const p = board?.mine[m.id]; return !p?.team || !p?.score; }).length;

  if (denied) return <Shell><div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-[15px] text-red-200">This staff pick'em link is invalid or has been replaced. Ask the producer for the new one.</div></Shell>;
  if (!board) return <Shell><div className="text-white/60">{err ?? 'Loading…'}</div></Shell>;
  if (!me) return (
    <Shell>
      <h1 className="mb-1 text-[22px] font-bold">Who are you?</h1>
      <p className="mb-5 text-[14px] text-white/55">Pick your name. This device remembers it.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-staff-names>
        {board.roster.map(n => <button key={n} type="button" onClick={() => { setMe(n); write(NAME_KEY, n); }} className="h-[54px] rounded-[8px] border border-white/15 bg-white/[0.04] text-[17px] font-semibold hover:border-white/40" data-staff-name={n}>{n}</button>)}
      </div>
      <p className="mt-5 text-[13px] text-white/40">Not on the list? Ask the producer to add you.</p>
    </Shell>
  );

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="text-[20px] font-bold" data-staff-me>{me}</div>
        <button type="button" className="text-[13px] text-white/50 underline" onClick={() => { setMe(null); write(NAME_KEY, null); }}>not you?</button>
        <div className="ml-auto flex overflow-hidden rounded-[8px] border border-white/15">
          {(['picks', 'table'] as const).map(t => <button key={t} type="button" onClick={() => setTab(t)} className="h-[38px] px-4 text-[14px] font-semibold" style={tab === t ? { background: ACCENT } : undefined} data-staff-tab={t}>{t === 'picks' ? 'My picks' : 'Leaderboard'}</button>)}
        </div>
      </div>
      <p className="mb-4 text-[13px] text-white/50">{board.scoring}. Picks lock when a match starts; everyone's picks show after that.</p>
      {err && <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[14px] text-red-200" data-staff-error>{err}</div>}
      {tab === 'picks' ? <>
        {open.length > 0 && <div className="mb-4 text-[14px]" style={{ color: missing ? '#ffb020' : '#3ddc84' }} data-staff-missing={missing}>{missing ? `${missing} open match${missing > 1 ? 'es' : ''} still to pick` : 'All open matches picked ✓'}</div>}
        {GROUPS.map(([g, f]) => { const ms = board.matches.filter(m => f(m.id)); return (
          <section key={g} className="mb-6">
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-white/50">{g}</h2>
            <div className="grid gap-2.5 md:grid-cols-2">{ms.map(m => <MatchCard key={m.id} m={m} me={me} mine={board.mine[m.id]} busy={busy === m.id} onPick={(t, s) => pick(m, t, s)} />)}</div>
          </section>); })}
      </> : <Table board={board} me={me} />}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#121212] text-white">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-4"><Logo height={38} /><div className="text-[12px] font-semibold tracking-[0.24em] text-white/70">STAFF PICK'EM · INTERNAL</div></div>
        {children}
      </div>
    </div>
  );
}

function Team({ name, on, disabled, onClick, result }: { name: string; on: boolean; disabled: boolean; onClick: () => void; result?: 'won' | 'lost' }) {
  const logo = wcLogo(name);
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-staff-team={name}
      className="flex h-[48px] min-w-0 flex-1 items-center gap-2 rounded-[8px] border px-3 text-left text-[15px] font-bold disabled:cursor-default"
      style={on ? { background: ACCENT, borderColor: ACCENT } : { borderColor: 'rgba(255,255,255,.15)', opacity: result === 'lost' ? 0.5 : 1 }}>
      {logo ? <img src={logo} alt="" className="h-[26px] w-[26px] flex-none object-contain" /> : null}<span className="truncate">{name}</span>{result === 'won' && <span className="ml-auto text-[12px]">WIN</span>}
    </button>
  );
}

function MatchCard({ m, me, mine, busy, onPick }: { m: StaffMatch; me: string; mine?: { team: string; score: string }; busy: boolean; onPick: (team: string | null, score: string | null) => void }) {
  const editable = m.ready && !m.locked;
  const status = !m.ready ? 'Teams not known yet' : m.result ? `Final · ${m.result.winner} ${m.result.score}` : m.locked ? 'Started · picks locked' : `Open${m.start ? ` · starts ${when(m.start)}` : ''}`;
  const myPts = m.picks ? Object.entries(m.picks).find(([n]) => n.toLowerCase() === me.toLowerCase())?.[1].points : undefined;
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.03] p-3" data-staff-match={m.id} data-staff-locked={m.locked ? 'yes' : 'no'}>
      <div className="mb-2 flex items-center gap-2 text-[13px]"><b className="text-white/85">{m.label}</b><span className="ml-auto text-white/45">{status}</span></div>
      {m.ready ? <>
        <div className="flex gap-2">
          <Team name={m.t1!} on={mine?.team === m.t1} disabled={!editable} onClick={() => onPick(m.t1!, null)} result={m.result ? (m.result.winner === m.t1 ? 'won' : 'lost') : undefined} />
          <Team name={m.t2!} on={mine?.team === m.t2} disabled={!editable} onClick={() => onPick(m.t2!, null)} result={m.result ? (m.result.winner === m.t2 ? 'won' : 'lost') : undefined} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {PICK_SCORES.map(s => <button key={s} type="button" disabled={!editable} onClick={() => onPick(null, s)} data-staff-score={s}
            className="h-[38px] flex-1 rounded-[8px] border text-[15px] font-bold disabled:cursor-default" style={mine?.score === s ? { background: '#fff', color: '#000', borderColor: '#fff' } : { borderColor: 'rgba(255,255,255,.15)' }}>{s}</button>)}
          {editable && mine && <button type="button" className="px-1 text-[12px] text-white/45 underline" onClick={() => onPick(null, null)}>clear</button>}
        </div>
        <div className="mt-2 min-h-[18px] text-[12.5px] text-white/50">
          {busy ? 'Saving…' : editable ? (mine?.team && mine?.score ? '✓ Saved' : mine?.team || mine?.score ? 'Pick the winner and the score' : '')
            : !mine ? 'You did not pick this match' : m.result && myPts != null ? `Your pick: ${mine.team} ${mine.score} · ${myPts} pt${myPts === 1 ? '' : 's'}` : `Your pick: ${mine.team} ${mine.score}`}
        </div>
        {m.picks ? (
          <div className="mt-1 flex flex-wrap gap-1.5 text-[12px]" data-staff-all-picks>
            {Object.entries(m.picks).map(([n, p]) => <span key={n} className="rounded-[5px] bg-white/[0.06] px-1.5 py-0.5"><b>{n}</b> {p.team} {p.score}{p.points != null ? <span style={{ color: p.points ? '#3ddc84' : 'rgba(255,255,255,.4)' }}> +{p.points}</span> : null}</span>)}
            {!Object.keys(m.picks).length && <span className="text-white/40">No picks</span>}
          </div>
        ) : m.pickedBy.length > 0 && <div className="text-[12px] text-white/40">Picked: {m.pickedBy.join(', ')}</div>}
      </> : <div className="text-[13px] text-white/40">{m.t1 || 'TBD'} vs {m.t2 || 'TBD'}</div>}
    </div>
  );
}

function Table({ board, me }: { board: StaffBoard; me: string }) {
  let rank = 0, prev = -1;
  return (
    <table className="w-full text-[15px]" data-staff-table>
      <thead><tr className="text-left text-[12px] uppercase tracking-[0.12em] text-white/45"><th className="py-2 pr-2">#</th><th>Name</th><th className="text-right">Pts</th><th className="text-right">Winners</th><th className="text-right">Exact</th><th className="text-right">Played</th></tr></thead>
      <tbody>{board.table.map((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points; } return (
        <tr key={r.name} className="border-t border-white/[0.07]" style={r.name.toLowerCase() === me.toLowerCase() ? { background: 'rgba(255,59,31,.12)' } : undefined}>
          <td className="py-2 pr-2 text-white/50">{rank}</td><td className="font-semibold">{r.name}</td><td className="text-right font-bold">{r.points}</td><td className="text-right">{r.right}</td><td className="text-right">{r.exact}</td><td className="text-right text-white/50">{r.played}</td>
        </tr>); })}</tbody>
    </table>
  );
}

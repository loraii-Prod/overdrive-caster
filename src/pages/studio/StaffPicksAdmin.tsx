/**
 * Studio → Graphics & Data → Staff pick'em: the private link for the staff, the staff list, match locks, everyone's
 * picks (the producer sees them before the start; the staff do not) and the leaderboard.
 */
import { useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import { WC_IDS, matchName, shortCode, wcResolve } from '../../../shared/wildcard';
import { DEFAULT_STAFF, emptyStaffPicks, staffLocked, staffTable, type StaffOp } from '../../../shared/staffPicks';
import type { Ctx } from '../producer/modules';
import { Btn, Card, I, Pill, S, Select } from './kit';

export function StaffPicksAdmin({ st, x }: { st: ControllerState; x: Ctx }) {
  const sp = st.staffPicks ?? emptyStaffPicks('');
  const wc = x.wc;
  const op = (o: StaffOp, label: string) => x.run({ c: 'staff', op: o }, label);
  const [add, setAdd] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<'key' | 'reset' | null>(null);
  const url = `${location.origin}/staff-picks?key=${encodeURIComponent(sp.key)}`;
  const R = wcResolve(wc.matches, wc.teams);
  const ids = WC_IDS.filter(id => R[id].t1 && R[id].t2 && R[id].t1 !== 'BYE' && R[id].t2 !== 'BYE');
  const table = staffTable(sp, wc);
  const pickOf = (id: string, name: string) => Object.entries(sp.picks[id] ?? {}).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
  const names = [...sp.roster, ...table.map(r => r.name).filter(n => !sp.roster.some(r => r.toLowerCase() === n.toLowerCase()))];
  const addName = () => { const n = add.trim(); if (!n) return; op({ k: 'roster', names: [...sp.roster, n] }, `Staff: add ${n}`); setAdd(''); };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };

  return (
    <div className="space-y-3" data-staff-admin>
      <Card title="Staff pick'em link" icon={I.link} className="flex-none" actions={<Pill tone="warn">Internal · do not share publicly</Pill>}>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[6px] border px-3 py-2 text-[13px]" style={{ borderColor: S.line2 }} data-staff-url>{url}</code>
          <Btn onClick={copy} icon={I.link}>{copied ? 'Copied ✓' : 'Copy link'}</Btn>
          <Btn onClick={() => window.open(url, '_blank')}>Open ↗</Btn>
          <Btn kind={confirm === 'key' ? 'danger' : 'default'} onClick={() => { if (confirm !== 'key') return setConfirm('key'); setConfirm(null); op({ k: 'new-key' }, 'New staff pick\'em link'); }}>{confirm === 'key' ? 'Confirm: old link stops working' : 'New link'}</Btn>
        </div>
        <p className="mt-2 text-[13px] text-white/50">Send this one link to all casters. Each one picks their name, then the winner and the series score of every match. Picks lock when a match starts (start time, first score, or your lock). Scoring: 1 point for the winner, 3 for the winner and the exact score.</p>
      </Card>

      <Card title={`Staff (${sp.roster.length})`} icon={I.talent} className="flex-none">
        <div className="flex flex-wrap gap-2">
          {sp.roster.map(n => (
            <span key={n} className="flex h-[36px] items-center gap-2 rounded-[7px] border pl-3 pr-1 text-[14px] font-semibold" style={{ borderColor: S.line2 }} data-staff-roster={n}>{n}
              <button type="button" title={`Remove ${n} (their picks are kept)`} className="h-[28px] w-[28px] rounded-[5px] text-white/45 hover:bg-white/10 hover:text-white" onClick={() => op({ k: 'roster', names: sp.roster.filter(r => r !== n) }, `Staff: remove ${n}`)}>×</button></span>
          ))}
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); addName(); }}>
            <input value={add} onChange={e => setAdd(e.target.value)} placeholder="Add a name" aria-label="Add a staff member" className="h-[36px] w-[160px] rounded-[7px] border bg-black px-3 text-[14px] outline-none" style={{ borderColor: S.line2 }} />
            <Btn size="sm" icon={I.plus} disabled={!add.trim()} onClick={addName}>Add</Btn>
          </form>
          {DEFAULT_STAFF.some(n => !sp.roster.some(r => r.toLowerCase() === n.toLowerCase())) && <Btn size="sm" onClick={() => op({ k: 'roster', names: [...sp.roster, ...DEFAULT_STAFF.filter(n => !sp.roster.some(r => r.toLowerCase() === n.toLowerCase()))] }, 'Staff: default list')}>Add the default staff</Btn>}
        </div>
      </Card>

      <Card title="Picks by match" icon={I.data} className="flex-none" bodyClass="p-0" actions={<Btn size="sm" kind={confirm === 'reset' ? 'danger' : 'default'} onClick={() => { if (confirm !== 'reset') return setConfirm('reset'); setConfirm(null); op({ k: 'reset' }, 'Staff pick\'em reset'); }}>{confirm === 'reset' ? 'Confirm: delete every pick' : 'Reset all picks'}</Btn>}>
        {!ids.length ? <div className="p-5 text-[14px] text-white/50">No match has both teams yet: set the teams and seeding first.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]" data-staff-grid>
              <thead>
                <tr className="text-left text-white/55">
                  <th className="sticky left-0 z-10 bg-[#141416] px-3 py-2">Match</th>
                  {ids.map(id => { const lockedNow = staffLocked(sp, wc, id), ov = sp.locks[id];
                    return <th key={id} className="min-w-[128px] px-2 py-2 align-top font-normal" title={matchName(id)}>
                      <div className="font-bold text-white/85">{shortCode(id)}</div>
                      <div className="truncate text-[11.5px]">{R[id].t1} v {R[id].t2}</div>
                      <div className="mt-1 flex items-center gap-1">{R[id].winner ? <Pill tone="ok">Final</Pill> : lockedNow ? <Pill tone="pgm">Locked</Pill> : <Pill tone="pvw">Open</Pill>}</div>
                      {!R[id].winner && <Select ariaLabel={`Lock ${shortCode(id)}`} className="mt-1 !h-[30px] !text-[12px]" value={ov === true ? 'locked' : ov === false ? 'open' : 'auto'} options={[['auto', 'Auto (start)'], ['locked', 'Lock now'], ['open', 'Keep open']]} onChange={v => op({ k: 'lock', match: id, state: v as 'auto' | 'locked' | 'open' }, `Staff pick'em ${shortCode(id)}: ${v}`)} />}
                    </th>; })}
                  <th className="px-3 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {names.map(n => { const row = table.find(r => r.name.toLowerCase() === n.toLowerCase());
                  return <tr key={n} className="border-t" style={{ borderColor: S.line }} data-staff-row={n}>
                    <td className="sticky left-0 z-10 bg-[#141416] px-3 py-1.5 font-semibold">{n}{!sp.roster.includes(n) && <span className="ml-1 text-[11px] text-white/40">(removed)</span>}</td>
                    {ids.map(id => { const p = pickOf(id, n), w = R[id].winner, ok = p && w ? p.team === w : null;
                      return <td key={id} className="group px-2 py-1.5" style={{ color: ok === true ? '#3ddc84' : ok === false ? 'rgba(255,255,255,.4)' : undefined }}>
                        {p ? <span className="flex items-center gap-1"><span className="truncate">{p.team} {p.score}</span>
                          <button type="button" title={`Remove ${n}'s pick`} className="hidden text-white/40 hover:text-white group-hover:inline" onClick={() => op({ k: 'remove', match: id, name: n }, `Remove ${n}'s pick`)}>×</button></span> : <span className="text-white/25">—</span>}
                      </td>; })}
                    <td className="px-3 py-1.5 text-right font-bold">{row?.points ?? 0}</td>
                  </tr>; })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Leaderboard" icon={I.check} className="flex-none">
        <div className="grid gap-x-6 gap-y-1 text-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }} data-staff-leaderboard>
          {table.map((r, i) => <div key={r.name} className="flex items-center gap-3 border-b py-1.5" style={{ borderColor: S.line }}>
            <span className="w-[22px] text-white/45">{i + 1}</span><b className="flex-1">{r.name}</b><span className="tabular-nums">{r.points} pts</span><span className="w-[110px] text-right text-[12px] text-white/45">{r.right} right · {r.exact} exact</span></div>)}
        </div>
      </Card>
    </div>
  );
}

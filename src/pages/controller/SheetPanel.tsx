import { useEffect, useState } from 'react';
import { sheetLink, type SheetState } from '../../../shared/sheet';
import { Dot, Switch, TextField } from './ui';

/** Google Sheet (read-only) source: teams, players, bracket, schedule, live scores of the featured match. */
export function SheetPanel({ sheet, send }: { sheet: SheetState | undefined; send: (m: any) => void }) {
  const s = sheet;
  const cur = s ? sheetLink(s) : '';
  const [url, setUrl] = useState(cur);
  useEffect(() => { setUrl(cur); }, [cur]);
  const upcoming = (s?.matches ?? []).filter(m => m.status !== 'COMPLETED' && m.status.toLowerCase() !== 'not played').sort((a, b) => (a.at ?? 9e15) - (b.at ?? 9e15));
  const recent = (s?.matches ?? []).filter(m => m.status === 'COMPLETED').sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 6);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
        <TextField value={url} onChange={setUrl} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=… (the event data tab) or a “Publish to the web” CSV link" mono />
        <Switch on={!!s?.enabled} onChange={v => send({ t: 'sheet-set', url, enabled: v })} label="Auto-sync (60 s)" />
        <button type="button" className="btn-primary" onClick={() => send({ t: 'sheet-set', url, enabled: s?.enabled ?? true })}>Save & sync</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/55">
        <Dot tone={s?.error ? 'bad' : s?.lastAt ? 'ok' : 'off'} />
        {s?.error ? <span className="text-amber-300/85">{s.error}</span> : s?.lastAt ? <>Synced {new Date(s.lastAt).toLocaleTimeString()} · {s.teams.length} teams · {s.matches.length} matches</> : 'Not synced yet'}
        {s?.id && <button type="button" className="btn-xs" onClick={() => send({ t: 'sheet-sync' })}>Sync now</button>}
        <span className="text-white/35">Read-only: the tool only downloads a CSV copy, it never writes to the sheet.</span>
      </div>
      {s && s.matches.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-white/45">Upcoming · click to put on the scoreboard</div>
            <div className="max-h-[260px] space-y-1 overflow-auto">
              {upcoming.map(m => (
                <button key={m.id} type="button" onClick={() => send({ t: 'sheet-feature', id: s.featured === m.id ? null : m.id })}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] ${s.featured === m.id ? 'bg-[#e5484d]/25 ring-1 ring-[#e5484d]' : 'bg-white/[0.03] hover:bg-white/[0.07]'}`}>
                  <span className="w-[74px] flex-none text-white/45">{m.time || '—'}</span>
                  <span className="min-w-0 flex-1 truncate">{m.t1.name} <span className="text-white/35">vs</span> {m.t2.name}</span>
                  <span className="text-[10.5px] text-white/35">{m.bracket}</span>
                  {s.featured === m.id && <span className="rounded bg-[#e5484d] px-1.5 text-[10px] font-bold">ON SCOREBOARD</span>}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-white/45">Latest results</div>
            <div className="space-y-1">
              {recent.map(m => (
                <button key={m.id} type="button" onClick={() => send({ t: 'sheet-feature', id: s.featured === m.id ? null : m.id })}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] ${s.featured === m.id ? 'bg-[#e5484d]/25 ring-1 ring-[#e5484d]' : 'bg-white/[0.03] hover:bg-white/[0.07]'}`}>
                  <span className="min-w-0 flex-1 truncate">{m.t1.name} <b className="text-white">{m.s1}-{m.s2}</b> {m.t2.name}</span>
                  <span className="text-[10.5px] text-white/35">{m.bracket}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-white/40">
        The featured match feeds the scoreboard (names, logos, BO, series score) and updates on every sync. Bracket and Matches screens, the next match counter and the player list come from the sheet too. Team logos are read from the “logos” tab.
      </p>
    </div>
  );
}

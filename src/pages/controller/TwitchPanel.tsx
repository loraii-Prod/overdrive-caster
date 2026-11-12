import { useEffect, useState, type ReactNode } from 'react';
import type { ClientMsg } from '../../../shared/protocol';
import type { TwitchPublic, TwitchStatus, TwOp, TwShow } from '../../../shared/twitch';
import { TwitchCard } from '../../components/wildcard/Twitch';
import { ScaledCanvas } from '../../components/Stage';
import { CopyField, Dot, Switch, TextField } from './ui';

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#171717] p-4">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">{title}</h2>
        {note && <span className="text-[11px] text-white/35">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const SHOW: { k: keyof TwShow; label: string }[] = [
  { k: 'gameplay', label: 'Gameplay (right side)' },
  { k: 'casters', label: 'Casters (top left)' },
  { k: 'warmup', label: 'Player / team card' },
  { k: 'intermission', label: 'Starting / BRB / Thanks (top right)' },
];

/** Twitch predictions & polls: connection, where the card shows, and running them from here. */
export function TwitchPanel({ status, tw, send, now, teams, origin, keyQ }: {
  status: TwitchStatus | undefined; tw: TwitchPublic | null | undefined; send: (m: ClientMsg) => void; now: number;
  /** Match intro teams, used as the default prediction outcomes. */
  teams: [string, string]; origin: string; keyQ: string;
}) {
  const op = (o: TwOp) => send({ t: 'tw', op: o });
  const [clientId, setClientId] = useState(status?.clientId ?? '');
  useEffect(() => { setClientId(status?.clientId ?? ''); }, [status?.clientId]);
  const [pTitle, setPTitle] = useState('Who wins this match?');
  const [pOut, setPOut] = useState<[string, string]>(teams);
  useEffect(() => { if (teams[0] && teams[1]) setPOut(teams); }, [teams[0], teams[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pSec, setPSec] = useState(120);
  const [qTitle, setQTitle] = useState('');
  const [qChoices, setQChoices] = useState('');
  const [qSec, setQSec] = useState(60);
  if (!status) return null;
  const pr = tw?.prediction, po = tw?.poll;
  const prOpen = pr && (pr.status === 'ACTIVE' || pr.status === 'LOCKED');
  const poOpen = po && po.status === 'ACTIVE';
  return (
    <>
      <Card title="Twitch connection" note="Predictions and polls need an Affiliate or Partner channel">
        {status.connected ? (
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <Dot tone={status.error ? 'warn' : 'ok'} />Connected as <b>{status.login || 'your channel'}</b>
            {status.lastPoll > 0 && <span className="text-[11px] text-white/40">updated {Math.max(0, Math.round((now - status.lastPoll) / 1000))} s ago</span>}
            <button type="button" className="btn-sm ml-auto" onClick={() => op({ k: 'disconnect' })}>Disconnect</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[360px]"><TextField mono value={clientId} onChange={setClientId} placeholder="Client ID of your Twitch app" /></div>
              <button type="button" className="btn-sm" disabled={clientId === status.clientId} onClick={() => op({ k: 'client-id', clientId })}>Save</button>
              <button type="button" className="btn-primary" disabled={!status.clientId} onClick={() => op({ k: 'connect' })}>Connect</button>
            </div>
            {status.device && (
              <div className="rounded-md border border-[#9146FF]/60 bg-[#9146FF]/15 p-3 text-[13px]">
                On the <b>broadcaster's</b> Twitch account, open <a className="font-semibold underline" href={status.device.uri} target="_blank" rel="noreferrer">{status.device.uri.replace(/^https?:\/\//, '')}</a> and enter
                <span className="mx-2 rounded bg-black/40 px-2 py-0.5 font-mono text-[18px] font-bold tracking-[0.2em]">{status.device.code}</span>
                <span className="text-white/50">· this page updates by itself</span>
              </div>
            )}
            <details className="text-[12px] leading-relaxed text-white/55">
              <summary className="cursor-pointer text-white/75">One-time setup (5 minutes)</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Go to dev.twitch.tv/console/apps (any Twitch account with two-factor on) → <b>Register Your Application</b>.</li>
                <li>Name: anything (e.g. “Overdrive caster”). OAuth Redirect URL: <code>http://localhost</code>. Category: Broadcasting Suite. Client Type: <b>Public</b>.</li>
                <li>Copy the <b>Client ID</b> here, Save, then Connect and sign in with the channel the predictions run on.</li>
              </ol>
              <p className="mt-1 text-white/40">No secret is needed. The sign-in stays on this server; Disconnect removes it.</p>
            </details>
          </div>
        )}
        {status.error && <p className="mt-2 text-[12px] text-amber-300/85">{status.error}</p>}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[0.06] pt-3">
          {SHOW.map(s => <Switch key={s.k} on={!!tw?.show[s.k]} onChange={v => op({ k: 'show', patch: { [s.k]: v } })} label={s.label} />)}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5">
        <Card title="Prediction" note={pr ? pr.status.toLowerCase() : 'none yet'}>
          {!prOpen ? (
            <div className="space-y-2">
              <TextField value={pTitle} onChange={setPTitle} placeholder="Question (45 characters)" />
              <div className="grid grid-cols-2 gap-2">
                <TextField value={pOut[0]} onChange={v => setPOut([v, pOut[1]])} placeholder="Outcome 1 (e.g. team A)" />
                <TextField value={pOut[1]} onChange={v => setPOut([pOut[0], v])} placeholder="Outcome 2 (e.g. team B)" />
              </div>
              <div className="flex items-center gap-2 text-[12px] text-white/60">
                Open for <input className="input h-8 w-20" type="number" min={30} max={1800} value={pSec} onChange={e => setPSec(Number(e.target.value) || 120)} /> s
                <button type="button" className="btn-primary ml-auto" disabled={!status.connected || !pOut[0].trim() || !pOut[1].trim()}
                  onClick={() => op({ k: 'prediction-start', title: pTitle, outcomes: pOut, seconds: pSec })}>Start prediction</button>
              </div>
              <p className="text-[11px] text-white/40">Outcomes fill in from the match intro teams.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[13px] font-semibold">{pr!.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {pr!.status === 'ACTIVE' && <button type="button" className="btn-sm" onClick={() => op({ k: 'prediction-lock' })}>Lock now</button>}
                {pr!.outcomes.map(o => <button key={o.id} type="button" className="btn-sm" onClick={() => op({ k: 'prediction-resolve', outcomeId: o.id })}>Winner: {o.title}</button>)}
                <button type="button" className="btn-sm text-amber-300" onClick={() => op({ k: 'prediction-cancel' })}>Cancel (refund)</button>
              </div>
            </div>
          )}
        </Card>
        <Card title="Poll" note={po ? po.status.toLowerCase() : 'none yet'}>
          {!poOpen ? (
            <div className="space-y-2">
              <TextField value={qTitle} onChange={setQTitle} placeholder="Question (60 characters)" />
              <TextField value={qChoices} onChange={setQChoices} placeholder="Choices, separated by commas (2 to 5)" />
              <div className="flex items-center gap-2 text-[12px] text-white/60">
                Runs for <input className="input h-8 w-20" type="number" min={15} max={1800} value={qSec} onChange={e => setQSec(Number(e.target.value) || 60)} /> s
                <button type="button" className="btn-primary ml-auto" disabled={!status.connected || qChoices.split(',').filter(c => c.trim()).length < 2}
                  onClick={() => op({ k: 'poll-start', title: qTitle, choices: qChoices.split(','), seconds: qSec })}>Start poll</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-[13px] font-semibold">{po!.title}</div>
              <button type="button" className="btn-sm" onClick={() => op({ k: 'poll-end' })}>End now</button>
            </div>
          )}
        </Card>
      </div>

      <Card title="On stream" note="What the card shows right now (also when started from Twitch itself)">
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <div className="monitor-bg aspect-video w-full overflow-hidden rounded-md border border-white/10">
            <ScaledCanvas><div className="relative h-[1080px] w-[1920px]"><TwitchCard tw={tw} now={now} style={{ left: 740, top: 300, width: 440 }} /></div></ScaledCanvas>
          </div>
          <div className="w-[360px]"><CopyField value={`${origin}/output/twitch${keyQ}`} label="Card on its own (?corner=left, ?top=…)" /></div>
        </div>
      </Card>
    </>
  );
}

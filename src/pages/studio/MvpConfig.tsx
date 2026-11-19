/**
 * Studio Mode: configuration of an MVP & Awards scene (in Scene settings, like every scene). Everything here is
 * saved to the current event: the MVP graphic's settings (match, countdown, reveal animation, live-voting options)
 * go to the server with `mvp-settings` (never a reveal), candidates and analyst picks to the vote service, the
 * scenes' transition and music to their show-rundown segments. Operating the vote stays in Producer Mode.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import { matchName, WC_IDS, wcResolve } from '../../../shared/wildcard';
import { pcts } from '../../../shared/audience';
import { mediaName } from '../../../shared/media';
import { MVP_SEQUENCE, SEG_TRANSITIONS, type SegTransition } from '../../../shared/showplan';
import { REGISTRY, type SourceDef } from '../../../shared/registry';
import { Qr } from '../../components/Qr';
import type { Ctx, Run } from '../producer/modules';
import { CardEditor } from '../producer/audienceModules';
import { ChatVotingPanel } from '../producer/ChatVoting';
import { mvpSceneData } from '../producer/MvpScene';
import { PortraitManager } from './Portraits';
import { Btn, COND, Card, Field, I, Pill, S, Select, Toggle } from './kit';

const COUNTDOWNS: [string, string][] = [['0', 'No timer (closed by hand)'], ['60', '1 minute'], ['90', '90 seconds'], ['120', '2 minutes'], ['180', '3 minutes'], ['300', '5 minutes']];
const PACES: [string, string][] = [['cinematic', 'Cinematic (approved timing)'], ['standard', 'Standard (1.4× faster)'], ['quick', 'Quick (2× faster)']];
const MVP_SCENES = REGISTRY.filter(s => s.gfx === 'mvp' && s.gfxView);

export function MvpSceneConfig({ st, run, x, src }: { st: ControllerState; run: Run; x: Ctx; src: SourceDef }) {
  const a = x.aud!;
  const D = mvpSceneData(x, a);
  const g = D.g;
  const save = (patch: Record<string, string | number | boolean>, label: string) => run({ c: 'mvp-settings', patch }, label);
  const R = wcResolve(x.wc.matches, x.wc.teams);
  const done = WC_IDS.filter(id => R[id].winner && R[id].winner !== 'BYE' && R[id].t1 && R[id].t2);
  const [pick, setPick] = useState<string[]>([]);
  useEffect(() => { setPick(D.poll ? D.poll.players.slice(0, 4).map(p => p.handle) : D.roster.slice(0, 4).map(p => p.handle)); }, [D.match, D.poll?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const aud = async (op: Parameters<typeof a.op>[0], label: string) => setErr(await a.op(op, label));
  const [lib, setLib] = useState<{ url: string }[]>([]);
  useEffect(() => { fetch('/api/media').then(r => (r.ok ? r.json() : null)).then(j => j?.items && setLib(j.items)).catch(() => {}); }, []);
  const mediaOpts: [string, string][] = useMemo(() => [['', 'No music'], ...[...new Set([...(st.media?.playlist ?? []), ...lib.map(l => l.url)])].map(u => [u, mediaName(u)] as [string, string])], [st.media?.playlist, lib]);
  const plan = st.plan;
  const segOf = (id: string) => plan?.segments.find(s => s.target === `s:${id}`);
  const missing = MVP_SEQUENCE.filter(m => !plan?.segments.some(s => s.target === m.target));
  const addSequence = async () => {
    const last = plan ? Math.max(-1, ...plan.segments.map((s, i) => (s.target && MVP_SEQUENCE.some(m => m.target === s.target) ? i : -1))) : -1;
    let at = last >= 0 ? last + 1 : plan?.segments.length ?? 0;
    for (const m of missing) { await run({ c: 'sp-seg-add', seg: { label: m.label, target: m.target, dur: m.dur, transition: m.transition, confirm: m.confirm }, at }, `Rundown: ${m.label}`); at++; }
  };
  const qr = a.aud?.qr.find(q => q.id === 'vote');
  const poll = D.poll, locked = !!poll && poll.status !== 'draft';
  const counts = poll?.status === 'open' ? poll.counts ?? {} : poll?.frozen?.counts ?? {};
  const rows = (poll?.players ?? []).slice(0, 4).map(p => [p.handle, counts[p.handle] ?? 0] as [string, number]).sort((p, q) => q[1] - p[1]);
  const share = pcts(rows.map(r => r[1]));
  const seats = [1, 2, 3, 4, 5].filter(s => st.live.casters.find(c => c.id === s)?.enabled);
  const onAir = MVP_SCENES.some(s => st.obs.currentScene === `Overdrive · ${s.name}`);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }} data-mvp-config={src.gfxView}>
      <Card title="Match & candidates" icon={I.data} className="flex-none">
        <div className="space-y-3">
          <Field label="Current match" hint={onAir ? 'An MVP scene is on air: changing the match changes it on air too.' : 'The MVP scenes show this match (finished matches only).'}>
            <Select ariaLabel="MVP match" value={String(g?.config.match ?? '')} onChange={v => save({ match: v }, `MVP match: ${v ? matchName(v) : 'none'}`)}
              options={[...(done.includes(String(g?.config.match ?? '')) ? [] : [[String(g?.config.match ?? ''), g?.config.match ? `${matchName(String(g.config.match))} (no result yet)` : '— set automatically by the next result —'] as [string, string]]), ...done.map(id => [id, `${matchName(id)}: ${R[id].t1} vs ${R[id].t2}`] as [string, string])]} />
          </Field>
          {!D.finished ? <div className="text-[14px] text-white/50">MVP voting opens after this match has a result.</div> : <>
            <Field label={`Candidates (${pick.length}/4)`} hint={locked ? `Voting is ${poll!.status}: candidates are fixed.` : 'The voting graphic shows four cards; chat votes use their numbers (!vote 1–4).'}>
              <div className="flex flex-wrap gap-2">{D.roster.map(p => { const on = pick.includes(p.handle), n = pick.indexOf(p.handle);
                return <button key={p.handle} type="button" disabled={locked || (!on && pick.length >= 4)} onClick={() => setPick(s => (s.includes(p.handle) ? s.filter(h => h !== p.handle) : [...s, p.handle]))}
                  className="flex h-[38px] items-center gap-2 rounded-[7px] border px-3 text-[14px] font-semibold disabled:opacity-35" style={on ? { background: '#fff', color: '#000', borderColor: '#fff' } : { borderColor: S.line2 }} data-candidate-chip={p.handle}>
                  {on && <span className="text-[12px] text-black/50">{String(n + 1).padStart(2, '0')}</span>}{p.handle}<span className="text-[12px] opacity-50">{p.team}</span></button>; })}</div>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Btn kind="accent" disabled={locked || pick.length < 2} onClick={() => aud({ k: 'mvp-prepare', match: D.match, players: pick }, 'Prepare MVP candidates')} icon={I.check}>{poll ? 'Update candidates' : 'Prepare candidates'}</Btn>
              <Pill tone={poll?.status === 'open' ? 'pgm' : poll ? 'ok' : 'dim'}>{poll ? poll.status : 'not prepared'}</Pill>
              {poll && <span className="text-[13px] text-white/50">{poll.players.slice(0, 4).map((p, i) => `${i + 1}. ${p.handle}`).join('   ')}</span>}
            </div>
          </>}
          {err && <div className="text-[13px]" style={{ color: S.bad }}>{err}</div>}
        </div>
      </Card>

      <Card title="Voting" icon={I.play} className="flex-none">
        <div className="flex gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <Field label="Voting countdown" hint="Used when voting opens (Producer Mode can still change it).">
              <Select ariaLabel="MVP countdown" value={String(g?.config.countdown ?? 0)} onChange={v => save({ countdown: Number(v) }, 'MVP countdown')}
                options={COUNTDOWNS.some(c => c[0] === String(g?.config.countdown ?? 0)) ? COUNTDOWNS : [...COUNTDOWNS, [String(g?.config.countdown), `${g?.config.countdown} s`]]} />
            </Field>
            <Toggle on={g?.config.liveOrder === true} onChange={v => save({ liveOrder: v }, 'Rank cards by live votes')} label="Rank cards by live votes (only while live totals are on air)" />
            <Toggle on={g?.config.liveCounts === true} onChange={v => save({ liveCounts: v }, 'Vote counts on the cards')} label="Vote counts next to the percentages" />
          </div>
          <div className="flex w-[180px] flex-none flex-col items-center gap-1.5 rounded-[8px] p-2.5" style={{ background: '#F4F2EF', color: '#121212' }} data-mvp-qr-preview>
            {qr ? <><Qr url={qr.url} size={150} /><b className="text-[12px] uppercase tracking-[0.06em]">Scan to vote</b><span className="break-all text-center text-[11px] text-black/55">{qr.url.replace(/^https:\/\//, '')}</span></> : <span className="py-8 text-center text-[12px] text-black/55">No voting address (Audience)</span>}
          </div>
        </div>
        <div className="mt-3"><ChatVotingPanel a={a} poll={poll} now={x.now} /></div>
      </Card>

      <Card title="Analyst MVP" icon={I.talent} className="flex-none">
        {!D.finished ? <div className="text-[14px] text-white/50">Available once the match has a result.</div> : (
          <div className="space-y-2.5">
            {seats.map(s => { const name = st.live.casters.find(c => c.id === s)?.name ?? `Pos ${s}`, cur = D.staff[String(s)]?.player;
              return <div key={s} className="flex flex-wrap items-center gap-1.5"><b className="w-[120px] truncate text-[14px]">{name}</b>
                {D.roster.map(p => <button key={p.handle} type="button" onClick={() => aud({ k: 'staff-mvp', match: D.match, slot: s, player: cur === p.handle ? null : p.handle }, `${name} MVP ${p.handle}`)}
                  className="h-[32px] rounded-[6px] border px-2.5 text-[13px] font-semibold" style={cur === p.handle ? { background: '#fff', color: '#000', borderColor: '#fff' } : { borderColor: S.line2 }}>{p.handle}</button>)}</div>; })}
            {!seats.length && <div className="text-[13px] text-white/50">No talent seated: seat the analysts in Talent → Layouts.</div>}
          </div>
        )}
      </Card>

      <Card title="Community MVP results" icon={I.check} className="flex-none" actions={<Pill tone="warn">Producer only</Pill>}>
        {!poll || poll.status === 'draft' ? <div className="text-[14px] text-white/50">Results appear here once voting is open (live) and freeze when it closes.</div> : (
          <div className="space-y-1.5" data-mvp-results-preview>
            <div className="text-[13px] text-white/55">{poll.status === 'open' ? `Live count: ${poll.total ?? 0} votes` : `Frozen at close: ${poll.frozen?.total ?? 0} votes · ${poll.status === 'revealed' ? 'revealed' : 'not revealed yet'}`}{poll.bySource ? ` · chat ${poll.bySource.chat} · website ${poll.bySource.web}` : ''}</div>
            {rows.map(([h, n], i) => <div key={h} className="flex items-center gap-3 text-[14px]"><span className="w-[120px] truncate font-semibold">{h}</span><div className="h-[8px] flex-1 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${share[i]}%`, background: S.accent }} /></div><span className="w-[90px] text-right tabular-nums">{n} · {share[i]}%</span></div>)}
            <div className="text-[12.5px] text-white/45">Select “Community MVP — Winner Reveal” to see the reveal in Preview. Its browser source draws nothing until the producer reveals it.</div>
          </div>
        )}
      </Card>

      <Card title="Reveal animation" icon={I.play} className="flex-none">
        <div className="space-y-3">
          <Field label="Reveal pace" hint="The approved 9-beat sequence, played faster or slower: same beats, same order.">
            <Select ariaLabel="Reveal pace" value={String(g?.config.revealPace ?? 'cinematic')} onChange={v => save({ revealPace: v }, `Reveal pace: ${v}`)} options={PACES} />
          </Field>
          <Toggle on={g?.config.revealSweep !== false} onChange={v => save({ revealSweep: v }, 'Opening sweep + flare')} label="Opening red sweep + flare" />
          <Toggle on={g?.config.confirmReveal !== false} onChange={v => save({ confirmReveal: v }, 'Reveals need producer confirmation')} label="Reveals need producer confirmation (second click / GO)" />
        </div>
      </Card>

      <Card title="Scene transition & music" icon={I.rundown} className="flex-none" actions={missing.length ? <Btn size="sm" onClick={addSequence} icon={I.plus}>Add {missing.length === MVP_SEQUENCE.length ? 'MVP sequence' : `${missing.length} missing`} to rundown</Btn> : <Pill tone="ok">In the rundown</Pill>}>
        <div className="space-y-1.5">
          {MVP_SCENES.map(s => { const seg = segOf(s.id); return (
            <div key={s.id} className="grid items-center gap-2 text-[13.5px]" style={{ gridTemplateColumns: 'minmax(150px,1fr) 150px minmax(150px,1fr)' }} data-mvp-seg={s.id}>
              <span className={`truncate ${s.id === src.id ? 'font-bold text-white' : 'text-white/70'}`}>{s.name.replace('Community MVP — ', '').replace(' — ', ' · ')}</span>
              {seg ? <>
                <Select ariaLabel={`${s.name} transition`} value={seg.transition} onChange={v => run({ c: 'sp-seg-edit', id: seg.id, patch: { transition: v as SegTransition } }, `${seg.label}: transition`)} options={SEG_TRANSITIONS} />
                <Select ariaLabel={`${s.name} music`} value={seg.media ?? ''} onChange={v => run({ c: 'sp-seg-edit', id: seg.id, patch: { media: v || null } }, `${seg.label}: music`)} options={mediaOpts} />
              </> : <span className="col-span-2 text-white/40">Not in the show rundown</span>}
            </div>); })}
          <div className="pt-1 text-[12.5px] text-white/45">Each MVP scene is its own rundown item: GO / TAKE switches OBS with this transition and starts this music.</div>
        </div>
      </Card>

      {D.finished && <Card title="Reveal card extras" icon={I.data} className="flex-none"><div className="text-[14px]"><CardEditor a={a} match={D.match} roster={D.roster.map(p => p.handle)} suggest={D.community?.handle} /></div></Card>}

      <div className="col-span-full" style={{ height: 'max(760px, 70vh)' }}><div className={`${COND} mb-2 text-[15px] tracking-[0.1em] text-white/80`}>Player portraits</div><PortraitManager st={st} x={x} run={run} /></div>
    </div>
  );
}

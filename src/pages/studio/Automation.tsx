/**
 * Studio Mode 2.0 · AUTOMATION BUILDER. Rules are WHEN (trigger) · WHILE (segment on air) · THEN (steps).
 * Steps run on the server through the production engine as 'auto' commands, so automation never acts while
 * held or right after a manual action, and a refused automatic GO turns into a GO the producer confirms.
 * "Test" describes what a rule would do and changes nothing; "Run now" runs it like the trigger would.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { EngineState } from '../../../shared/engine';
import { MVP_RULES, SEG_TRANSITIONS, actionLabel, fmtDur, triggerLabel, type AutoAction, type AutoRule, type Trigger } from '../../../shared/showplan';
import type { Run } from '../producer/modules';
import { Btn, COND, Card, Empty, Field, I, IconBtn, Input, Pill, S, Select, Toggle, fmtClock } from './kit';
import { segReady } from './model';

const TRIGGERS: [Trigger['k'], string][] = [['countdown-end', 'Countdown reaches zero'], ['media-end', 'Media playback ends'], ['segment-end', "On-air segment's time is up"], ['clock', 'Clock time'], ['mvp-closed', 'MVP voting closes'], ['match-end', 'A match ends']];
const STEP_KINDS: [AutoAction['k'], string][] = [['prepare', 'Prepare a segment'], ['notify', 'Notify the producer'], ['confirm', 'Wait for producer GO'], ['go', 'GO (take prepared segment)'], ['media', 'Media playback'], ['timer', 'Countdown'], ['gfx-next', 'Graphics: TAKE NEXT'], ['obs', 'Switch OBS scene'], ['mvp', 'MVP voting / reveal']];
const blankStep = (k: AutoAction['k']): AutoAction => k === 'prepare' ? { k, seg: 'next' } : k === 'notify' ? { k, text: 'Ready for the next segment' } : k === 'media' ? { k, action: 'play' } : k === 'timer' ? { k, minutes: 5 } : k === 'obs' ? { k, scene: '', transition: 'obs' } : k === 'mvp' ? { k, action: 'reveal', step: 'winner' } : { k } as AutoAction;

const TEMPLATES: { name: string; about: string; rule: Partial<AutoRule> }[] = [
  { name: 'Countdown → prepare, GO with confirmation', about: 'Starting Soon countdown ends → prepare next → notify → producer GO → take → prepare the one after', rule: { name: 'Countdown → next segment', when: { k: 'countdown-end' }, then: [{ k: 'prepare', seg: 'next' }, { k: 'notify', text: 'Next segment ready: press GO' }, { k: 'confirm' }, { k: 'go' }, { k: 'prepare', seg: 'next' }] } },
  { name: 'Ad / video ends → back to the show', about: 'Media playback ends → GO the prepared segment (asks for GO if it needs one)', rule: { name: 'Media end → next segment', when: { k: 'media-end' }, then: [{ k: 'notify', text: 'Media finished' }, { k: 'confirm' }, { k: 'go' }, { k: 'prepare', seg: 'next' }] } },
  { name: 'Segment time up → warn the producer', about: "On-air segment's expected time is up → notification only", rule: { name: 'Time is up', when: { k: 'segment-end' }, then: [{ k: 'notify', text: 'Segment time is up: wrap up' }] } },
  { name: 'MVP: voting closes → reveals with GO', about: 'Results ready → notify → Community MVP (GO) → Analyst MVP (GO) → comparison (GO). Never reveals an unfrozen result.', rule: { name: 'MVP reveal sequence', when: { k: 'mvp-closed' }, during: null, then: [{ k: 'notify', text: 'MVP results ready' }, { k: 'mvp', action: 'reveal', step: 'winner' }, { k: 'mvp', action: 'reveal', step: 'desk' }, { k: 'mvp', action: 'reveal', step: 'compare' }, { k: 'prepare', seg: 'next' }] } },
  { name: 'Clock time → start the pre-show', about: 'At a clock time → 10 min countdown → play media → notify', rule: { name: 'Pre-show start', when: { k: 'clock', at: Date.now() + 3600_000 }, then: [{ k: 'timer', minutes: 10 }, { k: 'media', action: 'play' }, { k: 'notify', text: 'Pre-show countdown started' }] } },
];

const toLocalInput = (ms: number) => { const d = new Date(ms); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export function AutomationBuilder({ st, eng, run, now, openProducer }: { st: ControllerState; eng: EngineState; run: Run; now: number; openProducer: () => void }) {
  const plan = st.plan;
  const rules = plan?.rules ?? [], segs = plan?.segments ?? [];
  const [selId, setSelId] = useState<string | null>(rules[0]?.id ?? null);
  const sel = rules.find(r => r.id === selId) ?? null;
  const [edit, setEdit] = useState<AutoRule | null>(sel);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setEdit(sel ? JSON.parse(JSON.stringify(sel)) : null); setTest(null); }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!selId && rules[0]) setSelId(rules[0].id); }, [rules, selId]);
  const dirty = !!edit && !!sel && JSON.stringify({ ...edit, fired: null }) !== JSON.stringify({ ...sel, fired: null });
  const segName = (id: string) => segs.find(s => s.id === id)?.label ?? 'removed segment';
  const segOpts: [string, string][] = segs.map(s => [s.id, s.label]);
  const save = async () => { if (!edit) return; const a = await run({ c: 'sp-rule-set', rule: { ...edit, fired: undefined } as Partial<AutoRule> }, `Save ${edit.name}`); setTest(a.ok ? { ok: true, text: 'Saved on the server: active for every operator.' } : { ok: false, text: a.error ?? 'Refused' }); };
  // A created rule is selected as soon as the server's state carries it.
  const fresh = useRef<Set<string> | null>(null);
  const create = (r0: Partial<AutoRule>) => { const r = r0.when?.k === 'clock' && r0.when.at < Date.now() ? { ...r0, when: { k: 'clock' as const, at: Date.now() + 3600_000 } } : r0; fresh.current = new Set(rules.map(x => x.id)); return run({ c: 'sp-rule-set', rule: { ...r, during: 'during' in r ? r.during : plan?.onAir?.id ?? segs[0]?.id ?? null } }, 'New automation'); };
  useEffect(() => { if (!fresh.current) return; const n = rules.find(x => !fresh.current!.has(x.id)); if (n) { fresh.current = null; setSelId(n.id); } }, [rules]);

  if (!plan) return <Empty>The server did not send a show plan.</Empty>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-automation>
      {/* global state + pending GO */}
      <div className="flex flex-none flex-wrap items-center gap-3">
        <Pill tone={eng.autoHold ? 'warn' : plan.pending ? 'accent' : 'ok'}>{eng.autoHold ? 'Held: nothing runs on air' : plan.pending ? 'Waiting for GO' : `${rules.filter(r => r.on).length} armed`}</Pill>
        <span className="text-[13.5px] text-white/50">Manual always wins: automation waits 8 s after any manual on-air action.</span>
        <div className="ml-auto flex items-center gap-2">
          <Toggle on={eng.autoHold} onChange={v => run({ c: 'automation', hold: v }, v ? 'Automation held' : 'Automation resumed')} label={<span className="text-[14px]">Hold all automation</span>} title="Safe override: no automatic on-air step runs while held (GO stays manual)" />
        </div>
      </div>
      {plan.pending && (
        <div className="flex flex-none items-center gap-3 rounded-[10px] border px-4 py-3" style={{ borderColor: 'rgba(255,59,31,.6)', background: S.accentSoft }} data-pending>
          <span className="text-[#ff7a62]">{I.bolt}</span>
          <div className="min-w-0 flex-1"><div className="font-semibold">{plan.pending.text}</div><div className="text-[13px] text-white/55">{plan.pending.name} · waiting {fmtClock(now - plan.pending.at)} · then: {plan.pending.rest.map(a => actionLabel(a, segName)).join(' → ') || 'GO'}</div></div>
          <Btn onClick={() => run({ c: 'sp-cancel' }, 'Cancel automation step')} kind="danger">Cancel</Btn>
          <Btn kind="accent" onClick={openProducer}>GO is in Producer Mode →</Btn>
        </div>
      )}

      <Timeline st={st} now={now} onRule={setSelId} sel={selId} />

      <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: 'minmax(320px, 400px) minmax(0, 1fr)' }}>
        <Card fill title="Rules" icon={I.bolt} bodyClass="overflow-y-auto" actions={<span className="text-[13px] text-white/45">{rules.length}</span>}>
          <div className="space-y-1.5 p-2.5">
            {rules.map(r => (
              <div key={r.id} data-rule={r.id} className="flex cursor-pointer items-center gap-3 rounded-[8px] border px-3 py-2.5 transition" onClick={() => setSelId(r.id)}
                style={{ borderColor: r.id === selId ? S.accent : S.line, background: r.id === selId ? S.accentSoft : 'rgba(255,255,255,.02)' }}>
                <span onClick={e => e.stopPropagation()}><Toggle on={r.on} onChange={v => run({ c: 'sp-rule-set', rule: { id: r.id, on: v } }, `${r.name} ${v ? 'on' : 'off'}`)} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold">{r.name}</div>
                  <div className="truncate text-[12.5px] text-white/50">{triggerLabel(r.when)}{r.during ? ` · while ${segName(r.during)}` : ''} · {r.then.length} step{r.then.length === 1 ? '' : 's'}</div>
                </div>
                {plan.pending?.rule === r.id && <Pill tone="accent">GO?</Pill>}
              </div>
            ))}
            {!rules.length && <div className="p-3 text-[13.5px] text-white/50">No automation yet. Start from a template:</div>}
            <div className={`${COND} px-1 pt-3 text-[12.5px] tracking-[0.14em] text-white/45`}>New from template</div>
            {[...TEMPLATES, ...(() => { const ids = { voting: plan.segments.find(s => s.target === 's:mvp')?.id, closed: plan.segments.find(s => s.target === 's:mvp-closed')?.id }; const [a, b] = MVP_RULES(ids);
              return [{ name: 'MVP & Awards: match ends → voting (GO)', about: 'A match result is entered → MVP Voting Open prepared → producer GO → voting opens → next prepared.', rule: a },
                { name: 'MVP & Awards: voting closes → reveals (each GO)', about: 'Voting Closed on air → Community MVP reveal (GO) → Analyst MVP (GO) → comparison (GO) → next item prepared. Never reveals without GO.', rule: b }]; })()].map(t => (
              <button key={t.name} type="button" onClick={() => create(t.rule)} className="block w-full rounded-[8px] border border-dashed px-3 py-2 text-left transition hover:border-white/35" style={{ borderColor: S.line2 }} data-template={t.name}>
                <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="text-white/50">{I.plus}</span>{t.name}</div>
                <div className="mt-0.5 text-[12.5px] text-white/45">{t.about}</div>
              </button>
            ))}
            <Btn size="sm" className="mt-2 w-full" onClick={() => create({ name: 'New automation', when: { k: 'countdown-end' }, then: [{ k: 'notify', text: 'Automation step reached' }] })} icon={I.plus}>Blank automation</Btn>
          </div>
        </Card>

        {edit ? (
          <Card fill title={<span className="flex items-center gap-2">Edit rule {dirty && <Pill tone="warn">Unsaved</Pill>}</span>} icon={I.auto} bodyClass="overflow-y-auto p-4" data-rule-editor={edit.id}
            actions={<>
              <Btn size="sm" onClick={async () => { const a = await run({ c: 'sp-rule-run', id: edit.id, dry: true }, `Test ${edit.name}`); setTest({ ok: a.ok, text: a.ok ? a.note ?? 'OK' : a.error ?? 'Failed' }); }} icon={I.flask} title="Describe what this rule would do. Nothing changes.">Test (safe)</Btn>
              <Btn size="sm" onClick={() => { if (confirm(`Run “${edit.name}” now? Its steps act like the trigger fired (OBS / media may change).`)) run({ c: 'sp-rule-run', id: edit.id, dry: false }, `Run ${edit.name}`).then(a => setTest({ ok: a.ok, text: a.ok ? a.note ?? 'Done' : a.error ?? 'Refused' })); }} icon={I.play}>Run now</Btn>
              <IconBtn title="Delete this automation" onClick={() => { if (confirm(`Delete “${edit.name}”?`)) run({ c: 'sp-rule-remove', id: edit.id }, `Delete ${edit.name}`).then(() => setSelId(null)); }}>{I.trash}</IconBtn>
              <Btn size="sm" kind="accent" disabled={!dirty} onClick={save}>Save</Btn>
            </>}>
            <div className="space-y-5">
              <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)' }}>
                <Field label="Name"><Input ariaLabel="Rule name" value={edit.name} onCommit={v => setEdit({ ...edit, name: v })} /></Field>
                <Field label="When">
                  <Select ariaLabel="Trigger" value={edit.when.k} options={TRIGGERS} onChange={v => setEdit({ ...edit, when: v === 'clock' ? { k: 'clock', at: edit.when.k === 'clock' ? edit.when.at : Date.now() + 3600_000 } : { k: v as 'countdown-end' } })} />
                </Field>
                <Field label="While on air" hint="Only fires while this segment is on air">
                  <Select ariaLabel="While segment" value={edit.during ?? ''} options={[['', 'Any time'], ...segOpts]} onChange={v => setEdit({ ...edit, during: v || null })} />
                </Field>
              </div>
              {edit.when.k === 'clock' && (
                <Field label="Clock time (this computer's time zone)" hint={edit.fired ? `Already fired ${new Date(edit.fired).toLocaleTimeString()}: changing the time re-arms it.` : 'Fires once.'} className="max-w-[360px]">
                  <input aria-label="Clock time" type="datetime-local" value={toLocalInput(edit.when.at)} onChange={e => { const t = new Date(e.target.value).getTime(); if (Number.isFinite(t)) setEdit({ ...edit, when: { k: 'clock', at: t } }); }}
                    className="h-[36px] rounded-[6px] border bg-[#0a0a0d] px-3 text-[14px] text-white" style={{ borderColor: S.line2, colorScheme: 'dark' }} />
                </Field>
              )}

              <div>
                <div className="mb-2 flex items-center gap-3"><span className={`${COND} text-[14px] tracking-[0.12em] text-white/70`}>Then</span><span className="text-[13px] text-white/45">Steps run in order. “Wait for producer GO” pauses here until GO (Producer Mode) or Cancel.</span></div>
                <ol className="space-y-2" data-steps>
                  {edit.then.map((a, i) => (
                    <li key={i} className="flex items-center gap-3 rounded-[8px] border px-3 py-2.5" style={{ borderColor: a.k === 'confirm' ? 'rgba(255,59,31,.5)' : a.k === 'go' ? 'rgba(47,191,113,.45)' : S.line, background: 'rgba(255,255,255,.02)' }} data-step={a.k}>
                      <span className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full bg-white/[0.07] font-mono text-[13px]">{i + 1}</span>
                      <Select ariaLabel={`Step ${i + 1} type`} className="!w-[230px] flex-none" value={a.k} options={STEP_KINDS} onChange={v => setEdit({ ...edit, then: edit.then.map((x, k) => (k === i ? blankStep(v as AutoAction['k']) : x)) })} />
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <StepParams a={a} segOpts={segOpts} obsScenes={st.obs.scenes} onChange={n => setEdit({ ...edit, then: edit.then.map((x, k) => (k === i ? n : x)) })} />
                      </div>
                      <IconBtn title="Up" disabled={i === 0} onClick={() => { const t = [...edit.then]; [t[i - 1], t[i]] = [t[i], t[i - 1]]; setEdit({ ...edit, then: t }); }}>{I.up}</IconBtn>
                      <IconBtn title="Down" disabled={i === edit.then.length - 1} onClick={() => { const t = [...edit.then]; [t[i + 1], t[i]] = [t[i], t[i + 1]]; setEdit({ ...edit, then: t }); }}>{I.down}</IconBtn>
                      <IconBtn title="Remove step" onClick={() => setEdit({ ...edit, then: edit.then.filter((_, k) => k !== i) })}>{I.x}</IconBtn>
                    </li>
                  ))}
                </ol>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STEP_KINDS.map(([k, l]) => <Btn key={k} size="sm" kind="ghost" onClick={() => setEdit({ ...edit, then: [...edit.then, blankStep(k)] })} icon={I.plus} disabled={edit.then.length >= 12}>{l}</Btn>)}
                </div>
              </div>

              <div className="rounded-[8px] border px-4 py-3 text-[14px]" style={{ borderColor: S.line, background: S.raised }} data-rule-summary>
                <span className={`${COND} mr-2 tracking-[0.12em] text-white/50`}>Reads as</span>
                WHEN <b>{triggerLabel(edit.when).toLowerCase()}</b>{edit.during ? <> while <b>{segName(edit.during)}</b> is on air</> : ''}, {edit.then.map(a => actionLabel(a, segName).toLowerCase()).join(', then ') || 'do nothing'}.
              </div>
              {test && <div className="rounded-[8px] border px-4 py-3 text-[14px]" style={{ borderColor: test.ok ? 'rgba(47,191,113,.45)' : 'rgba(229,72,77,.5)', color: test.ok ? '#8fe6b7' : '#ff9a9d' }} data-test-result>{test.text}</div>}
            </div>
          </Card>
        ) : <Card fill><Empty>Select a rule, or create one from a template.</Empty></Card>}
      </div>
    </div>
  );
}

function StepParams({ a, segOpts, obsScenes, onChange }: { a: AutoAction; segOpts: [string, string][]; obsScenes: string[]; onChange: (a: AutoAction) => void }) {
  switch (a.k) {
    case 'prepare': return <Select ariaLabel="Segment to prepare" value={a.seg} options={[['next', 'The next segment in the rundown'], ...segOpts]} onChange={v => onChange({ k: 'prepare', seg: v })} />;
    case 'notify': return <Input ariaLabel="Notification text" value={a.text} onCommit={v => onChange({ k: 'notify', text: v })} />;
    case 'media': return <Select ariaLabel="Media action" value={a.action} options={[['play', 'Play'], ['stop', 'Stop'], ['next', 'Next item']]} onChange={v => onChange({ k: 'media', action: v as 'play' })} />;
    case 'timer': return <><Input ariaLabel="Countdown minutes" className="!w-[90px]" value={String(a.minutes)} onCommit={v => onChange({ k: 'timer', minutes: Math.max(0, Math.min(600, Math.round(Number(v) || 0))) })} /><span className="text-[13px] text-white/50">minutes (0 = stop)</span></>;
    case 'obs': return <>
      <Select ariaLabel="OBS scene" value={a.scene} options={[['', '— OBS scene —'], ...[...new Set([...(a.scene ? [a.scene] : []), ...obsScenes])].map(s => [s, s] as [string, string])]} onChange={v => onChange({ ...a, scene: v })} />
      <Select ariaLabel="OBS transition" className="!w-[150px] flex-none" value={a.transition} options={SEG_TRANSITIONS} onChange={v => onChange({ ...a, transition: v as 'obs' })} /></>;
    case 'confirm': return <span className="text-[13.5px] text-[#ff8a72]">Producer Mode shows a GO prompt; nothing after this runs until GO.</span>;
    case 'go': return <span className="text-[13.5px] text-white/55">Switches OBS to the prepared segment's scene with its transition, starts its media.</span>;
    case 'gfx-next': return <span className="text-[13.5px] text-white/55">Takes the cued graphics rundown item IN.</span>;
    case 'mvp': return <>
      <Select ariaLabel="MVP action" className="!w-[170px] flex-none" value={a.action} options={[['open', 'Open voting'], ['close', 'Close voting'], ['reveal', 'Reveal']]} onChange={v => onChange(v === 'reveal' ? { k: 'mvp', action: 'reveal', step: a.step ?? 'winner' } : { k: 'mvp', action: v as 'open' })} />
      {a.action === 'reveal' && <Select ariaLabel="MVP reveal" className="!w-[200px] flex-none" value={a.step ?? 'winner'} options={[['winner', 'Community MVP'], ['desk', 'Analyst MVP'], ['compare', 'Community vs Analysts']]} onChange={v => onChange({ k: 'mvp', action: 'reveal', step: v as 'winner' })} />}
      {a.action === 'reveal' && <span className="text-[12.5px] text-white/50">Frozen result only · stops for GO when confirmation is on</span>}</>;
  }
}

/** Visual automation timeline: the show's segments to scale, the playhead, and the rules on their segments. */
function Timeline({ st, now, onRule, sel }: { st: ControllerState; now: number; onRule: (id: string) => void; sel: string | null }) {
  const p = st.plan!;
  const segs = p.segments;
  const OPEN = 180; // seconds shown for open-ended segments
  const total = useMemo(() => segs.reduce((a, s) => a + (s.dur || OPEN), 0), [segs]);
  if (!segs.length) return <div className="flex-none rounded-[10px] border px-4 py-5 text-[14px] text-white/50" style={{ borderColor: S.line, background: S.panel }}>The timeline appears once the show rundown has segments.</div>;
  const airI = p.onAir ? segs.findIndex(s => s.id === p.onAir!.id) : -1;
  const before = airI >= 0 ? segs.slice(0, airI).reduce((a, s) => a + (s.dur || OPEN), 0) : 0;
  const into = airI >= 0 ? Math.min((now - p.onAir!.at) / 1000, segs[airI].dur || OPEN) : 0;
  const head = airI >= 0 ? ((before + into) / total) * 100 : null;
  const icon = (k: string) => (k === 'countdown-end' ? I.clock : k === 'media-end' ? I.play : k === 'segment-end' ? I.stop : I.clock);
  return (
    <div className="flex-none rounded-[10px] border p-3" style={{ borderColor: S.line, background: S.panel }} data-timeline>
      <div className="mb-2 flex items-center gap-3"><span className={`${COND} text-[14px] tracking-[0.12em] text-white/70`}>Timeline</span><span className="text-[13px] text-white/45">to scale · open-ended segments shown as {fmtDur(OPEN)}</span></div>
      <div className="relative">
        <div className="flex h-[54px] overflow-hidden rounded-[7px]">
          {segs.map((s, i) => {
            const r = segReady(st, s), air = i === airI, next = p.next === s.id;
            return (
              <div key={s.id} className="relative flex min-w-0 flex-col justify-center border-r px-2" title={`${s.label} · ${fmtDur(s.dur)}${r.issues.length ? `\n${r.issues.map(x => x.text).join('\n')}` : ''}`}
                style={{ width: `${((s.dur || OPEN) / total) * 100}%`, borderColor: S.bg, background: air ? 'rgba(229,72,77,.32)' : next ? 'rgba(47,191,113,.2)' : i < airI ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.08)' }}>
                <span className="truncate text-[13px] font-semibold">{s.label}</span>
                <span className="truncate font-mono text-[11.5px] text-white/50">{fmtDur(s.dur)}{s.confirm ? ' · GO' : ''}{s.autoNext ? ' · auto' : ''}</span>
                <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: r.level === 'error' ? S.bad : r.level === 'warn' ? S.warn : S.ok, opacity: 0.8 }} />
              </div>
            );
          })}
        </div>
        {head != null && <div className="pointer-events-none absolute -top-1 bottom-[-6px] w-[2px]" style={{ left: `${head}%`, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.6)' }} data-playhead />}
        <div className="relative mt-2 h-[30px]">
          {p.rules.map((r, k) => {
            const i = r.during ? segs.findIndex(s => s.id === r.during) : -1;
            const at = i >= 0 ? (segs.slice(0, i + (r.when.k === 'segment-end' || r.when.k === 'countdown-end' ? 1 : 0)).reduce((a, s) => a + (s.dur || OPEN), 0) / total) * 100 : null;
            return (
              <button key={r.id} type="button" onClick={() => onRule(r.id)} title={`${r.name}: ${triggerLabel(r.when)}`}
                className="absolute top-0 flex h-[28px] max-w-[220px] -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px]"
                style={{ left: at != null ? `${Math.min(97, Math.max(3, at))}%` : `${8 + k * 14}%`, borderColor: r.id === sel ? S.accent : S.line2, background: r.id === sel ? S.accentSoft : S.raised, opacity: r.on ? 1 : 0.45 }}>
                <span className="text-[#ff7a62]">{icon(r.when.k)}</span><span className="truncate">{r.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function NotesLog({ st }: { st: ControllerState }) {
  const notes = st.plan?.notes ?? [];
  if (!notes.length) return <div className="text-[13px] text-white/45">No automation activity yet.</div>;
  return (
    <ul className="space-y-1.5" data-plan-notes>
      {notes.slice(0, 12).map((n, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-snug"><span className="flex-none font-mono text-white/35">{new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span style={{ color: n.level === 'warn' ? S.warn : n.level === 'go' ? '#ff8f92' : S.dim }}>{n.text}</span></li>
      ))}
    </ul>
  );
}

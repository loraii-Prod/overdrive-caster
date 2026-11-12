import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { MAJOR_PROFILES, MAJOR_TEAMS, normHandle, teamPlayers } from '../../../shared/major';
import { MAJOR_MAPS } from '../../../shared/maps';
import { seedTeamPb } from '../../../shared/pbs';
import type { Caster } from '../../../shared/types';
import { INTERVIEW_TITLES, PICK_SCORES, VETO_PRESETS, pbMs, vetoRows, type VetoStep, type WcOp, type WcPick, type WildcardState } from '../../../shared/wildcard';
import { boothIds, deskAnalystIds, isAnalyst, isCaster } from '../../components/wildcard/Desk';

/**
 * Who's on where, in one place, used by the Casters tab, the Analysts tab and the scene dock.
 * Casters = slots 1–3 (Casters screen), analysts = slots 4–5 (desk); a caster can join the desk.
 * All instant (no TAKE).
 */

function Btn({ on, auto, onClick, children, title }: { on: boolean; auto?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" title={title} onClick={onClick} aria-pressed={on}
      className={`btn h-10 px-4 text-[14px] font-semibold ${on ? (auto ? '!border-emerald-400/60 !bg-emerald-500/15 !text-white' : '!border-[#e5484d] !bg-[#e5484d]/25 !text-white') : 'text-white/60'}`}>
      {children}
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-[118px] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/45" title={hint}>{label}</span>
      {children}
    </div>
  );
}

const nameOf = (c: Caster) => c.name || (isAnalyst(c) ? `Analyst ${c.id - 3}` : c.id === 6 ? 'Guest' : `Caster ${c.id}`);

/** Casters on the Casters screen (and gameplay corner cams): all of them, or exactly the ones picked (max 3). */
export function BoothPicker({ s, casters, op }: { s: WildcardState; casters: Caster[]; op: (o: WcOp) => void }) {
  const list = casters.filter(c => c.enabled && isCaster(c));
  const on = boothIds(casters, s.booth), auto = !s.booth.length;
  return (
    <Row label="On camera" hint="Casters screen and gameplay cams">
      <Btn on={auto} onClick={() => op({ k: 'booth', slots: [] })}>All casters</Btn>
      {list.map(c => {
        const here = on.includes(c.id);
        return <Btn key={c.id} on={here} auto={auto} onClick={() => op({ k: 'booth', slots: here ? on.filter(x => x !== c.id) : [...on, c.id] })}>{nameOf(c)}</Btn>;
      })}
      {!list.length && <span className="text-[12px] text-white/40">No caster in the show (Casters tab)</span>}
    </Row>
  );
}

/** The desk: which analysts, and whether a caster joins them. */
export function DeskPicker({ s, casters, op }: { s: WildcardState; casters: Caster[]; op: (o: WcOp) => void }) {
  const analysts = casters.filter(c => c.enabled && isAnalyst(c));
  const cs = casters.filter(c => c.enabled && isCaster(c));
  const on = deskAnalystIds(casters, s.desk.slots), auto = !s.desk.slots.length;
  return (
    <div className="flex flex-col gap-2">
      <Row label="Analysts">
        <Btn on={auto} onClick={() => op({ k: 'desk', slots: [] })}>All analysts</Btn>
        {analysts.map(c => {
          const here = on.includes(c.id);
          return <Btn key={c.id} on={here} auto={auto} onClick={() => op({ k: 'desk', slots: here ? on.filter(x => x !== c.id) : [...on, c.id] })}>{nameOf(c)}</Btn>;
        })}
        {!analysts.length && <span className="text-[12px] text-white/40">No analyst in the show (Analysts tab)</span>}
      </Row>
      <Row label="Caster joins">
        <Btn on={s.desk.guest == null} onClick={() => op({ k: 'desk', guest: null })}>Nobody</Btn>
        {cs.map(c => <Btn key={c.id} on={s.desk.guest === c.id} onClick={() => op({ k: 'desk', guest: s.desk.guest === c.id ? null : c.id })}>{nameOf(c)}</Btn>)}
      </Row>
    </div>
  );
}

/**
 * Picks, entered by the producer: one row per person on this screen. Tap the team, then the score
 * (tap the team again to clear). Shown on screen with the "Picks" switch.
 */
export function PicksInput({ s, casters, ids, op }: { s: WildcardState; casters: Caster[]; ids: number[]; op: (o: WcOp) => void }) {
  const { a, b, picks } = s.intro;
  if (!a || !b) return <Row label="Picks"><span className="text-[12px] text-white/40">Pick the match first</span></Row>;
  const people = ids.map(id => casters.find(c => c.id === id)).filter((c): c is Caster => !!c);
  if (!people.length) return <Row label="Picks"><span className="text-[12px] text-white/40">Nobody on this screen</span></Row>;
  const set = (slot: number, pick: WcPick | null) => op({ k: 'pick', slot, pick });
  return (
    <div className="flex flex-col gap-1.5">
      {people.map((c, i) => {
        const p = picks[String(c.id)];
        return (
          <Row key={c.id} label={i === 0 ? 'Picks' : ''}>
            <span className="w-[110px] truncate text-[13px] font-semibold text-white/85">{nameOf(c)}</span>
            {[a, b].map(t => (
              <Btn key={t} on={p?.team === t} onClick={() => set(c.id, p?.team === t ? null : { team: t, score: p?.score ?? '' })}>
                <span className="inline-block max-w-[150px] truncate align-bottom">{t}</span>
              </Btn>
            ))}
            {PICK_SCORES.map(sc => (
              <Btn key={sc} on={!!p && p.score === sc} onClick={() => p && set(c.id, { team: p.team, score: p.score === sc ? '' : sc })} title={p ? '' : 'Pick the team first'}>{sc}</Btn>
            ))}
          </Row>
        );
      })}
    </div>
  );
}

const QUESTIONS = [
  'How are you feeling after that one?',
  'Which map decided the series for you?',
  'What changed between maps?',
  'Who are you hoping to face next?',
  'Who wins the Major if it isn\'t you?',
  'Anything to say to the fans?',
];

/** Interview screen: the player, the host, the title, the lower third and the question banner. */
export function InterviewControls({ s, casters, op }: { s: WildcardState; casters: Caster[]; op: (o: WcOp) => void }) {
  const iv = s.interview, set = (patch: Partial<typeof iv>) => op({ k: 'interview', patch });
  const [q, setQ] = useState(iv.question);
  useEffect(() => setQ(iv.question), [iv.question]);
  const teams = [s.intro.a, s.intro.b].filter(Boolean);
  const players = [...MAJOR_PROFILES].sort((a, b) => Number(teams.includes(b.team)) - Number(teams.includes(a.team)) || a.team.localeCompare(b.team));
  const hosts = casters.filter(c => c.enabled && c.id <= 5);
  return (
    <div className="flex flex-col gap-2">
      <Row label="Player">
        <select className="input h-10 min-w-[300px] text-[14px] font-semibold" value={iv.player} onChange={e => set({ player: e.target.value })}>
          <option value="">Guest camera name</option>
          {players.map(p => <option key={p.handle} value={normHandle(p.handle)}>{p.handle} · {p.team}</option>)}
        </select>
      </Row>
      <Row label="Host">
        <Btn on={iv.host == null} onClick={() => set({ host: null })}>Nobody (player only)</Btn>
        {hosts.map(c => <Btn key={c.id} on={iv.host === c.id} onClick={() => set({ host: c.id })}>{nameOf(c)}</Btn>)}
      </Row>
      <Row label="Title">
        {INTERVIEW_TITLES.map(t => <Btn key={t} on={iv.title === t} onClick={() => set({ title: t })}>{t.replace(' interview', '')}</Btn>)}
      </Row>
      <Row label="On screen">
        <Btn on={iv.lower} auto onClick={() => set({ lower: !iv.lower })}>Name bar</Btn>
        <Btn on={iv.showQ} auto onClick={() => set({ showQ: !iv.showQ })}>Question</Btn>
      </Row>
      <Row label="Question">
        <input className="input h-10 min-w-[420px] flex-1 text-[14px]" value={q} placeholder="Type a question, Enter to put it up"
          onChange={e => setQ(e.target.value)} onBlur={() => q !== iv.question && set({ question: q })}
          onKeyDown={e => { if (e.key === 'Enter') set({ question: q, showQ: true }); }} />
      </Row>
      <Row label="">
        {QUESTIONS.map(t => <button key={t} type="button" className="btn-xs" onClick={() => set({ question: t, showQ: true })}>{t}</button>)}
      </Row>
    </div>
  );
}

/** Map veto: who acts next, a button per map (calls the next step on it), undo / reset, and the order (presets or step by step). */
export function VetoControls({ s, op }: { s: WildcardState; op: (o: WcOp) => void }) {
  const v = s.veto, next = v.order[v.done.length];
  const a = s.intro.a || 'Team A', b = s.intro.b || 'Team B';
  const who = (by: VetoStep['by']) => (by === 'a' ? a : by === 'b' ? b : 'Decider');
  const rows = vetoRows(v);
  const STEP_OPTS: { v: string; label: string; step: VetoStep }[] = [
    { v: 'a-pick', label: `${a} pick`, step: { by: 'a', act: 'pick' } }, { v: 'a-ban', label: `${a} ban`, step: { by: 'a', act: 'ban' } },
    { v: 'b-pick', label: `${b} pick`, step: { by: 'b', act: 'pick' } }, { v: 'b-ban', label: `${b} ban`, step: { by: 'b', act: 'ban' } },
    { v: 'd-pick', label: 'Decider', step: { by: 'd', act: 'pick' } },
  ];
  const setStep = (i: number, key: string) => {
    const st = STEP_OPTS.find(o => o.v === key)?.step; if (!st) return;
    const order = [...v.order]; order[i] = st; op({ k: 'veto-order', order });
  };
  return (
    <div className="flex flex-col gap-2">
      <Row label="Next">
        <span className="text-[15px] font-bold">{next ? <><span className="text-[#ff8a8d]">{who(next.by)}</span> {next.by === 'd' ? '(last map, fills in by itself)' : next.act === 'ban' ? 'bans' : 'picks'}</> : 'Veto complete'}</span>
      </Row>
      <Row label={next && next.by !== 'd' ? (next.act === 'ban' ? 'Ban' : 'Pick') : 'Maps'}>
        {MAJOR_MAPS.map(m => {
          const r = rows.find(x => x.map === m.id);
          return <Btn key={m.id} on={!!r} onClick={() => !r && next && op({ k: 'veto', map: m.id })} title={r ? `${r.step.act === 'ban' ? 'Banned' : 'Picked'} at step ${r.n}` : ''}>
            {m.country}{r && <span className="ml-1.5 text-[11px] font-normal text-white/50">{r.step.act === 'ban' ? 'ban' : `map ${r.mapNo}`}</span>}
          </Btn>;
        })}
      </Row>
      <Row label="PBs">
        {MAJOR_MAPS.map(m => <Btn key={m.id} on={v.pb.map === m.id} onClick={() => op({ k: 'pb-show', map: v.pb.map === m.id ? null : m.id })}>{m.country}</Btn>)}
        <Btn on={false} onClick={() => op({ k: 'pb-show', map: null })}>Hide</Btn>
      </Row>
      <Row label="">
        <button type="button" className="btn-xs" disabled={!v.done.length} onClick={() => op({ k: 'veto-undo' })}>Undo last</button>
        <button type="button" className="btn-xs" disabled={!v.done.length} onClick={() => op({ k: 'veto-reset' })}>Start over</button>
      </Row>
      <Row label="Order">
        {VETO_PRESETS.map(p => <button key={p.id} type="button" className={`btn-xs ${JSON.stringify(p.order) === JSON.stringify(v.order) ? '!border-[#e5484d] !text-white' : ''}`} onClick={() => op({ k: 'veto-order', order: p.order })}>{p.label}</button>)}
      </Row>
      <Row label="">
        {v.order.map((st, i) => (
          <label key={i} className="flex items-center gap-1 text-[11px] text-white/45">{i + 1}
            <select className="input h-8 text-[12.5px]" value={`${st.by}-${st.act}`} onChange={e => setStep(i, e.target.value)}>
              {STEP_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </label>
        ))}
        <span className="text-[11px] text-white/35">Changing the order starts the veto over</span>
      </Row>
    </div>
  );
}

/** Team PBs per map: a time (and who set it) for each team, the match's two teams by default. Saved for the whole event. */
export function PbEditor({ s, op }: { s: WildcardState; op: (o: WcOp) => void }) {
  const [pick, setPick] = useState<[string, string]>(['', '']);
  const teams: [string, string] = [pick[0] || s.intro.a, pick[1] || s.intro.b];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/50">
        Teams
        {[0, 1].map(i => (
          <select key={i} className="input h-8 text-[12.5px]" value={teams[i]} onChange={e => setPick(p => (i ? [p[0], e.target.value] : [e.target.value, p[1]]))}>
            <option value="">Pick a team</option>
            {MAJOR_TEAMS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        ))}
        <span className="text-white/35">Grey times come from trackmania.io (2026 Split 3 leaderboards) · type a time (43.512 or 1:02.345) to override</span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: '150px 1fr 1fr' }}>
        <span />
        {teams.map((t, i) => <span key={i} className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{t || '—'}</span>)}
        {MAJOR_MAPS.map(m => (
          <Fragment key={m.id}>
            <span className="self-center text-[13px] font-semibold">{m.country}</span>
            {teams.map((t, i) => <PbCell key={`${m.id}-${i}-${t}`} map={m.id} team={t} s={s} op={op} />)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PbCell({ map, team, s, op }: { map: string; team: string; s: WildcardState; op: (o: WcOp) => void }) {
  const pb = team ? s.pbs[map]?.[team] : undefined;
  const seed = team ? seedTeamPb(map, team) : null;
  const [t, setT] = useState(pb?.time ?? '');
  useEffect(() => setT(pb?.time ?? ''), [pb?.time]);
  if (!team) return <span className="text-[12px] text-white/25">pick a team</span>;
  const bad = t.trim() !== '' && pbMs(t) == null;
  const save = (time: string, player = pb?.player ?? '') => op({ k: 'pb', map, team, pb: time.trim() ? { time: time.trim(), player } : null });
  return (
    <div className="flex items-center gap-1.5">
      <input className={`input h-8 w-[110px] text-[13px] tabular-nums ${bad ? '!border-amber-400/70' : ''}`} placeholder={seed ? `${seed.time}` : '—'} title={seed && !pb ? `From trackmania.io: ${seed.player} ${seed.time} (type a time to override)` : ''} value={t}
        onChange={e => setT(e.target.value)} onBlur={() => !bad && t !== (pb?.time ?? '') && save(t)} onKeyDown={e => { if (e.key === 'Enter' && !bad) save(t); }} />
      <select className="input h-8 min-w-0 flex-1 text-[12.5px]" value={pb?.player ?? ''} disabled={!pb} onChange={e => save(pb!.time, e.target.value)}>
        <option value="">{pb ? 'Team best' : seed ? `${seed.player} (leaderboard)` : 'Team best'}</option>
        {teamPlayers(team).map(p => <option key={p.handle} value={p.handle}>{p.handle}</option>)}
      </select>
    </div>
  );
}

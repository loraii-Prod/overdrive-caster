import { useState, type ReactNode } from 'react';
import type { ClientMsg, QuickOp } from '../../../shared/protocol';
import { SCREEN_IDS, type Caster, type Scene, type ScreenId, type Show } from '../../../shared/types';
import { SCREEN_LABELS } from '../../../shared/defaults';
import type { WcLive } from '../../lib/hooks';
import { formatRemaining } from '../../components/show/parts';
import { MAJOR_PROFILES, introPhase, normHandle } from '../../../shared/major';
import { BoothPicker, DeskPicker, InterviewControls, PicksInput, VetoControls } from './Talent';
import { boothIds, deskCasters } from '../../components/wildcard/Desk';
import { DESK_PANELS, GRAND_FINAL, WC_IDS, vetoRows, type WildcardState, matchName, realTeam, wcResolve, type WcOp } from '../../../shared/wildcard';
import type { TwOp } from '../../../shared/twitch';
import { Segmented } from './ui';
import { MAJOR_MAPS } from '../../../shared/maps';
import { DEFAULT_LEVELS, MUSIC_LABELS, sectionFor } from '../../../shared/music';

/**
 * Scene dock: the controls for the screen that is on air, right under the screen buttons, so nothing
 * needs scrolling during the show. Follows the program; switch to the prepared (preview) screen with the tabs.
 */
export function SceneDock({ live, preview, show, wc, now, send, quick, twConnected, onMore, casters = [], screens = false, forScreen, part = 'all' }: {
  live: ScreenId; preview: ScreenId; show: Show; wc: WcLive | null; now: number;
  send: (m: ClientMsg) => void; quick: (op: QuickOp) => void; twConnected: boolean;
  onMore?: (section: 'wildcard' | 'twitch' | 'match' | 'screens') => void;
  casters?: Caster[];
  /** Control strip under an OBS source: a row of GO buttons for every screen first. */
  screens?: boolean;
  /** Everything dock: show this screen's controls (not the on-air one), with its own GO button. */
  forScreen?: ScreenId;
  /** Everything dock: 'shared' = match/score/countdown/Twitch/Champions only; 'scene' = everything else. */
  part?: 'all' | 'shared' | 'scene';
}) {
  const [pick, setPick] = useState<'live' | 'preview'>('live');
  const screen = forScreen ?? (pick === 'preview' && preview !== live ? preview : live);
  const op = (o: WcOp) => send({ t: 'wc', op: o });
  const tw = (o: TwOp) => send({ t: 'tw', op: o });
  const s = wc?.state;

  const R = s ? wcResolve(s.matches, s.teams) : null;
  const more = (sec: 'wildcard' | 'twitch' | 'match' | 'screens') => onMore?.(sec);

  // ---- Match: the one choice that sets everything (scoreboard teams + score, intro teams, predictions).
  const castable = s && R ? WC_IDS.filter(id => (!R[id].winner && realTeam(R[id].t1) && realTeam(R[id].t2)) || id === s.cast) : [];
  let match: ReactNode = s && R ? (
    <Group label="Match">
      {castable.length ? (
        <select className="input h-10 min-w-[320px] max-w-[440px] text-[14px] font-semibold" value={s.cast ?? ''} onChange={e => op({ k: 'cast', id: e.target.value || null })}>
          <option value="">Pick the match…</option>
          {castable.map(id => <option key={id} value={id}>{matchName(id)} · {R[id].t1} vs {R[id].t2}{R[id].winner ? ' (done)' : ''}</option>)}
        </select>
      ) : <><Hint>No match ready: set the first round</Hint>{onMore && <Big onClick={() => more('wildcard')}>Major tab →</Big>}</>}
    </Group>
  ) : null;
  const id = s?.cast ?? null, r = id && R ? R[id] : null;

  // ---- Score of the match (first to 3). Without a match picked: the plain scoreboard.
  const side = (k: 1 | 2) => {
    const name = k === 1 ? r!.t1 : r!.t2, v = k === 1 ? s!.matches[id!].s1 : s!.matches[id!].s2;
    return (
      <span key={k} className="flex items-center gap-1.5 rounded-md bg-black/30 py-1 pl-3 pr-1.5">
        <span className="max-w-[160px] truncate text-[14px] font-bold">{name}</span>
        <Big onClick={() => op({ k: 'score', id: id!, side: k, delta: -1 })}>−</Big>
        <span className="w-8 text-center text-[22px] font-black italic">{v === '' ? '0' : v}</span>
        <Big onClick={() => op({ k: 'score', id: id!, side: k, delta: 1 })}>+</Big>
      </span>
    );
  };
  let score: ReactNode = r && realTeam(r.t1) && realTeam(r.t2) ? (
    <Group label="Score">
      {side(1)}{side(2)}
      <Big active={s!.matches[id!].live} onClick={() => op({ k: 'live', id: id! })}>{s!.matches[id!].live ? '● Live' : 'Go live'}</Big>
    </Group>
  ) : (
    <Group label="Score">
      {(['A', 'B'] as const).map(k => {
        const t = k === 'A' ? show.teamA : show.teamB;
        return (
          <span key={k} className="flex items-center gap-1.5 rounded-md bg-black/30 py-1 pl-3 pr-1.5">
            <span className="max-w-[140px] truncate text-[14px] font-bold">{t.tag || t.name || `Team ${k}`}</span>
            <Big onClick={() => quick({ k: 'score', team: k, delta: -1 })}>−</Big>
            <span className="w-8 text-center text-[22px] font-black italic">{t.score}</span>
            <Big onClick={() => quick({ k: 'score', team: k, delta: 1 })}>+</Big>
          </span>
        );
      })}
    </Group>
  );

  // ---- Countdown: the few lengths that get used, and stop.
  let countdown: ReactNode = (
    <Group label="Countdown">
      <span className="w-[70px] font-display text-[20px] font-semibold tabular-nums">{show.timer.target == null ? <span className="text-white/30">--:--</span> : formatRemaining(show.timer.target - now)}</span>
      {[2, 5, 10, 15].map(n => <Big key={n} onClick={() => quick({ k: 'timer-start', minutes: n })}>{n}′</Big>)}
      <Big disabled={show.timer.target == null} onClick={() => quick({ k: 'timer-stop' })}>Stop</Big>
    </Group>
  );

  // ---- Twitch prediction: one button at a time (start → lock → who won).
  const pr = wc?.tw?.prediction, prOpen = pr && (pr.status === 'ACTIVE' || pr.status === 'LOCKED');
  const a = s?.intro.a ?? '', b = s?.intro.b ?? '';
  let twitch: ReactNode = twConnected ? (
    <Group label="Twitch">
      {prOpen ? (
        pr!.status === 'ACTIVE'
          ? <><Big onClick={() => tw({ k: 'prediction-lock' })}>Lock votes</Big><Big onClick={() => tw({ k: 'prediction-cancel' })}>Cancel</Big></>
          : <>{pr!.outcomes.map(o => <Big key={o.id} onClick={() => tw({ k: 'prediction-resolve', outcomeId: o.id })}>{o.title} won</Big>)}<Big onClick={() => tw({ k: 'prediction-cancel' })}>Cancel</Big></>
      ) : (
        <Big disabled={!a || !b} title={a && b ? '' : 'Pick the match first'}
          onClick={() => tw({ k: 'prediction-start', title: `Who wins ${a} vs ${b}?`.length <= 45 ? `Who wins ${a} vs ${b}?` : 'Who wins this match?', outcomes: [a, b], seconds: 120 })}>
          Start viewer prediction
        </Big>
      )}
    </Group>
  ) : null;

  // ---- Caster predictions: who picked what, lock.
  // Picks: entered here by the producer, for the people on this screen.
  const picksFor = (ids: number[]) => s ? <div className="border-l border-white/10 pl-3"><PicksInput s={s} casters={casters} ids={ids} op={op} /></div> : null;
  const boothNow = s ? boothIds(casters, s.booth) : [];
  const deskNow = s ? deskCasters({ casters } as Scene, s.desk).map(c => c.id) : [];
  const picksToggle = s && <Toggle on={s.intro.picksShow} disabled={!a || !b} onClick={() => op({ k: 'intro', patch: { picksShow: !s.intro.picksShow } })}>Picks</Toggle>;

  // Who's on: casters on the Casters screen, analysts (+ a caster who joins) at the desk.
  const who = s ? <div className="border-l border-white/10 pl-3"><BoothPicker s={s} casters={casters} op={op} /></div> : null;
  const deskWho = s ? <div className="border-l border-white/10 pl-3"><DeskPicker s={s} casters={casters} op={op} /></div> : null;

  // Champions takeover (any screen) once the Grand final has a winner.
  const gfWinner = s && R ? R[GRAND_FINAL].winner : null;
  let champ: ReactNode = s ? (
    <Group label="Celebrate">
      <Toggle on={s.champ} disabled={!gfWinner && !s.champ} onClick={() => op({ k: 'champ', on: !s.champ })}>{gfWinner ? `Champions: ${gfWinner}` : 'Champions (after the Grand final)'}</Toggle>
    </Group>
  ) : null;

  // ---- Music: this scene's bed (level / off), skip when it's the one playing; master on/off in the shared row.
  const ms = sectionFor(screen), lv = ms ? show.music.levels[ms] : 0;
  const setLevel = (v: number) => ms && quick({ k: 'music', patch: { levels: { ...show.music.levels, [ms]: v } } });
  const music: ReactNode = ms ? (
    <Group label="Music">
      <Toggle on={lv > 0} onClick={() => setLevel(lv > 0 ? 0 : DEFAULT_LEVELS[ms] || 0.4)}>{lv > 0 ? 'On' : 'Off'}</Toggle>
      <input type="range" min={0} max={1} step={0.01} value={lv} onChange={e => setLevel(+e.target.value)} className="w-28 accent-white" title={`${MUSIC_LABELS[ms]} music level`} />
      <span className="w-9 text-[12px] tabular-nums text-white/60">{lv > 0 ? `${Math.round(lv * 100)}%` : 'Off'}</span>
      {screen === live && <Big disabled={!show.music.enabled || lv === 0} onClick={() => quick({ k: 'music', patch: { skip: Date.now() } })}>Skip ⏭</Big>}
    </Group>
  ) : null;
  const screensRow = (
    <Group label="All screens">
      <Toggle on={show.ticker.onScreens} onClick={() => quick({ k: 'flag', key: 'ticker', on: !show.ticker.onScreens })}>Ticker</Toggle>
    </Group>
  );
  const musicMaster = (
    <Group label="Music">
      <Toggle on={show.music.enabled} onClick={() => quick({ k: 'music', patch: { enabled: !show.music.enabled } })}>{show.music.enabled ? 'Music on' : 'Music off'}</Toggle>
      <Big disabled={!show.music.enabled || !sectionFor(live) || !show.music.levels[sectionFor(live)!]} onClick={() => quick({ k: 'music', patch: { skip: Date.now() } })}>Skip ⏭</Big>
    </Group>
  );
  const shared = <>{match}{score}{countdown}{twitch}{champ}{screensRow}{musicMaster}</>;
  if (part === 'scene') match = score = countdown = twitch = champ = null;

  let body: ReactNode;
  switch (screen) {
    case 'starting': case 'brb': case 'ending':
      body = <>{match}{countdown}{champ}{twitch}</>;
      break;
    case 'warmup': {
      if (!s) { body = <Hint>Waiting for the server…</Hint>; break; }
      const it = s.intro, ph = introPhase(it, now);
      body = (
        <>
          {match}
          <Group label="Match intro">
            <Big primary disabled={!it.a || !it.b || it.a === it.b} onClick={() => op({ k: 'intro-play' })}>▶ Play intro</Big>
            <Big disabled={!it.at} onClick={() => op({ k: 'intro-stop' })}>Stop</Big>
            <span className={`text-[12px] ${ph ? 'text-[#ff8a8d]' : 'text-white/45'}`}>{ph ? (ph.kind === 'vs' ? 'VS' : `Player ${ph.n}/${ph.of} · ${ph.profile.handle}`) : it.idle === 'vs' ? 'Resting on the teams' : 'Player rotation'}</span>
          </Group>
          <Group label="Show a player">
            <select className="input h-10 text-[13px]" value={s.showcase.pin ?? ''} onChange={e => op({ k: 'showcase', patch: { pin: e.target.value || null } })}>
              <option value="">{it.idle === 'vs' && it.a && it.b ? 'Off (teams)' : 'Off (rotation)'}</option>
              {(it.a || it.b ? MAJOR_PROFILES.filter(p => p.team === it.a || p.team === it.b) : MAJOR_PROFILES).map(p => <option key={p.handle} value={normHandle(p.handle)}>{p.handle} · {p.team}</option>)}
            </select>
          </Group>
          <Group label="On screen">{picksToggle}</Group>
          {picksFor([...new Set([...boothNow, ...deskNow])])}
          {countdown}
        </>
      );
      break;
    }
    case 'casters':
      body = (
        <>
          {match}
          <Group label="On screen">
            <Toggle on={show.showMatchupOnCasters} onClick={() => quick({ k: 'matchup-casters', on: !show.showMatchupOnCasters })}>Teams + score</Toggle>
            {s && <Toggle on={s.opts.inCasters} onClick={() => op({ k: 'opts', patch: { inCasters: !s.opts.inCasters } })}>Up next</Toggle>}
            {picksToggle}
          </Group>
          {who}
          {score}{picksFor(boothNow)}{countdown}{twitch}
        </>
      );
      break;
    case 'analysis':
      body = s ? (
        <>
          {match}
          <Group label="Desk">
            <Segmented size="sm" value={s.desk.panel} onChange={v => op({ k: 'desk', panel: v })}
              options={DESK_PANELS.map(p => ({ value: p, label: p === 'cams' ? 'Cameras' : p === 'picks' ? 'Predictions' : p === 'h2h' ? 'Head to head' : p === 'pickem' ? "Pick'em" : 'Player' }))} />
            {s.desk.panel === 'player' && (
              <select className="input h-10 text-[13px]" value={s.desk.player ?? ''} onChange={e => op({ k: 'desk', player: e.target.value || null })}>
                <option value="">{s.intro.a ? `First of ${s.intro.a}` : 'Pick a player'}</option>
                {(a || b ? MAJOR_PROFILES.filter(p => p.team === a || p.team === b) : MAJOR_PROFILES).map(p => <option key={p.handle} value={normHandle(p.handle)}>{p.handle} · {p.team}</option>)}
              </select>
            )}
          </Group>
          <Group label="On screen">
            {s.desk.panel === 'cams' && <Toggle on={s.desk.strip} onClick={() => op({ k: 'desk', strip: !s.desk.strip })}>Teams</Toggle>}
            {s.desk.panel === 'cams' && <Toggle on={s.desk.clock} onClick={() => op({ k: 'desk', clock: !s.desk.clock })}>Countdown</Toggle>}
            {picksToggle}
          </Group>
          {deskWho}
          {picksFor(deskNow)}{countdown}{twitch}
        </>
      ) : <Hint>Waiting for the server…</Hint>;
      break;
    case 'veto':
      body = s ? <>{match}<div className="border-l border-white/10 pl-3"><VetoControls s={s} op={op} /></div></> : <Hint>Waiting for the server…</Hint>;
      break;
    case 'interview':
      body = s ? <>{<div className="border-l border-white/10 pl-3"><InterviewControls s={s} casters={casters} op={op} /></div>}{countdown}</> : <Hint>Waiting for the server…</Hint>;
      break;
    case 'gameplay':
      body = (
        <>
          {match}{score}
          {s && (
            <Group label="Next map (plays the map card)">
              {vetoOrdered(s).map(({ m, no, ban }) => <Big key={m.id} active={s.map.id === m.id} onClick={() => op({ k: 'map', id: m.id })} title={ban ? 'Banned in the veto' : ''}>{no ? `${no}. ` : ''}{m.country}{ban ? <span className="ml-1 text-[11px] text-white/35">ban</span> : null}</Big>)}
            </Group>
          )}
          <Group label="On screen">
            <Toggle on={show.showScoreboard} onClick={() => quick({ k: 'flag', key: 'scoreboard', on: !show.showScoreboard })}>Scoreboard</Toggle>
            <Toggle on={show.gameplay.cams} onClick={() => quick({ k: 'flag', key: 'gameplay-cams', on: !show.gameplay.cams })}>Caster cams</Toggle>
            <Toggle on={show.gameplay.ticker} onClick={() => quick({ k: 'flag', key: 'gameplay-ticker', on: !show.gameplay.ticker })}>Ticker</Toggle>
          </Group>
          {show.brand.skin && (
            <Group label="Overlay">
              {(['replay', 'highlights'] as const).map(k => <Toggle key={k} on={show.badge.kind === k} onClick={() => send({ t: 'badge', kind: show.badge.kind === k ? 'none' : k })}>{k === 'replay' ? 'Replay' : 'Highlights'}</Toggle>)}
            </Group>
          )}
          {s && <Group label="Popup"><Big onClick={() => op({ k: 'replay' })}>Show last result again</Big></Group>}
          {twitch}
        </>
      );
      break;
    case 'bracket':
      body = s ? (
        <>
          <Group label="Showing">
            <Segmented size="sm" value={String(s.air) as '1' | '2'} onChange={v => op({ k: 'air', part: v === '2' ? 2 : 1 })} options={[{ value: '1', label: 'Upper + final' }, { value: '2', label: 'Lower + standings' }]} />
            <Toggle on={s.opts.rotate} onClick={() => op({ k: 'opts', patch: { rotate: !s.opts.rotate } })}>Switch every {s.opts.rotateSec} s</Toggle>
          </Group>
          {match}{champ}
        </>
      ) : <Hint>Waiting for the server…</Hint>;
      break;
    default: body = <>{match}{countdown}</>;
  }
  if (part === 'shared') body = shared;
  else body = <>{body}{music}</>;

  return (
    <div className={`rounded-md border px-3 py-2 ${forScreen && forScreen === live ? 'border-[#e5484d]/70 bg-[#e5484d]/[0.07]' : 'border-white/10 bg-[#171717]'}`}>
      {screens && (
        <div className="mb-2 flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
          {SCREEN_IDS.map(id => (
            <button key={id} type="button" onClick={() => send({ t: 'screen', screen: id, take: true })}
              className={`btn-sm ${id === live ? '!border-[#e5484d] !bg-[#e5484d]/30 !text-white' : ''}`}>{SCREEN_LABELS[id]}{id === live ? ' · ON AIR' : ''}</button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded-[3px] bg-white/10 px-1.5 py-[2px] text-[9.5px] font-bold tracking-[0.18em] text-white/70">CONTROLS</span>
          {forScreen ? (
            <>
              <span className="text-[13px] font-semibold">{SCREEN_LABELS[forScreen]}</span>
              {forScreen === live
                ? <span className="rounded-[3px] bg-[#e5484d] px-1.5 py-[2px] text-[9.5px] font-bold tracking-[0.18em]">ON AIR</span>
                : <button type="button" className="btn-sm !border-[#e5484d]/60 hover:!bg-[#e5484d]" onClick={() => send({ t: 'screen', screen: forScreen, take: true })}>GO</button>}
            </>
          ) : part === 'shared' ? <span className="text-[12.5px] font-semibold">Match &amp; show</span> : preview !== live ? (
            <Segmented size="sm" value={pick} onChange={setPick}
              options={[{ value: 'live', label: `On air: ${SCREEN_LABELS[live]}` }, { value: 'preview', label: `Ready: ${SCREEN_LABELS[preview]}` }]} />
          ) : <span className="text-[12.5px] font-semibold">{SCREEN_LABELS[screen]}</span>}
        </div>
        {body}
        {onMore && part !== 'shared' && !forScreen && <button type="button" className="ml-auto text-[11px] text-white/40 hover:text-white/75"
          onClick={() => onMore(screen === 'gameplay' || screen === 'casters' || screen === 'analysis' ? 'match' : screen === 'starting' || screen === 'brb' || screen === 'ending' ? 'screens' : 'wildcard')}>All settings →</button>}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-l border-white/10 pl-3">
      <span className="mr-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</span>
      {children}
    </div>
  );
}

/** Maps for the gameplay "Next map" row: the veto's play order first (1., 2., …), then the rest, bans last. */
function vetoOrdered(s: WildcardState) {
  const rows = vetoRows(s.veto);
  return MAJOR_MAPS.map(m => { const r = rows.find(x => x.map === m.id); return { m, no: r?.mapNo ?? null, ban: r?.step.act === 'ban' }; })
    .sort((x, y) => (x.ban ? 1 : 0) - (y.ban ? 1 : 0) || (x.no ?? 99) - (y.no ?? 99));
}

/** A big button: the dock has few controls, each easy to hit live. */
function Big({ children, onClick, active, disabled, title, primary }: { children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; title?: string; primary?: boolean }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`btn h-10 px-4 text-[14px] font-semibold ${primary ? '!border-[#e5484d] !bg-[#e5484d] !text-white' : active ? '!border-[#e5484d] !bg-[#e5484d]/25 !text-white' : ''}`}>{children}</button>
  );
}

/** On / off switch for something on screen: lit = on air. */
function Toggle({ children, on, onClick, disabled }: { children: ReactNode; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on}
      className={`btn h-10 gap-2 px-4 text-[14px] font-semibold ${on ? '!border-emerald-400/70 !bg-emerald-500/20 !text-white' : 'text-white/60'}`}>
      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-white/20'}`} />{children}
    </button>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <span className="text-[12px] text-white/45">{children}</span>;

/** Screens with no controls of their own (only the shared ones): shown as GO buttons in the everything dock. */
export const PLAIN_SCREENS: ScreenId[] = ['starting', 'brb', 'ending', 'matches'];

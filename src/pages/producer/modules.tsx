/**
 * Overdrive 2.0 producer modules. Each module is a reusable control panel that only sends engine commands
 * (acked, prioritised): no module keeps its own state of the show.
 * Tags: PVW = prepared, goes to the sources with PUBLISH · LIVE = straight to the sources (or prepared when
 * "Prepare live data" is on, for scores and predictions).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CasterId, ControllerState } from '../../../shared/types';
import type { DraftCmd, EngineState, ProducerCmd } from '../../../shared/engine';
import type { WildcardState, WcDeskPanel } from '../../../shared/wildcard';
import { INTERVIEW_TITLES, matchName, realTeam, VETO_PRESETS, vetoRows, WC_IDS, wcResolve, GRAND_FINAL } from '../../../shared/wildcard';
import { MAJOR_MAPS } from '../../../shared/maps';
import { normHandle, teamPlayers } from '../../../shared/major';
import { MODULES, type ModuleId, type SourceDef } from '../../../shared/registry';
import { SEAT_LABELS, talentLabel, type Seat } from '../../../shared/talent';
import { mediaName, type MediaState } from '../../../shared/media';
import { sectionFor, DEFAULT_LEVELS } from '../../../shared/music';

export const PGM = '#e5484d', PVW = '#2fbf71', WARN = '#f5a524';
export type Ack = { ok: boolean; error?: string; note?: string; version: number };
export type Run = (cmd: ProducerCmd, label: string) => Promise<Ack>;

export interface Ctx {
  st: ControllerState; eng: EngineState; wc: WildcardState; pv: WildcardState; run: Run; prepare: boolean;
  src: SourceDef; now: number; media: MediaState | null; mediaSkew: number;
}

/** Live data: straight to the sources, or into the draft when "Prepare live data" is on. */
const live = (x: Ctx, cmd: DraftCmd, label: string) => (x.prepare ? x.run({ c: 'draft', cmd }, `Prepared: ${label}`) : x.run(cmd, label));

export function ModuleView({ id, x, pinned }: { id: ModuleId; x: Ctx; pinned: boolean }) {
  const body = (() => {
    switch (id) {
      case 'talent-casters': return <SeatsModule x={x} seats={[1, 2, 3]} layouts={[[1, 'Solo'], [2, 'Duo'], [3, 'Trio']]} />;
      case 'talent-analysts': return <SeatsModule x={x} seats={[4, 5]} layouts={[[1, 'Solo'], [2, 'Duo']]} guest />;
      case 'talent-guest': return <SeatsModule x={x} seats={[6]} />;
      case 'cameras': return <CamerasModule x={x} />;
      case 'scoreboard': return <ScoreboardModule x={x} />;
      case 'match': return <MatchModule x={x} />;
      case 'predictions': return <PredictionsModule x={x} />;
      case 'stats': return <StatsModule x={x} />;
      case 'h2h': return <H2hModule x={x} />;
      case 'media': return <MediaModule x={x} />;
      case 'countdown': return <CountdownModule x={x} />;
      case 'graphics': return <GraphicsModule x={x} />;
      case 'bracket': return <BracketModule x={x} />;
      case 'music': return <MusicModule x={x} />;
      case 'veto': return <VetoModule x={x} />;
      case 'interview': return <InterviewModule x={x} />;
      case 'intro': return <IntroModule x={x} />;
      case 'showcase': return <ShowcaseModule x={x} />;
    }
  })();
  return (
    <section data-module={id} className="flex w-[430px] flex-none flex-col border-r border-white/10 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em]">
        {pinned && <span title="Pinned in Studio Mode" style={{ color: WARN }}>★</span>}
        <span>{MODULES[id].name}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">{body}</div>
    </section>
  );
}

// ======================================================================= talent / cameras
function useTalent(x: Ctx) {
  const talent = x.st.talent ?? [];
  const seats = x.st.seats ?? { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  const at = (s: number) => talent.find(t => t.id === seats[s as Seat]);
  return { talent, seats, at };
}
function Status({ t }: { t?: { online: boolean; publishing: boolean; hasAudio: boolean; mode: string } }) {
  if (!t) return <span className="text-[10px] text-white/30">empty</span>;
  if (t.mode === 'vdo') return <span className="text-[10px] font-bold text-white/60" title="Camera via VDO.Ninja">● VDO</span>;
  if (t.publishing) return <span className="text-[10px] font-bold" style={{ color: PVW }}>● {t.hasAudio ? 'CAM+MIC' : 'CAM'}</span>;
  if (t.online) return <span className="text-[10px] font-bold" style={{ color: WARN }}>● NO CAM</span>;
  return <span className="text-[10px] font-bold text-white/35">● OFFLINE</span>;
}

function SeatsModule({ x, seats, layouts, guest }: { x: Ctx; seats: Seat[]; layouts?: [number, string][]; guest?: boolean }) {
  const { talent, at } = useTalent(x);
  const isBooth = seats[0] === 1;
  const visible: number[] = isBooth ? (x.eng.stage.booth.length ? x.eng.stage.booth : seats.filter(s => x.st.preview.casters[s - 1]?.enabled)) : seats[0] === 4 ? (x.eng.stage.desk.slots.length ? x.eng.stage.desk.slots : [4, 5]) : seats;
  const setVisible = (ids: number[], label: string) => (isBooth ? x.run({ c: 'stage-booth', ids }, label) : x.run({ c: 'stage-desk', analysts: ids }, label));
  return (
    <>
      <Tag live>Assignments</Tag>
      {seats.map((s, i) => {
        const t = at(s);
        return (
          <div key={s} data-seat={s} className="flex items-center gap-1.5 rounded-[2px] border border-white/10 bg-white/[0.03] px-2 py-1.5">
            <div className="w-[104px] flex-none"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">{SEAT_LABELS[s]}</div><Status t={t} /></div>
            <select aria-label={`Talent in ${SEAT_LABELS[s]}`} value={t?.id ?? ''} onChange={e => x.run({ c: 'seat', seat: s, talent: e.target.value || null }, `${SEAT_LABELS[s]}: ${e.target.value ? talentLabel(talent.find(p => p.id === e.target.value)) : 'empty'}`)}
              className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5 py-1 text-[12px]">
              <option value="">— empty —</option>
              {talent.map(p => <option key={p.id} value={p.id}>{talentLabel(p)} · {p.role}{p.publishing ? ' · ●' : p.online ? ' · ○' : ''}{p.seat && p.seat !== s ? ` (in ${p.seat}: swap)` : ''}</option>)}
            </select>
            {seats.length > 1 && <Tiny disabled={i === 0} title="Swap with the position on the left" onClick={() => at(seats[i - 1]) || t ? x.run({ c: 'seat', seat: seats[i - 1], talent: t?.id ?? null }, `Swap ${s} ↔ ${seats[i - 1]}`) : Promise.resolve()}>◀</Tiny>}
            {layouts && <Chip on={visible.includes(s)} title="On screen (prepared)" onClick={() => setVisible(visible.includes(s) ? visible.filter(v => v !== s) : [...visible, s].sort(), `${SEAT_LABELS[s]} ${visible.includes(s) ? 'hidden' : 'shown'}`)}>{visible.includes(s) ? 'Shown' : 'Hidden'}</Chip>}
          </div>
        );
      })}
      {layouts && (
        <div className="flex items-center gap-2"><Tag>Layout</Tag>
          <Seg value={String(visible.length)} options={layouts.map(([n, l]) => [String(n), l])}
            onChange={v => { const n = Number(v); const filled = seats.filter(s => at(s)); const pick = [...filled, ...seats.filter(s => !filled.includes(s))].slice(0, n).sort(); setVisible(pick, `Layout ${layouts.find(l => l[0] === n)?.[1]}`); }} />
        </div>
      )}
      {guest && (
        <div className="flex flex-wrap items-center gap-1"><Tag>Caster joins</Tag>
          <Chip on={x.eng.stage.desk.guest == null} onClick={() => x.run({ c: 'stage-desk', guest: null }, 'No caster at the desk')}>None</Chip>
          {[1, 2, 3].map(s => <Chip key={s} on={x.eng.stage.desk.guest === s} onClick={() => x.run({ c: 'stage-desk', guest: s }, `Caster ${s} joins the desk`)}>{talentLabel(at(s)) === '—' ? `Caster ${s}` : talentLabel(at(s))}</Chip>)}
        </div>
      )}
    </>
  );
}

function CamerasModule({ x }: { x: Ctx }) {
  const { at } = useTalent(x);
  const seats: number[] = x.src.screen === 'analysis' ? [4, 5, ...(x.eng.stage.desk.guest ? [x.eng.stage.desk.guest] : [])] : x.src.screen === 'interview' ? [6, ...(x.wc.interview.host ? [x.wc.interview.host] : [])] : [1, 2, 3];
  return (
    <>
      {seats.map(s => {
        const c = x.st.preview.casters[s - 1], cs = x.st.contributors[s as CasterId], t = at(s);
        return (
          <div key={s} data-camera={s} className="flex items-center gap-2 text-[12px]">
            <span className="w-[120px] truncate"><b>{SEAT_LABELS[s as Seat].split(' · ')[0]}</b> <span className="text-white/50">{talentLabel(t)}</span></span>
            <Seg value={c?.cameraOn ? 'on' : 'off'} options={[['on', 'Cam on'], ['off', 'Off']]} onChange={v => x.run({ c: 'camera', seat: s, on: v === 'on' }, `Camera ${s} ${v}`)} />
            <span className="w-[86px] text-[10.5px] text-white/55">{cs?.publishing ? `● live · ${cs.viewers} view` : cs?.online ? '○ no camera' : '○ offline'}</span>
            <Tiny title="Renegotiate this feed for every source (the talent does nothing)" onClick={() => x.run({ c: 'feed-resync', seat: s }, `Re-sync camera ${s}`)}>⟳</Tiny>
          </div>
        );
      })}
      <div className="text-[10.5px] text-white/40">Camera on/off is prepared (PUBLISH). ⟳ re-syncs a frozen feed live.</div>
    </>
  );
}

// ======================================================================= match / score / predictions
function ScoreboardModule({ x }: { x: Ctx }) {
  return (
    <>
      <FlagRow x={x} label="Scoreboard" flag="scoreboard" pvw={x.st.showPreview.showScoreboard} pgm={x.st.showLive.showScoreboard} />
      <ScoreRow x={x} />
      <FlagRow x={x} label="Matchup bar on screens" flag="matchup-screens" pvw={x.st.showPreview.showMatchupOnScreens} pgm={x.st.showLive.showMatchupOnScreens} />
    </>
  );
}
export function ScoreRow({ x }: { x: Ctx }) {
  const a = x.st.showLive.teamA, b = x.st.showLive.teamB;
  const pending = x.eng.draft.filter(d => d.c === 'score');
  const pa = pending.reduce((n, d) => n + (d.c === 'score' && d.side === 'a' ? d.delta : 0), 0), pb = pending.reduce((n, d) => n + (d.c === 'score' && d.side === 'b' ? d.delta : 0), 0);
  return (
    <div data-score>
      <Tag live>Series score{x.prepare ? ' (prepared)' : ''}</Tag>
      <div className="mt-1 flex items-center gap-1.5">
        <Btn onClick={() => live(x, { c: 'score', side: 'a', delta: -1 }, `${a.name || 'A'} −1`)}>−</Btn>
        <Btn onClick={() => live(x, { c: 'score', side: 'a', delta: 1 }, `${a.name || 'A'} +1`)}>+1 {a.tag || a.name || 'A'}</Btn>
        <span className="w-[86px] text-center font-['Russo_One'] text-[22px] tabular-nums">{a.score}-{b.score}</span>
        <Btn onClick={() => live(x, { c: 'score', side: 'b', delta: 1 }, `${b.name || 'B'} +1`)}>+1 {b.tag || b.name || 'B'}</Btn>
        <Btn onClick={() => live(x, { c: 'score', side: 'b', delta: -1 }, `${b.name || 'B'} −1`)}>−</Btn>
      </div>
      {(pa || pb) ? <div className="mt-0.5 text-[11px]" style={{ color: WARN }}>Prepared: {a.score + pa}-{b.score + pb} (PUBLISH to show)</div> : null}
    </div>
  );
}
export function MatchModule({ x }: { x: Ctx }) {
  const r = wcResolve(x.wc.matches, x.wc.teams);
  const ids = WC_IDS.filter(id => realTeam(r[id].t1) && realTeam(r[id].t2));
  return (
    <>
      <Tag live>Match being cast</Tag>
      <select aria-label="Match being cast" value={x.wc.cast ?? ''} onChange={e => x.run({ c: 'cast-match', id: e.target.value || null }, 'Cast match')} className="w-full rounded-[2px] border border-white/15 bg-[#0b0b0c] px-2 py-1.5 text-[12.5px]">
        <option value="">— no match —</option>
        {ids.map(id => <option key={id} value={id}>{matchName(id)}: {r[id].t1} vs {r[id].t2}{r[id].winner ? ' (final)' : ''}</option>)}
      </select>
      {!ids.length && <div className="text-[11px]" style={{ color: WARN }}>No match has two teams yet (Controller → Major → teams).</div>}
      {x.wc.cast && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-white/55">Best of 5 · game {x.st.showLive.game}</span>
          <Chip on={!!x.wc.matches[x.wc.cast]?.live} onClick={() => x.run({ c: 'op-wc', op: { k: 'live', id: x.wc.cast!, on: !x.wc.matches[x.wc.cast!]?.live } }, 'Match live flag')}>{x.wc.matches[x.wc.cast]?.live ? '● Live' : 'Mark live'}</Chip>
          <Chip on={x.wc.opts.inCasters} onClick={() => x.run({ c: 'op-wc', op: { k: 'opts', patch: { inCasters: !x.wc.opts.inCasters } } }, 'Up next on caster desk')}>Up next card</Chip>
        </div>
      )}
    </>
  );
}
export function PredictionsModule({ x }: { x: Ctx }) {
  const { at } = useTalent(x);
  const it = x.pv.intro;
  const people: number[] = x.src.screen === 'analysis' ? [...(x.eng.stage.desk.guest ? [x.eng.stage.desk.guest] : []), 4, 5] : [1, 2, 3].filter(s => at(s) || x.st.preview.casters[s - 1]?.enabled);
  if (!it.a || !it.b) return <div className="text-[12px] text-white/50">Cast a match first (Match manager): predictions are for the cast match.</div>;
  const name = (s: number) => (at(s) ? talentLabel(at(s)) : x.st.preview.casters[s - 1]?.name ?? `Slot ${s}`);
  return (
    <>
      <div className="flex items-center gap-2"><Tag live>Picks{x.prepare ? ' (prepared)' : ''}</Tag>
        <Chip on={it.picksShow} onClick={() => live(x, { c: 'picks-show', on: !it.picksShow }, `Prediction badges ${it.picksShow ? 'off' : 'on'}`)}>Badges {it.picksShow ? 'ON' : 'OFF'}</Chip>
      </div>
      {people.map(s => {
        const p = it.picks[String(s)];
        return (
          <div key={s} data-pick={s} className="flex items-center gap-1 text-[12px]">
            <span className="w-[92px] truncate font-bold">{name(s)}</span>
            {[it.a, it.b].map(t => <Chip key={t} on={p?.team === t} onClick={() => live(x, { c: 'pick', slot: s, team: t, score: p?.score || '3-1' }, `${name(s)} picks ${t}`)}>{t}</Chip>)}
            {['3-0', '3-1', '3-2'].map(sc => <Chip key={sc} on={p?.score === sc} disabled={!p} onClick={() => p && live(x, { c: 'pick', slot: s, team: p.team, score: sc }, `${name(s)} ${sc}`)}>{sc}</Chip>)}
            {p && <Tiny onClick={() => live(x, { c: 'pick', slot: s, team: null }, `${name(s)} pick cleared`)}>✕</Tiny>}
          </div>
        );
      })}
    </>
  );
}

// ======================================================================= analyst desk content
function PanelSeg({ x, options }: { x: Ctx; options: [WcDeskPanel, string][] }) {
  return <Seg value={x.eng.stage.desk.panel} options={options} onChange={v => x.run({ c: 'stage-desk', panel: v as WcDeskPanel }, `Desk panel: ${v}`)} />;
}
function StatsModule({ x }: { x: Ctx }) {
  const it = x.wc.intro, players = [...(it.a ? teamPlayers(it.a) : []), ...(it.b ? teamPlayers(it.b) : [])];
  return (
    <>
      <Tag>Desk panel</Tag>
      <PanelSeg x={x} options={[['cams', 'Cameras'], ['picks', 'Predictions'], ['player', 'Player stats'], ['pickem', "Pick'em"]]} />
      <Tag live>Player in focus</Tag>
      <select aria-label="Player in focus" value={x.wc.desk.player ?? ''} onChange={e => x.run({ c: 'op-wc', op: { k: 'desk', player: e.target.value || null } }, 'Player in focus')} className="w-full rounded-[2px] border border-white/15 bg-[#0b0b0c] px-2 py-1 text-[12px]">
        <option value="">First player of {it.a || 'team A'}</option>
        {players.map(p => <option key={p.handle} value={normHandle(p.handle)}>{p.handle} · {p.team}</option>)}
      </select>
    </>
  );
}
function H2hModule({ x }: { x: Ctx }) {
  return (
    <>
      <Btn active={x.eng.stage.desk.panel === 'h2h'} onClick={() => x.run({ c: 'stage-desk', panel: x.eng.stage.desk.panel === 'h2h' ? 'cams' : 'h2h' }, 'Head-to-head panel')}>{x.eng.stage.desk.panel === 'h2h' ? 'Head-to-head prepared ✓' : 'Prepare head-to-head panel'}</Btn>
      <FlagRow x={x} label="VS strip" flag="desk-strip" pvw={x.eng.stage.desk.strip} pgm={x.wc.desk.strip} />
      <FlagRow x={x} label="Countdown on desk" flag="desk-clock" pvw={x.eng.stage.desk.clock} pgm={x.wc.desk.clock} />
    </>
  );
}

// ======================================================================= media
function MediaModule({ x }: { x: Ctx }) {
  const [lib, setLib] = useState<{ url: string; name: string; size: number }[] | null>(null);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const load = () => fetch('/api/media').then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(j => setLib(j.items)).catch(e => setErr(`Media library unavailable (${e.message})`));
  useEffect(() => { load(); }, []);
  const m = x.media;
  const upload = async (f: File) => {
    setErr('');
    const r = await fetch('/api/media', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(f.name) }, body: f });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? `Upload failed (${r.status})`); else setLib((await r.json()).items);
  };
  const pos = m && m.status === 'playing' && m.startedAt ? (x.now - m.startedAt) / 1000 : m ? m.pausedMs / 1000 : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <>
      <div className="flex items-center gap-1" data-media-transport>
        <Tag live>Transport</Tag>
        <Btn onClick={() => x.run({ c: 'media', action: 'prev' }, 'Media previous')}>⏮</Btn>
        <Btn active={m?.status === 'playing'} onClick={() => x.run({ c: 'media', action: 'play' }, 'Media play')}>▶ Play</Btn>
        <Btn active={m?.status === 'paused'} onClick={() => x.run({ c: 'media', action: 'pause' }, 'Media pause')}>⏸</Btn>
        <Btn onClick={() => x.run({ c: 'media', action: 'stop' }, 'Media stop')}>⏹</Btn>
        <Btn onClick={() => x.run({ c: 'media', action: 'next' }, 'Media next')}>⏭</Btn>
      </div>
      <div className="text-[11.5px] text-white/65">{m && m.playlist.length ? `${m.status.toUpperCase()} · ${m.index + 1}/${m.playlist.length} ${mediaName(m.playlist[m.index] ?? '')}${m.status !== 'stopped' ? ` · ${fmt(pos)}` : ''}` : 'Playlist empty'}</div>
      <div className="flex items-center gap-2 text-[11.5px]">
        <input aria-label="Media volume" type="range" min={0} max={1} step={0.05} value={m?.volume ?? 1} onChange={e => x.run({ c: 'media-opts', volume: +e.target.value }, 'Media volume')} className="w-24 accent-white" />
        <Chip on={!!m?.muted} onClick={() => x.run({ c: 'media-opts', muted: !m?.muted }, 'Media mute')}>Mute</Chip>
        <Chip on={!!m?.auto} onClick={() => x.run({ c: 'media-opts', auto: !m?.auto }, 'Auto-advance')}>Auto next</Chip>
        <Chip on={!!m?.loop} onClick={() => x.run({ c: 'media-opts', loop: !m?.loop }, 'Loop playlist')}>Loop</Chip>
      </div>
      <Tag>Playlist</Tag>
      {(m?.playlist ?? []).map((u, i) => (
        <div key={u + i} className="flex items-center gap-1 text-[12px]" data-playlist-item={i}>
          <button type="button" className={`flex-1 truncate text-left ${m?.index === i ? 'font-bold text-white' : 'text-white/70'}`} onClick={() => x.run({ c: 'media', action: 'goto', index: i }, `Play ${mediaName(u)}`)}>{m?.index === i ? '▶ ' : ''}{mediaName(u)}</button>
          <Tiny disabled={i === 0} onClick={() => { const p = [...m!.playlist]; [p[i - 1], p[i]] = [p[i], p[i - 1]]; x.run({ c: 'media-set', playlist: p }, 'Playlist order'); }}>▲</Tiny>
          <Tiny onClick={() => x.run({ c: 'media-set', playlist: m!.playlist.filter((_, j) => j !== i) }, 'Remove from playlist')}>✕</Tiny>
        </div>
      ))}
      <Tag>Library</Tag>
      {lib?.map(it => (
        <div key={it.url} className="flex items-center gap-1 text-[12px]">
          <span className="flex-1 truncate text-white/70">{it.name}</span>
          <Tiny onClick={() => x.run({ c: 'media-set', playlist: [...(m?.playlist ?? []), it.url] }, `Add ${it.name}`)}>+</Tiny>
        </div>
      ))}
      <input ref={file} type="file" accept="video/*,audio/*,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      <Btn onClick={() => file.current?.click()}>Upload media…</Btn>
      {err && <div className="text-[11px]" style={{ color: WARN }}>{err}</div>}
    </>
  );
}

// ======================================================================= countdown / graphics / bracket / music
function CountdownModule({ x }: { x: Ctx }) {
  const tg = x.st.showLive.timer.target;
  const left = tg ? Math.max(0, tg - x.now) : null;
  const q = (op: import('../../../shared/protocol').QuickOp, l: string) => x.run({ c: 'op-quick', op }, l);
  return (
    <>
      <div className="text-[13px]"><Tag live>Starts in</Tag> <b className="ml-2 font-['Russo_One'] text-[20px] tabular-nums">{left != null ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : '—'}</b></div>
      <div className="flex flex-wrap gap-1">
        {[5, 10, 15, 30].map(n => <Btn key={n} onClick={() => q({ k: 'timer-start', minutes: n }, `Countdown ${n} min`)}>{n} min</Btn>)}
        <Btn disabled={!tg} onClick={() => q({ k: 'timer-add', minutes: 1 }, 'Countdown +1')}>+1</Btn>
        <Btn disabled={!tg} onClick={() => q({ k: 'timer-add', minutes: -1 }, 'Countdown −1')}>−1</Btn>
        <Btn disabled={!tg} onClick={() => q({ k: 'timer-stop' }, 'Countdown stop')}>Stop</Btn>
      </div>
    </>
  );
}
function GraphicsModule({ x }: { x: Ctx }) {
  const gfWinner = !!wcResolve(x.wc.matches, x.wc.teams)[GRAND_FINAL]?.winner;
  return (
    <>
      <Tag live>Map card (gameplay)</Tag>
      <div className="flex flex-wrap gap-1">{MAJOR_MAPS.map(m => <Btn key={m.id} active={x.wc.map.id === m.id} onClick={() => x.run({ c: 'graphic', g: 'map-card', map: m.id }, `Map card ${m.country}`)}>{m.flag} {m.country}</Btn>)}</div>
      <Tag live>Badges & popups</Tag>
      <div className="flex flex-wrap gap-1">
        <Btn active={x.st.showLive.badge.kind === 'replay'} onClick={() => x.run({ c: 'graphic', g: 'replay' }, 'Replay')}>Replay</Btn>
        <Btn active={x.st.showLive.badge.kind === 'highlights'} onClick={() => x.run({ c: 'graphic', g: 'highlights' }, 'Highlights')}>Highlights</Btn>
        <Btn onClick={() => x.run({ c: 'graphic', g: 'clear-badge' }, 'Clear badge')}>Clear badge</Btn>
        <Btn onClick={() => x.run({ c: 'op-wc', op: { k: 'replay' } }, 'Replay last popup')}>Replay last popup</Btn>
        <Btn active={x.wc.champ} disabled={!gfWinner && !x.wc.champ} title={gfWinner ? '' : 'Needs a Grand final winner'} onClick={() => x.run({ c: 'op-wc', op: { k: 'champ', on: !x.wc.champ } }, 'Champions')}>Champions</Btn>
      </div>
    </>
  );
}
function BracketModule({ x }: { x: Ctx }) {
  return (
    <>
      <Tag live>On screen</Tag>
      <Seg value={String(x.wc.air)} options={[['1', 'Upper + GF'], ['2', 'Lower + standings']]} onChange={v => x.run({ c: 'op-wc', op: { k: 'air', part: Number(v) as 1 | 2 } }, `Bracket part ${v}`)} />
      <Chip on={x.wc.opts.rotate} onClick={() => x.run({ c: 'op-wc', op: { k: 'opts', patch: { rotate: !x.wc.opts.rotate } } }, 'Bracket auto switch')}>Auto switch halves</Chip>
      <div className="text-[11px] text-white/45">Results come from the match scores (Match manager / Scoreboard) and the sheet sync.</div>
    </>
  );
}
function MusicModule({ x }: { x: Ctx }) {
  const sec = x.src.screen ? sectionFor(x.src.screen) : null;
  const m = x.st.showLive.music;
  const lv = sec ? m.levels[sec] : 0;
  const q = (patch: Partial<typeof m>, l: string) => x.run({ c: 'op-quick', op: { k: 'music', patch } }, l);
  return (
    <>
      <div className="flex items-center gap-2"><Tag live>Master</Tag><Chip on={m.enabled} onClick={() => q({ enabled: !m.enabled }, 'Music master')}>{m.enabled ? 'Music on' : 'Music off'}</Chip>
        <Btn onClick={() => q({ skip: Date.now() }, 'Skip track')}>Skip ⏭</Btn></div>
      {sec ? (
        <div className="flex items-center gap-2 text-[12px]"><Tag live>This scene</Tag>
          <input aria-label="Scene music level" type="range" min={0} max={1} step={0.05} value={lv} onChange={e => q({ levels: { ...m.levels, [sec]: +e.target.value } }, 'Scene music level')} className="w-24 accent-white" />
          <span className="w-9 tabular-nums">{lv ? `${Math.round(lv * 100)}%` : 'Off'}</span>
          <Chip on={lv > 0} onClick={() => q({ levels: { ...m.levels, [sec]: lv > 0 ? 0 : DEFAULT_LEVELS[sec] || 0.4 } }, 'Scene music on/off')}>{lv > 0 ? 'On' : 'Off'}</Chip>
        </div>
      ) : <div className="text-[11px] text-white/45">This source has no music bed of its own.</div>}
    </>
  );
}

// ======================================================================= veto / interview / intro / showcase
function VetoModule({ x }: { x: Ctx }) {
  const v = x.wc.veto, rows = vetoRows(v), step = v.order[v.done.length];
  const op = (o: import('../../../shared/wildcard').WcOp, l: string) => x.run({ c: 'op-wc', op: o }, l);
  return (
    <>
      <div className="flex items-center gap-2 text-[12px]"><Tag live>Format</Tag>
        <select aria-label="Veto format" value={VETO_PRESETS.find(p => JSON.stringify(p.order) === JSON.stringify(v.order))?.id ?? ''} onChange={e => { const p = VETO_PRESETS.find(q => q.id === e.target.value); if (p) op({ k: 'veto-order', order: p.order }, `Veto: ${p.label}`); }} className="rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5 py-1 text-[12px]">
          {VETO_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div className="text-[12px]">{step ? <>Next: <b>{step.by === 'a' ? x.wc.intro.a || 'Team A' : step.by === 'b' ? x.wc.intro.b || 'Team B' : 'Decider'}</b> {step.act}</> : 'Veto complete'}</div>
      <div className="flex flex-wrap gap-1">{MAJOR_MAPS.map(m => { const done = rows.find(r => r.map === m.id); return <Btn key={m.id} disabled={!!done || !step} onClick={() => op({ k: 'veto', map: m.id }, `Veto ${m.country}`)}>{m.flag} {m.country}{done ? ` · ${done.step.act}` : ''}</Btn>; })}</div>
      <div className="flex gap-1"><Btn disabled={!v.done.length} onClick={() => op({ k: 'veto-undo' }, 'Veto undo')}>Undo</Btn><Btn disabled={!v.done.length} onClick={() => op({ k: 'veto-reset' }, 'Veto reset')}>Reset</Btn></div>
      <Tag live>Team PBs panel</Tag>
      <div className="flex flex-wrap gap-1">{MAJOR_MAPS.map(m => <Btn key={m.id} active={v.pb.map === m.id} onClick={() => op({ k: 'pb-show', map: m.id }, `PBs ${m.country}`)}>{m.flag}</Btn>)}<Btn onClick={() => op({ k: 'pb-show', map: null }, 'Hide PBs')}>Hide</Btn></div>
    </>
  );
}
function InterviewModule({ x }: { x: Ctx }) {
  const iv = x.wc.interview, it = x.wc.intro;
  const [q, setQ] = useState(iv.question);
  useEffect(() => setQ(iv.question), [iv.question]);
  const set = (patch: Partial<typeof iv>, l: string) => x.run({ c: 'op-wc', op: { k: 'interview', patch } }, l);
  const players = [...(it.a ? teamPlayers(it.a) : []), ...(it.b ? teamPlayers(it.b) : [])];
  return (
    <>
      <div className="flex items-center gap-1 text-[12px]"><Tag live>Player</Tag>
        <select aria-label="Interview player" value={iv.player} onChange={e => set({ player: e.target.value }, 'Interview player')} className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5 py-1 text-[12px]">
          <option value="">Guest camera's name</option>
          {players.map(p => <option key={p.handle} value={normHandle(p.handle)}>{p.handle} · {p.team}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1"><Tag live>Host</Tag><Chip on={iv.host == null} onClick={() => set({ host: null }, 'No host')}>None</Chip>{[1, 2, 3].map(s => <Chip key={s} on={iv.host === s} onClick={() => set({ host: s }, `Host caster ${s}`)}>Caster {s}</Chip>)}</div>
      <div className="flex flex-wrap gap-1">{INTERVIEW_TITLES.map(t => <Chip key={t} on={iv.title === t} onClick={() => set({ title: t }, 'Interview title')}>{t}</Chip>)}</div>
      <div className="flex gap-1"><input aria-label="Question" value={q} onChange={e => setQ(e.target.value)} placeholder="Question on screen" className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-[#0b0b0c] px-2 py-1 text-[12px]" />
        <Btn onClick={() => set({ question: q, showQ: true }, 'Show question')}>Show</Btn><Btn onClick={() => set({ showQ: false }, 'Hide question')}>Hide</Btn></div>
      <Chip on={iv.lower} onClick={() => set({ lower: !iv.lower }, 'Lower third')}>Lower third {iv.lower ? 'ON' : 'OFF'}</Chip>
    </>
  );
}
function IntroModule({ x }: { x: Ctx }) {
  const it = x.wc.intro;
  return (
    <>
      <div className="text-[12px] text-white/70">{it.a && it.b ? `${it.a} vs ${it.b}` : 'Cast a match first'}{it.label ? ` · ${it.label}` : ''}</div>
      <div className="flex gap-1"><Btn disabled={!it.a || !it.b} active={!!it.at} onClick={() => x.run({ c: 'op-wc', op: { k: 'intro-play' } }, 'Play team intro')}>▶ Play team intro</Btn><Btn disabled={!it.at} onClick={() => x.run({ c: 'op-wc', op: { k: 'intro-stop' } }, 'Stop team intro')}>Stop</Btn></div>
    </>
  );
}
function ShowcaseModule({ x }: { x: Ctx }) {
  const sc = x.wc.showcase, it = x.wc.intro;
  const players = sc.team ? teamPlayers(sc.team) : [...(it.a ? teamPlayers(it.a) : []), ...(it.b ? teamPlayers(it.b) : [])];
  const set = (patch: Record<string, unknown>, l: string) => x.run({ c: 'op-wc', op: { k: 'showcase', patch } }, l);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1"><Tag live>Team</Tag><Chip on={!sc.team} onClick={() => set({ team: '' }, 'All players')}>All</Chip>{[it.a, it.b].filter(Boolean).map(t => <Chip key={t} on={sc.team === t} onClick={() => set({ team: t }, `Showcase ${t}`)}>{t}</Chip>)}</div>
      <div className="flex flex-wrap gap-1"><Chip on={!sc.pin} onClick={() => set({ pin: null }, 'Rotate players')}>Rotate</Chip>{players.map(p => <Chip key={p.handle} on={sc.pin === normHandle(p.handle)} onClick={() => set({ pin: normHandle(p.handle) }, `Hold ${p.handle}`)}>{p.handle}</Chip>)}</div>
      <div className="flex items-center gap-1 text-[12px]"><Tag live>Seconds</Tag>{[8, 12, 20].map(n => <Chip key={n} on={sc.seconds === n} onClick={() => set({ seconds: n }, `${n} s per player`)}>{n}s</Chip>)}</div>
    </>
  );
}

// ======================================================================= shared bits
function FlagRow({ x, label, flag, pvw, pgm }: { x: Ctx; label: string; flag: import('../../../shared/engine').StageFlag; pvw: boolean; pgm: boolean }) {
  return (
    <div className="flex items-center gap-2" data-control={label}>
      <span className="w-[120px] text-[12px] text-white/75">{label}</span>
      <Seg value={pvw ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={v => x.run({ c: 'stage-flag', flag, on: v === 'on' }, `${label} ${v}`)} />
      <span className="text-[10.5px]" style={{ color: pvw !== pgm ? WARN : 'rgba(255,255,255,.35)' }}>{pvw !== pgm ? 'prepared' : `live ${pgm ? 'on' : 'off'}`}</span>
    </div>
  );
}
export function Tag({ children, live }: { children: ReactNode; live?: boolean }) {
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">{children}<span className="rounded-[2px] px-1 text-[8.5px] tracking-[0.08em]" style={live ? { background: PGM, color: '#fff' } : { background: PVW, color: '#000' }} title={live ? 'Goes straight to the sources' : 'Prepared: PUBLISH sends it'}>{live ? 'LIVE' : 'PVW'}</span></span>;
}
export function Btn({ children, onClick, disabled, active, danger, title }: { children: ReactNode; onClick: () => unknown; disabled?: boolean; active?: boolean; danger?: boolean; title?: string }) {
  return <button type="button" title={title} disabled={disabled} onClick={() => onClick()} className={`rounded-[2px] border px-2 py-1 text-[12px] font-bold disabled:opacity-35 ${active ? 'border-white bg-white text-black' : danger ? 'border-[#e5484d]/60 text-[#ff8a8d] hover:bg-[#e5484d]/20' : 'border-white/15 hover:border-white/40'}`}>{children}</button>;
}
export function Tiny({ children, onClick, disabled, title }: { children: ReactNode; onClick: () => unknown; disabled?: boolean; title?: string }) {
  return <button type="button" title={title} disabled={disabled} onClick={() => onClick()} className="grid h-6 min-w-6 place-items-center rounded-[2px] border border-white/15 px-1 text-[11px] hover:border-white/40 disabled:opacity-25">{children}</button>;
}
export function Chip({ children, on, onClick, disabled, title }: { children: ReactNode; on: boolean; onClick: () => unknown; disabled?: boolean; title?: string }) {
  return <button type="button" title={title} disabled={disabled} onClick={() => onClick()} className={`flex items-center gap-1 rounded-[2px] border px-2 py-[3px] text-[11.5px] font-semibold disabled:opacity-30 ${on ? 'border-white bg-white text-black' : 'border-white/15 hover:border-white/40'}`}>{children}</button>;
}
export function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return <div className="inline-flex overflow-hidden rounded-[2px] border border-white/15">{options.map(([v, l]) => <button key={v} type="button" onClick={() => v !== value && onChange(v)} className={`px-2.5 py-1 text-[11.5px] font-bold ${v === value ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'}`}>{l}</button>)}</div>;
}

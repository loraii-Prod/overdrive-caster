import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Logo } from '../../components/Brand';
import { ScaledCanvas } from '../../components/Stage';
import { Program } from '../../components/show/Program';
import { formatRemaining } from '../../components/show/parts';
import { useMatchData, useConnState, useNow, useSocket, useTournament, useViewer, useWantedCameras } from '../../lib/hooks';
import { compose } from '../../../shared/layout';
import { sameScene, SCREEN_LABELS } from '../../../shared/defaults';
import { SCREEN_IDS, THEMES } from '../../../shared/types';
import type { QuickOp } from '../../../shared/protocol';
import type { Caster, CasterId, ControllerState, LayoutMode, Scene, Show } from '../../../shared/types';
import { CasterCard } from './CasterCard';
import { ThemeProvider } from '../../lib/theme';
import { IntegrationsTab, MatchTab, PrizeTab, ScreensTab, SponsorsTab, TickerTab, TimerTab, TournamentTab, type ShowProps } from './ShowPanels';
import { ConfirmButton, CopyField, Dot, Segmented, Switch } from './ui';
import { RosBar, RosEditor } from './RosEditor';
import { PlayersPanel } from './PlayersPanel';
import { ObsPanel } from './ObsPanel';
import { NextMatchPanel } from './NextMatchPanel';
import { MusicPanel } from './MusicPanel';
import { BrandPanel, EventsPanel } from './EventsPanel';
import { SheetPanel } from './SheetPanel';
import { newCasterStreamId, vdoCasterPushUrl } from '../../../shared/players';

const LAYOUTS: { value: LayoutMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Solo/Duo/Trio from the number of active casters' },
  { value: 'solo', label: 'Solo', hint: 'One caster' },
  { value: 'duo', label: 'Duo', hint: 'Two casters' },
  { value: 'trio', label: 'Trio', hint: 'Three casters' },
  { value: 'audio', label: 'Audio only', hint: 'Name cards only, animated background' },
];

const OUTPUT_ROUTES: { route: string; label: string }[] = [
  { route: 'program', label: 'Whole show (recommended)' },
  { route: 'gameplay', label: 'Gameplay overlay' },
  { route: 'warmup', label: 'Warm-up lobby cams' },
  { route: 'nextmatch', label: 'Next match counter only' },
  { route: 'music', label: 'Music (audio only)' },
  { route: 'player', label: 'Player spotlight only' },
  { route: 'playercam', label: 'Player cam only' },
  { route: 'scoreboard', label: 'In-game scoreboard' },
  { route: 'ticker', label: 'Ticker' },
  { route: 'casters', label: 'Casters only' },
  { route: 'names', label: 'Nameplates only' },
  { route: 'branding', label: 'Branding only' },
  { route: 'starting', label: 'Starting soon' },
  { route: 'brb', label: 'Be right back' },
  { route: 'ending', label: 'Thanks for watching' },
  { route: 'bracket', label: 'Bracket' },
  { route: 'matches', label: 'Upcoming & results' },
  { route: 'solo', label: 'Solo layout' },
  { route: 'duo', label: 'Duo layout' },
  { route: 'trio', label: 'Trio layout' },
];

type Section = 'events' | 'live' | 'ros' | 'casters' | 'players' | 'match' | 'music' | 'screens' | 'tournament' | 'settings';
const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'events', label: 'Events', hint: 'Switch production, brand kit' },
  { id: 'live', label: 'Live', hint: 'Layout, score, presets' },
  { id: 'ros', label: 'Run of show', hint: 'Rundown, caster messages' },
  { id: 'casters', label: 'Casters', hint: 'Names, cameras' },
  { id: 'players', label: 'Players', hint: 'Cams, spotlight, facts' },
  { id: 'match', label: 'Match', hint: 'Score, timer' },
  { id: 'music', label: 'Music', hint: 'Beds per screen, volume' },
  { id: 'screens', label: 'Screens', hint: 'Texts, ticker, sponsors' },
  { id: 'tournament', label: 'Tournament', hint: 'Bracket link' },
  { id: 'settings', label: 'Settings', hint: 'OBS, API, reset' },
];

export function Controller({ onLogout }: { onLogout: () => void }) {
  const sock = useSocket({ role: 'controller' });
  const conn = useConnState(sock);
  const [st, setSt] = useState<ControllerState | null>(null);
  const [draft, setDraft] = useState<Scene | null>(null);
  const [showDraft, setShowDraft] = useState<Show | null>(null);
  const [section, setSection] = useState<Section>(() => {
    try { return (localStorage.getItem('overdrive.section') as Section) || 'live'; } catch { return 'live'; }
  });
  const lastEdit = useRef(0);
  const lastShowEdit = useRef(0);
  const sendTimer = useRef<number | undefined>(undefined);
  const showTimer = useRef<number | undefined>(undefined);
  const viewer = useViewer(sock, 'lq');
  const tournament = useTournament(sock);
  const bnl = useMatchData(sock);
  const [skew, setSkew] = useState(0);
  const now = useNow(skew, 250);

  useEffect(() => { try { localStorage.setItem('overdrive.section', section); } catch {} }, [section]);

  useEffect(() => sock.on(m => {
    if (m.t === 'state') {
      setSt(m.state);
      // Adopt server preview unless the producer is mid-edit (avoids input jitter).
      if (Date.now() - lastEdit.current > 600) setDraft(m.state.preview);
      if (Date.now() - lastShowEdit.current > 600) setShowDraft(m.state.showPreview);
    } else if (m.t === 'live') {
      setSkew(m.now - Date.now());
      setSt(s => (s ? { ...s, live: m.scene, showLive: m.show, liveVersion: m.version } : s));
    } else if (m.t === 'error' && m.code === 'auth') {
      onLogout();
    }
  }), [sock, onLogout]);

  const preview = draft ?? st?.preview ?? null;
  useWantedCameras(viewer, [preview, st?.live]);

  const pushPreview = useCallback((scene: Scene, immediate: boolean) => {
    lastEdit.current = Date.now();
    setDraft(scene);
    clearTimeout(sendTimer.current);
    if (immediate) sock.send({ t: 'set-preview', scene });
    else sendTimer.current = window.setTimeout(() => sock.send({ t: 'set-preview', scene }), 120);
  }, [sock]);

  const pushShow = useCallback((show: Show) => {
    lastShowEdit.current = Date.now();
    setShowDraft(show);
    clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => { showTimer.current = undefined; sock.send({ t: 'set-show', show }); }, 150);
  }, [sock]);

  const flushPending = () => {
    if (sendTimer.current && draft) { clearTimeout(sendTimer.current); sendTimer.current = undefined; sock.send({ t: 'set-preview', scene: draft }); }
    if (showTimer.current && showDraft) { clearTimeout(showTimer.current); showTimer.current = undefined; sock.send({ t: 'set-show', show: showDraft }); }
  };
  const quick = (op: QuickOp) => sock.send({ t: 'quick', op });
  const take = useCallback(() => { flushPending(); sock.send({ t: 'take' }); }, [draft, showDraft, sock]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd + Enter = TAKE LIVE
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); take(); } };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [take]);

  const showPreview = showDraft ?? st?.showPreview ?? null;
  const liveComp = useMemo(() => (st ? compose(st.live) : null), [st]);
  if (!st || !preview || !showPreview || !liveComp) {
    return <div className="grid min-h-screen place-items-center bg-[#111] text-sm text-white/50">{conn === 'open' ? 'Loading…' : 'Connecting to server…'}</div>;
  }

  const setScene = (p: Partial<Scene>) => pushPreview({ ...preview, ...p }, true);
  const setCaster = (id: CasterId, p: Partial<Caster>, immediate = false) => {
    const casters = preview.casters.map(c => (c.id === id ? { ...c, ...p } : c)) as Scene['casters'];
    pushPreview({ ...preview, casters }, immediate);
  };
  const dirty = !sameScene(preview, st.live) || JSON.stringify(showPreview) !== JSON.stringify(st.showLive);
  const origin = location.origin;
  const keyQ = st.outputKey ? `?key=${encodeURIComponent(st.outputKey)}` : '';
  const outputCount = st.outputs.filter(o => !o.route.startsWith('audio')).reduce((a, o) => a + o.count, 0);
  const showProps: ShowProps = { show: showPreview, live: st.showLive, st, tournament, now, set: p => pushShow({ ...showPreview, ...p }), quick, send: m => sock.send(m) };

  return (
    <div className="flex h-screen flex-col bg-[#101010] text-white">
      {/* Top bar */}
      <header className="flex h-16 flex-none items-center gap-5 border-b border-white/[0.07] px-5">
        <ThemeProvider theme={st.showLive.theme} brand={st.showLive.brand}><div data-theme={st.showLive.theme}><Logo height={st.showLive.theme === 'bnl' ? 40 : 34} /></div></ThemeProvider>
        <div className="h-7 w-px bg-white/10" />
        <button type="button" onClick={() => setSection('events')} title="Switch event" className="max-w-[260px] truncate rounded border border-white/15 px-2.5 py-1 text-[12px] font-semibold text-white/85 hover:border-white/40">
          {st.events.find(e => e.id === st.activeEvent)?.name ?? 'Event'} ▾
        </button>
        <div className="flex items-center gap-4 text-[12px] text-white/60">
          <span className="flex items-center gap-1.5"><Dot tone={conn === 'open' ? 'ok' : 'bad'} />{conn === 'open' ? 'Connected' : 'Reconnecting'}</span>
          <span className="flex items-center gap-1.5" title="OBS browser sources connected"><Dot tone={outputCount ? 'ok' : 'warn'} />{outputCount} in OBS</span>
          {st.obs.enabled && <span className="flex items-center gap-1.5" title={st.obs.error}><Dot tone={st.obs.connected ? (st.obs.error ? 'warn' : 'ok') : 'bad'} />OBS</span>}
        </div>
        <div className="ml-auto flex items-center gap-5">
          {dirty && !st.instant && (
            <button type="button" className="text-[12px] text-white/45 hover:text-white/80" onClick={() => { pushPreview(st.live, true); pushShow(st.showLive); }}>Discard changes</button>
          )}
          <Switch on={st.instant} onChange={v => sock.send({ t: 'set-instant', on: v })} label="Instant" title="Every change goes straight to air" />
          <button
            type="button"
            onClick={take}
            disabled={!dirty || st.instant}
            title="Ctrl/Cmd + Enter"
            className={`h-10 rounded-md px-7 font-display text-[14px] font-bold tracking-[0.2em] transition-all duration-150 ${
              st.instant ? 'cursor-default bg-[#e5484d]/25 text-white/60'
                : dirty ? 'bg-[#e5484d] text-white shadow-[0_0_0_3px_rgba(229,72,77,0.25)] hover:bg-[#f05257] active:scale-[0.98]'
                : 'bg-white/[0.07] text-white/35'}`}
          >
            {st.instant ? 'LIVE · INSTANT' : 'TAKE LIVE'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Section menu */}
        <nav className="flex w-[188px] flex-none flex-col border-r border-white/[0.07] p-3">
          {SECTIONS.map(s => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)}
              className={`mb-1 rounded-md px-3 py-2.5 text-left transition-colors ${section === s.id ? 'bg-white text-[#111]' : 'text-white/75 hover:bg-white/[0.06]'}`}>
              <div className="text-[13.5px] font-semibold">{s.label}</div>
              <div className={`text-[11px] ${section === s.id ? 'text-black/55' : 'text-white/35'}`}>{s.hint}</div>
            </button>
          ))}
          <div className="mt-auto space-y-2 px-1 text-[11px] text-white/35">
            <a href="/admin" target="_blank" rel="noreferrer" className="block hover:text-white/70">Tournament admin ↗</a>
            <button type="button" className="hover:text-white/70" onClick={async () => { await fetch('/api/logout', { method: 'POST' }); onLogout(); }}>Sign out</button>
          </div>
        </nav>

        {/* Section content */}
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {/* Always visible: big monitors + screen switcher */}
          <div className="mb-5 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Monitor title="Preview" tone={dirty && !st.instant ? 'pending' : 'idle'} note={st.instant ? 'Instant mode' : dirty ? 'Not on air yet · TAKE LIVE to send' : 'Same as program'}>
                <Program scene={preview} show={showPreview} now={now} tournament={tournament} viewer={viewer} monitor bnl={bnl} />
              </Monitor>
              <Monitor title="Program" tone="live" note={`On air · ${SCREEN_LABELS[st.live.screen]}`}>
                <Program scene={st.live} show={st.showLive} now={now} tournament={tournament} viewer={viewer} monitor bnl={bnl} />
              </Monitor>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {SCREEN_IDS.map(id => {
                const isPgm = st.live.screen === id, isPvw = preview.screen === id && !isPgm;
                return (
                  <div key={id} className={`flex overflow-hidden rounded-md border transition-colors ${isPgm ? 'border-[#e5484d] bg-[#e5484d]/15' : isPvw ? 'border-amber-400/80 bg-amber-400/10' : 'border-white/10 bg-[#171717]'}`}>
                    <button type="button" className="min-w-0 flex-1 px-2 py-2.5 text-left" onClick={() => pushPreview({ ...preview, screen: id }, true)} title="Prepare in preview">
                      <div className="truncate text-[13px] font-semibold">{SCREEN_LABELS[id]}</div>
                      <div className="mt-0.5 text-[9.5px] font-bold tracking-[0.18em] text-white/45">{isPgm ? 'ON AIR' : isPvw ? 'READY' : '\u00a0'}</div>
                    </button>
                    <button type="button" className="border-l border-white/10 px-1.5 text-[10px] font-bold tracking-[0.12em] text-white/55 hover:bg-[#e5484d] hover:text-white" title="Cut straight to air"
                      onClick={() => { flushPending(); sock.send({ t: 'screen', screen: id, take: true }); }}>GO</button>
                  </div>
                );
              })}
            </div>
            <RosBar ros={st.ros} now={now} send={m => sock.send(m)} onOpen={() => setSection('ros')} />
          </div>
          <div className="space-y-5">
            {section === 'live' && (
              <>
                <Block title="Casters on screen">
                  <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <Segmented value={preview.layout === 'mixed' ? 'auto' : preview.layout} onChange={v => setScene({ layout: v })} options={LAYOUTS} />
                    <Switch on={preview.showNames} onChange={v => setScene({ showNames: v })} label="Names" />
                    <Switch on={preview.showBranding} onChange={v => setScene({ showBranding: v })} label="Logo" />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {preview.casters.map(c => {
                      const onAir = liveComp.tiles.some(t => t.casterId === c.id);
                      const cam = st.contributors[c.id];
                      return (
                        <div key={c.id} className={`rounded-md border px-3.5 py-3 ${c.enabled ? 'border-white/10 bg-black/20' : 'border-white/[0.05] opacity-55'}`}>
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-semibold">{c.name || `Caster ${c.id}`}</div>
                              <div className="flex items-center gap-1.5 text-[11px] text-white/40">
                                {c.source.type === 'webrtc' && <Dot tone={cam.publishing ? 'ok' : 'off'} />}
                                {c.role || '—'}
                              </div>
                            </div>
                            {onAir && <span className="rounded-[3px] bg-[#e5484d] px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.16em]">ON AIR</span>}
                          </div>
                          <div className="space-y-2">
                            <Switch on={c.enabled} onChange={v => setCaster(c.id, { enabled: v }, true)} label="On screen" />
                            <Switch on={c.cameraOn} disabled={!c.enabled} onChange={v => setCaster(c.id, { cameraOn: v }, true)} label="Camera" />
                            <Switch on={c.showName} disabled={!c.enabled} onChange={v => setCaster(c.id, { showName: v }, true)} label="Nameplate" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="mt-3 text-[12px] text-white/45 hover:text-white/80" onClick={() => setSection('casters')}>Edit names & cameras →</button>
                </Block>

                <div className="grid grid-cols-2 gap-5">
                  <Block title="Score" note="Instant">
                    <div className="flex items-center justify-between gap-3">
                      {(['A', 'B'] as const).map(side => {
                        const team = side === 'A' ? st.showLive.teamA : st.showLive.teamB;
                        return (
                          <div key={side} className="flex flex-1 flex-col items-center gap-2 rounded-md bg-black/20 py-3">
                            <div className="max-w-full truncate px-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60">{team.tag || team.name}</div>
                            <div className="flex items-center gap-2">
                              <button type="button" className="btn-sm w-9" onClick={() => quick({ k: 'score', team: side, delta: -1 })}>−</button>
                              <span className="w-10 text-center font-display text-[30px] font-bold">{team.score}</span>
                              <button type="button" className="btn-sm w-9" onClick={() => quick({ k: 'score', team: side, delta: 1 })}>+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Block>
                  <Block title="Countdown" note="Instant">
                    <div className="mb-3 font-display text-[32px] font-semibold tabular-nums">
                      {st.showLive.timer.target == null ? <span className="text-white/30">--:--</span> : formatRemaining(st.showLive.timer.target - now)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[5, 10, 15].map(n => <button key={n} type="button" className="btn-sm" onClick={() => quick({ k: 'timer-start', minutes: n })}>{n} min</button>)}
                      <button type="button" className="btn-sm" disabled={st.showLive.timer.target == null} onClick={() => quick({ k: 'timer-add', minutes: 1 })}>+1</button>
                      <button type="button" className="btn-sm" disabled={st.showLive.timer.target == null} onClick={() => quick({ k: 'timer-stop' })}>Stop</button>
                    </div>
                  </Block>
                </div>

                <Block title="Presets" note="Click to prepare · TAKE to put on air">
                  <div className="grid grid-cols-3 gap-2">
                    {st.presets.map(p => (
                      <div key={p.id} className="flex overflow-hidden rounded-md border border-white/10 bg-black/20">
                        <button type="button" className="min-w-0 flex-1 truncate px-3.5 py-2.5 text-left text-[13px] font-medium" onClick={() => sock.send({ t: 'preset-recall', id: p.id })}>{p.name}</button>
                        <button type="button" className="border-l border-white/10 px-3 text-[10.5px] font-bold tracking-[0.14em] text-[#ff8a8d] hover:bg-[#e5484d] hover:text-white"
                          onClick={() => sock.send({ t: 'preset-recall', id: p.id, take: true })}>TAKE</button>
                      </div>
                    ))}
                  </div>
                  <PresetSave onSave={(name, identity) => { flushPending(); sock.send({ t: 'preset-save', name, identity }); }} />
                </Block>
              </>
            )}

            {section === 'ros' && <RosEditor ros={st.ros} now={now} crewUrl={`${(['localhost', '127.0.0.1'].includes(location.hostname) && st.lanUrls[0]) || origin}/crew?key=${encodeURIComponent(st.crewKey)}`} otherUrls={st.lanUrls.slice(1)} send={m => sock.send(m)} />}

            {section === 'players' && <PlayersPanel st={st} now={now} send={m => sock.send(m)} quick={quick} show={showPreview} setShow={p => pushShow({ ...showPreview, ...p })} />}

            {section === 'casters' && (
              <>
                <div className="grid grid-cols-3 gap-4">
                  {preview.casters.map(c => (
                    <CasterCard
                      key={c.id}
                      caster={c}
                      onChange={(p, immediate) => setCaster(c.id, p, immediate)}
                      status={st.contributors[c.id]}
                      contributeUrl={`${origin}/contribute/${c.id}?key=${encodeURIComponent(st.contributorKeys[c.id])}`}
                      audioUrl={`${origin}/output/audio/${c.id}${keyQ}`}
                      onRegenKey={() => sock.send({ t: 'regen-key', slot: c.id })}
                      onAir={liveComp.tiles.some(t => t.casterId === c.id)}
                      obsScenes={st.obs.scenes}
                      vdoPassword={showPreview.vdo.password}
                    />
                  ))}
                </div>
                <VdoCasterLinks casters={preview.casters} password={showPreview.vdo.password}
                  onPrepare={() => pushPreview({ ...preview, casters: preview.casters.map(c => ({ ...c, source: { ...c.source, type: 'vdo', vdo: c.source.vdo || newCasterStreamId(c.id) } })) as Scene['casters'] }, true)} />
                <p className="text-[12px] leading-relaxed text-white/40">
                  Remote casters: send each one their camera link. They open it, pick a camera and press Start. Changes here go to preview; press TAKE LIVE.
                </p>
              </>
            )}

            {section === 'match' && (
              <>
                <Block title="Next match counter" note="On top of every scene · instant"><NextMatchPanel live={st.showLive} quick={quick} bnl={bnl} now={now} /></Block>
                <Block title="Team match" note="Score, best-of, teams"><MatchTab {...showProps} /></Block>
                <Block title="Gameplay screen" note="Transparent: put the game capture under it in OBS">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <Switch on={showPreview.showScoreboard} onChange={v => showProps.set({ showScoreboard: v })} label="Scoreboard" />
                    <Switch on={showPreview.gameplay.cams} onChange={v => showProps.set({ gameplay: { ...showPreview.gameplay, cams: v } })} label="Caster cams" />
                    {showPreview.gameplay.cams && (
                      <Segmented size="sm" value={showPreview.gameplay.corner} onChange={v => showProps.set({ gameplay: { ...showPreview.gameplay, corner: v } })}
                        options={[{ value: 'left', label: 'Bottom left' }, { value: 'right', label: 'Bottom right' }]} />
                    )}
                    <Switch on={showPreview.gameplay.ticker} onChange={v => showProps.set({ gameplay: { ...showPreview.gameplay, ticker: v } })} label="Ticker" />
                  </div>
                  {st.showLive.brand.skin && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-[12px] text-white/55">Overlay package (instant, with transition):</span>
                      {(['none', 'replay', 'highlights'] as const).map(k => (
                        <button key={k} type="button" className={`btn-sm ${st.showLive.badge.kind === k ? '!border-[#e5484d] !bg-[#e5484d]/25' : ''}`} onClick={() => sock.send({ t: 'badge', kind: k })}>{k === 'none' ? 'Off' : k === 'replay' ? 'Replay' : 'Highlights'}</button>
                      ))}
                    </div>
                  )}
                </Block>
                <Block title="Countdown"><TimerTab {...showProps} /></Block>
              </>
            )}

            {section === 'events' && (
              <>
                <Block title="Events" note="One click switches everything on air"><EventsPanel st={st} send={m => sock.send(m)} /></Block>
                <Block title={`Brand kit · ${st.events.find(e => e.id === st.activeEvent)?.name ?? ''}`} note="Goes to preview · TAKE LIVE"><BrandPanel show={showPreview} set={p => pushShow({ ...showPreview, ...p })} /></Block>
              </>
            )}

            {section === 'music' && (
              <Block title="Music" note="Instant · follows the screen on air">
                <MusicPanel live={st.showLive} screen={st.live.screen} quick={quick} musicUrl={`${origin}/output/music${keyQ}`} playing={st.outputs.find(o => o.route === 'music')?.count ?? 0} />
              </Block>
            )}

            {section === 'screens' && (
              <>
                <Block title="Screen texts & schedule"><ScreensTab {...showProps} /></Block>
                <Block title="Ticker & socials"><TickerTab {...showProps} /></Block>
                <Block title="Prizepool"><PrizeTab {...showProps} /></Block>
                <Block title="Sponsors"><SponsorsTab {...showProps} /></Block>
              </>
            )}

            {section === 'tournament' && (
              <>
                <Block title="Google Sheet" note="Read-only source for this event"><SheetPanel sheet={bnl?.sheet} send={m => sock.send(m)} /></Block>
                <Block title="Tournament"><TournamentTab {...showProps} /></Block>
              </>
            )}

            {section === 'settings' && (
              <>
                <Block title="Branding theme" note="Goes to preview · TAKE LIVE to switch">
                  <Segmented value={showPreview.theme} onChange={v => showProps.set({ theme: v })} options={THEMES.map(t => ({ value: t.id, label: t.label }))} />
                </Block>
                <Block title="OBS browser sources" note="1920 × 1080">
                  <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    {OUTPUT_ROUTES.map(({ route, label }) => {
                      const n = st.outputs.find(o => o.route === route)?.count ?? 0;
                      return <CopyField key={route} value={`${origin}/output/${route}${keyQ}`} label={<>{label} {n > 0 && <span className="ml-1 text-emerald-400/80">● {n}</span>}</>} />;
                    })}
                  </div>
                </Block>
                <Block title="Advanced layout">
                  <div className="flex flex-wrap items-center gap-6">
                    <Switch on={preview.layout === 'mixed'} onChange={v => setScene({ layout: v ? 'mixed' : 'auto' })} label="Mixed mode (cards for cameras that are off)" />
                    <Switch on={preview.showBackground} onChange={v => setScene({ showBackground: v })} label="Background behind cameras" />
                  </div>
                </Block>
                <Block title="OBS WebSocket" note="Connect + one-click scene import"><ObsPanel st={st} send={m => sock.send(m)} /></Block>
                <Block title="Stream Deck / Companion & scene mapping"><IntegrationsTab {...showProps} /></Block>
                <Block title="Presets">
                  <div className="space-y-1.5">
                    {st.presets.map(p => (
                      <div key={p.id} className="flex items-center gap-2 rounded-md border border-white/[0.06] px-3 py-1.5">
                        <span className="flex-1 truncate text-[13px]">{p.name} <span className="ml-1 text-[10px] uppercase tracking-[0.16em] text-white/35">{p.scene.layout}{p.identity ? ' · names' : ''}</span></span>
                        <ConfirmButton className="btn-xs" confirmLabel="Overwrite?" onConfirm={() => { flushPending(); sock.send({ t: 'preset-save', id: p.id, name: p.name }); }}>Save current</ConfirmButton>
                        <ConfirmButton className="btn-xs" confirmLabel="Delete?" onConfirm={() => sock.send({ t: 'preset-delete', id: p.id })}>Delete</ConfirmButton>
                      </div>
                    ))}
                  </div>
                </Block>
                <Block title="Reset">
                  <div className="flex flex-wrap gap-2">
                    <ConfirmButton onConfirm={async () => { await fetch('/api/restart', { method: 'POST' }); }} confirmLabel="Restart server? (outputs reconnect)">Restart server</ConfirmButton>
                    <ConfirmButton onConfirm={() => sock.send({ t: 'reset-preview' })} confirmLabel="Reset casters & layout?">Reset casters & layout</ConfirmButton>
                    <ConfirmButton onConfirm={() => sock.send({ t: 'reset-show' })} confirmLabel="Reset match & screen texts?">Reset match & screen texts</ConfirmButton>
                  </div>
                  <p className="mt-2 text-[11px] text-white/40">Resets only affect the preview until you press TAKE LIVE. Camera sources, sponsors and OBS mapping are kept.</p>
                </Block>
              </>
            )}
          </div>
        </main>

      </div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
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

function Monitor({ title, tone, note, children }: { title: string; tone: 'live' | 'pending' | 'idle'; note: string; children: ReactNode }) {
  const badge = tone === 'live' ? 'bg-[#e5484d] text-white' : tone === 'pending' ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70';
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`rounded-[3px] px-2 py-[3px] text-[10px] font-bold tracking-[0.2em] ${badge}`}>{title.toUpperCase()}</span>
        <span className="text-[11px] text-white/40">{note}</span>
      </div>
      <div className={`monitor-bg aspect-video w-full overflow-hidden rounded-md border ${tone === 'live' ? 'border-[#e5484d]/60' : tone === 'pending' ? 'border-amber-400/50' : 'border-white/10'}`}>
        <ScaledCanvas>{children}</ScaledCanvas>
      </div>
    </div>
  );
}

function PresetSave({ onSave }: { onSave: (name: string, identity: boolean) => void }) {
  const [name, setName] = useState('');
  return (
    <form className="mt-3 flex gap-1.5" onSubmit={e => { e.preventDefault(); onSave(name, false); setName(''); }}>
      <input className="input min-w-0 flex-1" value={name} onChange={e => setName(e.target.value)} placeholder="Save what's in preview as a new preset…" />
      <button type="submit" className="btn-sm" disabled={!name.trim()}>Save</button>
    </form>
  );
}

/** All caster VDO.Ninja links at once, ready to paste in Discord. */
function VdoCasterLinks({ casters, password, onPrepare }: { casters: Caster[]; password: string; onPrepare: () => void }) {
  const vdo = casters.filter(c => c.enabled && c.source.type === 'vdo' && c.source.vdo);
  const text = vdo.map(c => `${c.name || `Caster ${c.id}`}: ${vdoCasterPushUrl(c.source.vdo, c.name, password)}`).join('\n');
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-white/10 bg-[#171717] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-semibold">VDO.Ninja caster links</span>
        <button type="button" className="btn-sm" onClick={onPrepare}>Prepare VDO.Ninja links for all casters</button>
        {vdo.length > 0 && (
          <button type="button" className="btn-sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied ✓' : 'Copy all links (for Discord)'}</button>
        )}
        <span className="text-[11px] text-white/40">Goes to preview: press TAKE LIVE so OBS loads the feeds.</span>
      </div>
      {vdo.length > 0 && <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-white/70">{text}</pre>}
    </div>
  );
}

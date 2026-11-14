import { feedPerf } from '../../lib/perfStore';
import { sourceSizeLabel } from '../../../shared/layout';
import type { TransitionKind } from '../../../shared/engine';
import { GameFeedSettingsCard } from './GameFeedSettings';
import { boothScene } from '../../components/wildcard/Desk';
import { BoothPicker, DeskPicker, InterviewControls } from './Talent';
import type { WcOp } from '../../../shared/wildcard';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Logo } from '../../components/Brand';
import { ScaledCanvas } from '../../components/Stage';
import { Program } from '../../components/show/Program';
import { formatRemaining } from '../../components/show/parts';
import { useMatchData, useConnState, useNow, useSocket, useTournament, useViewer, useWantedCameras, useWildcard } from '../../lib/hooks';
import { WildcardPanel } from './WildcardPanel';
import { TwitchPanel } from './TwitchPanel';
import { PLAIN_SCREENS, SceneDock } from './SceneDock';
import { compose } from '../../../shared/layout';
import { sameScene, SCREEN_LABELS } from '../../../shared/defaults';
import { SCREEN_IDS, THEMES } from '../../../shared/types';
import type { ClientMsg, QuickOp } from '../../../shared/protocol';
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
  { route: 'warmup', label: 'Player / team card (lobby cams)' },
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
  { route: 'major', label: 'Major bracket' },
  { route: 'major/gameplay', label: 'Major gameplay popups' },
  { route: 'major/waiting', label: 'Major waiting screen' },
  { route: 'major/casters', label: 'Major casters card (up next)' },
  { route: 'twitch', label: 'Twitch prediction / poll card' },
  { route: 'solo', label: 'Solo layout' },
  { route: 'duo', label: 'Duo layout' },
  { route: 'trio', label: 'Trio layout' },
];

type Section = 'links' | 'events' | 'live' | 'ros' | 'casters' | 'analysts' | 'interview' | 'players' | 'match' | 'wildcard' | 'twitch' | 'music' | 'screens' | 'tournament' | 'settings';
/** Sidebar: what you use during the show first, then people, then setup you do once. */
const NAV: { group: string; items: { id: Section; label: string; hint: string }[] }[] = [
  { group: 'Show', items: [
    { id: 'live', label: 'Live', hint: 'Layout, presets, quick toggles' },
    { id: 'wildcard', label: 'Major', hint: 'Bracket, first round, intro, maps, popups' },
    { id: 'interview', label: 'Interview', hint: 'Online player interview' },
    { id: 'twitch', label: 'Twitch', hint: 'Viewer predictions & polls' },
  ] },
  { group: 'People', items: [
    { id: 'casters', label: 'Casters', hint: '3 casters · who is on camera' },
    { id: 'analysts', label: 'Analysts', hint: '2 analysts · the desk' },
  ] },
  { group: 'Setup', items: [
    { id: 'links', label: 'Links', hint: 'One link per scene, for OBS or a browser' },
    { id: 'screens', label: 'Screens', hint: 'Texts, ticker, sponsors' },
    { id: 'match', label: 'Scoreboard', hint: 'Scoreboard, next-match counter, gameplay cams' },
    { id: 'music', label: 'Music', hint: 'Beds per screen, volume' },
    { id: 'players', label: 'Players', hint: 'Player cams, spotlight, facts' },
    { id: 'ros', label: 'Run of show', hint: 'Rundown, caster messages' },
    { id: 'events', label: 'Events', hint: 'Switch production, brand kit' },
    { id: 'tournament', label: 'Tournament', hint: 'Bracket link' },
    { id: 'settings', label: 'Settings', hint: 'OBS, API, reset' },
  ] },
];
const SECTIONS = NAV.flatMap(g => g.items);

export function Controller({ onLogout, dockOnly = false, dockAll = false }: { onLogout: () => void; dockOnly?: boolean; dockAll?: boolean }) {
  const sock = useSocket({ role: 'controller' });
  useEffect(() => feedPerf(sock), [sock]);
  const conn = useConnState(sock);
  const [st, setSt] = useState<ControllerState | null>(null);
  const [draft, setDraft] = useState<Scene | null>(null);
  const [showDraft, setShowDraft] = useState<Show | null>(null);
  const [stripUrls, setStripUrls] = useState(false);
  const [section, setSection] = useState<Section>(() => {
    try { const v = localStorage.getItem('overdrive.section') as Section; return SECTIONS.some(x => x.id === v) ? v : 'live'; } catch { return 'live'; }
  });
  const lastEdit = useRef(0);
  const lastShowEdit = useRef(0);
  const sendTimer = useRef<number | undefined>(undefined);
  const showTimer = useRef<number | undefined>(undefined);
  const viewer = useViewer(sock, 'lq');
  const tournament = useTournament(sock);
  const bnl = useMatchData(sock);
  const wc = useWildcard(sock);
  const [skew, setSkew] = useState(0);
  const [liveTr, setLiveTr] = useState<TransitionKind | undefined>(undefined);
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
      setLiveTr(m.transition);
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
  const liveComp = useMemo(() => (st ? compose(boothScene(st.live, wc?.state.booth ?? [])) : null), [st, wc?.state.booth]);
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

  // OBS "everything" dock (/controller/dock/all): shared match controls once, then every scene with its own GO + controls.
  if (dockAll) {
    const dockProps = { live: st.live.screen, preview: preview.screen, show: st.showLive, wc, now, send: (m: ClientMsg) => { flushPending(); sock.send(m); }, quick, twConnected: !!st.twitch?.connected, casters: st.live.casters };
    return (
      <div className="min-h-screen space-y-2 bg-[#101010] p-2 text-white">
        <div className="sticky top-0 z-10 -mx-2 -mt-2 space-y-2 bg-[#101010] px-2 pb-2 pt-2 shadow-[0_8px_16px_rgba(0,0,0,.5)]">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-white/45">
            <span className={`h-2 w-2 rounded-full ${conn === 'open' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            ON AIR · <span className="text-white">{SCREEN_LABELS[st.live.screen]}</span>
          </div>
          <SceneDock {...dockProps} part="shared" />
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-md border border-white/10 bg-[#171717] px-3 py-2">
          {PLAIN_SCREENS.map(id => (
            <button key={id} type="button" onClick={() => dockProps.send({ t: 'screen', screen: id, take: true })}
              className={`btn-sm ${id === st.live.screen ? '!border-[#e5484d] !bg-[#e5484d]/30 !text-white' : ''}`}>{SCREEN_LABELS[id]}{id === st.live.screen ? ' · ON AIR' : ' · GO'}</button>
          ))}
        </div>
        {SCREEN_IDS.filter(id => !PLAIN_SCREENS.includes(id)).map(id => <SceneDock key={id} {...dockProps} forScreen={id} part="scene" />)}
        <RosBar ros={st.ros} now={now} send={m => sock.send(m)} onOpen={() => window.open('/controller', '_blank')} />
      </div>
    );
  }

  // OBS custom browser dock (/controller/dock): screen buttons + the on-air dock + run of show, nothing else.
  if (dockOnly) return (
    <div className="min-h-screen space-y-2 bg-[#101010] p-2 text-white">
      <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-white/45">
        <span className={`h-2 w-2 rounded-full ${conn === 'open' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        ON AIR · <span className="text-white">{SCREEN_LABELS[st.live.screen]}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1">
        {SCREEN_IDS.map(id => {
          const isPgm = st.live.screen === id;
          return (
            <button key={id} type="button" title="Cut straight to air"
              className={`truncate rounded-md border px-2 py-2 text-left text-[12px] font-semibold ${isPgm ? 'border-[#e5484d] bg-[#e5484d]/20' : 'border-white/10 bg-[#171717] hover:border-white/30'}`}
              onClick={() => { flushPending(); sock.send({ t: 'screen', screen: id, take: true }); }}>{SCREEN_LABELS[id]}</button>
          );
        })}
      </div>
      <SceneDock live={st.live.screen} preview={preview.screen} show={st.showLive} wc={wc} now={now} send={m => { flushPending(); sock.send(m); }} quick={quick}
        twConnected={!!st.twitch?.connected} onMore={() => window.open('/controller', '_blank')} casters={st.live.casters} />
      <RosBar ros={st.ros} now={now} send={m => sock.send(m)} onOpen={() => window.open('/controller', '_blank')} />
    </div>
  );

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
          {NAV.map(g => (
            <div key={g.group} className="mb-4">
              <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">{g.group}</div>
              {g.items.map(s => (
                <button key={s.id} type="button" title={s.hint} onClick={() => setSection(s.id)}
                  className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left text-[14px] font-semibold transition-colors ${section === s.id ? 'bg-white text-[#111]' : 'text-white/75 hover:bg-white/[0.06]'}`}>
                  {s.label}
                </button>
              ))}
            </div>
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
            {/* Monitors capped to ~38% of the window height, so the screen buttons and controls stay in view. */}
            <div className="grid grid-cols-2 gap-4" style={{ maxWidth: "calc(38vh * 32 / 9 + 16px)" }}>
              <Monitor title="Preview" tone={dirty && !st.instant ? 'pending' : 'idle'} note={st.instant ? 'Instant mode' : dirty ? 'Not on air yet · TAKE LIVE to send' : 'Same as program'}>
                <Program instant scene={preview} show={showPreview} now={now} tournament={tournament} viewer={viewer} monitor bnl={bnl} wc={wc} />
              </Monitor>
              <Monitor title="Program" tone="live" note={`On air · ${SCREEN_LABELS[st.live.screen]}`}>
                <Program scene={st.live} show={st.showLive} now={now} tournament={tournament} viewer={viewer} monitor monitorFeeds bnl={bnl} wc={wc} transition={liveTr} />
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
            {/* Controls for the screen on air, always in sight (no scrolling during the show). */}
            <SceneDock live={st.live.screen} preview={preview.screen} show={st.showLive} wc={wc} now={now} send={m => { flushPending(); sock.send(m); }} quick={quick}
              twConnected={!!st.twitch?.connected} onMore={setSection} casters={st.live.casters} />
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
                  {([['Casters', false], ['Analysts', true]] as const).map(([grp, an]) => (
                  <div key={grp} className="mb-2.5">
                    <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{grp}</div>
                    <div className={`grid gap-2 ${an ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {preview.casters.filter(c => (an ? c.id === 4 || c.id === 5 : c.id <= 3)).map(c => {
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
                  </div>
                  ))}
                  <button type="button" className="mt-3 text-[12px] text-white/45 hover:text-white/80" onClick={() => setSection('casters')}>Edit casters →</button><button type="button" className="ml-4 mt-3 text-[12px] text-white/45 hover:text-white/80" onClick={() => setSection('analysts')}>Edit analysts →</button>
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

            {(section === 'casters' || section === 'analysts' || section === 'interview') && (() => {
              const analysts = section === 'analysts', interview = section === 'interview';
              const list = preview.casters.filter(c => (interview ? c.id === 6 : analysts ? c.id === 4 || c.id === 5 : c.id <= 3));
              const wcOp = (op: WcOp) => sock.send({ t: 'wc', op });
              return (
              <>
                {wc && (
                  <Block title={interview ? 'Interview' : analysts ? 'At the desk' : 'On the Casters screen'} note={interview ? 'Instant · the Interview screen' : analysts ? 'Instant · the Pre-show / Analyst desk screen' : 'Instant · Casters screen and gameplay cams (max 3)'}>
                    {interview ? <InterviewControls s={wc.state} casters={preview.casters} op={wcOp} /> : analysts ? <DeskPicker s={wc.state} casters={preview.casters} op={wcOp} /> : <BoothPicker s={wc.state} casters={preview.casters} op={wcOp} />}
                  </Block>
                )}
                <div className={`grid gap-4 ${interview ? 'grid-cols-2' : analysts ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {list.map(c => (
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
                      liveVdo={{ id: st.live.casters[c.id - 1].source.vdo, password: st.showLive.vdo.password }}
                    />
                  ))}
                </div>
                <Block title="Talent room (VDO.Ninja)" note="Goes to preview · TAKE LIVE">
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="input h-9 w-[260px] text-[13px]" placeholder="no room" value={showPreview.vdo.room}
                      onChange={e => showProps.set({ vdo: { ...showPreview.vdo, room: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30) } })} />
                    <button type="button" className="btn-xs" onClick={() => showProps.set({ vdo: { ...showPreview.vdo, room: `od_talent_${Math.random().toString(36).slice(2, 8)}` } })}>New room name</button>
                    {showPreview.vdo.room && <button type="button" className="btn-xs" onClick={() => showProps.set({ vdo: { ...showPreview.vdo, room: '' } })}>No room</button>}
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-white/45">
                    With a room, everyone whose camera source is VDO.Ninja (casters, analysts, the interview guest) joins it from their own caster page: they see and hear each other in the VDO.Ninja box, with the ON AIR tally, game feed and run of show around it. Their cameras still reach OBS through their own view links. Uses the VDO password above ({showPreview.vdo.password ? 'set' : 'none set'}). Casters should wear headphones.
                  </p>
                </Block>
                <VdoCasterLinks casters={list} password={showPreview.vdo.password}
                  onPrepare={() => pushPreview({ ...preview, casters: preview.casters.map(c => ({ ...c, source: { ...c.source, type: 'vdo', vdo: c.source.vdo || newCasterStreamId(c.id) } })) as Scene['casters'] }, true)} />
                <p className="text-[12px] leading-relaxed text-white/40">
                  {interview ? 'The guest camera (slot 6) is for the player being interviewed: send them this link before the interview; they need nothing else. Pick the player above to show their name, team and country.' : analysts ? 'Analysts are slots 4 and 5: they appear on the Pre-show / Analyst desk screen only.' : 'Casters are slots 1 to 3: they appear on the Casters screen and the gameplay cams, and one can join the desk from the Analysts tab.'} Send each one their camera link: they open it, pick a camera and press Start. Name and camera changes go to preview; press TAKE LIVE.
                </p>
              </>
              );
            })()}

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
                <Block title="Other matches popout" note="Gameplay screen · shows another live sheet match's score, on a timer">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <Switch on={showPreview.otherMatches.enabled} onChange={v => showProps.set({ otherMatches: { ...showPreview.otherMatches, enabled: v } })} label="Enabled" />
                    <div className="flex items-center gap-2 text-[12px] text-white/60">
                      Every
                      <input className="input h-8 w-16" type="number" min={30} max={3600} value={showPreview.otherMatches.intervalSec}
                        onChange={e => showProps.set({ otherMatches: { ...showPreview.otherMatches, intervalSec: Math.max(30, Math.min(3600, +e.target.value || 300)) } })} />
                      sec, show for
                      <input className="input h-8 w-16" type="number" min={5} max={60} value={showPreview.otherMatches.durationSec}
                        onChange={e => showProps.set({ otherMatches: { ...showPreview.otherMatches, durationSec: Math.max(5, Math.min(60, +e.target.value || 12)) } })} />
                      sec
                    </div>
                  </div>
                </Block>
                <Block title="Countdown"><TimerTab {...showProps} /></Block>
              </>
            )}

            {section === 'wildcard' && (
              <WildcardPanel wc={wc} send={m => sock.send(m)} quick={quick} live={st.showLive} now={now} sheet={bnl?.sheet}
                origin={origin} keyQ={keyQ} outputs={st.outputs} onOpenSheet={() => setSection('tournament')} casters={st.live.casters} />
            )}

            {section === 'twitch' && (
              <TwitchPanel status={st.twitch} tw={wc?.tw} send={m => sock.send(m)} now={now}
                teams={[wc?.state.intro.a ?? '', wc?.state.intro.b ?? '']} origin={origin} keyQ={keyQ} />
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

            {section === 'links' && (
              <>
                <Block title="OBS dock" note="Docks → Custom Browser Docks">
                  <p className="mb-2 text-[12px] text-white/50">The screen buttons and the controls for what's on air, inside OBS. In OBS: <b className="text-white/70">Docks → Custom Browser Docks…</b>, name it <b className="text-white/70">OverDrive</b>, paste one of these URLs, Apply. Sign in once with the producer password inside the dock.</p>
                  {([['On air only', '/controller/dock'], ['Everything (every scene)', '/controller/dock/all']] as const).map(([label, path]) => (
                    <div key={path} className="mt-1.5 flex items-center gap-2">
                      <span className="w-[170px] text-[12px] text-white/60">{label}</span>
                      <input readOnly className="input h-8 flex-1 font-mono text-[12px]" value={`${origin}${path}`} onFocus={e => e.currentTarget.select()} />
                      <button type="button" className="btn-sm" onClick={() => navigator.clipboard?.writeText(`${origin}${path}`)}>Copy</button>
                    </div>
                  ))}
                </Block>
                <Block title="Scene links" note="Open = scene + its controls in a browser tab · OBS: 1920 × 1480, Crop Bottom 400">
                  <p className="mb-3 text-[12px] text-white/50">Each scene has its own page with the picture on top and that scene's controls underneath. <b className="text-white/70">Open</b> runs it in a browser tab; <b className="text-white/70">OBS + controls</b> is the same link for an OBS browser source (1920 × 1480, Crop Bottom 400, click with right-click → Interact); <b className="text-white/70">Clean</b> is the picture only (1920 × 1080). These links carry your control token: keep them to yourself.</p>
                  <div className="divide-y divide-white/[0.06]">
                    <LinkRow label="Whole show" sub="Follows the live screen · has screen buttons" path="/output/program" origin={origin} keyQ={keyQ} token={st.apiToken} count={st.outputs.find(o => o.route === 'program')?.count ?? 0} />
                    {SCREEN_IDS.map(id => (
                      <LinkRow key={id} label={SCREEN_LABELS[id]} onAir={st.live.screen === id} path={`/output/screen/${id}`} origin={origin} keyQ={keyQ} token={st.apiToken} count={st.outputs.find(o => o.route === `screen/${id}`)?.count ?? 0} />
                    ))}
                  </div>
                </Block>
                <Block title="Single overlays" note={`Picture only · ${sourceSizeLabel(st.obsSetup?.options.profile)}`}>
                  <div className="divide-y divide-white/[0.06]">
                    {OUTPUT_ROUTES.filter(r => r.route !== 'program').map(({ route, label }) => (
                      <LinkRow key={route} label={label} path={`/output/${route}`} origin={origin} keyQ={keyQ} token={st.apiToken} count={st.outputs.find(o => o.route === route)?.count ?? 0} clean />
                    ))}
                  </div>
                </Block>
              </>
            )}

            {section === 'settings' && (
              <>
                <Block title="Game feed for casters" note="Low-latency OBS feed from your stream server (WebRTC / WHEP)">
                  <GameFeedSettingsCard />
                </Block>
                <Block title="Branding theme" note="Goes to preview · TAKE LIVE to switch">
                  <Segmented value={showPreview.theme} onChange={v => showProps.set({ theme: v })} options={THEMES.map(t => ({ value: t.id, label: t.label }))} />
                </Block>
                <Block title="OBS browser sources" note={stripUrls ? `${sourceSizeLabel(st.obsSetup?.options.profile, true)} · controls via Interact` : sourceSizeLabel(st.obsSetup?.options.profile)}>
                  <div className="mb-3">
                    <Switch on={stripUrls} onChange={setStripUrls} label={`With controls underneath (source ${sourceSizeLabel(st.obsSetup?.options.profile, true).replace(' · crop bottom', ', Crop Bottom')} in OBS, click them with right-click → Interact)`} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    {OUTPUT_ROUTES.map(({ route, label }) => {
                      const n = st.outputs.find(o => o.route === route)?.count ?? 0;
                      const strip = stripUrls ? `${keyQ ? '&' : '?'}controls&token=${encodeURIComponent(st.apiToken)}` : '';
                      return <CopyField key={route} value={`${origin}/output/${route}${keyQ}${strip}`} label={<>{label} {n > 0 && <span className="ml-1 text-emerald-400/80">● {n}</span>}</>} />;
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

/** One output as a row: name, on-air / connected dots, and Open / copy buttons. */
function LinkRow({ label, sub, path, origin, keyQ, token, count, onAir, clean }: { label: string; sub?: string; path: string; origin: string; keyQ: string; token: string; count: number; onAir?: boolean; clean?: boolean }) {
  const base = `${origin}${path}${keyQ}`;
  const withControls = `${base}${keyQ ? '&' : '?'}controls&token=${encodeURIComponent(token)}`;
  const [copied, setCopied] = useState('');
  const copy = async (what: string, v: string) => {
    try { await navigator.clipboard.writeText(v); } catch { window.prompt('Copy this link', v); }
    setCopied(what); setTimeout(() => setCopied(''), 1200);
  };
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 truncate text-[13px] font-semibold">
          {label}
          {onAir && <span className="rounded bg-red-500/90 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.14em] text-white">On air</span>}
          {count > 0 && <span className="text-[11px] font-normal text-emerald-400/80">● {count} open</span>}
        </div>
        <div className="truncate font-mono text-[10px] text-white/35">{sub ?? path}</div>
      </div>
      {!clean && <a className="btn-sm" href={withControls} target="_blank" rel="noreferrer">Open</a>}
      {!clean && <button type="button" className="btn-sm" onClick={() => copy('obs', withControls)}>{copied === 'obs' ? 'Copied' : 'OBS + controls'}</button>}
      {clean && <a className="btn-sm" href={base} target="_blank" rel="noreferrer">Open</a>}
      <button type="button" className="btn-sm" onClick={() => copy('clean', base)}>{copied === 'clean' ? 'Copied' : 'Clean'}</button>
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

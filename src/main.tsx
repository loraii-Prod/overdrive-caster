import { GameFeedPage } from './pages/GameFeedPage';
import { useCallback, useEffect, useState } from 'react';
import { MusicOutput } from './pages/MusicOutput';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/russo-one/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800-italic.css';
import './index.css';
import { Output, AudioOutput, ScreenOutput , GraphicOutput } from './pages/Output';
import { Contribute } from './pages/Contribute';
import { Crew } from './pages/Crew';
import { Controller } from './pages/controller/Controller';
import { Login } from './pages/controller/Login';
import { Producer } from './pages/producer/Producer';
import { MediaOutput } from './pages/MediaOutput';
import { Admin } from './pages/admin/Admin';
import type { Layers } from './components/Stage';

const L = (p: Partial<Layers>): Layers => ({ background: true, content: true, frames: true, names: true, branding: true, ...p });

type SessionRole = 'producer' | 'admin' | null;

function useSessionRole() {
  const [role, setRole] = useState<SessionRole | undefined>(undefined);
  const check = useCallback(() => {
    fetch('/api/session').then(r => r.json()).then(j => setRole(j.role ?? null)).catch(() => setTimeout(check, 2000));
  }, []);
  useEffect(check, [check]);
  return [role, check, setRole] as const;
}

function ControllerGate({ dockOnly = false, dockAll = false }: { dockOnly?: boolean; dockAll?: boolean }) {
  const [role, check, setRole] = useSessionRole();
  if (role === undefined) return <div className="min-h-screen bg-[#111]" />;
  if (role === 'producer') return <Controller onLogout={() => setRole(null)} dockOnly={dockOnly} dockAll={dockAll} />;
  // Signed in as tournament admin (or not at all): ask for the producer password here instead of bouncing to /admin.
  return <Login onDone={check} title="CASTER CONTROL" producerOnly
    note={role === 'admin' ? 'You are signed in as tournament admin. Enter the producer password to open the controller.' : undefined} />;
}

/** Overdrive 2.0 Producer Console: same producer sign-in as the controller. */
function ProducerGate({ dock }: { dock?: string }) {
  const [role, check, setRole] = useSessionRole();
  if (role === undefined) return <div className="min-h-screen bg-[#0b0b0c]" />;
  if (role === 'producer') return <Producer key={dock ?? ''} onLogout={() => setRole(null)} dock={dock} />;
  return <Login onDone={check} title={dock ? 'OVERDRIVE SCENE CONTROLLER' : 'PRODUCER CONSOLE'} producerOnly />;
}
/** /producer/scene/<target>: the controller of ONE OBS scene, for an OBS Custom Browser Dock. */
function SceneControllerGate() {
  const { target } = useParams();
  return <ProducerGate dock={target && /^(follow|[gs]:[a-z0-9-]{1,40})$/.test(target) ? target : 'follow'} />;
}

function AdminGate() {
  const [role, check, setRole] = useSessionRole();
  if (role === undefined) return <div className="min-h-screen bg-[#111]" />;
  return role ? <Admin role={role} onLogout={() => setRole(null)} /> : <Login onDone={check} title="TOURNAMENT ADMIN" />;
}

createRoot(document.getElementById('root')!).render(

    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/controller" replace />} />
        <Route path="/producer" element={<ProducerGate />} />
        <Route path="/producer/scene/:target" element={<SceneControllerGate />} />
        <Route path="/controller" element={<ControllerGate />} />
        <Route path="/controller/dock" element={<ControllerGate dockOnly />} />
        <Route path="/controller/dock/all" element={<ControllerGate dockAll />} />
        <Route path="/output/casters" element={<Output route="casters" kind={{ k: 'stage', layers: L({}) }} />} />
        <Route path="/output/solo" element={<Output route="solo" kind={{ k: 'stage', forced: 'solo', layers: L({}) }} />} />
        <Route path="/output/duo" element={<Output route="duo" kind={{ k: 'stage', forced: 'duo', layers: L({}) }} />} />
        <Route path="/output/trio" element={<Output route="trio" kind={{ k: 'stage', forced: 'trio', layers: L({}) }} />} />
        <Route path="/output/names" element={<Output route="names" kind={{ k: 'stage', layers: L({ background: false, content: false, frames: false, branding: false }) }} />} />
        <Route path="/output/branding" element={<Output route="branding" kind={{ k: 'stage', layers: L({ background: false, content: false, frames: false, names: false }) }} />} />
        <Route path="/output/program" element={<Output route="program" kind={{ k: 'program' }} />} />
        <Route path="/output/starting" element={<Output route="starting" kind={{ k: 'screen', id: 'starting' }} />} />
        <Route path="/output/brb" element={<Output route="brb" kind={{ k: 'screen', id: 'brb' }} />} />
        <Route path="/output/ending" element={<Output route="ending" kind={{ k: 'screen', id: 'ending' }} />} />
        <Route path="/output/warmup" element={<Output route="warmup" kind={{ k: 'screen', id: 'warmup' }} />} />
        <Route path="/output/gameplay" element={<Output route="gameplay" kind={{ k: 'screen', id: 'gameplay' }} />} />
        <Route path="/output/player" element={<Output route="player" kind={{ k: 'player' }} />} />
        <Route path="/output/music" element={<MusicOutput />} />
        <Route path="/output/media" element={<MediaOutput />} />
        <Route path="/g/:id" element={<GraphicOutput />} />
        <Route path="/talent/:talent" element={<Contribute />} />
        <Route path="/output/nextmatch" element={<Output route="nextmatch" kind={{ k: 'nextmatch' }} />} />
        <Route path="/output/playercam" element={<Output route="playercam" kind={{ k: 'playercam' }} />} />
        <Route path="/output/scoreboard" element={<Output route="scoreboard" kind={{ k: 'scoreboard' }} />} />
        <Route path="/output/ticker" element={<Output route="ticker" kind={{ k: 'ticker' }} />} />
        <Route path="/output/bracket" element={<Output route="bracket" kind={{ k: 'bracket' }} />} />
        <Route path="/output/matches" element={<Output route="matches" kind={{ k: 'matches' }} />} />
        <Route path="/output/wildcard" element={<Output route="wildcard" kind={{ k: 'wildcard' }} />} />
        <Route path="/output/wildcard/gameplay" element={<Output route="wildcard/gameplay" kind={{ k: 'wc-gameplay' }} />} />
        <Route path="/output/wildcard/waiting" element={<Output route="wildcard/waiting" kind={{ k: 'wc-waiting' }} />} />
        <Route path="/output/wildcard/casters" element={<Output route="wildcard/casters" kind={{ k: 'wc-casters' }} />} />
        <Route path="/output/major" element={<Output route="major" kind={{ k: 'wildcard' }} />} />
        <Route path="/output/major/gameplay" element={<Output route="major/gameplay" kind={{ k: 'wc-gameplay' }} />} />
        <Route path="/output/major/waiting" element={<Output route="major/waiting" kind={{ k: 'wc-waiting' }} />} />
        <Route path="/output/major/casters" element={<Output route="major/casters" kind={{ k: 'wc-casters' }} />} />
        <Route path="/output/twitch" element={<Output route="twitch" kind={{ k: 'twitch' }} />} />
        <Route path="/output/screen/:id" element={<ScreenOutput />} />
        <Route path="/output/audio/:slot" element={<AudioOutput />} />
        <Route path="/admin" element={<AdminGate />} />
        <Route path="/crew" element={<Crew />} />
        <Route path="/contribute/:slot" element={<Contribute />} />
        <Route path="/gamefeed" element={<GameFeedPage />} />
        <Route path="*" element={<Navigate to="/controller" replace />} />
      </Routes>
    </BrowserRouter>
,
);

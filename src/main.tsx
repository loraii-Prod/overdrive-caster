import { useCallback, useEffect, useState } from 'react';
import { MusicOutput } from './pages/MusicOutput';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
import { Output, AudioOutput } from './pages/Output';
import { Contribute } from './pages/Contribute';
import { Crew } from './pages/Crew';
import { Controller } from './pages/controller/Controller';
import { Login } from './pages/controller/Login';
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

function ControllerGate() {
  const [role, check, setRole] = useSessionRole();
  if (role === undefined) return <div className="min-h-screen bg-[#111]" />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  return role === 'producer' ? <Controller onLogout={() => setRole(null)} /> : <Login onDone={check} title="CASTER CONTROL" />;
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
        <Route path="/controller" element={<ControllerGate />} />
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
        <Route path="/output/nextmatch" element={<Output route="nextmatch" kind={{ k: 'nextmatch' }} />} />
        <Route path="/output/playercam" element={<Output route="playercam" kind={{ k: 'playercam' }} />} />
        <Route path="/output/scoreboard" element={<Output route="scoreboard" kind={{ k: 'scoreboard' }} />} />
        <Route path="/output/ticker" element={<Output route="ticker" kind={{ k: 'ticker' }} />} />
        <Route path="/output/bracket" element={<Output route="bracket" kind={{ k: 'bracket' }} />} />
        <Route path="/output/matches" element={<Output route="matches" kind={{ k: 'matches' }} />} />
        <Route path="/output/audio/:slot" element={<AudioOutput />} />
        <Route path="/admin" element={<AdminGate />} />
        <Route path="/crew" element={<Crew />} />
        <Route path="/contribute/:slot" element={<Contribute />} />
        <Route path="*" element={<Navigate to="/controller" replace />} />
      </Routes>
    </BrowserRouter>
,
);

import { useEffect, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import { Dot, Label, Switch, TextField } from './ui';

/** Connect to OBS and build the whole BNL scene setup in one click. */
export function ObsPanel({ st, send }: { st: ControllerState; send: (m: any) => void }) {
  const o = st.obs;
  const [url, setUrl] = useState(o.url ?? 'ws://127.0.0.1:4455');
  const [pw, setPw] = useState('');
  const [game, setGame] = useState(true);
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (o.url) setUrl(o.url); }, [o.url]);
  useEffect(() => { setBusy(false); }, [o.build?.at]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[13px]">
        <Dot tone={o.connected ? 'ok' : o.enabled ? 'bad' : 'off'} />
        {o.connected ? <>Connected to OBS <span className="text-white/40">· {o.url}</span></> : o.enabled ? 'Not connected' : 'Not set up'}
      </div>
      {o.error && !o.connected && <p className="text-[12px] text-amber-300/85">{o.error}</p>}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto] md:items-end">
        <div className="min-w-0"><Label>WebSocket URL</Label><TextField value={url} onChange={setUrl} mono /></div>
        <div className="min-w-0"><Label>Password {o.hasPassword && <span className="normal-case tracking-normal text-white/35">(saved)</span>}</Label>
          <input type="password" className="input w-full" value={pw} placeholder={o.hasPassword ? '••••••••' : 'from OBS'} onChange={e => setPw(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={() => send({ t: 'obs-connect', url, ...(pw ? { password: pw } : {}) })}>{o.enabled ? 'Reconnect' : 'Connect'}</button>
          {o.enabled && <button type="button" className="btn-sm" onClick={() => send({ t: 'obs-connect', url: '' })}>Disconnect</button>}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-white/40">
        In OBS: Tools → WebSocket Server Settings → tick <b>Enable WebSocket server</b> → Show Connect Info, copy the password here. OBS on this PC = ws://127.0.0.1:4455.
      </p>

      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="text-[13px] font-semibold">Import the BNL setup into OBS</div>
        <p className="mt-1 text-[12px] leading-relaxed text-white/50">
          Creates one scene per screen (BNL · Starting soon, BNL · Casters, BNL · Gameplay, …), all sharing one 1920×1080 browser source with the whole show, and links them so GO / TAKE LIVE also switches OBS. Safe to run again: nothing is deleted, existing scenes are reused.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Switch on={game} onChange={setGame} label="Game capture under the gameplay overlay" />
          <Switch on={audio} onChange={setAudio} label="Audio: caster mics + music" />
          <button type="button" className="btn-primary ml-auto" disabled={!o.connected || busy} onClick={() => { setBusy(true); send({ t: 'obs-build', gameCapture: game, audio }); }}>
            {busy ? 'Building…' : 'Build scenes in OBS'}
          </button>
        </div>
        {o.build && (
          <div className={`mt-3 rounded border p-2 font-mono text-[11px] leading-relaxed ${o.build.ok ? 'border-emerald-500/30 text-emerald-200/80' : 'border-amber-400/40 text-amber-200/90'}`}>
            {o.build.lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      {o.connected && o.scenes.length > 0 && (
        <div>
          <Label>OBS scenes · click to switch</Label>
          <div className="flex flex-wrap gap-1.5">
            {o.scenes.map(s => (
              <button key={s} type="button" onClick={() => send({ t: 'obs-scene', name: s })}
                className={`btn-sm ${o.currentScene === s ? '!border-[#e5484d] !bg-[#e5484d]/20 !text-white' : ''}`}>{s}</button>
            ))}
          </div>
          <button type="button" className="btn-sm mt-3" onClick={() => send({ t: 'obs-sync' })}>Re-sync camera sources</button>
        </div>
      )}
    </div>
  );
}

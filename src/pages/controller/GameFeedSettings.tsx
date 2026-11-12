import { useEffect, useState } from 'react';
import { GAMEFEED_MODES, type GameFeedMode } from '../../../shared/gamefeed';
import { GameFeed } from '../../components/GameFeed';

interface S { enabled: boolean; source: 'whep' | 'vdo'; vdoUrl: string; url: string; user: string; hasPass: boolean; mode: GameFeedMode }

/** Settings → Game feed for casters: the stream server's WHEP address and the caster login (password write-only). */
export function GameFeedSettingsCard() {
  const [s, setS] = useState<S | null>(null);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState(false);
  useEffect(() => { fetch('/gamefeed/settings').then(r => r.json()).then(setS).catch(() => setMsg('Could not load the settings')); }, []);
  const save = async (patch: Partial<S> & { pass?: string }) => {
    setMsg('');
    const r = await fetch('/gamefeed/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, ...patch }) });
    if (!r.ok) return setMsg('Not saved');
    setS(await r.json()); setPass(''); setMsg('Saved');
  };
  if (!s) return <p className="text-[12.5px] text-white/45">{msg || 'Loading…'}</p>;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={s.enabled} onChange={e => save({ enabled: e.target.checked })} /> Show the game feed on the casters' camera pages
      </label>
      <div className="grid gap-2" style={{ gridTemplateColumns: '150px 1fr' }}>
        <span className="self-center text-[12px] text-white/55">Source</span>
        <div className="flex gap-1.5">
          <button type="button" className={`btn-xs ${s.source === 'whep' ? '!border-[#e5484d] !text-white' : ''}`} onClick={() => save({ source: 'whep' })}>Stream server (WHEP)</button>
          <button type="button" className={`btn-xs ${s.source === 'vdo' ? '!border-[#e5484d] !text-white' : ''}`} onClick={() => save({ source: 'vdo' })}>VDO.Ninja</button>
        </div>
        {s.source === 'vdo' && <>
          <span className="self-center text-[12px] text-white/55">VDO.Ninja link</span>
          <input className="input h-9 text-[13px]" placeholder="https://vdo.ninja/?view=YOUR_STREAM_ID (add &password=… if the stream has one)" defaultValue={s.vdoUrl} onBlur={e => e.target.value.trim() !== s.vdoUrl && save({ vdoUrl: e.target.value.trim() })} />
        </>}
        {s.source === 'whep' && <>
        <span className="self-center text-[12px] text-white/55">WHEP address</span>
        <input className="input h-9 text-[13px]" placeholder="http://your-stream-server/live-web/whep" defaultValue={s.url} onBlur={e => e.target.value.trim() !== s.url && save({ url: e.target.value.trim() })} />
        <span className="self-center text-[12px] text-white/55">Viewer user</span>
        <input className="input h-9 text-[13px]" defaultValue={s.user} onBlur={e => e.target.value.trim() !== s.user && save({ user: e.target.value.trim() })} />
        <span className="self-center text-[12px] text-white/55">Viewer password</span>
        <div className="flex gap-2">
          <input className="input h-9 flex-1 text-[13px]" type="password" autoComplete="new-password" placeholder={s.hasPass ? 'saved (type to replace)' : 'the caster password of the stream server'} value={pass} onChange={e => setPass(e.target.value)} />
          <button type="button" className="btn-xs" disabled={!pass} onClick={() => save({ pass })}>Save password</button>
        </div>
        </>}
        <span className="self-center text-[12px] text-white/55">Default latency</span>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(GAMEFEED_MODES) as GameFeedMode[]).map(m => (
            <button key={m} type="button" className={`btn-xs ${s.mode === m ? '!border-[#e5484d] !text-white' : ''}`} onClick={() => save({ mode: m })}>{GAMEFEED_MODES[m].name} · {GAMEFEED_MODES[m].buf} ms</button>
          ))}
        </div>
      </div>
      {s.source === 'vdo' && (
        <p className="text-[12px] leading-relaxed text-white/45">
          VDO.Ninja: a normal view link (OBS → VDO.Ninja with the WHIP output or a push link, then <code>?view=</code> that stream ID, or a room scene link). The caster page loads it in an embedded VDO.Ninja player with this app's controls on top: latency (VDO's buffer, changed live), mute and volume, fullscreen, pop out and reconnect. This link goes to the casters' browsers as is, so a VDO password in it is visible to them.
        </p>
      )}
      <p className="text-[12px] leading-relaxed text-white/45">
        Casters see the feed at the top of their camera page (with Pop out for a second screen). With the stream server, their browser asks this app for the stream and this app adds the login, so casters never see the password, and an https page can use an http stream server; the video itself comes straight from the stream server (no extra delay). {msg && <b className="text-white/70">{msg}</b>}
      </p>
      <div>
        <button type="button" className="btn-xs" disabled={!s.enabled || !(s.source === 'vdo' ? s.vdoUrl : s.url)} onClick={() => setPreview(p => !p)}>{preview ? 'Close preview' : 'Preview the feed here'}</button>
      </div>
      {preview && <div className="max-w-[720px]"><GameFeed key={`${s.source}-${s.vdoUrl}-${s.url}`} auth="" /></div>}
    </div>
  );
}

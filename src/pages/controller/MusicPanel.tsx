import { useRef, useState } from 'react';
import type { ScreenId, Show } from '../../../shared/types';
import type { QuickOp } from '../../../shared/protocol';
import { MUSIC_LABELS, MUSIC_SECTIONS, MUSIC_STYLE, sectionFor, type MusicSection } from '../../../shared/music';
import { useMusicLibrary } from '../MusicOutput';
import { CopyField, Switch } from './ui';

export function MusicPanel({ live, screen, quick, musicUrl, playing }: { live: Show; screen: ScreenId; quick: (op: QuickOp) => void; musicUrl: string; playing: number }) {
  const m = live.music;
  const set = (patch: Partial<Show['music']>) => quick({ k: 'music', patch });
  const { lib, folder, setLib } = useMusicLibrary(10000);
  const now = sectionFor(screen);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const upload = async (s: MusicSection, files: FileList | null) => {
    if (!files) return;
    setErr('');
    for (const f of Array.from(files)) {
      setBusy(`${s}:${f.name}`);
      const r = await fetch(`/api/music/${s}`, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Filename': f.name.replace(/[^\w .()-]/g, '') }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? 'Upload failed'); else setLib(j.sections);
    }
    setBusy(null);
  };
  const del = async (url: string) => {
    const parts = url.split('/'); // …/<folder>/<file>
    const r = await fetch(`/api/music/${parts[parts.length - 2]}/${parts[parts.length - 1]}`, { method: 'DELETE' });
    if (r.ok) setLib((await r.json()).sections);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch on={m.enabled} onChange={v => set({ enabled: v })} label="Music on" />
        <label className="flex items-center gap-3 text-[12px] text-white/60">Master
          <input type="range" min={0} max={1} step={0.01} value={m.volume} onChange={e => set({ volume: +e.target.value })} className="w-48 accent-white" />
          <span className="w-9 tabular-nums">{Math.round(m.volume * 100)}%</span>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/60">Crossfade
          <select className="input w-auto" value={m.fadeMs} onChange={e => set({ fadeMs: +e.target.value })}>
            {[1000, 2500, 4000, 6000].map(v => <option key={v} value={v}>{v / 1000}s</option>)}
          </select>
        </label>
        <button type="button" className="btn-sm" onClick={() => set({ skip: Date.now() })} disabled={!now || m.levels[now] === 0}>Skip track ⏭</button>
        <span className="text-[12px] text-white/45">On air: <b className="text-white/80">{now ? `${MUSIC_LABELS[now]}${m.levels[now] > 0 ? '' : ' (off)'}` : 'silent'}</b></span>
        <span className={`text-[12px] ${playing > 0 ? 'text-emerald-400/80' : 'text-amber-300/80'}`}>{playing > 0 ? `● player running in OBS (${playing})` : '● player not open in OBS'}</span>
      </div>
      <CopyField value={musicUrl} label="OBS browser source (tick “Control audio via OBS”) · added automatically by “Build scenes in OBS”" />
      {err && <p className="text-[12px] text-amber-300/85">{err}</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MUSIC_SECTIONS.map(s => {
          const tracks = lib?.[s] ?? [];
          const shared = tracks.length > 0 && tracks.every(t => t.shared);
          return (
            <div key={s} className={`rounded-md border p-3 ${now === s ? 'border-white/50 bg-white/[0.04]' : 'border-white/10 bg-[#171717]'}`}>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{MUSIC_LABELS[s]}</span>
                {now === s && <span className="rounded-[3px] bg-[#e5484d] px-1.5 text-[10px] font-bold">ON AIR</span>}
                <span className="ml-auto text-[11px] text-white/40">{tracks.length} track{tracks.length === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-white/45">{MUSIC_STYLE[s]}</div>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-white/50">Level
                <input type="range" min={0} max={1} step={0.01} value={m.levels[s]} onChange={e => set({ levels: { ...m.levels, [s]: +e.target.value } })} className="flex-1 accent-white" />
                <span className="w-8 tabular-nums">{m.levels[s] > 0 ? `${Math.round(m.levels[s] * 100)}%` : 'Off'}</span>
              </label>
              {shared && <div className="mt-2 text-[11px] text-amber-300/75">Using the tracks from the old shared folder until you add some here</div>}
              <div className="mt-2 max-h-[140px] space-y-1 overflow-auto">
                {tracks.map(t => (
                  <div key={t.url} className="group flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <button type="button" className="btn-xs opacity-0 group-hover:opacity-100" onClick={() => del(t.url)}>✕</button>
                  </div>
                ))}
              </div>
              <UploadAudio onFiles={f => upload(s, f)} busy={busy?.startsWith(s + ':') ?? false} />
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-white/40">
        You can also drop files straight into <span className="font-mono">{folder || 'data\\music\\<section>'}</span>. Only use music you have the rights to stream (royalty-free / licensed for Twitch). Each scene plays its own folder at its own level; set a level to Off for silence (Gameplay starts off). Music crossfades on every scene change.
      </p>
    </div>
  );
}

function UploadAudio({ onFiles, busy }: { onFiles: (f: FileList | null) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="audio/*" multiple className="hidden" onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" className="btn-xs mt-2" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : '+ Add tracks'}</button>
    </>
  );
}

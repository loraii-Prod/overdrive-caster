import { useState } from 'react';
import type { BrandKit, ControllerState, Show, ThemeId } from '../../../shared/types';
import { THEMES } from '../../../shared/types';
import { UploadButton } from '../admin/Admin';
import { ConfirmButton, Label, Segmented, Switch, TextField } from './ui';

export function EventsPanel({ st, send }: { st: ControllerState; send: (m: any) => void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState<'blank' | 'copy' | 'overdrive'>('blank');
  const [theme, setTheme] = useState<ThemeId>('classic');
  const [activate, setActivate] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const events = [...st.events].sort((a, b) => (a.id === st.activeEvent ? -1 : b.id === st.activeEvent ? 1 : b.createdAt - a.createdAt));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {events.map(e => {
          const active = e.id === st.activeEvent;
          return (
            <div key={e.id} className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5 ${active ? 'border-[#e5484d]/70 bg-[#e5484d]/10' : 'border-white/10 bg-[#171717]'}`}>
              {edit === e.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <TextField value={editName} onChange={setEditName} />
                  <button type="button" className="btn-sm" onClick={() => { send({ t: 'event-rename', id: e.id, name: editName }); setEdit(null); }}>Save</button>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{e.name}</div>
                  <div className="text-[11px] text-white/40">created {new Date(e.createdAt).toLocaleDateString()}</div>
                </div>
              )}
              {active ? <span className="rounded-[3px] bg-[#e5484d] px-2 py-[2px] text-[11px] font-bold tracking-wider">ON AIR</span> : (
                <ConfirmButton className="btn-primary" confirmLabel={`Go live with ${e.name}?`} onConfirm={() => send({ t: 'event-switch', id: e.id })}>Switch to this event</ConfirmButton>
              )}
              {edit !== e.id && <button type="button" className="btn-xs" onClick={() => { setEdit(e.id); setEditName(e.name); }}>Rename</button>}
              {!active && <ConfirmButton className="btn-xs" confirmLabel="Delete for good?" onConfirm={() => send({ t: 'event-delete', id: e.id })}>Delete</ConfirmButton>}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-white/40">
        Each event keeps its own casters, players, bracket, run of show, screen texts, schedule, ticker, music and brand kit. Switching is instant and goes straight to air (all OBS outputs restyle). Logins, OBS connection, camera links and the API token stay the same.
      </p>

      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 text-[13px] font-semibold">New event</div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <div className="min-w-0"><Label>Name</Label><TextField value={name} onChange={setName} placeholder="e.g. Overdrive Major" /></div>
          <div><Label>Start from</Label><Segmented size="sm" value={from} onChange={setFrom} options={[{ value: 'blank', label: 'Blank' }, { value: 'copy', label: 'Copy current' }, { value: 'overdrive', label: 'Overdrive package' }]} /></div>
          {from === 'blank' && <div><Label>Base look</Label><Segmented size="sm" value={theme} onChange={setTheme} options={THEMES.map(t => ({ value: t.id, label: t.label }))} /></div>}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Switch on={activate} onChange={setActivate} label="Switch to it right away" />
          <button type="button" className="btn-primary ml-auto" disabled={!name.trim()} onClick={() => { send({ t: 'event-create', name, from, theme, activate }); setName(''); }}>Create event</button>
        </div>
      </div>
    </div>
  );
}

const FONT_OPTS = [{ value: '', label: 'Theme default' }, { value: 'bebas', label: 'Bebas Neue' }, { value: 'barlow', label: 'Barlow Condensed' }, { value: 'russo', label: 'Russo One' }, { value: 'montserrat', label: 'Montserrat' }, { value: 'sora', label: 'Sora' }, { value: 'inter', label: 'Inter' }] as const;

/** Brand kit of the active event (goes to preview: TAKE LIVE). */
export function BrandPanel({ show, set }: { show: Show; set: (p: Partial<Show>) => void }) {
  const b = show.brand;
  const up = (p: Partial<BrandKit>) => set({ brand: { ...b, ...p } });
  const Asset = ({ label, k, hint }: { label: string; k: 'logo' | 'mark'; hint: string }) => (
    <div className="rounded-md border border-white/10 bg-[#171717] p-3">
      <Label>{label}</Label>
      <div className="grid h-16 place-items-center rounded bg-[#0d0d0d]">{b[k] ? <img src={b[k]} alt="" className="max-h-14 max-w-full object-contain" /> : <span className="text-[11px] text-white/35">theme default</span>}</div>
      <div className="mt-2 flex items-center gap-2"><UploadButton role="logo" onUrl={u => up({ [k]: u } as Partial<BrandKit>)} label="Upload" />{b[k] && <button type="button" className="btn-xs" onClick={() => up({ [k]: '' } as Partial<BrandKit>)}>Clear</button>}</div>
      <div className="mt-1 text-[10.5px] text-white/35">{hint}</div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><Label>Event name (logo text when no logo image)</Label><TextField value={b.name} onChange={v => up({ name: v })} /></div>
        <div><Label>Base look</Label><Segmented size="sm" value={show.theme} onChange={v => set({ theme: v })} options={THEMES.map(t => ({ value: t.id, label: t.label }))} /></div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Asset label="Logo" k="logo" hint="Wide logo, transparent PNG/SVG. Used in headers." />
        <Asset label="Mark / icon" k="mark" hint="Square icon: frames, scoreboard, ticker." />
        <div className="rounded-md border border-white/10 bg-[#171717] p-3">
          <Label>Background (every screen)</Label>
          <div className="grid h-16 place-items-center overflow-hidden rounded bg-[#0d0d0d]">
            {b.bg ? (b.bgKind === 'video' ? <video src={b.bg} muted autoPlay loop className="h-full w-full object-cover" /> : <img src={b.bg} alt="" className="h-full w-full object-cover" />) : <span className="text-[11px] text-white/35">theme default</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <UploadButton accept="video/mp4,video/webm,image/png,image/jpeg,image/webp" label="Upload" role="background" onUrl={(u, type) => up({ bg: u, bgKind: type.startsWith('video') ? 'video' : 'image' })} />
            {b.bg && <button type="button" className="btn-xs" onClick={() => up({ bg: '', bgKind: '' })}>Clear</button>}
          </div>
          <div className="mt-1 text-[10.5px] text-white/35">1920×1080 MP4 (H.264, loop, up to 250 MB) or image.</div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-5">
        <div><Label>Accent colour</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={b.accent || '#e23b3b'} onChange={e => up({ accent: e.target.value })} className="h-9 w-14 cursor-pointer rounded border border-white/15 bg-transparent" />
            {b.accent && <button type="button" className="btn-xs" onClick={() => up({ accent: '' })}>Default</button>}
          </div>
        </div>
        <div><Label>Graphics package</Label><Segmented size="sm" value={b.skin} onChange={v => up(v === 'overdrive' ? { skin: v, logo: b.logo || '/brand/overdrive/logo.png', mark: b.mark || '/brand/overdrive/mark.png', accent: b.accent || '#ff3b1f', font: b.font || 'russo' } : { skin: v })}
          options={[{ value: '', label: 'None (built-in look)' }, { value: 'overdrive', label: 'Overdrive video package' }]} /></div>
        {b.skin && <Switch on={b.desk} onChange={v => up({ desk: v })} label="Analyst desk frames (instead of casters booth)" />}
        <div><Label>Headline font</Label><Segmented size="sm" value={b.font} onChange={v => up({ font: v })} options={FONT_OPTS.map(o => ({ value: o.value, label: o.label }))} /></div>
      </div>
      <p className="text-[11px] text-white/40">Brand changes go to preview: check them on the Preview monitor, then TAKE LIVE.</p>
    </div>
  );
}

import type { Caster, ContributorStatus, SourceType } from '../../../shared/types';
import { ROLE_SUGGESTIONS } from '../../../shared/defaults';
import { newCasterStreamId, vdoCasterPushUrl, vdoViewUrl } from '../../../shared/players';
import { ConfirmButton, CopyField, Dot, Label, Segmented, Switch, TextField } from './ui';

const SOURCE_OPTS: { value: SourceType; label: string; hint: string }[] = [
  { value: 'vdo', label: 'VDO.Ninja', hint: 'Remote caster via a VDO.Ninja camera link' },
  { value: 'webrtc', label: 'Built-in', hint: 'Remote caster via the built-in WebRTC camera link' },
  { value: 'obs', label: 'OBS', hint: 'Local OBS source positioned via OBS WebSocket' },
  { value: 'url', label: 'URL', hint: 'Browser-playable video URL (testing)' },
  { value: 'none', label: 'None', hint: 'No camera: branded identity card' },
];

export function CasterCard({ caster, onChange, status, contributeUrl, audioUrl, onRegenKey, onAir, obsScenes, vdoPassword = '', liveVdo }: {
  caster: Caster;
  onChange: (patch: Partial<Caster>, immediate?: boolean) => void;
  status: ContributorStatus;
  contributeUrl: string;
  audioUrl: string;
  onRegenKey: () => void;
  onAir: boolean;
  obsScenes: string[];
  vdoPassword?: string;
  /** What OBS uses right now (program): VDO.Ninja ID and password. */
  liveVdo?: { id: string; password: string };
}) {
  const c = caster;
  const src = c.source;
  const setSrc = (p: Partial<Caster['source']>, immediate = true) => onChange({ source: { ...src, ...p } }, immediate);

  return (
    <section className={`rounded-lg border bg-[#171717] transition-colors ${c.enabled ? 'border-white/[0.1]' : 'border-white/[0.05] opacity-70'}`}>
      <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-[13px] font-semibold tracking-[0.18em]">CASTER {c.id}</span>
          {onAir && <span className="rounded-[3px] bg-[#e5484d] px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.16em]">PGM</span>}
        </div>
        <Switch on={c.enabled} onChange={v => onChange({ enabled: v }, true)} label={c.enabled ? 'Enabled' : 'Disabled'} />
      </header>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-[1fr_0.8fr] gap-2.5">
          <div>
            <Label>Display name</Label>
            <TextField value={c.name} onChange={v => onChange({ name: v })} placeholder="Name" />
          </div>
          <div>
            <Label>Role</Label>
            <TextField value={c.role} onChange={v => onChange({ role: v.toUpperCase() })} placeholder="Optional" list="od-roles" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <Switch on={c.cameraOn} onChange={v => onChange({ cameraOn: v }, true)} label="Camera" />
          <Switch on={c.showName} onChange={v => onChange({ showName: v }, true)} label="Nameplate" />
        </div>

        {!c.cameraOn && (
          <div className="flex items-center justify-between rounded-md bg-black/25 px-3 py-2">
            <span className="text-[12px] text-white/55">Camera off →</span>
            <Segmented size="sm" value={c.offMode} onChange={v => onChange({ offMode: v }, true)}
              options={[{ value: 'card', label: 'Name card' }, { value: 'remove', label: 'Remove' }]} />
          </div>
        )}

        <div className="border-t border-white/[0.06] pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <Label>Camera source</Label>
            <Segmented size="sm" value={src.type} onChange={v => setSrc(v === 'vdo' && !src.vdo ? { type: v, vdo: newCasterStreamId(c.id) } : { type: v })} options={SOURCE_OPTS} />
          </div>

          {src.type === 'webrtc' && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[12px] text-white/65">
                <Dot tone={status.publishing ? 'ok' : status.online ? 'warn' : 'off'} />
                {status.publishing ? 'Camera connected' : status.online ? 'Page open, camera not started' : 'Caster not connected'}
                {status.publishing && <span className="text-white/35">· {status.viewers} viewer{status.viewers === 1 ? '' : 's'}{status.hasAudio ? ' · mic' : ''}</span>}
              </div>
              <CopyField value={contributeUrl} label="Camera link for the caster" />
              <details className="group">
                <summary className="cursor-pointer select-none text-[11px] text-white/45 hover:text-white/70">More: mic source, revoke link</summary>
                <div className="mt-2.5 space-y-2.5">
                  {status.label && <div className="truncate text-[11px] text-white/35">{status.label}</div>}
                  <CopyField value={audioUrl} label="Mic as OBS audio source" />
                  <ConfirmButton onConfirm={onRegenKey} confirmLabel="Revoke & create new link?">New link (revoke old)</ConfirmButton>
                </div>
              </details>
            </div>
          )}

          {src.type === 'vdo' && src.vdo && (
            <div className="space-y-2.5">
              {liveVdo && (liveVdo.id !== src.vdo || liveVdo.password !== vdoPassword) && (
                <p className="rounded border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-200">
                  Not on air yet: OBS still uses the {liveVdo.id !== src.vdo ? 'old VDO.Ninja link' : 'old VDO.Ninja password'}, so this feed stays black until you press TAKE LIVE.
                </p>
              )}
              <CopyField value={vdoCasterPushUrl(src.vdo, c.name, vdoPassword)} label="Camera + mic link for the caster (VDO.Ninja)" />
              <p className="text-[11px] leading-relaxed text-white/40">
                Send it to {c.name || 'the caster'}: they open it, allow camera and mic, done. Video shows in their tile; their mic plays through /output/audio/{c.id} (the “Overdrive Caster {c.id} audio” source in OBS).
              </p>
              <details>
                <summary className="cursor-pointer select-none text-[11px] text-white/45 hover:text-white/70">More: direct view link, new link</summary>
                <div className="mt-2.5 space-y-2.5">
                  <CopyField value={vdoViewUrl({ vdo: src.vdo }, vdoPassword, '')} label="Direct view: open it in a browser to check the caster's camera on its own" />
                  <CopyField value={audioUrl} label="Mic as OBS audio source" />
                  <ConfirmButton onConfirm={() => setSrc({ vdo: newCasterStreamId(c.id) })} confirmLabel="Old link stops working. Sure?">New link (revoke old)</ConfirmButton>
                </div>
              </details>
            </div>
          )}

          {src.type === 'url' && (
            <div>
              <Label>Video URL (mp4 / webm)</Label>
              <TextField mono value={src.url} onChange={v => setSrc({ url: v }, false)} placeholder="https://…/camera.mp4" />
            </div>
          )}

          {src.type === 'obs' && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label>OBS scene</Label>
                <TextField value={src.obsScene} onChange={v => setSrc({ obsScene: v }, false)} placeholder="Casters" list="od-obs-scenes" />
              </div>
              <div>
                <Label>Source name</Label>
                <TextField value={src.obsSource} onChange={v => setSrc({ obsSource: v }, false)} placeholder="Cam 1" />
              </div>
              <datalist id="od-obs-scenes">{obsScenes.map(s => <option key={s} value={s} />)}</datalist>
              <p className="col-span-2 text-[11px] leading-relaxed text-white/40">
                Place the camera source below the /output/casters browser source in that scene. It's shown, hidden and fitted to its tile when you take live.
              </p>
            </div>
          )}

          {src.type === 'none' && <p className="text-[12px] text-white/45">Shows the branded identity card in the caster's slot.</p>}
        </div>
      </div>
      <datalist id="od-roles">{ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}</datalist>
    </section>
  );
}

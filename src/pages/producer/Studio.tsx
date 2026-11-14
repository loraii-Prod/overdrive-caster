/**
 * Studio Mode: the environment used BEFORE the show. Packages and instances, OBS browser-source mapping,
 * talent profiles, data bindings, control-module layouts for scene sources, assets and the show file.
 * Everything here is an acknowledged engine command (shared by every operator); nothing here airs.
 */
import { vdoCasterPushUrl } from '../../../shared/players';
import type { CamQuality } from '../../../shared/talent';
import { useRef, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { ProducerCmd } from '../../../shared/engine';
import { PACKAGES, pkgById, type GfxInstance } from '../../../shared/gfx';
import { MODULES, REGISTRY, studioFor, type ModuleId, type SourceDef } from '../../../shared/registry';
import { SEATS, SEAT_LABELS, talentLabel, type Seat } from '../../../shared/talent';
import { wcResolve } from '../../../shared/wildcard';
import { Btn, Chip, ModuleView, PVW, Seg, Tiny, WARN, type Ack, type Ctx } from './modules';
import { PackageLibrary } from './Inspector';
import { obsSceneOfGfx } from './Library';
import { ObsSetupPanel } from './ObsSetup';
import { B, C, LABEL, VisBadge } from './ws';

type Run = (c: ProducerCmd, l: string) => Promise<Ack>;

// ======================================================================= Talent dashboard
export function TalentDashboard({ st, run }: { st: ControllerState; run: (c: ProducerCmd, l: string) => Promise<Ack> }) {
  const talent = st.talent ?? [];
  const [names, setNames] = useState<Record<string, string>>({});
  const link = (id: string, key: string) => `${location.origin}/talent/${id}?key=${encodeURIComponent(key)}`;
  const vdoLink = (t: { vdoId: string; name: string; camQuality?: CamQuality }) => vdoCasterPushUrl(t.vdoId, t.name, st.showLive.vdo.password, st.showLive.vdo.room, t.camQuality);
  const missing = talent.filter(t => !t.name.trim()).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-talent-dashboard>
      <div className="flex h-8 flex-none items-center gap-3 border-b border-white/10 px-3 text-[11px]">
        <b className="uppercase tracking-[0.14em]">Talent · 10 profiles</b>
        <span className="text-white/45">Send each person their link once. Positions change here without them reconnecting.</span>
        {missing > 0 && <span className="ml-auto" style={{ color: WARN }}>{missing} name{missing === 1 ? '' : 's'} need confirmation</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-[#111113] text-left text-[10px] uppercase tracking-[0.12em] text-white/40"><tr><th className="px-2 py-1">ID</th><th>Name</th><th>Role</th><th>Camera via</th><th title="Camera resolution asked from this person: 720p30 (default, light) or 1080p30 (sharper on 4K shows, about twice the upload). They don't need a new link; a VDO.Ninja caster reopens theirs.">Camera</th><th>Status</th><th>Position</th><th>Links</th></tr></thead>
          <tbody>
            {talent.map(t => (
              <tr key={t.id} data-talent={t.id} className="border-t border-white/[0.06]">
                <td className="px-2 py-[3px] font-mono text-white/50">{t.id}</td>
                <td><div className="flex items-center gap-1">
                  <input aria-label={`Name ${t.id}`} value={names[t.id] ?? t.name} placeholder="name needed" onChange={e => setNames(n => ({ ...n, [t.id]: e.target.value }))}
                    onBlur={() => names[t.id] !== undefined && names[t.id] !== t.name && run({ c: 'talent-edit', id: t.id, name: names[t.id] }, `Rename ${t.id}`).then(() => setNames(n => { const { [t.id]: _, ...rest } = n; return rest; }))}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className={`w-[150px] rounded-[2px] border bg-[#0b0b0c] px-1.5 py-[3px] ${t.name ? 'border-white/15' : 'border-[#f5a524]/60'}`} />
                </div></td>
                <td><Seg value={t.role} options={[['caster', 'Caster'], ['analyst', 'Analyst']]} onChange={v => run({ c: 'talent-edit', id: t.id, role: v as 'caster' | 'analyst' }, `${t.id} role ${v}`)} /></td>
                <td><Seg value={t.mode} options={[['webrtc', 'App'], ['vdo', 'VDO.Ninja']]} onChange={v => run({ c: 'talent-edit', id: t.id, mode: v as 'webrtc' | 'vdo' }, `${t.id} camera via ${v}`)} /></td>
                <td><Seg value={t.camQuality ?? '720p'} options={[['720p', '720p'], ['1080p', '1080p']]} onChange={v => run({ c: 'talent-edit', id: t.id, camQuality: v as CamQuality }, `${t.id} camera ${v}`)} /></td>
                <td className="whitespace-nowrap">{t.mode === 'vdo' ? <span className="text-white/60">VDO push</span> : t.publishing ? <span style={{ color: PVW }}>● {t.hasAudio ? 'cam + mic' : 'cam'}</span> : t.online ? <span style={{ color: WARN }}>● no camera</span> : <span className="text-white/35">● offline</span>}</td>
                <td>
                  <select aria-label={`Position of ${t.id}`} value={t.seat ?? ''} onChange={e => run(e.target.value ? { c: 'seat', seat: Number(e.target.value), talent: t.id } : { c: 'seat', seat: t.seat!, talent: null }, e.target.value ? `${talentLabel(t)} → ${SEAT_LABELS[Number(e.target.value) as Seat]}` : `${talentLabel(t)} off position`)}
                    className="rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1 py-[3px] text-[11.5px]">
                    <option value="">— none —</option>{SEATS.map(s => <option key={s} value={s}>{SEAT_LABELS[s]}{st.seats?.[s] && st.seats[s] !== t.id ? ' (swap)' : ''}</option>)}
                  </select>
                </td>
                <td className="whitespace-nowrap pr-2">
                  <button type="button" className="mr-1 underline" onClick={() => navigator.clipboard?.writeText(link(t.id, t.key))} title={link(t.id, t.key)}>Copy link</button>
                  <button type="button" className="mr-1 text-white/60 underline" onClick={() => navigator.clipboard?.writeText(vdoLink(t))} title="Their personal VDO.Ninja push link (for the VDO.Ninja option)">VDO link</button>
                  <Tiny title="New link (the old one stops working)" onClick={() => run({ c: 'talent-regen', id: t.id }, `New link for ${t.id}`)}>↻</Tiny>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ======================================================================= Control modules (scene sources)
function ModuleLayoutPanel({ st, src, run }: { st: ControllerState; src: SourceDef; run: Run }) {
  const cur = studioFor(st.studio, src.id);
  const save = (modules: ModuleId[], pinned: ModuleId[], l: string) => run({ c: 'studio-set', scene: src.id, modules, pinned }, l);
  const all = Object.keys(MODULES) as ModuleId[];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio={src.id}>
      <div className="flex h-8 flex-none items-center gap-3 border-b border-white/10 px-3 text-[11px]">
        <b className="uppercase tracking-[0.14em]">Control modules · {src.name}</b><span className="text-white/45">Choose, order and pin the modules shown for this scene source in Live mode. Saved on the server for every operator.</span>
        <button type="button" className="ml-auto underline" onClick={() => save(src.modules, [], 'Studio defaults')}>Reset to defaults</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-2">
        <div className="min-h-0 space-y-1 overflow-y-auto">
          {[...cur.modules, ...all.filter(m => !cur.modules.includes(m))].map(m => {
            const on = cur.modules.includes(m), i = cur.modules.indexOf(m), pin = cur.pinned.includes(m);
            return (
              <div key={m} data-studio-module={m} className={`flex items-center gap-2 rounded-[2px] border px-2 py-1 text-[12px] ${on ? 'border-white/20 bg-white/[0.04]' : 'border-white/[0.06] text-white/45'}`}>
                <Chip on={on} onClick={() => save(on ? cur.modules.filter(x => x !== m) : [...cur.modules, m], cur.pinned.filter(x => x !== m || on === false), `${MODULES[m].name} ${on ? 'removed' : 'added'}`)}>{on ? 'Shown' : 'Add'}</Chip>
                <b className="w-[170px]">{MODULES[m].name}</b><span className="flex-1 truncate text-white/45">{MODULES[m].about}</span>
                {on && <><Tiny disabled={i === 0} onClick={() => { const n = [...cur.modules]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n, cur.pinned, 'Module order'); }}>▲</Tiny>
                  <Tiny disabled={i === cur.modules.length - 1} onClick={() => { const n = [...cur.modules]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n, cur.pinned, 'Module order'); }}>▼</Tiny>
                  <Chip on={pin} onClick={() => save(cur.modules, pin ? cur.pinned.filter(x => x !== m) : [...cur.pinned, m], `${MODULES[m].name} ${pin ? 'unpinned' : 'pinned'}`)}>★ Pin</Chip></>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ======================================================================= Instances & OBS mapping
function InstancesPanel({ st, run, onSelect, sel }: { st: ControllerState; run: Run; onSelect: (id: string) => void; sel: string }) {
  const gs = st.graphics ?? [];
  const [names, setNames] = useState<Record<string, string>>({});
  const isDefault = (g: GfxInstance) => PACKAGES.some(p => p.id.replace(/^od\./, '') === g.id);
  const url = (g: GfxInstance) => `${location.origin}/g/${g.id}${st.outputKey ? `?key=${encodeURIComponent(st.outputKey)}` : ''}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-instances>
      <div className="flex h-[30px] flex-none items-center gap-2 border-b px-2.5 text-[11.5px]" style={{ borderColor: C.line }}>
        <span className="text-white/50">Each graphic is its own OBS Browser Source (1920×1080). Map it to the OBS scene that holds it: tallies and the explicit OBS switch use this.</span>
        <B h={22} onClick={() => navigator.clipboard?.writeText(gs.map(g => `${g.name}\t${url(g)}`).join('\n'))}>Copy all URLs</B>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className={`sticky top-0 bg-[#111113] text-left text-[11px] text-white/40 ${LABEL}`}><tr><th className="px-2 py-1">Graphic</th><th>Package</th><th>Browser source</th><th>Sources</th><th>OBS scene</th><th>State</th><th>Presets</th><th /></tr></thead>
          <tbody>
            {gs.map(g => {
              const p = pkgById(g.pkg), n = st.outputs.find(o => o.route === `g/${g.id}`)?.count ?? 0, guess = obsSceneOfGfx({ ...g, obsScene: null }, st);
              return (
                <tr key={g.id} data-instance={g.id} className="border-t border-white/[0.06]" style={{ background: sel === `g:${g.id}` ? 'rgba(42,109,244,.14)' : undefined }}>
                  <td className="px-2 py-[3px]"><input aria-label={`Name of ${g.id}`} value={names[g.id] ?? g.name} onChange={e => setNames(x => ({ ...x, [g.id]: e.target.value }))} onFocus={() => onSelect(g.id)}
                    onBlur={() => { const v = names[g.id]; if (v !== undefined && v.trim() && v !== g.name) run({ c: 'gfx-rename', id: g.id, name: v }, `Rename ${g.name}`); setNames(x => { const { [g.id]: _, ...r } = x; return r; }); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="h-[22px] w-[170px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5" /></td>
                  <td className="text-white/55">{p?.name}</td>
                  <td><button type="button" className="font-mono text-[11px] text-white/70 underline" title="Copy" onClick={() => navigator.clipboard?.writeText(url(g))}>/g/{g.id}</button></td>
                  <td className="font-mono text-[11px]" style={{ color: n ? PVW : 'rgba(255,255,255,.35)' }}>{n ? `● ${n}` : '○ 0'}</td>
                  <td>
                    <select aria-label={`OBS scene of ${g.id}`} value={g.obsScene ?? ''} onChange={e => run({ c: 'gfx-obs', id: g.id, scene: e.target.value || null }, `${g.name} → OBS ${e.target.value || 'auto'}`)} className="h-[22px] w-[190px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1 text-[11.5px]">
                      <option value="">Auto{guess ? ` (${guess})` : ' (not found)'}</option>
                      {[...new Set([...(g.obsScene ? [g.obsScene] : []), ...st.obs.scenes])].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {!st.obs.connected && <span className="ml-1 text-[10.5px] text-white/35">OBS offline</span>}
                  </td>
                  <td><VisBadge out={g.anim.action === 'out'} small /></td>
                  <td className="text-white/55">{g.presets.length || '—'}</td>
                  <td className="pr-2 text-right">{!isDefault(g) && <Tiny title="Delete this instance (its rundown items too)" onClick={() => { if (confirm(`Delete ${g.name}? Its OBS URL stops working.`)) run({ c: 'gfx-delete', id: g.id }, `Delete ${g.name}`); }}>✕</Tiny>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ======================================================================= Data bindings overview
function BindingsPanel({ st, wc }: { st: ControllerState; wc: Ctx['wc'] }) {
  const gs = st.graphics ?? [];
  const tal = (s: number) => { const t = (st.talent ?? []).find(p => p.id === st.seats?.[s as Seat]); return t ? `${talentLabel(t)}${t.publishing ? ' ●' : ''}` : '—'; };
  const m = wc.cast ? wcResolve(wc.matches, wc.teams)[wc.cast] : null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2.5 text-[12px]" data-bindings>
      <p className="mb-2 text-white/50">Shared data every graphic reads (it is not stored in the graphic): changing it updates every graphic that uses it. Edit it in the Inspector of any graphic, or in the Talent tab.</p>
      <table className="w-full">
        <thead className={`text-left text-[11px] text-white/40 ${LABEL}`}><tr><th className="py-1">Graphic</th><th>Binding</th><th>Current data</th></tr></thead>
        <tbody>
          {gs.flatMap(g => (pkgById(g.pkg)?.bindings ?? []).map((b, i) => (
            <tr key={`${g.id}-${i}`} className="border-t border-white/[0.06]">
              <td className="py-[3px] pr-2">{i === 0 ? <b>{g.name}</b> : ''}</td>
              <td className="pr-2 text-white/60">{b.label}</td>
              <td className="text-white/80">{b.kind === 'seats' ? b.seats.map(s => `${SEAT_LABELS[s as Seat]}: ${tal(s)}`).join(' · ')
                : b.kind === 'match' ? (m ? `${m.t1 || 'TBD'} vs ${m.t2 || 'TBD'} (${wc.cast})` : `${st.showLive.teamA.name || 'Team A'} vs ${st.showLive.teamB.name || 'Team B'}`)
                : b.kind === 'score' ? `${st.showLive.teamA.score} – ${st.showLive.teamB.score}`
                : b.kind === 'predictions' ? `${b.seats.filter(s => wc.intro.picks[String(s)]).length} of ${b.seats.length} positions predicted · badges ${wc.intro.picksShow ? 'on' : 'off'}`
                : `${Object.values(wc.matches).filter(x => x.s1 !== '' || x.s2 !== '').length} matches with results`}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

// ======================================================================= Assets
function AssetsPanel({ x }: { x: Ctx }) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" data-assets>
      <div className="min-h-0 w-[520px] flex-none overflow-y-auto border-r border-white/10 p-2.5 text-[12px]">
        <div className={`${LABEL} mb-1 text-[12.5px] text-white/80`}>Package assets</div>
        {PACKAGES.map(p => <div key={p.id} className="border-t border-white/[0.06] py-1"><b>{p.name}</b> <span className="text-white/40">v{p.version}</span><div className="font-mono text-[11px] text-white/50">{p.assets.join(' · ') || 'no files (rendered from data)'}</div></div>)}
        <p className="mt-2 text-white/40">Approved Overdrive Major frames, loops and stinger are part of the build (public/brand/overdrive) and are not edited here.</p>
      </div>
      <div className="flex min-h-0 flex-1"><ModuleView id="media" x={x} pinned={false} /></div>
    </div>
  );
}

// ======================================================================= Show file
function ShowFilePanel({ st, run }: { st: ControllerState; run: Run }) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const exportShow = () => {
    const data = {
      kind: 'overdrive-2.0-show', version: 2, exported: new Date().toISOString(), studio: st.studio ?? { scenes: {} },
      talent: (st.talent ?? []).map(({ id, name, role, mode }) => ({ id, name, role, mode })), seats: st.seats, showPreview: st.showPreview,
      media: st.media ? { playlist: st.media.playlist, auto: st.media.auto, loop: st.media.loop, volume: st.media.volume } : null,
      graphics: (st.graphics ?? []).map(({ id, pkg, name, config, presets, obsScene }) => ({ id, pkg, name, config, presets, obsScene })),
      rundown: st.rundown ?? null,
    };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'overdrive-show.json'; a.click();
  };
  const importShow = async (f: File) => {
    try {
      const d = JSON.parse(await f.text());
      if (d.kind !== 'overdrive-2.0-show') throw new Error('not an Overdrive 2.0 show file');
      let n = 0, fail = 0;
      const ok = (a: Ack) => (a.ok ? n++ : fail++);
      for (const [scene, v] of Object.entries((d.studio?.scenes ?? {}) as Record<string, { modules: string[]; pinned: string[] }>)) ok(await run({ c: 'studio-set', scene, modules: v.modules, pinned: v.pinned }, `Import layout ${scene}`));
      for (const t of d.talent ?? []) ok(await run({ c: 'talent-edit', id: t.id, name: t.name, role: t.role, mode: t.mode, ...(t.camQuality ? { camQuality: t.camQuality } : {}) }, `Import ${t.id}`));
      for (const [seat, id] of Object.entries(d.seats ?? {})) ok(await run({ c: 'seat', seat: Number(seat), talent: (id as string) || null }, `Import position ${seat}`));
      if (d.media?.playlist) { ok(await run({ c: 'media-set', playlist: d.media.playlist }, 'Import playlist')); ok(await run({ c: 'media-opts', auto: d.media.auto, loop: d.media.loop, volume: d.media.volume }, 'Import media options')); }
      // Graphics: configs come in as DRAFTS (review, then publish); missing extra instances are created.
      for (const g of (d.graphics ?? []) as { id: string; pkg: string; name: string; config: Record<string, string | number | boolean>; obsScene?: string | null }[]) {
        let id = g.id;
        if (!(st.graphics ?? []).some(x => x.id === g.id)) { const a = await run({ c: 'gfx-create', pkg: g.pkg, name: g.name }, `Import graphic ${g.name}`); ok(a); if (!a.ok) continue; id = (a.note ?? '').split('/g/')[1] ?? g.id; }
        ok(await run({ c: 'gfx-set', id, patch: g.config }, `Import ${g.name} (draft)`));
        if (g.obsScene) ok(await run({ c: 'gfx-obs', id, scene: g.obsScene }, `Import ${g.name} OBS scene`));
      }
      for (const it of (d.rundown?.items ?? []) as { gfx: string; label: string; preset: string | null }[]) ok(await run({ c: 'rd-add', gfx: it.gfx, label: it.label, preset: it.preset }, `Import rundown ${it.label}`));
      setMsg(`Imported: ${n} settings applied${fail ? `, ${fail} refused (see the log)` : ''}. Graphics configs are prepared as drafts: review and publish. Talent links stay as they are.`);
    } catch (e) { setMsg(`Import failed: ${(e as Error).message}`); }
  };
  return (
    <div className="space-y-2 p-3 text-[12px]" data-showfile>
      <p className="max-w-[760px] text-white/55">Export the prepared show (graphics configs, presets and OBS mapping, rundown, module layouts, talent names / roles / positions, playlist) and load it on another day or machine. Talent link keys and passwords are never exported. On import, graphics configs arrive as drafts so nothing changes on air until you publish.</p>
      <div className="flex gap-1"><Btn onClick={exportShow}>Export show…</Btn><Btn onClick={() => file.current?.click()}>Import show…</Btn></div>
      <input ref={file} type="file" accept="application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importShow(f); e.target.value = ''; }} />
      {msg && <div style={{ color: msg.startsWith('Import failed') ? WARN : PVW }}>{msg}</div>}
    </div>
  );
}

// ======================================================================= Studio shell
export type StudioTab = 'packages' | 'instances' | 'obs' | 'talent' | 'bindings' | 'modules' | 'assets' | 'show';
export const STUDIO_TABS: [StudioTab, string][] = [['packages', 'Packages'], ['instances', 'Instances & OBS'], ['obs', 'OBS Setup'], ['talent', 'Talent'], ['bindings', 'Data bindings'], ['modules', 'Control modules'], ['assets', 'Assets'], ['show', 'Show file']];

export function StudioMode({ st, run, tab, setTab, sel, onSelectGfx, srcForModules, setSrcForModules, x }: {
  st: ControllerState; run: Run; tab: StudioTab; setTab: (t: StudioTab) => void; sel: string; onSelectGfx: (id: string) => void;
  srcForModules: SourceDef; setSrcForModules: (id: string) => void; x: Ctx;
}) {
  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.panel }} data-studio-mode={tab}>
      <div className="flex h-[28px] flex-none items-stretch border-b" style={{ background: C.head, borderColor: C.line }}>
        <span className={`${LABEL} flex items-center px-2.5 text-[13px] text-white/85`}>Studio</span>
        {STUDIO_TABS.map(([k, l]) => (
          <button key={k} type="button" data-studio-tab={k} onClick={() => setTab(k)} className={`${LABEL} px-3 text-[12px] ${tab === k ? 'bg-white/[0.09] text-white shadow-[inset_0_-2px_0_#ff3b1f]' : 'text-white/45 hover:text-white/80'}`}>{l}</button>
        ))}
        {tab === 'modules' && (
          <select aria-label="Scene source" value={srcForModules.id} onChange={e => setSrcForModules(e.target.value)} className="my-[3px] ml-auto mr-2 rounded-[2px] border border-white/15 bg-black px-1 text-[11.5px]">
            {REGISTRY.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'packages' && <PackageLibrary st={st} run={run} onSelect={onSelectGfx} />}
        {tab === 'instances' && <InstancesPanel st={st} run={run} onSelect={onSelectGfx} sel={sel} />}
        {tab === 'obs' && <ObsSetupPanel st={st} run={run} />}
        {tab === 'talent' && <TalentDashboard st={st} run={run} />}
        {tab === 'bindings' && <BindingsPanel st={st} wc={x.wc} />}
        {tab === 'modules' && <ModuleLayoutPanel st={st} src={srcForModules} run={run} />}
        {tab === 'assets' && <AssetsPanel x={x} />}
        {tab === 'show' && <ShowFilePanel st={st} run={run} />}
      </div>
    </div>
  );
}
export { Chip, Seg, SEATS, studioFor };

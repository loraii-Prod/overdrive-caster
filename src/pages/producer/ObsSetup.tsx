/**
 * Studio Mode → OBS Setup: the OBS Scene Builder.
 * One OBS scene per Overdrive output, each with its own full-canvas browser source (output profile: 4K or 1080p). Every button is an
 * acknowledged engine command; Build / Repair always show the server's dry-run plan first and change OBS
 * only after Confirm. Nothing here switches the OBS Program or Preview scene.
 */
import { OUTPUT_PROFILES, profileOf, type OutputProfileId } from '../../../shared/layout';
import { usePerfReport } from '../../lib/perfStore';
import { useEffect, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { ProducerCmd } from '../../../shared/engine';
import type { AuditReport, CleanupReport, ObsPlan, TargetReport, TargetStatus, ValidationReport } from '../../../shared/obsSetup';
import { FOLLOW, controllerPath, dockEntries, dockInstallerPs1, dockInstallerSh, type DockEntry } from '../../../shared/obsDocks';
import { MAIN_SCENE_DEFS } from '../../../shared/mainScenes';
import type { Ack } from './modules';
import { B, C, LABEL } from './ws';

type Run = (c: ProducerCmd, l: string) => Promise<Ack>;

const STATUS: Record<TargetStatus, { label: string; color: string; hint: string }> = {
  ok: { label: 'OK', color: C.ok, hint: 'Scene and browser source are correct' },
  missing: { label: 'MISSING', color: 'rgba(233,233,236,.45)', hint: 'No OBS scene yet: Build creates it' },
  incomplete: { label: 'INCOMPLETE', color: C.draft, hint: 'The scene exists but its browser source (or part of its composition) is missing: Build adds it' },
  outdated: { label: 'NEEDS REPAIR', color: C.draft, hint: 'Wrong URL, size, transform, visibility or order: Repair fixes it' },
  conflict: { label: 'CONFLICT', color: C.in, hint: 'A name is taken by something that is not Overdrive\'s: it is never overwritten' },
  error: { label: 'ERROR', color: C.in, hint: 'OBS returned an error for this scene' },
  unknown: { label: 'ORPHAN', color: 'rgba(233,233,236,.45)', hint: 'Mapped earlier, no longer in Overdrive (kept in OBS)' },
};
const KIND: Record<TargetReport['kind'], string> = { gfx: 'GRAPHIC', screen: 'SCREEN', source: 'SOURCE', support: 'AUDIO', preview: 'PREVIEW' };
const OP_LABEL: Record<string, string> = { 'create-scene': 'New scene', 'create-input': 'New source', 'add-item': 'Add to scene', 'set-settings': 'Repair source', transform: 'Fit canvas', enable: 'Show', order: 'Order', 'nest-audio': 'Audio', 'add-capture': 'Capture', mark: 'Mark' };

function Status({ s }: { s: TargetStatus }) {
  const v = STATUS[s];
  return <span title={v.hint} data-status={s} className="inline-flex h-[16px] items-center rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10.5px] font-bold tracking-[0.06em]" style={{ color: v.color, border: `1px solid ${v.color}` }}>{v.label}</span>;
}

const HINT: Record<string, string | undefined> = {
  suspendOffAir: 'Overdrive pages that OBS is not showing (not in Program, Preview or a projector) pause their videos and loops after 3 s, and resume the moment OBS shows them. Nothing is unloaded, so cuts and transitions are unchanged. Media playback and camera feeds never pause.',
  perfMonitor: 'Every output reports its frame rate, slow frames and dropped video frames; OBS reports render and encoder stats. Leave off during shows unless you are measuring.',
};

/** Live performance table (OBS Setup → Performance monitor). */
function PerfPanel() {
  const r = usePerfReport();
  if (!r || (!r.on && !r.suspendOffAir)) return null;
  const o = r.obs;
  const bad = (x: boolean) => (x ? { color: '#ffb3b5' } : undefined);
  return (
    <div className="flex-none border-b px-2.5 py-1.5 text-[11.5px]" style={{ borderColor: C.line }} data-perf-panel>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-white/70">
        <b className="text-white/85">Performance</b>
        {o ? <>
          <span style={bad(o.fps < 59)}>OBS {o.fps} fps</span>
          <span style={bad(o.renderMs > 12)}>render {o.renderMs} ms/frame</span>
          <span style={bad(o.renderSkipped > 0)}>render lag {o.renderSkipped}/{o.renderTotal} frames</span>
          <span style={bad(o.outputSkipped > 0)}>encoder skipped {o.outputSkipped}/{o.outputTotal}</span>
          <span>CPU {o.cpu}% · {o.memMB} MB</span>
        </> : <span className="text-white/45">{r.on ? 'OBS stats appear when OBS is connected.' : 'Monitor off.'}</span>}
        <span className="text-white/45">{r.suspendOffAir ? `off-air pausing on · ${Object.values(r.showing).filter(Boolean).length}/${Object.keys(r.showing).length} pages showing in OBS` : 'off-air pausing off'}</span>
      </div>
      {r.on && r.outputs.length > 0 && (
        <table className="w-full text-left tabular-nums" data-perf-table>
          <thead className="text-white/45"><tr><th className="font-normal">Page</th><th className="font-normal">Size</th><th className="font-normal">State</th><th className="font-normal">fps</th><th className="font-normal">p95 ms</th><th className="font-normal">slow frames</th><th className="font-normal">video drops</th><th className="font-normal">fonts</th></tr></thead>
          <tbody>{r.outputs.map(p => (
            <tr key={p.id} className="text-white/80">
              <td className="font-mono">{p.route}</td>
              <td>{p.w}×{p.h} ·{p.scale}× {p.raster}</td>
              <td>{p.suspended ? 'paused (off air)' : r.showing[p.route] ? 'showing' : r.showing[p.route] === false ? 'off air' : 'not in OBS'}</td>
              <td style={bad(!p.suspended && p.fps > 0 && p.fps < 55)}>{p.suspended ? '—' : p.fps}</td>
              <td style={bad(!p.suspended && p.p95 > 20)}>{p.suspended ? '—' : p.p95}</td>
              <td style={bad(p.long > 2)}>{p.long}</td>
              <td style={bad(p.dropped > 0)}>{p.dropped}/{p.decoded}</td>
              <td style={bad(!p.fontsReady)}>{p.fontsReady ? 'ok' : 'loading'}</td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}

export function ObsSetupPanel({ st, run }: { st: ControllerState; run: Run }) {
  const o = st.obs, s = st.obsSetup;
  const [sel, setSel] = useState<string>('');
  const [base, setBase] = useState<string | null>(null);
  const [allowLive, setAllowLive] = useState(false);
  const [docksOpen, setDocksOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const [cleanOpen, setCleanOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const dockUrl = (id: string) => `${s?.baseUrl ?? location.origin}${controllerPath(id)}`;
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text); setCopied(what); setTimeout(() => setCopied(c => (c === what ? '' : c)), 1800); };
  /** Opens the controller in this browser (1920×1480 window, scaled); OBS docks use the URL OBS can reach. */
  const openController = (id: string) => window.open(controllerPath(id), `od-ctrl-${id}`, 'width=1280,height=987');
  const busy = !!s?.busy;
  const rows = s?.targets ?? [];
  const cur = rows.find(r => r.id === sel);
  const canAct = o.connected && !busy;
  useEffect(() => { if (o.connected && s && !s.scannedAt && !s.busy) void run({ c: 'obs-setup', action: 'scan' }, 'Scan OBS'); }, [o.connected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!s?.plan) setAllowLive(false); }, [s?.plan?.hash]);
  const preview = (mode: 'build' | 'repair', targets: string[] | 'all', label: string) => run({ c: 'obs-setup', action: 'preview', mode, targets }, label);
  const opt = (options: Record<string, unknown>, label: string) => run({ c: 'obs-setup', action: 'options', options }, label);
  const inAll = rows.filter(r => r.inAll);
  const counts = inAll.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});

  return (
    <div className="relative flex min-h-0 flex-1 flex-col text-[12px]" data-obs-setup>
      {/* ---- connection + actions */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b px-2.5 py-1.5" style={{ borderColor: C.line }}>
        <span data-obs-conn={o.connected ? 'on' : 'off'} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: o.connected ? C.ok : o.enabled ? C.in : 'rgba(255,255,255,.25)' }} />
          <b>{o.connected ? 'OBS connected' : o.enabled ? 'OBS not connected' : 'OBS not set up'}</b>
        </span>
        {s?.version && <span className="text-white/45" data-obs-version>OBS {s.version.obs} · WebSocket {s.version.ws}{s.canvas ? ` · canvas ${s.canvas.w}×${s.canvas.h}` : ''}</span>}
        {s?.version?.missing.length ? <span style={{ color: C.in }}>This OBS lacks: {s.version.missing.join(', ')}</span> : null}
        {!o.connected && o.error && <span className="truncate" style={{ color: C.in }}>{o.error}</span>}
        {!o.enabled && <span className="text-white/45">Connect OBS in the Controller → OBS panel (Tools → WebSocket Server Settings in OBS).</span>}
        {o.connected && o.currentScene && <span className="text-white/45">Program: <b className="text-white/80">{o.currentScene}</b>{o.studioMode ? ` · Studio Mode, Preview: ${o.previewScene ?? '—'}` : ''}</span>}
        <span className="ml-auto flex items-center gap-1">
          <B h={22} disabled={!canAct} data-act="scan" onClick={() => run({ c: 'obs-setup', action: 'scan' }, 'Scan OBS')}>Scan OBS</B>
          <B h={22} disabled={!canAct} data-act="verify" onClick={() => run({ c: 'obs-setup', action: 'verify' }, 'Verify all scenes')}>Verify OBS Setup</B>
          <B h={22} disabled={!canAct} data-act="repair-all" title="Repair every Overdrive-managed scene (URL, size, transform, visibility, order)" onClick={() => preview('repair', 'all', 'Preview: repair all')}>Repair All</B>
          <span className="mx-1 h-4 w-px bg-white/15" />
          <B h={22} disabled={!canAct || !cur || cur.kind === 'support' || cur.status === 'unknown'} data-act="build-selected" title={cur ? `Create what is missing for ${cur.name}` : 'Select a scene in the list'} onClick={() => cur && preview('build', [cur.id], `Preview: build ${cur.name}`)}>Build Individual OBS Scene</B>
          <B h={22} disabled={!canAct || !cur || cur.kind === 'support' || cur.status === 'unknown' || cur.status === 'missing'} data-act="repair-selected" title={cur ? `Repair ${cur.name} (URL, size, transform, visibility, order)` : 'Select a scene in the list'} onClick={() => cur && preview('repair', [cur.id], `Preview: repair ${cur.name}`)}>Repair OBS Scene</B>
          <B h={22} disabled={!cur || cur.kind === 'support' || cur.status === 'unknown'} data-act="open-controller" title={cur ? `Open the 1920×1480 controller of ${cur.name}` : 'Select a scene in the list'} onClick={() => cur && openController(cur.id)}>Open Individual Controller</B>
          <B h={22} disabled={!cur || cur.kind === 'support' || cur.status === 'unknown'} data-act="copy-dock" title={cur ? dockUrl(cur.id) : 'Select a scene in the list'} onClick={() => cur && copy(dockUrl(cur.id), cur.id)}>{cur && copied === cur.id ? 'Copied ✓' : 'Copy Controller Dock URL'}</B>
          <B h={22} data-act="sources" title="All nine main-scene browser sources in one place: URL, resolution, OBS scene, status, on-air, preview" onClick={() => setSourcesOpen(true)}>Browser Sources…</B>
          <B h={22} data-act="docks" title="All controller docks + how to add them to OBS" onClick={() => setDocksOpen(true)}>OBS Docks…</B>
          <B h={22} disabled={!canAct} data-act="audit" title="Checks EVERY browser source in OBS (not just the ones mapped here) for duplicates — two sources pointing at the same Overdrive page, mic or camera. Read-only." onClick={() => { setAuditOpen(true); void run({ c: 'obs-setup', action: 'audit' }, 'Audit OBS for duplicate sources'); }}>Audit OBS…</B>
          <B h={22} data-act="validate" title="Pre-event checklist: what Overdrive can confirm on its own, and what only a human checking real OBS picture and sound can confirm." onClick={() => setValidateOpen(true)}>Validate…</B>
          <span className="mx-1 h-4 w-px bg-white/15" />
          <B h={22} kind="primary" disabled={!canAct} data-act="build-all" title="Create every missing scene and browser source (existing sources are not changed)" onClick={() => preview('build', 'all', 'Preview: build all')}>Build All OBS Scenes</B>
        </span>
      </div>
      {/* ---- where OBS loads Overdrive from + composition options */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b px-2.5 py-1" style={{ borderColor: C.line }}>
        <label className="flex items-center gap-1.5">
          <span className={`${LABEL} text-[11px] text-white/45`}>OBS loads Overdrive from</span>
          <input aria-label="Base URL" data-base-url value={base ?? s?.options.baseUrl ?? ''} placeholder={s?.baseUrl ?? 'automatic'} onChange={e => setBase(e.target.value)}
            onBlur={() => { if (base !== null && base !== s?.options.baseUrl) void opt({ baseUrl: base }, 'Base URL'); setBase(null); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="h-[22px] w-[230px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5 font-mono text-[11px]" />
        </label>
        <span className="text-white/40" title={s?.baseReason}>{s?.options.baseUrl ? 'set by you' : `auto: ${s?.baseUrl ?? '…'}`} · {s?.baseReason}</span>
        <label className="flex items-center gap-1 text-white/70" title="Nine main scenes: Starting Soon, Gameplay, Caster Desk, Analyst Desk, MVP, Intermission, Ending, Safe / BRB, Team Introduction; every other graphic is a layer (scene item) inside one of them, switched from Producer Mode. One scene per output is the 3.1 layout.">
          OBS layout
          <select data-opt="layout" aria-label="OBS layout" disabled={busy} value={s?.options.layout ?? 'main'} onChange={e => opt({ layout: e.target.value }, 'OBS layout')}
            className="h-[22px] rounded border border-white/15 bg-[#1b1b1d] px-1 text-[12px] text-white">
            <option value="main">Nine main scenes (recommended)</option>
            <option value="per-output">One scene per output (3.1)</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-white/70" title="Size of every picture browser source Overdrive builds, and the OBS canvas it expects. Graphics are rendered natively at this size. Change OBS → Settings → Video to match, then Repair the scenes.">
          Output
          <select data-opt="profile" aria-label="Output resolution profile" disabled={busy} value={s?.options.profile ?? 'fhd'} onChange={e => opt({ profile: e.target.value as OutputProfileId }, 'Output profile')}
            className="h-[22px] rounded border border-white/15 bg-[#1b1b1d] px-1 text-[12px] text-white">
            {Object.values(OUTPUT_PROFILES).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-3">
          {([['suspendOffAir', 'Pause off-air sources'], ['perfMonitor', 'Performance monitor'], ['audio', 'Talent audio (nested) in every scene'], ['gameCapture', 'Game capture under gameplay'], ['legacy', 'Build All includes legacy duplicates']] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-1 text-white/70" title={HINT[k]}><input type="checkbox" data-opt={k} checked={!!s?.options[k]} disabled={busy} onChange={e => opt({ [k]: e.target.checked }, l)} />{l}</label>
          ))}
        </span>
      </div>
      <PerfPanel />
      {s?.options.layout === 'main' && <MainOverview st={st} onCleanup={() => { setCleanOpen(true); void run({ c: 'obs-setup', action: 'cleanup-scan' }, 'Cleanup report (dry run)'); }} canAct={canAct} />}
      {(s?.controllerLeaks.length ?? 0) > 0 && (
        <div className="flex-none border-b px-2.5 py-1 text-[12px]" style={{ borderColor: C.line, background: 'rgba(229,72,77,.14)', color: '#ffb3b5' }} data-controller-leak>
          <b>On-air risk:</b> {s!.controllerLeaks.map(l => `“${l.input}”`).join(', ')} load{s!.controllerLeaks.length === 1 ? 's' : ''} an Overdrive controller page as an OBS browser source. Controllers belong in Docks, never in a scene: remove {s!.controllerLeaks.length === 1 ? 'it' : 'them'} in OBS (Overdrive never deletes OBS sources).
        </div>
      )}
      {(s?.quality?.length ?? 0) > 0 && (
        <details className="flex-none border-b px-2.5 py-1 text-[12px]" style={{ borderColor: C.line, background: 'rgba(240,180,60,.10)', color: '#ffd89a' }} data-quality>
          <summary className="cursor-pointer"><b>Picture quality:</b> {s!.quality.length} thing{s!.quality.length === 1 ? '' : 's'} make{s!.quality.length === 1 ? 's' : ''} OBS resize an Overdrive picture (soft text and logos). Overdrive only reports these; it changes nothing outside its own scenes.</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {s!.quality.map((q, i) => <li key={i} data-quality-item><b>{q.where}</b>: {q.issue}. <span className="text-white/60">{q.fix}</span></li>)}
          </ul>
        </details>
      )}
      {/* ---- per scene */}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full table-fixed">
            <colgroup><col style={{ width: 96 }} /><col style={{ width: '34%' }} /><col style={{ width: '24%' }} /><col /><col style={{ width: 196 }} /></colgroup>
            <thead className={`sticky top-0 z-[1] bg-[#111113] text-left text-[11px] text-white/40 ${LABEL}`}>
              <tr><th className="px-2 py-1">Status</th><th>Overdrive output</th><th>OBS scene</th><th>Notes</th><th className="pr-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={5} className="px-2 py-3 text-white/45">{o.connected ? (busy ? 'Scanning OBS…' : 'Scan OBS to see every scene.') : 'Connect OBS to scan, build and verify scenes.'}</td></tr>}
              {rows.map(r => {
                const last = s?.results[r.id];
                return (
                  <tr key={r.id} data-target={r.id} data-target-status={r.status} onClick={() => setSel(r.id)} className="cursor-pointer border-t border-white/[0.06] hover:bg-white/[0.03]"
                    style={{ background: sel === r.id ? 'rgba(42,109,244,.16)' : undefined, opacity: r.inAll || sel === r.id ? 1 : 0.6 }}>
                    <td className="px-2 py-[3px]"><Status s={r.status} /></td>
                    <td className="py-[3px] pr-2">
                      <div className="flex min-w-0 items-baseline whitespace-nowrap" title={r.url}>
                        <span className="mr-1.5 w-[44px] flex-none font-['Barlow_Condensed'] text-[10px] font-bold tracking-[0.08em] text-white/30">{r.id.startsWith('main:') ? 'SCENE' : r.role && r.role !== 'base' ? r.role.toUpperCase() : KIND[r.kind]}</span>
                        <b className="min-w-0 truncate text-white/90">{r.name}</b>
                        <span className="ml-1.5 min-w-0 flex-1 truncate font-mono text-[10.5px] text-white/35">{shortUrl(r.url)}</span>
                      </div>
                    </td>
                    <td className="pr-2">
                      <div className="flex min-w-0 items-center whitespace-nowrap" title={r.scene}>
                        <span className="min-w-0 truncate text-white/80">{r.scene}</span>
                        {r.onAir && <span className="ml-1 flex-none rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10px] font-bold text-white" style={{ background: C.pgm }}>PGM</span>}
                      </div>
                    </td>
                    <td className="truncate whitespace-nowrap pr-2 text-white/50" title={[...r.issues, ...(r.unmanaged.length ? [`Not managed by Overdrive (kept): ${r.unmanaged.join(', ')}`] : [])].join('\n')}>
                      {r.supersededBy && <span className="mr-1 text-white/40">legacy duplicate of {rows.find(x => x.id === r.supersededBy)?.name ?? r.supersededBy}{r.inAll ? '' : ' · not in Build All'} ·</span>}
                      {r.issues[0] ?? (last ? `${last.ok ? 'Built' : 'Failed'} ${new Date(last.at).toLocaleTimeString()}` : '')}{r.issues.length > 1 ? ` (+${r.issues.length - 1})` : ''}
                    </td>
                    <td className="pr-2 text-right" onClick={e => e.stopPropagation()}>
                      <span className="inline-flex gap-1">
                        <B h={20} disabled={!canAct || r.kind === 'support' || r.status === 'unknown'} data-row-build={r.id} onClick={() => { setSel(r.id); void preview('build', [r.id], `Preview: build ${r.name}`); }}>Build</B>
                        <B h={20} disabled={!canAct || r.kind === 'support' || r.status === 'unknown' || r.status === 'missing'} data-row-repair={r.id} onClick={() => { setSel(r.id); void preview('repair', [r.id], `Preview: repair ${r.name}`); }}>Repair</B>
                        <B h={20} disabled={r.kind === 'support' || r.status === 'unknown'} data-row-controller={r.id} title="Open this scene's controller" onClick={() => openController(r.id)}>Ctrl ↗</B>
                        <B h={20} disabled={r.kind === 'support' || r.status === 'unknown'} data-row-dock={r.id} title={`Copy dock URL: ${dockUrl(r.id)}`} onClick={() => copy(dockUrl(r.id), r.id)}>{copied === r.id ? '✓' : 'Dock'}</B>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* ---- selected scene */}
        <div className="flex w-[300px] flex-none flex-col border-l" style={{ borderColor: C.line }} data-obs-detail>
          <div className="flex h-[28px] flex-none items-center gap-1 border-b px-2" style={{ background: C.head, borderColor: C.line }}>
            <span className={`${LABEL} min-w-0 flex-1 truncate text-[12.5px] text-white/85`}>{cur ? cur.name : 'Selected'}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[11.5px] leading-[1.45]">
            {!cur && <p className="text-white/45">Click a scene to see its details. Each Overdrive output has its own OBS scene and its own browser source; build or repair them one at a time or all together.</p>}
            {cur && <>
              <p className="mb-1"><Status s={cur.status} /> <span className="text-white/50">{STATUS[cur.status].hint}</span></p>
              <Row k="OBS scene" v={cur.scene} />
              <Row k="Browser source" v={cur.input} />
              {cur.url && <Row k="URL" v={cur.url} mono />}
              {cur.kind !== 'support' && <Row k="Size" v={`${profileOf(s?.options.profile).w}×${profileOf(s?.options.profile).h}, full canvas (${profileOf(s?.options.profile).label}; designed on the 1920×1080 grid)`} />}
              {s?.map[cur.id] && <Row k="Mapping" v={`scene ${s.map[cur.id].sceneUuid?.slice(-8) ?? '—'} · source ${s.map[cur.id].inputUuid?.slice(-8) ?? '—'} · item ${s.map[cur.id].itemId ?? '—'}`} mono />}
              {cur.issues.length > 0 && <Section t="To fix">{cur.issues.map((x, i) => <li key={i}>{x}</li>)}</Section>}
              {cur.unmanaged.length > 0 && <Section t="Not managed by Overdrive (kept as is)">{cur.unmanaged.map((x, i) => <li key={i}>{x}</li>)}</Section>}
              {s?.results[cur.id] && <Section t={`Last ${s.results[cur.id].ok ? 'build' : 'attempt'} · ${new Date(s.results[cur.id].at).toLocaleString()}`}>{s.results[cur.id].lines.map((x, i) => <li key={i} style={{ color: x.startsWith('Failed') ? C.in : undefined }}>{x}</li>)}</Section>}
            </>}
            {s?.lastRun && <p className="mt-2 border-t pt-1.5 text-white/55" style={{ borderColor: C.line }} data-last-run>Last run: <b style={{ color: s.lastRun.ok ? C.ok : C.draft }}>{s.lastRun.summary}</b> · {new Date(s.lastRun.at).toLocaleTimeString()}</p>}
          </div>
        </div>
      </div>
      <div className="flex h-[24px] flex-none items-center gap-3 border-t px-2.5 text-[11px] text-white/45" style={{ borderColor: C.line }}>
        <span>{inAll.length} {s?.options.layout === 'main' ? 'items' : 'scenes'} in Build All</span>
        {Object.entries(counts).map(([k, n]) => <span key={k}><Status s={k as TargetStatus} /> {n}</span>)}
        <span className="ml-auto">Overdrive never switches OBS here: OBS stays the switcher.{s?.busy ? ` · Working: ${s.busy}…` : ''}</span>
      </div>
      {sourcesOpen && <BrowserSourcesDialog rows={rows} profile={s?.options.profile} copied={copied} copy={copy} onOpen={openController}
        onBuild={id => preview('build', [id], `Preview: build ${rows.find(r => r.id === id)?.name ?? id}`)}
        onRepair={id => preview('repair', [id], `Preview: repair ${rows.find(r => r.id === id)?.name ?? id}`)}
        canAct={canAct} onOpenDocks={() => { setSourcesOpen(false); setDocksOpen(true); }} onOpenAudit={() => { setSourcesOpen(false); setAuditOpen(true); void run({ c: 'obs-setup', action: 'audit' }, 'Audit OBS for duplicate sources'); }}
        onClose={() => setSourcesOpen(false)} />}
      {docksOpen && <DocksDialog docks={dockEntries(s?.baseUrl ?? location.origin, rows)} base={s?.baseUrl ?? location.origin} copied={copied} copy={copy} onOpen={openController} onClose={() => setDocksOpen(false)} />}
      {cleanOpen && <CleanupDialog report={s?.cleanup ?? null} busy={busy} onClose={() => setCleanOpen(false)}
        onRescan={() => run({ c: 'obs-setup', action: 'cleanup-scan' }, 'Cleanup report (dry run)')}
        onApply={(remove, unnest, confirm, drop, nestAudio) => run({ c: 'obs-setup', action: 'cleanup-apply', hash: s!.cleanup!.hash, remove, unnest, confirm, drop, nestAudio }, 'Cleanup (confirmed)')} />}
      {auditOpen && <AuditDialog report={s?.audit ?? null} busy={busy} onClose={() => setAuditOpen(false)} onRescan={() => run({ c: 'obs-setup', action: 'audit' }, 'Audit OBS for duplicate sources')} />}
      {validateOpen && <ValidationDialog report={s?.validation ?? null} busy={busy} onClose={() => setValidateOpen(false)}
        onSet={(id, checked) => run({ c: 'obs-setup', action: 'validation-set', id, checked }, checked ? 'Confirm validation item' : 'Clear validation confirmation')}
        onNewSession={() => run({ c: 'obs-setup', action: 'validation-new-session' }, 'Start new pre-event check')} />}
      {s?.plan && <PlanDialog plan={s.plan} rows={rows} busy={busy} allowLive={allowLive} setAllowLive={setAllowLive}
        onCancel={() => run({ c: 'obs-setup', action: 'cancel' }, 'Cancel')}
        onConfirm={() => run({ c: 'obs-setup', action: 'apply', hash: s.plan!.hash, allowLive }, s.plan!.mode === 'build' ? 'Build in OBS' : 'Repair in OBS')} />}
    </div>
  );
}

function shortUrl(u: string) {
  try { const x = new URL(u); return x.pathname + x.search.replace(/([?&])key=[^&]*/, '$1key=…'); } catch { return u; }
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex gap-2"><span className="w-[92px] flex-none text-white/40">{k}</span><span className={`min-w-0 break-all text-white/85 ${mono ? 'font-mono text-[10.5px]' : ''}`}>{v}</span></div>;
}
function Section({ t, children }: { t: string; children: React.ReactNode }) {
  return <div className="mt-2"><div className={`${LABEL} mb-0.5 text-[10.5px] text-white/40`}>{t}</div><ul className="list-disc pl-4 text-white/75">{children}</ul></div>;
}

/** The server's dry-run plan: every change listed by scene, confirmed before anything is sent to OBS. */
function PlanDialog({ plan, rows, busy, allowLive, setAllowLive, onCancel, onConfirm }: { plan: ObsPlan; rows: TargetReport[]; busy: boolean; allowLive: boolean; setAllowLive: (v: boolean) => void; onCancel: () => void; onConfirm: () => void }) {
  const byScene = new Map<string, typeof plan.ops>();
  for (const op of plan.ops) byScene.set(op.scene, [...(byScene.get(op.scene) ?? []), op]);
  const live = plan.ops.filter(o => o.onAir);
  const existing = new Set(plan.ops.filter(o => o.existing).map(o => o.scene));
  const name = (id: string) => rows.find(r => r.id === id)?.name ?? id;
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/60 pt-6" data-obs-plan={plan.hash}>
      <div className="flex max-h-[92%] w-[760px] flex-col rounded-[3px] border border-white/15 shadow-2xl" style={{ background: C.panel }}>
        <div className="flex h-[30px] flex-none items-center gap-2 border-b px-3" style={{ background: C.head, borderColor: C.line }}>
          <b className={`${LABEL} text-[13px]`}>{plan.mode === 'build' ? 'Build in OBS' : 'Repair in OBS'} · preview</b>
          <span className="text-[11px] text-white/45">{plan.targets.length} scene{plan.targets.length === 1 ? '' : 's'} · {plan.ops.length} change{plan.ops.length === 1 ? '' : 's'} · nothing has been changed yet</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          {!plan.ops.length && !plan.blocked.length && <p className="text-white/60" data-plan-empty>Everything is already correct: there is nothing to change.</p>}
          {plan.blocked.length > 0 && (
            <div className="mb-2 rounded-[2px] border p-2" style={{ borderColor: 'rgba(229,72,77,.5)' }}>
              <b style={{ color: C.in }}>Will be skipped (never overwritten):</b>
              <ul className="list-disc pl-4 text-white/75">{plan.blocked.map(b => <li key={b.target}><b>{name(b.target)}</b>: {b.reason}</li>)}</ul>
            </div>
          )}
          {existing.size > 0 && <p className="mb-2" style={{ color: C.draft }}>Changes {existing.size} existing OBS scene{existing.size === 1 ? '' : 's'} ({[...existing].join(', ')}). Items you added by hand are kept.</p>}
          {[...byScene].map(([scene, ops]) => (
            <div key={scene} className="mb-2">
              <div className="font-semibold text-white/90">{scene}{ops.some(o => o.onAir) && <span className="ml-1.5 rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10px] font-bold text-white" style={{ background: C.pgm }}>ON AIR</span>}{!ops.some(o => o.existing) && <span className="ml-1.5 text-[11px] text-white/40">new scene</span>}</div>
              <ul className="pl-1">{ops.map((o, i) => <li key={i} className="flex gap-2"><span className="w-[86px] flex-none font-['Barlow_Condensed'] text-[11px] font-bold uppercase tracking-[0.06em] text-white/40">{OP_LABEL[o.kind] ?? o.kind}</span><span className="min-w-0 break-all text-white/75">{o.detail}</span></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="flex flex-none items-center gap-2 border-t px-3 py-2" style={{ borderColor: C.line }}>
          {live.length > 0 && <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.in }}><input type="checkbox" data-allow-live checked={allowLive} onChange={e => setAllowLive(e.target.checked)} />Also change the scene that is ON AIR ({live.length}) — otherwise those changes are held</label>}
          <span className="ml-auto flex gap-1.5">
            <B h={24} onClick={onCancel} disabled={busy} data-plan-cancel="1">Cancel</B>
            <B h={24} kind="primary" onClick={onConfirm} disabled={busy || (!plan.ops.length && !plan.blocked.length)} data-plan-confirm="1">{busy ? 'Working…' : plan.mode === 'build' ? 'Confirm: build' : 'Confirm: repair'}</B>
          </span>
        </div>
      </div>
    </div>
  );
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text.replace(/\r?\n/g, name.endsWith('.ps1') ? '\r\n' : '\n')], { type: 'text/plain' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Controller docks: OBS cannot create Custom Browser Docks through obs-websocket, so they are added by hand in OBS
 * or installed into OBS's settings (OBS closed) with a generated script. Nothing here claims OBS was changed.
 */
/**
 * 3.9 · Browser Sources: every main-scene broadcast browser source in one place — name, URL, resolution, OBS
 * scene, connection/status, on-air, a compact preview, and a button to its individual Studio controls (the
 * dock controller, opened in-browser here; still a different thing from an OBS Custom Browser Dock — see
 * "OBS Docks…" for that). Reuses the exact rows/status/build/repair the per-scene table already computes;
 * adds no OBS scene or source of its own — it is a read/manage view over the existing registry.
 * "Show Screens" is one category with three real underlying OBS scenes (Starting Soon, Intermission, Thanks
 * for Watching); "Be Right Back" shares Intermission's browser source (see OBS Docks… for that nuance), so it
 * has no separate row of its own here.
 */
const SOURCE_GROUPS: { id: string; label: string; mains: string[] }[] = MAIN_SCENE_DEFS.map(m => ({ id: m.id, label: m.label, mains: m.id === 'show' ? ['starting', 'intermission', 'ending'] : [m.id] }));
/** Show Screens' three real OBS scenes, labeled the way the Producer's own mode switcher labels them (not the
 * raw registry source name) — "intermission" is the mode the switcher calls "Intermission"; "Be Right Back"
 * is a different mode that shares this same browser source (see the note under the table). */
const SHOW_SCREEN_SUBLABEL: Record<string, string> = { starting: 'Starting Soon', intermission: 'Intermission', ending: 'Thanks for Watching' };

function BrowserSourcesDialog({ rows, profile, copied, copy, onOpen, onBuild, onRepair, canAct, onOpenDocks, onOpenAudit, onClose }: {
  rows: TargetReport[]; profile?: OutputProfileId; copied: string; copy: (t: string, w: string) => void; onOpen: (id: string) => void;
  onBuild: (id: string) => void; onRepair: (id: string) => void; canAct: boolean; onOpenDocks: () => void; onOpenAudit: () => void; onClose: () => void;
}) {
  const [showPreviews, setShowPreviews] = useState(false);
  const p = profileOf(profile);
  const items: { group: string; row: TargetReport | null }[] = SOURCE_GROUPS.flatMap(g => {
    // Each main scene's actual broadcast browser source: a real g:/s: target (never the 'main:<key>' scene
    // marker or a 'support' row like a camera composition), preferring whichever one isn't a legacy duplicate.
    const found = g.mains.map(mk => {
      const cands = rows.filter(r => r.main === mk && r.role === 'base' && r.kind !== 'support');
      return cands.find(r => !r.supersededBy) ?? cands[0];
    }).filter((r): r is TargetReport => !!r);
    const withRows: { group: string; row: TargetReport | null }[] = found.length ? found.map(r => ({ group: g.label, row: r })) : [{ group: g.label, row: null }];
    return withRows;
  });
  const withUrl = items.filter((it): it is { group: string; row: TargetReport } => !!it.row);
  const problems = withUrl.filter(it => it.row.status !== 'ok' && it.row.status !== 'unknown');
  const copyAll = () => copy(withUrl.map(it => `${it.row.name}\t${it.row.url}`).join('\n'), 'sources-all');
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/60 pt-3" data-sources-dialog>
      <div className="flex max-h-[96%] w-[1180px] flex-col rounded-[3px] border border-white/15 shadow-2xl" style={{ background: C.panel }}>
        <div className="flex h-[30px] flex-none items-center gap-2 border-b px-3" style={{ background: C.head, borderColor: C.line }}>
          <b className={`${LABEL} text-[13px]`}>Browser Sources</b>
          <span className="text-[11px] text-white/45" data-sources-summary>{withUrl.length} of the nine main scenes · {p.label} ({p.w}×{p.h}){problems.length ? ` · ${problems.length} need attention` : ' · all OK'}</span>
          <span className="ml-auto flex gap-1">
            <label className="mr-1 flex items-center gap-1 text-[11px] text-white/60"><input type="checkbox" data-sources-previews checked={showPreviews} onChange={e => setShowPreviews(e.target.checked)} />Show previews</label>
            <B h={22} data-sources-audit="1" title="Scan all of OBS for duplicate or misnamed browser sources" onClick={onOpenAudit}>Audit…</B>
            <B h={22} data-sources-docks="1" title="OBS Custom Browser Docks (individual Studio controls) — a separate, non-broadcast set of URLs" onClick={onOpenDocks}>OBS Docks…</B>
            <B h={22} data-sources-copy-all="1" disabled={!withUrl.length} onClick={copyAll}>{copied === 'sources-all' ? 'Copied ✓' : 'Copy All URLs'}</B>
            <B h={22} onClick={onClose} data-sources-close="1">Close</B>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          <table className="w-full table-fixed">
            <colgroup>
              {showPreviews && <col style={{ width: 110 }} />}
              <col style={{ width: 60 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 100 }} /><col style={{ width: 150 }} />
            </colgroup>
            <thead className={`sticky top-0 z-[1] bg-[#111113] text-left text-[11px] text-white/40 ${LABEL}`}>
              <tr>
                {showPreviews && <th className="py-1">Preview</th>}
                <th>Status</th><th>Main scene</th><th>URL</th><th>OBS scene</th><th>Resolution</th><th className="text-right pr-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.row?.id ?? `${it.group}-${i}`} className="border-t border-white/[0.06]" data-source-row={it.row?.id ?? it.group}>
                  {showPreviews && <td className="py-1.5">{it.row ? <SourcePreview url={it.row.url} w={p.w} h={p.h} /> : <span className="text-white/25">—</span>}</td>}
                  {it.row ? (<>
                    <td><Status s={it.row.status} /></td>
                    <td className="truncate pr-2">
                      <b className="text-white/90">{it.group}</b>
                      {it.group === 'Show Screens' && <span className="ml-1 text-white/35">({SHOW_SCREEN_SUBLABEL[it.row.main ?? ''] ?? it.row.name})</span>}
                    </td>
                    <td className="truncate pr-2 font-mono text-[11px] text-white/60" title={it.row.url}>{it.row.url}</td>
                    <td className="truncate pr-2">
                      <span className="text-white/80">{it.row.scene}</span>
                      {it.row.onAir && <span className="ml-1 rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10px] font-bold text-white" style={{ background: C.pgm }}>ON AIR</span>}
                      {it.row.supersededBy && <span className="ml-1 text-[10.5px]" style={{ color: C.draft }}>duplicate</span>}
                    </td>
                    <td className="text-white/70">{p.w}×{p.h}</td>
                    <td className="text-right pr-1">
                      <span className="inline-flex gap-1">
                        <B h={20} disabled={!canAct} onClick={() => onBuild(it.row!.id)}>Build</B>
                        <B h={20} disabled={!canAct || it.row.status === 'missing'} onClick={() => onRepair(it.row!.id)}>Repair</B>
                        <B h={20} title="Open this scene's individual Studio controls" onClick={() => onOpen(it.row!.id)}>Controls ↗</B>
                        <B h={20} onClick={() => copy(it.row!.url, it.row!.id)}>{copied === it.row.id ? '✓' : 'Copy'}</B>
                      </span>
                    </td>
                  </>) : (<>
                    <td><Status s="missing" /></td>
                    <td className="truncate pr-2"><b className="text-white/90">{it.group}</b></td>
                    <td colSpan={4} className="text-white/40">No browser source mapped yet — Scan OBS, then Build to create it.</td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-white/40">
            Nine main scenes, one broadcast browser source each (Show Screens has three: Starting Soon, Intermission, Thanks for Watching — Be Right Back shares Intermission's). These are the real OBS browser sources Program/Preview switch between; they are never put in an OBS dock. For the separate per-scene OBS Custom Browser Dock controllers, use <b>OBS Docks…</b> above.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Small read-only scaled embed of the real route, for a quick visual check without opening OBS. */
function SourcePreview({ url, w, h }: { url: string; w: number; h: number }) {
  const boxW = 96, boxH = Math.round((boxW * h) / w);
  const scale = boxW / w;
  return (
    <div style={{ width: boxW, height: boxH, overflow: 'hidden', background: '#000', borderRadius: 2 }} data-source-preview>
      <iframe src={url} title="preview" loading="lazy" tabIndex={-1}
        style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }} />
    </div>
  );
}

function DocksDialog({ docks, base, copied, copy, onOpen, onClose }: { docks: DockEntry[]; base: string; copied: string; copy: (t: string, w: string) => void; onOpen: (id: string) => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/60 pt-3" data-docks-dialog>
      <div className="flex max-h-[96%] w-[1180px] flex-col rounded-[3px] border border-white/15 shadow-2xl" style={{ background: C.panel }}>
        <div className="flex h-[30px] flex-none items-center gap-2 border-b px-3" style={{ background: C.head, borderColor: C.line }}>
          <b className={`${LABEL} text-[13px]`}>OBS controller docks</b>
          <span className="text-[11px] text-white/45">{docks.length} docks · each OBS scene has its own 1920×1480 controller, scaled to the dock · controllers are never put in a scene</span>
          <span className="ml-auto flex gap-1">
            <B h={22} data-docks-copy-all="1" onClick={() => copy(docks.map(d => `${d.title}\t${d.url}`).join('\n'), 'all')}>{copied === 'all' ? 'Copied ✓' : 'Copy all (name + URL)'}</B>
            <B h={22} data-docks-ps1="1" onClick={() => download('overdrive-obs-docks.ps1', dockInstallerPs1(docks))}>Installer · Windows</B>
            <B h={22} data-docks-sh="1" onClick={() => download('overdrive-obs-docks.sh', dockInstallerSh(docks))}>Installer · macOS / Linux</B>
            <B h={22} onClick={onClose} data-docks-close="1">Close</B>
          </span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_400px] gap-3 overflow-hidden p-3 text-[12px]">
          <div className="min-h-0 overflow-y-auto">
            <table className="w-full table-fixed">
              <colgroup><col style={{ width: 230 }} /><col /><col style={{ width: 118 }} /></colgroup>
              <thead className={`text-left text-[11px] text-white/40 ${LABEL}`}><tr><th className="py-1">Dock name</th><th>URL</th><th /></tr></thead>
              <tbody>
                {docks.map(d => (
                  <tr key={d.id} className="border-t border-white/[0.06]" data-dock-row={d.id}>
                    <td className="truncate py-[3px] pr-2 text-white/90">{d.title}</td>
                    <td className="truncate pr-2 font-mono text-[11px] text-white/60" title={d.url}>{d.url}</td>
                    <td className="text-right"><span className="inline-flex gap-1"><B h={20} onClick={() => onOpen(d.id)}>Open</B><B h={20} onClick={() => copy(d.url, d.id)}>{copied === d.id ? '✓' : 'Copy'}</B></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-white/40">{FOLLOW === docks[0]?.id ? '“Follow OBS” shows whichever Overdrive scene OBS has in Preview (Studio Mode) or Program. It follows OBS and never switches it. ' : ''}URLs use the address OBS loads Overdrive from: {base}.</p>
          </div>
          <div className="min-h-0 overflow-y-auto leading-[1.5] text-white/75" data-docks-help>
            <div className={`${LABEL} mb-1 text-[12px] text-white/85`}>Add them in OBS (any OBS 28+ on Windows / macOS)</div>
            <ol className="list-decimal pl-4">
              <li>OBS menu <b>Docks → Custom Browser Docks…</b></li>
              <li>For each scene: <b>Dock Name</b> = the name on the left, <b>URL</b> = its URL (Copy). Click <b>Apply</b>.</li>
              <li>Each dock opens; sign in once with the producer password (OBS remembers it).</li>
              <li>Drag the docks where you want them; tabs work (drop a dock onto another).</li>
            </ol>
            <div className={`${LABEL} mb-1 mt-3 text-[12px] text-white/85`}>Or install them all at once</div>
            <ol className="list-decimal pl-4">
              <li><b>Close OBS</b> (OBS rewrites its dock list when it exits; the installer refuses while OBS runs).</li>
              <li>Windows: right-click <code>overdrive-obs-docks.ps1</code> → <b>Run with PowerShell</b>. macOS / Linux: <code>sh overdrive-obs-docks.sh</code>.</li>
              <li>Start OBS: the docks are under <b>Docks</b>. Existing docks are kept, running it again adds nothing twice, and a backup of the settings file is made next to it.</li>
            </ol>
            <div className={`${LABEL} mb-1 mt-3 text-[12px] text-white/85`}>Why not automatic?</div>
            <p>obs-websocket (OBS's remote API) has no request to create docks, and the browser plugin's remote request only sends events. OBS stores Custom Browser Docks in its settings file, which it reads at start and rewrites on exit, so they can only be added in OBS or with OBS closed.</p>
            <div className={`${LABEL} mb-1 mt-3 text-[12px] text-white/85`}>Notes</div>
            <ul className="list-disc pl-4">
              <li>Custom Browser Docks need OBS's browser plugin (included on Windows / macOS; missing from some Linux packages).</li>
              <li>Controllers never go in a scene. Verify OBS Setup warns if a controller URL is used as a browser source.</li>
              <li>OBS docks share one zoom per site: zooming a dock can also zoom Overdrive's browser sources. Leave dock zoom at 100 %; the controller already scales to fit.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 3.2: the nine main scenes at a glance, and the migration steps from a 3.1 collection. */
function MainOverview({ st, onCleanup, canAct }: { st: ControllerState; onCleanup: () => void; canAct: boolean }) {
  const s = st.obsSetup!, mains = s.mains ?? [];
  const missing = mains.filter(m => !m.exists).length;
  const extra = st.obs.scenes.filter(n => n.startsWith('Overdrive') && !mains.some(m => m.scene === n)).length;
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b px-2.5 py-1.5 text-[11.5px]" style={{ borderColor: C.line }} data-main-overview>
      <span className={`${LABEL} mr-1 text-[11px] text-white/45`}>Main scenes</span>
      {mains.map(m => (
        <span key={m.key} data-main-scene={m.key} data-exists={m.exists ? '1' : '0'} title={`${m.scene}${m.exists ? '' : ' — not built yet'}\n${m.layers.map(l => `${l.on ? '●' : '○'} ${l.name} (${l.role})`).join('\n')}`}
          className="inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[1px]" style={{ borderColor: m.scene === st.obs.currentScene ? C.pgm : m.exists ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)', color: m.exists ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.35)' }}>
          {m.label}<span className="text-white/35">{m.layers.length}</span>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-2 text-white/55">
        {missing > 0 ? <span data-migrate-hint>Step 1: <b>Build All</b> adds the {missing} missing main scene{missing === 1 ? '' : 's'} and puts every existing source in them (nothing is deleted or renamed).</span>
          : extra > 0 ? <span data-migrate-hint>{extra} older Overdrive scene{extra === 1 ? '' : 's'} still in OBS. Step 2: check the cleanup report.</span>
          : <span>Every output is a layer of a main scene.</span>}
        <B h={22} disabled={!canAct} data-act="cleanup" onClick={onCleanup} title="Dry run: which OBS scenes Overdrive manages, which can be consolidated, which stay untouched. Nothing is removed without your confirmation.">Cleanup report…</B>
      </span>
    </div>
  );
}

/** Read-only, whole-collection duplicate-source audit against the real OBS connection. Never changes anything. */
function AuditDialog({ report, busy, onClose, onRescan }: { report: AuditReport | null; busy: boolean; onClose: () => void; onRescan: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/60 pt-6" data-audit-dialog={report ? '1' : ''}>
      <div className="flex max-h-[90%] w-[640px] flex-col rounded-[3px] border border-white/15 shadow-2xl" style={{ background: C.panel }}>
        <div className="flex h-[30px] flex-none items-center gap-2 border-b px-3" style={{ background: C.head, borderColor: C.line }}>
          <b className={`${LABEL} text-[13px]`}>Real-OBS duplicate-source audit</b>
          <span className="text-[11px] text-white/45">{report ? `${report.checked} browser sources checked · read-only, nothing changed` : 'Checking…'}</span>
          <span className="ml-auto flex gap-1"><B h={22} onClick={onRescan} disabled={busy} data-audit-rescan="1">Check again</B><B h={22} onClick={onClose} data-audit-close="1">Close</B></span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          {!report && <p className="text-white/55">Reading every browser source in OBS…</p>}
          {report && !report.duplicates.length && !report.foreignManagedLooking.length && (
            <p style={{ color: C.ok }} data-audit-clean>No duplicates. Every browser source in this OBS points at a different Overdrive page, mic or camera — nothing is doubled up.</p>
          )}
          {report && report.duplicates.length > 0 && (
            <div className="mb-3" data-audit-duplicates>
              <div className={`${LABEL} mb-1 text-[11px]`} style={{ color: C.in }}>Duplicates found · {report.duplicates.length}</div>
              {report.duplicates.map(d => (
                <div key={d.route} className="border-t border-white/[0.06] py-1.5">
                  <div className="text-white/50">{d.inputs.length} sources all point at <span className="font-mono text-white/75">{d.route}</span>:</div>
                  <ul className="list-disc pl-5 text-white/85">{d.inputs.map(n => <li key={n}>{n}</li>)}</ul>
                  <div className="text-white/45">Only one of these should exist. Keep whichever one Overdrive's scenes actually use (check the main scene list), then remove the other(s) in OBS by hand — Overdrive never deletes a source you didn't ask it to.</div>
                </div>
              ))}
            </div>
          )}
          {report && report.foreignManagedLooking.length > 0 && (
            <div data-audit-foreign>
              <div className={`${LABEL} mb-1 text-[11px]`} style={{ color: C.draft }}>Named like Overdrive's own, but not one it manages · {report.foreignManagedLooking.length}</div>
              <ul className="list-disc pl-5 text-white/75">{report.foreignManagedLooking.map(n => <li key={n}>{n}</li>)}</ul>
              <div className="mt-1 text-white/45">Likely a manual rename or a very old build. Not touched automatically — rename or remove it in OBS if it's not needed.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pre-event validation checklist. Deliberately keeps two different kinds of signal visibly apart:
 *  - "Automated" — Overdrive's own scan/audit/cleanup data, computed just now. Useful, but it cannot see real
 *    pixels or real sound, so a clean automated result is never shown as proof the item is validated.
 *  - "Confirm on real OBS" — only ticked by the operator, after actually checking against real OBS/audio. This is
 *    the only thing that marks an item validated; Overdrive never ticks it for you and never infers it from a test run.
 */
const AUTO_BADGE: Record<string, { t: string; c: string }> = { ok: { t: 'Automated: OK', c: C.ok }, issue: { t: 'Automated: issue found', c: C.in }, 'n/a': { t: 'No automated check', c: 'rgba(255,255,255,.35)' } };
function ValidationDialog({ report, busy, onClose, onSet, onNewSession }: { report: ValidationReport | null; busy: boolean; onClose: () => void; onSet: (id: string, checked: boolean) => Promise<Ack>; onNewSession: () => Promise<Ack> }) {
  const items = report?.items ?? [];
  const stale = items.filter(i => i.needsRevalidation).length;
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/60 pt-4" data-validate-dialog={report ? '1' : ''}>
      <div className="flex max-h-[94%] w-[860px] flex-col rounded-[3px] border border-white/15 shadow-2xl" style={{ background: C.panel }}>
        <div className="flex h-[30px] flex-none items-center gap-2 border-b px-3" style={{ background: C.head, borderColor: C.line }}>
          <b className={`${LABEL} text-[13px]`}>Pre-event validation checklist</b>
          <span className="text-[11px] text-white/45" data-validate-summary>{report ? `${report.manualConfirmed}/${report.manualTotal} confirmed this check${stale ? ` · ${stale} need revalidation (config changed)` : ''}${report.autoIssues ? ` · ${report.autoIssues} automated issue${report.autoIssues === 1 ? '' : 's'} flagged` : ''}` : '—'}</span>
          <span className="ml-auto flex gap-1">
            <B h={22} disabled={busy} data-validate-new-session="1" title="Clears every checkbox for a fresh pre-event pass. Nothing is deleted — when each item was last confirmed is kept below." onClick={() => void onNewSession()}>Start New Pre-Event Check</B>
            <B h={22} onClick={onClose} data-validate-close="1">Close</B>
          </span>
        </div>
        {report && <div className="flex-none border-b px-3 py-1 text-[11px] text-white/40" data-validate-session={report.session}>This check started {new Date(report.sessionAt).toLocaleString()}.</div>}
        <div className="flex-none border-b px-3 py-1.5 text-[11.5px] leading-[1.4] text-white/55" style={{ borderColor: C.line }}>
          Two different signals, never blurred: <b className="text-white/80">Automated</b> is what Overdrive computed just now from its own scan/audit data — it can be wrong about anything it cannot see. <b className="text-white/80">Confirm on real OBS</b> is a box only you can tick, after actually checking real OBS picture and sound. A clean automated result never ticks that box for you, and a config change (scenes, source mapping, audio routing) flags a past confirmation as stale instead of silently keeping it.
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          {items.map(it => (
            <div key={it.id} className="mb-3 border-t border-white/[0.06] pt-2" data-validate-item={it.id} data-confirmed={it.confirmed ? '1' : '0'} data-stale={it.needsRevalidation ? '1' : '0'}>
              <div className="flex items-start gap-2">
                <span className="w-[22px] flex-none pt-[2px]">
                  <input type="checkbox" data-validate-check={it.id} checked={it.confirmed} disabled={busy}
                    onChange={e => void onSet(it.id, e.target.checked)} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`${LABEL} text-[10.5px] text-white/35`}>{it.category}</span>
                    <span className="inline-flex h-[15px] items-center rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10px] font-bold tracking-[0.05em]" style={{ color: AUTO_BADGE[it.autoStatus].c, border: `1px solid ${AUTO_BADGE[it.autoStatus].c}` }}>{AUTO_BADGE[it.autoStatus].t}</span>
                    {it.needsRevalidation && <span className="inline-flex h-[15px] items-center rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10px] font-bold tracking-[0.05em]" style={{ color: C.draft, border: `1px solid ${C.draft}` }} title="The OBS scene collection, source mapping or audio routing changed since this was last confirmed.">Needs revalidation</span>}
                    {it.confirmed && <span className="text-[10.5px]" style={{ color: C.ok }}>confirmed {it.confirmedAt ? new Date(it.confirmedAt).toLocaleString() : ''}</span>}
                    {!it.confirmed && it.confirmedAt && <span className="text-[10.5px] text-white/40">last performed {new Date(it.confirmedAt).toLocaleString()}</span>}
                  </div>
                  <div className="font-semibold text-white/90">{it.label}</div>
                  <div className="text-white/60">{it.detail}</div>
                  <div className="mt-0.5 text-white/45">{it.autoNote}</div>
                  {it.steps?.length ? (
                    <ul className="mt-1 list-disc pl-4 text-white/70">{it.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {!items.length && <p className="text-white/55">Loading…</p>}
        </div>
        <div className="flex flex-none items-center gap-2 border-t px-3 py-2 text-[11px] text-white/45" style={{ borderColor: C.line }}>
          Confirmations are saved and reappear here next time — tick again before every event (and whenever flagged "Needs revalidation"), since OBS and hardware can change between shows.
        </div>
      </div>
    </div>
  );
}

const CLS_LABEL: Record<string, { t: string; c: string }> = {
  main: { t: 'Main scene', c: C.ok }, consolidate: { t: 'Can be removed', c: C.draft }, keep: { t: 'Kept', c: 'rgba(255,255,255,.55)' }, 'not-overdrive': { t: 'Not Overdrive’s', c: 'rgba(255,255,255,.35)' },
};
/** Dry-run cleanup report; removal only for the scenes ticked, after typing REMOVE. */
function CleanupDialog({ report, busy, onClose, onRescan, onApply }: { report: CleanupReport | null; busy: boolean; onClose: () => void; onRescan: () => void; onApply: (remove: string[], unnest: string[], confirm: string, drop: string[], nestAudio: string[]) => Promise<Ack> }) {
  const [drop, setDrop] = useState<Set<string>>(new Set());
  useEffect(() => { setDrop(new Set(report?.redundant?.map(r => `${r.scene}\u0000${r.input}`))); }, [report?.hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [unnest, setUnnest] = useState<Set<string>>(new Set());
  const [nestAudio, setNestAudio] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');
  const [res, setRes] = useState<string>('');
  useEffect(() => { setPick(new Set(report?.scenes.filter(x => x.cls === 'consolidate').map(x => x.scene))); setUnnest(new Set(report?.nestedAudio)); setNestAudio(new Set(report?.flatAudio?.map(x => x.scene))); setTyped(''); }, [report?.hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const tog = (set: Set<string>, v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const n = pick.size + unnest.size + drop.size + nestAudio.size;
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/60 pt-4" data-cleanup-dialog={report?.hash ?? ''}>
      <div className="flex max-h-[94%] w-[900px] flex-col rounded-[3px] border border-white/15 shadow-2xl" style={{ background: C.panel }}>
        <div className="flex h-[30px] flex-none items-center gap-2 border-b px-3" style={{ background: C.head, borderColor: C.line }}>
          <b className={`${LABEL} text-[13px]`}>OBS cleanup · dry run</b>
          <span className="text-[11px] text-white/45">{report ? `${report.scenes.length} scenes in OBS · nothing has been removed` : 'Reading OBS…'}</span>
          <span className="ml-auto flex gap-1"><B h={22} onClick={onRescan} disabled={busy}>Report again</B><B h={22} onClick={onClose} data-cleanup-close="1">Close</B></span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          {report?.nestedAudio.length ? (
            <div className="mb-3 rounded-[2px] border p-2" style={{ borderColor: 'rgba(240,180,60,.4)' }}>
              <b style={{ color: C.draft }}>Audio:</b> these main scenes still nest the old “Overdrive · Caster audio” scene. Replace it with the same audio sources added directly (no new sources):
              {report.nestedAudio.map(nm => <label key={nm} className="ml-3 inline-flex items-center gap-1"><input type="checkbox" data-unnest={nm} checked={unnest.has(nm)} onChange={() => setUnnest(u => tog(u, nm))} />{nm}</label>)}
            </div>
          ) : null}
          {report?.flatAudio?.length ? (
            <div className="mb-3 rounded-[2px] border p-2" style={{ borderColor: 'rgba(240,180,60,.4)' }} data-cleanup-flataudio>
              <b style={{ color: C.draft }}>Audio clutter:</b> these main scenes still have the old one-item-per-mic audio directly in them. Replace with the single reusable audio scene instead (same mics, same music — nothing recreated, independent mute/volume/sync per talent untouched):
              {report.flatAudio.map(x => <label key={x.scene} className="ml-3 inline-flex items-center gap-1"><input type="checkbox" data-nest-audio={x.scene} checked={nestAudio.has(x.scene)} onChange={() => setNestAudio(u => tog(u, x.scene))} />{x.scene}</label>)}
            </div>
          ) : null}
          {report?.redundant?.length ? (
            <div className="mb-3 rounded-[2px] border p-2" style={{ borderColor: 'rgba(240,180,60,.4)' }} data-cleanup-redundant>
              <b style={{ color: C.draft }}>Retired sources:</b> the MVP scene now draws all five views with its one dynamic source. These old per-view sources can come out of it:
              {report.redundant.map(r => { const k = `${r.scene}\u0000${r.input}`; return <label key={k} className="ml-3 inline-flex items-center gap-1"><input type="checkbox" data-drop={r.input} checked={drop.has(k)} onChange={() => setDrop(u => tog(u, k))} />{r.input}</label>; })}
            </div>
          ) : null}
          {(['consolidate', 'keep', 'main', 'not-overdrive'] as const).map(cls => {
            const list = report?.scenes.filter(x => x.cls === cls) ?? [];
            if (!list.length) return null;
            return (
              <div key={cls} className="mb-3">
                <div className={`${LABEL} mb-1 text-[11px]`} style={{ color: CLS_LABEL[cls].c }}>{CLS_LABEL[cls].t} · {list.length}</div>
                {list.map(x => (
                  <div key={x.scene} className="flex gap-2 border-t border-white/[0.06] py-1" data-cleanup-scene={x.scene} data-cls={x.cls}>
                    <span className="w-[18px] flex-none">{cls === 'consolidate' && <input type="checkbox" data-remove={x.scene} checked={pick.has(x.scene)} onChange={() => setPick(p => tog(p, x.scene))} />}</span>
                    <span className="w-[300px] flex-none truncate font-semibold text-white/85" title={x.scene}>{x.scene}{x.onAir && <span className="ml-1 rounded-[2px] px-1 text-[10px] text-white" style={{ background: C.pgm }}>PGM/PVW</span>}</span>
                    <span className="min-w-0 flex-1 text-white/60">{x.reasons.join(' ')}{x.refs.length ? <span style={{ color: C.draft }}> Repointed to its main scene on removal: {x.refs.join(', ')}.</span> : null}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {res && <p className="mt-2 text-white/75" data-cleanup-result>{res}</p>}
        </div>
        <div className="flex flex-none items-center gap-2 border-t px-3 py-2" style={{ borderColor: C.line }}>
          <span className="text-[11.5px] text-white/55">Removes only the ticked scenes classed “Can be removed” (their sources stay, inside the main scenes). Type <b>REMOVE</b> to confirm.</span>
          <input data-cleanup-confirm value={typed} onChange={e => setTyped(e.target.value)} placeholder="REMOVE" className="ml-auto h-[24px] w-[110px] rounded-[2px] border border-white/15 bg-[#0b0b0c] px-1.5 font-mono text-[12px]" />
          <B h={24} kind="primary" disabled={busy || !report || !n || typed !== 'REMOVE'} data-cleanup-apply="1"
            onClick={async () => { const r = await onApply([...pick], [...unnest], typed, [...drop], [...nestAudio]); setRes(r.ok ? r.note ?? 'Done' : r.error ?? 'Failed'); setTyped(''); }}>
            {busy ? 'Working…' : `Remove ${pick.size} scene${pick.size === 1 ? '' : 's'}${drop.size ? ` · ${drop.size} retired source${drop.size === 1 ? '' : 's'}` : ''}${unnest.size ? ` · fix legacy audio in ${unnest.size}` : ''}${nestAudio.size ? ` · declutter audio in ${nestAudio.size}` : ''}`}
          </B>
        </div>
      </div>
    </div>
  );
}

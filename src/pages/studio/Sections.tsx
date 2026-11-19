/**
 * Studio Mode 2.0 · workspace sections built from the existing, tested panels and control modules.
 * The existing panels were designed for the 1920×1480 workstation canvas; here they get room and a uniform
 * zoom (Legacy) instead of being rewritten, so their behaviour is exactly the one Producer Mode uses.
 * Live data edited from Studio is PREPARED (Ctx.prepare = true): it reaches the sources only with Publish.
 */
import type { ReactNode } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { EngineState } from '../../../shared/engine';
import { MvpSceneConfig } from './MvpConfig';
import { StaffPicksAdmin } from './StaffPicksAdmin';
import { MODULES, REGISTRY, sourceById, studioFor, AUD_SOURCES, type ModuleId, type SourceDef } from '../../../shared/registry';
import { pkgById, PACKAGES } from '../../../shared/gfx';
import { sourceSizeLabel } from '../../../shared/layout';
import { TRANSITIONS, type TransitionKind } from '../../../shared/engine';
import { ModuleView, type Ctx, type Run } from '../producer/modules';
import { Inspector, PackageLibrary } from '../producer/Inspector';
import { ObsSetupPanel } from '../producer/ObsSetup';
import { obsSceneOfGfx, obsSceneOfSource } from '../producer/Library';
import { AssetsPanel, AudiencePanel, BindingsPanel, InstancesPanel, ModuleLayoutPanel, ShowFilePanel } from '../producer/Studio';
import { Btn, COND, Card, Empty, I, Pill, S, Seg, Select, copy, useUiScale } from './kit';
import { conns, sceneCatalogue, selToTarget, type SceneEntry } from './model';
import { PortraitManager } from './Portraits';

/** Existing workstation panels, given room and enlarged uniformly for this workspace. */
export function Legacy({ children, z: zBase = 1.2, className = '' }: { children: ReactNode; z?: number; className?: string }) {
  const z = useUiScale(zBase);
  return (
    <div className={`relative min-h-0 flex-1 overflow-hidden rounded-[10px] border ${className}`} style={{ borderColor: S.line, background: '#111113' }} data-legacy>
      {/* Chromium (OBS docks included) resolves % sizes of a zoomed box against the parent, unscaled: 100 % fills it. */}
      <div className="absolute inset-0 flex flex-col overflow-auto" style={{ zoom: z }}>{children}</div>
    </div>
  );
}

/** A grid of existing control modules (each its own card), for one scene source context. */
export function ModuleGrid({ ids, x, src, min = 460 }: { ids: ModuleId[]; x: Ctx; src: SourceDef; min?: number }) {
  const z = useUiScale(1.2);
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(min * z / 1.14)}px, 1fr))` }}>
      {ids.map(m => (
        <div key={m} className="min-w-0 overflow-hidden rounded-[10px] border" style={{ borderColor: S.line, background: '#111113' }} data-studio-module-card={m}>
          <div style={{ zoom: z }} className="flex min-h-[200px] [&>section]:w-full [&>section]:min-w-0"><ModuleView id={m} x={{ ...x, src }} pinned={false} /></div>
        </div>
      ))}
    </div>
  );
}

export type SubTab = { id: string; label: string };
export function SubTabs({ tabs, value, onChange }: { tabs: SubTab[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-none items-end gap-1 overflow-x-auto border-b" style={{ borderColor: S.line }} role="tablist">
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} data-subtab={t.id}
          className={`${COND} relative h-[44px] flex-none whitespace-nowrap px-4 text-[15px] tracking-[0.08em] transition ${value === t.id ? 'text-white' : 'text-white/50 hover:text-white/85'}`}>
          {t.label}{value === t.id && <span className="absolute inset-x-2 bottom-[-1px] h-[3px] rounded-t-full" style={{ background: S.accent }} />}
        </button>
      ))}
    </div>
  );
}

// =========================================================================== Scenes
export const SCENE_TABS: SubTab[] = [{ id: 'settings', label: 'Scene settings' }, { id: 'modules', label: 'Control modules' }, { id: 'packages', label: 'Packages & instances' }];

export function ScenesSection({ tab, st, run, x, entry, onAddSegment }: { tab: string; st: ControllerState; run: Run; x: Ctx; entry: SceneEntry | undefined; onAddSegment: (target: string, name: string) => void }) {
  if (tab === 'packages') return <Legacy><PackageLibrary st={st} run={run} onSelect={() => {}} /></Legacy>;
  if (!entry) return <Empty>Select a scene or graphic in the Scene Library.</Empty>;
  const src = entry.src ?? (entry.gfx ? (pkgById(entry.gfx.pkg)?.category === 'Audience' ? AUD_SOURCES[pkgById(entry.gfx.pkg)!.renderer] : REGISTRY.find(s => s.obsKey === pkgById(entry.gfx!.pkg)?.obsKey)) : undefined) ?? REGISTRY[0];
  if (tab === 'modules') {
    if (!entry.src) return <Empty>Control modules are chosen per scene source. Graphics instances use their package's generated controls (Scene settings).</Empty>;
    return <Legacy><ModuleLayoutPanel st={st} src={entry.src} run={run} /></Legacy>;
  }
  const g = entry.gfx;
  const obsScene = g ? obsSceneOfGfx(g, st) : entry.src ? obsSceneOfSource(entry.src, st) : undefined;
  const url = `${location.origin}${entry.route}${st.outputKey ? `${entry.route.includes('?') ? '&' : '?'}key=${encodeURIComponent(st.outputKey)}` : ''}`;
  const layout = entry.src && !entry.src.id.startsWith('aud-') ? studioFor(st.studio, entry.src.id) : null;
  const mods = layout ? [...layout.pinned, ...layout.modules.filter(m => !layout.pinned.includes(m))] : [];
  const onPgm = !!obsScene && obsScene === st.obs.currentScene, onPvw = !!obsScene && st.obs.studioMode && obsScene === st.obs.previewScene;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1" data-scene-settings={entry.key}>
      <Card bodyClass="p-4" className="flex-none">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div className="min-w-[260px]">
            <div className="flex items-center gap-2"><span className={`${COND} text-[24px] tracking-[0.06em]`}>{entry.name}</span>
              {onPgm && <Pill tone="pgm">OBS PGM</Pill>}{onPvw && <Pill tone="pvw">OBS PVW</Pill>}{g?.draft && <Pill tone="warn">Draft</Pill>}{g && <Pill tone={g.anim.action === 'out' ? 'dim' : 'pgm'}>{g.anim.action === 'out' ? 'Out' : 'In'}</Pill>}</div>
            <div className="mt-1 text-[14px] text-white/55">{entry.kind === 'graphic' ? `Graphic · ${pkgById(g!.pkg)?.name} v${pkgById(g!.pkg)?.version}` : `Scene source · ${entry.src?.category}`} · {entry.category} · {sourceSizeLabel(st.obsSetup?.options.profile)}</div>
          </div>
          <Info label="Browser source"><button type="button" className="font-mono text-[14px] text-white/85 underline decoration-white/30 hover:decoration-white" onClick={() => copy(url)} title="Copy the full URL">{entry.route}</button></Info>
          <Info label="Sources open"><span style={{ color: entry.conns ? S.ok : S.faint }}>{entry.conns ? `● ${entry.conns} connected` : '○ none'}</span></Info>
          <Info label="OBS scene">
            {g ? <Select ariaLabel="OBS scene of this graphic" className="!w-[240px]" value={g.obsScene ?? ''} onChange={v => run({ c: 'gfx-obs', id: g.id, scene: v || null }, `${g.name} → OBS ${v || 'auto'}`)}
              options={[['', `Auto (${obsSceneOfGfx({ ...g, obsScene: null }, st) ?? 'not found'})`], ...[...new Set([...(g.obsScene ? [g.obsScene] : []), ...st.obs.scenes])].map(n => [n, n] as [string, string])]} />
              : <span className={obsScene ? '' : 'text-white/40'}>{obsScene ?? 'not mapped (Sources & OBS → Scene Builder)'}</span>}
          </Info>
          <div className="ml-auto flex flex-wrap gap-2">
            <Btn onClick={() => onAddSegment(selToTarget(entry.key), entry.name)} icon={I.rundown}>Add to show rundown</Btn>
            {g && <Btn onClick={() => run({ c: 'rd-add', gfx: g.id, snapshot: true }, `${g.name} → graphics rundown`)} icon={I.plus} title="Adds a graphics rundown item with the current data (snapshot)">Add to graphics rundown</Btn>}
          </div>
        </div>
        {(entry.src?.animations.length || (g && pkgById(g.pkg)?.animations.length)) ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-white/55"><span className={`${COND} tracking-[0.12em] text-white/40`}>Animations</span>
            {(entry.src?.animations ?? pkgById(g!.pkg)!.animations.map(a => a.label)).map(a => <span key={a} className="rounded-[5px] border px-2 py-0.5" style={{ borderColor: S.line }}>{a}</span>)}
            {entry.src?.note && <span className="ml-2 text-white/40">{entry.src.note}</span>}</div>
        ) : null}
      </Card>
      {g ? (
        <div className="flex min-h-[560px] flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2"><span className={`${COND} text-[15px] tracking-[0.1em] text-white/80`}>Properties, data & presets</span><span className="text-[13px] text-white/45">Edits are prepared (Draft): the preview shows them, live sources do not change until Publish. Save scene presets here.</span></div>
          <Legacy z={1.18}><Inspector g={g} st={st} run={run} studio ctxBase={{ ...x }} /></Legacy>
        </div>
      ) : entry.src?.gfx === 'mvp' && entry.src.gfxView && x.aud ? (
        <div className="flex-none"><MvpSceneConfig st={st} run={run} x={x} src={entry.src} /></div>
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-2"><span className={`${COND} text-[15px] tracking-[0.1em] text-white/80`}>Scene controls</span><span className="text-[13px] text-white/45">{mods.length} module{mods.length === 1 ? '' : 's'} · live data is prepared here (Publish sends it)</span></div>
          {mods.length ? <ModuleGrid ids={mods} x={x} src={entry.src ?? src} /> : <Empty>No control modules for this scene. Add some under Control modules.</Empty>}
        </div>
      )}
    </div>
  );
}
function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1"><span className={`${COND} text-[12.5px] tracking-[0.14em] text-white/45`}>{label}</span><div className="text-[14.5px]">{children}</div></div>;
}

// =========================================================================== Graphics & Data
export const DATA_TABS: SubTab[] = [{ id: 'match', label: 'Match & scores' }, { id: 'bracket', label: 'Bracket' }, { id: 'players', label: 'Teams & players' }, { id: 'audience', label: "Predictions & votes" }, { id: 'mvp', label: 'MVP & portraits' }, { id: 'staffpicks', label: "Staff pick'em" }, { id: 'veto', label: 'Veto & interview' }, { id: 'bindings', label: 'Bindings' }];

export function DataSection({ tab, st, x }: { tab: string; st: ControllerState; x: Ctx }) {
  const src = (id: string) => sourceById(id) ?? REGISTRY[0];
  const wrap = (n: ReactNode, note?: ReactNode) => <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1">{note && <div className="flex flex-wrap items-center gap-3 rounded-[10px] border px-4 py-3 text-[14px] text-white/60" style={{ borderColor: S.line, background: S.panel }}>{note}</div>}{n}</div>;
  const admin = <Btn size="sm" onClick={() => window.open('/admin', '_blank')} icon={I.link}>Tournament admin ↗</Btn>;
  const ctl = <Btn size="sm" onClick={() => window.open('/controller', '_blank')} icon={I.link}>Controller (teams, sheet, sponsors) ↗</Btn>;
  switch (tab) {
    case 'match': return wrap(<ModuleGrid ids={['match', 'scoreboard', 'countdown']} x={x} src={src('gameplay')} />, <><Pill tone="warn">Prepared</Pill>Scores and predictions changed here wait for Publish (manual override). Tournament, teams and logos: {ctl}</>);
    case 'bracket': return wrap(<ModuleGrid ids={['bracket', 'match']} x={x} src={src('bracket')} />, <>Results come from the match scores and the Google Sheet sync; correcting a result re-flows every bracket graphic. Teams, seeding and format: {admin}</>);
    case 'players': return wrap(<ModuleGrid ids={['intro', 'showcase', 'stats', 'h2h']} x={x} src={src('team-intro')} />, <>Team intro, the Major player showcase (profiles, palmarès, photos) and the analyst desk's stats / head-to-head panels.</>);
    case 'audience': return wrap(<ModuleGrid ids={['predictions', 'pickems', 'mvp', 'qr']} x={x} src={AUD_SOURCES.pickem} />, <>Talent predictions, public Pick'ems, Community MVP voting and the voting QR. Nothing audience-related is on air until a producer publishes it.</>);
    case 'veto': return wrap(<ModuleGrid ids={['veto', 'interview', 'talent-guest']} x={x} src={src('interview')} />);
    case 'bindings': return <Legacy><BindingsPanel st={st} wc={x.wc} /></Legacy>;
    case 'staffpicks': return <div className="h-full min-h-0 overflow-y-auto pr-1"><StaffPicksAdmin st={st} x={x} /></div>;
    case 'mvp': return (
      <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1">
        {/* Fixed height: the manager keeps its size however short the workspace is; the MVP module follows below. */}
        <div style={{ height: 'max(760px, calc(100% - 8px))' }}><PortraitManager st={st} x={x} run={x.run} /></div>
        <ModuleGrid ids={['mvp']} x={x} src={AUD_SOURCES.mvp} min={620} />
      </div>
    );
  }
  return null;
}

// =========================================================================== Media & Audio
export const MEDIA_TABS: SubTab[] = [{ id: 'player', label: 'Media player & playlist' }, { id: 'music', label: 'Music per scene' }, { id: 'assets', label: 'Assets & sponsors' }, { id: 'routing', label: 'Audio routing' }];

export function MediaSection({ tab, st, x, musicScene, setMusicScene }: { tab: string; st: ControllerState; x: Ctx; musicScene: string; setMusicScene: (id: string) => void }) {
  const music = REGISTRY.filter(s => s.modules.includes('music'));
  const origin = location.origin, key = st.outputKey ? `?key=${encodeURIComponent(st.outputKey)}` : '';
  switch (tab) {
    case 'player': return <div className="h-full min-h-0 overflow-y-auto pr-1"><ModuleGrid ids={['media']} x={x} src={sourceById('media')!} min={620} />
      <p className="mt-3 text-[13.5px] text-white/50">Sponsor ads and videos play on <span className="font-mono">/output/media</span>, server-timed so every copy is in sync. A segment of the show rundown can start a file on GO, and the “Media playback ends” automation trigger takes the show forward.</p></div>;
    case 'music': return (
      <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-3"><span className={`${COND} text-[14px] tracking-[0.12em] text-white/60`}>Scene</span>
          <Seg size="sm" value={musicScene} options={music.map(s => [s.id, s.name] as [string, string])} onChange={setMusicScene} /></div>
        <ModuleGrid ids={['music']} x={x} src={sourceById(musicScene) ?? music[0]} min={620} />
      </div>);
    case 'assets': return <Legacy><AssetsPanel x={x} /></Legacy>;
    case 'routing': return (
      <div className="grid h-full min-h-0 content-start gap-3 overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))' }}>
        <Card title="Talent microphones" icon={I.mic}>
          <p className="mb-3 text-[14px] text-white/55">Each remote caster's microphone is its own OBS browser source, so it can be mixed, delayed and filtered in OBS.</p>
          {[1, 2, 3].map(n => <UrlRow key={n} label={`Caster ${n}`} url={`${origin}/output/audio/${n}${key}`} count={conns(st, `audio/${n}`)} />)}
        </Card>
        <Card title="Music & media" icon={I.audio}>
          <UrlRow label="Music beds" url={`${origin}/output/music${key}`} count={conns(st, 'music')} />
          <UrlRow label="Media playback" url={`${origin}/output/media${key}`} count={conns(st, 'media')} />
          <p className="mt-3 text-[13.5px] text-white/50">Enable “Control audio via OBS” on these browser sources. Levels per scene: Music per scene. Media volume: Media player.</p>
        </Card>
      </div>);
  }
  return null;
}
function UrlRow({ label, url, count }: { label: string; url: string; count: number }) {
  return (
    <div className="flex items-center gap-3 border-t py-2.5 first:border-t-0" style={{ borderColor: S.line }}>
      <span className="w-[130px] flex-none text-[14px]">{label}</span>
      <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-[13px] text-white/65 hover:text-white" onClick={() => copy(url)} title="Copy">{url}</button>
      <span className="text-[13px]" style={{ color: count ? S.ok : S.faint }}>{count ? `● ${count}` : '○'}</span>
    </div>
  );
}

// =========================================================================== OBS & Outputs
export const OBS_TABS: SubTab[] = [{ id: 'overview', label: 'Connection & outputs' }, { id: 'builder', label: 'Scene builder' }, { id: 'mapping', label: 'Graphics → OBS mapping' }];

export function ObsSection({ tab, st, eng, run }: { tab: string; st: ControllerState; eng: EngineState; run: Run }) {
  if (tab === 'builder') return <Legacy><ObsSetupPanel st={st} run={run} /></Legacy>;
  if (tab === 'mapping') return <Legacy><InstancesPanel st={st} run={run} onSelect={() => {}} sel="" /></Legacy>;
  const o = st.obs, cat = sceneCatalogue(st);
  const health = st.gfxHealth ?? {};
  return (
    <div className="grid h-full min-h-0 gap-3 overflow-y-auto pr-1" style={{ gridTemplateColumns: 'minmax(380px, 0.9fr) minmax(0, 1.6fr)' }} data-obs-overview>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Card title="OBS WebSocket" icon={I.obs} actions={<Pill tone={o.connected ? 'ok' : o.enabled ? 'bad' : 'dim'}>{o.connected ? 'Connected' : o.enabled ? 'Offline' : 'Not set up'}</Pill>}>
          <dl className="grid grid-cols-[130px_1fr] gap-y-2.5 text-[14.5px]">
            <dt className="text-white/50">Program</dt><dd className="font-semibold" style={{ color: o.connected ? '#ff8f92' : undefined }}>{o.currentScene ?? '—'}</dd>
            <dt className="text-white/50">Preview</dt><dd>{o.studioMode ? o.previewScene ?? '—' : <span className="text-white/45">OBS Studio Mode off</span>}</dd>
            <dt className="text-white/50">Scenes</dt><dd>{o.scenes.length}</dd>
            {o.error && <><dt className="text-white/50">Error</dt><dd className="text-[#ffb36b]">{o.error}</dd></>}
          </dl>
          <p className="mt-3 text-[13.5px] text-white/50">Address and password: Controller → Settings → OBS. Overdrive never switches OBS from Studio Mode; the Scene Builder only adds or repairs scenes and asks before touching the scene on air.</p>
          <div className="mt-3 flex gap-2"><Btn size="sm" onClick={() => window.open('/controller', '_blank')} icon={I.link}>OBS settings ↗</Btn><Btn size="sm" onClick={() => run({ c: 'obs-setup', action: 'verify' }, 'Verify OBS scenes')} icon={I.check}>Verify scenes</Btn></div>
        </Card>
        <Card title="Transitions" icon={I.bolt}>
          <div className="flex flex-wrap items-center gap-3"><span className="text-[14px] text-white/60">Legacy whole-show output default</span>
            <Seg size="sm" value={eng.transition} options={TRANSITIONS.map(t => [t.id, t.label] as [TransitionKind, string])} onChange={v => run({ c: 'set-transition', transition: v }, `Transition ${v}`)} /></div>
          <p className="mt-3 text-[13.5px] text-white/50">OBS plays every scene transition. Each show rundown segment chooses OBS default, Stinger, Fade or Cut (matched to your OBS transitions by type).</p>
        </Card>
        <Card title="Output resolution" icon={I.scenes}>
          <div className="text-[15px]"><b>{sourceSizeLabel(st.obsSetup?.options.profile)}</b> browser sources</div>
          <p className="mt-2 text-[13.5px] text-white/50">Every scene is designed on the 1920×1080 grid and rendered natively at the output profile (3840×2160 at 4K). Change the profile in Scene builder → options; existing sources are resized by Repair.</p>
        </Card>
      </div>
      <Card fill title="Browser sources" icon={I.scenes} bodyClass="overflow-y-auto" actions={<span className="text-[13px] text-white/45">{cat.filter(c => c.conns).length}/{cat.length} open in OBS</span>}>
        <table className="w-full text-[14px]">
          <thead className={`${COND} sticky top-0 text-left text-[12.5px] tracking-[0.12em] text-white/45`} style={{ background: S.panel }}>
            <tr><th className="px-4 py-2.5">Scene</th><th className="pr-3">Source</th><th className="pr-3">Open</th><th className="pr-3">OBS scene</th><th className="pr-4">Health</th></tr>
          </thead>
          <tbody>
            {cat.map(c => {
              const sc = c.gfx ? obsSceneOfGfx(c.gfx, st) : c.src ? obsSceneOfSource(c.src, st) : undefined;
              const h = c.gfx ? health[c.gfx.id] : undefined;
              return (
                <tr key={c.key} className="border-t" style={{ borderColor: S.line }}>
                  <td className="px-4 py-2.5 font-semibold">{c.name}<span className="ml-2 text-[12.5px] font-normal text-white/40">{c.kind}</span></td>
                  <td><button type="button" className="font-mono text-[13px] text-white/65 hover:text-white" onClick={() => copy(`${location.origin}${c.route}`)}>{c.route}</button></td>
                  <td style={{ color: c.conns ? S.ok : S.faint }}>{c.conns ? `● ${c.conns}` : '○'}</td>
                  <td>{sc ? <span style={{ color: sc === st.obs.currentScene ? '#ff8f92' : undefined }}>{sc}{sc === st.obs.currentScene ? ' · PGM' : ''}</span> : <span className="text-white/35">—</span>}</td>
                  <td className="whitespace-nowrap pr-4">{!c.gfx ? <span className="text-white/35">—</span> : !h ? <span className="text-white/40">no report</span> : h.ok ? <span style={{ color: S.ok }}>OK</span> : <span style={{ color: S.warn }}>⚠ {h.error}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// =========================================================================== Audience & show file
export const SHOW_TABS: SubTab[] = [{ id: 'audience', label: 'Audience & QR' }, { id: 'file', label: 'Show file & recovery' }];
export function ShowSection({ tab, st, run, x }: { tab: string; st: ControllerState; run: Run; x: Ctx }) {
  return tab === 'file' ? <Legacy><ShowFilePanel st={st} run={run} /></Legacy> : <Legacy><AudiencePanel x={x} /></Legacy>;
}

export { MODULES, PACKAGES };

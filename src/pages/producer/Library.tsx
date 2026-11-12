/**
 * Graphics Library (Live Graphics Mode, area A): every registered graphic, by category.
 * Graphics-engine instances (/g/<id>) first in each category, then the scene sources not migrated yet
 * (/output/screen/…). Selecting an entry only changes the operator's workspace: it never switches OBS.
 */
import { useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import type { ProducerCmd } from '../../../shared/engine';
import { pkgById, type GfxInstance } from '../../../shared/gfx';
import { REGISTRY, type SourceDef } from '../../../shared/registry';
import type { Ack } from './modules';
import { C, DraftBadge, LABEL, PanelHead, VisBadge } from './ws';

export const CATEGORIES = ['Desks', 'Gameplay', 'Match graphics', 'Tournament graphics', 'Player & team', 'Media', 'Utility'] as const;
export type Category = typeof CATEGORIES[number];

const SOURCE_CAT: Record<string, Category> = {
  'caster-desk': 'Desks', 'analyst-desk': 'Desks', gameplay: 'Gameplay', scoreboard: 'Match graphics', veto: 'Match graphics', interview: 'Match graphics',
  bracket: 'Tournament graphics', standings: 'Tournament graphics', matches: 'Tournament graphics', 'team-intro': 'Player & team', media: 'Media',
  starting: 'Utility', brb: 'Utility', ending: 'Utility',
};
const PKG_CAT: Record<string, Category> = { Desk: 'Desks', Game: 'Gameplay', Overlay: 'Match graphics', Bracket: 'Tournament graphics', Interview: 'Match graphics', Intermission: 'Utility', Media: 'Media' };

export const gfxCategory = (g: GfxInstance): Category => PKG_CAT[pkgById(g.pkg)?.category ?? ''] ?? 'Utility';
export const sourceCategory = (s: SourceDef): Category => SOURCE_CAT[s.id] ?? 'Utility';

/** OBS scene of a scene source: the "Build scenes in OBS" mapping or a scene named like it. */
export function obsSceneOfSource(src: SourceDef, st: ControllerState): string | undefined {
  const map = st.showLive.obsScenes as Record<string, string | undefined>;
  const byKey = src.obsKey ? map[src.obsKey] : undefined;
  if (byKey) return byKey;
  return st.obs.scenes.find(n => n.toLowerCase().includes(src.name.toLowerCase()));
}
/** OBS scene of a graphic: its Studio Mode mapping, else the scene of the matching scene source, else by name. */
export function obsSceneOfGfx(g: GfxInstance, st: ControllerState): string | undefined {
  if (g.obsScene) return g.obsScene;
  const key = pkgById(g.pkg)?.obsKey;
  const src = key ? REGISTRY.find(s => s.obsKey === key) : undefined;
  return (g.id === pkgById(g.pkg)?.id.replace(/^od\./, '') && src ? obsSceneOfSource(src, st) : undefined) ?? st.obs.scenes.find(n => n.toLowerCase().includes(g.name.toLowerCase()));
}

const conns = (st: ControllerState, route: string) => st.outputs.find(o => o.route === route)?.count ?? 0;

export function Library({ st, sel, onSelect, run }: { st: ControllerState; sel: string; onSelect: (k: string) => void; run: (c: ProducerCmd, l: string) => Promise<Ack> }) {
  const [closed, setClosed] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('od2.lib.closed') ?? '[]')); } catch { return new Set(); } });
  const toggle = (c: string) => setClosed(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); try { localStorage.setItem('od2.lib.closed', JSON.stringify([...n])); } catch {} return n; });
  const gs = st.graphics ?? [];
  const pgm = st.obs.currentScene, pvw = st.obs.studioMode ? st.obs.previewScene : undefined;
  const nGfx = gs.length, live = gs.filter(g => g.anim.action !== 'out').length;
  return (
    <div className="flex min-h-0 flex-col" style={{ background: C.panel }} data-library>
      <PanelHead label="Graphics library" info={`${nGfx} graphics · ${live} IN`} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {CATEGORIES.map(cat => {
          const g = gs.filter(x => gfxCategory(x) === cat);
          const s = REGISTRY.filter(x => sourceCategory(x) === cat);
          if (!g.length && !s.length) return null;
          const open = !closed.has(cat);
          return (
            <div key={cat} data-category={cat}>
              <button type="button" onClick={() => toggle(cat)} className={`flex w-full items-center gap-1.5 px-2.5 pb-0.5 pt-2 text-left ${LABEL} text-[11.5px] text-white/45 hover:text-white/70`}>
                <span className="w-2 text-[9px]">{open ? '▾' : '▸'}</span>{cat}<span className="font-mono text-[10px] font-normal tracking-normal text-white/25">{g.length + s.length}</span>
              </button>
              {open && g.map(x => {
                const h = st.gfxHealth?.[x.id], n = conns(st, `g/${x.id}`), obsName = obsSceneOfGfx(x, st);
                const out = x.anim.action === 'out', on = sel === `g:${x.id}`;
                return (
                  <div key={x.id} data-gfx-row={x.id} data-gfx-state={out ? 'out' : 'in'} className="group flex items-center" style={{ background: on ? 'rgba(42,109,244,.22)' : undefined, boxShadow: on ? `inset 2px 0 0 ${C.sel}` : undefined }}>
                    <span className="h-[26px] w-[3px] flex-none" style={{ background: obsName && obsName === pgm ? C.pgm : obsName && obsName === pvw ? C.pvw : 'transparent' }} title={obsName ? `OBS scene: ${obsName}` : 'No OBS scene mapped'} />
                    <button type="button" title={`/g/${x.id}${obsName ? ` · OBS: ${obsName}` : ''}`} onClick={() => onSelect(`g:${x.id}`)} className="flex h-[26px] min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-[12.5px] hover:bg-white/[0.04]">
                      <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold text-white' : 'text-white/85'}`}>{x.name}</span>
                      {x.draft && <DraftBadge small />}
                      {h && !h.ok && <span className="text-[11px] font-black" style={{ color: C.draft }} title={h.error}>⚠</span>}
                      <span className="w-[22px] text-right font-mono text-[10px]" style={{ color: n ? C.ok : C.faint }} title={`${n} browser source${n === 1 ? '' : 's'} connected`}>{n ? `●${n}` : '○'}</span>
                    </button>
                    <button type="button" data-gfx-quick={x.id} title={out ? 'Take IN (on its own source)' : 'Take OUT'} onClick={() => run({ c: 'gfx-anim', id: x.id, action: out ? 'in' : 'out' }, `${x.name} ${out ? 'IN' : 'OUT'}`)} className="mr-1.5 flex-none"><VisBadge out={out} small /></button>
                  </div>
                );
              })}
              {open && s.map(x => {
                const obsName = obsSceneOfSource(x, st), n = conns(st, x.route.replace(/^\/output\//, '').split('?')[0]), on = sel === x.id;
                return (
                  <div key={x.id} data-source-row={x.id} className="flex items-center" style={{ background: on ? 'rgba(42,109,244,.22)' : undefined, boxShadow: on ? `inset 2px 0 0 ${C.sel}` : undefined }}>
                    <span className="h-[24px] w-[3px] flex-none" style={{ background: obsName && obsName === pgm ? C.pgm : obsName && obsName === pvw ? C.pvw : 'transparent' }} />
                    <button type="button" title={`${x.route} (scene source, not migrated to the graphics engine yet)${obsName ? ` · OBS: ${obsName}` : ''}`} onClick={() => onSelect(x.id)} className="flex h-[24px] min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1.5 text-left text-[12px] hover:bg-white/[0.04]">
                      <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold text-white' : 'text-white/60'}`}>{x.name}</span>
                      {obsName && obsName === pgm && <span className="rounded-[2px] px-1 font-['Barlow_Condensed'] text-[10px] font-bold text-white" style={{ background: C.pgm }}>PGM</span>}
                      <span className="font-['Barlow_Condensed'] text-[10px] font-bold tracking-[0.08em] text-white/25">SCENE</span>
                      <span className="w-[22px] text-right font-mono text-[10px]" style={{ color: n ? C.ok : C.faint }}>{n ? `●${n}` : '○'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Library entries in display order (for keyboard navigation). */
export function libraryOrder(st: ControllerState): string[] {
  const gs = st.graphics ?? [];
  return CATEGORIES.flatMap(cat => [...gs.filter(g => gfxCategory(g) === cat).map(g => `g:${g.id}`), ...REGISTRY.filter(s => sourceCategory(s) === cat).map(s => s.id)]);
}

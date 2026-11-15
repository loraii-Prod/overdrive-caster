/**
 * Studio Mode · MVP & portraits. The portrait manager for the MVP package (and every graphic that draws players):
 * one picture per player (linked to the stable player id), its framing (zoom / position) shared by every graphic,
 * previews drawn by the graphics' own renderer at the show's output scale, and a native-4K quality check per use.
 * Uploads use the existing asset pipeline (/api/upload, role "portrait"); every change is an acknowledged command.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ControllerState } from '../../../shared/types';
import { MAJOR_PROFILES } from '../../../shared/major';
import { wcResolve } from '../../../shared/wildcard';
import { DEFAULT_FRAME, PORTRAIT_BOXES, gradePortrait, neededSize, portraitKey, portraitPlayerId, type PortraitFrame, type PortraitGrade } from '../../../shared/portraits';
import { isProvisional } from '../../../shared/playerIds';
import { PortraitPreview, preloadPortrait } from '../../gfx/audience';
import type { Ctx, Run } from '../producer/modules';
import { Btn, COND, Card, Fit169, I, LargeView, Pill, S } from './kit';

type Info = { url: string; w: number; h: number; cutout: boolean };
function useInfo(url: string) {
  const [i, setI] = useState<Info | null>(null);
  useEffect(() => { let on = true; setI(null); if (url) preloadPortrait(url).then(r => on && setI(r)); return () => { on = false; }; }, [url]);
  return i;
}
const GRADE: Record<PortraitGrade, { tone: 'ok' | 'warn' | 'bad'; text: string }> = { native: { tone: 'ok', text: 'Native 4K' }, good: { tone: 'ok', text: '4K ≤1.25×' }, small: { tone: 'warn', text: 'Too small for 4K' } };

/** Box each use draws a portrait in (photos sit in a 3:4 frame on the reveals). */
function boxFor(use: 'card' | 'hero' | 'compare', cutout: boolean) {
  if (use === 'card') return cutout ? PORTRAIT_BOXES.card : PORTRAIT_BOXES.cardPhoto;
  if (cutout) return use === 'hero' ? PORTRAIT_BOXES.hero : PORTRAIT_BOXES.compare;
  const fw = use === 'hero' ? 640 : 460;
  return { w: fw, h: fw / 0.75 };
}

export function PortraitManager({ st, x, run }: { st: ControllerState; x: Ctx; run: Run }) {
  const wc = x.wc, photos = wc.showcase.photos, frames = wc.showcase.frames ?? {};
  const ds = st.obsSetup?.options.profile === 'uhd' ? 2 : 1;
  const cast = wc.cast ? wcResolve(wc.matches, wc.teams)[wc.cast] : undefined;
  const players = useMemo(() => [...MAJOR_PROFILES].sort((a, b) => Number(b.team === cast?.t1 || b.team === cast?.t2) - Number(a.team === cast?.t1 || a.team === cast?.t2)), [cast?.t1, cast?.t2]);
  const [sel, setSel] = useState(players[0]?.handle ?? '');
  const p = players.find(q => q.handle === sel) ?? players[0];
  const key = p ? portraitKey(p.handle) : '', url = photos[key] ?? '', id = p ? portraitPlayerId(p.handle) : null;
  const [local, setLocal] = useState<PortraitFrame | null>(null);
  useEffect(() => setLocal(null), [sel]);
  const frame = local ?? frames[key] ?? DEFAULT_FRAME;
  const info = useInfo(url);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const commit = (f: PortraitFrame | null) => run({ c: 'op-wc', op: { k: 'photo-frame', player: p!.handle, frame: f } }, `${p!.handle}: portrait framing`).then(a => { if (a.ok) setLocal(null); });
  const upload = async (f?: File) => {
    if (!f || !p) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/upload?role=portrait&ref=${encodeURIComponent(id ?? '')}`, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error ?? `Upload failed (${r.status})`);
      const a = await run({ c: 'op-wc', op: { k: 'photo', player: p.handle, url: j.url } }, `${p.handle}: portrait`);
      setMsg(a.ok ? { ok: j.durable !== false, t: j.durable === false ? j.warning ?? 'Stored on this server only' : 'Portrait replaced: every graphic uses it now (preloaded before it goes on air).' } : { ok: false, t: a.error ?? 'Refused' });
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setBusy(false); }
  };
  const slider = (k: keyof PortraitFrame, lo: number, hi: number, st2: number, label: string, fmt: (v: number) => string) => (
    <label className="flex items-center gap-3">
      <span className={`${COND} w-[92px] text-[13px] tracking-[0.12em] text-white/55`}>{label}</span>
      <input aria-label={`${label} of ${p?.handle}`} type="range" min={lo} max={hi} step={st2} value={frame[k]} disabled={!url}
        onChange={e => setLocal({ ...frame, [k]: Number(e.target.value) })} onPointerUp={() => local && commit(local)} onKeyUp={() => local && commit(local)}
        className="min-w-0 flex-1 accent-[#ff3b1f]" />
      <span className="w-[64px] text-right font-mono text-[13px] text-white/75">{fmt(frame[k])}</span>
    </label>
  );
  const uses: ['card' | 'hero' | 'compare', string][] = [['card', 'Voting card'], ['hero', 'Winner reveal'], ['compare', 'Comparison']];
  const [big, setBig] = useState<'card' | 'hero' | 'compare' | null>(null);
  return (
    <div className="grid h-full min-h-0 gap-3" style={{ gridTemplateColumns: 'minmax(300px, 360px) minmax(0, 1fr)' }} data-portrait-manager>
      <Card fill title="Players" icon={I.talent} bodyClass="overflow-y-auto p-2" actions={<span className="text-[12.5px] text-white/45">{Object.keys(photos).length}/{players.length} portraits</span>}>
        {players.map(q => {
          const k = portraitKey(q.handle), u = photos[k], on = q.handle === p?.handle, inCast = q.team === cast?.t1 || q.team === cast?.t2;
          return (
            <button key={q.handle} type="button" onClick={() => setSel(q.handle)} data-portrait-player={q.handle}
              className="mb-1 flex w-full items-center gap-3 rounded-[8px] border px-2 py-1.5 text-left transition" style={{ borderColor: on ? S.accent : 'transparent', background: on ? S.accentSoft : 'rgba(255,255,255,.02)' }}>
              <span className="grid h-[52px] w-[40px] flex-none place-items-center overflow-hidden rounded-[4px]" style={{ background: 'repeating-conic-gradient(#222 0 25%, #191919 0 50%) 0 0/10px 10px' }}>
                {u ? <img src={u} alt="" className="h-full w-full object-contain" /> : <span className="text-[10px] text-white/30">—</span>}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{q.handle}</span><span className="block truncate text-[12px] text-white/45">{q.team}{inCast ? ' · cast match' : ''}</span></span>
              {frames[k] && <span className="text-[11px] text-white/45" title="Custom framing">✎</span>}
              <span className="h-[8px] w-[8px] flex-none rounded-full" style={{ background: u ? S.ok : 'rgba(255,255,255,.2)' }} />
            </button>
          );
        })}
      </Card>
      {p && (
        <Card fill title={<span className="flex items-center gap-2">{p.handle}<span className="text-[13px] font-normal normal-case tracking-normal text-white/45">{p.team} · player id {id ?? 'none'}{id && isProvisional(id) ? ' (provisional)' : ''}</span></span>} icon={I.eye} bodyClass="overflow-y-auto p-4"
          actions={<>
            <label className={`${COND} inline-flex h-[30px] cursor-pointer items-center rounded-[6px] border px-2.5 text-[13px] tracking-[0.06em]`} style={{ borderColor: S.line2 }}>
              {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {url && <Btn size="sm" kind="danger" onClick={() => { if (confirm(`Remove ${p.handle}'s portrait? Graphics show the team fallback.`)) run({ c: 'op-wc', op: { k: 'photo', player: p.handle, url: null } }, `${p.handle}: portrait removed`); }}>Remove</Btn>}
          </>} data-portrait-editor={p.handle}>
          <div className="mb-3 grid gap-3" style={{ gridTemplateColumns: '300fr 760fr 640fr' }}>
            {uses.map(([u, l]) => (
              <div key={u} className="min-w-0">
                <div className="mb-1.5 flex items-center gap-2"><span className={`${COND} text-[13px] tracking-[0.12em] text-white/60`}>{l}</span>
                  {info && <Pill tone={GRADE[gradePortrait(info, boxFor(u, info.cutout), frame, 2)].tone}>{GRADE[gradePortrait(info, boxFor(u, info.cutout), frame, 2)].text}</Pill>}</div>
                <Fit169 w={u === 'card' ? 300 : u === 'hero' ? 760 : 640} h={u === 'card' ? 470 : 1080} className="h-[clamp(300px,40vh,640px)] cursor-zoom-in rounded-[8px] bg-black/40" onClick={() => setBig(u)}>
                  <PortraitPreview url={url} handle={p.handle} team={p.team} frame={frame} kind={u} scale={ds} />
                </Fit169>
              </div>
            ))}
          </div>
          {big && <LargeView title={<>{p.handle} · {uses.find(x => x[0] === big)?.[1]} <span className="text-white/45">· as drawn at {ds === 2 ? '4K' : '1080p'}</span></>} onClose={() => setBig(null)} w={big === 'card' ? 300 : big === 'hero' ? 760 : 640} h={big === 'card' ? 470 : 1080}>
            <PortraitPreview url={url} handle={p.handle} team={p.team} frame={frame} kind={big} scale={ds} />
          </LargeView>}
          <div className="grid gap-6" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(260px, 0.8fr)' }}>
            <div className="space-y-3">
              {slider('zoom', 0.5, 3, 0.05, 'Zoom', v => `${Math.round(v * 100)}%`)}
              {slider('x', -50, 50, 1, 'Left / right', v => `${v > 0 ? '+' : ''}${v}%`)}
              {slider('y', -50, 50, 1, 'Up / down', v => `${v > 0 ? '+' : ''}${v}%`)}
              <div className="flex gap-2">
                <Btn size="sm" disabled={!url || (!frames[key] && !local)} onClick={() => commit(null)}>Reset framing</Btn>
                {local && <span className="text-[13px] text-white/50">Release the slider to save (all graphics use it).</span>}
              </div>
            </div>
            <div className="space-y-2 text-[13.5px]" data-portrait-info>
              {!url ? <div className="text-white/50">No portrait: the graphics show the team mark instead. Upload a transparent PNG or WebP cut-out (upper body, face clearly visible), or a JPG photo.</div> : !info ? <div className="text-white/50">Loading…</div> : <>
                <div><span className="text-white/45">File</span> <b>{info.w}×{info.h}</b> · {info.cutout ? 'transparent cut-out' : 'photo (framed from the top)'}</div>
                <div><span className="text-white/45">Native at 4K on the winner reveal</span> <b>{(() => { const n = neededSize(boxFor('hero', info.cutout), info.cutout, info.w / info.h, 2); return `${n.w}×${n.h}`; })()}</b> or larger</div>
                <div className="text-white/50">{ds === 2 ? 'Previews show the 4K output (this show is set to 4K UHD).' : 'This show outputs 1080p; the grades show how the file would hold up at 4K.'} A file too small for a use is drawn smaller there, never stretched.</div>
              </>}
              {msg && <div style={{ color: msg.ok ? '#5fd99a' : S.warn }}>{msg.t}</div>}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

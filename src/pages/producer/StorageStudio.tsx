/**
 * Studio Mode: the asset library (one registry: portraits by stable player id, logos, map photos, media, music) and
 * show-state recovery (database mirror + storage snapshots). Uploads go through the same /api/upload the Wildcard
 * tab uses, so both screens show the same portraits.
 */
import { useEffect, useState } from 'react';
import { MAJOR_PROFILES } from '../../../shared/major';
import { isProvisional, playerIdOf } from '../../../shared/playerIds';
import type { WildcardState, WcOp } from '../../../shared/wildcard';
import { Btn, PVW, WARN } from './modules';
import { LABEL } from './ws';

interface Asset { id: string; role: string; ref: string | null; path: string; size: number; mime: string; w?: number; h?: number; alpha?: boolean; status: string; stored: boolean; state?: string; lastError?: string; created: number }
interface Report { at: number; storage: string; scanned: number; registered: number; uploaded: number; already: number; failed: { path: string; error: string }[]; references: { where: string; url: string; ok: boolean }[]; unmatched: { where: string; key: string; note: string }[] }

const kb = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function AssetLibrary({ wc, wcOp }: { wc: WildcardState; wcOp: (op: WcOp) => void }) {
  const [d, setD] = useState<{ storage: string; assets: Asset[]; report: Report | null } | null>(null);
  const [busy, setBusy] = useState(''), [err, setErr] = useState('');
  const load = () => fetch('/api/assets', { cache: 'no-store' }).then(r => r.json()).then(setD).catch(() => setErr('Asset list unavailable'));
  useEffect(() => { load(); }, []);
  const byPath = new Map((d?.assets ?? []).map(a => [a.path, a]));
  const upload = async (handle: string, f: File | undefined) => {
    if (!f) return;
    setBusy(handle); setErr('');
    try {
      const id = playerIdOf(handle) ?? '';
      const r = await fetch(`/api/upload?role=portrait&ref=${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error ?? `Upload failed (${r.status})`);
      wcOp({ k: 'photo', player: handle, url: j.url }); // the existing association (nickname key), linked to the id
      if (j.durable === false) setErr(`${handle}: ${j.warning}`);
      await load();
    } catch (e: any) { setErr(`${handle}: ${e.message ?? e}`); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-3 p-3 text-[12px]" data-asset-library>
      <div className="flex items-center gap-3">
        <span className={`${LABEL} text-[12.5px] text-white/80`}>Asset library</span>
        <span style={{ color: d?.storage === 'r2' ? PVW : WARN }}>{d?.storage === 'r2' ? '● Durable storage (R2): uploads survive deploys' : '● Local disk only: storage not configured, uploads are lost on a Render deploy'}</span>
        <Btn onClick={async () => { setBusy('migrate'); await fetch('/api/assets/migrate', { method: 'POST' }); await load(); setBusy(''); }} disabled={busy === 'migrate'}>Re-run migration check</Btn>
      </div>
      {err && <div style={{ color: WARN }}>{err}</div>}
      <div>
        <div className="mb-1 text-white/60">Player portraits · linked to stable player ids. Replacing one updates the graphics at once (no rebuild). Transparent PNG/WebP, 900 px tall or more, works best.</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {MAJOR_PROFILES.map(p => {
            const id = playerIdOf(p.handle) ?? '—', url = wc.showcase.photos[p.handle.toLowerCase().replace(/[^a-z0-9]/g, '')], a = url ? byPath.get(url) : undefined;
            const low = a?.h != null && a.h < 900;
            return (
              <div key={p.handle} data-portrait={id} className="rounded-[2px] border border-white/10 bg-black/30 p-1.5">
                <div className="mb-1 grid aspect-[3/4] place-items-center overflow-hidden" style={{ background: 'repeating-conic-gradient(#222 0 25%, #1a1a1a 0 50%) 0 0/16px 16px' }}>
                  {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <span className="text-white/30">no portrait</span>}
                </div>
                <div className="font-bold">{p.handle} <span className="font-normal text-white/40">{p.team}</span></div>
                <div className="font-mono text-[10.5px] text-white/45">{id}{isProvisional(id) ? ' · provisional' : ''}</div>
                {a && <div className="text-[10.5px]" style={{ color: low ? WARN : 'rgba(255,255,255,.5)' }}>{a.w}×{a.h}{a.alpha ? ' · transparent' : ''} · {kb(a.size)}{a.state && a.state !== 'stored' ? ` · ${a.state === 'local' ? 'this server only' : a.state.toUpperCase()}` : ''}{low ? ' · low resolution' : ''}</div>}
                <label className="mt-1 inline-block cursor-pointer rounded-[2px] border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/40">{busy === p.handle ? 'Uploading…' : url ? 'Replace' : 'Upload'}
                  <input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={e => upload(p.handle, e.target.files?.[0])} /></label>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-1 text-white/60">All registered assets ({d?.assets.length ?? 0})</div>
        <div className="max-h-[220px] overflow-y-auto border border-white/10">
          {(d?.assets ?? []).slice().sort((x, y) => y.created - x.created).map(a => (
            <div key={a.path} className="flex gap-2 border-b border-white/[0.06] px-2 py-0.5 font-mono text-[11px]">
              <span className="w-[70px] text-white/60">{a.role}</span><span className="w-[90px] truncate">{a.ref ?? ''}</span><span className="flex-1 truncate">{a.path}</span>
              <span className="w-[70px] text-right">{kb(a.size)}</span><span className="w-[70px]" title={a.lastError} style={{ color: a.state === 'stored' ? PVW : WARN }}>{a.state ?? (a.stored ? 'stored' : 'pending')}</span><span className="w-[60px]">{a.status}</span>
            </div>
          ))}
        </div>
      </div>
      {d?.report && (
        <div data-migration-report>
          <div className="mb-1 text-white/60">Migration report · {new Date(d.report.at).toLocaleString()}</div>
          <div>{d.report.scanned} files on this server · {d.report.registered} registered · {d.report.uploaded} copied to storage · {d.report.already} already stored · {d.report.failed.length} failed</div>
          {d.report.failed.map(f => <div key={f.path} style={{ color: WARN }}>✕ {f.path}: {f.error}</div>)}
          {d.report.references.filter(r => !r.ok).map(r => <div key={r.where + r.url} style={{ color: WARN }}>Missing file: {r.where} → {r.url}</div>)}
          {d.report.unmatched.map(u => <div key={u.key} className="text-white/55">Not linked: {u.where} “{u.key}”: {u.note}</div>)}
          {!d.report.failed.length && !d.report.references.some(r => !r.ok) && <div style={{ color: PVW }}>Every saved reference points at an existing file.</div>}
        </div>
      )}
    </div>
  );
}

interface Persist { status: { database: string; snapshots: string; encrypted: boolean; lastMirror: number; lastSnapshot: number; rev: number; restoredFrom: string; error: string | null }; snapshots: { key: string; size: number }[]; history: { rev: number; at: number; reason: string }[] }

export function Recovery() {
  const [p, setP] = useState<Persist | null>(null), [msg, setMsg] = useState(''), [sel, setSel] = useState(''), [confirm, setConfirm] = useState('');
  const load = () => fetch('/api/persist', { cache: 'no-store' }).then(r => r.json()).then(setP).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  const s = p?.status;
  const dot = (v?: string) => <b style={{ color: v === 'ok' ? PVW : v === 'off' ? 'rgba(255,255,255,.4)' : WARN }}>{v === 'ok' ? 'on' : v ?? '…'}</b>;
  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-3" data-recovery>
      <div className={`${LABEL} text-[12.5px] text-white/80`}>Durable show state and recovery</div>
      <div className="max-w-[760px] text-white/55">Every change (graphics, rundown, talent and positions, studio layouts, presets, bracket, audience settings) is saved here and mirrored to the database within a second. Versioned recovery snapshots go to private storage every 10 minutes and on shutdown.</div>
      {s && <div className="space-x-4">
        <span>Database mirror {dot(s.database)}{s.lastMirror ? ` · ${new Date(s.lastMirror).toLocaleTimeString()} · rev ${s.rev}` : ''}</span>
        <span>Snapshots {dot(s.snapshots)}{s.encrypted ? ' · encrypted' : s.snapshots === 'ok' ? ' · NOT encrypted (set STATE_SNAPSHOT_KEY)' : ''}{s.lastSnapshot ? ` · last ${new Date(s.lastSnapshot).toLocaleTimeString()}` : ''}</span>
        <span>This start: {s.restoredFrom === 'database' ? 'restored from the database' : s.restoredFrom === 'snapshot' ? 'restored from a snapshot' : s.restoredFrom === 'fresh' ? 'new, empty show' : 'local copy'}</span>
        {s.error && <span style={{ color: WARN }}>{s.error}</span>}
      </div>}
      <div className="flex flex-wrap items-center gap-1">
        <Btn disabled={s?.snapshots !== 'ok'} onClick={async () => { const r = await fetch('/api/persist/snapshot', { method: 'POST' }); const j = await r.json(); setMsg(r.ok ? `Snapshot saved: ${j.key.split('/').pop()}` : j.error); load(); }}>Snapshot now</Btn>
        <select value={sel} onChange={e => setSel(e.target.value)} className="h-[26px] max-w-[420px] rounded-[2px] border border-white/15 bg-black px-1 text-[11.5px]">
          <option value="">Restore a snapshot…</option>{(p?.snapshots ?? []).map(x => <option key={x.key} value={x.key}>{x.key.split('/').pop()}</option>)}
        </select>
        {sel && <><input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="type RESTORE" className="h-[26px] w-[110px] rounded-[2px] border border-white/15 bg-black px-1 text-[11.5px]" />
          <Btn danger disabled={confirm !== 'RESTORE'} onClick={async () => { const r = await fetch('/api/persist/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: sel, confirm }) }); const j = await r.json(); setMsg(r.ok ? j.note : j.error); }}>Restore (restarts the server)</Btn></>}
      </div>
      {msg && <div style={{ color: PVW }}>{msg}</div>}
      {!!p?.history.length && <div className="text-[11px] text-white/45">Database history: {p.history.slice(0, 8).map(h => `${new Date(h.at).toLocaleTimeString()} r${h.rev} ${h.reason}`).join(' · ')}</div>}
    </div>
  );
}

/**
 * Durable-storage status for every producer screen: shows only when something is NOT safely stored (uploads waiting
 * for storage, failed, lost, or storage not configured while uploads exist). Never claims "saved" for a file that
 * exists only on this server's disk.
 */
import { useEffect, useState } from 'react';

interface H { storage: string; stored: number; pending: number; failed: number; lost: number; local: number; health: { ok: boolean; lastError: string }; attention: { path: string; role: string; ref: string | null; state: string; lastError?: string; nextTry?: number }[] }

export function StorageBanner() {
  const [h, setH] = useState<H | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const load = () => fetch('/api/assets/health', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(setH).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  if (!h) return null;
  const bad = h.failed + h.lost, waiting = h.pending;
  if (!bad && !waiting && !(h.storage === 'local' && h.local > 0)) return null;
  const red = bad > 0;
  const text = h.storage === 'local' && !bad && !waiting
    ? `${h.local} uploaded file${h.local === 1 ? '' : 's'} only on this server: durable storage is not configured (lost on the next deploy)`
    : [waiting && `${waiting} upload${waiting === 1 ? '' : 's'} not yet in durable storage, retrying`, h.failed && `${h.failed} failed`, h.lost && `${h.lost} lost (upload again)`].filter(Boolean).join(' · ');
  return (
    <div data-storage-banner={red ? 'error' : 'pending'} className="fixed left-1/2 top-1 z-[9999] max-w-[90vw] -translate-x-1/2 rounded-[3px] px-3 py-1 text-[12px] font-bold shadow-lg"
      style={{ background: red ? '#5a0d10' : '#4a3300', color: red ? '#ffb4b0' : '#ffd479', border: `1px solid ${red ? '#ff5a52' : '#e0a400'}` }}>
      <button onClick={() => setOpen(o => !o)} className="mr-2">{red ? '⚠' : '⟳'} {text}{!h.health.ok && h.health.lastError ? ` · storage: ${h.health.lastError}` : ''}</button>
      {(waiting > 0 || h.failed > 0) && <button disabled={busy} onClick={async () => { setBusy(true); await fetch('/api/assets/retry', { method: 'POST' }).catch(() => {}); await load(); setBusy(false); }} className="rounded-[2px] border border-current px-1.5">{busy ? 'Retrying…' : 'Retry now'}</button>}
      {open && <div className="mt-1 max-h-[180px] overflow-y-auto font-mono text-[11px] font-normal">
        {h.attention.map(a => <div key={a.path}>{a.state.toUpperCase()} · {a.role}{a.ref ? ` ${a.ref}` : ''} · {a.path}{a.lastError ? ` · ${a.lastError}` : ''}{a.state === 'pending' && a.nextTry ? ` · next try ${new Date(a.nextTry).toLocaleTimeString()}` : ''}</div>)}
      </div>}
    </div>
  );
}

/** Message to show after an upload whose answer says it is not durable yet. */
export const uploadWarning = (j: { durable?: boolean; warning?: string }) => (j && j.durable === false && j.warning ? j.warning : '');

import { useState } from 'react';
import { Logo, Pattern } from '../../components/Brand';

export function Login({ onDone, title = 'CASTER CONTROL', note, producerOnly }: { onDone: () => void; title?: string; note?: string; producerOnly?: boolean }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        // The admin password signs in too, but only opens /admin: say so instead of bouncing there.
        if (producerOnly && j.role !== 'producer') { setErr('That is the tournament admin password. Use the producer password (shown as “Producer password” in the server window).'); return; }
        onDone();
      }
      else setErr((await r.json().catch(() => ({}))).error ?? 'Sign-in failed.');
    } catch {
      setErr('Server unreachable.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#141414] text-white">
      <Pattern opacity={0.45} drift />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(20,20,20,0.6) 0%, rgba(12,12,12,0.95) 70%)' }} />
      <form onSubmit={submit} className="relative w-[360px] rounded-xl border border-white/10 bg-[#161616]/90 p-8 backdrop-blur">
        <Logo height={72} className="mx-auto mb-8" />
        <div className="mb-6 text-center font-display text-[12px] font-semibold tracking-[0.28em] text-white/60">{title}</div>
        {note && <p className="-mt-3 mb-4 text-center text-[12px] leading-relaxed text-white/55">{note}</p>}
        <input autoFocus type="password" className="input w-full" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} />
        {err && <p className="mt-3 text-[12px] text-red-300">{err}</p>}
        <button type="submit" className="btn-primary mt-5 w-full" disabled={busy || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

import { teamLogo } from '../../shared/major';
import { matchName, wcResolve, type WildcardState } from '../../shared/wildcard';
import type { Caster } from '../../shared/types';

/** Caster page: the match on cast, its series score, and everyone's picks (yours highlighted). */
export function MatchStrip({ wc, slot, casters }: { wc: WildcardState | null | undefined; slot: number; casters?: { id: number; name: string }[] }) {
  if (!wc?.cast) return null;
  const r = wcResolve(wc.matches, wc.teams)[wc.cast], m = wc.matches[wc.cast];
  if (!r?.t1 || !r.t2) return null;
  const picks = Object.entries(wc.intro.picks);
  const nameOf = (k: string) => casters?.find(c => String(c.id) === k)?.name || (Number(k) === slot ? 'You' : `Slot ${k}`);
  const team = (t: string) => <span className="flex min-w-0 items-center gap-2">{teamLogo(t) && <img src={teamLogo(t)} alt="" className="h-7 w-7 object-contain" />}<b className="truncate">{t}</b></span>;
  return (
    <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">
        On cast · {matchName(wc.cast)}{m.live && <span className="text-[#ff8a8d]">● live</span>}
      </div>
      <div className="flex items-center gap-4 text-[17px]">
        {team(r.t1)}
        <span className="font-display text-[26px] font-semibold tabular-nums">{m.s1 || 0}<span className="mx-1.5 text-white/35">–</span>{m.s2 || 0}</span>
        {team(r.t2)}
        <span className="ml-auto text-[12px] text-white/40">First to 3</span>
      </div>
      {picks.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[12.5px]">
          <span className="self-center text-[11px] uppercase tracking-[0.16em] text-white/40">Picks</span>
          {picks.map(([k, p]) => (
            <span key={k} className={`rounded px-2 py-1 ${Number(k) === slot ? 'bg-[#e5484d]/25 text-white' : 'bg-black/30 text-white/75'}`}>
              {nameOf(k)}: <b>{p.team}</b>{p.score ? ` ${p.score}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export type { Caster };

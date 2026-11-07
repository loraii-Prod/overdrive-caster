import { Logo } from '../components/Brand';
import { ScaledCanvas } from '../components/Stage';
import { Program } from '../components/show/Program';
import { RosView } from '../components/RosView';
import { StatusPill } from './Contribute';
import { useBnl, useConnState, useLive, useNow, useRos, useSocket, useTournament, query } from '../lib/hooks';

/** /crew?key=… — read-only page for casters & crew: what's on air + run of show + producer messages. */
export function Crew() {
  const sock = useSocket({ role: 'crew', key: query().get('key') ?? '' });
  const conn = useConnState(sock);
  const live = useLive(sock);
  const ros = useRos(sock);
  const tournament = useTournament(sock);
  const bnl = useBnl(sock);
  const now = useNow(ros?.skew ?? live?.skew ?? 0, 500);
  return (
    <div className="min-h-screen bg-[#121212] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Logo height={46} />
            <div className="font-display text-[13px] font-semibold tracking-[0.24em] text-white/70">CREW · RUN OF SHOW</div>
          </div>
          <StatusPill conn={conn} />
        </div>
        {conn === 'denied' ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">This crew link is invalid or has been replaced. Ask the producer for the current link.</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_440px]">
            <div>{ros ? <RosView ros={ros.ros} now={now} /> : <div className="text-white/40">Connecting…</div>}</div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-[3px] bg-[#e5484d] px-2 py-[3px] text-[10px] font-bold tracking-[0.2em]">ON AIR</span>
                <span className="text-[11px] text-white/40">Cameras not shown here</span>
              </div>
              <div className="monitor-bg aspect-video overflow-hidden rounded-md border border-[#e5484d]/50">
                <ScaledCanvas>{live && <Program scene={live.scene} show={live.show} now={now} tournament={tournament} viewer={null} embeds={false} bnl={bnl} />}</ScaledCanvas>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

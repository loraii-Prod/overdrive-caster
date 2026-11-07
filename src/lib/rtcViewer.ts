import type { Socket } from './socket';
import type { RtcSignal } from '../../shared/protocol';
import type { CasterId } from '../../shared/types';

interface Want { video: boolean; audio: boolean }

interface Peer {
  pc: RTCPeerConnection;
  pcId: string;
  from: string;
  pendingIce: RTCIceCandidateInit[];
  stream: MediaStream;
}

type StreamListener = (s: MediaStream | null) => void;

/**
 * Receives remote caster cameras. One RTCPeerConnection per slot, owned here
 * (not by React components), so hiding/showing a camera tile or switching
 * layouts never tears down the connection.
 */
export class RtcViewer {
  private ice: RTCIceServer[] = [];
  private wants = new Map<CasterId, Want>();
  private peers = new Map<CasterId, Peer>();
  private listeners = new Map<CasterId, Set<StreamListener>>();
  private streams = new Map<CasterId, MediaStream | null>();
  private releaseTimers = new Map<CasterId, number>();
  private off: () => void;

  constructor(private sock: Socket, private quality: 'hq' | 'lq') {
    this.off = sock.on(m => {
      if (m.t === 'welcome') {
        this.ice = m.iceServers;
        for (const slot of [...this.peers.keys()]) this.drop(slot);
        for (const [slot, w] of this.wants) this.sock.send({ t: 'rtc-watch', slot, quality: this.quality, ...w });
      } else if (m.t === 'rtc-signal') {
        this.onSignal(m.slot, m.from, m.data);
      } else if (m.t === 'rtc-publisher' && !m.online) {
        this.drop(m.slot);
      }
    });
  }

  /** Keep a slot subscribed. Releases are delayed so quick toggles don't reconnect. */
  setWanted(next: Map<CasterId, Want>) {
    for (const [slot, w] of next) {
      const t = this.releaseTimers.get(slot);
      if (t) { clearTimeout(t); this.releaseTimers.delete(slot); }
      const cur = this.wants.get(slot);
      if (!cur || cur.video !== w.video || cur.audio !== w.audio) {
        this.wants.set(slot, w);
        this.sock.send({ t: 'rtc-watch', slot, quality: this.quality, ...w });
      }
    }
    for (const slot of this.wants.keys()) {
      if (next.has(slot) || this.releaseTimers.has(slot)) continue;
      this.releaseTimers.set(slot, window.setTimeout(() => {
        this.releaseTimers.delete(slot);
        this.wants.delete(slot);
        this.sock.send({ t: 'rtc-unwatch', slot });
        this.drop(slot);
      }, 20_000));
    }
  }

  subscribe(slot: CasterId, l: StreamListener) {
    if (!this.listeners.has(slot)) this.listeners.set(slot, new Set());
    this.listeners.get(slot)!.add(l);
    l(this.streams.get(slot) ?? null);
    return () => { this.listeners.get(slot)?.delete(l); };
  }

  private emit(slot: CasterId, s: MediaStream | null) {
    this.streams.set(slot, s);
    this.listeners.get(slot)?.forEach(l => l(s));
  }

  private drop(slot: CasterId) {
    const p = this.peers.get(slot);
    if (p) { p.pc.ontrack = null; p.pc.onicecandidate = null; p.pc.onconnectionstatechange = null; p.pc.close(); }
    this.peers.delete(slot);
    if (this.streams.get(slot)) this.emit(slot, null);
  }

  private async onSignal(slot: CasterId, from: string, data: RtcSignal) {
    try {
      if (data.kind === 'offer') {
        this.drop(slot);
        const pc = new RTCPeerConnection({ iceServers: this.ice });
        const peer: Peer = { pc, pcId: data.pcId, from, pendingIce: [], stream: new MediaStream() };
        this.peers.set(slot, peer);
        pc.ontrack = e => {
          if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
          e.track.onunmute = () => this.emit(slot, peer.stream);
          this.emit(slot, peer.stream);
        };
        pc.onicecandidate = e => this.sock.send({ t: 'rtc-signal', to: from, data: { kind: 'ice', candidate: e.candidate?.toJSON() ?? null, pcId: peer.pcId } });
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed') {
            // Ask the publisher for a fresh offer (it may be behind a new NAT mapping).
            this.drop(slot);
            const w = this.wants.get(slot);
            if (w) { this.sock.send({ t: 'rtc-unwatch', slot }); this.sock.send({ t: 'rtc-watch', slot, quality: this.quality, ...w }); }
          }
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        for (const c of peer.pendingIce) await pc.addIceCandidate(c).catch(() => {});
        peer.pendingIce = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sock.send({ t: 'rtc-signal', to: from, data: { kind: 'answer', sdp: answer.sdp!, pcId: data.pcId } });
      } else if (data.kind === 'ice') {
        const p = this.peers.get(slot);
        if (!p || p.pcId !== data.pcId || !data.candidate) return;
        if (!p.pc.remoteDescription) p.pendingIce.push(data.candidate);
        else await p.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) {
      console.warn('[rtc] signal error', e);
    }
  }

  destroy() {
    this.off();
    for (const slot of [...this.peers.keys()]) this.drop(slot);
    this.releaseTimers.forEach(t => clearTimeout(t));
  }
}

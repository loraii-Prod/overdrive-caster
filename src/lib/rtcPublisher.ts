import type { Socket } from './socket';
import type { RtcSignal, WatchRequest } from '../../shared/protocol';

interface Peer {
  pc: RTCPeerConnection;
  pcId: string;
  req: WatchRequest;
  hadAudio: boolean;
  retry?: number;
  pendingIce: RTCIceCandidateInit[];
}

/**
 * Contributor side: sends the caster's camera (and optionally mic) to each
 * viewer that asks for it. Video viewers never get the mic and audio viewers
 * never get video, so nothing is mixed or duplicated – audio routing stays
 * with the producer in OBS.
 */
export class RtcPublisher {
  private ice: RTCIceServer[] = [];
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private pendingJoins = new Map<string, WatchRequest>();
  private off: () => void;
  onViewers?: (n: number) => void;

  constructor(private sock: Socket) {
    this.off = sock.on(m => {
      if (m.t === 'welcome') {
        this.ice = m.iceServers;
        for (const id of [...this.peers.keys()]) this.close(id); // server re-sends joins
        this.report();
      } else if (m.t === 'rtc-viewer-join') {
        this.pendingJoins.set(m.viewerId, m.req);
        if (this.stream) this.connect(m.viewerId, m.req);
      } else if (m.t === 'rtc-viewer-leave') {
        this.pendingJoins.delete(m.viewerId);
        this.close(m.viewerId);
      } else if (m.t === 'rtc-signal') {
        this.onSignal(m.from, m.data);
      }
    });
  }

  get hasAudio() { return !!this.stream?.getAudioTracks().some(t => t.readyState === 'live' && t.enabled); }

  /** Swap camera/mic without dropping viewers (replaceTrack, no renegotiation). */
  async setStream(next: MediaStream | null) {
    this.stream = next;
    if (!next) { for (const id of [...this.peers.keys()]) this.close(id); this.report(); return; }
    const v = next.getVideoTracks()[0] ?? null;
    const a = next.getAudioTracks()[0] ?? null;
    for (const [id, p] of this.peers) {
      if (p.req.audio && !!a !== p.hadAudio) { this.close(id); continue; } // needs renegotiation
      for (const t of p.pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        await t.sender.replaceTrack(kind === 'video' ? v : a).catch(() => {});
      }
    }
    for (const [id, req] of this.pendingJoins) if (!this.peers.has(id)) this.connect(id, req);
    this.report();
  }

  report(label?: string) {
    this.sock.send({ t: 'rtc-publish-state', publishing: !!this.stream, hasAudio: this.hasAudio, label: label ?? this.stream?.getVideoTracks()[0]?.label });
    this.onViewers?.(this.peers.size);
  }

  private close(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.retry);
    p.pc.onicecandidate = null; p.pc.onconnectionstatechange = null;
    p.pc.close();
    this.peers.delete(id);
    this.onViewers?.(this.peers.size);
  }

  private async connect(id: string, req: WatchRequest) {
    if (!this.stream) return;
    this.close(id);
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { pc, pcId: crypto.randomUUID(), req, hadAudio: false, pendingIce: [] };
    this.peers.set(id, peer);
    this.onViewers?.(this.peers.size);

    const v = this.stream.getVideoTracks()[0];
    const a = this.stream.getAudioTracks()[0];
    if (req.video && v) {
      const enc: RTCRtpEncodingParameters = req.quality === 'lq'
        ? { maxBitrate: 350_000, scaleResolutionDownBy: 3, maxFramerate: 24 }
        : { maxBitrate: 3_000_000, maxFramerate: 30 };
      pc.addTransceiver(v, { direction: 'sendonly', streams: [this.stream], sendEncodings: [enc] });
    }
    if (req.audio && a) {
      pc.addTransceiver(a, { direction: 'sendonly', streams: [this.stream] });
      peer.hadAudio = true;
    }
    pc.onicecandidate = e => this.sock.send({ t: 'rtc-signal', to: id, data: { kind: 'ice', candidate: e.candidate?.toJSON() ?? null, pcId: peer.pcId } });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        clearTimeout(peer.retry);
        // 'disconnected' often recovers on its own; give it a moment before rebuilding.
        peer.retry = window.setTimeout(() => {
          if (this.peers.get(id) === peer && pc.connectionState !== 'connected') this.connect(id, req);
        }, pc.connectionState === 'failed' ? 500 : 4000);
      }
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sock.send({ t: 'rtc-signal', to: id, data: { kind: 'offer', sdp: offer.sdp!, pcId: peer.pcId } });
    } catch (e) {
      console.warn('[rtc] offer failed', e);
    }
  }

  private async onSignal(from: string, data: RtcSignal) {
    const p = this.peers.get(from);
    if (!p || p.pcId !== data.pcId) return;
    try {
      if (data.kind === 'answer') {
        await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        for (const c of p.pendingIce) await p.pc.addIceCandidate(c).catch(() => {});
        p.pendingIce = [];
      } else if (data.kind === 'ice' && data.candidate) {
        if (!p.pc.remoteDescription) p.pendingIce.push(data.candidate);
        else await p.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) {
      console.warn('[rtc] answer failed', e);
    }
  }

  destroy() {
    this.off();
    for (const id of [...this.peers.keys()]) this.close(id);
  }
}

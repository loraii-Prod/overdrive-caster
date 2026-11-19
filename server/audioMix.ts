/**
 * Overdrive 3.0 · persistent talent audio, controlled through OBS WebSocket.
 *
 * Every voice has ONE path into OBS that never reloads when scenes change:
 *  - 'feed'  → the position's dedicated browser source "Overdrive Caster N audio" (/output/audio/N), which lives in
 *              the shared "Overdrive · Caster audio" scene nested in every Overdrive scene (Scene Builder);
 *  - 'obs'   → an OBS input that already exists (Discord / desktop capture, a mic, an audio interface or mixer channel);
 *  - 'none'  → nothing.
 *
 * What this module does (and only this, because only this is real OBS WebSocket functionality):
 *  - applies each person's fader (dB), mute, sync offset and monitoring to the OBS input that carries their voice;
 *  - silences the inputs that must not be heard: an empty position, a position whose talent speaks through another
 *    input (no double voice), the input of someone who is not in a position (no off-air chatter / talkback on air);
 *  - master talent mute;
 *  - level meters (InputVolumeMeters, throttled to 10 per second) per person;
 *  - health: missing input, muted by hand in OBS, echo risk (monitoring a desktop / application capture), input shared
 *    by two people, nothing heard from a live voice.
 * It never creates, deletes or re-routes OBS sources, never touches inputs that carry nobody's voice, and does not
 * pretend to route anything OBS cannot route (there is no talkback / IFB bus in OBS: see docs/AUDIO-3.0.md).
 */
import type { ObsCall } from './obsSetup';
import { SEATS, talentLabel, type Seat, type Seats, type TalentProfile } from '../shared/talent';
import type { AudioStatus, AudioIssue, AudioInputState } from '../shared/audio';
import { seatAudioInput, ECHO_KINDS, MONITOR_TYPES } from '../shared/audio';

export interface AudioDeps {
  call: () => ObsCall | null;
  talent: () => TalentProfile[];
  seats: () => Seats;
  master: () => boolean;
  onChange: () => void;
  meters: (m: Record<string, number>) => void;
}

interface Want { input: string; muted: boolean; volumeDb: number; syncMs: number; monitor: boolean; who: string[]; seat: number | null }

export function createAudioMix(d: AudioDeps) {
  let status: AudioStatus = { obs: false, master: false, inputs: [], talent: {}, seats: {}, issues: [], at: 0 };
  /** Last values we set per input, to tell "muted by hand in OBS" from our own change. */
  const applied = new Map<string, { muted: boolean; volumeDb: number }>();
  const overrides = new Set<string>();
  let busy: Promise<void> | null = null, again = false;
  const levels = new Map<string, number>(); // input → dBFS (peak of the last window)
  const lastHeard = new Map<string, number>(); // talent id → time a level above -50 dB was seen
  let meterTimer: NodeJS.Timeout | null = null;

  /** What every managed input should be, from the profiles and positions. */
  function plan(): Map<string, Want> {
    const talent = d.talent(), seats = d.seats(), master = d.master();
    const out = new Map<string, Want>();
    const want = (input: string, w: Omit<Want, 'input' | 'who' | 'seat'>, who: string | null, seat: number | null) => {
      const cur = out.get(input);
      if (!cur) { out.set(input, { input, ...w, who: who ? [who] : [], seat }); return; }
      // an input shared by several people: heard if any of them should be heard; the first one's fader wins
      if (who) cur.who.push(who);
      if (!w.muted && cur.muted) { cur.muted = false; cur.volumeDb = w.volumeDb; cur.syncMs = w.syncMs; }
      cur.monitor = cur.monitor || w.monitor;
    };
    for (const s of SEATS) {
      const t = talent.find(p => p.id === seats[s]);
      const input = seatAudioInput(s);
      if (t && t.audio.source === 'feed') want(input, { muted: master || t.audio.muted, volumeDb: t.audio.volumeDb, syncMs: t.audio.syncMs, monitor: t.audio.monitor }, t.id, s);
      else want(input, { muted: true, volumeDb: 0, syncMs: 0, monitor: false }, null, s); // empty, or voice comes from elsewhere
    }
    for (const t of talent) {
      if (t.audio.source !== 'obs' || !t.audio.input) continue;
      const seat = (SEATS as readonly Seat[]).find(s => seats[s] === t.id) ?? null;
      want(t.audio.input, { muted: master || t.audio.muted || seat == null, volumeDb: t.audio.volumeDb, syncMs: t.audio.syncMs, monitor: t.audio.monitor }, t.id, seat);
    }
    return out;
  }

  async function run(reason: string) {
    const call = d.call();
    if (!call) { status = { ...status, obs: false, master: d.master(), at: Date.now(), issues: offlineIssues() }; d.onChange(); return; }
    try {
      const list: { inputName: string; inputKind: string }[] = (await call('GetInputList', {}))?.inputs ?? [];
      const kinds = new Map(list.map(i => [i.inputName, i.inputKind]));
      const wants = plan();
      const inputs: Record<string, AudioInputState> = {};
      for (const w of wants.values()) {
        const kind = kinds.get(w.input);
        if (!kind) { inputs[w.input] = { input: w.input, exists: false, who: w.who, seat: w.seat }; continue; }
        const st: AudioInputState = { input: w.input, exists: true, kind, who: w.who, seat: w.seat };
        try {
          const [m, v, o, mon] = await Promise.all([
            call('GetInputMute', { inputName: w.input }), call('GetInputVolume', { inputName: w.input }),
            call('GetInputAudioSyncOffset', { inputName: w.input }), call('GetInputAudioMonitorType', { inputName: w.input }),
          ]);
          let muted = !!m?.inputMuted, vol = typeof v?.inputVolumeDb === 'number' ? v.inputVolumeDb : 0, sync = Number(o?.inputAudioSyncOffset ?? 0), monitor = String(mon?.monitorType ?? MONITOR_TYPES.off);
          // muted / faded by hand in OBS since our last change → respect the operator, report it (no tug of war)
          const last = applied.get(w.input);
          if (last && (last.muted !== muted || Math.abs(last.volumeDb - vol) > 0.5) && reason !== 'apply-all') overrides.add(w.input);
          if (!overrides.has(w.input)) {
            // record what we are about to set first: OBS echoes our own changes as events (InputMuteStateChanged)
            applied.set(w.input, { muted: w.muted, volumeDb: w.volumeDb });
            if (muted !== w.muted) { await call('SetInputMute', { inputName: w.input, inputMuted: w.muted }); muted = w.muted; }
            if (Math.abs(vol - w.volumeDb) > 0.05) { await call('SetInputVolume', { inputName: w.input, inputVolumeDb: w.volumeDb }); vol = w.volumeDb; }
            if (sync !== w.syncMs) { await call('SetInputAudioSyncOffset', { inputName: w.input, inputAudioSyncOffset: w.syncMs }); sync = w.syncMs; }
            const wantMon = w.monitor ? MONITOR_TYPES.both : MONITOR_TYPES.off;
            if (monitor !== wantMon) { await call('SetInputAudioMonitorType', { inputName: w.input, monitorType: wantMon }); monitor = wantMon; }
          }
          Object.assign(st, { muted, volumeDb: vol, syncMs: sync, monitor, override: overrides.has(w.input) });
        } catch (e) { st.error = (e as Error).message; }
        inputs[w.input] = st;
      }
      const talent = d.talent();
      status = {
        obs: true, master: d.master(), at: Date.now(),
        inputs: list.filter(i => !/^(browser_source|image_source|color_source|text_|game_capture|monitor_capture|window_capture|scene)/.test(i.inputKind) || i.inputName.startsWith('Overdrive Caster')).map(i => i.inputName).sort(),
        seats: Object.fromEntries(SEATS.map(s => [s, inputs[seatAudioInput(s)]])),
        talent: Object.fromEntries(talent.map(t => [t.id, t.audio.source === 'none' ? null : inputs[inputOf(t) ?? ''] ?? null])),
        issues: [],
      };
      status.issues = issuesOf(status, talent, d.seats());
    } catch (e) {
      status = { ...status, obs: true, at: Date.now(), issues: [{ code: 'obs-error', tone: 'bad', text: `OBS audio check failed: ${(e as Error).message}` }] };
    }
    d.onChange();
  }

  function inputOf(t: TalentProfile): string | null {
    if (t.audio.source === 'obs') return t.audio.input || null;
    if (t.audio.source === 'none') return null;
    const s = (SEATS as readonly Seat[]).find(x => d.seats()[x] === t.id);
    return s ? seatAudioInput(s) : null;
  }

  function offlineIssues(): AudioIssue[] {
    const anyone = d.talent().some(t => t.audio.source !== 'none' && (SEATS as readonly Seat[]).some(s => d.seats()[s] === t.id));
    return anyone ? [{ code: 'obs-offline', tone: 'warn', text: 'OBS is not connected: talent volume, mute and meters are not controlled.' }] : [];
  }

  function issuesOf(st: AudioStatus, talent: TalentProfile[], seats: Seats): AudioIssue[] {
    const out: AudioIssue[] = [];
    for (const t of talent) {
      const seat = (SEATS as readonly Seat[]).find(s => seats[s] === t.id);
      if (!seat || t.audio.source === 'none') continue;
      const name = talentLabel(t), i = st.talent[t.id];
      if (!i) continue;
      if (!i.exists) out.push(t.audio.source === 'obs'
        ? { code: 'input-missing', tone: 'bad', talent: t.id, text: `${name}: OBS has no input called "${t.audio.input}".`, fix: 'Pick their audio input again (Talent → audio)' }
        : { code: 'seat-audio-missing', tone: 'bad', talent: t.id, text: `${name}: OBS has no "${i.input}" source, so their voice is not in the show.`, fix: 'Studio → Sources & OBS → Scene Builder → Build (adds the shared caster audio scene)' });
      else {
        if (i.override) out.push({ code: 'override', tone: 'warn', talent: t.id, text: `${name}: "${i.input}" was ${i.muted ? 'muted' : 'changed'} by hand in OBS.`, fix: 'Apply Overdrive audio settings' });
        else if (i.muted && !t.audio.muted && !st.master) out.push({ code: 'muted', tone: 'warn', talent: t.id, text: `${name} is muted in OBS.` });
        if (i.monitor === MONITOR_TYPES.both && i.kind && ECHO_KINDS.test(i.kind)) out.push({ code: 'echo', tone: 'warn', talent: t.id, text: `${name}: monitoring a desktop / application capture ("${i.input}") can loop back into itself (echo).`, fix: 'Turn their monitoring off, or monitor on a device that capture does not record' });
        if (i.who.length > 1) out.push({ code: 'shared', tone: 'warn', talent: t.id, text: `"${i.input}" carries ${i.who.length} people: their faders and mutes are linked.` });
        const heard = lastHeard.get(t.id) ?? 0;
        if (!i.muted && levels.has(i.input) && Date.now() - heard > 30_000) out.push({ code: 'silent', tone: 'warn', talent: t.id, text: `${name}: nothing heard on "${i.input}" for 30 s.` });
      }
    }
    // a voice from another input while their camera link also carries audio: the position's source is kept silent
    for (const s of SEATS) {
      const t = talent.find(p => p.id === seats[s]); const i = st.seats[s];
      if (t && t.audio.source === 'obs' && i?.exists && i.muted === false) out.push({ code: 'duplicate', tone: 'bad', talent: t.id, text: `${talentLabel(t)} is heard twice: through "${t.audio.input}" and their camera link.`, fix: 'Apply Overdrive audio settings' });
    }
    return out;
  }

  /** Coalesced: a request during a pass schedules ONE more pass; the returned promise resolves after that pass. */
  let next: Promise<void> | null = null;
  function sync(reason = 'sync'): Promise<void> {
    if (busy) {
      again = true;
      return (next ??= (async () => { while (busy) await busy; })());
    }
    busy = run(reason).finally(() => { busy = null; if (again) { again = false; const n = next; next = null; void sync('again').then(() => n); } });
    return busy;
  }

  function onMeters(e: { inputs?: { inputName: string; inputLevelsMul?: number[][] }[] }) {
    const now = Date.now();
    for (const i of e.inputs ?? []) {
      const peak = Math.max(0, ...(i.inputLevelsMul ?? []).map(ch => Number(ch?.[1] ?? ch?.[0] ?? 0)));
      const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
      levels.set(i.inputName, Math.max(db, levels.get(i.inputName) ?? -60));
    }
    if (!meterTimer) meterTimer = setTimeout(() => {
      meterTimer = null;
      const out: Record<string, number> = {};
      for (const t of d.talent()) {
        const inp = inputOf(t); if (!inp || !levels.has(inp)) continue;
        const v = Math.round(levels.get(inp)!);
        out[t.id] = v;
        if (v > -50) lastHeard.set(t.id, now);
      }
      levels.forEach((_v, k) => levels.set(k, -60));
      if (Object.keys(out).length) d.meters(out);
    }, 100);
  }

  function onMute(e: { inputName?: string; inputMuted?: boolean }) {
    const last = e.inputName ? applied.get(e.inputName) : undefined;
    if (last && last.muted !== !!e.inputMuted) { overrides.add(e.inputName!); void sync('obs-event'); }
  }

  return {
    state: () => status,
    sync,
    onMeters,
    onMute,
    /** Re-apply every profile, overriding manual OBS changes (the producer asked for it). */
    async applyAll(): Promise<string | null> { if (!d.call()) return 'OBS is not connected'; overrides.clear(); applied.clear(); await sync('apply-all'); return null; },
    connected() { applied.clear(); overrides.clear(); void sync('connected'); },
  };
}
export type AudioMix = ReturnType<typeof createAudioMix>;

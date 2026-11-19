/**
 * Overdrive 3.0 · talent setup validation. Pure: the Talent Manager, the Green Room, the Health monitor and the
 * production checklist all read the same list, so a problem is reported the same way everywhere.
 *
 * Each issue says what is wrong in the producer's words and what to do about it. Nothing here needs to know how
 * browser sources are wired.
 */
import { SEATS, SEAT_LABELS, describeVdoLink, talentLabel, type Seat, type Seats, type TalentProfile } from './talent';
import type { AudioStatus } from './audio';

export type LiveTalent = TalentProfile & { online: boolean; publishing: boolean; hasAudio: boolean; seat: number | null };

export interface TalentIssue {
  code: 'name' | 'vdo-missing' | 'vdo-invalid' | 'vdo-duplicate' | 'cam-offline' | 'cam-no-video' | 'mic-missing' | 'audio-input' | 'audio-duplicate' | 'audio' | 'seat-empty' | 'not-ready';
  tone: 'bad' | 'warn' | 'info';
  /** Talent id (absent for a position problem). */
  talent?: string;
  seat?: number;
  text: string;
  /** What fixes it (shown as the recovery action). */
  fix?: string;
}

export interface CheckInput {
  talent: LiveTalent[];
  seats: Seats;
  audio?: AudioStatus;
  /** Positions the current desk layouts show (Caster desk booth + Analyst desk), e.g. [1, 2, 4, 5]. */
  needed?: number[];
}

const seatOfT = (seats: Seats, id: string) => (SEATS as readonly Seat[]).find(s => seats[s] === id) ?? null;

export function checkTalent({ talent, seats, audio, needed = [] }: CheckInput): TalentIssue[] {
  const out: TalentIssue[] = [];
  for (const t of talent) {
    const seat = seatOfT(seats, t.id);
    const inShow = !!seat;
    if (!inShow && !t.name.trim()) continue; // unused profile
    const name = talentLabel(t);
    if (!t.name.trim()) out.push({ code: 'name', tone: 'warn', talent: t.id, seat: seat ?? undefined, text: `${name}: no name (their nameplate would be empty).`, fix: 'Type their name' });
    if (t.mode === 'vdo') {
      if (!t.vdoSet) out.push({ code: 'vdo-missing', tone: inShow ? 'bad' : 'warn', talent: t.id, text: `${name}: camera set to VDO.Ninja but no link pasted yet.`, fix: 'Paste their VDO.Ninja push or view link' });
      else if (!describeVdoLink(t.vdoId).ok) out.push({ code: 'vdo-invalid', tone: 'bad', talent: t.id, text: `${name}: the VDO.Ninja stream ID is not valid.`, fix: 'Paste their VDO.Ninja link again' });
      const dup = talent.find(o => o.id !== t.id && o.mode === 'vdo' && o.vdoSet && o.vdoId === t.vdoId);
      if (t.vdoSet && dup) out.push({ code: 'vdo-duplicate', tone: 'bad', talent: t.id, text: `${name} and ${talentLabel(dup)} use the same VDO.Ninja stream.`, fix: 'Paste each person\'s own link' });
    } else if (inShow) {
      if (!t.online) out.push({ code: 'cam-offline', tone: 'bad', talent: t.id, seat: seat!, text: `${name} (${SEAT_LABELS[seat!]}) has not opened their camera link.`, fix: 'Send them their personal link (copy it from their card)' });
      else if (!t.publishing) out.push({ code: 'cam-no-video', tone: 'bad', talent: t.id, seat: seat!, text: `${name} is connected but not sending a camera.`, fix: 'Ask them to allow the camera and press Start on their page' });
      else if (!t.hasAudio && t.audio.source === 'feed') out.push({ code: 'mic-missing', tone: 'bad', talent: t.id, seat: seat!, text: `${name}'s link sends no microphone, and their voice is set to come from it.`, fix: 'Ask them to allow the microphone, or pick another audio source' });
    }
    if (t.audio.source === 'obs' && !t.audio.input.trim()) out.push({ code: 'audio-input', tone: inShow ? 'bad' : 'warn', talent: t.id, text: `${name}: voice set to an OBS input, but no input chosen.`, fix: 'Choose their OBS audio input' });
    if (inShow && !t.ready) out.push({ code: 'not-ready', tone: 'info', talent: t.id, seat: seat!, text: `${name} is not marked ready.`, fix: 'Check them in the Green Room, then mark ready' });
  }
  // one OBS input carrying two people
  const byInput = new Map<string, LiveTalent[]>();
  for (const t of talent) if (t.audio.source === 'obs' && t.audio.input && seatOfT(seats, t.id)) byInput.set(t.audio.input, [...(byInput.get(t.audio.input) ?? []), t]);
  for (const [inp, ts] of byInput) if (ts.length > 1) out.push({ code: 'audio-duplicate', tone: 'warn', talent: ts[0].id, text: `${ts.map(talentLabel).join(' and ')} share the OBS input "${inp}": their volume and mute are linked.`, fix: 'Give each person their own capture, or accept the shared fader' });
  // OBS-side audio findings (missing input, muted by hand, echo risk, heard twice, silence)
  for (const a of audio?.issues ?? []) out.push({ code: 'audio', tone: a.tone, talent: a.talent, text: a.text, fix: a.fix });
  // a desk layout shows a position nobody sits in
  for (const s of [...new Set(needed)]) if ((SEATS as readonly number[]).includes(s) && !seats[s as Seat]) out.push({ code: 'seat-empty', tone: 'warn', seat: s, text: `${SEAT_LABELS[s as Seat]} is in the current layout but nobody is assigned.`, fix: 'Assign someone, or switch the desk to a smaller layout' });
  return out;
}

/** Worst tone of a talent's issues (for a status dot). */
export function toneOf(issues: TalentIssue[], id: string): 'ok' | 'info' | 'warn' | 'bad' {
  const mine = issues.filter(i => i.talent === id);
  return mine.some(i => i.tone === 'bad') ? 'bad' : mine.some(i => i.tone === 'warn') ? 'warn' : mine.some(i => i.tone === 'info') ? 'info' : 'ok';
}

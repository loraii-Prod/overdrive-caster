/**
 * Overdrive 3.0 talent audio: shared types (server/audioMix.ts controls OBS; the Talent Manager and the Health
 * monitor read this).
 */
import type { Seat } from './talent';

/** The dedicated audio source of a position, created by the Scene Builder in "Overdrive · Caster audio". */
export const seatAudioInput = (s: Seat | number) => `Overdrive Caster ${s} audio`;

/** obs-websocket monitor types. */
export const MONITOR_TYPES = { off: 'OBS_MONITORING_TYPE_NONE', only: 'OBS_MONITORING_TYPE_MONITOR_ONLY', both: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' } as const;

/** Input kinds that capture what the PC plays: monitoring them on the same PC can feed back into the capture. */
export const ECHO_KINDS = /^(wasapi_output_capture|wasapi_process_output_capture|pulse_output_capture|coreaudio_output_capture|sck_audio_capture|screen_capture)/;

export interface AudioInputState {
  input: string;
  exists: boolean;
  kind?: string;
  /** Talent ids heard through this input. */
  who: string[];
  seat: number | null;
  muted?: boolean;
  volumeDb?: number;
  syncMs?: number;
  monitor?: string;
  /** Changed by hand in OBS since Overdrive last set it (Overdrive leaves it alone until "Apply"). */
  override?: boolean;
  error?: string;
}

export interface AudioIssue { code: string; tone: 'warn' | 'bad'; text: string; talent?: string; fix?: string }

export interface AudioStatus {
  /** OBS connected (audio controllable). */
  obs: boolean;
  master: boolean;
  /** OBS inputs that can carry a voice (for the "audio input" picker). */
  inputs: string[];
  /** Per talent id: the input carrying their voice (null = none / not in a position). */
  talent: Record<string, AudioInputState | null>;
  /** Per position: its dedicated audio source. */
  seats: Record<number, AudioInputState | undefined>;
  issues: AudioIssue[];
  at: number;
}

/** dB → fader position 0…1 (OBS-like curve: -60 dB = 0, 0 dB ≈ 0.83, +12 dB = 1). */
export const dbToFader = (db: number) => Math.max(0, Math.min(1, (db + 60) / 72));
export const faderToDb = (f: number) => Math.round((Math.max(0, Math.min(1, f)) * 72 - 60) * 10) / 10;

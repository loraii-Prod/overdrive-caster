/**
 * Overdrive 3.0 · Broadcast Health Monitor and pre-show checklist. Pure: computed in the browser from the state every
 * controller already receives, so it costs the server nothing and every operator sees the same answer.
 *
 * Health = is something that should work broken RIGHT NOW (OBS, the server link, graphics sources, cameras, voices,
 * media, voting, OBS performance, automation). Checklist = what is still to set up before going live.
 * Each item names a recovery action the console can run, or the place that fixes it.
 */
import type { ControllerState } from './types';
import type { AudPrivate, PerfReport } from './protocol';
import { SEATS, type Seat } from './talent';
import { checkTalent } from './talentCheck';

export type Tone = 'ok' | 'warn' | 'bad' | 'off';
export type HealthArea = 'link' | 'obs' | 'graphics' | 'cameras' | 'audio' | 'media' | 'voting' | 'performance' | 'automation';
export interface Fix { label: string; /** an engine command the console runs, or a Studio place to open */ cmd?: import('./engine').ProducerCmd; go?: { section: string; tab?: string } }
export interface HealthItem { area: HealthArea; label: string; tone: Tone; detail: string; fix?: Fix }
export interface CheckItem { id: string; label: string; done: boolean; optional?: boolean; detail?: string; go?: { section: string; tab?: string } }

export const AREA_LABEL: Record<HealthArea, string> = { link: 'Server link', obs: 'OBS', graphics: 'Graphics sources', cameras: 'Cameras', audio: 'Talent audio', media: 'Media playback', voting: 'Audience voting', performance: 'Performance', automation: 'Automation' };

export interface HealthInput {
  st: ControllerState;
  /** This console's WebSocket state and round trip. */
  conn: string;
  rtt: number | null;
  perf?: PerfReport | null;
  aud?: AudPrivate | null;
  now?: number;
}

const seatedTalent = (st: ControllerState) => (st.talent ?? []).filter(t => t.seat);

export function computeHealth({ st, conn, rtt, perf, aud }: HealthInput): HealthItem[] {
  const out: HealthItem[] = [];
  // ---- link to the production server
  out.push(conn !== 'open' ? { area: 'link', label: 'Server link', tone: 'bad', detail: `Disconnected (${conn}): changes are not reaching the show. The console reconnects by itself.` }
    : rtt != null && rtt > 400 ? { area: 'link', label: 'Server link', tone: 'warn', detail: `Slow: ${rtt} ms round trip.` }
    : { area: 'link', label: 'Server link', tone: 'ok', detail: rtt != null ? `${rtt} ms` : 'Connected' });

  // ---- OBS
  const o = st.obs;
  if (!o.enabled) out.push({ area: 'obs', label: 'OBS connection', tone: 'off', detail: 'Not set up: scene switching, audio control and source checks are off.', fix: { label: 'Set up OBS', go: { section: 'obs' } } });
  else if (!o.connected) out.push({ area: 'obs', label: 'OBS connection', tone: 'bad', detail: o.error ?? 'OBS is not reachable. Overdrive keeps retrying every 3 s.', fix: { label: 'OBS settings', go: { section: 'obs' } } });
  else out.push({ area: 'obs', label: 'OBS connection', tone: 'ok', detail: `Program: ${o.currentScene ?? '—'}${o.studioMode ? ` · Studio Mode, Preview: ${o.previewScene ?? '—'}` : ''}` });
  if (o.connected && st.obsSetup) {
    const t = st.obsSetup.targets ?? [];
    const bad = t.filter(x => x.status === 'error' || x.status === 'conflict'), drift = t.filter(x => x.status === 'incomplete' || x.status === 'outdated'), missing = t.filter(x => x.status === 'missing' && x.inAll);
    const leaks = st.obsSetup.controllerLeaks?.length ?? 0;
    if (leaks) out.push({ area: 'obs', label: 'Control page in OBS', tone: 'bad', detail: `${leaks} OBS source${leaks === 1 ? ' shows' : 's show'} an Overdrive control page: it could go on air.`, fix: { label: 'OBS Setup', go: { section: 'obs' } } });
    if (bad.length || drift.length) out.push({ area: 'obs', label: 'OBS scenes', tone: bad.length ? 'bad' : 'warn', detail: `${[...bad, ...drift].slice(0, 3).map(x => `${x.name}: ${x.issues[0] ?? x.status}`).join(' · ')}${bad.length + drift.length > 3 ? ` (+${bad.length + drift.length - 3})` : ''}`, fix: { label: 'Repair in OBS Setup', go: { section: 'obs' } } });
    else if (t.length) out.push({ area: 'obs', label: 'OBS scenes', tone: missing.length ? 'warn' : 'ok', detail: missing.length ? `${missing.length} Overdrive scene${missing.length === 1 ? '' : 's'} not built in OBS yet.` : `${t.filter(x => x.status === 'ok').length} scenes verified.`, ...(missing.length ? { fix: { label: 'Build in OBS Setup', go: { section: 'obs' } } } : {}) });
  }

  // ---- graphics sources (renderer health + connected browser sources of graphics that OBS uses)
  const errs = Object.entries(st.gfxHealth ?? {}).filter(([, h]) => !h.ok);
  const routes = new Map((st.outputs ?? []).map(r => [r.route, r.count]));
  const used = (st.graphics ?? []).filter(g => g.obsScene && o.connected && o.scenes.includes(g.obsScene));
  const silent = used.filter(g => !routes.get(`g/${g.id}`) && ![...routes.keys()].some(r => r.startsWith(`g/${g.id}`)));
  if (errs.length) out.push({ area: 'graphics', label: 'Graphics renderers', tone: 'bad', detail: errs.slice(0, 3).map(([id, h]) => `${id}: ${h.error ?? 'error'}`).join(' · '), fix: { label: 'Reload sources', cmd: { c: 'reload-outputs' } } });
  else out.push({ area: 'graphics', label: 'Graphics renderers', tone: 'ok', detail: `${(st.graphics ?? []).length} graphics, no renderer error.` });
  if (silent.length) out.push({ area: 'graphics', label: 'Browser sources', tone: 'warn', detail: `${silent.map(g => g.name).slice(0, 3).join(', ')}${silent.length > 3 ? ` (+${silent.length - 3})` : ''}: in an OBS scene but no browser source is connected (OBS closed, or "Shutdown source when not visible" on).`, fix: { label: 'Reload sources', cmd: { c: 'reload-outputs' } } });
  else out.push({ area: 'graphics', label: 'Browser sources', tone: (st.outputs ?? []).length ? 'ok' : 'off', detail: (st.outputs ?? []).length ? `${(st.outputs ?? []).reduce((n, r) => n + r.count, 0)} connected (${(st.outputs ?? []).length} routes).` : 'No browser source connected yet.' });

  // ---- cameras and voices (the same checks as the Talent Manager)
  const seated = seatedTalent(st);
  const issues = checkTalent({ talent: st.talent ?? [], seats: st.seats ?? ({} as never), audio: st.audio });
  const camIssues = issues.filter(i => i.code.startsWith('cam-') || i.code.startsWith('vdo-'));
  out.push(!seated.length ? { area: 'cameras', label: 'Talent cameras', tone: 'off', detail: 'Nobody in a position.', fix: { label: 'Talent', go: { section: 'talent', tab: 'roster' } } }
    : camIssues.length ? { area: 'cameras', label: 'Talent cameras', tone: camIssues.some(i => i.tone === 'bad') ? 'bad' : 'warn', detail: camIssues.slice(0, 2).map(i => i.text).join(' · ') + (camIssues.length > 2 ? ` (+${camIssues.length - 2})` : ''), fix: { label: 'Green Room', go: { section: 'talent', tab: 'green' } } }
    : { area: 'cameras', label: 'Talent cameras', tone: 'ok', detail: `${seated.length} camera${seated.length === 1 ? '' : 's'} connected.` });
  const audioIssues = issues.filter(i => i.code === 'audio' || i.code === 'mic-missing' || i.code === 'audio-input' || i.code === 'audio-duplicate');
  const voices = seated.filter(t => t.audio.source !== 'none');
  out.push(!voices.length ? { area: 'audio', label: 'Talent audio', tone: 'off', detail: 'No voice in the show.' }
    : !st.audio?.obs ? { area: 'audio', label: 'Talent audio', tone: o.enabled ? 'bad' : 'warn', detail: 'OBS not connected: talent volume, mute and meters are not controlled.', fix: { label: 'OBS settings', go: { section: 'obs' } } }
    : audioIssues.length ? { area: 'audio', label: 'Talent audio', tone: audioIssues.some(i => i.tone === 'bad') ? 'bad' : 'warn', detail: audioIssues.slice(0, 2).map(i => i.text).join(' · ') + (audioIssues.length > 2 ? ` (+${audioIssues.length - 2})` : ''), fix: st.audio.issues.some(i => i.code === 'override' || i.code === 'duplicate') ? { label: 'Apply audio settings', cmd: { c: 'audio-apply' } } : { label: 'Audio', go: { section: 'talent', tab: 'audio' } } }
    : { area: 'audio', label: 'Talent audio', tone: st.audio.master ? 'warn' : 'ok', detail: st.audio.master ? 'Master talent mute is ON.' : `${voices.length} voice${voices.length === 1 ? '' : 's'} reaching OBS once each.`, ...(st.audio.master ? { fix: { label: 'Unmute talent', cmd: { c: 'audio-master', muted: false } } } : {}) });

  // ---- media playback
  const m = st.media;
  if (m) {
    const mediaSrc = [...routes.entries()].some(([r, n]) => r === 'media' && n > 0);
    out.push(m.status === 'playing' && !mediaSrc ? { area: 'media', label: 'Media playback', tone: 'warn', detail: 'Playing, but no /output/media browser source is connected: nothing is heard or seen.', fix: { label: 'Media', go: { section: 'media' } } }
      : { area: 'media', label: 'Media playback', tone: m.status === 'playing' ? 'ok' : 'off', detail: m.status === 'playing' ? `Playing ${m.index + 1}/${m.playlist.length}${m.muted ? ' (muted)' : ''}` : m.playlist.length ? `${m.status}, ${m.playlist.length} in the playlist` : 'Nothing in the playlist.' });
  }

  // ---- audience voting (the online vote service; local production never depends on it)
  if (aud) out.push(!aud.configured ? { area: 'voting', label: 'Voting service', tone: 'off', detail: 'Not configured (VOTE_SERVICE_URL): public voting is off; manual MVP still works.' }
    : !aud.online ? { area: 'voting', label: 'Voting service', tone: 'bad', detail: `Unreachable${aud.error ? `: ${aud.error}` : ''}. Graphics and local production are unaffected; use the Analyst / manual MVP if it does not come back.`, fix: { label: 'Audience', go: { section: 'show' } } }
    : { area: 'voting', label: 'Voting service', tone: 'ok', detail: aud.publicUrl ? `Online · ${aud.publicUrl}` : 'Online' });

  // ---- OBS performance (only when the producer turned the monitor on)
  if (perf?.obs) {
    const p = perf.obs, skipR = p.renderTotal ? (100 * p.renderSkipped) / p.renderTotal : 0, skipO = p.outputTotal ? (100 * p.outputSkipped) / p.outputTotal : 0;
    const tone: Tone = skipO > 1 || skipR > 1 || p.renderMs > 14 ? 'bad' : skipO > 0.2 || skipR > 0.2 || p.renderMs > 9 || p.cpu > 85 ? 'warn' : 'ok';
    out.push({ area: 'performance', label: 'OBS performance', tone, detail: `${p.fps.toFixed(0)} fps · render ${p.renderMs.toFixed(1)} ms · skipped ${skipR.toFixed(2)} % render / ${skipO.toFixed(2)} % encode · CPU ${p.cpu.toFixed(0)} %` });
  } else out.push({ area: 'performance', label: 'OBS performance', tone: 'off', detail: 'Performance monitor off (OBS Setup → options).' });

  // ---- automation
  const pend = st.plan?.pending;
  out.push(st.engine?.autoHold ? { area: 'automation', label: 'Automation', tone: 'warn', detail: 'Held: no automatic step runs until released.', fix: { label: 'Release', cmd: { c: 'automation', hold: false } } }
    : pend ? { area: 'automation', label: 'Automation', tone: 'warn', detail: 'Waiting for the producer\'s GO.' }
    : { area: 'automation', label: 'Automation', tone: (st.plan?.rules ?? []).some(r => r.on) ? 'ok' : 'off', detail: `${(st.plan?.rules ?? []).filter(r => r.on).length} rule(s) armed.` });
  return out;
}

/** Worst tone (for the header indicator). 'off' never raises an alarm. */
export const worst = (items: { tone: Tone }[]): Tone => (items.some(i => i.tone === 'bad') ? 'bad' : items.some(i => i.tone === 'warn') ? 'warn' : 'ok');

/** What still needs doing before the stream starts. */
export function checklist(st: ControllerState, aud?: AudPrivate | null): CheckItem[] {
  const seated = seatedTalent(st);
  const issues = checkTalent({ talent: st.talent ?? [], seats: st.seats ?? ({} as never), audio: st.audio });
  const t = st.obsSetup?.targets ?? [];
  const items: CheckItem[] = [
    { id: 'event', label: 'Event selected', done: !!st.activeEvent, detail: st.events.find(e => e.id === st.activeEvent)?.name, go: { section: 'show' } },
    { id: 'obs', label: 'OBS connected', done: st.obs.connected, detail: st.obs.connected ? st.obs.url : st.obs.error, go: { section: 'obs' } },
    { id: 'obs-scenes', label: 'Overdrive scenes built in OBS', done: t.length > 0 && t.filter(x => x.inAll).every(x => x.status === 'ok'), detail: t.length ? `${t.filter(x => x.status === 'ok').length}/${t.filter(x => x.inAll).length} verified` : 'Scan OBS in OBS Setup', go: { section: 'obs' } },
    { id: 'audio-scene', label: 'Talent audio sources in OBS', done: !!st.audio?.obs && SEATS.every(s => st.audio?.seats?.[s]?.exists !== false), detail: st.audio?.obs ? undefined : 'needs OBS', go: { section: 'obs' } },
    { id: 'talent', label: 'Talent in position', done: seated.length > 0, detail: `${seated.length} in the show`, go: { section: 'talent', tab: 'layouts' } },
    { id: 'names', label: 'Everyone on air has a name', done: seated.length > 0 && seated.every(x => x.name.trim()), go: { section: 'talent', tab: 'roster' } },
    { id: 'cams', label: 'Cameras connected', done: seated.length > 0 && !issues.some(i => (i.code.startsWith('cam-') || i.code.startsWith('vdo-')) && i.tone === 'bad'), go: { section: 'talent', tab: 'green' } },
    { id: 'voices', label: 'Every voice reaches OBS once', done: !!st.audio?.obs && !issues.some(i => (i.code === 'audio' || i.code === 'mic-missing' || i.code === 'audio-input') && i.tone === 'bad'), go: { section: 'talent', tab: 'audio' } },
    { id: 'ready', label: 'Talent marked ready (Green Room)', done: seated.length > 0 && seated.every(x => x.ready), detail: `${seated.filter(x => x.ready).length}/${seated.length}`, go: { section: 'talent', tab: 'green' } },
    { id: 'rundown', label: 'Show rundown prepared', done: (st.plan?.segments.length ?? 0) > 0, optional: true, go: { section: 'rundown' } },
    { id: 'gfx', label: 'No graphics renderer errors', done: !Object.values(st.gfxHealth ?? {}).some(h => !h.ok), go: { section: 'obs' } },
    { id: 'drafts', label: 'Nothing left unpublished', done: !st.engine?.dirty && !(st.engine?.draft.length) && !(st.graphics ?? []).some(g => g.draft), optional: true, detail: 'prepared changes wait for Publish' },
  ];
  if (aud?.configured) items.push({ id: 'voting', label: 'Voting service online', done: aud.online, optional: true, go: { section: 'show' } });
  return items;
}
export const seatsOf = (st: ControllerState) => SEATS.filter(s => st.seats?.[s as Seat]);

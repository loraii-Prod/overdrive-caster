/**
 * 3.0 MVP readiness: one checklist, computed from the shared state, shown in the Producer MVP panel and in Health.
 * It only reports what this server can actually know (e.g. "a browser source of the MVP graphic is connected" comes
 * from the output pages that connected, not from guessing OBS's state).
 */
export type MvpTone = 'ok' | 'warn' | 'bad' | 'off';
export interface MvpCheck { id: string; label: string; tone: MvpTone; detail: string }

export interface MvpReadyIn {
  match: string;
  /** "Upper Quarterfinal 1" */
  matchLabel: string;
  finished: boolean;
  teams: [string | null, string | null];
  /** Where each team's players come from. */
  rosterSource: ['event' | 'verified' | 'none', 'event' | 'verified' | 'none'];
  logos: [boolean, boolean];
  players: { handle: string; photo: boolean }[];
  poll: { status: 'draft' | 'open' | 'closed' | 'revealed'; players: number; sim: number } | null;
  mode: 'online' | 'local';
  online: boolean;
  /** Public voting address (QR), when one is set. */
  publicUrl: string;
  chat: 'listening' | 'off' | string;
  rehearsal: boolean;
  obs: { connected: boolean; scenes: { view: string; scene: string | null; exists: boolean }[] };
  /** Browser sources (/g/mvp…) connected to this server right now. */
  sources: number;
  /** The online vote service knows this match's players (verified Major teams and players only). */
  onlineRosterOk?: boolean;
}

export function mvpReadiness(i: MvpReadyIn): MvpCheck[] {
  const out: MvpCheck[] = [];
  const add = (id: string, label: string, tone: MvpTone, detail: string) => out.push({ id, label, tone, detail });
  if (!i.match) {
    add('match', 'Match', 'bad', 'No MVP match yet: it is set automatically when a match gets its result (or choose a finished match).');
    return out;
  }
  add('match', 'Match', i.finished ? 'ok' : 'bad', i.finished ? `${i.matchLabel} · ${i.teams[0]} vs ${i.teams[1]} (result in)` : `${i.matchLabel} has no result yet: MVP voting opens after the match.`);
  const missingTeams = i.teams.filter((t, k) => t && i.rosterSource[k] === 'none') as string[];
  if (missingTeams.length) add('players', 'Players', 'bad', `No players known for ${missingTeams.join(' and ')}: add them below.`);
  else add('players', 'Players', i.players.length >= 2 ? 'ok' : 'bad', `${i.players.length} eligible (${i.rosterSource.map(r => (r === 'event' ? 'this event' : 'verified profiles')).filter((v, k, a) => a.indexOf(v) === k).join(' + ')})`);
  const noPhoto = i.players.filter(p => !p.photo).map(p => p.handle);
  add('photos', 'Pictures', noPhoto.length ? 'warn' : 'ok', noPhoto.length ? `No picture: ${noPhoto.join(', ')} (a silhouette is shown)` : 'Every player has a picture');
  const noLogo = i.teams.filter((t, k) => t && !i.logos[k]) as string[];
  if (noLogo.length) add('logos', 'Team logos', 'warn', `No logo: ${noLogo.join(', ')}`);
  const p = i.poll;
  add('vote', 'Vote', !p ? (i.finished ? 'warn' : 'off') : 'ok',
    !p ? 'Not prepared yet' : p.status === 'draft' ? `Prepared · ${p.players} candidates · not open` : p.status === 'open' ? `OPEN · ${p.players} candidates` : p.status === 'closed' ? 'Closed · result frozen' : 'Revealed');
  if (p && p.sim > 0) add('rehearsal-votes', 'Rehearsal votes', i.rehearsal ? 'ok' : 'bad', `${p.sim} simulated vote${p.sim === 1 ? '' : 's'} in this vote${i.rehearsal ? '' : ': do not reveal it as a real result'}`);
  if (i.rehearsal) add('ways', 'Ways to vote', 'ok', 'Rehearsal: simulated votes only (real Twitch chat and the online service are never used)');
  else {
    const ways = [i.mode === 'online' && i.online ? 'website' : '', i.chat === 'listening' ? 'Twitch chat' : ''].filter(Boolean);
    add('ways', 'Ways to vote', ways.length ? 'ok' : 'bad', ways.length ? ways.join(' + ') : i.mode === 'online' ? 'Vote service offline and Twitch chat not connected' : 'Twitch chat not connected and no online vote service: viewers cannot vote');
  }
  if (!i.rehearsal && i.mode === 'online' && i.onlineRosterOk === false) add('online-roster', 'Online voting', 'bad', 'The online vote service only accepts the verified Major teams and players; this match uses players entered for this event → set Counting to Local (Twitch chat) for it');
  if (i.rehearsal) add('page', 'Voting page & QR', 'off', 'Not used in the rehearsal');
  else if (i.mode === 'online') add('page', 'Voting page & QR', i.online && i.publicUrl ? 'ok' : 'bad', i.publicUrl ? `${i.publicUrl.replace(/^https:\/\//, '')} · ${i.online ? 'service online' : 'service OFFLINE'}` : 'No public voting address set (Studio → Audience)');
  else add('page', 'Voting page & QR', 'off', 'Local counting: no public website (needs the online vote service); the graphic shows the chat command');
  const sc = i.obs.scenes, have = sc.filter(x => x.exists).length;
  if (!i.obs.connected) add('obs', 'OBS scenes', 'warn', 'OBS not connected');
  else add('obs', 'OBS scenes', have === sc.length ? 'ok' : have ? 'warn' : 'bad', have === sc.length ? `All ${sc.length} MVP scenes in OBS` : `Missing in OBS: ${sc.filter(x => !x.exists).map(x => x.scene ?? x.view).join(', ')} → Scene Builder (Studio → Sources & OBS)`);
  add('sources', 'Browser sources', i.sources ? 'ok' : i.obs.connected ? 'warn' : 'off', i.sources ? `${i.sources} MVP browser source${i.sources === 1 ? '' : 's'} connected` : 'No MVP browser source connected (OBS closed, or the scene was never shown)');
  return out;
}

export const worstTone = (c: MvpCheck[]): MvpTone => (c.some(x => x.tone === 'bad') ? 'bad' : c.some(x => x.tone === 'warn') ? 'warn' : 'ok');

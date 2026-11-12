/** Twitch predictions & polls: what outputs draw (no tokens ever leave the server). */

export interface TwOutcome { id: string; title: string; users: number; points: number }
export interface TwPrediction {
  id: string; title: string;
  status: 'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'CANCELED';
  outcomes: TwOutcome[];
  winner: string | null;
  /** Epoch ms when voting closes (ACTIVE), or when it ended. */
  endsAt: number | null; endedAt: number | null;
}
export interface TwChoice { id: string; title: string; votes: number }
export interface TwPoll {
  id: string; title: string;
  status: 'ACTIVE' | 'COMPLETED' | 'TERMINATED' | 'ARCHIVED' | 'MODERATED' | 'INVALID';
  choices: TwChoice[];
  endsAt: number | null; endedAt: number | null;
}
export interface TwShow { gameplay: boolean; casters: boolean; warmup: boolean; intermission: boolean }
export interface TwitchPublic { prediction: TwPrediction | null; poll: TwPoll | null; show: TwShow; /** signed in (controls can start predictions) */ connected: boolean }

/** Controller-only view of the connection. */
export interface TwitchStatus {
  clientId: string;
  connected: boolean;
  login: string;
  error: string;
  /** Pending sign-in: open `uri` and enter `code`. */
  device: { code: string; uri: string; expiresAt: number } | null;
  lastPoll: number;
}

export type TwOp =
  | { k: 'client-id'; clientId: string }
  | { k: 'connect' }
  | { k: 'disconnect' }
  | { k: 'show'; patch: Partial<TwShow> }
  | { k: 'prediction-start'; title: string; outcomes: string[]; seconds: number }
  | { k: 'prediction-lock' }
  | { k: 'prediction-resolve'; outcomeId: string }
  | { k: 'prediction-cancel' }
  | { k: 'poll-start'; title: string; choices: string[]; seconds: number }
  | { k: 'poll-end' };

/** How long a finished prediction / poll result stays on screen. */
export const TW_RESULT_MS = 20_000;

/** What to draw right now (null = nothing): an active or just-finished prediction first, else a poll. */
export function twVisible(tw: TwitchPublic | null | undefined, now: number): { kind: 'prediction'; p: TwPrediction } | { kind: 'poll'; p: TwPoll } | null {
  if (!tw) return null;
  const pr = tw.prediction;
  if (pr && (pr.status === 'ACTIVE' || pr.status === 'LOCKED' || (pr.status === 'RESOLVED' && pr.endedAt != null && now - pr.endedAt < TW_RESULT_MS))) return { kind: 'prediction', p: pr };
  const po = tw.poll;
  if (po && (po.status === 'ACTIVE' || (po.status === 'COMPLETED' && po.endedAt != null && now - po.endedAt < TW_RESULT_MS))) return { kind: 'poll', p: po };
  return null;
}

export const defaultTwShow = (): TwShow => ({ gameplay: true, casters: true, warmup: true, intermission: false });

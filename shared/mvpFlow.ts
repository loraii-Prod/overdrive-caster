/**
 * The MVP sequence, shared by Producer Mode's stepper, the automation engine and the tests:
 *
 *   Voting prepared → Voting open → Voting closed → Results ready → Community MVP → Analyst MVP → Comparison → Next scene
 *
 * Reveal rules (the only place they are decided):
 *   - Community MVP and the comparison need the result FROZEN at the close of voting (never live counts).
 *   - Analyst MVP needs at least one analyst pick; the comparison needs both.
 *   - With "Reveals need producer confirmation" on (default), automation never reveals by itself: it stops and asks
 *     the producer for GO, and Producer Mode asks for a second click.
 */
import type { PollStatus } from './audience';

export type MvpStage = 'none' | 'prepared' | 'open' | 'closed' | 'ready' | 'community' | 'analyst' | 'compare';
export type RevealStep = 'winner' | 'desk' | 'compare';
export const REVEAL_STEPS: RevealStep[] = ['winner', 'desk', 'compare'];

export interface MvpFlowIn {
  /** Status of the latest MVP vote of the match (null = no vote prepared). */
  status: PollStatus | null;
  /** A result was frozen when voting closed. */
  frozen: boolean;
  /** At least one analyst picked an MVP for this match. */
  desk: boolean;
  /** The step the MVP graphic SHOWS on its source for this match ('' when it shows another match). */
  published: string;
}

export const STAGES: { id: MvpStage; label: string }[] = [
  { id: 'prepared', label: 'Voting prepared' }, { id: 'open', label: 'Voting open' }, { id: 'closed', label: 'Voting closed' }, { id: 'ready', label: 'Results ready' },
  { id: 'community', label: 'Community MVP' }, { id: 'analyst', label: 'Analyst MVP' }, { id: 'compare', label: 'Comparison' },
];

export function mvpStage(i: MvpFlowIn): MvpStage {
  if (!i.status) return 'none';
  if (i.status === 'draft') return 'prepared';
  if (i.status === 'open') return 'open';
  if (!i.frozen) return 'closed'; // closed, result not confirmed yet
  if (i.published === 'compare') return 'compare';
  if (i.published === 'desk') return 'analyst';
  if (i.published === 'winner') return 'community';
  return 'ready';
}

/** null = allowed; otherwise why this reveal must not go on air now. */
export function revealAllowed(step: string, i: MvpFlowIn): string | null {
  if (step === 'winner' || step === 'compare') {
    if (!i.status || i.status === 'draft' || i.status === 'open') return 'voting is not closed';
    if (!i.frozen) return 'the result is not frozen yet';
  }
  if ((step === 'desk' || step === 'compare') && !i.desk) return 'no analyst has picked an MVP';
  if (!['winner', 'desk', 'compare'].includes(step)) return 'not a reveal step';
  return null;
}

export type NextAction =
  | { kind: 'prepare' | 'open' | 'close'; label: string; critical: false }
  | { kind: 'reveal'; step: RevealStep; label: string; critical: true }
  | { kind: 'next'; label: string; critical: false }
  | { kind: 'wait'; label: string; critical: false };

/** What "Next step" does from a stage (Producer Mode's single button, and the reference automation). */
export function nextAction(i: MvpFlowIn): NextAction {
  switch (mvpStage(i)) {
    case 'none': return { kind: 'prepare', label: 'Prepare voting', critical: false };
    case 'prepared': return { kind: 'open', label: 'Open voting', critical: false };
    case 'open': return { kind: 'close', label: 'Close voting', critical: false };
    case 'closed': return { kind: 'wait', label: 'Counting…', critical: false };
    case 'ready': return { kind: 'reveal', step: 'winner', label: 'Reveal Community MVP', critical: true };
    case 'community': return i.desk ? { kind: 'reveal', step: 'desk', label: 'Reveal Analyst MVP', critical: true } : { kind: 'next', label: 'Next scene', critical: false };
    case 'analyst': return { kind: 'reveal', step: 'compare', label: 'Show the comparison', critical: true };
    case 'compare': return { kind: 'next', label: 'Next scene', critical: false };
  }
}

// ------------------------------------------------------------------ MVP & Awards scenes (one graphic, five views)

/**
 * The five MVP & Awards scenes are five fixed views of the ONE MVP graphic (/g/mvp, same data, same 4K renderer):
 * each has its own OBS browser source, /g/mvp?view=<view>. The plain /g/mvp source keeps following the MVP
 * sequence (its published step) exactly as before.
 */
export type MvpView = 'voting' | 'closed' | 'winner' | 'desk' | 'compare';
export const MVP_VIEWS: MvpView[] = ['voting', 'closed', 'winner', 'desk', 'compare'];
/** Renderer step drawn by each view ("closed" is the voting graphic, which turns to its closed state on close). */
export const VIEW_STEP: Record<MvpView, 'voting' | RevealStep> = { voting: 'voting', closed: 'voting', winner: 'winner', desk: 'desk', compare: 'compare' };
export const isMvpView = (v: unknown): v is MvpView => typeof v === 'string' && (MVP_VIEWS as string[]).includes(v);
/** Tournament bracket scenes: the upper bracket (+ grand final) and the lower bracket on separate sources. */
export type BracketView = 'upper' | 'lower';
export const isBracketView = (v: unknown): v is BracketView => v === 'upper' || v === 'lower';
/** Fixed view of a graphic shown by a scene (its source: /g/<graphic>?view=<view>). */
export type GfxView = MvpView | BracketView;
export const isRevealView = (v: unknown): v is 'winner' | 'desk' | 'compare' => v === 'winner' || v === 'desk' || v === 'compare';

/**
 * Producer authorization of reveals, stored on the MVP graphic as "<match>:winner,desk". A reveal view draws its
 * winner on its browser source only once the producer authorized that reveal for that match (TAKE / GO / the MVP
 * sequence's confirmed reveal); before that it draws nothing. Operator monitors may preview it privately.
 */
export function revealedOf(cfg: Record<string, unknown> | null | undefined, match: string): RevealStep[] {
  const raw = String(cfg?.revealed ?? ''), i = raw.lastIndexOf(':');
  if (i < 0 || raw.slice(0, i) !== match || !match) return [];
  return raw.slice(i + 1).split(',').filter((s): s is RevealStep => (REVEAL_STEPS as string[]).includes(s));
}
export function withRevealed(cfg: Record<string, unknown>, match: string, step: string): string {
  if (!(REVEAL_STEPS as string[]).includes(step) || !match) return String(cfg.revealed ?? '');
  const cur = revealedOf(cfg, match);
  return `${match}:${REVEAL_STEPS.filter(s => s === step || cur.includes(s)).join(',')}`;
}
/** Two configs' authorizations together (a stale draft never takes one back). */
export function mergeRevealed(a: Record<string, unknown>, b: Record<string, unknown>, match: string): string {
  const both = [...new Set([...revealedOf(a, match), ...revealedOf(b, match)])];
  return both.length ? `${match}:${REVEAL_STEPS.filter(s => both.includes(s)).join(',')}` : String(b.revealed ?? '');
}
/** Can a view's browser source draw now? (Reveal views: only an authorized reveal of the graphic's match.) */
export function viewAllowed(view: MvpView, cfg: Record<string, unknown>, fallbackMatch = ''): boolean {
  if (!isRevealView(view)) return true;
  const match = String(cfg.match || fallbackMatch || '');
  return revealedOf(cfg, match).includes(view);
}

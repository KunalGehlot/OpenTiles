// Spaced review (P7-26, ADR 0026): when each kind of chord or scale is due again, worked out from
// the rounds the learner has already played. Nothing new is stored: the schedule is replayed from
// the kept round statistics (chord-stats.ts, scale-stats.ts) with SM-2 (Woźniak, 1990), the rule
// behind most flash-card programs, so it follows the backup to any device. Pure.
import { WEAK_SHARE } from './chord-stats';
import type { ChordStats } from './chord-stats';
import type { ScaleStats } from './scale-stats';

/** One look at an item in a round: how many tries, and how many were right at the first try. */
export interface ReviewEvent {
  /** Milliseconds since 1970. */
  at: number;
  /** `chord:` or `scale:` and the kind as the stats key it, such as `chord:7.dom7`. */
  item: string;
  attempts: number;
  firstTry: number;
}

/** 0 forgotten … 5 right at once, as SM-2 grades an answer. */
export type ReviewGrade = 0 | 1 | 2 | 3 | 4 | 5;

export interface ReviewState {
  item: string;
  /** SM-2 ease factor, never below `MIN_EASE`. */
  ease: number;
  /** Days from the last review to the next. */
  intervalDays: number;
  /** Reviews in a row that were passed. */
  reps: number;
  /** Times the item failed after it had been passed. */
  lapses: number;
  /** Local day number (days since 1970 in the learner's time zone) of the last review. */
  lastDay: number;
  /** Local day number from which the item is due. */
  dueDay: number;
}

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** Most reviews a day asks for, so a long break does not come back as a wall of them. */
export const MAX_REVIEWS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since 1970 in the local time zone, so a review in the evening is due the next morning. */
export function localDayNumber(at: number): number {
  return Math.floor((at - new Date(at).getTimezoneOffset() * 60_000) / DAY_MS);
}

/**
 * A day's share right at the first try as a grade. Passing starts at `WEAK_SHARE`, the line under
 * which "Practise my weak chords" already counts a chord as weak, so the two never disagree.
 */
export function gradeOf(firstTry: number, attempts: number): ReviewGrade {
  if (attempts <= 0) return 0;
  const share = firstTry / attempts;
  if (share >= 0.95) return 5;
  if (share >= WEAK_SHARE) return 4;
  if (share >= 0.5) return 2;
  return share > 0 ? 1 : 0;
}

/** E + 0.1 − (5 − q)(0.08 + (5 − q) · 0.02), never below `MIN_EASE`. */
export function nextEase(ease: number, grade: ReviewGrade): number {
  const miss = 5 - grade;
  return Math.max(MIN_EASE, ease + 0.1 - miss * (0.08 + miss * 0.02));
}

/**
 * The state after a review on `day`. A pass before the item is due changes nothing: chords turn up
 * in ordinary drills all the time, and counting those would push the next review out too fast. A
 * fail counts whenever it happens, since it shows the item is not secure.
 */
export function review(
  state: ReviewState | undefined,
  item: string,
  grade: ReviewGrade,
  day: number,
): ReviewState {
  const s = state ?? {
    item,
    ease: START_EASE,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    lastDay: day,
    dueDay: day,
  };
  const passed = grade >= 3;
  if (state && passed && day < state.dueDay) return state;
  const ease = nextEase(s.ease, grade);
  if (!passed) {
    return {
      ...s,
      ease,
      intervalDays: 1,
      reps: 0,
      lapses: s.lapses + (s.reps > 0 ? 1 : 0),
      lastDay: day,
      dueDay: day + 1,
    };
  }
  const reps = s.reps + 1;
  const intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(s.intervalDays * ease);
  return { ...s, ease, intervalDays, reps, lastDay: day, dueDay: day + intervalDays };
}

/**
 * Every item's state, replayed from `events` in time order. The rounds of one local day count as
 * one review of each item they touched, so five rounds in an evening are not five reviews.
 */
export function replayReviews(events: readonly ReviewEvent[]): Map<string, ReviewState> {
  const days = new Map<string, { item: string; day: number; attempts: number; firstTry: number }>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (!(e.attempts > 0)) continue;
    const day = localDayNumber(e.at);
    const key = `${day} ${e.item}`;
    const d = days.get(key) ?? { item: e.item, day, attempts: 0, firstTry: 0 };
    d.attempts += e.attempts;
    d.firstTry += Math.min(e.firstTry, e.attempts);
    days.set(key, d);
  }
  const states = new Map<string, ReviewState>();
  for (const d of [...days.values()].sort((a, b) => a.day - b.day)) {
    states.set(d.item, review(states.get(d.item), d.item, gradeOf(d.firstTry, d.attempts), d.day));
  }
  return states;
}

/** The items due at `now`, the longest overdue first and the hardest (lowest ease) among equals. */
export function dueReviews(
  states: Iterable<ReviewState>,
  now: number,
  limit = MAX_REVIEWS,
): ReviewState[] {
  const today = localDayNumber(now);
  return [...states]
    .filter((s) => s.dueDay <= today)
    .sort((a, b) => a.dueDay - b.dueDay || a.ease - b.ease || a.item.localeCompare(b.item))
    .slice(0, limit);
}

/** Review events from the kept chord rounds, one per kind of chord in each round. */
export function chordReviewEvents(stats: ChordStats): ReviewEvent[] {
  return stats.rounds.flatMap((r) =>
    Object.entries(r.kinds).map(([kind, [attempts, firstTry]]) => ({
      at: r.at,
      item: `chord:${kind}`,
      attempts,
      firstTry,
    })),
  );
}

/** Review events from the kept scale rounds, one per scale in each round. */
export function scaleReviewEvents(stats: ScaleStats): ReviewEvent[] {
  return stats.rounds.flatMap((r) =>
    Object.entries(r.kinds).map(([kind, [attempts, firstTry]]) => ({
      at: r.at,
      item: `scale:${kind}`,
      attempts,
      firstTry,
    })),
  );
}

/**
 * The kinds of chord due at `now`, as `chordStats` keys them, for a drill that draws only those.
 * `allowed` keeps only kinds the drill can draw, as `weakChords` does.
 */
export function dueChordKinds(
  stats: ChordStats,
  now: number,
  allowed?: ReadonlySet<string>,
  limit = MAX_REVIEWS,
): string[] {
  return kindsOf(replayReviews(chordReviewEvents(stats)), 'chord:', now, allowed, limit);
}

/** The scales due at `now`, as `scaleStats` keys them. */
export function dueScaleKinds(
  stats: ScaleStats,
  now: number,
  allowed?: ReadonlySet<string>,
  limit = MAX_REVIEWS,
): string[] {
  return kindsOf(replayReviews(scaleReviewEvents(stats)), 'scale:', now, allowed, limit);
}

function kindsOf(
  states: Map<string, ReviewState>,
  prefix: string,
  now: number,
  allowed: ReadonlySet<string> | undefined,
  limit: number,
): string[] {
  const kinds = dueReviews(states.values(), now, Number.POSITIVE_INFINITY).map((s) =>
    s.item.slice(prefix.length),
  );
  return (allowed ? kinds.filter((k) => allowed.has(k)) : kinds).slice(0, limit);
}

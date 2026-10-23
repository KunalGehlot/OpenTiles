// Judging chords in a chord drill (P7-03, ADR 0022). Wait mode and play-along judge notes; this
// layer above them says whether a whole chord was right at the first try, how long it took, and
// what went wrong: a note missing, a key outside the chord, the wrong third or fifth (major played
// for minor), or the right notes in the wrong place (the wrong inversion). Pieces never use it, so
// their scoring is unchanged.
import type { NoteResult } from './play-along';

export type ChordMiss = 'missing' | 'extra' | 'quality' | 'inversion';

export interface ChordAttempt {
  index: number;
  /** The chord's kind as the drill names it (`pitchClass.quality`), for the statistics. */
  kind: string;
  pitches: number[];
  /** Every note played and no wrong key before the chord was complete (and, at a tempo, together). */
  firstTry: boolean;
  /** From the chord being shown to its last note; null when it was not completed. */
  seconds: number | null;
  /** What went wrong, each cause once, in the order it happened. */
  causes: ChordMiss[];
}

/** Notes of a chord count as together when they land inside this spread, in seconds. */
export const CHORD_SPREAD = 0.12;
/** The spread with "Strict chords" on. */
export const STRICT_CHORD_SPREAD = 0.06;

const pc = (p: number) => ((p % 12) + 12) % 12;

/**
 * Why a key that is not in the chord was pressed. A pitch class of the chord in another octave is
 * the wrong inversion; a semitone from the third, fifth or seventh is the wrong quality; anything
 * else is an extra note.
 */
export function missCause(pitch: number, expected: readonly number[], root?: number): ChordMiss {
  if (expected.some((e) => pc(e) === pc(pitch))) return 'inversion';
  const nearTone = expected.some(
    (e) => Math.abs(e - pitch) === 1 && (root === undefined || pc(e) !== pc(root)),
  );
  return nearTone ? 'quality' : 'extra';
}

export interface TogetherJudgement {
  /** Every note was played. */
  complete: boolean;
  /** The played notes landed within the spread. */
  together: boolean;
  /** The median of the played notes' offsets, seconds; null when none was played. */
  offset: number | null;
}

/** A chord at a tempo: complete, together within `spread`, and its median offset. */
export function judgeTogether(
  results: readonly NoteResult[],
  spread = CHORD_SPREAD,
): TogetherJudgement {
  const offsets = results
    .filter((r) => r.judgement !== 'missed' && r.offset !== undefined)
    .map((r) => r.offset as number)
    .sort((a, b) => a - b);
  const complete = results.length > 0 && offsets.length === results.length;
  const first = offsets[0];
  const last = offsets[offsets.length - 1];
  const together = first !== undefined && last !== undefined && last - first <= spread + 1e-9;
  const mid = offsets.length / 2;
  const offset =
    offsets.length === 0
      ? null
      : offsets.length % 2 === 1
        ? (offsets[Math.floor(mid)] as number)
        : ((offsets[mid - 1] as number) + (offsets[mid] as number)) / 2;
  return { complete, together, offset };
}

interface Current {
  index: number;
  kind: string;
  pitches: number[];
  root: number | undefined;
  shownAt: number;
  wrongFirst: boolean;
  causes: ChordMiss[];
}

export interface ChordKindSummary {
  kind: string;
  attempts: number;
  firstTry: number;
  causes: Partial<Record<ChordMiss, number>>;
}

export interface ChordRoundSummary {
  chords: number;
  firstTry: number;
  /** Share right at the first try, 0 to 1 (0 with no chords). */
  share: number;
  /** Median seconds to complete a chord; null when none was completed. */
  medianSeconds: number | null;
  /** Chords completed a minute over the chords' own times; 0 before a second has passed. */
  perMinute: number;
  byKind: ChordKindSummary[];
}

export class ChordTally {
  private current: Current | null = null;
  private readonly done: ChordAttempt[] = [];

  get attempts(): readonly ChordAttempt[] {
    return this.done;
  }

  reset(): void {
    this.current = null;
    this.done.length = 0;
  }

  /** A chord is shown (wait mode: its step became current). `root` is its root's pitch. */
  start(
    index: number,
    kind: string,
    pitches: readonly number[],
    time: number,
    root?: number,
  ): void {
    this.current = {
      index,
      kind,
      pitches: [...pitches],
      root,
      shownAt: time,
      wrongFirst: false,
      causes: [],
    };
  }

  /** A key outside the current chord. */
  wrong(pitch: number): void {
    const c = this.current;
    if (!c) return;
    c.wrongFirst = true;
    const cause = missCause(pitch, c.pitches, c.root);
    if (!c.causes.includes(cause)) c.causes.push(cause);
  }

  /** The current chord's last note was played at `time`. */
  complete(time: number): ChordAttempt | null {
    const c = this.current;
    if (!c) return null;
    return this.finish(c, !c.wrongFirst, Math.max(0, time - c.shownAt));
  }

  /** The learner asked to see the chord ("Show me"): a miss, with a note missing. */
  reveal(): void {
    const c = this.current;
    if (!c) return;
    c.wrongFirst = true;
    if (!c.causes.includes('missing')) c.causes.unshift('missing');
  }

  /**
   * A chord at a tempo, judged by play-along: right at the first try when every note was played,
   * together, and no wrong key came while it was due. `wrongPitches` are the extra keys pressed in
   * its window.
   */
  judged(
    index: number,
    kind: string,
    results: readonly NoteResult[],
    wrongPitches: readonly number[],
    spread = CHORD_SPREAD,
    root?: number,
  ): ChordAttempt {
    const pitches = results.map((r) => r.note.pitch).sort((a, b) => a - b);
    const t = judgeTogether(results, spread);
    const causes: ChordMiss[] = [];
    if (!t.complete) causes.push('missing');
    for (const p of wrongPitches) {
      const cause = missCause(p, pitches, root);
      if (!causes.includes(cause)) causes.push(cause);
    }
    const attempt: ChordAttempt = {
      index,
      kind,
      pitches,
      firstTry: t.complete && t.together && wrongPitches.length === 0,
      seconds: null,
      causes,
    };
    this.done.push(attempt);
    return attempt;
  }

  private finish(c: Current, firstTry: boolean, seconds: number): ChordAttempt {
    const attempt: ChordAttempt = {
      index: c.index,
      kind: c.kind,
      pitches: c.pitches,
      firstTry,
      seconds,
      causes: firstTry ? [] : c.causes,
    };
    this.done.push(attempt);
    this.current = null;
    return attempt;
  }

  summary(): ChordRoundSummary {
    return summariseChords(this.done);
  }
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 === 1
    ? (s[Math.floor(mid)] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function summariseChords(attempts: readonly ChordAttempt[]): ChordRoundSummary {
  const byKind = new Map<string, ChordKindSummary>();
  let firstTry = 0;
  const times: number[] = [];
  for (const a of attempts) {
    if (a.firstTry) firstTry += 1;
    if (a.seconds !== null) times.push(a.seconds);
    const k = byKind.get(a.kind) ?? { kind: a.kind, attempts: 0, firstTry: 0, causes: {} };
    k.attempts += 1;
    if (a.firstTry) k.firstTry += 1;
    for (const cause of a.causes) k.causes[cause] = (k.causes[cause] ?? 0) + 1;
    byKind.set(a.kind, k);
  }
  const total = times.reduce((s, t) => s + t, 0);
  return {
    chords: attempts.length,
    firstTry,
    share: attempts.length > 0 ? firstTry / attempts.length : 0,
    medianSeconds: medianOf(times),
    perMinute: total >= 1 ? Math.round((times.length * 60) / total) : 0,
    byKind: [...byKind.values()],
  };
}

/**
 * The chords that went wrong most, worst first: the share right at the first try, then the most
 * misses. Only chords with a miss are listed.
 */
export function hardestChords(summary: ChordRoundSummary, count = 3): ChordKindSummary[] {
  return summary.byKind
    .filter((k) => k.firstTry < k.attempts)
    .sort(
      (a, b) =>
        a.firstTry / a.attempts - b.firstTry / b.attempts ||
        b.attempts - b.firstTry - (a.attempts - a.firstTry),
    )
    .slice(0, count);
}

/** The cause a kind went wrong by most often. */
export function mainCause(k: ChordKindSummary): ChordMiss | null {
  let best: ChordMiss | null = null;
  let most = 0;
  for (const [cause, n] of Object.entries(k.causes) as [ChordMiss, number][]) {
    if (n > most) {
      best = cause;
      most = n;
    }
  }
  return best;
}

// Judging scales in a scale drill (P7-18, ADR 0024). Wait mode and play-along judge notes; this
// layer above them says whether a whole scale was right at the first try, why a note went wrong
// (the key's sharp or flat, the form of a minor, a note skipped), and how even the run was: a good
// scale is a steady one, and an uneven one is nearly always uneven where the thumb passes under.
// Pieces and the other drills never use it.
import { judgeTogether, medianOf, CHORD_SPREAD } from './chord-tally';
import type { NoteResult } from './play-along';
import type { ScaleStep } from './scale-drills';

/**
 * Why a scale went wrong: the key's sharp or flat played wrong (`key`), a minor's sixth or seventh
 * in the wrong form (`form`), a later note played early (`skip`), another key (`other`), a note not
 * played at a tempo (`missing`), the hands not together (`apart`), or the scale shown on request
 * (`shown`).
 */
export type ScaleMiss = 'key' | 'form' | 'skip' | 'other' | 'missing' | 'apart' | 'shown';

/** Where an uneven run was least even. */
export type UnevenAt = 'thumb' | 'turn' | 'other';

export interface ScaleAttempt {
  /** Which scale of the round. */
  index: number;
  /** The scale's key as the drill names it (`pitchClass.kind`). */
  kind: string;
  notes: number;
  firstTry: boolean;
  /** From its first note to its last; null when it was not finished. */
  seconds: number | null;
  wrong: number;
  /** What went wrong, each cause once, in the order it happened. */
  causes: ScaleMiss[];
  /** How far the gaps between notes stray from their median, as a share of it; null if too short. */
  evenness: number | null;
  /** Where the run was least even, when it was uneven. */
  unevenAt: UnevenAt | null;
}

/** Evenness under this reads as very even, under `EVEN` as even, above as uneven. */
export const VERY_EVEN = 0.12;
export const EVEN = 0.25;
/** Gaps needed before evenness says anything. */
const MIN_GAPS = 4;

const MINOR = new Set(['natural-minor', 'harmonic-minor', 'melodic-minor']);

/** Why `pitch` was played at `step` instead of its notes. */
export function scaleMissCause(
  pitch: number,
  steps: readonly ScaleStep[],
  index: number,
): ScaleMiss {
  const step = steps[index];
  if (!step) return 'other';
  const later = [steps[index + 1], steps[index + 2]].filter(
    (s): s is ScaleStep => s !== undefined && s.scale === step.scale,
  );
  if (later.some((s) => s.pitches.includes(pitch))) return 'skip';
  if (!step.pitches.some((p) => Math.abs(p - pitch) === 1)) return 'other';
  const kind = step.kind.split('.')[1] ?? '';
  return MINOR.has(kind) && (step.degree === 5 || step.degree === 6) ? 'form' : 'key';
}

/**
 * How even a run's notes were: the spread (standard deviation) of the gaps between onsets as a
 * share of their median gap, and the gap that strayed most. Null with fewer than four gaps.
 */
export function evennessOf(times: readonly number[]): { evenness: number; worst: number } | null {
  const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
  if (gaps.length < MIN_GAPS) return null;
  const median = medianOf(gaps) ?? 0;
  if (median <= 0) return null;
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  let worst = 0;
  for (const [i, g] of gaps.entries()) {
    if (Math.abs(g - median) > Math.abs((gaps[worst] as number) - median)) worst = i;
  }
  return { evenness: sd / median, worst };
}

/** Where the gap between steps `i` and `i + 1` falls: a thumb passing, the turn at the top, or elsewhere. */
function placeOf(steps: readonly ScaleStep[], i: number): UnevenAt {
  const a = steps[i];
  const b = steps[i + 1];
  if (!a || !b) return 'other';
  if (a.direction !== b.direction) return 'turn';
  const fa = a.finger;
  const fb = b.finger;
  if (fa !== undefined && fb !== undefined && (fa === 1) !== (fb === 1) && Math.max(fa, fb) >= 3)
    return 'thumb';
  return 'other';
}

interface Open {
  index: number;
  kind: string;
  first: number;
  last: number;
  /** Onset time per step, by the step's place in the scale. */
  times: Map<number, number>;
  wrong: number;
  causes: ScaleMiss[];
  missed: boolean;
}

export interface ScaleKindSummary {
  kind: string;
  attempts: number;
  firstTry: number;
  causes: Partial<Record<ScaleMiss, number>>;
  /** Mean evenness over the attempts that had one. */
  evenness: number | null;
}

export interface ScaleRoundSummary {
  scales: number;
  firstTry: number;
  /** Share right at the first try, 0 to 1 (0 with no scales). */
  share: number;
  /** Notes a minute over the finished scales' own times; 0 before a second has passed. */
  notesPerMinute: number;
  /** The median evenness of the round's scales; null when none could be measured. */
  evenness: number | null;
  /** The commonest place the uneven scales were uneven. */
  unevenAt: UnevenAt | null;
  byKind: ScaleKindSummary[];
}

export class ScaleTally {
  private steps: readonly ScaleStep[] = [];
  private open = new Map<number, Open>();
  private readonly done: ScaleAttempt[] = [];

  /** The drill's steps, as `scaleSteps` lists them; clears what was judged. */
  setSteps(steps: readonly ScaleStep[]): void {
    this.steps = steps;
    this.reset();
  }

  get attempts(): readonly ScaleAttempt[] {
    return this.done;
  }

  reset(): void {
    this.open.clear();
    this.done.length = 0;
  }

  private scaleAt(stepIndex: number): Open | null {
    const step = this.steps[stepIndex];
    if (!step) return null;
    let o = this.open.get(step.scale);
    if (!o) {
      if (this.done.some((a) => a.index === step.scale)) return null;
      o = {
        index: step.scale,
        kind: step.kind,
        first: Infinity,
        last: -Infinity,
        times: new Map(),
        wrong: 0,
        causes: [],
        missed: false,
      };
      this.open.set(step.scale, o);
    }
    return o;
  }

  private cause(o: Open, cause: ScaleMiss): void {
    if (!o.causes.includes(cause)) o.causes.push(cause);
  }

  /** Steps of the scale `index`, in order. */
  private stepsOf(index: number): number[] {
    const out: number[] = [];
    for (const [i, s] of this.steps.entries()) if (s.scale === index) out.push(i);
    return out;
  }

  /** A step's notes were all played, at `time` (wait mode: when it was complete). */
  played(stepIndex: number, time: number): ScaleAttempt | null {
    const o = this.scaleAt(stepIndex);
    if (!o) return null;
    o.times.set(stepIndex, time);
    o.first = Math.min(o.first, time);
    o.last = Math.max(o.last, time);
    const own = this.stepsOf(o.index);
    return own[own.length - 1] === stepIndex ? this.close(o) : null;
  }

  /** A key that is not the step's, pressed while waiting at it. */
  wrong(stepIndex: number, pitch: number): void {
    const o = this.scaleAt(stepIndex);
    if (!o) return;
    o.wrong += 1;
    this.cause(o, scaleMissCause(pitch, this.steps, stepIndex));
  }

  /** The learner asked to see the scale ("Show me"): a miss. */
  reveal(stepIndex: number): void {
    const o = this.scaleAt(stepIndex);
    if (o) this.cause(o, 'shown');
  }

  /**
   * A step at a tempo, judged by play-along once all its notes are: its onset is the median of
   * the notes played, a note not played is missing, two hands apart by more than `spread` are
   * apart, and `wrongPitches` are the extra keys pressed in its window.
   */
  judged(
    stepIndex: number,
    results: readonly NoteResult[],
    wrongPitches: readonly number[],
    spread = CHORD_SPREAD,
  ): ScaleAttempt | null {
    const o = this.scaleAt(stepIndex);
    if (!o) return null;
    const t = judgeTogether(results, spread);
    if (!t.complete) {
      o.missed = true;
      this.cause(o, 'missing');
    } else if (!t.together && results.length > 1) {
      this.cause(o, 'apart');
    }
    for (const p of wrongPitches) {
      o.wrong += 1;
      this.cause(o, scaleMissCause(p, this.steps, stepIndex));
    }
    const due = results[0]?.note.time;
    if (t.offset !== null && due !== undefined) {
      const time = due + t.offset;
      o.times.set(stepIndex, time);
      o.first = Math.min(o.first, time);
      o.last = Math.max(o.last, time);
    }
    const own = this.stepsOf(o.index);
    return own[own.length - 1] === stepIndex ? this.close(o) : null;
  }

  /** Closes the scales still open (a run stopped or ended at a tempo): each counts as a miss. */
  finish(): void {
    for (const o of [...this.open.values()]) {
      if (o.times.size < this.stepsOf(o.index).length) {
        o.missed = true;
        this.cause(o, 'missing');
      }
      this.close(o);
    }
  }

  private close(o: Open): ScaleAttempt {
    this.open.delete(o.index);
    const own = this.stepsOf(o.index);
    const times = own.map((i) => o.times.get(i)).filter((t): t is number => t !== undefined);
    const ordered = own.filter((i) => o.times.has(i));
    const even = o.missed ? null : evennessOf(times);
    const finished = !o.missed && times.length === own.length;
    const attempt: ScaleAttempt = {
      index: o.index,
      kind: o.kind,
      notes: own.length,
      firstTry: finished && o.causes.length === 0,
      seconds: finished && times.length > 1 ? o.last - o.first : null,
      wrong: o.wrong,
      causes: o.causes,
      evenness: even ? even.evenness : null,
      unevenAt:
        even && even.evenness >= EVEN ? placeOf(this.steps, ordered[even.worst] ?? -1) : null,
    };
    this.done.push(attempt);
    return attempt;
  }

  summary(): ScaleRoundSummary {
    return summariseScales(this.done);
  }
}

export function summariseScales(attempts: readonly ScaleAttempt[]): ScaleRoundSummary {
  const byKind = new Map<string, ScaleKindSummary & { evens: number[] }>();
  let firstTry = 0;
  let notes = 0;
  let seconds = 0;
  const evens: number[] = [];
  const places = new Map<UnevenAt, number>();
  for (const a of attempts) {
    if (a.firstTry) firstTry += 1;
    if (a.seconds !== null) {
      notes += a.notes - 1;
      seconds += a.seconds;
    }
    if (a.evenness !== null) evens.push(a.evenness);
    if (a.unevenAt) places.set(a.unevenAt, (places.get(a.unevenAt) ?? 0) + 1);
    const k = byKind.get(a.kind) ?? {
      kind: a.kind,
      attempts: 0,
      firstTry: 0,
      causes: {},
      evenness: null,
      evens: [],
    };
    k.attempts += 1;
    if (a.firstTry) k.firstTry += 1;
    for (const cause of a.causes) k.causes[cause] = (k.causes[cause] ?? 0) + 1;
    if (a.evenness !== null) k.evens.push(a.evenness);
    byKind.set(a.kind, k);
  }
  let unevenAt: UnevenAt | null = null;
  for (const [place, n] of places)
    if (!unevenAt || n > (places.get(unevenAt) ?? 0)) unevenAt = place;
  return {
    scales: attempts.length,
    firstTry,
    share: attempts.length > 0 ? firstTry / attempts.length : 0,
    notesPerMinute: seconds >= 1 ? Math.round((notes * 60) / seconds) : 0,
    evenness: medianOf(evens),
    unevenAt,
    byKind: [...byKind.values()].map(({ evens: e, ...k }) => ({
      ...k,
      evenness: e.length > 0 ? e.reduce((s, x) => s + x, 0) / e.length : null,
    })),
  };
}

/**
 * The scales that went wrong most, worst first: the share right at the first try, then the most
 * misses. Only scales with a miss are listed.
 */
export function hardestScales(summary: ScaleRoundSummary, count = 3): ScaleKindSummary[] {
  return summary.byKind
    .filter((k) => k.firstTry < k.attempts)
    .sort(
      (a, b) =>
        a.firstTry / a.attempts - b.firstTry / b.attempts ||
        b.attempts - b.firstTry - (a.attempts - a.firstTry),
    )
    .slice(0, count);
}

/** The cause a scale went wrong by most often. */
export function mainScaleCause(k: ScaleKindSummary): ScaleMiss | null {
  let best: ScaleMiss | null = null;
  let most = 0;
  for (const [cause, n] of Object.entries(k.causes) as [ScaleMiss, number][]) {
    if (n > most) {
      best = cause;
      most = n;
    }
  }
  return best;
}

/** Evenness in three words' worth: very even, even or uneven. */
export function evennessWord(evenness: number): 'very-even' | 'even' | 'uneven' {
  return evenness < VERY_EVEN ? 'very-even' : evenness < EVEN ? 'even' : 'uneven';
}

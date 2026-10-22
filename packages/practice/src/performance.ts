// Recording what the learner played (Phase 4): when each key went down and up. From it the app
// judges how long each note was held, plays the performance back, and builds a polished version
// that keeps the learner's right notes and dynamics but sits exactly in time.
import type { NoteEvent } from './events';
import type { TimedNote } from './play-along';

export interface PlayedNote {
  pitch: number;
  /** Key down, practice clock (s). */
  start: number;
  /** Key up; undefined while held or when the input cannot tell (microphone). */
  end?: number;
  velocity: number;
}

export class PerformanceRecorder {
  readonly notes: PlayedNote[] = [];
  private readonly open = new Map<number, PlayedNote>();

  noteOn(e: NoteEvent): void {
    const prev = this.open.get(e.pitch);
    if (prev && prev.end === undefined) prev.end = e.time;
    const n: PlayedNote = { pitch: e.pitch, start: e.time, velocity: e.velocity ?? 80 };
    this.notes.push(n);
    this.open.set(e.pitch, n);
  }

  noteOff(pitch: number, time: number): void {
    const n = this.open.get(pitch);
    if (n && n.end === undefined && time >= n.start) n.end = time;
    this.open.delete(pitch);
  }

  /** Closes held notes at `time` (end of a run). */
  finish(time: number): PlayedNote[] {
    for (const n of this.open.values()) if (n.end === undefined) n.end = Math.max(n.start, time);
    this.open.clear();
    return this.notes;
  }

  clear(): void {
    this.notes.length = 0;
    this.open.clear();
  }

  /** Moves every recorded time by `seconds`, for a practice clock that jumped. */
  shift(seconds: number): void {
    for (const n of this.notes) {
      n.start += seconds;
      if (n.end !== undefined) n.end += seconds;
    }
  }
}

export interface TimedNoteWithLength extends TimedNote {
  /** How long the note should be held (s). */
  duration: number;
}

export type HoldJudgement = 'good' | 'short' | 'long';

export interface HoldResult {
  note: TimedNoteWithLength;
  played: PlayedNote;
  /** Played length divided by the written length. */
  ratio: number;
  judgement: HoldJudgement;
}

/** A played note counts as held well between these fractions of the written length. */
export const HOLD_TOLERANCE = { short: 0.6, long: 1.4 } as const;

/**
 * Judges one hold: `written` is how long the note should sound and `held` how long the key was
 * down, both in seconds at the practice tempo. Very short written notes (staccato, fast runs) are
 * hard to time, so only clear cases count as short or long.
 */
export function judgeHold(written: number, held: number): HoldJudgement {
  if (written <= 0) return 'good';
  const ratio = held / written;
  const minLen = Math.min(written, 0.12);
  if (ratio < HOLD_TOLERANCE.short && held < written - minLen) return 'short';
  if (ratio > HOLD_TOLERANCE.long && held > written + 0.1) return 'long';
  return 'good';
}

/** Seconds after the key went down from which a still-held note counts as held too long. */
export function holdOverdueAfter(written: number): number {
  return Math.max(written * HOLD_TOLERANCE.long, written + 0.1);
}

/**
 * Judges how long each matched note was held. Notes are matched by pitch to the nearest played
 * onset within `window` seconds; notes without a key-up time (microphone) are skipped.
 */
export function judgeHolds(
  expected: readonly TimedNoteWithLength[],
  played: readonly PlayedNote[],
  window = 0.2,
): HoldResult[] {
  const used = new Set<PlayedNote>();
  const out: HoldResult[] = [];
  for (const note of expected) {
    let best: PlayedNote | undefined;
    let bestDist = Infinity;
    for (const p of played) {
      if (used.has(p) || p.pitch !== note.pitch) continue;
      const d = Math.abs(p.start - note.time);
      if (d <= window && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    if (!best || best.end === undefined) continue;
    used.add(best);
    const held = best.end - best.start;
    const ratio = note.duration > 0 ? held / note.duration : 1;
    out.push({ note, played: best, ratio, judgement: judgeHold(note.duration, held) });
  }
  return out;
}

/** A note to render or play back. Times in seconds from the start of the rendering. */
export interface RenderNote {
  pitch: number;
  time: number;
  duration: number;
  velocity: number;
}

/** The performance exactly as played, starting at 0. */
export function asPlayed(played: readonly PlayedNote[], defaultLength = 0.5): RenderNote[] {
  if (played.length === 0) return [];
  const t0 = Math.min(...played.map((p) => p.start));
  return played.map((p) => ({
    pitch: p.pitch,
    time: p.start - t0,
    duration: Math.max(0.05, (p.end ?? p.start + defaultLength) - p.start),
    velocity: p.velocity,
  }));
}

export interface PolishOptions {
  /** How far a played onset may be from the written one to count as that note (s). */
  window?: number;
  /**
   * `time` matches played notes to written ones by onset (play-along, where the clock runs);
   * `order` takes the learner's notes of each pitch in the order they were played (wait mode,
   * where the learner sets the pace and onsets do not line up with the written times).
   */
  match?: 'time' | 'order';
}

/**
 * A polished version: every written note the learner played sounds exactly on time and for its
 * written length, with the learner's own velocity; written notes they missed are filled in
 * quietly so the music stays whole; wrong extra notes are left out.
 */
export function polished(
  expected: readonly TimedNoteWithLength[],
  played: readonly PlayedNote[],
  options: PolishOptions = {},
): RenderNote[] {
  if (expected.length === 0) return [];
  const window = options.window ?? 0.25;
  const t0 = Math.min(...expected.map((n) => n.time));
  const used = new Set<PlayedNote>();
  const velocities = played.map((p) => p.velocity).sort((a, b) => a - b);
  const typical = velocities[Math.floor(velocities.length / 2)] ?? 72;
  const byPitch = new Map<number, PlayedNote[]>();
  if (options.match === 'order') {
    for (const p of [...played].sort((a, b) => a.start - b.start)) {
      (byPitch.get(p.pitch) ?? byPitch.set(p.pitch, []).get(p.pitch))?.push(p);
    }
  }
  const inOrder = [...expected].sort((a, b) => a.time - b.time);
  const matched = new Map<TimedNoteWithLength, PlayedNote>();
  for (const n of inOrder) {
    let match: PlayedNote | undefined;
    if (options.match === 'order') {
      match = byPitch.get(n.pitch)?.shift();
    } else {
      let bestDist = Infinity;
      for (const p of played) {
        if (used.has(p) || p.pitch !== n.pitch) continue;
        const d = Math.abs(p.start - n.time);
        if (d <= window && d < bestDist) {
          match = p;
          bestDist = d;
        }
      }
    }
    if (match) {
      used.add(match);
      matched.set(n, match);
    }
  }
  return expected.map((n) => {
    const match = matched.get(n);
    return {
      pitch: n.pitch,
      time: n.time - t0,
      duration: Math.max(0.05, n.duration),
      velocity: match ? match.velocity : Math.round(typical * 0.75),
    };
  });
}

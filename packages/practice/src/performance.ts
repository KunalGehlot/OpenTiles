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
    const ratio = note.duration > 0 ? (best.end - best.start) / note.duration : 1;
    // Very short written notes (staccato, fast runs) are hard to time; only flag clear cases.
    const minLen = Math.min(note.duration, 0.12);
    const judgement: HoldJudgement =
      ratio < HOLD_TOLERANCE.short && best.end - best.start < note.duration - minLen
        ? 'short'
        : ratio > HOLD_TOLERANCE.long && best.end - best.start > note.duration + 0.1
          ? 'long'
          : 'good';
    out.push({ note, played: best, ratio, judgement });
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

/**
 * A polished version: every written note the learner played (within `window` of its time) sounds
 * exactly on time and for its written length, with the learner's own velocity; written notes they
 * missed are filled in quietly so the music stays whole; wrong extra notes are left out.
 */
export function polished(
  expected: readonly TimedNoteWithLength[],
  played: readonly PlayedNote[],
  window = 0.25,
): RenderNote[] {
  if (expected.length === 0) return [];
  const t0 = Math.min(...expected.map((n) => n.time));
  const used = new Set<PlayedNote>();
  const velocities = played.map((p) => p.velocity).sort((a, b) => a - b);
  const typical = velocities[Math.floor(velocities.length / 2)] ?? 72;
  return expected.map((n) => {
    let match: PlayedNote | undefined;
    let bestDist = Infinity;
    for (const p of played) {
      if (used.has(p) || p.pitch !== n.pitch) continue;
      const d = Math.abs(p.start - n.time);
      if (d <= window && d < bestDist) {
        match = p;
        bestDist = d;
      }
    }
    if (match) used.add(match);
    return {
      pitch: n.pitch,
      time: n.time - t0,
      duration: Math.max(0.05, n.duration),
      velocity: match ? match.velocity : Math.round(typical * 0.75),
    };
  });
}

// Practice steps: the notes that start together (a chord or a single note), in order.
import type { Hand, Song, SongNote } from '@opentiles/song-model';

export type HandFilter = 'both' | Hand;

export interface Step {
  index: number;
  beat: number;
  measureIndex: number;
  /** Notes the learner plays at this step. */
  notes: SongNote[];
  /** Distinct pitches, ascending. */
  pitches: number[];
}

/** Notes closer than this (in beats) start "together". */
const SAME_ONSET = 1e-3;

export function includesHand(filter: HandFilter, hand: Hand): boolean {
  return filter === 'both' || filter === hand;
}

/**
 * Groups the song's notes for the selected hands into steps. `fromBeat`/`toBeat` restrict the
 * range (for looping a section).
 */
export function buildSteps(
  song: Song,
  hands: HandFilter = 'both',
  range: { fromBeat?: number; toBeat?: number } = {},
): Step[] {
  const from = range.fromBeat ?? -Infinity;
  const to = range.toBeat ?? Infinity;
  const notes = song.notes.filter(
    (n) =>
      includesHand(hands, n.hand) &&
      n.startBeat >= from - SAME_ONSET &&
      n.startBeat < to - SAME_ONSET,
  );
  const steps: Step[] = [];
  for (const n of notes) {
    const last = steps[steps.length - 1];
    if (last && Math.abs(n.startBeat - last.beat) <= SAME_ONSET) {
      last.notes.push(n);
      if (!last.pitches.includes(n.pitch)) last.pitches.push(n.pitch);
    } else {
      steps.push({
        index: steps.length,
        beat: n.startBeat,
        measureIndex: n.measureIndex,
        notes: [n],
        pitches: [n.pitch],
      });
    }
  }
  for (const s of steps) s.pitches.sort((a, b) => a - b);
  return steps;
}

/** Notes of the hands *not* being practised that start in `[fromBeat, toBeat)`; the app plays
 * them so the learner hears the whole piece (spec §4 hand separation). */
export function accompanimentBetween(
  song: Song,
  practised: HandFilter,
  fromBeat: number,
  toBeat: number,
): SongNote[] {
  if (practised === 'both') return [];
  return song.notes.filter(
    (n) =>
      n.hand !== practised &&
      n.startBeat >= fromBeat - SAME_ONSET &&
      n.startBeat < toBeat - SAME_ONSET,
  );
}

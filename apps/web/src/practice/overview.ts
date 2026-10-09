// Geometry of the overview strip (P5-07): the whole piece as one thin bar, where a bar of music is
// a slice as wide as its share of the beats. Pure, so it is unit-tested in Node.
import type { LoopRange } from '@opentiles/practice';
import type { Song } from '@opentiles/song-model';

/** A bar's slice of the strip, as fractions of its width. */
export interface BarSlice {
  index: number;
  left: number;
  width: number;
}

function length(song: Song): number {
  const last = song.measures[song.measures.length - 1];
  const end = last ? last.startBeat + last.lengthBeats : 0;
  return Math.max(song.lengthBeats, end, 1e-9);
}

/** Where `beat` sits along the strip, 0 to 1. */
export function fractionOfBeat(song: Song, beat: number): number {
  return Math.min(1, Math.max(0, beat / length(song)));
}

export function barSlices(song: Song): BarSlice[] {
  const total = length(song);
  return song.measures.map((m) => ({
    index: m.index,
    left: m.startBeat / total,
    width: m.lengthBeats / total,
  }));
}

/** The bar under a point `fraction` of the way along the strip. */
export function barAtFraction(song: Song, fraction: number): number {
  const beat = Math.min(1, Math.max(0, fraction)) * length(song);
  let found = 0;
  for (const m of song.measures) {
    if (m.startBeat <= beat + 1e-9) found = m.index;
    else break;
  }
  return found;
}

/** The slice from the start of one bar to the end of another, in either order. */
export function sliceOfBars(song: Song, a: number, b: number): { left: number; width: number } {
  const slices = barSlices(song);
  const first = slices[Math.min(a, b)];
  const last = slices[Math.max(a, b)];
  if (!first || !last) return { left: 0, width: 0 };
  return { left: first.left, width: last.left + last.width - first.left };
}

/** The bars between two points of a drag, in order. */
export function loopBetween(song: Song, a: number, b: number): LoopRange {
  const from = barAtFraction(song, Math.min(a, b));
  const to = barAtFraction(song, Math.max(a, b));
  return { fromMeasure: from, toMeasure: to };
}

/** A loop with one end moved to `bar`, never past the other end. */
export function moveLoopEnd(loop: LoopRange, end: 'from' | 'to', bar: number): LoopRange {
  return end === 'from'
    ? { fromMeasure: Math.min(bar, loop.toMeasure), toMeasure: loop.toMeasure }
    : { fromMeasure: loop.fromMeasure, toMeasure: Math.max(bar, loop.fromMeasure) };
}

/** The notes as small marks for the strip's picture: x and width in 0..1, y in 0..1 (top high). */
export function noteMarks(
  song: Song,
): { x: number; width: number; y: number; hand: 'left' | 'right' }[] {
  if (song.notes.length === 0) return [];
  let low = Infinity;
  let high = -Infinity;
  for (const n of song.notes) {
    low = Math.min(low, n.pitch);
    high = Math.max(high, n.pitch);
  }
  const span = Math.max(12, high - low);
  const mid = (low + high) / 2;
  const total = length(song);
  return song.notes.map((n) => ({
    x: n.startBeat / total,
    width: n.durationBeats / total,
    y: 1 - ((n.pitch - mid) / span + 0.5),
    hand: n.hand,
  }));
}

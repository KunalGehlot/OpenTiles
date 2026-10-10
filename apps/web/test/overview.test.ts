// Geometry of the overview strip (P5-07). Songs are generated here (CC0).
import { describe, expect, it } from 'vitest';
import type { Song, SongNote } from '@opentiles/song-model';
import {
  barAtFraction,
  barSlices,
  fractionOfBeat,
  loopBetween,
  moveLoopEnd,
  noteMarks,
  sliceOfBars,
} from '../src/practice/overview';

/** Four bars: 4/4, 2/4, 4/4, 2/4 (12 beats), a note at the start of each. */
function piece(): Song {
  const lengths = [4, 2, 4, 2];
  let beat = 0;
  const measures = lengths.map((lengthBeats, index) => {
    const m = {
      index,
      number: String(index + 1),
      sourceIndex: index,
      startBeat: beat,
      lengthBeats,
    };
    beat += lengthBeats;
    return m;
  });
  const notes: SongNote[] = measures.map((m, i) => ({
    id: `n${i}`,
    pitch: i % 2 ? 48 : 72,
    startBeat: m.startBeat,
    durationBeats: 1,
    hand: i % 2 ? 'left' : 'right',
    staff: i % 2 ? 2 : 1,
    voice: 1,
    part: 0,
    measureIndex: i,
    sourceRefs: [],
  }));
  return {
    title: 'Overview',
    format: 'musicxml',
    notes,
    measures,
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: 12,
    warnings: [],
  };
}

describe('the overview strip', () => {
  it('gives each bar a slice as wide as its beats', () => {
    const slices = barSlices(piece());
    expect(slices.map((s) => [s.left * 12, s.width * 12])).toEqual([
      [0, 4],
      [4, 2],
      [6, 4],
      [10, 2],
    ]);
    expect(fractionOfBeat(piece(), 6)).toBe(0.5);
    expect(fractionOfBeat(piece(), 20)).toBe(1);
    expect(fractionOfBeat(piece(), -1)).toBe(0);
  });

  it('finds the bar under a point and the bars between two points', () => {
    const song = piece();
    expect(barAtFraction(song, 0)).toBe(0);
    expect(barAtFraction(song, 5 / 12)).toBe(1);
    expect(barAtFraction(song, 0.5)).toBe(2);
    expect(barAtFraction(song, 1)).toBe(3);
    expect(barAtFraction(song, 1.4)).toBe(3);
    expect(loopBetween(song, 0.9, 0.1)).toEqual({ fromMeasure: 0, toMeasure: 3 });
    expect(loopBetween(song, 0.4, 0.6)).toEqual({ fromMeasure: 1, toMeasure: 2 });
    const s = sliceOfBars(song, 2, 1);
    expect(s.left * 12).toBeCloseTo(4, 9);
    expect(s.width * 12).toBeCloseTo(6, 9);
  });

  it('moves one end of a loop, never past the other', () => {
    const loop = { fromMeasure: 1, toMeasure: 2 };
    expect(moveLoopEnd(loop, 'from', 0)).toEqual({ fromMeasure: 0, toMeasure: 2 });
    expect(moveLoopEnd(loop, 'from', 3)).toEqual({ fromMeasure: 2, toMeasure: 2 });
    expect(moveLoopEnd(loop, 'to', 3)).toEqual({ fromMeasure: 1, toMeasure: 3 });
    expect(moveLoopEnd(loop, 'to', 0)).toEqual({ fromMeasure: 1, toMeasure: 1 });
  });

  it('draws high notes near the top and low notes near the bottom', () => {
    const marks = noteMarks(piece());
    expect(marks).toHaveLength(4);
    expect(marks[0]?.hand).toBe('right');
    expect(marks[0]?.y ?? 1).toBeLessThan(marks[1]?.y ?? 0);
    for (const m of marks) {
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(1);
    }
    expect(noteMarks({ ...piece(), notes: [] })).toEqual([]);
  });
});

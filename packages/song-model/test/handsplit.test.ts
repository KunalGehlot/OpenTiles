import { describe, expect, it } from 'vitest';
import { splitHands } from '../src/handsplit';
import {
  transpose,
  transposeKey,
  resplitHands,
  setBaseTempo,
  swapHands,
  trimMeasures,
} from '../src/transform';
import type { Song } from '../src/types';

describe('splitHands', () => {
  it('splits melody and bass around middle C', () => {
    const notes = [
      { pitch: 72, startBeat: 0 },
      { pitch: 48, startBeat: 0 },
      { pitch: 74, startBeat: 1 },
      { pitch: 43, startBeat: 1 },
    ];
    expect(splitHands(notes)).toEqual(['right', 'left', 'right', 'left']);
  });

  it('keeps a melody that dips below middle C in the right hand', () => {
    const notes = [
      { pitch: 64, startBeat: 0 },
      { pitch: 36, startBeat: 0 },
      { pitch: 62, startBeat: 1 },
      { pitch: 59, startBeat: 2 },
      { pitch: 60, startBeat: 3 },
    ];
    expect(splitHands(notes)).toEqual(['right', 'left', 'right', 'right', 'right']);
  });

  it('never lets one hand stretch more than a ninth', () => {
    const chord = [55, 62, 67, 79].map((pitch) => ({ pitch, startBeat: 0 }));
    const hands = splitHands(chord);
    const rh = chord.filter((_, i) => hands[i] === 'right').map((n) => n.pitch);
    expect(Math.max(...rh) - Math.min(...rh)).toBeLessThanOrEqual(14);
  });
});

const baseSong = (): Song => ({
  title: 't',
  format: 'midi',
  notes: [
    {
      id: 'n0',
      pitch: 48,
      startBeat: 0,
      durationBeats: 4,
      hand: 'left',
      staff: 2,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    },
    {
      id: 'n1',
      pitch: 64,
      startBeat: 0,
      durationBeats: 1,
      hand: 'right',
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    },
    {
      id: 'n2',
      pitch: 67,
      startBeat: 4,
      durationBeats: 1,
      hand: 'right',
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: 1,
      sourceRefs: [],
    },
  ],
  measures: [
    { index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: 4 },
    { index: 1, number: '2', sourceIndex: 1, startBeat: 4, lengthBeats: 4 },
  ],
  tempos: [{ beat: 0, bpm: 100 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  keySignatures: [{ beat: 0, fifths: 0, mode: 'major' }],
  parts: [{ name: 'Piano' }],
  lengthBeats: 8,
  warnings: [],
});

describe('transforms', () => {
  it('transposes notes and the key', () => {
    const s = transpose(baseSong(), 2);
    expect(s.notes.map((n) => n.pitch)).toEqual([50, 66, 69]);
    expect(s.keySignatures[0]?.fifths).toBe(2);
  });
  it('moves the key as the score views engrave it, also at a tritone and an octave', () => {
    // Two sharps up a tritone is A flat; C up a tritone is G flat and down one F sharp, as
    // Verovio writes them; an octave keeps the key, C sharp major included.
    expect(transposeKey(2, 6)).toBe(-4);
    expect(transposeKey(0, 6)).toBe(-6);
    expect(transposeKey(0, -6)).toBe(6);
    expect(transposeKey(5, 7)).toBe(-6);
    expect(transposeKey(7, 12)).toBe(7);
    expect(transposeKey(7, 5)).toBe(6);
    expect(transposeKey(-3, 1)).toBe(4);
  });
  it('swaps and re-splits hands', () => {
    expect(swapHands(baseSong()).notes.map((n) => n.hand)).toEqual(['right', 'left', 'left']);
    // Everything is below the new split point, but C3–E4 is too wide for one hand, so the span
    // rule hands E4 to the right hand.
    const high = resplitHands(baseSong(), 75);
    expect(high.notes.map((n) => n.hand)).toEqual(['left', 'right', 'left']);
    expect(high.notes.map((n) => n.staff)).toEqual([2, 1, 2]);
  });
  it('sets the base tempo', () => {
    expect(setBaseTempo(baseSong(), 80).tempos[0]?.bpm).toBe(80);
  });
  it('trims to a range of bars', () => {
    const s = trimMeasures(baseSong(), 1, 1);
    expect(s.notes.map((n) => [n.pitch, n.startBeat, n.measureIndex])).toEqual([[67, 0, 0]]);
    expect(s.lengthBeats).toBe(4);
    expect(s.tempos).toEqual([{ beat: 0, bpm: 100 }]);
  });
});

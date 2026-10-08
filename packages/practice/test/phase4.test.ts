import type { Song, SongNote } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import { fingerHand, withFingering } from '../src/fingering';
import {
  customKeyboard,
  fitToKeyboard,
  keyCount,
  notesOutside,
  presetById,
} from '../src/keyboard-size';
import {
  asPlayed,
  holdOverdueAfter,
  judgeHold,
  judgeHolds,
  PerformanceRecorder,
  polished,
} from '../src/performance';

const note = (
  pitch: number,
  startBeat: number,
  hand: 'left' | 'right' = 'right',
  fingering?: number,
): SongNote => ({
  id: `${hand}${pitch}@${startBeat}`,
  pitch,
  startBeat,
  durationBeats: 1,
  hand,
  staff: hand === 'right' ? 1 : 2,
  voice: 1,
  part: 0,
  measureIndex: 0,
  sourceRefs: [],
  ...(fingering ? { fingering } : {}),
});
const melody = (pitches: number[], hand: 'left' | 'right' = 'right') =>
  pitches.map((p, i) => note(p, i, hand));
const fingers = (notes: SongNote[], hand: 'left' | 'right' = 'right') => {
  const m = fingerHand(notes, hand);
  return notes.map((n) => m.get(n.id));
};
const song = (notes: SongNote[]): Song => ({
  title: 't',
  format: 'musicxml',
  notes,
  measures: [{ index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: notes.length }],
  tempos: [{ beat: 0, bpm: 120 }],
  timeSignatures: [],
  keySignatures: [],
  parts: [{ name: 'Piano' }],
  lengthBeats: notes.length,
  warnings: [],
});

describe('fingering', () => {
  it('plays a five-finger position with 1-2-3-4-5', () => {
    expect(fingers(melody([60, 62, 64, 65, 67]))).toEqual([1, 2, 3, 4, 5]);
    expect(fingers(melody([48, 50, 52, 53, 55], 'left'), 'left')).toEqual([5, 4, 3, 2, 1]);
  });

  it('fingers a C major scale with a thumb-under', () => {
    expect(fingers(melody([60, 62, 64, 65, 67, 69, 71, 72]))).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it('never uses one finger on two different notes in a row', () => {
    const f = fingers(melody([60, 67, 64, 72, 59, 65, 62, 69, 71, 60]));
    for (let i = 1; i < f.length; i++) expect(f[i]).not.toBe(f[i - 1]);
  });

  it('fingers the Ode to Joy theme in one position', () => {
    const f = fingers(melody([64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62]));
    expect(f).toEqual([3, 3, 4, 5, 5, 4, 3, 2, 1, 1, 2, 3, 3, 2, 2]);
  });

  it('gives chords fingers in hand order and keeps written fingering', () => {
    expect(fingers([note(60, 0), note(64, 0), note(67, 0)])).toEqual([1, 3, 5]);
    expect(fingers([note(48, 0, 'left'), note(55, 0, 'left')], 'left')).toEqual([5, 1]);
    const written = melody([60, 62, 64]);
    written[0] = note(60, 0, 'right', 2);
    expect(fingers(written)[0]).toBe(2);
  });

  it('fills every note of a song', () => {
    const s = withFingering(song([...melody([60, 62, 64]), ...melody([48, 52, 55], 'left')]));
    expect(
      s.notes.every((n) => n.fingering !== undefined && n.fingering >= 1 && n.fingering <= 5),
    ).toBe(true);
  });
});

describe('keyboard size', () => {
  it('knows presets and custom sizes, e.g. 86 keys from A0', () => {
    expect(keyCount(presetById('88') ?? { low: 0, high: 0 })).toBe(88);
    expect(presetById('61')).toMatchObject({ low: 36, high: 96 });
    expect(customKeyboard(21, 86)).toEqual({ low: 21, high: 106 });
  });

  it('fits a piece by octave shift, then folds stray notes', () => {
    const r25 = presetById('25') ?? { low: 48, high: 72 };
    const high = song([note(84, 0), note(86, 1), note(96, 2)]);
    expect(notesOutside(high, r25)).toBe(3);
    const shifted = fitToKeyboard(high, r25);
    expect(shifted.shift).toBe(-24);
    expect(notesOutside(shifted.song, r25)).toBe(0);
    const wide = song([note(60, 0), note(72, 1), note(96, 2)]);
    const folded = fitToKeyboard(wide, r25);
    expect(folded.shift).toBe(0);
    expect(folded.folded).toBe(1);
    expect(folded.song.notes.map((n) => n.pitch)).toEqual([60, 72, 72]);
    const s = high;
    expect(fitToKeyboard(s, { low: 21, high: 108 }).song).toBe(s);
  });
});

describe('performance', () => {
  const ev = (pitch: number, time: number, velocity = 90) => ({
    pitch,
    time,
    velocity,
    confidence: 1,
    source: 'midi' as const,
  });

  it('records key down and up and judges hold lengths', () => {
    const r = new PerformanceRecorder();
    r.noteOn(ev(60, 1.0));
    r.noteOff(60, 1.5);
    r.noteOn(ev(62, 2.0));
    r.noteOff(62, 2.1);
    r.noteOn(ev(64, 3.0));
    const played = r.finish(5.5);
    const expected = [
      { id: 'a', pitch: 60, time: 1.0, duration: 0.5, measureIndex: 0 },
      { id: 'b', pitch: 62, time: 2.0, duration: 0.5, measureIndex: 0 },
      { id: 'c', pitch: 64, time: 3.0, duration: 0.5, measureIndex: 0 },
    ];
    expect(judgeHolds(expected, played).map((h) => h.judgement)).toEqual(['good', 'short', 'long']);
  });

  it('renders as played and polished', () => {
    const played = [
      { pitch: 60, start: 1.03, end: 1.4, velocity: 100 },
      { pitch: 61, start: 1.5, end: 1.7, velocity: 80 },
    ];
    expect(asPlayed(played)[1]).toMatchObject({ pitch: 61, velocity: 80 });
    const expected = [
      { id: 'a', pitch: 60, time: 1.0, duration: 0.5, measureIndex: 0 },
      { id: 'b', pitch: 62, time: 1.5, duration: 0.5, measureIndex: 0 },
    ];
    expect(polished(expected, played)).toEqual([
      { pitch: 60, time: 0, duration: 0.5, velocity: 100 },
      { pitch: 62, time: 0.5, duration: 0.5, velocity: 75 },
    ]);
  });

  it('judges single holds with room for very short notes', () => {
    expect(judgeHold(1, 0.95)).toBe('good');
    expect(judgeHold(1, 0.4)).toBe('short');
    expect(judgeHold(1, 1.6)).toBe('long');
    // A staccato eighth at a fast tempo: a quick tap is still fine.
    expect(judgeHold(0.1, 0.03)).toBe('good');
    expect(judgeHold(0, 3)).toBe('good');
    expect(holdOverdueAfter(1)).toBeCloseTo(1.4);
    expect(holdOverdueAfter(0.1)).toBeCloseTo(0.2);
  });

  it('polishes a wait-mode run by playing order, not by time', () => {
    // The learner took their time: onsets are far from the written ones.
    const played = [
      { pitch: 60, start: 3.0, end: 3.5, velocity: 100 },
      { pitch: 99, start: 4.0, end: 4.2, velocity: 50 },
      { pitch: 62, start: 6.0, end: 6.4, velocity: 60 },
      { pitch: 60, start: 9.0, end: 9.4, velocity: 40 },
    ];
    const expected = [
      { id: 'a', pitch: 60, time: 0, duration: 0.5, measureIndex: 0 },
      { id: 'b', pitch: 62, time: 0.5, duration: 0.5, measureIndex: 0 },
      { id: 'c', pitch: 60, time: 1.0, duration: 0.5, measureIndex: 0 },
      { id: 'd', pitch: 64, time: 1.5, duration: 0.5, measureIndex: 0 },
    ];
    expect(polished(expected, played).map((n) => n.velocity)).toEqual([45, 45, 45, 45]);
    expect(polished(expected, played, { match: 'order' })).toEqual([
      { pitch: 60, time: 0, duration: 0.5, velocity: 100 },
      { pitch: 62, time: 0.5, duration: 0.5, velocity: 60 },
      { pitch: 60, time: 1.0, duration: 0.5, velocity: 40 },
      { pitch: 64, time: 1.5, duration: 0.5, velocity: 45 },
    ]);
  });
});

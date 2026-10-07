import { beatToSeconds } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import { APPROXIMATE_WARNING, NO_NOTES_WARNING, cleanNotes, toSong } from '../src/notes';
import type { AudioNote } from '../src/notes';

const note = (pitch: number, startSeconds: number, durationSeconds: number, amplitude = 0.8) => ({
  pitch,
  startSeconds,
  durationSeconds,
  amplitude,
});

describe('cleanNotes', () => {
  it('drops notes shorter than the minimum length', () => {
    const out = cleanNotes([note(60, 0, 0.5), note(62, 1, 0.03), note(64, 2, 0.06)]);
    expect(out.map((n) => n.pitch)).toEqual([60, 64]);
  });

  it('honours a custom minimum length', () => {
    const out = cleanNotes([note(60, 0, 0.1), note(62, 1, 0.3)], { minDurationSeconds: 0.2 });
    expect(out.map((n) => n.pitch)).toEqual([62]);
  });

  it('merges fragments of one held note split by a short gap', () => {
    const out = cleanNotes([note(60, 0, 0.4, 0.5), note(60, 0.41, 0.3, 0.9)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.startSeconds).toBe(0);
    expect(out[0]?.durationSeconds).toBeCloseTo(0.71);
    expect(out[0]?.amplitude).toBe(0.9);
  });

  it('merges overlapping notes of the same pitch', () => {
    const out = cleanNotes([note(60, 0, 1), note(60, 0.2, 0.3)]);
    expect(out).toEqual([note(60, 0, 1)]);
  });

  it('keeps a re-struck note with a clear gap', () => {
    const out = cleanNotes([note(60, 0, 0.4), note(60, 0.5, 0.4)]);
    expect(out).toHaveLength(2);
  });

  it('does not merge different pitches', () => {
    const out = cleanNotes([note(60, 0, 0.4), note(61, 0.4, 0.4)]);
    expect(out).toHaveLength(2);
  });

  it('merges fragments that are each too short on their own', () => {
    const out = cleanNotes([note(67, 0, 0.04), note(67, 0.05, 0.04)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.durationSeconds).toBeCloseTo(0.09);
  });

  it('drops notes outside the piano range and rounds pitches', () => {
    const out = cleanNotes([note(20, 0, 1), note(109, 0, 1), note(21, 0, 1), note(107.6, 0, 1)]);
    expect(out.map((n) => n.pitch)).toEqual([21, 108]);
  });

  it('honours a custom pitch range', () => {
    const out = cleanNotes([note(40, 0, 1), note(60, 0, 1), note(90, 0, 1)], {
      lowPitch: 48,
      highPitch: 84,
    });
    expect(out.map((n) => n.pitch)).toEqual([60]);
  });

  it('drops invalid values and clips negative start times', () => {
    const out = cleanNotes([
      note(Number.NaN, 0, 1),
      note(60, Number.POSITIVE_INFINITY, 1),
      note(62, 0, 0),
      note(64, 0, -1),
      note(65, -0.1, 0.5),
      note(67, -1, 0.5),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.pitch).toBe(65);
    expect(out[0]?.startSeconds).toBe(0);
    expect(out[0]?.durationSeconds).toBeCloseTo(0.4);
  });

  it('drops quiet notes when asked and clamps amplitude', () => {
    const out = cleanNotes([note(60, 0, 1, 0.1), note(62, 0, 1, 1.4)], { minAmplitude: 0.2 });
    expect(out).toEqual([note(62, 0, 1, 1)]);
  });

  it('sorts by start then pitch and is idempotent', () => {
    const input: AudioNote[] = [
      note(64, 1, 0.5),
      note(60, 1, 0.5),
      note(72, 0, 0.2),
      note(72, 0.21, 0.02),
      note(55, 0.5, 0.05),
    ];
    const once = cleanNotes(input);
    expect(once.map((n) => [n.startSeconds, n.pitch])).toEqual([
      [0, 72],
      [1, 60],
      [1, 64],
    ]);
    expect(cleanNotes(once)).toEqual(once);
  });

  it('does not change its input', () => {
    const input = [note(60, 0, 0.4), note(60, 0.41, 0.3)];
    const copy = structuredClone(input);
    cleanNotes(input);
    expect(input).toEqual(copy);
  });
});

describe('toSong', () => {
  const notes = [
    note(48, 0, 1),
    note(72, 0, 0.5),
    note(74, 0.5, 0.5),
    note(76, 1, 0.5),
    note(43, 2, 2.5),
  ];

  it('maps seconds onto a 120 bpm grid', () => {
    const song = toSong(notes, 'My recording');
    expect(song.format).toBe('audio');
    expect(song.title).toBe('My recording');
    expect(song.tempos).toEqual([{ beat: 0, bpm: 120 }]);
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual([
      [48, 0, 2],
      [72, 0, 1],
      [74, 1, 1],
      [76, 2, 1],
      [43, 4, 5],
    ]);
    // Playback time equals the recording's time.
    expect(beatToSeconds(song.tempos, song.notes[4]?.startBeat ?? 0)).toBeCloseTo(2);
  });

  it('splits hands and fills in staff, ids and measures', () => {
    const song = toSong(notes, 'x');
    expect(song.notes.map((n) => n.hand)).toEqual(['left', 'right', 'right', 'right', 'left']);
    expect(song.notes.map((n) => n.staff)).toEqual([2, 1, 1, 1, 2]);
    expect(song.notes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(song.notes.every((n) => n.part === 0 && n.voice === 1)).toBe(true);
    expect(song.timeSignatures).toEqual([{ beat: 0, numerator: 4, denominator: 4 }]);
    // Last note ends at beat 9, so three 4/4 bars.
    expect(song.measures).toHaveLength(3);
    expect(song.lengthBeats).toBe(12);
    expect(song.notes.map((n) => n.measureIndex)).toEqual([0, 0, 0, 0, 1]);
  });

  it('turns amplitude into velocity', () => {
    const song = toSong([note(60, 0, 1, 1), note(62, 1, 1, 0), note(64, 2, 1, 0.5)], 'x');
    expect(song.notes.map((n) => n.velocity)).toEqual([127, 1, 64]);
  });

  it('honours the split point', () => {
    const song = toSong([note(50, 0, 1), note(70, 1, 1)], 'x', { splitPoint: 40 });
    expect(song.notes.map((n) => n.hand)).toEqual(['right', 'right']);
  });

  it('cleans the notes first', () => {
    const song = toSong([note(60, 0, 0.4), note(60, 0.41, 0.3), note(62, 1, 0.01)], 'x');
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]?.durationBeats).toBeCloseTo(1.42);
  });

  it('always warns that the notes are approximate', () => {
    expect(toSong(notes, 'x').warnings).toEqual([APPROXIMATE_WARNING]);
  });

  it('handles an empty transcription', () => {
    const song = toSong([], '  ');
    expect(song.title).toBe('Untitled recording');
    expect(song.notes).toEqual([]);
    expect(song.measures).toHaveLength(1);
    expect(song.warnings).toEqual([APPROXIMATE_WARNING, NO_NOTES_WARNING]);
  });
});

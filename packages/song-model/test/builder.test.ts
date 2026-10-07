// The shared Song builder used by the MusicXML, ABC and MuseScore importers.
import { describe, expect, it } from 'vitest';
import { assembleSong, parseEndingNumbers, playbackOrder, rawMeasure } from '../src/builder';
import type { RawMeasure, RawNote, RepeatMarks } from '../src/builder';

const bar = (o: Partial<RepeatMarks> = {}): RepeatMarks => ({
  forwardRepeat: false,
  backwardRepeat: false,
  repeatTimes: 2,
  endingStop: false,
  ...o,
});

describe('playbackOrder', () => {
  it('jumps after a completed repeat to the bar after it by default', () => {
    // |: 0 | 1 :| 2 | 3 :| — MusicXML and ABC repeat 2–3 on their own.
    const marks = [
      bar({ forwardRepeat: true }),
      bar({ backwardRepeat: true }),
      bar(),
      bar({ backwardRepeat: true }),
    ];
    expect(playbackOrder(marks)).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });

  it('can jump back to the last forward repeat instead, without replaying inner repeats', () => {
    // MuseScore: 0 |: 1 | 2 :| 3 :| plays 0 1 2 1 2 3 1 2 3.
    const marks = [
      bar(),
      bar({ forwardRepeat: true }),
      bar({ backwardRepeat: true }),
      bar({ backwardRepeat: true }),
    ];
    expect(playbackOrder(marks, { repeatFrom: 'lastForwardRepeat' })).toEqual([
      0, 1, 2, 1, 2, 3, 1, 2, 3,
    ]);
  });

  it('plays an ending shared by two passes twice', () => {
    // |: 0 [1,2 1 :| [3 2 |
    const marks = [
      bar({ forwardRepeat: true }),
      bar({ endingStart: [1, 2], endingStop: true, backwardRepeat: true }),
      bar({ endingStart: [3], endingStop: true }),
    ];
    expect(playbackOrder(marks)).toEqual([0, 1, 0, 1, 0, 2]);
  });

  it('plays three endings with plain repeat marks', () => {
    const marks = [
      bar({ forwardRepeat: true }),
      bar({ endingStart: [1], endingStop: true, backwardRepeat: true }),
      bar({ endingStart: [2], endingStop: true, backwardRepeat: true }),
      bar({ endingStart: [3], endingStop: true }),
      bar(),
    ];
    expect(playbackOrder(marks)).toEqual([0, 1, 0, 2, 0, 3, 4]);
  });

  it('does not end the section at an ending followed directly by another', () => {
    // |: 0 [1 1 :| [2 2 | [3 3 | 4 :| 5 — the second pass goes 0 2 4, the third 0 3 4.
    const marks = [
      bar({ forwardRepeat: true }),
      bar({ endingStart: [1], endingStop: true, backwardRepeat: true }),
      bar({ endingStart: [2], endingStop: true }),
      bar({ endingStart: [3], endingStop: true }),
      bar({ backwardRepeat: true }),
      bar(),
    ];
    expect(playbackOrder(marks, { repeatFrom: 'lastForwardRepeat' })).toEqual([
      0, 1, 0, 2, 4, 0, 3, 4, 5,
    ]);
  });

  it('never repeats back across a section start', () => {
    const marks = [bar(), bar({ sectionStart: true }), bar({ backwardRepeat: true })];
    expect(playbackOrder(marks, { repeatFrom: 'lastForwardRepeat' })).toEqual([0, 1, 2, 1, 2]);
  });

  it('stops on malformed input instead of looping', () => {
    const marks = [bar({ forwardRepeat: true, backwardRepeat: true, repeatTimes: 1e9 })];
    expect(playbackOrder(marks).length).toBeLessThanOrEqual(32);
  });
});

describe('parseEndingNumbers', () => {
  it('reads lists and ranges', () => {
    expect(parseEndingNumbers('1')).toEqual([1]);
    expect(parseEndingNumbers('1, 2')).toEqual([1, 2]);
    expect(parseEndingNumbers('1-3')).toEqual([1, 2, 3]);
    expect(parseEndingNumbers('')).toEqual([]);
  });
});

describe('assembleSong', () => {
  const note = (o: Partial<RawNote>): RawNote => ({
    part: 0,
    pitch: 60,
    posBeats: 0,
    durBeats: 1,
    staff: 1,
    voice: 1,
    tieStart: false,
    tieStop: false,
    ref: 'r',
    ...o,
  });

  it('keeps a tie when another voice plays the same pitch at the continuation', () => {
    const m0: RawMeasure = { ...rawMeasure('1'), lengthBeats: 2 };
    m0.notes.push(note({ posBeats: 0, tieStart: true, voice: 1, ref: 'a' }));
    m0.notes.push(note({ posBeats: 1, voice: 2, ref: 'b' }));
    m0.notes.push(note({ posBeats: 1, tieStop: true, voice: 1, ref: 'c' }));
    const song = assembleSong({
      title: 't',
      format: 'abc',
      measures: [m0],
      parts: [{ name: 'p', staves: 1, clefs: new Map() }],
      warnings: new Set(),
    });
    expect(song.notes.map((n) => [n.startBeat, n.durationBeats, n.sourceRefs])).toEqual([
      [0, 2, ['a', 'c']],
      [1, 1, ['b']],
    ]);
  });

  it('uses a hand the importer set and the layout otherwise', () => {
    const m0: RawMeasure = { ...rawMeasure('1'), lengthBeats: 1 };
    m0.notes.push(note({ pitch: 72, staff: 1, hand: 'left' }), note({ pitch: 48, staff: 2 }));
    const song = assembleSong({
      title: 't',
      format: 'musicxml',
      measures: [m0],
      parts: [{ name: 'p', staves: 2, clefs: new Map() }],
      warnings: new Set(),
    });
    expect(song.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [48, 'left'],
      [72, 'left'],
    ]);
  });
});

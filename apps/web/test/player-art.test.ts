// Generated covers for the Player (P6-06): a colour by composer, initials, and the opening's notes.
import { describe, expect, it } from 'vitest';
import type { Song, SongNote } from '@opentiles/song-model';
import { COVER_COUNT, coverIndex, coverNotes, initials } from '../src/player/art';

const note = (pitch: number, startBeat: number, hand: 'left' | 'right'): SongNote => ({
  id: `${pitch}@${startBeat}`,
  pitch,
  startBeat,
  durationBeats: 1,
  hand,
  staff: hand === 'right' ? 1 : 2,
  voice: 1,
  part: 0,
  measureIndex: 0,
  sourceRefs: [],
});

const song = (notes: SongNote[]): Song => ({
  title: 'x',
  format: 'musicxml',
  notes,
  measures: [],
  tempos: [{ beat: 0, bpm: 120 }],
  timeSignatures: [],
  keySignatures: [],
  parts: [],
  lengthBeats: 32,
  warnings: [],
});

describe('generated covers (P6-06)', () => {
  it('gives a composer the same colour every time, one of the eight', () => {
    const a = coverIndex('Ludwig van Beethoven');
    expect(a).toBe(coverIndex('Ludwig van Beethoven'));
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(COVER_COUNT);
    // The catalogue's notes in brackets do not change it.
    expect(coverIndex('Traditional (Scottish)')).toBe(coverIndex('Traditional (Italian)'));
    const seen = new Set(
      ['Bach', 'Chopin', 'Satie', 'Mozart', 'Schumann', 'Grieg', 'Joplin', 'Pachelbel'].map(
        coverIndex,
      ),
    );
    expect(seen.size).toBeGreaterThan(3);
  });

  it('writes initials from the first and last name, leaving out particles', () => {
    expect(initials('Ludwig van Beethoven')).toBe('LB');
    expect(initials('Frédéric Chopin')).toBe('FC');
    expect(initials('Traditional (German children’s song, 19th century)')).toBe('Tr');
    expect(initials('')).toBe('♪');
  });

  it('draws the opening as a piano roll inside the cover', () => {
    const notes = coverNotes(
      song([
        note(60, 0, 'left'),
        note(64, 1, 'right'),
        note(67, 2, 'right'),
        note(72, 40, 'right'),
      ]),
    );
    expect(notes).toHaveLength(3);
    for (const n of notes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height).toBeLessThanOrEqual(1);
    }
    // Higher notes sit higher on the cover.
    expect(notes[2]!.y).toBeLessThan(notes[0]!.y);
    expect(notes.map((n) => n.right)).toEqual([false, true, true]);
    expect(coverNotes(song([]))).toEqual([]);
  });
});

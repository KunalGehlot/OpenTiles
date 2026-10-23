import { describe, expect, it } from 'vitest';
import {
  keySignatureOf,
  pitchClassOf,
  SCALE_KINDS,
  scaleFingers,
  scaleLength,
  scaleNotes,
  scaleOn,
  tonicMidi,
} from '../src';
import type { Scale, ScaleKind } from '../src';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACC: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const nameOf = (p: { letter: number; alter: number }) => `${LETTERS[p.letter]}${ACC[p.alter]}`;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** The scale's notes going up one octave from its tonic near middle C, by name. */
const upNames = (s: Scale) =>
  scaleNotes(s, tonicMidi(s, 4), 1)
    .filter((n) => n.direction === 'up')
    .map(nameOf)
    .join(' ');

describe('scale spelling (P7-15)', () => {
  it('spells each major key as its key signature does', () => {
    const tonics = ALL.map((pc) => nameOf(scaleOn(pc, 'major').tonic));
    expect(tonics).toEqual(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
    expect(ALL.map((pc) => keySignatureOf(scaleOn(pc, 'major')))).toEqual([
      0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5,
    ]);
    expect(upNames(scaleOn(3, 'major'))).toBe('E♭ F G A♭ B♭ C D E♭');
    expect(upNames(scaleOn(6, 'major'))).toBe('F♯ G♯ A♯ B C♯ D♯ E♯ F♯');
  });

  it('spells the minors in their relative major key, E♭ minor rather than D♯', () => {
    const tonics = ALL.map((pc) => nameOf(scaleOn(pc, 'harmonic-minor').tonic));
    expect(tonics).toEqual(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']);
    expect(keySignatureOf(scaleOn(3, 'natural-minor'))).toBe(-6);
    expect(keySignatureOf(scaleOn(1, 'natural-minor'))).toBe(4);
    expect(upNames(scaleOn(9, 'harmonic-minor'))).toBe('A B C D E F G♯ A');
    expect(upNames(scaleOn(8, 'harmonic-minor'))).toBe('G♯ A♯ B C♯ D♯ E F𝄪 G♯');
  });

  it('plays the melodic minor raised going up and natural coming down', () => {
    const notes = scaleNotes(scaleOn(9, 'melodic-minor'), 69, 1).map(nameOf).join(' ');
    expect(notes).toBe('A B C D E F♯ G♯ A G F E D C B A');
  });

  it('writes modes in their parent key and avoids odd tonics', () => {
    expect(keySignatureOf(scaleOn(2, 'dorian'))).toBe(0);
    expect(upNames(scaleOn(2, 'dorian'))).toBe('D E F G A B C D');
    expect(nameOf(scaleOn(5, 'locrian').tonic)).toBe('F');
    expect(keySignatureOf(scaleOn(5, 'locrian'))).toBe(-6);
    expect(nameOf(scaleOn(11, 'lydian').tonic)).toBe('B');
    expect(upNames(scaleOn(4, 'phrygian'))).toBe('E F G A B C D E');
  });

  it('spells pentatonics, blues and the chromatic scale', () => {
    expect(upNames(scaleOn(0, 'major-pentatonic'))).toBe('C D E G A C');
    expect(upNames(scaleOn(9, 'minor-pentatonic'))).toBe('A C D E G A');
    expect(upNames(scaleOn(9, 'blues'))).toBe('A C D E♭ E G A');
    // E♭ blues would need B𝄫: the blue note is written as the raised fourth.
    expect(upNames(scaleOn(3, 'blues'))).toBe('E♭ G♭ A♭ A B♭ D♭ E♭');
    const chromatic = scaleNotes(scaleOn(0, 'chromatic'), 60, 1).map(nameOf).join(' ');
    expect(chromatic).toBe('C C♯ D D♯ E F F♯ G G♯ A A♯ B C B B♭ A A♭ G G♭ F E E♭ D D♭ C');
  });

  it('keeps every kind on every tonic in seven letters, single accidentals but for G♯ minor', () => {
    for (const kind of SCALE_KINDS) {
      for (const pc of ALL) {
        const s = scaleOn(kind === 'chromatic' ? 0 : pc, kind);
        const notes = scaleNotes(s, tonicMidi(s, 4), 2);
        expect(pitchClassOf(s.tonic)).toBe(kind === 'chromatic' ? 0 : pc);
        for (const n of notes) {
          expect(((n.midi % 12) + 12) % 12).toBe(pitchClassOf(n));
          const doubleAllowed = pc === 8 && (kind === 'harmonic-minor' || kind === 'melodic-minor');
          if (!doubleAllowed) expect(Math.abs(n.alter), `${kind} on ${pc}`).toBeLessThan(2);
        }
        if (kind !== 'chromatic' && kind !== 'blues') {
          const letters = notes.filter((n) => n.direction === 'up').slice(0, scaleLength(kind));
          expect(new Set(letters.map((n) => n.letter)).size).toBe(letters.length);
        }
        expect(Math.abs(keySignatureOf(s))).toBeLessThanOrEqual(6);
      }
    }
  });

  it('runs up and back with the top note once, or down first for contrary motion', () => {
    const c = scaleOn(0, 'major');
    const two = scaleNotes(c, 60, 2);
    expect(two).toHaveLength(29);
    expect(two[14]?.midi).toBe(84);
    expect(two[28]?.midi).toBe(60);
    const down = scaleNotes(c, 60, 1, 'down').map((n) => n.midi);
    expect(down).toEqual([60, 59, 57, 55, 53, 52, 50, 48, 50, 52, 53, 55, 57, 59, 60]);
  });
});

/** Fingers for one octave going up, as a string of digits. */
function upFingers(pc: number, kind: ScaleKind, hand: 'right' | 'left', octaves = 1): string {
  const s = scaleOn(pc, kind);
  const notes = scaleNotes(s, tonicMidi(s, 4), octaves);
  const fingers = scaleFingers(s, notes, hand) ?? [];
  return fingers.slice(0, 7 * octaves + 1).join('');
}

// The standard fingerings scale books print, one octave going up from the tonic.
const MAJOR_RIGHT: Record<number, string> = {
  0: '12312345',
  7: '12312345',
  2: '12312345',
  9: '12312345',
  4: '12312345',
  11: '12312345',
  5: '12341234',
  10: '21231234',
  3: '31234123',
  8: '34123123',
  1: '23123412',
  6: '23412312',
};
const MAJOR_LEFT: Record<number, string> = {
  0: '54321321',
  7: '54321321',
  2: '54321321',
  9: '54321321',
  4: '54321321',
  11: '43214321',
  5: '54321321',
  10: '32143213',
  3: '32143213',
  8: '32143213',
  1: '32143213',
  6: '43213214',
};
const MINOR_RIGHT: Record<number, string> = {
  9: '12312345',
  4: '12312345',
  11: '12312345',
  6: '34123123',
  1: '34123123',
  8: '34123123',
  2: '12312345',
  7: '12312345',
  0: '12312345',
  5: '12341234',
  10: '21231234',
  3: '31234123',
};
const MINOR_LEFT: Record<number, string> = {
  9: '54321321',
  4: '54321321',
  11: '43214321',
  6: '43213214',
  1: '32143213',
  8: '32143213',
  2: '54321321',
  7: '54321321',
  0: '54321321',
  5: '54321321',
  10: '21321432',
  3: '21432132',
};

describe('scale fingering (P7-16)', () => {
  it('gives every major scale the standard fingering in both hands', () => {
    for (const pc of ALL) {
      expect(upFingers(pc, 'major', 'right'), `right ${pc}`).toBe(MAJOR_RIGHT[pc]);
      expect(upFingers(pc, 'major', 'left'), `left ${pc}`).toBe(MAJOR_LEFT[pc]);
    }
  });

  it('gives every harmonic minor the standard fingering in both hands', () => {
    for (const pc of ALL) {
      expect(upFingers(pc, 'harmonic-minor', 'right'), `right ${pc}`).toBe(MINOR_RIGHT[pc]);
      expect(upFingers(pc, 'harmonic-minor', 'left'), `left ${pc}`).toBe(MINOR_LEFT[pc]);
    }
  });

  it('carries on through two octaves with the thumb at the middle tonic', () => {
    expect(upFingers(0, 'major', 'right', 2)).toBe('123123412312345');
    expect(upFingers(0, 'major', 'left', 2)).toBe('543213214321321');
    expect(upFingers(5, 'major', 'right', 2)).toBe('123412312341234');
    expect(upFingers(10, 'major', 'right', 2)).toBe('212312341231234');
  });

  it('never puts a thumb on a black key and plays a note with one finger both ways', () => {
    const black = new Set([1, 3, 6, 8, 10]);
    for (const kind of SCALE_KINDS) {
      for (const pc of ALL) {
        for (const hand of ['right', 'left'] as const) {
          const s = scaleOn(pc, kind);
          const notes = scaleNotes(s, tonicMidi(s, 4), 2);
          const fingers = scaleFingers(s, notes, hand);
          if (!fingers) continue;
          const byPitch = new Map<number, Set<number>>();
          notes.forEach((n, i) => {
            const f = fingers[i] as number;
            if (kind !== 'chromatic' && f === 1)
              expect(black.has(n.midi % 12), `${kind} ${pc} ${hand}`).toBe(false);
            byPitch.set(n.midi, (byPitch.get(n.midi) ?? new Set()).add(f));
            const next = fingers[i + 1];
            if (next !== undefined) expect(next, `${kind} ${pc} ${hand} at ${i}`).not.toBe(f);
          });
          if (kind !== 'melodic-minor')
            for (const set of byPitch.values()) expect(set.size).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives the chromatic scale 3 on black keys and 2 where white keys meet', () => {
    const s = scaleOn(0, 'chromatic');
    const notes = scaleNotes(s, 60, 1).slice(0, 13);
    expect(scaleFingers(s, notes, 'right')?.join('')).toBe('1313123131312');
    expect(scaleFingers(s, notes, 'left')?.join('')).toBe('1313213131321');
  });

  it('leaves pentatonics and blues without fingers', () => {
    const s = scaleOn(9, 'blues');
    expect(scaleFingers(s, scaleNotes(s, 69, 1), 'right')).toBeNull();
  });
});

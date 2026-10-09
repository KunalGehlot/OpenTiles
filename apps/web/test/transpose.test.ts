// Shifting the piece by semitones during practice, and naming its black keys (P5-04). Songs are
// generated here (CC0).
import { describe, expect, it } from 'vitest';
import type { Song, SongNote } from '@opentiles/song-model';
import { spellingFor } from '../src/lib/notes';
import { prepareSong } from '../src/practice/prepare';
import {
  clampShift,
  shiftLabel,
  shiftLimits,
  shiftMessage,
  shiftNotation,
  shiftSong,
} from '../src/practice/transpose';
import { DEFAULT_APP_SETTINGS, normaliseSettings } from '../src/settings/model';
import type { NotationSource } from '../src/views/score/notation';

function song(pitches: number[], fifths = 0): Song {
  const notes: SongNote[] = pitches.map((pitch, i) => ({
    id: `n${i}`,
    pitch,
    startBeat: i,
    durationBeats: 1,
    hand: pitch < 60 ? 'left' : 'right',
    staff: pitch < 60 ? 2 : 1,
    voice: 1,
    part: 0,
    measureIndex: Math.floor(i / 4),
    sourceRefs: [],
  }));
  return {
    title: 'Test',
    format: 'musicxml',
    notes,
    measures: [{ index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: 4 }],
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [{ beat: 0, fifths, mode: 'major' }],
    parts: [{ name: 'Piano' }],
    lengthBeats: pitches.length,
    warnings: [],
  };
}

describe('how far a piece can move', () => {
  it('goes an octave either way in the middle of the piano', () => {
    expect(shiftLimits(song([60, 62, 64, 65]))).toEqual({ down: -12, up: 12 });
  });

  it('keeps every note on an 88-key piano', () => {
    expect(shiftLimits(song([24, 60, 100]))).toEqual({ down: -3, up: 8 });
    expect(shiftLimits(song([21, 108]))).toEqual({ down: 0, up: 0 });
    expect(shiftLimits(song([]))).toEqual({ down: 0, up: 0 });
    expect(clampShift(song([24, 100]), -7)).toBe(-3);
    expect(clampShift(song([24, 100]), 20)).toBe(8);
    expect(clampShift(song([60]), 2.4)).toBe(2);
  });
});

describe('a shifted piece', () => {
  it('moves every note and the key signature, and drops none', () => {
    const moved = shiftSong(song([60, 62, 64, 65]), 2);
    expect(moved.notes.map((n) => n.pitch)).toEqual([62, 64, 66, 67]);
    expect(moved.notes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(moved.keySignatures[0]?.fifths).toBe(2); // C major → D major
    expect(shiftSong(song([60, 62], 0), -2).keySignatures[0]?.fifths).toBe(-2); // → B♭ major
    expect(shiftSong(song([105, 108]), 5).notes.map((n) => n.pitch)).toEqual([105, 108]);
  });

  it('is the same piece when not shifted', () => {
    const s = song([60, 64]);
    expect(shiftSong(s, 0)).toBe(s);
  });

  it('gets fingers for its new key and keeps the score linked to the same notes', () => {
    const written = song([60, 62, 64, 65, 67]);
    const prepared = prepareSong(shiftSong(written, 1), null, 'suggested');
    expect(prepared.played.notes.map((n) => n.pitch)).toEqual([61, 63, 65, 66, 68]);
    expect(prepared.played.notes.every((n) => n.fingering !== undefined)).toBe(true);
    // The score is drawn shifted too, so its notes carry the shifted pitches and the same ids.
    expect(prepared.score.notes.map((n) => `${n.id}:${n.pitch}`)).toEqual([
      'n0:61',
      'n1:63',
      'n2:65',
      'n3:66',
      'n4:68',
    ]);
  });

  it('draws the score with the import transposition plus the shift', () => {
    const xml: NotationSource = { kind: 'musicxml', text: '<score-partwise/>', transpose: 2 };
    expect(shiftNotation(xml, 3)).toEqual({ ...xml, transpose: 5 });
    expect(shiftNotation(xml, 0)).toBe(xml);
    const none: NotationSource = { kind: 'none', reason: 'MIDI' };
    expect(shiftNotation(none, 3)).toBe(none);
  });

  it('says how far it moved', () => {
    expect(shiftLabel(0)).toBe('0');
    expect(shiftLabel(3)).toBe('+3');
    expect(shiftLabel(-2)).toBe('−2');
    expect(shiftMessage(0)).toBeNull();
    expect(shiftMessage(1)).toBe('Transposed up a semitone.');
    expect(shiftMessage(-1)).toBe('Transposed down a semitone.');
    expect(shiftMessage(5)).toBe('Transposed up 5 semitones.');
    expect(shiftMessage(-12)).toBe('Transposed down 12 semitones.');
  });
});

describe('black keys', () => {
  it('follow the key signature unless sharps or flats are chosen', () => {
    expect(spellingFor('key', 0)).toBe('sharps');
    expect(spellingFor('key', 2)).toBe('sharps');
    expect(spellingFor('key', -3)).toBe('flats');
    expect(spellingFor('sharps', -3)).toBe('sharps');
    expect(spellingFor('flats', 4)).toBe('flats');
  });

  it('default to the key and keep only known choices', () => {
    expect(DEFAULT_APP_SETTINGS.noteSpelling).toBe('key');
    expect(normaliseSettings({ noteSpelling: 'flats' }).noteSpelling).toBe('flats');
    expect(normaliseSettings({ noteSpelling: 'both' }).noteSpelling).toBe('key');
  });
});

// Keyboard size and fingering settings (P4-07, P4-08) and the piece as the learner practises it.
// Songs are generated here (CC0).
import { describe, expect, it } from 'vitest';
import type { Song, SongNote } from '@opentiles/song-model';
import { prepareSong } from '../src/practice/prepare';
import {
  fitMessage,
  keyboardLabel,
  keyboardRange,
  lowestKeyChoices,
  normaliseSettings,
} from '../src/settings/model';
import { fileSafe } from '../src/audio/performance-audio';

function song(pitches: number[], fingers: (number | undefined)[] = []): Song {
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
    ...(fingers[i] !== undefined ? { fingering: fingers[i] } : {}),
  }));
  return {
    title: 'Test',
    format: 'musicxml',
    notes,
    measures: [{ index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: 4 }],
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: pitches.length,
    warnings: [],
  };
}

describe('keyboard setting', () => {
  it('follows each piece unless a size is chosen', () => {
    const s = normaliseSettings(undefined);
    expect(s.keyboard.size).toBe('auto');
    expect(keyboardRange(s.keyboard)).toBeNull();
    expect(s.fingering).toBe('suggested');
  });

  it('reads presets and a custom 86-key board from A0', () => {
    expect(keyboardRange({ size: '61', low: 21, keys: 88 })).toEqual({ low: 36, high: 96 });
    const custom = keyboardRange({ size: 'custom', low: 21, keys: 86 });
    expect(custom).toEqual({ low: 21, high: 106 });
    expect(keyboardLabel(custom ?? { low: 0, high: 0 })).toBe('86 keys (A0–B♭7)');
  });

  it('drops unknown sizes and clamps custom boards to a real piano', () => {
    expect(normaliseSettings({ keyboard: { size: '99' } }).keyboard.size).toBe('auto');
    expect(normaliseSettings({ keyboard: { size: 'custom', low: 0, keys: 500 } }).keyboard).toEqual(
      { size: 'custom', low: 21, keys: 88 },
    );
    expect(normaliseSettings({ keyboard: { size: 'custom', low: 100, keys: 3 } }).keyboard).toEqual(
      { size: 'custom', low: 97, keys: 12 },
    );
    expect(normaliseSettings({ fingering: 'loud' }).fingering).toBe('suggested');
    expect(normaliseSettings({ fingering: 'off' }).fingering).toBe('off');
  });

  it('offers white keys from A0 to C5 as the lowest key', () => {
    const keys = lowestKeyChoices();
    expect(keys[0]).toEqual({ pitch: 21, label: 'A0' });
    expect(keys.at(-1)).toEqual({ pitch: 72, label: 'C5' });
    expect(keys.some((k) => k.label.includes('♯') || k.label.includes('♭'))).toBe(false);
  });

  it('says what fitting the piece moved', () => {
    const r = { low: 48, high: 72 };
    expect(fitMessage({ shift: 0, folded: 0 }, r)).toBeNull();
    expect(fitMessage({ shift: 12, folded: 0 }, r)).toBe(
      'Moved up an octave to fit your 25-key keyboard.',
    );
    expect(fitMessage({ shift: -24, folded: 1 }, r)).toBe(
      'Moved down 2 octaves to fit your 25-key keyboard; 1 note was also moved into range.',
    );
    expect(fitMessage({ shift: 0, folded: 3 }, r)).toBe(
      '3 notes moved by octaves to fit your 25-key keyboard.',
    );
  });
});

describe('prepareSong', () => {
  it('fits the played song to the keyboard but keeps the written pitches for the score', () => {
    const high = prepareSong(song([84, 86, 88, 89]), { low: 48, high: 72 }, 'written');
    expect(high.played.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);
    expect(high.fit).toEqual({ shift: -24, folded: 0 });
    // Wider than the keyboard: the note that does not fit is folded in.
    const p = prepareSong(song([48, 74, 60, 62]), { low: 48, high: 72 }, 'written');
    expect(p.played.notes.map((n) => n.pitch)).toEqual([48, 62, 60, 62]);
    expect(p.fit).toEqual({ shift: 0, folded: 1 });
    expect(p.score.notes.map((n) => n.pitch)).toEqual([48, 74, 60, 62]);
    expect(p.played.notes.map((n) => n.id)).toEqual(p.score.notes.map((n) => n.id));
  });

  it('suggests fingers where none are written and marks which ones', () => {
    const s = song([60, 62, 64, 65], [undefined, 3, undefined, undefined]);
    const p = prepareSong(s, null, 'suggested');
    expect(p.fit).toBeNull();
    expect(p.played.notes.every((n) => n.fingering !== undefined)).toBe(true);
    expect(p.played.notes[1]?.fingering).toBe(3);
    expect(p.score.notes.map((n) => n.fingering)).toEqual(p.played.notes.map((n) => n.fingering));
    expect([...p.suggested].sort()).toEqual(['n0', 'n2', 'n3']);
  });

  it('keeps only written fingers, or none', () => {
    const s = song([60, 62], [1, undefined]);
    expect(prepareSong(s, null, 'written').played.notes.map((n) => n.fingering)).toEqual([
      1,
      undefined,
    ]);
    const off = prepareSong(s, null, 'off');
    expect(off.played.notes.some((n) => 'fingering' in n)).toBe(false);
    expect(off.score.notes.some((n) => 'fingering' in n)).toBe(false);
    expect(off.suggested.size).toBe(0);
  });
});

describe('fileSafe', () => {
  it('makes titles safe for file names', () => {
    expect(fileSafe('Prélude: No. 1 / in C')).toBe('Prélude No. 1 in C');
    expect(fileSafe('a\u0007b')).toBe('a b');
    expect(fileSafe('  ')).toBe('OpenTiles performance');
  });
});

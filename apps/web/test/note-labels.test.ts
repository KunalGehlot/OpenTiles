// How note names are written (P5-03): letters, German names and Fixed-Do, with the spelling of the
// black keys, and the setting that chooses the style.
import { afterEach, describe, expect, it } from 'vitest';
import {
  labelStyleFor,
  noteLabel,
  noteLabelStyle,
  pitchClassName,
  setNoteLabelStyle,
} from '../src/lib/notes';
import { DEFAULT_APP_SETTINGS, keyboardLabel, normaliseSettings } from '../src/settings/model';

const octave = (
  from: number,
  style: Parameters<typeof pitchClassName>[2],
  spelling: 'sharps' | 'flats' | 'common',
) => Array.from({ length: 12 }, (_, i) => pitchClassName(from + i, spelling, style));

afterEach(() => setNoteLabelStyle('letters'));

describe('note names', () => {
  it('writes letters with sharps, flats or the usual mix', () => {
    expect(octave(60, 'letters', 'sharps').join(' ')).toBe('C C♯ D D♯ E F F♯ G G♯ A A♯ B');
    expect(octave(60, 'letters', 'flats').join(' ')).toBe('C D♭ D E♭ E F G♭ G A♭ A B♭ B');
    expect(octave(60, 'letters', 'common').join(' ')).toBe('C C♯ D E♭ E F F♯ G A♭ A B♭ B');
  });

  it('writes German names: H for B, B for B♭, -is and -es', () => {
    expect(octave(60, 'german', 'sharps').join(' ')).toBe('C Cis D Dis E F Fis G Gis A Ais H');
    expect(octave(60, 'german', 'flats').join(' ')).toBe('C Des D Es E F Ges G As A B H');
  });

  it('writes Fixed-Do syllables', () => {
    expect(octave(60, 'fixed-do', 'sharps').join(' ')).toBe(
      'Do Do♯ Re Re♯ Mi Fa Fa♯ Sol Sol♯ La La♯ Si',
    );
    expect(octave(60, 'fixed-do', 'flats').join(' ')).toBe(
      'Do Re♭ Re Mi♭ Mi Fa Sol♭ Sol La♭ La Si♭ Si',
    );
  });

  it('numbers octaves from middle C = 4 in every style', () => {
    expect(noteLabel(60, 'common', 'letters')).toBe('C4');
    expect(noteLabel(59, 'common', 'german')).toBe('H3');
    expect(noteLabel(58, 'common', 'german')).toBe('B3');
    expect(noteLabel(60, 'common', 'fixed-do')).toBe('Do4');
    expect(noteLabel(21, 'common', 'letters')).toBe('A0');
    expect(noteLabel(108, 'common', 'fixed-do')).toBe('Do8');
  });

  it('uses the style the settings store chose when none is given', () => {
    setNoteLabelStyle('german');
    expect(noteLabelStyle()).toBe('german');
    expect(pitchClassName(71)).toBe('H');
    expect(noteLabel(70)).toBe('B4');
    expect(keyboardLabel({ low: 21, high: 106 })).toBe('86 keys (A0–B7)');
    setNoteLabelStyle('fixed-do');
    expect(keyboardLabel({ low: 21, high: 106 })).toBe('86 keys (La0–Si♭7)');
  });
});

describe('the note-name setting', () => {
  it('follows the app language when set to auto', () => {
    expect(labelStyleFor('auto', 'en')).toBe('letters');
    expect(labelStyleFor('auto', 'de')).toBe('german');
    expect(labelStyleFor('fixed-do', 'de')).toBe('fixed-do');
    expect(labelStyleFor('letters', 'de')).toBe('letters');
  });

  it('defaults to auto and keeps only known styles', () => {
    expect(DEFAULT_APP_SETTINGS.noteLabels).toBe('auto');
    expect(normaliseSettings({ noteLabels: 'german' }).noteLabels).toBe('german');
    expect(normaliseSettings({ noteLabels: 'fixed-do' }).noteLabels).toBe('fixed-do');
    expect(normaliseSettings({ noteLabels: 'solfege' }).noteLabels).toBe('auto');
    expect(normaliseSettings({ noteLabels: 3 }).noteLabels).toBe('auto');
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PRACTICE_PREFS, normalisePracticePrefs } from '../src/practice/prefs';
import { DEFAULT_APP_SETTINGS, normaliseSettings } from '../src/settings/model';

describe('practice preferences', () => {
  it('fall back to the defaults for anything missing or damaged', () => {
    expect(normalisePracticePrefs(null)).toEqual(DEFAULT_PRACTICE_PREFS);
    expect(normalisePracticePrefs('nonsense')).toEqual(DEFAULT_PRACTICE_PREFS);
    expect(
      normalisePracticePrefs({ mode: 'fast', hands: 3, tempo: 'x', accompany: 1, metronome: null }),
    ).toEqual(DEFAULT_PRACTICE_PREFS);
    // The live stats strip is off and the overview on until the learner says otherwise (P5-07).
    expect(DEFAULT_PRACTICE_PREFS).toMatchObject({ liveStats: false, overview: true });
    expect(normalisePracticePrefs({ liveStats: 'yes', overview: 0 })).toMatchObject({
      liveStats: false,
      overview: true,
    });
  });

  it('keep valid choices and clamp the numbers', () => {
    const p = normalisePracticePrefs({
      mode: 'play-along',
      hands: 'left',
      tempo: 0.62,
      accompany: false,
      metronome: true,
      clickVolume: 7,
      liveStats: true,
      overview: false,
    });
    expect(p).toEqual({
      mode: 'play-along',
      hands: 'left',
      tempo: 0.6,
      accompany: false,
      metronome: true,
      clickVolume: 1,
      liveStats: true,
      overview: false,
    });
    expect(normalisePracticePrefs({ tempo: 99 }).tempo).toBe(1.5);
    expect(normalisePracticePrefs({ tempo: -1 }).tempo).toBe(0.25);
    expect(normalisePracticePrefs({ tempo: Number.NaN }).tempo).toBe(1);
  });
});

describe('app settings', () => {
  it('keep the note-name choice and default it to on', () => {
    expect(DEFAULT_APP_SETTINGS.noteNames).toBe(true);
    expect(normaliseSettings({ noteNames: false }).noteNames).toBe(false);
    expect(normaliseSettings({ noteNames: 'no' }).noteNames).toBe(true);
    expect(normaliseSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
  });
});

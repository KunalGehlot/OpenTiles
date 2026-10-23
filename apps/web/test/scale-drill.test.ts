// Scale drills in the app (P7-19 to P7-21): scale names in every label style and both languages,
// remembered choices, levels, links, loading, the hint by level, the tempo ladder and weak scales.
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addScaleRound,
  isScaleDrillId,
  NO_SCALE_STATS,
  parseScaleDrillId,
  scaleOn,
} from '@opentiles/practice';
import { isDeviceSetting } from '../src/backup/backup';
import { setLanguage } from '../src/i18n';
import { setNoteLabelStyle } from '../src/lib/notes';
import { href, parseHash } from '../src/lib/router';
import {
  afterScaleRound,
  DEFAULT_SCALE_DRILL_PREFS,
  loadScaleDrill,
  normaliseScaleDrillPrefs,
  prefsForLevel,
  scaleDrillRoute,
  scaleHintFor,
  scaleKindLabel,
  scaleName,
  stepTonics,
  weakScaleFocus,
} from '../src/practice/scale-drill';
import type { ScaleDrillPrefs } from '../src/practice/scale-drill';

afterEach(() => {
  setNoteLabelStyle('letters');
  setLanguage('en');
});
const domParser = new DOMParser() as unknown as Parameters<typeof loadScaleDrill>[2];
const prefs = (p: Partial<ScaleDrillPrefs>) => ({ ...DEFAULT_SCALE_DRILL_PREFS, ...p });

describe('scale names', () => {
  it('name the tonic in the learner’s style and the kind in the interface language', () => {
    const eflat = scaleOn(3, 'harmonic-minor');
    expect(scaleName(eflat, 'letters')).toBe('E♭ harmonic minor');
    expect(scaleName(scaleOn(2, 'dorian'), 'fixed-do')).toBe('Re Dorian');
    setLanguage('de');
    expect(scaleName(eflat, 'german')).toBe('es-Moll harmonisch');
    expect(scaleName(scaleOn(11, 'major'), 'german')).toBe('H-Dur');
    expect(scaleName(scaleOn(10, 'natural-minor'), 'german')).toBe('b-Moll natürlich');
    expect(scaleName(scaleOn(6, 'minor-pentatonic'), 'german')).toBe('fis-Moll-Pentatonik');
    expect(scaleName(eflat, 'letters')).toBe('E♭-Moll harmonisch');
    expect(scaleName(scaleOn(9, 'blues'), 'german')).toBe('A-Blues');
  });

  it('label a stored scale key', () => {
    expect(scaleKindLabel('3.major')).toBe('E♭ major');
    expect(scaleKindLabel('nonsense')).toBe('nonsense');
  });
});

describe('scale drill choices', () => {
  it('keep only what a drill can do', () => {
    expect(normaliseScaleDrillPrefs(null)).toEqual(DEFAULT_SCALE_DRILL_PREFS);
    const odd = normaliseScaleDrillPrefs({
      level: 12,
      hands: 'feet',
      tempo: 999,
      count: 5,
      show: 'x',
    });
    expect(odd).toMatchObject({ level: 1, hands: 'right', tempo: 160, count: 4, show: 'sheet' });
  });

  it('start a level with its hands, octaves and display', () => {
    expect(prefsForLevel(prefs({}), 2)).toMatchObject({
      level: 2,
      hands: 'right',
      octaves: 1,
      show: 'memory',
    });
    expect(prefsForLevel(prefs({}), 6)).toMatchObject({ hands: 'together', octaves: 2 });
    expect(prefsForLevel(prefs({ show: 'falling' }), 8)).toMatchObject({
      hands: 'contrary',
      show: 'falling',
    });
    expect(prefsForLevel(prefs({ level: 3, show: 'memory' }), 1).show).toBe('sheet');
  });

  it('make a link that opens the drill they describe', () => {
    const p = prefs({ level: 5, hands: 'left', octaves: 2, rhythm: 'quavers', tempo: 100 });
    const route = scaleDrillRoute(p, ['3.major'], 77);
    const back = parseHash(href(route));
    expect(back).toEqual(route);
    if (route.name !== 'practice') throw new Error('not a practice route');
    expect(isScaleDrillId(route.id)).toBe(true);
    expect(parseScaleDrillId(route.id)).toMatchObject({
      level: 5,
      hands: 'left',
      octaves: 2,
      rhythm: 'quavers',
      tempo: 100,
      focus: ['3.major'],
      seed: 77,
    });
    expect(parseHash('#/drills/scales')).toEqual({ name: 'drills', page: 'scales' });
  });

  it('light every note, the tonic, then none as the levels climb', () => {
    expect(scaleHintFor(prefs({}), 2)).toBe('all');
    expect(scaleHintFor(prefs({}), 5)).toBe('root');
    expect(scaleHintFor(prefs({}), 8)).toBe('none');
    expect(scaleHintFor(prefs({ hint: 'tonic' }), 1)).toBe('root');
  });

  it('move the tempo a step with the ladder on, at a tempo only', () => {
    const p = prefs({ pace: 'tempo', ladder: true, tempo: 80 });
    let next = afterScaleRound(p, 0.95);
    next = afterScaleRound(next, 0.95);
    next = afterScaleRound(next, 0.95);
    expect(next.tempo).toBe(85);
    expect(afterScaleRound(p, 0.4).tempo).toBe(75);
    expect(afterScaleRound(prefs({ ladder: true }), 0.4)).toEqual(prefs({ ladder: true }));
  });
});

describe('loading a scale drill', () => {
  it('reads the drill with its names, steps and fingers, or without the fingers', () => {
    const route = scaleDrillRoute(prefs({ level: 2 }), [], 12);
    if (route.name !== 'practice') throw new Error('not a practice route');
    const d = loadScaleDrill(route.id, true, domParser);
    expect(d.names).toHaveLength(4);
    expect(d.steps).toHaveLength(d.song.notes.length);
    expect(d.song.notes.every((n) => n.fingering !== undefined)).toBe(true);
    expect(d.musicxml).toContain(d.names[0]!);
    expect(stepTonics(d)[0]).toBe(d.steps[0]!.pitches[0]! % 12);
    const bare = loadScaleDrill(route.id, false, domParser);
    expect(bare.musicxml).not.toContain('<fingering');
    expect(bare.song.notes.map((n) => n.pitch)).toEqual(d.song.notes.map((n) => n.pitch));
  });

  it('keeps the choices and the progress in the backup, as chord drills do', () => {
    expect(isDeviceSetting('scaleDrillPrefs')).toBe(false);
    expect(isDeviceSetting('scaleStats')).toBe(false);
  });

  it('finds weak scales among those the choices draw', () => {
    let stats = NO_SCALE_STATS;
    for (let i = 0; i < 3; i++) {
      stats = addScaleRound(stats, {
        at: i,
        scales: 2,
        firstTry: 1,
        notesPerMinute: 60,
        evenness: 0.1,
        kinds: { '0.major': [1, 0], '7.major': [1, 1] },
      });
    }
    expect(weakScaleFocus(stats, prefs({ level: 1 }))).toEqual(['0.major']);
    expect(
      weakScaleFocus(stats, prefs({ level: 'custom', set: { tonics: [2], kinds: ['major'] } })),
    ).toEqual([]);
  });
});

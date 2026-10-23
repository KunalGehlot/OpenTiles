// Chord drills in the app (P7-04 to P7-09): chord names in every label style, remembered choices,
// links, loading, the hint by level, the tempo ladder and weak chords.
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addRound,
  buildSteps,
  chordOn,
  chordSymbol,
  isChordDrillId,
  NO_CHORD_STATS,
  parseChordDrillId,
} from '@opentiles/practice';
import type { ChordQuality } from '@opentiles/practice';
import { chordName, setNoteLabelStyle, spelledName } from '../src/lib/notes';
import type { NoteLabelStyle } from '../src/lib/notes';
import { href, parseHash } from '../src/lib/router';
import {
  afterRound,
  chordDrillRoute,
  DEFAULT_CHORD_DRILL_PREFS,
  hintFor,
  kindLabel,
  loadChordDrill,
  normaliseChordDrillPrefs,
  weakFocus,
} from '../src/practice/chord-drill';
import type { ChordDrillPrefs } from '../src/practice/chord-drill';

afterEach(() => setNoteLabelStyle('letters'));
const domParser = new DOMParser() as unknown as Parameters<typeof loadChordDrill>[2];
const name = (pc: number, q: ChordQuality, style: NoteLabelStyle, inversion = 0) =>
  chordName(chordSymbol(chordOn(pc, q, inversion)), style);

describe('chord names', () => {
  it('follow the learner’s label style on all twelve roots', () => {
    const letters = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((pc) => name(pc, 'maj', 'letters'));
    expect(letters).toEqual(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
    const german = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((pc) => name(pc, 'maj', 'german'));
    expect(german).toEqual(['C', 'Des', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H']);
    const doRe = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((pc) => name(pc, 'maj', 'fixed-do'));
    expect(doRe).toEqual([
      'Do',
      'Re♭',
      'Re',
      'Mi♭',
      'Mi',
      'Fa',
      'Fa♯',
      'Sol',
      'La♭',
      'La',
      'Si♭',
      'Si',
    ]);
  });

  it('keep the m of minor in every style and name inversions as slash chords', () => {
    expect(name(10, 'maj7', 'letters')).toBe('B♭maj7');
    expect(name(10, 'maj7', 'german')).toBe('Bmaj7');
    expect(name(11, 'maj7', 'german')).toBe('Hmaj7');
    expect(name(10, 'maj7', 'fixed-do')).toBe('Si♭ maj7');
    expect(name(9, 'min', 'letters')).toBe('Am');
    expect(name(10, 'min', 'german')).toBe('Bm');
    expect(name(1, 'min', 'german')).toBe('Cism');
    expect(name(0, 'min', 'fixed-do')).toBe('Do m');
    expect(name(0, 'maj', 'letters', 1)).toBe('C/E');
    expect(name(3, 'maj', 'german', 2)).toBe('Es/B');
    expect(name(4, 'aug', 'letters', 2)).toBe('Eaug/B♯');
    expect(spelledName(6, 1, 'german')).toBe('His');
    expect(spelledName(0, -1, 'german')).toBe('Ces');
  });
});

describe('chord drills in the app', () => {
  it('remember only valid choices, with help and the ladder off by default', () => {
    expect(normaliseChordDrillPrefs(null)).toEqual(DEFAULT_CHORD_DRILL_PREFS);
    expect(DEFAULT_CHORD_DRILL_PREFS).toMatchObject({ ladder: false, weak: false, near: false });
    expect(
      normaliseChordDrillPrefs({ level: 9, show: 'video', tempo: 300, count: 7, hint: 'x' }),
    ).toMatchObject({ level: 1, show: 'sheet', tempo: 120, count: 16, hint: 'level' });
    expect(normaliseChordDrillPrefs({ level: 'custom', tempo: 47 })).toMatchObject({
      level: 'custom',
      tempo: 45,
    });
  });

  it('link to the practice screen, keep sight-reading links apart, and open the setup pages', () => {
    const route = chordDrillRoute({ ...DEFAULT_CHORD_DRILL_PREFS, level: 3 }, [], 42);
    expect(route).toEqual({ name: 'practice', source: 'drill', id: 'chords.l3.hr.n16.t60.s42' });
    expect(parseHash(href(route))).toEqual(route);
    expect(parseHash('#/drills')).toEqual({ name: 'drills' });
    expect(parseHash('#/drills/chords')).toEqual({ name: 'drills', page: 'chords' });
    expect(href({ name: 'drills', page: 'sight-reading' })).toBe('#/drills/sight-reading');
    expect(parseHash('#/drills/nonsense')).toEqual({ name: 'drills' });
    expect(isChordDrillId('treble.0.1.notes.8.123')).toBe(false);
    const weak = chordDrillRoute(DEFAULT_CHORD_DRILL_PREFS, ['9.min'], 1);
    expect(parseChordDrillId(weak.name === 'practice' ? weak.id : '').focus).toEqual(['9.min']);
  });

  it('load as a song with one chord a bar and names in the chosen style', () => {
    setNoteLabelStyle('german');
    const d = loadChordDrill('chords.l3.hb.n8.t60.s5', 'shown', domParser);
    expect(d.title).toBe('Level 3: All twelve roots');
    expect(d.chords).toHaveLength(8);
    expect(buildSteps(d.song)).toHaveLength(8);
    expect(d.names.every((n) => !n.includes('♭') && !n.includes('♯'))).toBe(true);
    expect(d.musicxml).toContain(`<words font-weight="bold">${d.names[0]}</words>`);
    expect(loadChordDrill('chords.l3.hr.n8.t60.s5', 'hidden', domParser).musicxml).not.toContain(
      '<words font-weight',
    );
    expect(kindLabel('10.min')).toBe('Bm');
    expect(kindLabel('nonsense')).toBe('nonsense');
  });

  it('light every key, then the root, then none as the levels climb', () => {
    const p = DEFAULT_CHORD_DRILL_PREFS;
    expect([1, 3, 4, 6, 7, 8].map((l) => hintFor(p, l as 1))).toEqual([
      'all',
      'all',
      'root',
      'root',
      'none',
      'none',
    ]);
    expect(hintFor({ ...p, hint: 'root' }, 1)).toBe('root');
    expect(hintFor(p, 'custom')).toBe('all');
  });

  it('move the tempo after rounds only with the ladder on', () => {
    const tempo = { ...DEFAULT_CHORD_DRILL_PREFS, pace: 'tempo' as const };
    expect(afterRound(tempo, 1)).toBe(tempo);
    let p: ChordDrillPrefs = { ...tempo, ladder: true };
    p = afterRound(p, 0.95);
    p = afterRound(p, 0.9);
    expect(p).toMatchObject({ tempo: 60, ladderRun: [0.95, 0.9] });
    p = afterRound(p, 1);
    expect(p).toMatchObject({ tempo: 65, ladderRun: [] });
    expect(afterRound(p, 0.4)).toMatchObject({ tempo: 60, ladderRun: [] });
  });

  it('find the weak chords among those the choices can draw', () => {
    const round = {
      at: 1,
      chords: 10,
      firstTry: 4,
      perMinute: 10,
      kinds: {
        '9.min': [5, 1, 10] as [number, number, number],
        '1.dim7': [5, 3, 10] as [number, number, number],
      },
    };
    const stats = addRound(NO_CHORD_STATS, round);
    expect(weakFocus(stats, DEFAULT_CHORD_DRILL_PREFS)).toEqual(['9.min']);
    expect(weakFocus(stats, { ...DEFAULT_CHORD_DRILL_PREFS, level: 6 })).toEqual([
      '9.min',
      '1.dim7',
    ]);
  });
});

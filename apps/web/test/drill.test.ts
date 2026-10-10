// Sight-reading drills in the app (P5-05): remembered choices, links, loading and the speed readout.
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDrillId } from '@opentiles/practice';
import { setNoteLabelStyle } from '../src/lib/notes';
import { href, parseHash } from '../src/lib/router';
import { scrubCrashText } from '../src/crash/scrub';
import {
  DEFAULT_DRILL_PREFS,
  drillRoute,
  loadDrill,
  normaliseDrillPrefs,
  notesPerMinute,
} from '../src/practice/drill';

afterEach(() => setNoteLabelStyle('letters'));
const domParser = new DOMParser() as unknown as Parameters<typeof loadDrill>[2];

describe('drills in the app', () => {
  it('remember only valid choices, with hints and endless mode off by default', () => {
    expect(normaliseDrillPrefs(null)).toEqual(DEFAULT_DRILL_PREFS);
    expect(DEFAULT_DRILL_PREFS).toMatchObject({ letters: false, showKeys: false, endless: false });
    expect(
      normaliseDrillPrefs({ clef: 'both', fifths: -2, level: 3, kind: 'phrases', letters: true }),
    ).toMatchObject({ clef: 'both', fifths: -2, level: 3, kind: 'phrases', letters: true });
    expect(normaliseDrillPrefs({ clef: 'alto', fifths: 5, level: 9, endless: 'yes' })).toEqual(
      DEFAULT_DRILL_PREFS,
    );
  });

  it('link to the practice screen with the choices and a seed, and back', () => {
    const route = drillRoute({ ...DEFAULT_DRILL_PREFS, clef: 'bass', fifths: 1 }, 42);
    expect(route).toEqual({ name: 'practice', source: 'drill', id: 'bass.1.1.notes.8.42' });
    expect(parseHash(href(route))).toEqual(route);
    expect(parseHash('#/drills')).toEqual({ name: 'drills' });
    expect(parseDrillId(route.name === 'practice' ? route.id : '')).toMatchObject({ seed: 42 });
    expect(drillRoute(DEFAULT_DRILL_PREFS)).not.toEqual(drillRoute(DEFAULT_DRILL_PREFS));
  });

  it('load as a song with a score, and names under the notes in the chosen style', () => {
    const plain = loadDrill('treble.1.1.notes.8.7', false, domParser);
    expect(plain.song.notes).toHaveLength(32);
    expect(plain.musicxml).not.toContain('<lyric');
    expect(plain.title).toBe('Treble clef, G major');
    setNoteLabelStyle('fixed-do');
    const named = loadDrill('treble.1.1.notes.8.7', true, domParser);
    const words = [...named.musicxml.matchAll(/<text>([^<]*)<\/text>/g)].map((m) => m[1] ?? '');
    expect(words).toHaveLength(32);
    expect(new Set(words)).toEqual(
      new Set(['Do', 'Re', 'Mi', 'Fa♯', 'Sol'].filter((w) => words?.includes(w))),
    );
    expect(named.song.notes.map((n) => n.pitch)).toEqual(plain.song.notes.map((n) => n.pitch));
  });

  it('read speed as right notes a minute', () => {
    expect(notesPerMinute(30, 60)).toBe(30);
    expect(notesPerMinute(32, 75)).toBe(26);
    expect(notesPerMinute(5, 0)).toBe(0);
  });

  it('keep drill links out of crash reports like other links with an id', () => {
    expect(scrubCrashText('at https://a.example/#/practice/drill/treble.0.1.notes.8.42')).toContain(
      '#/practice/drill/[id]',
    );
  });
});

// Sight-reading drills in the app (P5-05, ADR 0015): the learner's remembered choices, a drill as
// the practice screen loads it, and the speed readout. The generator itself is in
// packages/practice (drills.ts).
import { drillId, generateDrill, parseDrillId } from '@opentiles/practice';
import type { DrillClef, DrillKind, DrillOptions } from '@opentiles/practice';
import { parseMusicXml } from '@opentiles/song-model';
import type { MusicXmlOptions, Song } from '@opentiles/song-model';
import { getSetting, setSetting } from '../storage/db';
import { pitchClassName, spellingFor } from '../lib/notes';
import type { Route } from '../lib/router';
import { t } from '../i18n';

export interface DrillPrefs {
  clef: DrillClef;
  fifths: number;
  level: 1 | 2 | 3;
  kind: DrillKind;
  /** Note names written under the notes. */
  letters: boolean;
  /** Light up the key to press, as a first step for beginners. */
  showKeys: boolean;
  /** Start the next drill as soon as one ends. */
  endless: boolean;
}

export const DEFAULT_DRILL_PREFS: Readonly<DrillPrefs> = Object.freeze({
  clef: 'treble',
  fifths: 0,
  level: 1,
  kind: 'notes',
  letters: false,
  showKeys: false,
  endless: false,
});

const DRILL_PREFS_KEY = 'drillPrefs';
/** Bars in one drill: 32 notes, about a minute at a steady reading pace. */
export const DRILL_BARS = 8;
/** Key signatures a drill offers, in the order the page lists them. */
export const DRILL_KEYS: readonly number[] = [0, 1, -1, 2, -2, 3, -3];

export function normaliseDrillPrefs(value: unknown): DrillPrefs {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const d = DEFAULT_DRILL_PREFS;
  const fifths =
    typeof v.fifths === 'number' && DRILL_KEYS.includes(v.fifths) ? v.fifths : d.fifths;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  return {
    clef: v.clef === 'bass' || v.clef === 'both' ? v.clef : 'treble',
    fifths,
    level: v.level === 2 || v.level === 3 ? v.level : 1,
    kind: v.kind === 'phrases' ? 'phrases' : 'notes',
    letters: bool(v.letters, d.letters),
    showKeys: bool(v.showKeys, d.showKeys),
    endless: bool(v.endless, d.endless),
  };
}

export async function loadDrillPrefs(): Promise<DrillPrefs> {
  try {
    return normaliseDrillPrefs(await getSetting<unknown>(DRILL_PREFS_KEY, null));
  } catch {
    return normaliseDrillPrefs(null);
  }
}

export function saveDrillPrefs(prefs: DrillPrefs): Promise<void> {
  return setSetting(DRILL_PREFS_KEY, prefs).catch(() => {});
}

/** A seed for a new drill. Not secret, only different each time. */
export function newSeed(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return (a[0] ?? 1) % 2 ** 31;
}

/** The practice screen's link for a new drill with these choices. */
export function drillRoute(prefs: DrillPrefs, seed = newSeed()): Route {
  const options: DrillOptions = {
    clef: prefs.clef,
    fifths: prefs.fifths,
    level: prefs.level,
    kind: prefs.kind,
    bars: DRILL_BARS,
    seed,
  };
  return { name: 'practice', source: 'drill', id: drillId(options) };
}

export function clefName(clef: DrillClef): string {
  return clef === 'bass' ? t('Bass clef') : clef === 'both' ? t('Both clefs') : t('Treble clef');
}

export function keyName(fifths: number): string {
  const names: Record<number, string> = {
    [-3]: t('E♭ major'),
    [-2]: t('B♭ major'),
    [-1]: t('F major'),
    0: t('C major'),
    1: t('G major'),
    2: t('D major'),
    3: t('A major'),
  };
  return names[fifths] ?? t('C major');
}

export interface LoadedDrill {
  options: DrillOptions;
  song: Song;
  musicxml: string;
  title: string;
}

/**
 * The drill a link names, as the practice screen shows it. `domParser` is for tests in Node; the
 * browser has its own.
 */
export function loadDrill(
  id: string,
  letters: boolean,
  domParser?: MusicXmlOptions['domParser'],
): LoadedDrill {
  const options = parseDrillId(id);
  const spelling = spellingFor('key', options.fifths);
  const drill = generateDrill(
    options,
    letters ? (pitch) => pitchClassName(pitch, spelling) : undefined,
  );
  return {
    options,
    song: {
      ...parseMusicXml(drill.musicxml, domParser ? { domParser } : {}),
      title: t('Sight-reading'),
    },
    musicxml: drill.musicxml,
    title: `${clefName(options.clef)}, ${keyName(options.fifths)}`,
  };
}

/** Reading speed: right notes a minute, rounded; 0 before a minute's worth can be told. */
export function notesPerMinute(notes: number, seconds: number): number {
  return seconds >= 1 ? Math.round((notes * 60) / seconds) : 0;
}

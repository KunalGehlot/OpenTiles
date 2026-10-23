// Chord drills in the app (P7-04 to P7-09, ADR 0022): the learner's remembered choices, a chord
// drill as the practice screen loads it, chord names in the learner's label style, and the chord
// progress kept on this device. The generator itself is in packages/practice (chord-drills.ts).
import {
  addRound,
  CHORD_DRILL_DEFAULTS,
  CHORD_QUALITIES,
  chordDrillId,
  chordOn,
  chordSymbol,
  drillEntries,
  generateChordDrill,
  levelHands,
  MAX_CHORD_TEMPO,
  MIN_CHORD_TEMPO,
  nextChordTempo,
  normaliseChordSet,
  normaliseChordStats,
  parseChordDrillId,
  roundOf,
  weakChords,
} from '@opentiles/practice';
import type {
  Chord,
  ChordAttempt,
  ChordDrillOptions,
  ChordHands,
  ChordLevel,
  ChordMiss,
  ChordQuality,
  ChordRoundSummary,
  ChordSet,
  ChordStats,
  DrillChord,
} from '@opentiles/practice';
import { parseMusicXml } from '@opentiles/song-model';
import type { MusicXmlOptions, Song } from '@opentiles/song-model';
import { getSetting, setSetting } from '../storage/db';
import { chordName } from '../lib/notes';
import type { Route } from '../lib/router';
import { t } from '../i18n';
import { newSeed } from './drill';

export type ChordDisplay = 'sheet' | 'falling';
export type ChordNames = 'shown' | 'hidden' | 'name-only';
export type ChordPace = 'wait' | 'tempo';
/** Keys lit in the falling keys: as the level says, every key, the root only, or none. */
export type ChordHint = 'level' | 'all' | 'root' | 'none';

export interface ChordDrillPrefs {
  level: ChordLevel | 'custom';
  set: ChordSet;
  hands: ChordHands;
  show: ChordDisplay;
  names: ChordNames;
  pace: ChordPace;
  /** Beats a minute for the tempo pace. */
  tempo: number;
  /** Raise or lower the tempo as rounds go well or badly (off by default, Q7). */
  ladder: boolean;
  /** Chords in a round. */
  count: number;
  endless: boolean;
  /** Draw the chords that went wrong most more often (P7-08). */
  weak: boolean;
  /** The next chord in the inversion nearest the last. */
  near: boolean;
  /** On the sheet: light up the keys to press, as a first step. */
  showKeys: boolean;
  hint: ChordHint;
  /** At a tempo, a chord's notes must land within 60 ms instead of 120 ms. */
  strict: boolean;
  /** The tempo ladder's rounds at the current tempo: the share right at the first try of each. */
  ladderRun: number[];
}

export const CHORD_COUNTS: readonly number[] = [8, 16, 32];

export const DEFAULT_CHORD_DRILL_PREFS: Readonly<ChordDrillPrefs> = Object.freeze({
  level: 1,
  set: CHORD_DRILL_DEFAULTS.set,
  hands: 'right',
  show: 'sheet',
  names: 'shown',
  pace: 'wait',
  tempo: 60,
  ladder: false,
  count: 16,
  endless: false,
  weak: false,
  near: false,
  showKeys: false,
  hint: 'level',
  strict: false,
  ladderRun: [],
});

const PREFS_KEY = 'chordDrillPrefs';
const STATS_KEY = 'chordStats';

export function normaliseChordDrillPrefs(value: unknown): ChordDrillPrefs {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const d = DEFAULT_CHORD_DRILL_PREFS;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  const level =
    v.level === 'custom'
      ? 'custom'
      : typeof v.level === 'number' && Number.isInteger(v.level) && v.level >= 1 && v.level <= 8
        ? (v.level as ChordLevel)
        : (d.level as ChordLevel);
  const tempo = typeof v.tempo === 'number' && Number.isFinite(v.tempo) ? v.tempo : d.tempo;
  return {
    level,
    set: normaliseChordSet(v.set),
    hands: v.hands === 'left' || v.hands === 'both' || v.hands === 'right' ? v.hands : d.hands,
    show: v.show === 'falling' ? 'falling' : 'sheet',
    names: v.names === 'hidden' || v.names === 'name-only' ? v.names : 'shown',
    pace: v.pace === 'tempo' ? 'tempo' : 'wait',
    tempo: Math.round(Math.min(MAX_CHORD_TEMPO, Math.max(MIN_CHORD_TEMPO, tempo)) / 5) * 5,
    ladder: bool(v.ladder, d.ladder),
    count: typeof v.count === 'number' && CHORD_COUNTS.includes(v.count) ? v.count : d.count,
    endless: bool(v.endless, d.endless),
    weak: bool(v.weak, d.weak),
    near: bool(v.near, d.near),
    showKeys: bool(v.showKeys, d.showKeys),
    hint: v.hint === 'all' || v.hint === 'root' || v.hint === 'none' ? v.hint : 'level',
    strict: bool(v.strict, d.strict),
    ladderRun: Array.isArray(v.ladderRun)
      ? v.ladderRun.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 1).slice(-3)
      : [],
  };
}

/**
 * The choices after a round at a tempo with the ladder on (P7-07): the tempo moves a step when
 * the ladder says so, and the rounds counted start again.
 */
export function afterRound(prefs: ChordDrillPrefs, share: number): ChordDrillPrefs {
  if (prefs.pace !== 'tempo' || !prefs.ladder) return prefs;
  const shares = [...prefs.ladderRun, share];
  const tempo = nextChordTempo(shares, prefs.tempo);
  return tempo === prefs.tempo
    ? { ...prefs, ladderRun: shares.slice(-3) }
    : { ...prefs, tempo, ladderRun: [] };
}

export async function loadChordDrillPrefs(): Promise<ChordDrillPrefs> {
  try {
    return normaliseChordDrillPrefs(await getSetting<unknown>(PREFS_KEY, null));
  } catch {
    return normaliseChordDrillPrefs(null);
  }
}

export function saveChordDrillPrefs(prefs: ChordDrillPrefs): Promise<void> {
  return setSetting(PREFS_KEY, prefs).catch(() => {});
}

/** The hands a new level starts with: its own default (P7-09). */
export const handsForLevel = (level: ChordLevel | 'custom'): ChordHands =>
  level === 'custom' ? 'right' : levelHands(level);

/** The drill's options from the learner's choices. */
export function chordDrillOptions(
  prefs: ChordDrillPrefs,
  seed: number,
  focus: string[] = [],
): ChordDrillOptions {
  return {
    level: prefs.level,
    set: prefs.set,
    hands: prefs.hands,
    count: prefs.count,
    tempo: prefs.tempo,
    near: prefs.near,
    focus,
    seed,
  };
}

/** The practice screen's link for a new chord drill with these choices. */
export function chordDrillRoute(
  prefs: ChordDrillPrefs,
  focus: string[] = [],
  seed = newSeed(),
): Route {
  return {
    name: 'practice',
    source: 'drill',
    id: chordDrillId(chordDrillOptions(prefs, seed, focus)),
  };
}

/** The chord's name in the learner's label style. */
export const chordLabel = (chord: Chord): string => chordName(chordSymbol(chord));

/** What each level adds, for the level list (P7-09). */
export function levelName(level: ChordLevel | 'custom'): string {
  const names: Record<ChordLevel, string> = {
    1: t('C, F and G major; A, D and E minor'),
    2: t('Major and minor on every white key'),
    3: t('All twelve roots'),
    4: t('First and second inversions'),
    5: t('Diminished, augmented and suspended'),
    6: t('Seventh chords'),
    7: t('Seventh inversions, add9 and sixths'),
    8: t('The left hand plays root and fifth'),
  };
  return level === 'custom' ? t('My own set') : names[level];
}

export function qualityName(q: ChordQuality): string {
  const names: Record<ChordQuality, string> = {
    maj: t('Major'),
    min: t('Minor'),
    dim: t('Diminished'),
    aug: t('Augmented'),
    sus2: t('Suspended second (sus2)'),
    sus4: t('Suspended fourth (sus4)'),
    maj7: t('Major seventh (maj7)'),
    dom7: t('Dominant seventh (7)'),
    min7: t('Minor seventh (m7)'),
    m7b5: t('Half-diminished (m7♭5)'),
    dim7: t('Diminished seventh (dim7)'),
    add9: t('Added ninth (add9)'),
    six: t('Sixth (6)'),
    min6: t('Minor sixth (m6)'),
  };
  return names[q];
}

export const QUALITIES = CHORD_QUALITIES;

export function causeName(cause: ChordMiss): string {
  const names: Record<ChordMiss, string> = {
    missing: t('a note missing'),
    extra: t('a note not in the chord'),
    quality: t('the wrong third or fifth'),
    inversion: t('the wrong inversion'),
  };
  return names[cause];
}

/** A kind of chord (`pitchClass.quality`) by its name: "E♭m", "Hdim7". */
export function kindLabel(kind: string): string {
  const [pc, quality] = kind.split('.');
  if (!quality || !(CHORD_QUALITIES as readonly string[]).includes(quality)) return kind;
  return chordLabel(chordOn(Number(pc), quality as ChordQuality));
}

/** The keys lit in falling keys for a level: all, then only the root, then none (P7-06). */
export function hintFor(
  prefs: ChordDrillPrefs,
  level: ChordLevel | 'custom',
): Exclude<ChordHint, 'level'> {
  if (prefs.hint !== 'level') return prefs.hint;
  if (level === 'custom') return 'all';
  return level <= 3 ? 'all' : level <= 6 ? 'root' : 'none';
}

export interface LoadedChordDrill {
  options: ChordDrillOptions;
  song: Song;
  musicxml: string;
  chords: DrillChord[];
  /** Each chord's name in the learner's style. */
  names: string[];
  title: string;
}

/**
 * The chord drill a link names, as the practice screen shows it. Names are written on the score
 * unless hidden. `domParser` is for tests in Node; the browser has its own.
 */
export function loadChordDrill(
  id: string,
  names: ChordNames,
  domParser?: MusicXmlOptions['domParser'],
): LoadedChordDrill {
  const options = parseChordDrillId(id);
  const drill = generateChordDrill(options, names === 'hidden' ? undefined : chordLabel);
  const level = options.level;
  return {
    options,
    song: {
      ...parseMusicXml(drill.musicxml, domParser ? { domParser } : {}),
      title: t('Chords'),
    },
    musicxml: drill.musicxml,
    chords: drill.chords,
    names: drill.chords.map((c) => chordLabel(c.chord)),
    title:
      level === 'custom'
        ? levelName('custom')
        : t('Level {n}: {name}', { n: level, name: levelName(level) }),
  };
}

export async function loadChordStats(): Promise<ChordStats> {
  try {
    return normaliseChordStats(await getSetting<unknown>(STATS_KEY, null));
  } catch {
    return normaliseChordStats(null);
  }
}

/** Adds a finished round to the progress on this device; returns the stats before and after. */
export async function recordChordRound(
  summary: ChordRoundSummary,
  attempts: readonly ChordAttempt[],
): Promise<{ before: ChordStats; after: ChordStats }> {
  const before = await loadChordStats();
  const seconds = new Map<string, number>();
  for (const a of attempts) {
    if (a.seconds !== null) seconds.set(a.kind, (seconds.get(a.kind) ?? 0) + a.seconds);
  }
  const after = addRound(before, roundOf(summary, seconds, Date.now()));
  await setSetting(STATS_KEY, after).catch(() => {});
  return { before, after };
}

/** The weak chords among those the learner's choices draw, as the generator's `focus`. */
export function weakFocus(stats: ChordStats, prefs: ChordDrillPrefs): string[] {
  const allowed = new Set(
    drillEntries(chordDrillOptions(prefs, 1)).map((e) => `${e.pitchClass}.${e.quality}`),
  );
  return weakChords(stats, allowed).map((k) => k.kind);
}

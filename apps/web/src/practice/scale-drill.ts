// Scale drills in the app (P7-19 to P7-21, ADR 0024): the learner's remembered choices, a scale
// drill as the practice screen loads it, scale names in the learner's label style and language,
// and the scale progress kept on this device. The generator itself is in packages/practice
// (scale-drills.ts).
import {
  addScaleRound,
  generateScaleDrill,
  MAX_SCALE_TEMPO,
  MIN_SCALE_TEMPO,
  nextChordTempo,
  normaliseScaleSet,
  normaliseScaleStats,
  parseScaleDrillId,
  pitchClassOf,
  SCALE_DRILL_DEFAULTS,
  SCALE_KINDS,
  SCALE_TEMPO_STEP,
  scaleDrillEntries,
  scaleDrillId,
  scaleLevelDefaults,
  scaleOn,
  scaleRoundOf,
  scaleSteps,
  weakScales,
} from '@opentiles/practice';
import type {
  DrillScale,
  Scale,
  ScaleDrillOptions,
  ScaleHands,
  ScaleKind,
  ScaleLevel,
  ScaleMiss,
  ScaleRhythm,
  ScaleRoundSummary,
  ScaleSet,
  ScaleStats,
  ScaleStep,
  UnevenAt,
} from '@opentiles/practice';
import { parseMusicXml } from '@opentiles/song-model';
import type { MusicXmlOptions, Song } from '@opentiles/song-model';
import { getSetting, setSetting } from '../storage/db';
import { noteLabelStyle, spelledName } from '../lib/notes';
import type { Route } from '../lib/router';
import { language, t } from '../i18n';
import { newSeed } from './drill';

/** The sheet, the name only (from memory), or falling keys. */
export type ScaleDisplay = 'sheet' | 'memory' | 'falling';
export type ScalePace = 'wait' | 'tempo';
/** Keys lit in the falling keys: as the level says, every key, the tonic only, or none. */
export type ScaleHint = 'level' | 'all' | 'tonic' | 'none';

export interface ScaleDrillPrefs {
  level: ScaleLevel | 'custom';
  set: ScaleSet;
  hands: ScaleHands;
  octaves: 1 | 2;
  show: ScaleDisplay;
  pace: ScalePace;
  rhythm: ScaleRhythm;
  /** Crotchets a minute for the tempo pace. */
  tempo: number;
  /** Raise or lower the tempo as rounds go well or badly (off by default). */
  ladder: boolean;
  /** Scales in a round. */
  count: number;
  endless: boolean;
  /** Draw the scales that went wrong most more often. */
  weak: boolean;
  /** On the sheet: light up the keys to press, as a first step. */
  showKeys: boolean;
  hint: ScaleHint;
  /** The fingers written on the score and the falling keys. */
  fingers: boolean;
  /** The tempo ladder's rounds at the current tempo: the share right at the first try of each. */
  ladderRun: number[];
}

export const SCALE_COUNTS: readonly number[] = [2, 4, 8];

export const DEFAULT_SCALE_DRILL_PREFS: Readonly<ScaleDrillPrefs> = Object.freeze({
  level: 1,
  set: SCALE_DRILL_DEFAULTS.set,
  hands: 'right',
  octaves: 1,
  show: 'sheet',
  pace: 'wait',
  rhythm: 'crotchets',
  tempo: 80,
  ladder: false,
  count: 4,
  endless: false,
  weak: false,
  showKeys: false,
  hint: 'level',
  fingers: true,
  ladderRun: [],
});

const PREFS_KEY = 'scaleDrillPrefs';
const STATS_KEY = 'scaleStats';

export function normaliseScaleDrillPrefs(value: unknown): ScaleDrillPrefs {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const d = DEFAULT_SCALE_DRILL_PREFS;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  const level =
    v.level === 'custom'
      ? 'custom'
      : typeof v.level === 'number' && Number.isInteger(v.level) && v.level >= 1 && v.level <= 8
        ? (v.level as ScaleLevel)
        : (d.level as ScaleLevel);
  const tempo = typeof v.tempo === 'number' && Number.isFinite(v.tempo) ? v.tempo : d.tempo;
  return {
    level,
    set: normaliseScaleSet(v.set),
    hands:
      v.hands === 'left' || v.hands === 'together' || v.hands === 'contrary' ? v.hands : 'right',
    octaves: v.octaves === 2 ? 2 : 1,
    show: v.show === 'memory' || v.show === 'falling' ? v.show : 'sheet',
    pace: v.pace === 'tempo' ? 'tempo' : 'wait',
    rhythm: v.rhythm === 'quavers' ? 'quavers' : 'crotchets',
    tempo:
      Math.round(Math.min(MAX_SCALE_TEMPO, Math.max(MIN_SCALE_TEMPO, tempo)) / SCALE_TEMPO_STEP) *
      SCALE_TEMPO_STEP,
    ladder: bool(v.ladder, d.ladder),
    count: typeof v.count === 'number' && SCALE_COUNTS.includes(v.count) ? v.count : d.count,
    endless: bool(v.endless, d.endless),
    weak: bool(v.weak, d.weak),
    showKeys: bool(v.showKeys, d.showKeys),
    hint: v.hint === 'all' || v.hint === 'tonic' || v.hint === 'none' ? v.hint : 'level',
    fingers: bool(v.fingers, d.fingers),
    ladderRun: Array.isArray(v.ladderRun)
      ? v.ladderRun.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 1).slice(-3)
      : [],
  };
}

/** The choices a new level starts with: its hands and octaves, and from memory past level 1. */
export function prefsForLevel(
  prefs: ScaleDrillPrefs,
  level: ScaleLevel | 'custom',
): ScaleDrillPrefs {
  const defaults =
    level === 'custom' ? { hands: prefs.hands, octaves: prefs.octaves } : scaleLevelDefaults(level);
  const show =
    prefs.show === 'falling' || level === 'custom' ? prefs.show : level === 1 ? 'sheet' : 'memory';
  return { ...prefs, level, ...defaults, show };
}

/** The choices after a round at a tempo with the ladder on: the tempo moves a step when it should. */
export function afterScaleRound(prefs: ScaleDrillPrefs, share: number): ScaleDrillPrefs {
  if (prefs.pace !== 'tempo' || !prefs.ladder) return prefs;
  const shares = [...prefs.ladderRun, share];
  const tempo = nextChordTempo(shares, prefs.tempo, {
    min: MIN_SCALE_TEMPO,
    max: MAX_SCALE_TEMPO,
    step: SCALE_TEMPO_STEP,
  });
  return tempo === prefs.tempo
    ? { ...prefs, ladderRun: shares.slice(-3) }
    : { ...prefs, tempo, ladderRun: [] };
}

export async function loadScaleDrillPrefs(): Promise<ScaleDrillPrefs> {
  try {
    return normaliseScaleDrillPrefs(await getSetting<unknown>(PREFS_KEY, null));
  } catch {
    return normaliseScaleDrillPrefs(null);
  }
}

export function saveScaleDrillPrefs(prefs: ScaleDrillPrefs): Promise<void> {
  return setSetting(PREFS_KEY, prefs).catch(() => {});
}

/** The drill's options from the learner's choices. */
export function scaleDrillOptions(
  prefs: ScaleDrillPrefs,
  seed: number,
  focus: string[] = [],
): ScaleDrillOptions {
  return {
    level: prefs.level,
    set: prefs.set,
    hands: prefs.hands,
    octaves: prefs.octaves,
    rhythm: prefs.rhythm,
    count: prefs.count,
    tempo: prefs.tempo,
    focus,
    seed,
  };
}

/** The practice screen's link for a new scale drill with these choices. */
export function scaleDrillRoute(
  prefs: ScaleDrillPrefs,
  focus: string[] = [],
  seed = newSeed(),
): Route {
  return {
    name: 'practice',
    source: 'drill',
    id: scaleDrillId(scaleDrillOptions(prefs, seed, focus)),
  };
}

/** Names by kind, from the tonic as written. */
const NAMES: Record<ScaleKind, (tonic: string) => string> = {
  major: (tonic) => t('{tonic} major', { tonic }),
  'natural-minor': (tonic) => t('{tonic} natural minor', { tonic }),
  'harmonic-minor': (tonic) => t('{tonic} harmonic minor', { tonic }),
  'melodic-minor': (tonic) => t('{tonic} melodic minor', { tonic }),
  dorian: (tonic) => t('{tonic} Dorian', { tonic }),
  phrygian: (tonic) => t('{tonic} Phrygian', { tonic }),
  lydian: (tonic) => t('{tonic} Lydian', { tonic }),
  mixolydian: (tonic) => t('{tonic} Mixolydian', { tonic }),
  locrian: (tonic) => t('{tonic} Locrian', { tonic }),
  'major-pentatonic': (tonic) => t('{tonic} major pentatonic', { tonic }),
  'minor-pentatonic': (tonic) => t('{tonic} minor pentatonic', { tonic }),
  blues: (tonic) => t('{tonic} blues', { tonic }),
  chromatic: (tonic) => t('{tonic} chromatic', { tonic }),
};

/** Kinds named after a minor key, whose German name has the tonic in lower case (es-Moll). */
const MINOR_KEYS = new Set<ScaleKind>([
  'natural-minor',
  'harmonic-minor',
  'melodic-minor',
  'minor-pentatonic',
]);

/**
 * A scale's name (ADR 0024, Q10): the tonic as the note-name setting writes it, the words in the
 * interface language. German names a minor key with its tonic in lower case, as German books do
 * ("es-Moll harmonisch"), when the tonic is a German note name.
 */
export function scaleName(scale: Scale, style = noteLabelStyle()): string {
  const tonic = spelledName(scale.tonic.letter, scale.tonic.alter, style);
  const lower = language() === 'de' && style === 'german' && MINOR_KEYS.has(scale.kind);
  return NAMES[scale.kind](lower ? tonic.toLowerCase() : tonic);
}

/** What each level adds, for the level list. */
export function scaleLevelName(level: ScaleLevel | 'custom'): string {
  const names: Record<ScaleLevel, string> = {
    1: t('C, G and F major; A minor'),
    2: t('Up to two sharps or flats, with harmonic minors'),
    3: t('All twelve major scales'),
    4: t('Every minor: natural, harmonic, melodic'),
    5: t('Two octaves'),
    6: t('Hands together'),
    7: t('Modes, pentatonics and blues'),
    8: t('Chromatic and contrary motion'),
  };
  return level === 'custom' ? t('My own set') : names[level];
}

export function scaleKindName(kind: ScaleKind): string {
  const names: Record<ScaleKind, string> = {
    major: t('Major'),
    'natural-minor': t('Natural minor'),
    'harmonic-minor': t('Harmonic minor'),
    'melodic-minor': t('Melodic minor'),
    dorian: t('Dorian'),
    phrygian: t('Phrygian'),
    lydian: t('Lydian'),
    mixolydian: t('Mixolydian'),
    locrian: t('Locrian'),
    'major-pentatonic': t('Major pentatonic'),
    'minor-pentatonic': t('Minor pentatonic'),
    blues: t('Blues'),
    chromatic: t('Chromatic'),
  };
  return names[kind];
}

export const KINDS = SCALE_KINDS;

export function scaleCauseName(cause: ScaleMiss): string {
  const names: Record<ScaleMiss, string> = {
    key: t("the key's sharp or flat"),
    form: t('the wrong form of minor'),
    skip: t('a note skipped'),
    other: t('a wrong note'),
    missing: t('a note missing'),
    apart: t('hands not together'),
    shown: t('shown on request'),
  };
  return names[cause];
}

/** How even a scale was, in words, and where it was least even. */
export function evennessText(word: 'very-even' | 'even' | 'uneven', at: UnevenAt | null): string {
  if (word === 'very-even') return t('Very even');
  if (word === 'even') return t('Even');
  if (at === 'thumb') return t('Uneven where the thumb passes');
  if (at === 'turn') return t('Uneven at the turn');
  return t('Uneven');
}

/** A scale (`pitchClass.kind`) by its name: "E♭ major", "es-Moll harmonisch". */
export function scaleKindLabel(kind: string): string {
  const [pc, name] = kind.split('.');
  if (!name || !(SCALE_KINDS as readonly string[]).includes(name)) return kind;
  return scaleName(scaleOn(Number(pc), name as ScaleKind));
}

/** The keys lit in falling keys for a level: all, then only the tonic, then none. */
export function scaleHintFor(
  prefs: ScaleDrillPrefs,
  level: ScaleLevel | 'custom',
): 'all' | 'root' | 'none' {
  const hint =
    prefs.hint === 'level'
      ? level === 'custom' || level <= 3
        ? 'all'
        : level <= 6
          ? 'tonic'
          : 'none'
      : prefs.hint;
  return hint === 'tonic' ? 'root' : hint;
}

export interface LoadedScaleDrill {
  options: ScaleDrillOptions;
  song: Song;
  musicxml: string;
  scales: DrillScale[];
  steps: ScaleStep[];
  /** Each scale's name in the learner's style. */
  names: string[];
  title: string;
}

/**
 * The scale drill a link names, as the practice screen shows it. Names are always written; the
 * fingers unless the learner hides them. `domParser` is for tests in Node; the browser has its own.
 */
export function loadScaleDrill(
  id: string,
  fingers = true,
  domParser?: MusicXmlOptions['domParser'],
): LoadedScaleDrill {
  const options = parseScaleDrillId(id);
  const drill = generateScaleDrill(options, (s) => scaleName(s));
  const musicxml = fingers
    ? drill.musicxml
    : drill.musicxml.replace(
        /<notations><technical><fingering[^<]*<\/fingering><\/technical><\/notations>/g,
        '',
      );
  const level = options.level;
  return {
    options,
    song: { ...parseMusicXml(musicxml, domParser ? { domParser } : {}), title: t('Scales') },
    musicxml,
    scales: drill.scales,
    steps: scaleSteps(drill),
    names: drill.scales.map((s) => scaleName(s.scale)),
    title:
      level === 'custom'
        ? scaleLevelName('custom')
        : t('Level {n}: {name}', { n: level, name: scaleLevelName(level) }),
  };
}

/** The tonic's pitch class for each step, for the tonic-only hint. */
export const stepTonics = (d: LoadedScaleDrill): number[] =>
  d.steps.map((s) => pitchClassOf(d.scales[s.scale]?.scale.tonic ?? { letter: 0, alter: 0 }));

export async function loadScaleStats(): Promise<ScaleStats> {
  try {
    return normaliseScaleStats(await getSetting<unknown>(STATS_KEY, null));
  } catch {
    return normaliseScaleStats(null);
  }
}

/** Adds a finished round to the progress on this device; returns the stats before and after. */
export async function recordScaleRound(
  summary: ScaleRoundSummary,
): Promise<{ before: ScaleStats; after: ScaleStats }> {
  const before = await loadScaleStats();
  const after = addScaleRound(before, scaleRoundOf(summary, Date.now()));
  await setSetting(STATS_KEY, after).catch(() => {});
  return { before, after };
}

/** The weak scales among those the learner's choices draw, as the generator's `focus`. */
export function weakScaleFocus(stats: ScaleStats, prefs: ScaleDrillPrefs): string[] {
  const allowed = new Set(
    scaleDrillEntries(scaleDrillOptions(prefs, 1)).map((e) => `${e.pitchClass}.${e.kind}`),
  );
  return weakScales(stats, allowed).map((k) => k.kind);
}

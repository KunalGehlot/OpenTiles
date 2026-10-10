// App-wide settings (P2-15 accessibility, language, crash reports, P4-07 keyboard size, P4-08
// fingering, P5-03 note names), as plain data. Pure: no DOM or IndexedDB here, so the rules are unit-tested in Node.
// The store in ./store.ts persists them.
import { customKeyboard, keyCount, presetById } from '@opentiles/practice';
import type { KeyboardRange } from '@opentiles/practice';
import { isBlackKey, PIANO_HIGH, PIANO_LOW } from '@opentiles/song-model';
import { t } from '../i18n';
import { NOTE_LABEL_SETTINGS, noteLabel, SPELLING_SETTINGS } from '../lib/notes';
import type { NoteLabelSetting, SpellingSetting } from '../lib/notes';

/** `system` follows the operating system's preference (prefers-contrast, prefers-reduced-motion). */
export type TriState = 'system' | 'on' | 'off';

export type Language = 'en' | 'de';

export interface PedalSettings {
  enabled: boolean;
  /** `KeyboardEvent.key` the pedal sends to go forward. */
  nextKey: string;
  /** `KeyboardEvent.key` the pedal sends to go back. */
  previousKey: string;
}

/**
 * The learner's keyboard (P4-07). `auto` draws just the keys a piece needs, as before; a preset id
 * or `custom` draws the learner's real keyboard and fits pieces onto it by octaves.
 */
export interface KeyboardSetting {
  size: string;
  /** Lowest key of a custom keyboard (MIDI). */
  low: number;
  /** Number of keys of a custom keyboard. */
  keys: number;
}

/** Where the app's own notes play: this device, the MIDI keyboard's sound, or both. */
export type MidiPlayback = 'device' | 'keyboard' | 'both';

export interface MidiSetting {
  /** Play the keys pressed on a MIDI keyboard through this device too. */
  echo: boolean;
  /** Where the app's notes (listen mode, the other hand, listening back) play. */
  playback: MidiPlayback;
  /** The MIDI output to play on; empty for the keyboard that is connected. */
  output: string;
}

/** Which fingers to show (P4-08): suggested ones fill the gaps the score leaves. */
export type FingeringDisplay = 'suggested' | 'written' | 'off';

export interface AppSettings {
  language: Language;
  /** Bigger UI text and keyboard labels. */
  largePrint: boolean;
  highContrast: TriState;
  reducedMotion: TriState;
  /** Practice controls on the left. The practice view reads it through `useLeftHanded`. */
  leftHanded: boolean;
  pedal: PedalSettings;
  /** Opt-in anonymous crash reports (P3-08). Off unless the user switches them on. */
  crashReports: boolean;
  keyboard: KeyboardSetting;
  fingering: FingeringDisplay;
  /** Note names (C, F♯, B♭) at the top of each falling note and on the keys to play. */
  noteNames: boolean;
  /** How note names are written everywhere: letters, German (H) or Fixed-Do (P5-03). */
  noteLabels: NoteLabelSetting;
  /** Black keys on the falling notes and keys: as the key signature, or sharps or flats (P5-04). */
  noteSpelling: SpellingSetting;
  midi: MidiSetting;
}

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  language: 'en',
  largePrint: false,
  highContrast: 'system',
  reducedMotion: 'system',
  leftHanded: false,
  pedal: Object.freeze({ enabled: false, nextKey: 'ArrowRight', previousKey: 'ArrowLeft' }),
  crashReports: false,
  keyboard: Object.freeze({ size: 'auto', low: PIANO_LOW, keys: 88 }),
  fingering: 'suggested',
  noteNames: true,
  noteLabels: 'auto',
  noteSpelling: 'key',
  midi: Object.freeze({ echo: false, playback: 'device', output: '' }),
}) as Readonly<AppSettings>;

/** Keys most Bluetooth page-turn pedals send, in the order the settings list offers them. */
export const PEDAL_KEYS: readonly string[] = [
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  ' ',
  'Enter',
];

/** A pedal key's name in the current language. */
export function pedalKeyLabel(key: string): string {
  switch (key) {
    case 'ArrowRight':
      return t('Right arrow');
    case 'ArrowLeft':
      return t('Left arrow');
    case 'ArrowDown':
      return t('Down arrow');
    case 'ArrowUp':
      return t('Up arrow');
    case 'PageDown':
      return t('Page Down');
    case 'PageUp':
      return t('Page Up');
    case ' ':
      return t('Space');
    case 'Enter':
      return t('Enter');
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

function tri(value: unknown, fallback: TriState): TriState {
  return value === 'system' || value === 'on' || value === 'off' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function key(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32 ? value : fallback;
}

/** Reads stored or imported settings defensively: unknown fields are dropped, bad ones defaulted. */
export function normaliseSettings(value: unknown): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const p =
    typeof v.pedal === 'object' && v.pedal !== null ? (v.pedal as Record<string, unknown>) : {};
  return {
    language: v.language === 'de' ? 'de' : 'en',
    largePrint: bool(v.largePrint, d.largePrint),
    highContrast: tri(v.highContrast, d.highContrast),
    reducedMotion: tri(v.reducedMotion, d.reducedMotion),
    leftHanded: bool(v.leftHanded, d.leftHanded),
    pedal: {
      enabled: bool(p.enabled, d.pedal.enabled),
      nextKey: key(p.nextKey, d.pedal.nextKey),
      previousKey: key(p.previousKey, d.pedal.previousKey),
    },
    crashReports: bool(v.crashReports, d.crashReports),
    keyboard: normaliseKeyboard(v.keyboard),
    fingering: v.fingering === 'written' || v.fingering === 'off' ? v.fingering : 'suggested',
    noteNames: bool(v.noteNames, d.noteNames),
    noteLabels: NOTE_LABEL_SETTINGS.find((s) => s === v.noteLabels) ?? d.noteLabels,
    noteSpelling: SPELLING_SETTINGS.find((s) => s === v.noteSpelling) ?? d.noteSpelling,
    midi: normaliseMidi(v.midi),
  };
}

function normaliseMidi(value: unknown): MidiSetting {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    echo: bool(v.echo, false),
    playback: v.playback === 'keyboard' || v.playback === 'both' ? v.playback : 'device',
    output: typeof v.output === 'string' && v.output.length <= 200 ? v.output : '',
  };
}

/** Fewest keys a custom keyboard may have: one octave, so pieces can still be folded onto it. */
export const MIN_CUSTOM_KEYS = 12;

function normaliseKeyboard(value: unknown): KeyboardSetting {
  const d = DEFAULT_APP_SETTINGS.keyboard;
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const size =
    typeof v.size === 'string' && (v.size === 'custom' || presetById(v.size)) ? v.size : 'auto';
  const low =
    typeof v.low === 'number' && Number.isFinite(v.low)
      ? Math.max(PIANO_LOW, Math.min(PIANO_HIGH - MIN_CUSTOM_KEYS + 1, Math.round(v.low)))
      : d.low;
  const keys =
    typeof v.keys === 'number' && Number.isFinite(v.keys)
      ? Math.max(MIN_CUSTOM_KEYS, Math.min(PIANO_HIGH - low + 1, Math.round(v.keys)))
      : Math.min(d.keys, PIANO_HIGH - low + 1);
  return { size, low, keys };
}

/** The keys to draw and fit pieces to, or null to fit the keyboard to each piece. */
export function keyboardRange(k: KeyboardSetting): KeyboardRange | null {
  if (k.size === 'auto') return null;
  if (k.size === 'custom') return customKeyboard(k.low, k.keys);
  const p = presetById(k.size);
  return p ? { low: p.low, high: p.high } : null;
}

/** "86 keys (A0–B♭7)". */
export function keyboardLabel(range: KeyboardRange): string {
  return t('{n} keys ({low}–{high})', {
    n: keyCount(range),
    low: noteLabel(range.low),
    high: noteLabel(range.high),
  });
}

/** White keys a custom keyboard can start on, lowest first (real keyboards start on one). */
export function lowestKeyChoices(): { pitch: number; label: string }[] {
  const out: { pitch: number; label: string }[] = [];
  for (let p = PIANO_LOW; p <= 72; p++)
    if (!isBlackKey(p)) out.push({ pitch: p, label: noteLabel(p) });
  return out;
}

/**
 * What the practice view says after fitting a piece to the keyboard, or null when nothing moved.
 * `shift` is the whole-piece shift in semitones; `folded` counts single notes moved by octaves.
 */
export function fitMessage(
  fit: { shift: number; folded: number },
  range: KeyboardRange,
): string | null {
  const keys = keyCount(range);
  const n = fit.folded;
  if (fit.shift === 0) {
    if (n === 0) return null;
    return n === 1
      ? t('1 note moved by octaves to fit your {keys}-key keyboard.', { keys })
      : t('{n} notes moved by octaves to fit your {keys}-key keyboard.', { n, keys });
  }
  const octaves = Math.abs(fit.shift) / 12;
  const up = fit.shift > 0;
  const moved =
    octaves === 1
      ? up
        ? t('Moved up an octave to fit your {keys}-key keyboard', { keys })
        : t('Moved down an octave to fit your {keys}-key keyboard', { keys })
      : up
        ? t('Moved up {octaves} octaves to fit your {keys}-key keyboard', { octaves, keys })
        : t('Moved down {octaves} octaves to fit your {keys}-key keyboard', { octaves, keys });
  if (n === 0) return `${moved}.`;
  return n === 1
    ? `${moved}; ${t('1 note was also moved into range.')}`
    : `${moved}; ${t('{n} notes were also moved into range.', { n })}`;
}

export interface MediaPreferences {
  prefersMoreContrast: boolean;
  prefersReducedMotion: boolean;
}

export interface EffectiveAccessibility {
  largePrint: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  leftHanded: boolean;
}

/** What the app should actually do, after `system` is resolved against the OS preferences. */
export function effectiveAccessibility(
  s: AppSettings,
  media: MediaPreferences,
): EffectiveAccessibility {
  const resolve = (t: TriState, system: boolean) => (t === 'system' ? system : t === 'on');
  return {
    largePrint: s.largePrint,
    highContrast: resolve(s.highContrast, media.prefersMoreContrast),
    reducedMotion: resolve(s.reducedMotion, media.prefersReducedMotion),
    leftHanded: s.leftHanded,
  };
}

/** Scale for text drawn on canvases (keyboard labels, fingering) under large print. */
export function canvasLabelScale(a: Pick<EffectiveAccessibility, 'largePrint'>): number {
  return a.largePrint ? 1.4 : 1;
}

export type PedalAction = 'next' | 'previous' | null;

/**
 * Which way a key press turns the page, or null. Presses with a modifier, repeats and presses in
 * text fields are ignored, so typing and browser shortcuts keep working.
 */
export function pedalAction(
  pedal: PedalSettings,
  event: {
    key: string;
    repeat?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    inTextField?: boolean;
  },
): PedalAction {
  if (!pedal.enabled || event.repeat || event.inTextField) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === pedal.nextKey) return 'next';
  if (event.key === pedal.previousKey) return 'previous';
  return null;
}

/** Keyboard shortcuts shown on the settings page. Keep in step with the practice view. */
export function keyboardShortcuts(): { keys: string; action: string }[] {
  return [
    { keys: t('Space'), action: t('Start or pause playback (not in wait mode)') },
    { keys: 'R', action: t('Start the piece again') },
    {
      keys: 'A W S E D F T G Y H U J K O L P ;',
      action: t('Play notes from C upwards, like piano keys'),
    },
    { keys: 'Z / X', action: t('Move the computer-keyboard octave down / up') },
    { keys: t('Tab / Shift+Tab'), action: t('Move between buttons and controls') },
    {
      keys: t('Pedal keys'),
      action: t('Turn the page forward / back when the foot pedal is switched on'),
    },
  ];
}

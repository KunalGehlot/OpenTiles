// App-wide settings (P2-15 accessibility, language, crash reports), as plain data. Pure: no DOM or
// IndexedDB here, so the rules are unit-tested in Node. The store in ./store.ts persists them.

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
}

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  language: 'en',
  largePrint: false,
  highContrast: 'system',
  reducedMotion: 'system',
  leftHanded: false,
  pedal: Object.freeze({ enabled: false, nextKey: 'ArrowRight', previousKey: 'ArrowLeft' }),
  crashReports: false,
}) as Readonly<AppSettings>;

/** Keys most Bluetooth page-turn pedals send, in the order the settings list offers them. */
export const PEDAL_KEYS: readonly { key: string; label: string }[] = [
  { key: 'ArrowRight', label: 'Right arrow' },
  { key: 'ArrowLeft', label: 'Left arrow' },
  { key: 'ArrowDown', label: 'Down arrow' },
  { key: 'ArrowUp', label: 'Up arrow' },
  { key: 'PageDown', label: 'Page Down' },
  { key: 'PageUp', label: 'Page Up' },
  { key: ' ', label: 'Space' },
  { key: 'Enter', label: 'Enter' },
];

export function pedalKeyLabel(key: string): string {
  return (
    PEDAL_KEYS.find((k) => k.key === key)?.label ?? (key.length === 1 ? key.toUpperCase() : key)
  );
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
  };
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
export const KEYBOARD_SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Start or pause playback (not in wait mode)' },
  { keys: 'R', action: 'Start the piece again' },
  {
    keys: 'A W S E D F T G Y H U J K O L P ;',
    action: 'Play notes from C upwards, like piano keys',
  },
  { keys: 'Z / X', action: 'Move the computer-keyboard octave down / up' },
  { keys: 'Tab / Shift+Tab', action: 'Move between buttons and controls' },
  { keys: 'Pedal keys', action: 'Turn the page forward / back when the foot pedal is switched on' },
];

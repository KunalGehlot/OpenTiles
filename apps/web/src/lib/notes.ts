// Note names: reading those people type ("C4 E4 G#4", "Bb3") and writing them in the style the
// learner chose (P5-03).

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parses space- or comma-separated note names into MIDI pitches; returns null on any error. */
export function parseNoteNames(text: string): number[] | null {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(t);
    if (!m) return null;
    const step = STEPS[(m[1] ?? 'C').toUpperCase()] ?? 0;
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    const pitch = (Number(m[3]) + 1) * 12 + step + acc;
    if (pitch < 21 || pitch > 108) return null;
    if (!out.includes(pitch)) out.push(pitch);
  }
  return out;
}

/** How note names are written (P5-03). Octaves are numbered from middle C = 4 in every style. */
export type NoteLabelStyle = 'letters' | 'german' | 'fixed-do';
/** The setting: a style, or `auto` for the one the app's language uses. */
export type NoteLabelSetting = 'auto' | NoteLabelStyle;

export const NOTE_LABEL_SETTINGS: readonly NoteLabelSetting[] = [
  'auto',
  'letters',
  'german',
  'fixed-do',
];

// Index 0 is C. German: H is B natural, B is B flat; sharps add -is, flats -es (Es, As, Des, Ges).
// Fixed-Do (Italian, French, Spanish): Do Re Mi Fa Sol La Si.
const NAMES: Record<NoteLabelStyle, { sharp: readonly string[]; flat: readonly string[] }> = {
  letters: {
    sharp: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
    flat: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
  },
  german: {
    sharp: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'],
    flat: ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'],
  },
  'fixed-do': {
    sharp: ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
    flat: ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'],
  },
};

/** Spelling of the black keys: as in a sharp key, a flat key, or the usual mix (C♯ E♭ F♯ A♭ B♭). */
export type Spelling = 'sharps' | 'flats' | 'common';
const COMMON_FLATS = new Set([3, 8, 10]);

/** The style an `auto` setting means in the app's language. */
export function labelStyleFor(setting: NoteLabelSetting, language: string): NoteLabelStyle {
  if (setting !== 'auto') return setting;
  return language === 'de' ? 'german' : 'letters';
}

let currentStyle: NoteLabelStyle = 'letters';

/** Called by the settings store when the settings are read or changed, like `setLanguage`. */
export function setNoteLabelStyle(style: NoteLabelStyle): void {
  currentStyle = style;
}

export function noteLabelStyle(): NoteLabelStyle {
  return currentStyle;
}

/** The note's name without an octave: "F♯", "Fis" or "Fa♯", in the chosen style by default. */
export function pitchClassName(
  pitch: number,
  spelling: Spelling = 'sharps',
  style: NoteLabelStyle = currentStyle,
): string {
  const pc = ((Math.round(pitch) % 12) + 12) % 12;
  const flat = spelling === 'flats' || (spelling === 'common' && COMMON_FLATS.has(pc));
  const names = NAMES[style] ?? NAMES.letters;
  return (flat ? names.flat : names.sharp)[pc] ?? '?';
}

/** The name with its octave, middle C being 4: "C4", "B♭3", "H3", "Do4". */
export function noteLabel(
  pitch: number,
  spelling: Spelling = 'common',
  style: NoteLabelStyle = currentStyle,
): string {
  return `${pitchClassName(pitch, spelling, style)}${Math.floor(Math.round(pitch) / 12) - 1}`;
}

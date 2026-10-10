// Parsing note names typed by people ("C4 E4 G#4", "Bb3").

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

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

// German names: H is B natural, B is B flat; sharps add -is, flats -es (Es, As, Des, Ges).
const GERMAN_SHARP_NAMES = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'];
const GERMAN_FLAT_NAMES = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'];

/**
 * The note's letter name without an octave: "C", "F♯" (or "G♭" when `flats`). With `german`, the
 * German names a German learner reads: "Fis", "B" for B♭, "H" for B.
 */
export function pitchClassName(pitch: number, flats = false, german = false): string {
  const names = german
    ? flats
      ? GERMAN_FLAT_NAMES
      : GERMAN_SHARP_NAMES
    : flats
      ? FLAT_NAMES
      : SHARP_NAMES;
  return names[((Math.round(pitch) % 12) + 12) % 12] ?? 'C';
}

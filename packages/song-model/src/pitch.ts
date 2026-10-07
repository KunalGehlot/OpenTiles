// Pitch helpers.

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const MIDDLE_C = 60;
export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;

/** MIDI pitch from a MusicXML step/alter/octave, or null if the step is invalid. */
export function stepToMidi(step: string, alter: number, octave: number): number | null {
  const base = STEP_SEMITONES[step.trim().toUpperCase()];
  if (base === undefined || !Number.isFinite(octave)) return null;
  return (octave + 1) * 12 + base + Math.round(alter);
}

/** Display name, e.g. 61 → "C♯4". */
export function noteName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NAMES[((pitch % 12) + 12) % 12]}${octave}`;
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

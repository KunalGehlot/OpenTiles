// The learner's own keyboard: its size decides which keys the app draws and which notes it can
// ask for (Phase 4). Notes outside the keyboard are moved by octaves so the piece stays playable.
import type { Song } from '@opentiles/song-model';

export interface KeyboardRange {
  /** Lowest key (MIDI). */
  low: number;
  /** Highest key (MIDI). */
  high: number;
}

export interface KeyboardPreset extends KeyboardRange {
  id: string;
  keys: number;
  label: string;
}

/** Common keyboard sizes with their usual lowest and highest keys. */
export const KEYBOARD_PRESETS: readonly KeyboardPreset[] = [
  { id: '25', keys: 25, low: 48, high: 72, label: '25 keys (C3–C5)' },
  { id: '32', keys: 32, low: 41, high: 72, label: '32 keys (F2–C5)' },
  { id: '37', keys: 37, low: 48, high: 84, label: '37 keys (C3–C6)' },
  { id: '49', keys: 49, low: 36, high: 84, label: '49 keys (C2–C6)' },
  { id: '61', keys: 61, low: 36, high: 96, label: '61 keys (C2–C7)' },
  { id: '73', keys: 73, low: 28, high: 100, label: '73 keys (E1–E7)' },
  { id: '76', keys: 76, low: 28, high: 103, label: '76 keys (E1–G7)' },
  { id: '88', keys: 88, low: 21, high: 108, label: '88 keys (A0–C8)' },
];

export const FULL_PIANO: KeyboardRange = { low: 21, high: 108 };

/** A custom keyboard: lowest key plus number of keys (an 86-key board from A0 is A0–A♯7). */
export function customKeyboard(low: number, keys: number): KeyboardRange {
  const lo = Math.max(0, Math.min(127, Math.round(low)));
  const n = Math.max(1, Math.min(128 - lo, Math.round(keys)));
  return { low: lo, high: lo + n - 1 };
}

export function keyCount(range: KeyboardRange): number {
  return range.high - range.low + 1;
}

export function presetById(id: string): KeyboardPreset | undefined {
  return KEYBOARD_PRESETS.find((p) => p.id === id);
}

/** Notes of the song outside the keyboard. */
export function notesOutside(song: Song, range: KeyboardRange): number {
  return song.notes.filter((n) => n.pitch < range.low || n.pitch > range.high).length;
}

/**
 * The octave shift (in semitones, a multiple of 12) that leaves the fewest notes outside the
 * keyboard, preferring no shift, then the smallest.
 */
export function bestOctaveShift(song: Song, range: KeyboardRange): number {
  let best = 0;
  let bestOut = Infinity;
  for (const shift of [0, -12, 12, -24, 24, -36, 36]) {
    const out = song.notes.filter(
      (n) => n.pitch + shift < range.low || n.pitch + shift > range.high,
    ).length;
    if (out < bestOut) {
      best = shift;
      bestOut = out;
    }
  }
  return best;
}

/**
 * Fits a song onto a keyboard: shifts it by whole octaves if that helps, then folds any note
 * still outside into range by octaves. Returns the song unchanged when everything fits.
 */
export function fitToKeyboard(
  song: Song,
  range: KeyboardRange,
): { song: Song; shift: number; folded: number } {
  if (keyCount(range) < 12) return { song, shift: 0, folded: 0 };
  const shift = bestOctaveShift(song, range);
  let folded = 0;
  const notes = song.notes.map((n) => {
    let p = n.pitch + shift;
    if (p < range.low || p > range.high) folded += 1;
    while (p < range.low) p += 12;
    while (p > range.high) p -= 12;
    return p === n.pitch ? n : { ...n, pitch: p };
  });
  if (shift === 0 && folded === 0) return { song, shift: 0, folded: 0 };
  return { song: { ...song, notes }, shift, folded };
}

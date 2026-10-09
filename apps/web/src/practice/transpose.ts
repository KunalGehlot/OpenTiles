// Shifting the piece by semitones during practice (P5-04), for a key that suits the learner's hands
// or a singer. The shift applies to the played song, the score views (Verovio transposes the
// original file by the same amount) and the suggested fingers. Pure, so it is unit-tested in Node.
import { PIANO_HIGH, PIANO_LOW, transpose } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { NotationSource } from '../views/score/notation';
import { t } from '../i18n';

/** An octave either way is as far as the control goes. */
export const MAX_SHIFT = 12;

/**
 * How far the piece can move and keep every note on an 88-key piano: `down` is zero or negative,
 * `up` zero or positive. Notes are never dropped, so the drawn score and the song stay in step.
 */
export function shiftLimits(song: Song): { down: number; up: number } {
  if (song.notes.length === 0) return { down: 0, up: 0 };
  let low = Infinity;
  let high = -Infinity;
  for (const n of song.notes) {
    low = Math.min(low, n.pitch);
    high = Math.max(high, n.pitch);
  }
  return {
    down: Math.min(0, Math.max(-MAX_SHIFT, PIANO_LOW - low)),
    up: Math.max(0, Math.min(MAX_SHIFT, PIANO_HIGH - high)),
  };
}

export function clampShift(song: Song, shift: number): number {
  const { down, up } = shiftLimits(song);
  return Math.min(up, Math.max(down, Math.round(shift)));
}

/** The song moved by `shift` semitones, with its key signature moved too. */
export function shiftSong(song: Song, shift: number): Song {
  return transpose(song, clampShift(song, shift));
}

/** The score drawn in the new key: the import's own transposition plus the shift. */
export function shiftNotation(notation: NotationSource, shift: number): NotationSource {
  if (notation.kind === 'none' || shift === 0) return notation;
  return { ...notation, transpose: notation.transpose + shift };
}

/** "+2", "0", "−3" (with a real minus sign). */
export function shiftLabel(shift: number): string {
  if (shift > 0) return `+${shift}`;
  if (shift < 0) return `−${-shift}`;
  return '0';
}

/** What the practice screen says while the piece is shifted, or null when it is not. */
export function shiftMessage(shift: number): string | null {
  if (shift === 1) return t('Transposed up a semitone.');
  if (shift === -1) return t('Transposed down a semitone.');
  if (shift > 1) return t('Transposed up {n} semitones.', { n: shift });
  if (shift < -1) return t('Transposed down {n} semitones.', { n: -shift });
  return null;
}

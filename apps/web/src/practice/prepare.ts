// The piece as the learner practises it (P4-07, P4-08): moved by octaves to fit their keyboard,
// with fingers suggested, kept as written or hidden. Pure, so it is unit-tested in Node.
import { fitToKeyboard, withFingering } from '@opentiles/practice';
import type { KeyboardRange } from '@opentiles/practice';
import type { Song } from '@opentiles/song-model';
import type { FingeringDisplay } from '../settings/model';

export interface PreparedSong {
  /** What the session plays and listens for: fitted pitches, fingers as chosen. */
  played: Song;
  /** The written pitches (for linking to the drawn score) with the same fingers. */
  score: Song;
  /** Ids of notes whose finger is suggested rather than written. */
  suggested: ReadonlySet<string>;
  /** How the piece was fitted to the keyboard; null when the keyboard follows the piece. */
  fit: { shift: number; folded: number } | null;
}

export function prepareSong(
  song: Song,
  range: KeyboardRange | null,
  fingering: FingeringDisplay,
): PreparedSong {
  const fitted = range ? fitToKeyboard(song, range) : null;
  const base = fitted?.song ?? song;
  const played: Song =
    fingering === 'suggested'
      ? withFingering(base)
      : fingering === 'off'
        ? { ...base, notes: base.notes.map(({ fingering: _, ...n }) => n) }
        : base;
  const suggested = new Set<string>();
  // fitToKeyboard and withFingering keep the notes in order, so index i is the same note.
  const score: Song = {
    ...song,
    notes: song.notes.map((n, i) => {
      const finger = played.notes[i]?.fingering;
      if (finger !== undefined && n.fingering === undefined) suggested.add(n.id);
      if (finger === n.fingering) return n;
      const { fingering: _, ...rest } = n;
      return finger === undefined ? rest : { ...rest, fingering: finger };
    }),
  };
  return {
    played,
    score,
    suggested,
    fit: fitted ? { shift: fitted.shift, folded: fitted.folded } : null,
  };
}

// A sheet's reading as hints for engraving its song (P5-18): the staff each note is printed on,
// its spelling, and the clefs each bar starts with, so the Score tab can show the music the way
// the learner's PDF writes it. Only for a piano's grand staff (two staves a system), the layout
// the hints' staff numbers stand for.
import type { ScoreHints, Song } from '@opentiles/song-model';
import type { NotationReading } from './notes';

export function scoreHints(
  reading: NotationReading,
  song: Pick<Song, 'notes' | 'measures'>,
  barOfMeasure: readonly (number | null)[],
): ScoreHints | null {
  const staves = new Set(reading.heads.flat().map((h) => h.staves));
  if (staves.size !== 1 || !staves.has(2)) return null;
  const notes: ScoreHints['notes'] = {};
  song.notes.forEach((n, i) => {
    const r = reading.notes[i];
    if (!r) return;
    const staff = r.staff === 0 ? 1 : r.staff === 1 ? 2 : undefined;
    notes[n.id] = {
      ...(staff ? { staff } : {}),
      ...(r.spelling ? { step: r.spelling.step, alter: r.spelling.alter } : {}),
    };
  });
  if (Object.keys(notes).length === 0) return null;
  const clefs: ScoreHints['clefs'] = {};
  song.measures.forEach((_, i) => {
    const bar = barOfMeasure[i];
    if (bar == null) return;
    const [upper, lower] = reading.frames[bar]?.start ?? [];
    const bar_: ScoreHints['clefs'][number] = {};
    if (upper?.frame) bar_[1] = upper.frame.clef;
    if (lower?.frame) bar_[2] = lower.frame.clef;
    if (bar_[1] || bar_[2]) clefs[i] = bar_;
  });
  return { notes, clefs };
}

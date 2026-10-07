// Applies the import review screen's choices to a freshly parsed song (spec §8).
import { resplitHands, setBaseTempo, swapHands, transpose } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { ImportSettings } from '../storage/db';

export const DEFAULT_SETTINGS: ImportSettings = { transpose: 0, swapHands: false };

export function applySettings(base: Song, s: ImportSettings): Song {
  let song = base;
  if (s.splitPoint !== undefined && base.format === 'midi') song = resplitHands(song, s.splitPoint);
  if (s.swapHands) song = swapHands(song);
  if (s.transpose) song = transpose(song, s.transpose);
  if (s.baseBpm && s.baseBpm > 0) song = setBaseTempo(song, s.baseBpm);
  return song;
}

export function handCounts(song: Song): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const n of song.notes) {
    if (n.hand === 'left') left += 1;
    else right += 1;
  }
  return { left, right };
}

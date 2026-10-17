// Applies the import review screen's choices to a freshly parsed song (spec §8).
import {
  resplitHands,
  setBaseTempo,
  swapHands,
  transpose,
  trimMeasures,
} from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { ImportSettings } from '../storage/db';

export const DEFAULT_SETTINGS: ImportSettings = { transpose: 0, swapHands: false };

export function applySettings(base: Song, s: ImportSettings): Song {
  let song = base;
  if (s.splitPoint !== undefined && base.format === 'midi') song = resplitHands(song, s.splitPoint);
  if (s.swapHands) song = swapHands(song);
  if (s.transpose) song = transpose(song, s.transpose);
  if (s.baseBpm && s.baseBpm > 0) song = setBaseTempo(song, s.baseBpm);
  if (s.trim) song = trimMeasures(song, s.trim.from, s.trim.to);
  return song;
}

/** The bars to keep, or none to keep every one of a song's `count` bars. */
export function trimFor(from: number, to: number, count: number): ImportSettings['trim'] {
  const first = Math.max(0, Math.min(count - 1, Math.round(from)));
  const last = Math.max(first, Math.min(count - 1, Math.round(to)));
  return first === 0 && last === count - 1 ? undefined : { from: first, to: last };
}

/** Tags typed as a list: split at commas, trimmed, each once, at most 10 of up to 40 characters. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(',')) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === 10) break;
  }
  return tags;
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

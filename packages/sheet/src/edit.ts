// The learner's corrections to a map ("Adjust bars", ADR 0018). Every correction returns a new map
// marked `edited`, which a newer analyser never overwrites.
import type { Song } from '@opentiles/song-model';
import { alignSong } from './align';
import type { SheetBar, SheetMap } from './types';

/**
 * The highlight runs ahead (delta -1) or behind (delta +1) from a measure on: that measure and
 * every one after it move to the bar before or after the one they had.
 */
export function shiftFrom(map: SheetMap, measure: number, delta: number): SheetMap {
  const last = map.layout.bars.length - 1;
  return {
    ...map,
    barOfMeasure: map.barOfMeasure.map((bar, i) =>
      i < measure || bar === null ? bar : Math.min(last, Math.max(0, bar + delta)),
    ),
    edited: true,
  };
}

/** The bar at a point of a page (points from the top-left), or -1. */
export function barAt(map: SheetMap, page: number, x: number, y: number, margin = 0): number {
  return map.layout.bars.findIndex(
    (b) =>
      b.page === page &&
      x >= b.box.x - margin &&
      x <= b.box.x + b.box.width + margin &&
      y >= b.box.y - margin &&
      y <= b.box.y + b.box.height + margin,
  );
}

/**
 * The barline between a bar and the next one in the same system, when a point is within
 * `tolerance` of it: the bar before it, or -1.
 */
export function barlineAt(
  map: SheetMap,
  page: number,
  x: number,
  y: number,
  tolerance: number,
): number {
  const bars = map.layout.bars;
  for (let i = 0; i + 1 < bars.length; i++) {
    const a = bars[i] as SheetBar;
    const b = bars[i + 1] as SheetBar;
    if (a.page !== page || b.page !== page || a.system !== b.system) continue;
    if (y < a.box.y - tolerance || y > a.box.y + a.box.height + tolerance) continue;
    const line = (a.box.x + a.box.width + b.box.x) / 2;
    if (Math.abs(x - line) <= tolerance) return i;
  }
  return -1;
}

function realign(
  map: SheetMap,
  bars: SheetBar[],
  song: Pick<Song, 'measures' | 'notes'>,
): SheetMap {
  const layout = { ...map.layout, bars };
  return { ...map, layout, barOfMeasure: alignSong(layout, song).barOfMeasure, edited: true };
}

/**
 * A barline the detection missed: splits a bar at x (its note heads shared out by width) and
 * matches the song to the bars again.
 */
export function addBarline(
  map: SheetMap,
  song: Pick<Song, 'measures' | 'notes'>,
  barIndex: number,
  x: number,
): SheetMap {
  const bar = map.layout.bars[barIndex];
  if (!bar || x <= bar.box.x || x >= bar.box.x + bar.box.width) return map;
  const share = (x - bar.box.x) / bar.box.width;
  const left: SheetBar = {
    ...bar,
    box: { ...bar.box, width: x - bar.box.x },
    end: 'single',
  };
  const right: SheetBar = {
    ...bar,
    box: { ...bar.box, x, width: bar.box.x + bar.box.width - x },
    start: 'single',
  };
  delete right.firstNoteX;
  if (bar.firstNoteX !== undefined && bar.firstNoteX >= x) {
    delete left.firstNoteX;
    right.firstNoteX = bar.firstNoteX;
  }
  if (bar.heads !== undefined) {
    left.heads = Math.round(bar.heads * share);
    right.heads = bar.heads - left.heads;
  }
  const bars = [...map.layout.bars];
  bars.splice(barIndex, 1, left, right);
  return realign(map, bars, song);
}

/** A barline that is not one: joins a bar with the next one of its system and matches again. */
export function removeBarline(
  map: SheetMap,
  song: Pick<Song, 'measures' | 'notes'>,
  barIndex: number,
): SheetMap {
  const a = map.layout.bars[barIndex];
  const b = map.layout.bars[barIndex + 1];
  if (!a || !b || a.page !== b.page || a.system !== b.system) return map;
  const merged: SheetBar = {
    ...a,
    box: { ...a.box, width: b.box.x + b.box.width - a.box.x },
    end: b.end,
  };
  if (a.heads !== undefined || b.heads !== undefined)
    merged.heads = (a.heads ?? 0) + (b.heads ?? 0);
  if (merged.firstNoteX === undefined && b.firstNoteX !== undefined)
    merged.firstNoteX = b.firstNoteX;
  if (merged.ending === undefined && b.ending !== undefined) merged.ending = b.ending;
  const bars = [...map.layout.bars];
  bars.splice(barIndex, 2, merged);
  return realign(map, bars, song);
}

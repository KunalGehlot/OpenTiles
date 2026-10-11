import type { SheetBar, SheetMap } from './types';

/** The written bar a song measure is played from, or null when the map has none for it. */
export function barForMeasure(map: SheetMap, measureIndex: number): SheetBar | null {
  const bar = map.barOfMeasure[measureIndex];
  return bar == null ? null : (map.layout.bars[bar] ?? null);
}

import { ANALYSER_VERSION } from './align';
import type { SheetBar, SheetMap } from './types';

/** The written bar a song measure is played from, or null when the map has none for it. */
export function barForMeasure(map: SheetMap, measureIndex: number): SheetBar | null {
  const bar = map.barOfMeasure[measureIndex];
  return bar == null ? null : (map.layout.bars[bar] ?? null);
}

/**
 * What a stored map needs before it can be used with a song of `measures` measures: nothing, a new
 * alignment of the bars already found (the song changed, say a MIDI file was added to a sheet-only
 * piece), or a whole new analysis (none yet, or an older analyser's that nobody corrected).
 */
export function needsAnalysis(
  map: SheetMap | undefined,
  measures: number,
): 'none' | 'align' | 'analyse' {
  if (!map || (!map.edited && map.analyser < ANALYSER_VERSION)) return 'analyse';
  if (map.barOfMeasure.length !== measures) return 'align';
  return 'none';
}

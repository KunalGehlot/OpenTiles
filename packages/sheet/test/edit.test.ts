// The learner's corrections to a map ("Adjust bars").
import { describe, expect, it } from 'vitest';
import type { Measure, SongNote } from '@opentiles/song-model';
import { addBarline, barAt, barlineAt, buildSheetMap, removeBarline, shiftFrom } from '../src';
import type { SheetBar, SheetLayout, SheetMap } from '../src';

const bar = (x: number, width: number, heads: number, system = 0): SheetBar => ({
  page: 0,
  system,
  box: { x, y: 100 + system * 100, width, height: 60 },
  start: 'single',
  end: 'single',
  heads,
});

function songOf(counts: readonly number[]) {
  const measures: Measure[] = [];
  const notes: SongNote[] = [];
  counts.forEach((count, index) => {
    measures.push({
      index,
      number: String(index + 1),
      sourceIndex: index,
      startBeat: index * 4,
      lengthBeats: 4,
    });
    for (let k = 0; k < count; k++) {
      notes.push({
        id: `n${notes.length}`,
        pitch: 60,
        startBeat: index * 4 + (k * 4) / count,
        durationBeats: 0.5,
        hand: 'right',
        staff: 1,
        voice: 1,
        part: 0,
        measureIndex: index,
        sourceRefs: [],
      });
    }
  });
  return { measures, notes };
}

const layout = (bars: SheetBar[]): SheetLayout => ({
  pages: [{ width: 595, height: 842 }],
  bars,
  source: 'vector',
});

describe('shiftFrom', () => {
  const map: SheetMap = {
    layout: layout([bar(40, 100, 4), bar(140, 100, 4), bar(240, 100, 4), bar(340, 100, 4)]),
    barOfMeasure: [0, 1, 2, null, 3],
    edited: false,
    analyser: 1,
  };

  it('moves the highlight a bar on or back from a measure, and marks the map as corrected', () => {
    const behind = shiftFrom(map, 1, 1);
    expect(behind.barOfMeasure).toEqual([0, 2, 3, null, 3]);
    expect(behind.edited).toBe(true);
    expect(shiftFrom(map, 2, -1).barOfMeasure).toEqual([0, 1, 1, null, 2]);
    // The original stays as it was.
    expect(map.barOfMeasure).toEqual([0, 1, 2, null, 3]);
  });

  it('stays within the bars', () => {
    expect(shiftFrom(map, 0, -1).barOfMeasure).toEqual([0, 0, 1, null, 2]);
  });
});

describe('barlines', () => {
  it('adds a missed barline and matches the song again', () => {
    const song = songOf([4, 5, 4, 3]);
    // The detection merged bars 1 and 2.
    const map = buildSheetMap(layout([bar(40, 100, 4), bar(140, 200, 9), bar(340, 100, 3)]), song);
    expect(map.barOfMeasure).toEqual([0, 1, 1, 2]);
    const fixed = addBarline(map, song, 1, 240);
    expect(fixed.layout.bars.map((b) => [b.box.x, b.box.width])).toEqual([
      [40, 100],
      [140, 100],
      [240, 100],
      [340, 100],
    ]);
    expect(fixed.barOfMeasure).toEqual([0, 1, 2, 3]);
    expect(fixed.edited).toBe(true);
  });

  it('removes a barline that is not one and matches the song again', () => {
    const song = songOf([4, 6, 5]);
    const map = buildSheetMap(
      layout([bar(40, 100, 4), bar(140, 50, 3), bar(190, 50, 3), bar(240, 100, 5)]),
      song,
    );
    const fixed = removeBarline(map, song, 1);
    expect(fixed.layout.bars).toHaveLength(3);
    expect(fixed.layout.bars[1]?.box).toEqual({ x: 140, y: 100, width: 100, height: 60 });
    expect(fixed.layout.bars[1]?.heads).toBe(6);
    expect(fixed.barOfMeasure).toEqual([0, 1, 2]);
  });

  it('never joins bars of different systems', () => {
    const song = songOf([4, 4]);
    const map = buildSheetMap(layout([bar(40, 100, 4, 0), bar(40, 100, 4, 1)]), song);
    expect(removeBarline(map, song, 0)).toBe(map);
  });

  it('finds the bar and the barline under a tap', () => {
    const map = buildSheetMap(
      layout([bar(40, 100, 4), bar(140, 100, 4), bar(40, 100, 4, 1)]),
      songOf([4, 4, 4]),
    );
    expect(barAt(map, 0, 150, 120)).toBe(1);
    expect(barAt(map, 0, 100, 220)).toBe(2);
    expect(barAt(map, 1, 150, 120)).toBe(-1);
    expect(barlineAt(map, 0, 142, 130, 4)).toBe(0);
    expect(barlineAt(map, 0, 170, 130, 4)).toBe(-1);
    // The end of a system is not a barline between two bars.
    expect(barlineAt(map, 0, 240, 130, 4)).toBe(-1);
  });
});

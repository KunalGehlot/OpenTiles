import { describe, expect, it } from 'vitest';
import { ANALYSER_VERSION, barForMeasure, needsAnalysis } from '../src';
import type { SheetBar, SheetMap } from '../src';

const bar = (system: number, x: number): SheetBar => ({
  page: 0,
  system,
  box: { x, y: 100, width: 120, height: 80 },
  start: 'single',
  end: 'single',
});

describe('barForMeasure', () => {
  // Two written bars with a repeat: the song plays bar 0, bar 1, bar 0 again.
  const map: SheetMap = {
    layout: {
      pages: [{ width: 595, height: 842 }],
      bars: [bar(0, 40), bar(0, 160)],
      source: 'manual',
    },
    barOfMeasure: [0, 1, 0, null],
    edited: false,
    analyser: 1,
  };

  it('finds the written bar of each played measure, repeats included', () => {
    expect(barForMeasure(map, 0)?.box.x).toBe(40);
    expect(barForMeasure(map, 1)?.box.x).toBe(160);
    expect(barForMeasure(map, 2)?.box.x).toBe(40);
  });

  it('gives null for unmatched or missing measures', () => {
    expect(barForMeasure(map, 3)).toBeNull();
    expect(barForMeasure(map, 9)).toBeNull();
  });
});

describe('needsAnalysis', () => {
  const map: SheetMap = {
    layout: { pages: [], bars: [], source: 'vector' },
    barOfMeasure: [0, 1],
    edited: false,
    analyser: ANALYSER_VERSION,
  };

  it('analyses a sheet without a map, and redoes an older analyser’s map nobody corrected', () => {
    expect(needsAnalysis(undefined, 2)).toBe('analyse');
    expect(needsAnalysis({ ...map, analyser: ANALYSER_VERSION - 1 }, 2)).toBe('analyse');
    expect(needsAnalysis(map, 2)).toBe('none');
  });

  it('keeps a corrected map, and only matches its bars again when the song changed', () => {
    const edited = { ...map, edited: true, analyser: ANALYSER_VERSION - 1 };
    expect(needsAnalysis(edited, 2)).toBe('none');
    // Notes added to a sheet-only piece: the corrected bars stay, the song is matched again.
    expect(needsAnalysis({ ...edited, barOfMeasure: [] }, 2)).toBe('align');
    expect(needsAnalysis(map, 3)).toBe('align');
  });
});

import { describe, expect, it } from 'vitest';
import { barForMeasure } from '../src';
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

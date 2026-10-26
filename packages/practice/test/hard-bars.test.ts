// Hard bars (P7-28): runs kept as bar ranges and problem counts, a bar hard in 2 of the last 3
// runs that played it, and loops around the hard bars.
import { describe, expect, it } from 'vitest';
import {
  addBarRun,
  barRunOf,
  hardBarLoops,
  hardBars,
  MAX_BAR_RUNS,
  normaliseBarRuns,
} from '../src';
import type { BarRun } from '../src';

const run = (
  at: number,
  from: number,
  to: number,
  problems: Record<string, number> = {},
): BarRun => ({
  at,
  fromMeasure: from,
  toMeasure: to,
  problems,
});

describe('keeping a run', () => {
  it('keeps the bars with problems inside the range, adding up repeats', () => {
    const r = barRunOf(5, { fromMeasure: 2, toMeasure: 6 }, [
      { measureIndex: 3, problems: 2 },
      { measureIndex: 3, problems: 1 },
      { measureIndex: 4, problems: 0 },
      { measureIndex: 9, problems: 4 },
    ]);
    expect(r).toEqual(run(5, 2, 6, { 3: 3 }));
  });

  it(`keeps the last ${MAX_BAR_RUNS} runs`, () => {
    let runs: BarRun[] = [];
    for (let i = 0; i < 12; i++) runs = addBarRun(runs, run(i, 0, 9));
    expect(runs).toHaveLength(MAX_BAR_RUNS);
    expect(runs[0]?.at).toBe(2);
  });

  it('reads back only well-formed runs, oldest first', () => {
    const stored = [
      run(2, 0, 9, { 3: 1 }),
      { at: 1, fromMeasure: 0, toMeasure: 9, problems: { 4: 2, x: 1, 5: -1, 6: 0 } },
      { at: 3, fromMeasure: 5, toMeasure: 2, problems: {} },
      'nonsense',
      { at: Number.NaN, fromMeasure: 0, toMeasure: 1 },
    ];
    expect(normaliseBarRuns(stored)).toEqual([run(1, 0, 9, { 4: 2 }), run(2, 0, 9, { 3: 1 })]);
    expect(normaliseBarRuns(undefined)).toEqual([]);
  });
});

describe('hard bars', () => {
  it('are bars with problems in 2 of the last 3 runs that played them', () => {
    expect(hardBars([run(1, 0, 9, { 3: 2, 5: 1 }), run(2, 0, 9, { 3: 1 })])).toEqual([3]);
  });

  it('count only the runs that played the bar', () => {
    const runs = [
      run(1, 0, 9, { 1: 1 }),
      run(2, 5, 8),
      run(3, 5, 8),
      run(4, 5, 8),
      run(5, 0, 9, { 1: 2 }),
    ];
    expect(hardBars(runs)).toEqual([1]);
  });

  it('stop being hard after clean runs', () => {
    const runs = [run(1, 0, 9, { 3: 1 }), run(2, 0, 9, { 3: 1 }), run(3, 0, 9), run(4, 0, 9)];
    expect(hardBars(runs.slice(0, 2))).toEqual([3]);
    expect(hardBars(runs)).toEqual([]);
  });
});

describe('loops around hard bars', () => {
  it('add a bar either side, stay inside the piece and join ranges that touch', () => {
    expect(hardBarLoops([9, 0, 4], 9)).toEqual([
      { fromMeasure: 0, toMeasure: 1 },
      { fromMeasure: 3, toMeasure: 5 },
      { fromMeasure: 8, toMeasure: 9 },
    ]);
    expect(hardBarLoops([2, 5], 9)).toEqual([{ fromMeasure: 1, toMeasure: 6 }]);
    expect(hardBarLoops([], 9)).toEqual([]);
  });
});

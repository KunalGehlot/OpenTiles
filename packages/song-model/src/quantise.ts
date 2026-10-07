// MIDI quantiser (spec §8): snap onsets to the coarsest grid that keeps at least 95 % of notes
// within ±30 ms of where they were played.
//
// "Coarsest" is our reading of the spec's "smallest note value that keeps 95 %": the simplest
// grid that still respects the performance, so notation and practice steps stay readable.
import type { TempoMap } from './tempo';

/** Candidate grids in beats, coarse to fine. Each finer grid contains the coarser ones it
 * follows where it matters (1/6 ⊃ 1/2, 1/3; 1/12 ⊃ 1/4, 1/3; …). */
export const GRIDS = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8, 1 / 12, 1 / 16, 1 / 24, 1 / 32];

export interface Timed {
  startBeat: number;
  durationBeats: number;
}

export interface QuantiseResult {
  /** Chosen grid in beats. */
  grid: number;
  /** Share of onsets within tolerance at that grid. */
  withinTolerance: number;
  notes: Timed[];
}

const snap = (beat: number, grid: number) => Math.round(beat / grid) * grid;

export function quantise(
  notes: readonly Timed[],
  tempo: TempoMap,
  toleranceSeconds = 0.03,
  requiredShare = 0.95,
): QuantiseResult {
  const share = (grid: number) => {
    if (notes.length === 0) return 1;
    let ok = 0;
    for (const n of notes) {
      const snapped = snap(n.startBeat, grid);
      const err = Math.abs(tempo.beatToSeconds(snapped) - tempo.beatToSeconds(n.startBeat));
      if (err <= toleranceSeconds + 1e-9) ok += 1;
    }
    return ok / notes.length;
  };
  let grid = GRIDS[GRIDS.length - 1] as number;
  let within = share(grid);
  for (const g of GRIDS) {
    const s = share(g);
    if (s >= requiredShare) {
      grid = g;
      within = s;
      break;
    }
  }
  return {
    grid,
    withinTolerance: within,
    notes: notes.map((n) => {
      const start = snap(n.startBeat, grid);
      const end = snap(n.startBeat + n.durationBeats, grid);
      return { startBeat: start, durationBeats: Math.max(grid, end - start) };
    }),
  };
}

// Loop a section (PLAN.md P2-08, spec §4): practise a range of bars over and over, optionally
// speeding up by 5 % after every clean run until the score tempo is reached.
import type { Song } from '@opentiles/song-model';

/** A range of bars, by index into `Song.measures` (both ends included). */
export interface LoopRange {
  fromMeasure: number;
  toMeasure: number;
}

const EPS = 1e-6;

/** Index of the bar that contains `beat` (the first or last bar outside the piece). */
export function measureAtBeat(song: Song, beat: number): number {
  const ms = song.measures;
  if (ms.length === 0) return 0;
  let index = 0;
  for (const m of ms) {
    if (m.startBeat <= beat + EPS) index = m.index;
    else break;
  }
  return index;
}

/** Orders and clamps two bar indices into a valid range. */
export function normaliseLoop(song: Song, a: number, b: number): LoopRange {
  const last = Math.max(0, song.measures.length - 1);
  const clamp = (x: number) => Math.min(last, Math.max(0, Math.round(x)));
  const [from, to] = [clamp(a), clamp(b)].sort((x, y) => x - y) as [number, number];
  return { fromMeasure: from, toMeasure: to };
}

/** The bars touched by a drag between two beat positions. */
export function loopFromBeats(song: Song, beatA: number, beatB: number): LoopRange {
  return normaliseLoop(song, measureAtBeat(song, beatA), measureAtBeat(song, beatB));
}

/** The beat span `[fromBeat, toBeat)` a range covers. */
export function loopBeats(song: Song, range: LoopRange): { fromBeat: number; toBeat: number } {
  const r = normaliseLoop(song, range.fromMeasure, range.toMeasure);
  const from = song.measures[r.fromMeasure];
  const to = song.measures[r.toMeasure];
  if (!from || !to) return { fromBeat: 0, toBeat: song.lengthBeats };
  return { fromBeat: from.startBeat, toBeat: to.startBeat + to.lengthBeats };
}

export interface LoopRun {
  /** Wrong notes: played where nothing (or something else) was expected. */
  wrong: number;
  /** Expected notes never played. */
  missed: number;
  /** 0–1. */
  accuracy: number;
}

/** A clean run has no wrong and no missed notes; early or late notes still count as played. */
export function isCleanRun(run: Pick<LoopRun, 'wrong' | 'missed'>): boolean {
  return run.wrong === 0 && run.missed === 0;
}

export interface LoopTrainerOptions {
  /** Raise the tempo after each clean run. */
  autoTempo?: boolean;
  /** Tempo increase per clean run, as a fraction of the score tempo (0.05 = 5 %). */
  step?: number;
  /** The tempo the increase stops at (1 = the score tempo). */
  ceiling?: number;
}

export interface LoopRunOutcome {
  run: number;
  clean: boolean;
  /** Clean runs in a row, including this one. */
  streak: number;
  /** The tempo for the next run. */
  tempo: number;
  raised: boolean;
}

/** The tempo after a run: +step after a clean run, never past the ceiling, never lowered. */
export function nextLoopTempo(
  tempo: number,
  clean: boolean,
  options: LoopTrainerOptions = {},
): number {
  const step = options.step ?? 0.05;
  const ceiling = options.ceiling ?? 1;
  if (!clean || !options.autoTempo || tempo >= ceiling - EPS) return tempo;
  // Round to whole percent so repeated additions don't drift (0.5 + 0.05 * 3 = 0.6499…).
  return Math.min(ceiling, Math.round((tempo + step) * 100) / 100);
}

/** Counts loop runs and decides the next tempo. */
export class LoopTrainer {
  runs = 0;
  cleanRuns = 0;
  streak = 0;
  last: LoopRun | null = null;

  constructor(public options: LoopTrainerOptions = {}) {}

  record(run: LoopRun, tempo: number): LoopRunOutcome {
    const clean = isCleanRun(run);
    this.runs += 1;
    this.last = run;
    if (clean) {
      this.cleanRuns += 1;
      this.streak += 1;
    } else {
      this.streak = 0;
    }
    const next = nextLoopTempo(tempo, clean, this.options);
    return { run: this.runs, clean, streak: this.streak, tempo: next, raised: next > tempo };
  }

  reset(): void {
    this.runs = 0;
    this.cleanRuns = 0;
    this.streak = 0;
    this.last = null;
  }
}

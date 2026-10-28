// Hard bars of a piece (P7-28, ADR 0026): the bars that went wrong in several recent runs, not
// only in the last one, so the score can mark them and "Practise the hard bars" can loop them.
// A piece keeps its last runs as bar indices and problem counts only, never notes. Pure; the app
// stores the value with the piece's progress.
import type { LoopRange } from './loop';

/** One finished run: which bars it played and how many problems each had. */
export interface BarRun {
  /** Milliseconds since 1970. */
  at: number;
  /** The bars the run played, by index into `Song.measures`, both ends included. */
  fromMeasure: number;
  toMeasure: number;
  /**
   * Missed and wrong notes per bar index, not early or late ones (Q7); bars without any are left
   * out. Keys are bar indices written as `String(index)`.
   */
  problems: Record<string, number>;
}

/** Runs kept per piece. */
export const MAX_BAR_RUNS = 10;
/** A bar is hard when at least `HARD_IN` of the last `HARD_OF` runs that played it had problems. */
export const HARD_IN = 2;
export const HARD_OF = 3;

const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Runs from anything stored, keeping only well-formed ones, oldest first. Bar keys come back as
 * `hardBars` looks them up (`"03"` becomes `"3"`), and problems outside the run's bars are dropped,
 * as `barRunOf` drops them.
 */
export function normaliseBarRuns(value: unknown): BarRun[] {
  if (!Array.isArray(value)) return [];
  const out: BarRun[] = [];
  for (const r of value) {
    if (typeof r !== 'object' || r === null) continue;
    const x = r as Record<string, unknown>;
    if (typeof x.at !== 'number' || !Number.isFinite(x.at)) continue;
    if (!isIndex(x.fromMeasure) || !isIndex(x.toMeasure) || x.toMeasure < x.fromMeasure) continue;
    const problems: Record<string, number> = {};
    if (typeof x.problems === 'object' && x.problems !== null) {
      for (const [key, n] of Object.entries(x.problems)) {
        const bar = Number(key);
        if (!isIndex(bar) || bar < x.fromMeasure || bar > x.toMeasure) continue;
        if (isIndex(n) && n > 0) problems[String(bar)] = (problems[String(bar)] ?? 0) + n;
      }
    }
    out.push({ at: x.at, fromMeasure: x.fromMeasure, toMeasure: x.toMeasure, problems });
  }
  return out.sort((a, b) => a.at - b.at).slice(-MAX_BAR_RUNS);
}

/**
 * The run as it is kept, from the bars it played and its problems per bar (all of them, not only
 * the three the summary shows). The caller counts missed and wrong notes only (P7-29). Problems
 * outside the range are dropped.
 */
export function barRunOf(
  at: number,
  range: LoopRange,
  problems: Iterable<{ measureIndex: number; problems: number }>,
): BarRun {
  const kept: Record<string, number> = {};
  for (const p of problems) {
    if (
      p.problems > 0 &&
      p.measureIndex >= range.fromMeasure &&
      p.measureIndex <= range.toMeasure
    ) {
      kept[p.measureIndex] = (kept[p.measureIndex] ?? 0) + p.problems;
    }
  }
  return { at, fromMeasure: range.fromMeasure, toMeasure: range.toMeasure, problems: kept };
}

/** The runs with one added, the oldest dropped past `MAX_BAR_RUNS`. */
export function addBarRun(runs: readonly BarRun[], run: BarRun): BarRun[] {
  return [...runs, run].slice(-MAX_BAR_RUNS);
}

/**
 * The hard bars, in order. Only runs that played a bar count for it, so a run from bar 5 says
 * nothing about bar 1, and a bar stops being hard once enough recent runs got through it cleanly.
 */
export function hardBars(runs: readonly BarRun[]): number[] {
  const bars = new Set<number>();
  for (const r of runs) for (const bar of Object.keys(r.problems)) bars.add(Number(bar));
  const hard: number[] = [];
  for (const bar of bars) {
    const recent = runs.filter((r) => r.fromMeasure <= bar && bar <= r.toMeasure).slice(-HARD_OF);
    const withProblems = recent.filter((r) => (r.problems[bar] ?? 0) > 0).length;
    if (withProblems >= HARD_IN) hard.push(bar);
  }
  return hard.sort((a, b) => a - b);
}

/**
 * Loop ranges that cover the hard bars with one bar either side for the run-in and the way out;
 * ranges that touch are joined. `lastMeasure` is the piece's last bar index.
 */
export function hardBarLoops(bars: readonly number[], lastMeasure: number): LoopRange[] {
  const out: LoopRange[] = [];
  for (const bar of [...bars].sort((a, b) => a - b)) {
    const from = Math.max(0, bar - 1);
    const to = Math.min(lastMeasure, bar + 1);
    const prev = out[out.length - 1];
    if (prev && from <= prev.toMeasure + 1) prev.toMeasure = Math.max(prev.toMeasure, to);
    else out.push({ fromMeasure: from, toMeasure: to });
  }
  return out;
}

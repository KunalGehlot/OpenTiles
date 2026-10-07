// After-run summary (spec §4 "Feedback and motivation").
import type { NoteResult } from './play-along';

export interface RunSummary {
  notes: number;
  hit: number;
  early: number;
  late: number;
  missed: number;
  extra: number;
  /** Share of notes played (hit, early or late), 0–1. Extra notes count against it. */
  accuracy: number;
  /** Mean absolute timing offset of played notes, ms. */
  meanOffsetMs: number;
  /** Measures with the most problems (missed, extra, or off-time), worst first. */
  hardestMeasures: { measureIndex: number; problems: number }[];
}

export function summarise(
  results: readonly NoteResult[],
  extras: readonly { measureIndex?: number }[] = [],
  limit = 3,
): RunSummary {
  const count = (j: NoteResult['judgement']) => results.filter((r) => r.judgement === j).length;
  const played = results.filter((r) => r.judgement !== 'missed');
  const notes = results.length;
  const problems = new Map<number, number>();
  const bump = (m: number | undefined) => {
    if (m !== undefined) problems.set(m, (problems.get(m) ?? 0) + 1);
  };
  for (const r of results) if (r.judgement !== 'hit') bump(r.note.measureIndex);
  for (const e of extras) bump(e.measureIndex);
  const accuracy = notes === 0 ? 0 : Math.max(0, (played.length - extras.length * 0.5) / notes);
  return {
    notes,
    hit: count('hit'),
    early: count('early'),
    late: count('late'),
    missed: count('missed'),
    extra: extras.length,
    accuracy,
    meanOffsetMs:
      played.length === 0
        ? 0
        : (played.reduce((s, r) => s + Math.abs(r.offset ?? 0), 0) / played.length) * 1000,
    hardestMeasures: [...problems.entries()]
      .map(([measureIndex, n]) => ({ measureIndex, problems: n }))
      .sort((a, b) => b.problems - a.problems || a.measureIndex - b.measureIndex)
      .slice(0, limit),
  };
}

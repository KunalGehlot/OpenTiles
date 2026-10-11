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

// --- MIDI written by notation software ---------------------------------------------------------
//
// A file exported from a score (MuseScore, Sibelius, …) has every onset exactly on a beat
// division, but notes end early (MuseScore plays about 95 % of each value), rolled chords start a
// few ticks apart, and a few per cent of the notes are triplets or 32nds. The 95 % rule above
// would snap those few to a coarser grid, and its tolerance in seconds depends on the tempo, so a
// fast passage lets a coarse grid through. Such files are quantised in ticks instead: the rhythm
// comes from the score, never from the tempo map.

/** Beat divisions a score writes onsets on: binary down to 1/32, triplets down to 1/24. */
const NOTATED_DIVISIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export interface TickNote {
  track: number;
  pitch: number;
  startTick: number;
  endTick: number;
}

/** The coarsest division of the beat `tick` sits on exactly, or undefined. */
function divisionOf(tick: number, ppq: number): number | undefined {
  return NOTATED_DIVISIONS.find((k) => (tick * k) % ppq === 0);
}

/**
 * True when nearly every onset sits exactly on a beat division, as in a file exported from
 * notation software. Played files at 480 ticks per beat land there about one time in ten by
 * chance.
 */
export function looksNotated(notes: readonly { startTick: number }[], ppq: number): boolean {
  if (notes.length === 0 || ppq < 24) return false;
  const exact = notes.filter((n) => divisionOf(n.startTick, ppq) !== undefined).length;
  return exact / notes.length >= 0.9;
}

/**
 * Quantises a notated file in ticks. Onsets on a beat division are kept. An onset off them joins
 * the chord it is rolled from (a note of the same track that starts up to half a beat earlier and
 * ends with it), or moves to the nearest division. Each end moves to the value the note was
 * written as: a division point at or a little after the sounding end.
 */
export function quantiseNotated(notes: readonly TickNote[], ppq: number): Timed[] {
  const divisions = NOTATED_DIVISIONS.filter((k) => ppq % k === 0);
  /** 0 for a beat, 1 for a half beat, 2 for triplets and quarters of a beat, and so on. */
  const level = (tick: number) => {
    const k = divisionOf(tick, ppq) ?? 64;
    return k === 1 ? 0 : k === 2 ? 1 : k <= 4 ? 2 : k <= 8 ? 3 : k <= 16 ? 4 : 5;
  };
  const finest = divisions[divisions.length - 1] ?? 1;
  const nearest = (tick: number) => {
    let best = Math.round(tick / ppq) * ppq;
    for (const k of divisions) {
      const step = ppq / k;
      const t = Math.round(tick / step) * step;
      if (Math.abs(t - tick) < Math.abs(best - tick)) best = t;
    }
    return best;
  };

  // Note indices per track, by onset.
  const byTrack = new Map<number, number[]>();
  notes.forEach((n, i) => {
    const list = byTrack.get(n.track) ?? [];
    list.push(i);
    byTrack.set(n.track, list);
  });
  for (const list of byTrack.values()) {
    list.sort((a, b) => (notes[a]?.startTick ?? 0) - (notes[b]?.startTick ?? 0));
  }
  const slack = Math.max(2, Math.round(ppq / 96));
  const starts = notes.map((n) => {
    if (divisionOf(n.startTick, ppq) !== undefined) return n.startTick;
    let rolledFrom: number | undefined;
    for (const j of byTrack.get(n.track) ?? []) {
      const m = notes[j] as TickNote;
      if (m.startTick < n.startTick - ppq / 2) continue;
      if (m.startTick >= n.startTick) break;
      if (Math.abs(m.endTick - n.endTick) <= slack && divisionOf(m.startTick, ppq) !== undefined) {
        rolledFrom = m.startTick;
        break;
      }
    }
    return rolledFrom ?? nearest(n.startTick);
  });

  // The next strike of the same key in the same track, by quantised onset.
  const nextStrike = new Map<number, number>();
  const sameKey = new Map<string, number[]>();
  notes.forEach((n, i) => {
    const key = `${n.track}:${n.pitch}`;
    const list = sameKey.get(key) ?? [];
    list.push(i);
    sameKey.set(key, list);
  });
  for (const list of sameKey.values()) {
    list.sort((a, b) => (starts[a] ?? 0) - (starts[b] ?? 0));
    list.forEach((i, j) => {
      const later = list.slice(j + 1).find((k) => (starts[k] ?? 0) > (starts[i] ?? 0));
      if (later !== undefined) nextStrike.set(i, starts[later] ?? 0);
    });
  }

  return notes.map((n, i) => {
    const start = starts[i] ?? n.startTick;
    // How long the note sounded from its written onset (a rolled note from the chord's onset).
    const sounding = n.endTick - Math.min(start, n.startTick);
    // Candidate written ends: division points from the sounding end up to the end of a value
    // sounded at 85 %. Notes sound for about 95 % of their value, or all of it when legato; the
    // end that fits that best wins, with a small cost for each finer division, so a long note
    // ends on a beat rather than on the 1/32 point that happens to fit 95 % exactly.
    let end: number | undefined;
    let bestCost = Infinity;
    const from = start + sounding - slack;
    const to = start + sounding / 0.85;
    for (const k of divisions) {
      const step = ppq / k;
      const first = Math.max(Math.ceil(from / step), Math.floor(start / step) + 1) * step;
      for (let t = first; t <= to; t += step) {
        const gate = sounding / (t - start);
        const fit = Math.min(Math.abs(gate - 0.95), Math.abs(gate - 1));
        const cost = fit + 0.01 * level(t);
        if (cost < bestCost - 1e-12) {
          end = t;
          bestCost = cost;
        }
      }
    }
    end ??= Math.max(start + ppq / finest, nearest(n.endTick));
    // A note never runs into the next strike of the same key.
    const next = nextStrike.get(i);
    if (next !== undefined && next < end) end = next;
    return { startBeat: start / ppq, durationBeats: (end - start) / ppq };
  });
}

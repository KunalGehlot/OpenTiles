// Which written bar each of the song's measures is played from (ADR 0018). The song's measures are
// in playback order (a MIDI file plays repeats out), the sheet writes a repeated passage once. The
// written bars are unrolled by their repeat signs and endings into candidate playback orders; each
// is aligned with the song by a monotonic alignment that compares the notes of each measure with
// the note heads of each bar and tolerates a missed or extra barline, a multi-bar rest or a
// missing pickup; the cheapest alignment wins.
import { playbackOrder } from '@opentiles/song-model';
import type { RepeatMarks, Song } from '@opentiles/song-model';
import type { SheetBar, SheetLayout, SheetMap } from './types';

/**
 * Version of the analysis (bar detection and alignment). Raise it when either improves: maps made
 * by an older version are redone unless the learner corrected them.
 */
// 2 (P5-18): the map also keeps how the sheet writes the song (`SheetMap.score`).
export const ANALYSER_VERSION = 2;

/**
 * Note heads each measure should show: the notes that start in it and the notes held into it from
 * before (a note held over a barline is written again, tied).
 */
export function expectedHeads(song: Pick<Song, 'measures' | 'notes'>): number[] {
  const counts = song.measures.map(() => 0);
  for (const note of song.notes) {
    const end = note.startBeat + note.durationBeats - 1e-3;
    for (let k = Math.max(0, note.measureIndex); k < counts.length; k++) {
      const m = song.measures[k];
      if (!m || (k > note.measureIndex && m.startBeat >= end)) break;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}

/** The repeat signs and endings of the written bars, as the song model's unrolling reads them. */
export function repeatMarks(bars: readonly SheetBar[]): RepeatMarks[] {
  return bars.map((bar, i) => {
    const before = bars[i - 1]?.ending;
    const after = bars[i + 1]?.ending;
    const marks: RepeatMarks = {
      forwardRepeat: bar.start === 'repeat-start',
      backwardRepeat: bar.end === 'repeat-end',
      repeatTimes: 2,
      endingStop: bar.ending !== undefined && after !== bar.ending,
    };
    if (bar.ending !== undefined && before !== bar.ending) marks.endingStart = [bar.ending];
    return marks;
  });
}

export interface Candidate {
  name: 'repeats' | 'repeats-from-last-start' | 'written' | 'source';
  /** Written bar indices in the order they would be played. */
  order: number[];
}

/**
 * Ways the written bars may have been played: with the repeats (both conventions of where a
 * repeat goes back to), as written (a MIDI file exported without repeats), and, for a song read
 * from a score, the order its own measures came in.
 */
export function playbackCandidates(
  bars: readonly SheetBar[],
  measures: readonly { sourceIndex: number }[] = [],
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (name: Candidate['name'], order: number[]) => {
    const key = order.join(',');
    if (order.length === 0 || seen.has(key)) return;
    seen.add(key);
    out.push({ name, order });
  };
  const marks = repeatMarks(bars);
  if (marks.some((m) => m.forwardRepeat || m.backwardRepeat || m.endingStart)) {
    add('repeats', playbackOrder(marks));
    add('repeats-from-last-start', playbackOrder(marks, { repeatFrom: 'lastForwardRepeat' }));
  }
  add(
    'written',
    bars.map((_, i) => i),
  );
  // A song read from a score knows which written measure each played one is (a MIDI file does not:
  // its measures simply count up).
  const sources = measures.map((m) => m.sourceIndex);
  const fromScore = sources.some((s, i) => s !== i);
  if (fromScore && sources.every((s) => s >= 0 && s < bars.length)) add('source', sources);
  return out;
}

// Costs of the alignment, in units of "one measure that does not match its bar at all".
const MERGE = 0.5;
const GAP = 0.6;

/** How differently many notes and heads a measure and a bar have: 0 the same, 1 nothing alike. */
function mismatch(notes: number, heads: number): number {
  return Math.abs(notes - heads) / Math.max(notes, heads, 3);
}

export interface Alignment {
  barOfMeasure: (number | null)[];
  /** Mean cost per measure (or bar, whichever is more): 0 is a perfect match. */
  cost: number;
}

/**
 * Aligns the measures with one candidate order. Moves: a measure on a bar; a bar not played; a
 * measure on the same bar as the one before (a multi-bar rest, a missed barline); two measures on
 * one bar; one measure over two bars (an extra barline was found).
 */
export function alignOrder(
  order: readonly number[],
  heads: readonly (number | undefined)[],
  notes: readonly number[],
): Alignment {
  const m = notes.length;
  const n = order.length;
  if (m === 0) return { barOfMeasure: [], cost: 0 };
  if (n === 0) return { barOfMeasure: notes.map(() => null), cost: 1 };
  const width = n + 1;
  if ((m + 1) * width > 8_000_000) {
    // Far beyond any real piece: spread the measures evenly instead of aligning.
    return {
      barOfMeasure: notes.map((_, i) => order[Math.min(n - 1, Math.floor((i * n) / m))] ?? null),
      cost: 1,
    };
  }
  const h = (j: number) => heads[order[j] ?? -1];
  const d = (count: number, ...js: number[]) => {
    let sum = 0;
    for (const j of js) {
      const v = h(j);
      if (v === undefined) return 0;
      sum += v;
    }
    return mismatch(count, sum);
  };
  const cost = new Float64Array((m + 1) * width).fill(Infinity);
  const move = new Uint8Array((m + 1) * width);
  cost[0] = 0;
  const at = (i: number, j: number) => cost[i * width + j] ?? Infinity;
  const relax = (i: number, j: number, value: number, kind: number) => {
    const k = i * width + j;
    if (value < (cost[k] ?? Infinity)) {
      cost[k] = value;
      move[k] = kind;
    }
  };
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      if (i === 0 && j === 0) continue;
      const e = (k: number) => notes[k] ?? 0;
      // 1: match measure i-1 with bar j-1.
      if (i >= 1 && j >= 1) relax(i, j, at(i - 1, j - 1) + d(e(i - 1), j - 1), 1);
      // 2: bar j-1 not played.
      if (j >= 1) {
        const v = h(j - 1);
        relax(i, j, at(i, j - 1) + GAP + 0.4 * Math.min(1, (v ?? 0) / 6), 2);
      }
      // 3: measure i-1 stays on bar j-1, as the measure before it did.
      if (i >= 1 && j >= 1) relax(i, j, at(i - 1, j) + GAP + 0.4 * Math.min(1, e(i - 1) / 6), 3);
      // 4: measures i-2 and i-1 on bar j-1.
      if (i >= 2 && j >= 1)
        relax(i, j, at(i - 2, j - 1) + MERGE + d(e(i - 2) + e(i - 1), j - 1), 4);
      // 5: measure i-1 over bars j-2 and j-1.
      if (i >= 1 && j >= 2) relax(i, j, at(i - 1, j - 2) + MERGE + d(e(i - 1), j - 2, j - 1), 5);
      // 6: measure i-1 before any bar (a pickup the sheet does not write, say).
      if (i >= 1 && j === 0) relax(i, j, at(i - 1, j) + GAP + 0.4 * Math.min(1, e(i - 1) / 6), 6);
    }
  }
  const barOfMeasure: (number | null)[] = notes.map(() => null);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const kind = move[i * width + j];
    if (kind === 1) {
      barOfMeasure[i - 1] = order[j - 1] ?? null;
      i -= 1;
      j -= 1;
    } else if (kind === 2) {
      j -= 1;
    } else if (kind === 3) {
      barOfMeasure[i - 1] = order[j - 1] ?? null;
      i -= 1;
    } else if (kind === 4) {
      barOfMeasure[i - 1] = order[j - 1] ?? null;
      barOfMeasure[i - 2] = order[j - 1] ?? null;
      i -= 2;
      j -= 1;
    } else if (kind === 5) {
      barOfMeasure[i - 1] = order[j - 2] ?? null;
      i -= 1;
      j -= 2;
    } else if (kind === 6) {
      i -= 1;
    } else {
      break;
    }
  }
  return { barOfMeasure, cost: at(m, n) / Math.max(m, n) };
}

export interface SongAlignment extends Alignment {
  candidate: Candidate['name'];
}

/** The best alignment of a song with the written bars over every candidate playback order. */
export function alignSong(
  layout: SheetLayout,
  song: Pick<Song, 'measures' | 'notes'>,
): SongAlignment {
  const notes = expectedHeads(song);
  const written = layout.bars.map((b) => b.heads);
  // Heads that cannot be counted (scans, glyphs drawn as text) would make every bar look empty.
  const known = written.reduce<number>((s, v) => s + (v ?? 0), 0);
  const total = notes.reduce((s, v) => s + v, 0);
  const heads = known >= 0.2 * total ? written : written.map(() => undefined);
  let best: SongAlignment | null = null;
  for (const candidate of playbackCandidates(layout.bars, song.measures)) {
    const result = alignOrder(candidate.order, heads, notes);
    if (!best || result.cost < best.cost - 1e-9) best = { ...result, candidate: candidate.name };
  }
  return best ?? { barOfMeasure: notes.map(() => null), cost: 1, candidate: 'written' };
}

/** A new, unedited map for a layout and a song. */
export function buildSheetMap(
  layout: SheetLayout,
  song: Pick<Song, 'measures' | 'notes'>,
): SheetMap {
  return {
    layout,
    barOfMeasure: alignSong(layout, song).barOfMeasure,
    edited: false,
    analyser: ANALYSER_VERSION,
  };
}

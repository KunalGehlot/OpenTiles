// Difficulty estimate on five levels (spec §9, plan task P2-05).
//
// Six measures are taken from the Song, each mapped onto the 1–5 scale by a piecewise-linear
// table (below), then combined:
//
//   mean  = 0.30·speed + 0.20·rhythm + 0.20·independence + 0.10·stretch + 0.10·chords
//           + 0.10·key
//   score = 0.7·max(all six) + 0.3·mean
//   level = 1 + the number of thresholds 1.5, 2.5, 3.4, 4.2 that the score reaches
//
// A piece is about as hard as its hardest demand; the mean moves it up when several demands
// come together and down when only one stands out. The upper thresholds sit below plain rounding
// because even advanced pieces rarely max out every measure at once, which compresses the top of
// the score.
//
// Calibration (test/difficulty.test.ts): the catalogue's beginner arrangements land on their
// recorded levels 1–2; running sixteenths at a moderate tempo over three-note chords in four
// sharps land on 3; fast running sixteenths with four-note chords in six flats land on 5.
//
// The catalogue pipeline may later blend in PDMX's own complexity rating; this function only
// uses what is in the Song, so it also works for private imports.
import { isBlackKey } from './pitch';
import { TempoMap } from './tempo';
import type { Hand, Measure, Song, SongNote } from './types';

export interface DifficultyMeasures {
  /**
   * Onsets per second in the busier hand (a chord counts once) at the score's tempo: the mean of
   * the average bar and the busiest quarter of the bars.
   */
  notesPerSecond: number;
  /** Widest interval in semitones that one hand holds at the same time. */
  maxStretch: number;
  /** Most notes one hand starts at the same time. */
  maxSimultaneous: number;
  /** Sharps or flats in the key signature with the most (estimated from the notes if none). */
  accidentals: number;
  /**
   * 0–5: finest subdivision used (0 quarters, 1 eighths, 2 sixteenths, 3 thirty-seconds, 4 finer),
   * plus 1 for tuplets and up to 1 for syncopation.
   */
  rhythmComplexity: number;
  /** 0–1: share of beats with notes in which each hand starts a note the other does not. */
  handIndependence: number;
}

export interface DifficultyEstimate {
  /** 1 (first pieces) … 5 (advanced). */
  level: 1 | 2 | 3 | 4 | 5;
  /** The unrounded combined score, 1–5. */
  score: number;
  measures: DifficultyMeasures;
}

type Table = readonly (readonly [number, number])[];

// Piecewise-linear maps from a measure to the 1–5 scale. Reference points: quarter notes at
// 100 bpm ≈ 1.7 onsets/s (level 1), eighths at 100 ≈ 3.3 (2), sixteenths at 75 ≈ 5 (3),
// sixteenths at 105 ≈ 7 (4), sixteenths at 135 ≈ 9 (5).
const SPEED: Table = [
  [0, 1],
  [1.5, 1],
  [3, 2],
  [4.5, 2.75],
  [6, 3.5],
  [8, 4.25],
  [10, 5],
];
const STRETCH: Table = [
  [0, 1],
  [7, 1],
  [9, 2],
  [12, 3],
  [14, 4],
  [16, 5],
];
const CHORDS: Table = [
  [1, 1],
  [2, 1.5],
  [3, 2.5],
  [4, 3.5],
  [5, 4.5],
  [6, 5],
];
const KEY: Table = [
  [0, 1],
  [1, 1.25],
  [2, 1.5],
  [3, 2],
  [4, 3],
  [5, 3.5],
  [6, 4],
];
const RHYTHM: Table = [
  [0, 1],
  [1, 1.5],
  [2, 2.5],
  [3, 3.5],
  [4, 4.5],
  [5, 5],
];
const INDEPENDENCE: Table = [
  [0, 1],
  [0.05, 1],
  [0.2, 2],
  [0.4, 3],
  [0.6, 4],
  [0.8, 5],
];

const WEIGHTS = {
  speed: 0.3,
  rhythm: 0.2,
  independence: 0.2,
  stretch: 0.1,
  chords: 0.1,
  key: 0.1,
} as const;

const EPS = 1e-3;

/** Scores at which levels 2, 3, 4 and 5 begin. */
const LEVEL_THRESHOLDS = [1.5, 2.5, 3.4, 4.2] as const;

function scale(table: Table, x: number): number {
  const first = table[0];
  const last = table[table.length - 1];
  if (!first || !last) return 1;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i] as readonly [number, number];
    const [x0, y0] = table[i - 1] as readonly [number, number];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

function byHand(notes: readonly SongNote[]): Map<Hand, SongNote[]> {
  const map = new Map<Hand, SongNote[]>();
  for (const n of notes) {
    const list = map.get(n.hand) ?? [];
    list.push(n);
    map.set(n.hand, list);
  }
  return map;
}

/** Distinct start beats, sorted. */
function onsets(notes: readonly SongNote[]): number[] {
  const out: number[] = [];
  for (const b of notes.map((n) => n.startBeat).sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || b - last > EPS) out.push(b);
  }
  return out;
}

function speed(song: Song, hands: Map<Hand, SongNote[]>): number {
  const tempo = new TempoMap(song.tempos);
  let best = 0;
  for (const notes of hands.values()) {
    const perMeasure = new Map<number, number>();
    for (const b of onsets(notes)) {
      const m = measureAt(song.measures, b);
      perMeasure.set(m, (perMeasure.get(m) ?? 0) + 1);
    }
    const rates: number[] = [];
    song.measures.forEach((m, i) => {
      const seconds =
        tempo.beatToSeconds(m.startBeat + m.lengthBeats) - tempo.beatToSeconds(m.startBeat);
      const count = perMeasure.get(i) ?? 0;
      if (seconds > 0 && count > 0) rates.push(count / seconds);
    });
    if (rates.length === 0) continue;
    rates.sort((a, b) => b - a);
    const top = rates.slice(0, Math.max(1, Math.ceil(rates.length / 4)));
    const peak = top.reduce((s, r) => s + r, 0) / top.length;
    const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
    best = Math.max(best, (peak + mean) / 2);
  }
  return best;
}

function measureAt(measures: readonly Measure[], beat: number): number {
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((measures[mid]?.startBeat ?? 0) <= beat + EPS) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Widest held interval and largest chord, per hand. */
function handShape(hands: Map<Hand, SongNote[]>): { stretch: number; simultaneous: number } {
  let stretch = 0;
  let simultaneous = 0;
  for (const notes of hands.values()) {
    const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    let active: SongNote[] = [];
    let i = 0;
    while (i < sorted.length) {
      const t = (sorted[i] as SongNote).startBeat;
      const group: SongNote[] = [];
      while (i < sorted.length && (sorted[i] as SongNote).startBeat - t <= EPS) {
        group.push(sorted[i] as SongNote);
        i += 1;
      }
      simultaneous = Math.max(simultaneous, new Set(group.map((n) => n.pitch)).size);
      active = active.filter((n) => n.startBeat + n.durationBeats > t + EPS).concat(group);
      const pitches = active.map((n) => n.pitch);
      stretch = Math.max(stretch, Math.max(...pitches) - Math.min(...pitches));
    }
  }
  return { stretch, simultaneous };
}

/** Sharps or flats of the key; estimated from the pitch classes when the file has no key. */
function keyAccidentals(song: Song): number {
  if (song.keySignatures.length > 0) {
    return Math.max(...song.keySignatures.map((k) => Math.min(7, Math.abs(k.fifths))));
  }
  if (song.notes.length === 0) return 0;
  // The major scale (on the circle of fifths) that covers the most notes.
  let bestFifths = 0;
  let bestCount = -1;
  for (let fifths = -6; fifths <= 6; fifths++) {
    const tonic = (((fifths * 7) % 12) + 12) % 12;
    const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((s) => (tonic + s) % 12));
    const count = song.notes.filter((n) => scale.has(((n.pitch % 12) + 12) % 12)).length;
    if (count > bestCount || (count === bestCount && Math.abs(fifths) < Math.abs(bestFifths))) {
      bestCount = count;
      bestFifths = fifths;
    }
  }
  // A key with no black keys in use needs no accidentals, whatever the scale search says.
  return song.notes.some((n) => isBlackKey(n.pitch)) ? Math.abs(bestFifths) : 0;
}

/** Beat length in quarter notes for the time signature in force at `beat`. */
function beatLength(song: Song, beat: number): number {
  let ts = song.timeSignatures[0];
  for (const t of song.timeSignatures) if (t.beat <= beat + EPS) ts = t;
  if (!ts) return 1;
  const compound = ts.denominator === 8 && ts.numerator % 3 === 0 && ts.numerator > 3;
  return (4 / ts.denominator) * (compound ? 3 : 1);
}

const isMultiple = (x: number, unit: number) => Math.abs(x / unit - Math.round(x / unit)) < EPS;

function rhythm(song: Song): number {
  const notes = song.notes;
  if (notes.length === 0) return 0;
  const threshold = Math.max(1, Math.ceil(notes.length * 0.02));
  const levels = [0, 0, 0, 0, 0];
  let tuplets = 0;
  let syncopated = 0;
  for (const n of notes) {
    const m = song.measures[n.measureIndex];
    const x = n.startBeat - (m?.startBeat ?? 0);
    let level = -1;
    for (let k = 0; k <= 3; k++) {
      if (isMultiple(x, 1 / 2 ** k)) {
        level = k;
        break;
      }
    }
    if (level < 0) {
      if ([1 / 3, 1 / 6, 1 / 12].some((u) => isMultiple(x, u))) tuplets += 1;
      else level = 4;
    }
    if (level >= 0) levels[level] = (levels[level] ?? 0) + 1;
    // Syncopation: starts between beats and is held across the next beat.
    const beat = beatLength(song, n.startBeat);
    if (!isMultiple(x, beat)) {
      const nextBeat = Math.ceil(x / beat - EPS) * beat;
      if (x + n.durationBeats > nextBeat + EPS) syncopated += 1;
    }
  }
  let subdivision = 0;
  let atOrAbove = 0;
  for (let k = 4; k >= 0; k--) {
    atOrAbove += levels[k] ?? 0;
    if (atOrAbove >= threshold) {
      subdivision = k;
      break;
    }
  }
  const tupletPart = tuplets >= threshold ? 1 : 0;
  const syncopationPart = Math.min(1, (syncopated / notes.length) * 5);
  return Math.min(5, subdivision + tupletPart + syncopationPart);
}

function independence(song: Song, hands: Map<Hand, SongNote[]>): number {
  const left = hands.get('left');
  const right = hands.get('right');
  if (!left?.length || !right?.length) return 0;
  const windows = new Map<string, { left: Set<number>; right: Set<number> }>();
  for (const n of song.notes) {
    const m = song.measures[n.measureIndex];
    const x = n.startBeat - (m?.startBeat ?? 0);
    const beat = beatLength(song, n.startBeat);
    const w = Math.floor(x / beat + EPS);
    const key = `${n.measureIndex}:${w}`;
    const entry = windows.get(key) ?? { left: new Set<number>(), right: new Set<number>() };
    entry[n.hand].add(Math.round((x - w * beat) * 48));
    windows.set(key, entry);
  }
  // A beat counts when each hand starts a note the other does not: interleaved rhythms. One hand
  // subdividing the other's beat (melody over an Alberti bass) does not count.
  let independent = 0;
  for (const { left: l, right: r } of windows.values()) {
    const leftOwn = [...l].some((x) => !r.has(x));
    const rightOwn = [...r].some((x) => !l.has(x));
    if (leftOwn && rightOwn) independent += 1;
  }
  return windows.size > 0 ? independent / windows.size : 0;
}

/** Estimates how hard a piece is to play, on five levels. */
export function estimateDifficulty(song: Song): DifficultyEstimate {
  const hands = byHand(song.notes);
  const shape = handShape(hands);
  const measures: DifficultyMeasures = {
    notesPerSecond: round(speed(song, hands)),
    maxStretch: shape.stretch,
    maxSimultaneous: shape.simultaneous,
    accidentals: keyAccidentals(song),
    rhythmComplexity: round(rhythm(song)),
    handIndependence: round(independence(song, hands)),
  };
  if (song.notes.length === 0) return { level: 1, score: 1, measures };
  const parts = {
    speed: scale(SPEED, measures.notesPerSecond),
    rhythm: scale(RHYTHM, measures.rhythmComplexity),
    independence: scale(INDEPENDENCE, measures.handIndependence),
    stretch: scale(STRETCH, measures.maxStretch),
    chords: scale(CHORDS, measures.maxSimultaneous),
    key: scale(KEY, measures.accidentals),
  };
  let mean = 0;
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    mean += weight * parts[name as keyof typeof parts];
  }
  const score = 0.7 * Math.max(...Object.values(parts)) + 0.3 * mean;
  const level = (1 +
    LEVEL_THRESHOLDS.filter((t) => score >= t - 1e-9).length) as DifficultyEstimate['level'];
  return { level, score: round(score), measures };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

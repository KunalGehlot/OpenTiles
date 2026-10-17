// Song → MusicXML (P5-13, ADR 0017): a printed score for pieces that come without one, such as
// MIDI files. Pure string building, so it runs in Node tests and workers as well as the browser.
//
// The score draws the song as it is: every note at its own bar, onset and pitch, so the score
// views link glyphs to notes exactly as they do for a MusicXML file (ADR 0009). What the writer
// decides is only how to show it: staves and clefs, spelling and accidentals, voices, ties at
// barlines and beats, rests, beams and triplets.
import type { KeySignatureEvent, Measure, Song, SongNote, TimeSignatureEvent } from './types';

/**
 * How a learner's sheet music writes the song (P5-18): read from the printed heads of its PDF, so
 * the engraved score can follow it. Anything missing is decided as usual.
 */
export interface ScoreHints {
  /** By note id: the staff it is printed on (1 upper, 2 lower) and the letter and accidental. */
  notes: Record<string, { staff?: 1 | 2; step?: string; alter?: number }>;
  /** By bar (index into `song.measures`): the clef each staff starts the bar with. */
  clefs: Record<number, { 1?: 'G' | 'F'; 2?: 'G' | 'F' }>;
}

export interface WrittenScore {
  /** MusicXML 4.0, partwise: one piano part on two staves. */
  xml: string;
  /**
   * The song with each note's `sourceRefs` naming the glyphs written for it, the head first and
   * then its tie continuations, as `parseMusicXml` would name them. Each written note also has its
   * ref as its `id`, which Verovio keeps as the glyph's id, so the score views can link notes to
   * glyphs by ref. Note ids, order and everything else are unchanged.
   */
  song: Song;
}

/**
 * Divisions per quarter note. Every grid the MIDI quantiser uses (down to 1/32 and 1/24 of a
 * beat) is a whole number of them.
 */
const DIVISIONS = 96;
/** The shortest written value, a 128th note. */
const SHORTEST = 3;
/** Most voices one staff gets; more overlapping lines than this are rare in piano music. */
const MAX_VOICES = 4;

// --- Pitch spelling ---------------------------------------------------------------------------

/** Letters in the order of the line of fifths, from F (position -1). */
const FIFTHS_LETTERS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface Spelling {
  step: string;
  alter: number;
  octave: number;
}

/**
 * Spells a pitch for a key. Each key gets a window of twelve neighbouring positions on the line
 * of fifths: its seven notes, two flats below (the minor third and seventh) and three sharps
 * above (the raised fourth, first and fifth); a minor key moves the window one sharp up, for its
 * leading note. The window is kept within six flats and six sharps where the key allows, so
 * remote keys get naturals rather than double accidentals.
 */
export function spellPitch(pitch: number, fifths: number, minor = false): Spelling {
  let w = fifths - (minor ? 2 : 3);
  w = Math.max(w, -7);
  w = Math.min(w, 0);
  w = Math.min(w, fifths - 1);
  w = Math.max(w, fifths - 6);
  const pc = ((pitch % 12) + 12) % 12;
  // Position p has pitch class 7p mod 12; 7 is its own inverse mod 12.
  let p = (pc * 7) % 12;
  while (p < w) p += 12;
  while (p > w + 11) p -= 12;
  const step = FIFTHS_LETTERS[(((p + 1) % 7) + 7) % 7] as string;
  const alter = Math.floor((p + 1) / 7);
  const octave = Math.floor((pitch - (LETTER_SEMITONES[step] ?? 0) - alter) / 12) - 1;
  return { step, alter, octave };
}

/**
 * A pitch written with a given letter and accidental, in the octave that makes it sound right;
 * null when that letter and accidental cannot spell the pitch.
 */
function spellAs(pitch: number, step: string, alter: number): Spelling | null {
  const semitone = LETTER_SEMITONES[step];
  if (semitone === undefined || !Number.isInteger(alter) || Math.abs(alter) > 2) return null;
  const rest = pitch - semitone - alter;
  if (rest % 12 !== 0) return null;
  return { step, alter, octave: rest / 12 - 1 };
}

/** The alteration the key signature gives a letter. */
function keyAlter(step: string, fifths: number): number {
  const p = FIFTHS_LETTERS.indexOf(step) - 1; // natural position, -1 (F) … 5 (B)
  if (fifths > 0) return p < fifths - 1 ? 1 : 0;
  if (fifths < 0) return p > 5 + fifths ? -1 : 0;
  return 0;
}

const ACCIDENTALS: Record<number, string> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};

// --- Written values ---------------------------------------------------------------------------

const TYPES: [number, string][] = [
  [384, 'whole'],
  [192, 'half'],
  [96, 'quarter'],
  [48, 'eighth'],
  [24, '16th'],
  [12, '32nd'],
  [6, '64th'],
  [3, '128th'],
];

/** Written values in divisions, longest first, with their type and dot. */
const VALUES: { divs: number; type: string; dot: boolean; flags: number }[] = TYPES.flatMap(
  ([divs, type], i) => {
    const flags = Math.max(0, i - 2);
    const plain = { divs, type, dot: false, flags };
    return divs >= 6 ? [{ divs: divs * 1.5, type, dot: true, flags }, plain] : [plain];
  },
).sort((a, b) => b.divs - a.divs);
const VALUE_OF = new Map(VALUES.map((v) => [v.divs, v]));

type Value = (typeof VALUES)[number];

/** Written values that add up to `divs`, longest first. */
function valuesFor(divs: number): Value[] {
  const exact = VALUE_OF.get(divs);
  if (exact) return [exact];
  const out: Value[] = [];
  let left = divs;
  while (left >= SHORTEST) {
    const v = VALUES.find((x) => x.divs <= left);
    if (!v) break;
    out.push(v);
    left -= v.divs;
  }
  // Durations off every written value (only from unusual input) keep their length on the last.
  if (left > 0 && out.length === 0) out.push(VALUES[VALUES.length - 1] as Value);
  return out;
}

// --- Metre ------------------------------------------------------------------------------------

interface Metre {
  numerator: number;
  denominator: number;
  /** The bar's length by its time signature, in divisions. */
  nominal: number;
  /** One beat, in divisions (a dotted quarter in 6/8). */
  beat: number;
  /** Notes shorter than a quarter are beamed within this span (a beat; three eighths in x/8). */
  beam: number;
  /** Where a long note on beat 2 is tied (the middle of a 4/4 or 12/8 bar), or 0. */
  half: number;
  /** Triplets are found and bracketed per unit: a quarter, or an eighth in x/8 (see tripletUnits). */
  unit: number;
  compound: boolean;
}

function metreOf(ts: { numerator: number; denominator: number }): Metre {
  const { numerator, denominator } = ts;
  const note = (4 * DIVISIONS) / denominator;
  const compound = denominator >= 8 && numerator % 3 === 0 && numerator > 3;
  const beat = compound ? note * 3 : note;
  const beats = Math.round((numerator * note) / beat);
  return {
    numerator,
    denominator,
    nominal: numerator * note,
    beat,
    beam: compound || (denominator >= 8 && numerator === 3) ? note * 3 : Math.min(beat, DIVISIONS),
    half: beats === 4 ? beat * 2 : 0,
    unit: denominator >= 8 ? note : DIVISIONS,
    compound,
  };
}

// --- Layout of one staff in one bar -------------------------------------------------------------

/** A stretch of one song note inside one bar. */
interface Segment {
  note: number;
  pitch: number;
  start: number;
  end: number;
  /** Continues from the previous bar. */
  tieStop: boolean;
  /** Continues into the next bar. */
  tieStart: boolean;
}

/** Notes that start and end together in one voice. */
interface Chord {
  start: number;
  end: number;
  segments: Segment[];
}

/** One written note, chord or rest. */
interface Piece {
  start: number;
  divs: number;
  value: Value | null;
  /** Inside a triplet unit: the written value is 3/2 of the sounding one. */
  triplet: boolean;
  /** Empty for a rest. */
  segments: Segment[];
  /** First and last piece of a song note's stretch in this bar (for ties). */
  first: boolean;
  last: boolean;
  /** A whole-bar rest. */
  measureRest?: boolean;
  /** Unwritten time in a second voice, before its first note or after its last (`<forward>`). */
  space?: boolean;
  tuplet?: 'start' | 'stop';
  beams?: string[];
  accidentals?: (string | undefined)[];
}

interface Voice {
  free: number;
  pitch: number;
  chords: Chord[];
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Spreads a bar's segments over voices: chords together, overlapping lines apart. */
function voicesOf(segments: Segment[]): Chord[][] {
  const groups = new Map<string, Chord[]>();
  for (const s of segments) {
    const key = `${s.start}:${s.end}`;
    const list = groups.get(key) ?? [];
    groups.set(key, list);
    // A key struck twice at once goes into a chord of its own, so both notes keep a glyph.
    const chord = list.find((c) => !c.segments.some((x) => x.pitch === s.pitch));
    if (chord) chord.segments.push(s);
    else list.push({ start: s.start, end: s.end, segments: [s] });
  }
  const chords = [...groups.values()].flat();
  for (const c of chords) c.segments.sort((a, b) => a.pitch - b.pitch);
  chords.sort(
    (a, b) =>
      a.start - b.start ||
      Math.max(...b.segments.map((s) => s.pitch)) - Math.max(...a.segments.map((s) => s.pitch)),
  );
  const voices: Voice[] = [];
  for (const chord of chords) {
    const pitch = mean(chord.segments.map((s) => s.pitch));
    const busy = voices.some((v) => v.free > chord.start);
    let voice: Voice | undefined;
    if (!busy) voice = voices[0];
    else {
      for (const v of voices) {
        if (v.free > chord.start) continue;
        if (!voice || Math.abs(v.pitch - pitch) < Math.abs(voice.pitch - pitch)) voice = v;
      }
    }
    if (!voice && voices.length >= MAX_VOICES) {
      // Too many lines at once: the line that ends first is cut short in the drawing (only there;
      // the song keeps every note's full length). If it starts (almost) with this chord, the two
      // become one chord with the shorter end instead, so the voice never overlaps itself.
      voice = voices.reduce((a, b) => (a.free <= b.free ? a : b));
      const cut = voice.chords[voice.chords.length - 1];
      if (cut && chord.start - cut.start < SHORTEST) {
        cut.end = Math.min(cut.end, chord.end);
        cut.segments.push(...chord.segments);
        cut.segments.sort((a, b) => a.pitch - b.pitch);
        for (const s of cut.segments) {
          if (s.end > cut.end) s.tieStart = false;
          s.end = cut.end;
        }
        voice.free = cut.end;
        continue;
      }
      if (cut && cut.end > chord.start) {
        cut.end = chord.start;
        for (const s of cut.segments) {
          s.end = cut.end;
          s.tieStart = false;
        }
      }
    }
    if (!voice) {
      voice = { free: 0, pitch, chords: [] };
      voices.push(voice);
    }
    voice.chords.push(chord);
    voice.free = chord.end;
    voice.pitch = pitch;
  }
  // The highest line is voice 1 (stems up), the lowest the last (stems down).
  const height = (v: Voice) => mean(v.chords.flatMap((c) => c.segments.map((s) => s.pitch)));
  return voices.sort((a, b) => height(b) - height(a)).map((v) => v.chords);
}

/** Triplet units of one voice in one bar, as start → length. */
type Triplets = Map<number, number>;

/**
 * The triplet units of one voice: units with an onset or end off the binary grid. In x/4 time two
 * beats whose every onset and end falls on a third of a half note are one unit, so quarter-note
 * triplets are written as such rather than as tied triplet eighths.
 */
function tripletUnits(chords: readonly Chord[], metre: Metre, length: number): Triplets {
  const edges = chords.flatMap((c) => [c.start, c.end]);
  const units: Triplets = new Map();
  for (const p of edges) {
    if (p % SHORTEST === 0) continue;
    const pair = Math.floor(p / (2 * DIVISIONS)) * 2 * DIVISIONS;
    const halfTriplets =
      metre.beat === DIVISIONS &&
      pair + 2 * DIVISIONS <= length &&
      edges.every((e) => e <= pair || e >= pair + 2 * DIVISIONS || (e - pair) % 64 === 0);
    if (halfTriplets) units.set(pair, 2 * DIVISIONS);
    else units.set(Math.floor(p / metre.unit) * metre.unit, metre.unit);
  }
  return units;
}

/** The triplet unit that contains `p`, if any. */
function unitAt(triplets: Triplets, p: number): [number, number] | undefined {
  for (const [u, len] of triplets) if (p >= u && p < u + len) return [u, len];
  return undefined;
}

/**
 * Splits a note or rest at triplet-unit edges, then by the metre: one span off the beat runs to
 * the next beat, one from a beat may last several beats (whole dotted beats in compound time), and
 * nothing from beat 2 of a 4/4 bar crosses its middle. Each span is written as one value or tied
 * values.
 */
function spans(a: number, b: number, metre: Metre, triplets: Triplets) {
  const cuts = new Set<number>();
  for (const [u, len] of triplets) {
    if (u > a && u < b) cuts.add(u);
    if (u + len > a && u + len < b) cuts.add(u + len);
  }
  const parts: [number, number][] = [];
  let from = a;
  for (const c of [...cuts].sort((x, y) => x - y)) {
    parts.push([from, c]);
    from = c;
  }
  parts.push([from, b]);

  const out: { start: number; end: number; triplet: boolean }[] = [];
  for (const [s, e] of parts) {
    if (unitAt(triplets, s)) {
      out.push({ start: s, end: e, triplet: true });
      continue;
    }
    let p = s;
    while (p < e) {
      let q = e;
      const nextBeat = (Math.floor(p / metre.beat) + 1) * metre.beat;
      if (p % metre.beat !== 0) q = Math.min(q, nextBeat);
      else if (metre.compound && q - p > metre.beat && (q - p) % metre.beat !== 0) {
        q = p + Math.floor((q - p) / metre.beat) * metre.beat;
      }
      if (metre.half && p > 0 && p < metre.half && q > metre.half) q = metre.half;
      out.push({ start: p, end: q, triplet: false });
      p = q;
    }
  }
  return out;
}

/**
 * Rest values for a span: each where its own value falls in the bar, so a half rest stands on beat
 * 1 or 3 of a 4/4 bar, and a dotted rest only for a whole beat of compound time.
 */
function restValues(start: number, end: number, metre: Metre, triplet: boolean): Value[] {
  if (triplet) return valuesFor(((end - start) * 3) / 2);
  const out: Value[] = [];
  let p = start;
  while (p < end) {
    const v = VALUES.find(
      (x) =>
        x.divs <= end - p &&
        (x.dot
          ? metre.compound && x.divs === metre.beat && p % metre.beat === 0
          : p % x.divs === 0),
    );
    if (!v) {
      out.push(...valuesFor(end - p));
      break;
    }
    out.push(v);
    p += v.divs;
  }
  return out;
}

/**
 * The written pieces of one voice in one bar. The main voice shows all its rests; the others only
 * those between their notes, as engravers usually leave the rest out.
 */
function piecesOf(chords: readonly Chord[], length: number, metre: Metre, main: boolean): Piece[] {
  const triplets = tripletUnits(chords, metre, length);
  const pieces: Piece[] = [];
  const gap = (a: number, b: number, inner: boolean) => {
    if (b <= a) return;
    if (!main && !inner) {
      pieces.push({
        start: a,
        divs: b - a,
        value: null,
        triplet: false,
        segments: [],
        first: true,
        last: true,
        space: true,
      });
      return;
    }
    for (const span of spans(a, b, metre, triplets)) {
      let p = span.start;
      const values = restValues(span.start, span.end, metre, span.triplet);
      values.forEach((v, i) => {
        const divs =
          i === values.length - 1 ? span.end - p : span.triplet ? (v.divs * 2) / 3 : v.divs;
        pieces.push({
          start: p,
          divs,
          value: v,
          triplet: span.triplet,
          segments: [],
          first: true,
          last: true,
        });
        p += divs;
      });
    }
  };
  if (chords.length === 0) {
    return [
      {
        start: 0,
        divs: length,
        value: null,
        triplet: false,
        segments: [],
        first: true,
        last: true,
        measureRest: true,
      },
    ];
  }
  let at = 0;
  for (const [i, c] of chords.entries()) {
    gap(at, c.start, i > 0);
    const parts: Piece[] = [];
    for (const span of spans(c.start, c.end, metre, triplets)) {
      let p = span.start;
      const written = span.triplet ? ((span.end - span.start) * 3) / 2 : span.end - span.start;
      const values = valuesFor(written);
      values.forEach((v, i) => {
        const divs =
          i === values.length - 1 ? span.end - p : span.triplet ? (v.divs * 2) / 3 : v.divs;
        parts.push({
          start: p,
          divs,
          value: v,
          triplet: span.triplet,
          segments: c.segments,
          first: false,
          last: false,
        });
        p += divs;
      });
    }
    const head = parts[0];
    const tail = parts[parts.length - 1];
    if (head) head.first = true;
    if (tail) tail.last = true;
    pieces.push(...parts);
    at = c.end;
  }
  gap(at, length, false);
  markTuplets(pieces, triplets);
  markBeams(pieces, metre);
  return pieces;
}

function markTuplets(pieces: Piece[], triplets: Triplets): void {
  const byUnit = new Map<number, Piece[]>();
  for (const p of pieces) {
    if (!p.triplet || p.space) continue;
    const u = unitAt(triplets, p.start)?.[0] ?? p.start;
    byUnit.set(u, [...(byUnit.get(u) ?? []), p]);
  }
  for (const group of byUnit.values()) {
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last || first === last) continue;
    first.tuplet = 'start';
    last.tuplet = 'stop';
  }
}

/** Beams notes shorter than a quarter within each beat (each dotted quarter in 6/8). */
function markBeams(pieces: Piece[], metre: Metre): void {
  let run: Piece[] = [];
  let group = -1;
  const close = () => {
    if (run.length >= 2) beamRun(run);
    run = [];
  };
  for (const p of pieces) {
    const g = Math.floor(p.start / metre.beam);
    const beamable = p.segments.length > 0 && (p.value?.flags ?? 0) > 0;
    if (!beamable || g !== group) close();
    group = g;
    if (beamable) run.push(p);
  }
  close();
}

function beamRun(run: Piece[]): void {
  const flags = run.map((p) => p.value?.flags ?? 0);
  run.forEach((p) => (p.beams = []));
  const deepest = Math.max(...flags);
  for (let level = 1; level <= deepest; level++) {
    for (let i = 0; i < run.length; i++) {
      const here = (flags[i] ?? 0) >= level;
      if (!here) continue;
      const before = i > 0 && (flags[i - 1] ?? 0) >= level;
      const after = i + 1 < run.length && (flags[i + 1] ?? 0) >= level;
      const beams = run[i]?.beams as string[];
      if (level === 1) beams.push(i === 0 ? 'begin' : i === run.length - 1 ? 'end' : 'continue');
      else if (before && after) beams.push('continue');
      else if (after) beams.push('begin');
      else if (before) beams.push('end');
      else beams.push(i === 0 ? 'forward hook' : 'backward hook');
    }
  }
}

// --- Clefs ------------------------------------------------------------------------------------

type Clef = 'G' | 'F';

/** Bottom and top line of each staff, as diatonic steps (octave × 7 + letter, C4 = 28). */
const STAFF_LINES: Record<Clef, [number, number]> = { G: [30, 38], F: [18, 26] };

/** Ledger lines a note at diatonic `step` needs with `clef`. */
function ledgerLines(step: number, clef: Clef): number {
  const [bottom, top] = STAFF_LINES[clef];
  if (step < bottom) return Math.floor((bottom - step) / 2);
  if (step > top) return Math.floor((step - top) / 2);
  return 0;
}

/**
 * A clef per bar for one staff, from the diatonic steps of its notes: the clef that needs fewer
 * ledger lines, changed only when the other clef clearly needs fewer in this bar and in the next
 * bar with notes, so one passing high or low note does not flip it.
 */
function clefsFor(stepsByBar: readonly (readonly number[])[], usual: Clef): Clef[] {
  // Squared, so one note far off the staff weighs more than a few just off it.
  const cost = (steps: readonly number[], clef: Clef) =>
    steps.reduce((sum, s) => sum + ledgerLines(s, clef) ** 2, 0);
  const other = (c: Clef): Clef => (c === 'G' ? 'F' : 'G');
  const prefers = (steps: readonly number[], from: Clef) =>
    steps.length > 0 && cost(steps, other(from)) + 4 + cost(steps, from) * 0.25 < cost(steps, from);
  const out: Clef[] = [];
  const firstBars = stepsByBar
    .filter((s) => s.length > 0)
    .slice(0, 2)
    .flat();
  let current = cost(firstBars, other(usual)) < cost(firstBars, usual) ? other(usual) : usual;
  stepsByBar.forEach((steps, i) => {
    if (prefers(steps, current)) {
      const next = stepsByBar.slice(i + 1).find((s) => s.length > 0);
      if (!next || prefers(next, current)) current = other(current);
    }
    out.push(current);
  });
  return out;
}

const clefXml = (staff: number, clef: Clef) =>
  clef === 'G'
    ? `<clef number="${staff}"><sign>G</sign><line>2</line></clef>`
    : `<clef number="${staff}"><sign>F</sign><line>4</line></clef>`;

// --- Writer -----------------------------------------------------------------------------------

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const toDivs = (beat: number) => Math.round(beat * DIVISIONS);

/** The last event at or before `beat` (events sorted by beat). */
function at<T extends { beat: number }>(events: readonly T[], beat: number): T | undefined {
  let found: T | undefined;
  for (const e of events) {
    if (e.beat <= beat + 1e-6) found = e;
    else break;
  }
  return found;
}

/** One event per beat (the last wins), in order. */
function normalise<T extends { beat: number }>(events: readonly T[]): T[] {
  const out: T[] = [];
  for (const e of [...events].sort((a, b) => a.beat - b.beat)) {
    if (out.length && Math.abs((out[out.length - 1] as T).beat - e.beat) < 1e-6)
      out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}

/** Minor or major for each key signature: from the song when it says, else from the last bass note. */
function minorKeys(song: Song, keys: readonly KeySignatureEvent[]): boolean[] {
  return keys.map((k, i) => {
    if (k.mode === 'minor') return true;
    const from = k.beat;
    const to = keys[i + 1]?.beat ?? Infinity;
    const inside = song.notes.filter((n) => n.startBeat >= from - 1e-6 && n.startBeat < to - 1e-6);
    const last = inside[inside.length - 1];
    if (!last) return false;
    const bass = Math.min(
      ...inside.filter((n) => Math.abs(n.startBeat - last.startBeat) < 1e-6).map((n) => n.pitch),
    );
    const minorTonic = ((((k.fifths + 3) * 7) % 12) + 12) % 12;
    return bass % 12 === minorTonic;
  });
}

/**
 * Writes the song as a piano score. The upper staff takes notes on staff 1 (the right hand of a
 * MIDI file, or its first track), the lower staff the rest. Bars follow `song.measures` one to one,
 * so bar `i` of the score is `song.measures[i]`.
 */
export function songToMusicXml(song: Song, hints?: ScoreHints): WrittenScore {
  const measures: Measure[] =
    song.measures.length > 0
      ? song.measures
      : [
          {
            index: 0,
            number: '1',
            sourceIndex: 0,
            startBeat: 0,
            lengthBeats: Math.max(4, song.lengthBeats),
          },
        ];
  const times = normalise<TimeSignatureEvent>(song.timeSignatures);
  const keys = normalise<KeySignatureEvent>(song.keySignatures);
  const minor = minorKeys(song, keys);
  const tempos = normalise(song.tempos);
  const bars = measures.map((m) => ({
    start: toDivs(m.startBeat),
    end: toDivs(m.startBeat + m.lengthBeats),
  }));
  const barOf = (div: number) => {
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((bars[mid]?.start ?? 0) <= div) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const keyOfBar = measures.map((m) => {
    const k = at(keys, m.startBeat);
    return {
      fifths: k?.fifths ?? 0,
      minor: k ? (minor[keys.indexOf(k)] ?? false) : false,
      mode: k?.mode,
    };
  });

  // Segments per bar and staff.
  // Hints may come from a backup or another device: only a staff of 1 or 2 is taken.
  const staffOf = (n: SongNote) => {
    const hinted = hints?.notes[n.id]?.staff;
    return hinted === 1 || hinted === 2 ? hinted : n.staff >= 2 ? 2 : 1;
  };
  const segments: Segment[][][] = bars.map(() => [[], []]);
  const spelled: Spelling[] = [];
  song.notes.forEach((n, i) => {
    const start = toDivs(n.startBeat);
    const end = Math.max(start + SHORTEST, toDivs(n.startBeat + n.durationBeats));
    const first = barOf(start);
    const hint = hints?.notes[n.id];
    spelled[i] =
      (hint?.step !== undefined ? spellAs(n.pitch, hint.step, hint.alter ?? 0) : null) ??
      spellPitch(n.pitch, keyOfBar[first]?.fifths ?? 0, keyOfBar[first]?.minor ?? false);
    for (let b = first; b < bars.length; b++) {
      const bar = bars[b] as { start: number; end: number };
      if (bar.start >= end) break;
      const s = Math.max(start, bar.start);
      const e = Math.min(end, bar.end);
      if (e <= s) continue;
      segments[b]?.[staffOf(n) - 1]?.push({
        note: i,
        pitch: n.pitch,
        start: s - bar.start,
        end: e - bar.start,
        tieStop: s > start,
        tieStart: e < end && b + 1 < bars.length,
      });
    }
  });

  const stepOf = (note: number) => {
    const sp = spelled[note] as Spelling;
    return sp.octave * 7 + 'CDEFGAB'.indexOf(sp.step);
  };
  const clefs = ([1, 2] as const).map((staff) =>
    clefsFor(
      segments.map((bar) => (bar[staff - 1] ?? []).map((s) => stepOf(s.note))),
      staff === 1 ? 'G' : 'F',
    ),
  );

  const refs: string[][] = song.notes.map(() => []);
  const out: string[] = [];
  out.push(
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<score-partwise version="4.0">',
    `<work><work-title>${escapeXml(song.title)}</work-title></work>`,
    '<identification>',
    song.composer ? `<creator type="composer">${escapeXml(song.composer)}</creator>` : '',
    '<encoding><software>OpenTiles</software></encoding></identification>',
    '<part-list><score-part id="P1"><part-name print-object="no">Piano</part-name></score-part></part-list>',
    '<part id="P1">',
  );

  let lastTime = '';
  let lastKey = '';
  const lastClef: (Clef | undefined)[] = [undefined, undefined];
  let tempoIndex = 0;

  measures.forEach((m, b) => {
    const bar = bars[b] as { start: number; end: number };
    const length = bar.end - bar.start;
    const ts = at(times, m.startBeat) ?? { numerator: 4, denominator: 4 };
    const metre = metreOf(ts);
    const implicit = length < metre.nominal;
    out.push(`<measure number="${escapeXml(m.number)}"${implicit ? ' implicit="yes"' : ''}>`);

    const attrs: string[] = [];
    if (b === 0) attrs.push(`<divisions>${DIVISIONS}</divisions>`);
    const key = keyOfBar[b] ?? { fifths: 0, minor: false, mode: undefined };
    const keyText = `${key.fifths}:${key.minor}`;
    if (keyText !== lastKey) {
      attrs.push(
        `<key><fifths>${key.fifths}</fifths>${key.minor ? '<mode>minor</mode>' : key.mode === 'major' ? '<mode>major</mode>' : ''}</key>`,
      );
      lastKey = keyText;
    }
    const timeText = `${ts.numerator}/${ts.denominator}`;
    if (timeText !== lastTime) {
      attrs.push(
        `<time><beats>${ts.numerator}</beats><beat-type>${ts.denominator}</beat-type></time>`,
      );
      lastTime = timeText;
    }
    if (b === 0) attrs.push('<staves>2</staves>');
    for (const staff of [1, 2] as const) {
      const clef = hints?.clefs[b]?.[staff] ?? clefs[staff - 1]?.[b] ?? (staff === 1 ? 'G' : 'F');
      if (clef !== lastClef[staff - 1]) {
        attrs.push(clefXml(staff, clef));
        lastClef[staff - 1] = clef;
      }
    }
    if (attrs.length) out.push(`<attributes>${attrs.join('')}</attributes>`);

    if (b === 0) {
      const bpm = tempos[0]?.bpm;
      if (bpm) out.push(tempoMark(bpm, metre));
    }

    // Later tempo changes go in as plain <sound> elements, kept but not drawn, before the first
    // note or rest of the upper staff's main voice at or after them.
    const tempoChanges: { div: number; bpm: number }[] = [];
    while (
      tempoIndex < tempos.length &&
      toDivs((tempos[tempoIndex] as { beat: number }).beat) < bar.end
    ) {
      const t = tempos[tempoIndex] as { beat: number; bpm: number };
      if (!(b === 0 && tempoIndex === 0)) {
        tempoChanges.push({ div: Math.max(0, toDivs(t.beat) - bar.start), bpm: t.bpm });
      }
      tempoIndex += 1;
    }

    let noteIndex = 0;
    const written: string[] = [];
    for (const staff of [1, 2] as const) {
      const voices = voicesOf(segments[b]?.[staff - 1] ?? []);
      if (voices.length === 0) voices.push([]);
      // The voice that sounds longest shows all its rests.
      const sounding = voices.map((chords) => chords.reduce((sum, c) => sum + c.end - c.start, 0));
      const main = sounding.indexOf(Math.max(...sounding));
      const pieces = voices.map((chords, v) => piecesOf(chords, length, metre, v === main));
      markAccidentals(pieces, spelled, key.fifths);
      const stems = voices.length > 1;
      pieces.forEach((list, v) => {
        if (written.length) written.push(`<backup><duration>${length}</duration></backup>`);
        const voice = v + 1 + (staff - 1) * MAX_VOICES;
        for (const p of list) {
          if (p.space) {
            written.push(
              `<forward><duration>${p.divs}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`,
            );
            continue;
          }
          if (staff === 1 && v === main) {
            while (tempoChanges.length && (tempoChanges[0] as { div: number }).div <= p.start) {
              const t = tempoChanges.shift() as { bpm: number };
              written.push(`<sound tempo="${round(t.bpm)}"/>`);
            }
          }
          const ids = p.segments.map((_, i) => `p0-m${b}-n${noteIndex + i}`);
          p.segments.forEach((s, i) => refs[s.note]?.push(ids[i] as string));
          noteIndex += Math.max(1, p.segments.length);
          written.push(
            pieceXml(p, ids, voice, staff, stems ? (v === 0 ? 'up' : 'down') : undefined, spelled),
          );
        }
      });
    }
    out.push(...written);
    for (const t of tempoChanges) out.push(`<sound tempo="${round(t.bpm)}"/>`);
    if (b === measures.length - 1) {
      out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    }
    out.push('</measure>');
  });
  out.push('</part></score-partwise>\n');

  return {
    xml: out.join(''),
    song: { ...song, notes: song.notes.map((n, i) => ({ ...n, sourceRefs: refs[i] ?? [] })) },
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** The first tempo as a metronome mark: a dotted quarter in compound time. */
function tempoMark(bpm: number, metre: Metre): string {
  const dotted = metre.compound && metre.denominator === 8;
  const perMinute = Math.round(dotted ? bpm / 1.5 : bpm);
  return (
    '<direction placement="above"><direction-type><metronome parentheses="no">' +
    `<beat-unit>quarter</beat-unit>${dotted ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute>` +
    `</metronome></direction-type><sound tempo="${round(bpm)}"/></direction>`
  );
}

/**
 * Accidentals for one staff in one bar: an alteration the key signature or an earlier note on the
 * same line and octave does not give is written; a tie continuation never repeats one.
 */
function markAccidentals(voices: Piece[][], spelled: readonly Spelling[], fifths: number): void {
  const heads: { piece: Piece; i: number; start: number }[] = [];
  for (const list of voices) {
    for (const piece of list) {
      piece.accidentals = piece.segments.map(() => undefined);
      piece.segments.forEach((_, i) => heads.push({ piece, i, start: piece.start }));
    }
  }
  heads.sort((a, b) => a.start - b.start);
  const state = new Map<string, number>();
  for (const { piece, i } of heads) {
    const seg = piece.segments[i] as Segment;
    const sp = spelled[seg.note] as Spelling;
    if (seg.tieStop || !piece.first) continue;
    const line = `${sp.step}${sp.octave}`;
    const current = state.get(line) ?? keyAlter(sp.step, fifths);
    if (current !== sp.alter)
      (piece.accidentals as (string | undefined)[])[i] = ACCIDENTALS[sp.alter];
    state.set(line, sp.alter);
  }
}

/** A note, chord or rest; each note carries its ref as its id, which Verovio keeps as the glyph's. */
function pieceXml(
  p: Piece,
  ids: readonly string[],
  voice: number,
  staff: number,
  stem: 'up' | 'down' | undefined,
  spelled: readonly Spelling[],
): string {
  const typeXml = (v: Value | null) => (v ? `<type>${v.type}</type>${v.dot ? '<dot/>' : ''}` : '');
  const triplet = p.triplet
    ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
    : '';
  const tuplet = p.tuplet
    ? `<tuplet type="${p.tuplet}"${p.tuplet === 'start' ? ' bracket="no"' : ''}/>`
    : '';
  if (p.segments.length === 0) {
    const rest = p.measureRest ? '<rest measure="yes"/>' : '<rest/>';
    const notations = tuplet ? `<notations>${tuplet}</notations>` : '';
    return `<note>${rest}<duration>${p.divs}</duration><voice>${voice}</voice>${p.measureRest ? '' : typeXml(p.value)}${triplet}<staff>${staff}</staff>${notations}</note>`;
  }
  // In segment order: the refs were counted in it.
  return p.segments
    .map((seg, k) => {
      const sp = spelled[seg.note] as Spelling;
      const stop = !p.first || seg.tieStop;
      const start = !p.last || seg.tieStart;
      const ties = `${stop ? '<tie type="stop"/>' : ''}${start ? '<tie type="start"/>' : ''}`;
      const tied = `${stop ? '<tied type="stop"/>' : ''}${start ? '<tied type="start"/>' : ''}`;
      const accidental = p.accidentals?.[k];
      const beams =
        k === 0
          ? (p.beams ?? []).map((b, l) => `<beam number="${l + 1}">${b}</beam>`).join('')
          : '';
      const notations =
        tied || (k === 0 && tuplet) ? `<notations>${tied}${k === 0 ? tuplet : ''}</notations>` : '';
      return (
        `<note id="${ids[k]}">${k > 0 ? '<chord/>' : ''}<pitch><step>${sp.step}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>` +
        `<duration>${p.divs}</duration>${ties}<voice>${voice}</voice>${typeXml(p.value)}` +
        `${accidental ? `<accidental>${accidental}</accidental>` : ''}${triplet}` +
        `${stem ? `<stem>${stem}</stem>` : ''}<staff>${staff}</staff>${beams}${notations}</note>`
      );
    })
    .join('');
}

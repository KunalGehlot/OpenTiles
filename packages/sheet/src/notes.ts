// Which printed note head draws each of the song's notes (P5-18, spike). The song (from the MIDI
// file) says what is played and when; the engraved PDF says how it is written. Inside each bar
// that the alignment matched to a measure, the heads are matched to the notes: left to right
// against onset order, top to bottom against pitch, and each head where its pitch is written for
// the staff's clef. From the matches follow the staff each note is printed on, the clef of every
// staff (and octave signs), the spelling of each note (its line or space against its pitch) and
// its place on the page.
//
// Only geometry and the song are used, never the glyph shapes of a music font: MuseScore exports
// may use any of several fonts, and outlines vary by version. What a head looks like is learnt
// per file, from the heads the song explains.
import type { Song } from '@opentiles/song-model';
import type { PageResult, Staff } from './detect';

/** A note head as found on the page, with the staves it may belong to. */
export interface PrintedHead {
  /** Index of its bar in the layout (`SheetLayout.bars`). */
  bar: number;
  page: number;
  /** Centre of the head, in points from the page's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** One staff space of its system, in points. */
  space: number;
  /** Staves in its system. */
  staves: number;
  /**
   * The staves (0-based within the system, top first) it may be written on, nearest first, with
   * its position there in half spaces below the top line (0 the top line, 8 the bottom line). A
   * head between two staves gets both, and its pitch decides.
   */
  places: { staff: number; position: number }[];
}

/** Heads of every bar of the layout, in layout bar order, left to right. */
export function printedHeads(pages: readonly PageResult[]): PrintedHead[][] {
  const out: PrintedHead[][] = [];
  for (const page of pages) {
    for (const bar of page.bars) {
      const system = page.systems[bar.system];
      const heads: PrintedHead[] = [];
      for (const box of system ? bar.headBoxes : []) {
        if (!system) break;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const distance = (st: Staff) =>
          y < st.top ? st.top - y : y > st.bottom ? y - st.bottom : 0;
        const ranked = system.staves
          .map((st, staff) => ({ staff, st, d: distance(st) }))
          .sort((a, b) => a.d - b.d);
        const nearest = ranked[0]?.d ?? 0;
        const places = ranked
          // Off its staff, a head may belong to the next one too (ledger lines between staves).
          .filter((r, i) => i === 0 || (nearest > 0 && r.d < 8 * r.st.space))
          .slice(0, 2)
          .map((r) => ({
            staff: r.staff,
            position: Math.round((y - r.st.top) / (r.st.space / 2)),
          }));
        heads.push({
          bar: out.length,
          page: bar.page,
          x,
          y,
          width: box.width,
          height: box.height,
          space: system.space,
          staves: system.staves.length,
          places,
        });
      }
      out.push(heads.sort((a, b) => a.x - b.x));
    }
  }
  return out;
}

// --- Pitch and staff position -------------------------------------------------------------------

/**
 * A staff's frame is the diatonic step (octave × 7 + letter, C4 = 28) its top line sounds: F5
 * (38) under a treble clef, A3 (26) under a bass clef, an octave (7) more or less under an octave
 * sign.
 */
const TOP_LINE = { G: 38, F: 26 } as const;
export type Clef = keyof typeof TOP_LINE;

export interface Frame {
  clef: Clef;
  /** Octave sign over the notes: 1 for 8va, -1 for 8vb, 2 for 15ma, 0 for none. */
  ottava: number;
}

/** The clef and octave sign a top line's sounding step stands for, or null for none we know. */
export function frameOf(top: number): Frame | null {
  for (const clef of ['G', 'F'] as const) {
    const d = top - TOP_LINE[clef];
    if (d % 7 === 0 && Math.abs(d) <= 14) return { clef, ottava: d / 7 };
  }
  return null;
}

export const topOf = (f: Frame) => TOP_LINE[f.clef] + 7 * f.ottava;

/** Every frame the reading considers: both clefs, up to two octaves either way. */
const FRAMES: number[] = (['G', 'F'] as const).flatMap((clef) =>
  [-2, -1, 0, 1, 2].map((ottava) => topOf({ clef, ottava })),
);

const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];

/** MIDI pitch of a diatonic step with no accidental. */
const naturalPitch = (step: number) => {
  const octave = Math.floor(step / 7);
  return (octave + 1) * 12 + (NATURAL[step - octave * 7] ?? 0);
};

/** Diatonic steps a pitch can be written on, with the accidental each needs (at most double). */
function stepsFor(pitch: number): { step: number; alter: number }[] {
  const out: { step: number; alter: number }[] = [];
  const near = Math.floor(((pitch - 12) * 7) / 12);
  for (let step = near - 2; step <= near + 3; step++) {
    const alter = pitch - naturalPitch(step);
    if (Math.abs(alter) <= 2) out.push({ step, alter });
  }
  return out;
}

export interface Spelling {
  step: string;
  alter: number;
  /** Written octave, the octave sign taken off. */
  octave: number;
}

/** The spelling of a pitch written at `position` on a staff with this frame, or null if it cannot be. */
export function spellingAt(pitch: number, position: number, frame: Frame): Spelling | null {
  const sounding = topOf(frame) - position;
  const alter = pitch - naturalPitch(sounding);
  if (Math.abs(alter) > 2) return null;
  const written = sounding - 7 * frame.ottava;
  const octave = Math.floor(written / 7);
  return { step: LETTERS[written - octave * 7] ?? 'C', alter, octave };
}

/** How well a pitch fits a head at `position` on a frame: 0 on its own line or space, more off it. */
function fitCost(pitch: number, position: number, top: number): number {
  const sounding = top - position;
  const alter = Math.abs(pitch - naturalPitch(sounding));
  if (alter === 0) return 0;
  if (alter === 1) return 0.05;
  if (alter === 2) return 0.4;
  const off = Math.min(...stepsFor(pitch).map((s) => Math.abs(s.step - sounding)));
  return 0.5 + 0.35 * off;
}

/** A head exactly where the pitch is written on this frame (with a single accidental at most). */
const fits = (pitch: number, position: number, top: number) =>
  fitCost(pitch, position, top) <= 0.05;

// --- The song, bar by bar -----------------------------------------------------------------------

/** A note the bar may show: one that starts in it, or one held into it (written again, tied). */
interface Slot {
  note: number;
  pitch: number;
  /** The song's staff, 0-based (MIDI files: the track's). */
  staff: number;
  /** Starts here, or is held over the barline: it must have a head. Else a tie may repeat it. */
  required: boolean;
  /** The note starts here (not a tied repeat of it). */
  onset: boolean;
}

interface Group {
  /** Offset from the start of the measure, in beats. */
  beat: number;
  slots: Slot[];
}

interface Sounding {
  note: number;
  pitch: number;
  staff: number;
  /** Offsets from the start of the measure, in beats. */
  from: number;
  to: number;
}

const EPS = 1e-6;

/** The onsets of each measure with the notes that start there, and the notes sounding in it. */
function measuresOf(
  song: Pick<Song, 'measures' | 'notes'>,
): { groups: Group[]; sounding: Sounding[] }[] {
  const onsets = song.measures.map((): Map<number, Slot[]> => new Map());
  const sounding: Sounding[][] = song.measures.map(() => []);
  song.notes.forEach((n, i) => {
    const end = n.startBeat + n.durationBeats;
    const staff = Math.max(0, n.staff - 1);
    for (let k = Math.max(0, n.measureIndex); k < song.measures.length; k++) {
      const m = song.measures[k];
      if (!m) break;
      if (k > n.measureIndex && m.startBeat >= end - 1e-3) break;
      const beat = Math.round(Math.max(0, n.startBeat - m.startBeat) * 1e6) / 1e6;
      const groups = onsets[k] as Map<number, Slot[]>;
      const list = groups.get(beat) ?? [];
      groups.set(beat, list);
      list.push({ note: i, pitch: n.pitch, staff, required: true, onset: k === n.measureIndex });
      sounding[k]?.push({ note: i, pitch: n.pitch, staff, from: beat, to: end - m.startBeat });
    }
  });
  return onsets.map((groups, k) => {
    const here = sounding[k] ?? [];
    const list = [...groups].sort((a, b) => a[0] - b[0]);
    return {
      sounding: here,
      groups: list.map(([beat, slots]): Group => {
        // Notes still sounding from an earlier onset of the bar may be written again, tied, here.
        const tied = here
          .filter((s) => s.from < beat - EPS && s.to > beat + 1e-3)
          .map((s): Slot => ({ ...s, required: false, onset: false }));
        return { beat, slots: [...slots, ...tied] };
      }),
    };
  });
}

// --- Frames along each staff ------------------------------------------------------------------

/** Where a staff's frame changes: from this bar and x on (x in points), the top line sounds `top`. */
interface FramePoint {
  bar: number;
  x: number;
  top: number;
}

/** The frames of every staff (by index within the system) through the document. */
type Tracks = FramePoint[][];

function frameAt(tracks: Tracks, staff: number, bar: number, x: number, fallback: number): number {
  let top = fallback;
  for (const p of tracks[staff] ?? []) {
    if (p.bar > bar || (p.bar === bar && p.x > x)) break;
    top = p.top;
  }
  return top;
}

/** The usual piano layout: treble clefs, and a bass clef on the lowest of several staves. */
const usualTop = (staff: number, staves: number) =>
  staves > 1 && staff === staves - 1 ? TOP_LINE.F : TOP_LINE.G;

/**
 * Frames along each staff from the heads the song explained: the frames each head fits, through a
 * path that changes frame only when several heads in a row ask for it (a clef change or an octave
 * sign), so one wrong match does not move it.
 */
function smoothTracks(pairs: readonly Pair[], change: number): Tracks {
  const byStaff = new Map<number, { bar: number; x: number; staves: number; fit: Set<number> }[]>();
  const seen = new Set<PrintedHead>();
  for (const p of pairs) {
    if (seen.has(p.head)) continue;
    seen.add(p.head);
    const fit = new Set(FRAMES.filter((top) => fits(p.slot.pitch, p.place.position, top)));
    if (fit.size === 0) continue;
    const list = byStaff.get(p.place.staff) ?? [];
    byStaff.set(p.place.staff, list);
    list.push({ bar: p.head.bar, x: p.head.x, staves: p.head.staves, fit });
  }
  const tracks: Tracks = [];
  for (const [staff, list] of byStaff) {
    list.sort((a, b) => a.bar - b.bar || a.x - b.x);
    const states = FRAMES.length;
    const usual = usualTop(staff, list[0]?.staves ?? 1);
    let cost: number[] = FRAMES.map((top) => (top === usual ? 0 : 0.5));
    const back: Uint8Array[] = [];
    for (const obs of list) {
      const next: number[] = [];
      const from = new Uint8Array(states);
      for (let s = 0; s < states; s++) {
        let best = Infinity;
        for (let r = 0; r < states; r++) {
          const c = (cost[r] ?? Infinity) + (r === s ? 0 : change);
          if (c < best) {
            best = c;
            from[s] = r;
          }
        }
        next.push(best + (obs.fit.has(FRAMES[s] ?? 0) ? 0 : 1));
      }
      cost = next;
      back.push(from);
    }
    let s = cost.indexOf(Math.min(...cost));
    const path: number[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      path[i] = s;
      s = back[i]?.[s] ?? s;
    }
    const points: FramePoint[] = [];
    list.forEach((obs, i) => {
      const top = FRAMES[path[i] ?? 0] ?? usual;
      if (points.at(-1)?.top !== top) points.push({ bar: obs.bar, x: obs.x - 1e-3, top });
    });
    tracks[staff] = points;
  }
  return tracks;
}

// --- Matching ---------------------------------------------------------------------------------

// Costs, in units of "a note with no head".
const MISSED_NOTE = 1;
const MISSED_TIE = 0.05;
const EXTRA_HEAD = 0.8;
/** Heads of one onset spread wider than this many spaces (seconds, two voices) cost extra. */
const SPREAD = 1.7;
/** A frame other than the staff's own here (an octave sign or clef change the track missed). */
const OTHER_FRAME = 0.35;
const OTHER_STAFF = 0.2;
const CROSS_STAFF = 0.15;
/**
 * Onsets this close (in beats) may be one printed chord: notation software plays an arpeggio's
 * notes one after another, a few ticks or a sixteenth apart.
 */
const ROLL = 0.5;
const ROLLED = 0.3;

interface Pair {
  slot: Slot;
  head: PrintedHead;
  place: { staff: number; position: number };
  /** The frame the head was read with. */
  top: number;
  cost: number;
}

/** The best way to read a head as a note: on which of its staves, with which frame. */
function bestPair(slot: Slot, head: PrintedHead, tracks: Tracks): Pair {
  let out: Pair | null = null;
  head.places.forEach((place, i) => {
    const extra = (i > 0 ? OTHER_STAFF : 0) + (place.staff !== slot.staff ? CROSS_STAFF : 0);
    const own = frameAt(tracks, place.staff, head.bar, head.x, usualTop(place.staff, head.staves));
    const f = frameOf(own);
    const other = f ? topOf({ clef: f.clef === 'G' ? 'F' : 'G', ottava: f.ottava }) : own;
    for (const [top, penalty] of [
      [own, 0],
      [own + 7, OTHER_FRAME],
      [own - 7, OTHER_FRAME],
      [other, OTHER_FRAME],
    ] as const) {
      const cost = extra + penalty + fitCost(slot.pitch, place.position, top);
      if (!out || cost < out.cost) out = { slot, head, place, top, cost };
    }
  });
  return out ?? { slot, head, place: { staff: 0, position: 0 }, top: TOP_LINE.G, cost: Infinity };
}

/**
 * Pairs the notes of one onset with a run of heads, keeping their order down the page: by pitch,
 * or by the song's staff and then pitch when that differs (hands crossed within a chord: the
 * lower staff above the upper one), whichever fits better.
 */
function pairRun(
  slots: readonly Slot[],
  heads: readonly PrintedHead[],
  pairOf: (slot: Slot, head: PrintedHead) => Pair,
): { cost: number; pairs: Pair[] } {
  const hs = [...heads].sort((a, b) => a.y - b.y);
  const byPitch = [...slots].sort((a, b) => b.pitch - a.pitch || a.staff - b.staff);
  const byStaff = [...slots].sort((a, b) => a.staff - b.staff || b.pitch - a.pitch);
  const first = pairInOrder(byPitch, hs, pairOf);
  if (byStaff.every((s, i) => s === byPitch[i])) return first;
  const second = pairInOrder(byStaff, hs, pairOf);
  return second.cost < first.cost ? second : first;
}

function pairInOrder(
  notes: readonly Slot[],
  hs: readonly PrintedHead[],
  pairOf: (slot: Slot, head: PrintedHead) => Pair,
): { cost: number; pairs: Pair[] } {
  const n = notes.length;
  const m = hs.length;
  const width = m + 1;
  const cost = new Float64Array((n + 1) * width).fill(Infinity);
  const move = new Uint8Array((n + 1) * width);
  cost[0] = 0;
  const relax = (k: number, c: number, kind: number) => {
    if (c < (cost[k] ?? Infinity)) {
      cost[k] = c;
      move[k] = kind;
    }
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const k = i * width + j;
      const here = cost[k] ?? Infinity;
      if (here === Infinity) continue;
      const note = notes[i];
      const head = hs[j];
      if (note) relax(k + width, here + (note.required ? MISSED_NOTE : MISSED_TIE), 1);
      if (head) relax(k + 1, here + EXTRA_HEAD, 2);
      // A tie repeated at this onset earns its head back; a note must have one anyway.
      if (note && head)
        relax(k + width + 1, here + pairOf(note, head).cost - (note.required ? 0 : MISSED_TIE), 3);
    }
  }
  const pairs: Pair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const kind = move[i * width + j];
    if (kind === 3) {
      pairs.push(pairOf(notes[i - 1] as Slot, hs[j - 1] as PrintedHead));
      i -= 1;
      j -= 1;
    } else if (kind === 1) i -= 1;
    else if (kind === 2) j -= 1;
    else break;
  }
  return { cost: cost[n * width + m] ?? Infinity, pairs };
}

/** The notes of onsets played one after another but printed as one chord, each note once. */
function rolled(groups: readonly Group[]): Slot[] {
  const required = new Set(
    groups.flatMap((g) => g.slots.filter((s) => s.required).map((s) => s.note)),
  );
  const seen = new Set<number>();
  const out: Slot[] = [];
  for (const g of groups) {
    for (const s of g.slots) {
      if (seen.has(s.note) || (!s.required && required.has(s.note))) continue;
      seen.add(s.note);
      out.push(s);
    }
  }
  return out;
}

/**
 * Matches one measure's onsets with one bar's heads: each onset takes a run of neighbouring heads
 * (left to right in onset order), or none; heads no onset takes stay unmatched. Then a head left
 * between two onsets that sits where a note sounding over that stretch is written is that note's
 * tie, written again on a beat.
 */
function matchBar(
  measure: { groups: Group[]; sounding: Sounding[] },
  heads: readonly PrintedHead[],
  tracks: Tracks,
): Pair[] {
  const { groups } = measure;
  const n = heads.length;
  const g = groups.length;
  const width = n + 1;
  const cache = new Map<string, Pair>();
  const pairOf = (slot: Slot, head: PrintedHead) => {
    const key = `${slot.note}:${slot.onset}:${head.x}:${head.y}`;
    let p = cache.get(key);
    if (!p) {
      p = bestPair(slot, head, tracks);
      cache.set(key, p);
    }
    return p;
  };
  const cost = new Float64Array((g + 1) * width).fill(Infinity);
  const from = new Int32Array((g + 1) * width).fill(-1);
  const runs: (Pair[] | null)[] = Array.from({ length: (g + 1) * width }, () => null);
  cost[0] = 0;
  const relax = (k: number, c: number, prev: number, pairs: Pair[] | null) => {
    if (c < (cost[k] ?? Infinity)) {
      cost[k] = c;
      from[k] = prev;
      runs[k] = pairs;
    }
  };
  for (let i = 0; i <= g; i++) {
    for (let j = 0; j <= n; j++) {
      const k = i * width + j;
      const here = cost[k] ?? Infinity;
      if (here === Infinity) continue;
      // A head left over is more likely a tie written again after its note than before it.
      if (j < n) relax(k + 1, here + EXTRA_HEAD + (1e-3 * (n - j)) / n, k, null);
      const group = groups[i];
      if (!group) continue;
      const missed = group.slots.reduce((s, x) => s + (x.required ? MISSED_NOTE : 0), 0);
      relax(k + width, here + missed, k, []);
      const first = heads[j];
      if (!first) continue;
      for (let q = 1; i + q <= g; q++) {
        const lastGroup = groups[i + q - 1] as Group;
        if (lastGroup.beat - group.beat > ROLL + EPS) break;
        const slots = q === 1 ? group.slots : rolled(groups.slice(i, i + q));
        for (let r = 1; j + r <= n; r++) {
          const last = heads[j + r - 1] as PrintedHead;
          const spread = (last.x - first.x) / first.space;
          if (spread > SPREAD + 2) break;
          const { cost: c, pairs } = pairRun(slots, heads.slice(j, j + r), pairOf);
          const extra = Math.max(0, spread - SPREAD) * 0.5 + (q - 1) * ROLLED;
          relax(k + q * width + r, here + c + extra, k, pairs);
        }
      }
    }
  }
  const pairs: Pair[] = [];
  const beatOf = new Map<PrintedHead, number>();
  for (let k = g * width + n; k > 0;) {
    const run = runs[k];
    const prev = from[k] ?? -1;
    if (run) {
      const beat = groups[Math.floor(prev / width)]?.beat ?? 0;
      for (const p of run) beatOf.set(p.head, beat);
      pairs.push(...run);
    }
    if (prev < 0) break;
    k = prev;
  }
  // Ties written again between onsets.
  for (const head of heads) {
    if (beatOf.has(head)) continue;
    let before = 0;
    let after = Infinity;
    for (const [h, beat] of beatOf) {
      if (h.x < head.x) before = Math.max(before, beat);
      else after = Math.min(after, beat);
    }
    let best: Pair | null = null;
    for (const s of measure.sounding) {
      if (s.from > before + EPS || s.to <= before + 1e-3 || s.from >= after) continue;
      const p = pairOf({ ...s, required: false, onset: false }, head);
      if (p.cost <= 0.4 && (!best || p.cost < best.cost)) best = p;
    }
    if (best) pairs.push(best);
  }
  return pairs;
}

// --- What heads look like in this file ---------------------------------------------------------

/**
 * Sizes of the heads the song explained, in staff spaces. Other curved shapes that pass for heads
 * in general (letters of dynamics between the staves, ornaments) are seldom the same size as this
 * file's own heads.
 */
function headSizes(pairs: readonly Pair[]): { w: number; h: number; n: number }[] {
  const sizes: { w: number; h: number; n: number }[] = [];
  for (const p of pairs) {
    if (p.cost > 0.05) continue;
    const w = p.head.width / p.head.space;
    const h = p.head.height / p.head.space;
    const same = sizes.find((s) => Math.abs(s.w - w) <= 0.03 && Math.abs(s.h - h) <= 0.03);
    if (same) same.n += 1;
    else sizes.push({ w, h, n: 1 });
  }
  const total = sizes.reduce((s, x) => s + x.n, 0);
  // A size only one or two exact matches share is likely chance.
  return sizes.filter((s) => s.n >= Math.max(3, 0.002 * total));
}

const looksLikeHead = (head: PrintedHead, sizes: readonly { w: number; h: number }[]) => {
  const w = head.width / head.space;
  const h = head.height / head.space;
  return sizes.some((s) => Math.abs(s.w - w) <= 0.05 && Math.abs(s.h - h) <= 0.05);
};

// --- The reading ------------------------------------------------------------------------------

export interface NoteReading {
  /** The printed head: its bar, page and centre in points. */
  head: PrintedHead;
  /** Staff it is printed on, 0-based within the system. */
  staff: number;
  /** Half spaces below that staff's top line. */
  position: number;
  /** Clef and octave sign it is read with. */
  frame: Frame | null;
  /** Its spelling, when the frame gives one. */
  spelling: Spelling | null;
}

export interface BarFrame {
  /** Null before the staff's first head in the piece. */
  frame: Frame | null;
  /** Read from a head in this bar; else carried from the bar before (a bar of rests, say). */
  seen: boolean;
}

export interface NotationReading {
  /** For each song note (same order as `song.notes`), its head where one was matched. */
  notes: (NoteReading | undefined)[];
  /**
   * For each layout bar, each staff's frame at the start of the bar and where it changes inside
   * the bar.
   */
  frames: { start: BarFrame[]; changes: { staff: number; x: number; frame: Frame }[] }[];
  /** Heads per layout bar, left to right. */
  heads: PrintedHead[][];
  /** For each head, whether a note (or a tie of one) was matched to it. */
  matched: boolean[][];
  /** For each head, whether its size is one of the sizes the matched heads have in this file. */
  headLike: boolean[][];
}

/**
 * Reads the notation of a sheet from its heads and the song aligned with it
 * (`SheetMap.barOfMeasure`). The first pass assumes the usual clefs (any head may still be read
 * with the other clef or an octave sign, at a cost) and learns from its matches each staff's
 * frames through the piece and the sizes of this file's heads; the second matches again with
 * those frames and without the shapes that are not heads.
 */
export function readNotation(
  heads: readonly PrintedHead[][],
  song: Pick<Song, 'measures' | 'notes'>,
  barOfMeasure: readonly (number | null)[],
): NotationReading {
  const measures = measuresOf(song);
  const match = (tracks: Tracks, keep: (head: PrintedHead) => boolean) =>
    measures.flatMap((measure, i) => {
      const bar = barOfMeasure[i];
      if (bar == null) return [];
      return matchBar(measure, (heads[bar] ?? []).filter(keep), tracks);
    });
  const first = match([], () => true);
  const tracks = smoothTracks(first, 1.5);
  const sizes = headSizes(first);
  const headLike = heads.map((bar) => bar.map((h) => looksLikeHead(h, sizes)));
  const like = new Set(heads.flatMap((bar, b) => bar.filter((_, i) => headLike[b]?.[i])));
  const second = match(tracks, (h) => like.has(h));

  const notes: (NoteReading | undefined)[] = song.notes.map(() => undefined);
  const matchedHeads = new Set<PrintedHead>();
  const read = new Map<PrintedHead, Pair>();
  for (const p of second) {
    matchedHeads.add(p.head);
    if (!read.has(p.head) || p.slot.onset) read.set(p.head, p);
    // A note held over barlines has a head in each bar; the one where it starts names it.
    if (!p.slot.onset) continue;
    const frame = frameOf(p.top);
    notes[p.slot.note] = {
      head: p.head,
      staff: p.place.staff,
      position: p.place.position,
      frame,
      spelling: frame ? spellingAt(p.slot.pitch, p.place.position, frame) : null,
    };
  }

  // Each staff's frame head by head, as read. A frame that differs from the bar before at a
  // staff's first head in a bar is a clef (or octave sign) at the start of the bar; later ones
  // change it inside the bar.
  const running: (number | undefined)[] = [];
  const frames = heads.map((bar) => {
    const staves = Math.max(running.length, bar[0]?.staves ?? 0);
    const start = Array.from({ length: staves }, (_, s): BarFrame => {
      const top = running[s];
      return { frame: top === undefined ? null : frameOf(top), seen: false };
    });
    const changes: { staff: number; x: number; frame: Frame }[] = [];
    for (const h of bar) {
      const p = read.get(h);
      if (!p) continue;
      const staff = p.place.staff;
      const here = start[staff] ?? { frame: null, seen: false };
      start[staff] = here;
      if (!here.seen) {
        here.seen = true;
        here.frame = frameOf(p.top);
      } else if (running[staff] !== p.top) {
        const frame = frameOf(p.top);
        if (frame) changes.push({ staff, x: h.x, frame });
      }
      running[staff] = p.top;
    }
    return { start, changes };
  });
  return {
    notes,
    frames,
    heads: heads.map((bar) => [...bar]),
    matched: heads.map((bar) => bar.map((h) => matchedHeads.has(h))),
    headLike,
  };
}

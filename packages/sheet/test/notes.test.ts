// Reading the notation of a sheet from its note heads and the song beside it (P5-18). The pages
// are made up in code: one grand-staff system per bar, heads placed where an engraver would put
// them, and a song that says what is played (CC0, no real music).
import { describe, expect, it } from 'vitest';
import type { Measure, Song, SongNote } from '@opentiles/song-model';
import { frameOf, printedHeads, readNotation, spellingAt } from '../src';
import type { PageResult, Staff } from '../src';

const SPACE = 5;
const BAR_WIDTH = 40 * SPACE;
/** Top lines of the two staves, seven spaces apart as in a piano score. */
const TOPS = [100, 100 + 11 * SPACE];

interface HeadSpec {
  /** Offset from the bar's start, in spaces. */
  x: number;
  staff: 0 | 1;
  /** Half spaces below the staff's top line. */
  position: number;
  /** Width and height in spaces (a filled head unless given). */
  size?: [number, number];
}

/** One page, one system per bar, so every bar's heads are its own. */
function page(bars: readonly HeadSpec[][]): PageResult[] {
  const staff = (top: number, left: number): Staff => ({
    lines: [0, 1, 2, 3, 4].map((k) => top + k * SPACE),
    top,
    bottom: top + 4 * SPACE,
    left,
    right: left + BAR_WIDTH,
    space: SPACE,
  });
  const result: PageResult = { staves: [], systems: [], bars: [], endings: [], openEnding: false };
  bars.forEach((heads, b) => {
    const left = 40;
    const offset = b * 150;
    const staves = TOPS.map((t) => staff((t ?? 0) + offset, left));
    result.staves.push(...staves);
    result.systems.push({
      staves,
      top: staves[0]?.top ?? 0,
      bottom: staves[1]?.bottom ?? 0,
      left,
      right: left + BAR_WIDTH,
      space: SPACE,
    });
    const headBoxes = heads.map((h) => {
      const [w, hh] = h.size ?? [1.3, 1.1];
      const cx = left + h.x * SPACE;
      const cy = (staves[h.staff]?.top ?? 0) + (h.position * SPACE) / 2;
      return {
        x: cx - (w * SPACE) / 2,
        y: cy - (hh * SPACE) / 2,
        width: w * SPACE,
        height: hh * SPACE,
        curved: true,
      };
    });
    result.bars.push({
      page: 0,
      system: b,
      box: { x: left, y: staves[0]?.top ?? 0, width: BAR_WIDTH, height: 15 * SPACE },
      start: 'single',
      end: 'single',
      heads: headBoxes.length,
      headBoxes,
    });
  });
  return [result];
}

interface NoteSpec {
  pitch: number;
  /** Beat in the measure. */
  at: number;
  length?: number;
  /** 1 upper, 2 lower (the MIDI track). */
  staff?: number;
  measure: number;
}

/** A song of 4/4 measures from notes given per measure. */
function song(notes: readonly NoteSpec[], measures: number): Song {
  const ms: Measure[] = Array.from({ length: measures }, (_, i) => ({
    index: i,
    number: String(i + 1),
    sourceIndex: i,
    startBeat: 4 * i,
    lengthBeats: 4,
  }));
  const list: SongNote[] = notes
    .map((n) => ({
      id: '',
      pitch: n.pitch,
      startBeat: 4 * n.measure + n.at,
      durationBeats: n.length ?? 1,
      hand: (n.staff ?? 1) === 1 ? ('right' as const) : ('left' as const),
      staff: n.staff ?? 1,
      voice: 1,
      part: 0,
      measureIndex: n.measure,
      sourceRefs: [],
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  list.forEach((n, i) => (n.id = `n${i}`));
  return {
    title: 'Test',
    format: 'midi',
    notes: list,
    measures: ms,
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [{ beat: 0, fifths: 0 }],
    parts: [{ name: 'Piano' }],
    lengthBeats: 4 * measures,
    warnings: [],
  };
}

// Positions on a treble staff (top line F5) and a bass staff (top line A3).
const G = { C5: 3, D5: 2, E5: 1, F5: 0, B4: 4, A4: 5, G4: 6, F4: 7, E4: 8, D4: 9, C4: 10 };
const F = { A3: 0, G3: 1, F3: 2, E3: 3, D3: 4, C3: 5, B2: 6, A2: 7, G2: 8, C4: -2 };
const P = { C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76 };
const L = { C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B2: 47, A2: 45, G2: 43 };

/** Four quarter notes on each staff: a melody over a bass line, at the same four x positions. */
function plainBar(measure: number, upper: number[], lower: number[]) {
  const xs = [6, 14, 22, 30];
  const heads: HeadSpec[] = [];
  const notes: NoteSpec[] = [];
  xs.forEach((x, k) => {
    const u = upper[k];
    const l = lower[k];
    if (u !== undefined) {
      heads.push({ x, staff: 0, position: u });
      notes.push({ pitch: pitchOnTreble(u), at: k, measure });
    }
    if (l !== undefined) {
      heads.push({ x, staff: 1, position: l });
      notes.push({ pitch: pitchOnBass(l), at: k, staff: 2, measure });
    }
  });
  return { heads, notes };
}

const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const pitchOfStep = (step: number) =>
  (Math.floor(step / 7) + 1) * 12 + (NATURAL[((step % 7) + 7) % 7] ?? 0);
const pitchOnTreble = (position: number) => pitchOfStep(38 - position);
const pitchOnBass = (position: number) => pitchOfStep(26 - position);

describe('frames and spelling', () => {
  it('reads clefs and octave signs from the step of the top line', () => {
    expect(frameOf(38)).toEqual({ clef: 'G', ottava: 0 });
    expect(frameOf(26)).toEqual({ clef: 'F', ottava: 0 });
    expect(frameOf(45)).toEqual({ clef: 'G', ottava: 1 });
    expect(frameOf(19)).toEqual({ clef: 'F', ottava: -1 });
    expect(frameOf(32)).toBeNull();
  });

  it('spells a pitch by the line or space its head sits on', () => {
    const treble = { clef: 'G' as const, ottava: 0 };
    expect(spellingAt(73, G.C5, treble)).toEqual({ step: 'C', alter: 1, octave: 5 });
    expect(spellingAt(73, G.D5, treble)).toEqual({ step: 'D', alter: -1, octave: 5 });
    expect(spellingAt(72, G.B4, treble)).toEqual({ step: 'B', alter: 1, octave: 4 });
    expect(spellingAt(72, G.E4, treble)).toBeNull();
    // Under an 8va sign the head sits an octave below the sound.
    expect(spellingAt(84, G.C5, { clef: 'G', ottava: 1 })).toEqual({
      step: 'C',
      alter: 0,
      octave: 5,
    });
  });
});

describe('reading the notation', () => {
  it('matches every note to its head, on its staff, with its clef and spelling', () => {
    const a = plainBar(0, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    const b = plainBar(1, [G.A4, G.G4, G.F4, G.E4], [F.F3, F.C3, F.A2, F.C3]);
    const s = song([...a.notes, ...b.notes], 2);
    const heads = printedHeads(page([a.heads, b.heads]));
    const r = readNotation(heads, s, [0, 1]);
    expect(r.notes.every((n) => n !== undefined)).toBe(true);
    expect(r.matched.flat().every(Boolean)).toBe(true);
    s.notes.forEach((note, i) => expect(r.notes[i]?.staff).toBe(note.staff - 1));
    expect(r.frames[0]?.start.map((f) => f.frame?.clef)).toEqual(['G', 'F']);
    expect(r.frames.flatMap((f) => f.changes)).toEqual([]);
    // Each note sits further right than the one before it on its staff.
    for (const staff of [1, 2]) {
      const xs = s.notes.flatMap((n, i) => (n.staff === staff ? [r.notes[i]?.head.x ?? 0] : []));
      const perBar = [xs.slice(0, 4), xs.slice(4)];
      for (const list of perBar)
        for (let k = 1; k < list.length; k++)
          expect(list[k] ?? 0).toBeGreaterThan(list[k - 1] ?? 0);
    }
  });

  it('spells sharps and flats as written, not as a key would', () => {
    // C#5 written on the C space, then the same key written as D flat on the D line.
    const bar = plainBar(0, [G.C5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    const notes = bar.notes.map((n) =>
      n.staff === undefined && n.at < 2 ? { ...n, pitch: 73 } : n,
    );
    // B sharp: C5 sounding, written on the B line.
    const last = notes.find((n) => n.staff === undefined && n.at === 3);
    if (last) last.pitch = 72;
    const s = song(notes, 1);
    const r = readNotation(printedHeads(page([bar.heads])), s, [0]);
    const upper = s.notes.flatMap((n, i) => (n.staff === 1 ? [r.notes[i]?.spelling] : []));
    expect(upper.map((sp) => sp && `${sp.step}${sp.alter}`)).toEqual(['C1', 'D-1', 'C0', 'B1']);
  });

  it('finds a clef change at the start of a bar and one inside a bar', () => {
    // The lower staff moves to the treble clef in bar 2 and back to the bass clef halfway through
    // bar 3.
    const a = plainBar(0, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    const b = plainBar(1, [G.E5, G.D5, G.C5, G.B4], [G.G4, G.A4, G.G4, G.F4]);
    const c = plainBar(2, [G.E5, G.D5, G.C5, G.B4], [G.G4, G.A4, F.E3, F.G3]);
    const d = plainBar(3, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    const fix = (spec: ReturnType<typeof plainBar>, treble: number) => ({
      heads: spec.heads,
      notes: spec.notes.map((n) => {
        if (n.staff !== 2 || n.at >= treble) return n;
        const head = spec.heads.find((h) => h.staff === 1 && h.x === [6, 14, 22, 30][n.at]);
        return { ...n, pitch: pitchOnTreble(head?.position ?? 0) };
      }),
    });
    const bars = [a, fix(b, 4), fix(c, 2), d];
    const s = song(
      bars.flatMap((x) => x.notes),
      4,
    );
    const r = readNotation(printedHeads(page(bars.map((x) => x.heads))), s, [0, 1, 2, 3]);
    expect(r.notes.every((n) => n !== undefined)).toBe(true);
    const lower = r.frames.map((f) => f.start[1]?.frame?.clef);
    expect(lower).toEqual(['F', 'G', 'G', 'F']);
    const changes = r.frames.map((f) => f.changes.map((c) => `${c.staff}${c.frame.clef}`));
    expect(changes).toEqual([[], [], ['1F'], []]);
  });

  it('reads an octave sign over a stretch of the upper staff', () => {
    const bars = [0, 1, 2].map((m) =>
      plainBar(m, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]),
    );
    // Bars 2 and 3 sound an octave higher than written.
    const notes = bars.flatMap((x, m) =>
      x.notes.map((n) => (m > 0 && n.staff === undefined ? { ...n, pitch: n.pitch + 12 } : n)),
    );
    const s = song(notes, 3);
    const r = readNotation(printedHeads(page(bars.map((x) => x.heads))), s, [0, 1, 2]);
    expect(r.frames.map((f) => f.start[0]?.frame)).toEqual([
      { clef: 'G', ottava: 0 },
      { clef: 'G', ottava: 1 },
      { clef: 'G', ottava: 1 },
    ]);
    const first = s.notes.findIndex((n) => n.measureIndex === 1 && n.staff === 1);
    expect(r.notes[first]?.spelling).toEqual({ step: 'E', alter: 0, octave: 5 });
  });

  it('reads a note the song gives one hand but the sheet prints on the other staff', () => {
    const bar = plainBar(0, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    // A fifth note, from the lower track, written on the upper staff under the melody.
    bar.heads.push({ x: 22, staff: 0, position: G.E4 });
    bar.notes.push({ pitch: P.E4, at: 2, staff: 2, measure: 0 });
    const s = song(bar.notes, 1);
    const r = readNotation(printedHeads(page([bar.heads])), s, [0]);
    const i = s.notes.findIndex((n) => n.pitch === P.E4);
    expect(r.notes[i]?.staff).toBe(0);
    expect(r.notes.every((n) => n !== undefined)).toBe(true);
  });

  it('reads a head between the staves on the staff its pitch belongs to', () => {
    // D3 on three ledger lines below the upper staff, nearer the lower staff on the page, over
    // an A2 in the lower staff.
    const bar = plainBar(0, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.A2]);
    bar.heads.push({ x: 30, staff: 0, position: 16 });
    bar.notes.push({ pitch: pitchOnTreble(16), at: 3, measure: 0 });
    const s = song(bar.notes, 1);
    const heads = printedHeads(page([bar.heads]));
    expect(heads[0]?.find((h) => h.places.length > 1)?.places.map((p) => p.staff)).toEqual([1, 0]);
    const r = readNotation(heads, s, [0]);
    const i = s.notes.findIndex((n) => n.pitch === pitchOnTreble(16));
    expect(r.notes[i]?.staff).toBe(0);
    expect(r.notes[i]?.position).toBe(16);
  });

  it('takes a rolled chord, played note after note, as the one chord it is printed as', () => {
    const bar = plainBar(0, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    // Two more notes in the first chord, sounding a sixteenth and an eighth after it. Their heads
    // come first in the drawing, so only the chord as a whole can take them.
    bar.heads.unshift({ x: 6, staff: 0, position: G.C5 }, { x: 6, staff: 0, position: G.G4 });
    bar.notes.push(
      { pitch: P.C5, at: 0.25, measure: 0 },
      { pitch: P.G4, at: 0.5, length: 0.5, measure: 0 },
    );
    const s = song(bar.notes, 1);
    const r = readNotation(printedHeads(page([bar.heads])), s, [0]);
    expect(r.notes.every((n) => n !== undefined)).toBe(true);
    const x = (pitch: number, at: number) =>
      r.notes[s.notes.findIndex((n) => n.pitch === pitch && n.startBeat === at)]?.head.x;
    expect(x(P.C5, 0.25)).toBe(x(P.E5, 0));
  });

  it('finds a tie written again on a beat where nothing starts', () => {
    // The lower staff holds C3 from beat 0.5 to 2, written as an eighth tied to a dotted quarter
    // on beat 1; the upper staff has a half note and two quarters.
    const heads: HeadSpec[] = [
      { x: 6, staff: 0, position: G.E5 },
      { x: 6, staff: 1, position: F.G2 },
      { x: 10, staff: 1, position: F.C3 },
      { x: 14, staff: 1, position: F.C3 },
      { x: 22, staff: 0, position: G.D5 },
      { x: 22, staff: 1, position: F.E3 },
      { x: 30, staff: 0, position: G.C5 },
    ];
    const s = song(
      [
        { pitch: P.E5, at: 0, length: 2, measure: 0 },
        { pitch: L.G2, at: 0, length: 0.5, staff: 2, measure: 0 },
        { pitch: L.C3, at: 0.5, length: 1.5, staff: 2, measure: 0 },
        { pitch: P.D5, at: 2, measure: 0 },
        { pitch: L.E3, at: 2, length: 2, staff: 2, measure: 0 },
        { pitch: P.C5, at: 3, measure: 0 },
      ],
      1,
    );
    const r = readNotation(printedHeads(page([heads])), s, [0]);
    expect(r.matched[0]).toEqual([true, true, true, true, true, true, true]);
    const c3 = s.notes.findIndex((n) => n.pitch === L.C3);
    expect(r.notes[c3]?.head.x).toBe(40 + 10 * SPACE);
  });

  it('learns this file’s head sizes and leaves other shapes alone', () => {
    const bars = [0, 1].map((m) => plainBar(m, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]));
    // A dynamic letter between the staves, curved and about head-sized, but wider.
    bars[0]?.heads.push({ x: 4, staff: 0, position: 15, size: [1.7, 1.1] });
    // A half note's head, a little wider than the filled ones: the song explains it.
    bars[1]?.heads.forEach((h) => {
      if (h.staff === 0) h.size = [1.4, 1.1];
    });
    const s = song(
      bars.flatMap((b) => b.notes),
      2,
    );
    const r = readNotation(printedHeads(page(bars.map((b) => b.heads))), s, [0, 1]);
    expect(r.notes.every((n) => n !== undefined)).toBe(true);
    const decoy = r.heads[0]?.findIndex((h) => h.width === 1.7 * SPACE) ?? -1;
    expect(r.headLike[0]?.[decoy]).toBe(false);
    expect(r.matched[0]?.[decoy]).toBe(false);
    expect(r.headLike[1]?.every(Boolean)).toBe(true);
  });

  it('leaves notes without a head unmatched when the sheet abbreviates them', () => {
    // A tremolo: the song plays eight eighths, the sheet prints one head (with slashes).
    const bar = plainBar(0, [G.E5, G.D5, G.C5, G.B4], []);
    bar.heads.push({ x: 6, staff: 1, position: F.C3 });
    for (let k = 0; k < 8; k++)
      bar.notes.push({ pitch: L.C3, at: k / 2, length: 0.5, staff: 2, measure: 0 });
    const s = song(bar.notes, 1);
    const r = readNotation(printedHeads(page([bar.heads])), s, [0]);
    const tremolo = s.notes.flatMap((n, i) => (n.pitch === L.C3 ? [r.notes[i] !== undefined] : []));
    expect(tremolo).toEqual([true, false, false, false, false, false, false, false]);
    expect(r.matched[0]?.every(Boolean)).toBe(true);
  });

  it('reads a repeated bar once for each time the song plays it', () => {
    const a = plainBar(0, [G.E5, G.D5, G.C5, G.B4], [F.C3, F.G3, F.E3, F.G3]);
    const again = a.notes.map((n) => ({ ...n, measure: 1 }));
    const s = song([...a.notes, ...again], 2);
    const r = readNotation(printedHeads(page([a.heads])), s, [0, 0]);
    expect(r.notes.every((n) => n !== undefined)).toBe(true);
    s.notes.forEach((n, i) => {
      const twin = s.notes.findIndex(
        (o) =>
          o.measureIndex !== n.measureIndex &&
          o.pitch === n.pitch &&
          o.startBeat % 4 === n.startBeat % 4,
      );
      expect(r.notes[i]?.head).toBe(r.notes[twin]?.head);
    });
  });
});

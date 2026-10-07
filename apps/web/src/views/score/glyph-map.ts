// Links each `Song` note to the notehead Verovio drew for it (PLAN.md P1-15). Pure functions, so
// the matching is unit-tested in Node without a browser.
//
// Verovio's timemap lists, in playback order with repeats unrolled, which note ids start at each
// quarter-note position (`qstamp`) and which measure starts there. From it we get, for every
// rendered note, its source measure, its onset within that measure and its MIDI pitch. A `Song`
// note knows the same things (`Measure.sourceIndex`, `startBeat - measure.startBeat`, `pitch`), so
// notes are matched on (source measure, onset, pitch). That works for repeats (both passes link to
// the same glyph) and does not depend on Verovio and the song model unrolling repeats the same way.
import type { Song, SongNote } from '@opentiles/song-model';

/** One entry of Verovio's `renderToTimemap()` output (fields we use). */
export interface TimemapEntry {
  qstamp: number;
  on?: string[];
  measureOn?: string;
}

/** A note glyph as drawn by Verovio. */
export interface Glyph {
  /** Element id in the SVG (without Verovio's `-rendN` suffix for repeated passes). */
  id: string;
  /** Index of its measure in document order (matches `Measure.sourceIndex`). */
  measure: number;
  /** Onset within the measure, in quarter notes. */
  onset: number;
  /** Onset in the unrolled timemap, in quarter notes (first pass). */
  absolute: number;
  /** MIDI pitch as sounded (after Verovio's transposition). */
  pitch: number;
}

export interface ScoreLinks {
  /** Note id → glyph ids; the first is the note's own head, the rest tie continuations. */
  glyphsOf: Map<string, string[]>;
  /** Glyph id → note ids drawn by it (repeats share glyphs). */
  notesOf: Map<string, string[]>;
  /** Notes with no glyph (shown in the falling-notes view only). */
  unmatched: string[];
}

const EPS = 1e-3;
const key = (measure: number, onset: number) => `${measure}:${Math.round(onset * 96)}`;

/** Verovio marks the second and later passes of a repeat as `<id>-rend2`, `-rend3`, … */
export function baseId(id: string): string {
  return id.replace(/-rend\d+$/, '');
}

/** Measure ids in document order, from one or more SVG pages. */
export function measureOrderFromSvg(svgs: readonly string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /<g\b[^>]*\bid="([^"]+)"[^>]*\bclass="measure\b/g;
  for (const svg of svgs) {
    for (const m of svg.matchAll(re)) {
      const id = m[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * Glyphs from a timemap. `measureIds` is the document order of the measures; `pitchOf` returns a
 * note's MIDI pitch (Verovio's `getMIDIValuesForElement`), or undefined for unpitched elements.
 */
export function glyphsFromTimemap(
  timemap: readonly TimemapEntry[],
  measureIds: readonly string[],
  pitchOf: (id: string) => number | undefined,
): Glyph[] {
  const measureIndex = new Map(measureIds.map((id, i) => [id, i]));
  const glyphs: Glyph[] = [];
  const seen = new Set<string>();
  let measure = -1;
  let measureStart = 0;
  for (const e of timemap) {
    if (e.measureOn !== undefined) {
      measure = measureIndex.get(baseId(e.measureOn)) ?? measure;
      measureStart = e.qstamp;
    }
    for (const raw of e.on ?? []) {
      const id = baseId(raw);
      if (seen.has(id) || measure < 0) continue;
      seen.add(id);
      const pitch = pitchOf(id);
      if (pitch === undefined) continue;
      glyphs.push({ id, measure, onset: e.qstamp - measureStart, absolute: e.qstamp, pitch });
    }
  }
  return glyphs;
}

/**
 * Matches song notes to glyphs. Tried in order for each note: same source measure, onset and
 * pitch; same measure and onset at the closest pitch (octave signs, transposition the renderer did
 * not apply); the same unrolled onset and pitch (scores whose bars the two readers count
 * differently). Tied notes also take the glyphs of their continuations.
 */
export function linkNotes(song: Song, glyphs: readonly Glyph[]): ScoreLinks {
  const byPos = new Map<string, Glyph[]>();
  const byAbs = new Map<string, Glyph[]>();
  for (const g of glyphs) {
    const k = key(g.measure, g.onset);
    (byPos.get(k) ?? byPos.set(k, []).get(k))?.push(g);
    const a = key(0, g.absolute);
    (byAbs.get(a) ?? byAbs.set(a, []).get(a))?.push(g);
  }
  const glyphsOf = new Map<string, string[]>();
  const notesOf = new Map<string, string[]>();
  const unmatched: string[] = [];
  // Glyphs taken within one playback measure, so two unison notes take two glyphs.
  const taken = new Map<number, Set<string>>();
  const link = (note: SongNote, glyph: string) => {
    const list = glyphsOf.get(note.id) ?? [];
    if (!list.includes(glyph)) list.push(glyph);
    glyphsOf.set(note.id, list);
    const notes = notesOf.get(glyph) ?? [];
    if (!notes.includes(note.id)) notes.push(note.id);
    notesOf.set(glyph, notes);
  };

  const heads = song.notes.map((n) => {
    const m = song.measures[n.measureIndex];
    const used = taken.get(n.measureIndex) ?? new Set<string>();
    taken.set(n.measureIndex, used);
    const free = (g: Glyph) => !used.has(g.id);
    let found: Glyph | undefined;
    if (m) {
      const here = (byPos.get(key(m.sourceIndex, n.startBeat - m.startBeat)) ?? []).filter(free);
      found =
        here.find((g) => g.pitch === n.pitch) ??
        [...here].sort((a, b) => Math.abs(a.pitch - n.pitch) - Math.abs(b.pitch - n.pitch))[0];
    }
    found ??= (byAbs.get(key(0, n.startBeat)) ?? []).find((g) => free(g) && g.pitch === n.pitch);
    if (found) {
      used.add(found.id);
      link(n, found.id);
    } else {
      unmatched.push(n.id);
    }
    return found;
  });

  // Tie continuations: glyphs of the same pitch that start inside a tied note.
  song.notes.forEach((n, i) => {
    const head = heads[i];
    if (!head || n.sourceRefs.length < 2) return;
    const end = n.startBeat + n.durationBeats;
    for (const m of song.measures) {
      if (m.startBeat >= end - EPS) break;
      if (m.startBeat + m.lengthBeats <= n.startBeat + EPS) continue;
      for (const g of glyphs) {
        if (g.measure !== m.sourceIndex || g.pitch !== head.pitch || g.id === head.id) continue;
        const at = m.startBeat + g.onset;
        if (at > n.startBeat + EPS && at < end - EPS) link(n, g.id);
      }
    }
  });

  return { glyphsOf, notesOf, unmatched };
}

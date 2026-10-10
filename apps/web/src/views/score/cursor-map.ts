// Beat → position on the rendered score, for the cursor (PLAN.md P1-15, P2-11). Pure.
//
// Anchors are built per playback measure: the barline on the left, each linked note's head, the
// barline on the right. Between two anchors of the same measure the cursor moves linearly, so it
// glides through a bar in time with the music and jumps back at a repeat.
import type { Song } from '@opentiles/song-model';

/** Where a source measure was drawn (pixels, relative to the rendered page). */
export interface MeasureBox {
  left: number;
  right: number;
  /** Top and height of the system (line of music) the measure is on. */
  top: number;
  height: number;
  /** 1-based page number (always 1 in the scrolling view). */
  page: number;
}

export interface Anchor {
  beat: number;
  x: number;
  top: number;
  height: number;
  page: number;
}

export type CursorPosition = Omit<Anchor, 'beat'>;

/**
 * `measureBoxes` is indexed by source measure; `noteX` gives the centre of a note's head. Notes
 * whose glyph is on another page than their measure box are ignored.
 */
export function buildAnchors(
  song: Song,
  measureBoxes: ReadonlyMap<number, MeasureBox>,
  noteX: ReadonlyMap<string, number>,
): Anchor[] {
  const notesByMeasure = new Map<number, { beat: number; x: number }[]>();
  for (const n of song.notes) {
    const x = noteX.get(n.id);
    if (x === undefined) continue;
    const list = notesByMeasure.get(n.measureIndex) ?? [];
    list.push({ beat: n.startBeat, x });
    notesByMeasure.set(n.measureIndex, list);
  }
  const anchors: Anchor[] = [];
  for (const m of song.measures) {
    const box = measureBoxes.get(m.sourceIndex);
    if (!box) continue;
    const row = { top: box.top, height: box.height, page: box.page };
    const end = m.startBeat + m.lengthBeats;
    // Chord notes share a beat: one anchor at their mean x.
    const byBeat = new Map<number, number[]>();
    for (const p of notesByMeasure.get(m.index) ?? []) {
      if (p.x < box.left - 1 || p.x > box.right + 1) continue;
      const k = Math.round(p.beat * 960) / 960;
      byBeat.set(k, [...(byBeat.get(k) ?? []), p.x]);
    }
    const notes = [...byBeat.entries()]
      .map(([beat, xs]) => ({ beat, x: xs.reduce((a, b) => a + b, 0) / xs.length }))
      .sort((a, b) => a.beat - b.beat);
    // A note on the downbeat replaces the barline, so a cursor waiting there sits on the note.
    if (!notes.some((p) => Math.abs(p.beat - m.startBeat) < 1e-6)) {
      anchors.push({ beat: m.startBeat, x: box.left, ...row });
    }
    let lastX = box.left;
    for (const p of notes) {
      // Keep x monotonic inside a bar (grace notes or cross-voice spacing can jitter).
      lastX = Math.max(lastX, p.x);
      anchors.push({ beat: p.beat, x: lastX, ...row });
    }
    anchors.push({ beat: end, x: box.right, ...row });
  }
  return withoutBarlineSteps(anchors);
}

/** Cursor position at `beat`; null when there are no anchors. */
export function positionAt(anchors: readonly Anchor[], beat: number): CursorPosition | null {
  if (anchors.length === 0) return null;
  // Last anchor at or before `beat` (later anchors win at equal beats: the next bar's start).
  let lo = 0;
  let hi = anchors.length - 1;
  const first = anchors[0];
  if (!first || beat <= first.beat) return first ? strip(first) : null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((anchors[mid]?.beat ?? Infinity) <= beat + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  const a = anchors[lo];
  const b = anchors[lo + 1];
  if (!a) return null;
  if (!b || b.page !== a.page || b.top !== a.top || b.beat <= a.beat) return strip(a);
  const f = (beat - a.beat) / (b.beat - a.beat);
  return { ...strip(a), x: a.x + (b.x - a.x) * f };
}

/**
 * The beat drawn at `x` on one row (the scrolling view's single system): the inverse of positionAt,
 * for scrubbing (P4-18). Where a repeat draws the same bars twice, the pass nearest `near` wins, so
 * dragging inside a repeat keeps going through the pass the learner is in.
 */
export function beatAt(anchors: readonly Anchor[], x: number, near: number): number | null {
  if (anchors.length === 0) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i] as Anchor;
    const b = anchors[i + 1] as Anchor;
    if (b.page !== a.page || b.top !== a.top || b.beat <= a.beat) continue;
    if (x < Math.min(a.x, b.x) - 0.5 || x > Math.max(a.x, b.x) + 0.5) continue;
    const f = b.x === a.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
    const beat = a.beat + (b.beat - a.beat) * f;
    const distance = Math.abs(beat - near);
    if (distance < bestDistance) {
      best = beat;
      bestDistance = distance;
    }
  }
  if (best !== null) return best;
  // Before the first note, after the last, or in a gap between rows: the nearest anchor.
  let nearest = anchors[0] as Anchor;
  for (const a of anchors) {
    const d = Math.abs(a.x - x) - Math.abs(nearest.x - x);
    if (d < -0.5 || (Math.abs(d) <= 0.5 && Math.abs(a.beat - near) < Math.abs(nearest.beat - near)))
      nearest = a;
  }
  return nearest.beat;
}

function strip(a: Anchor): CursorPosition {
  return { x: a.x, top: a.top, height: a.height, page: a.page };
}

/**
 * A bar's closing anchor sits on its right barline and the next bar opens on its first note, a
 * few pixels further on. With both, the cursor reaches the barline and then steps to the note, and
 * the whole score steps with it. Where the next bar is on the same row, the cursor glides from the
 * last note straight to the next bar's first note instead; a new row or page, or a repeat, keeps
 * its jump.
 */
function withoutBarlineSteps(anchors: Anchor[]): Anchor[] {
  return anchors.filter((a, i) => {
    const next = anchors[i + 1];
    return !(
      next &&
      Math.abs(next.beat - a.beat) < 1e-6 &&
      next.page === a.page &&
      next.top === a.top &&
      next.x >= a.x - 1
    );
  });
}

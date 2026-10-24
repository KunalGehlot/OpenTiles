// Scale fingering (P7-16, ADR 0024). The suggested fingering (fingering.ts) prices each step on its
// own and puts thumbs on black keys in most scales, so scales get the fingering that scale books
// print, worked out here from the rules those books follow rather than copied from their tables:
//
// - A seven-note scale is played in groups of three and four fingers, so each hand's thumb comes
//   twice an octave, three and four notes apart.
// - The thumb never takes a black key.
// - A white tonic takes the thumb (C major: 1 2 3 1 2 3 4 5 in the right hand).
// - Otherwise the thumb takes the white key just after a black one in the direction it passes
//   under: going up for the right hand (F and C in B♭ major), going down for the left (D and A).
// - Left over, the right hand starts its group of three on the tonic and the left hand ends its
//   group of three there (G major, left hand: 5 4 3 2 1 3 2 1).
// - At the ends, the bottom note of the left hand and the top note of the right hand take the next
//   finger instead of the thumb (5 or 4), and a right hand that would start on its fourth finger
//   starts on 2, as books print B♭ major (2 1 2 3 1 2 3 4).
//
// That reproduces the standard fingerings of every major and harmonic minor scale (the tests hold
// the table). Where books differ, the rules pick one: G♯ harmonic minor's left hand gets
// 3 2 1 4 3 2 1 3 (some books print 3 2 1 3 2 1 4 3). The chromatic scale has its own: 3 on black
// keys, 1 on white keys, and 2 where two white keys meet (F and C going up in the right hand, E and
// B in the left). Pentatonic and blues scales have no single standard and get none (ADR 0024, Q5).
import { pitchClassOf } from './chords';
import type { Finger } from './fingering';
import { isHeptatonic, scaleNotes } from './scales';
import type { Scale, ScaleNote } from './scales';

export type ScaleHand = 'right' | 'left';

const BLACK = new Set([1, 3, 6, 8, 10]);
const pcOf = (midi: number) => ((midi % 12) + 12) % 12;

/**
 * Fingers by degree (0 is the tonic) for seven pitch classes going up, from the rules above:
 * the cyclic pattern the hand repeats every octave.
 */
export function degreeFingers(pitchClasses: readonly number[], hand: ScaleHand): Finger[] {
  const black = (d: number) => BLACK.has(pitchClasses[((d % 7) + 7) % 7] ?? 0);
  const options = [0, 1, 2, 3, 4, 5, 6].map((s) => {
    // The right hand's group of three starts at `s` (1 2 3), its group of four follows (1 2 3 4);
    // the left hand's group of three ends at `s` (3 2 1) and its group of four follows (4 3 2 1).
    const thumbs = hand === 'right' ? [s, (s + 3) % 7] : [s, (s + 4) % 7];
    const fingers = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const offset = (d - s + 7) % 7;
      if (hand === 'right') return (offset < 3 ? offset + 1 : offset - 2) as Finger;
      return ([1, 4, 3, 2, 1, 3, 2] as const)[offset] as Finger;
    });
    const step = hand === 'right' ? -1 : 1;
    return {
      s,
      fingers,
      valid: thumbs.every((d) => !black(d)),
      tonic: thumbs.includes(0) ? 1 : 0,
      afterBlack: thumbs.filter((d) => black(d + step)).length,
    };
  });
  const tonicWhite = !black(0);
  const best = options
    .filter((o) => o.valid)
    .sort(
      (a, b) =>
        (tonicWhite ? b.tonic - a.tonic : 0) ||
        b.afterBlack - a.afterBlack ||
        (a.s === 0 ? -1 : 0) - (b.s === 0 ? -1 : 0) ||
        a.s - b.s,
    )[0];
  return best?.fingers ?? [1, 2, 3, 1, 2, 3, 4];
}

/** One octave's pitch classes of a scale going up or coming down, by degree. */
function formOf(scale: Scale, direction: 'up' | 'down'): number[] {
  const notes = scaleNotes(scale, 60 + pitchClassOf(scale.tonic), 1);
  const run = notes.filter((n) => n.direction === direction || n.degree === 0);
  const byDegree: number[] = [];
  for (const n of run) byDegree[n.degree] = pcOf(n.midi);
  return byDegree;
}

const CHROMATIC_TWO: Record<ScaleHand, ReadonlySet<number>> = {
  right: new Set([5, 0]),
  left: new Set([4, 11]),
};

/**
 * The finger for each note of a scale run (from `scaleNotes`), or null for a kind with no standard
 * fingering. The same note gets the same finger going up and coming down; a melodic minor's notes
 * take the fingers of the form they belong to, its top note those of the way down.
 */
export function scaleFingers(
  scale: Scale,
  notes: readonly ScaleNote[],
  hand: ScaleHand,
): Finger[] | null {
  if (scale.kind === 'chromatic') {
    // The 2 is for the second white key of a pair in the direction the thumb leads; at the end the
    // run starts or turns on, there is no pair and the thumb plays it.
    const end =
      hand === 'right'
        ? Math.min(...notes.map((n) => n.midi))
        : Math.max(...notes.map((n) => n.midi));
    return notes.map((n) => {
      const pc = pcOf(n.midi);
      if (BLACK.has(pc)) return 3;
      return CHROMATIC_TWO[hand].has(pc) && n.midi !== end ? 2 : 1;
    });
  }
  if (!isHeptatonic(scale.kind)) return null;
  const up = degreeFingers(formOf(scale, 'up'), hand);
  const down = degreeFingers(formOf(scale, 'down'), hand);
  const low = Math.min(...notes.map((n) => n.midi));
  const high = Math.max(...notes.map((n) => n.midi));
  const plain = (n: ScaleNote) =>
    (n.direction === 'down' || n.midi === high ? down : up)[n.degree] ?? 1;
  return notes.map((n, i) => {
    const finger = plain(n);
    // The neighbour of an end note: the next note of the run, or the one before at its end.
    const near = notes[i + 1] ?? notes[i - 1];
    const next = near ? plain(near) : 1;
    if (n.midi === low) {
      if (hand === 'left' && finger === 1) return Math.min(5, next + 1) as Finger;
      if (hand === 'right' && finger === 4) return 2;
    }
    if (n.midi === high && hand === 'right' && finger === 1) return Math.min(5, next + 1) as Finger;
    return finger;
  });
}

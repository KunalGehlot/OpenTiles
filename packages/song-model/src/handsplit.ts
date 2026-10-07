// Hand split for single-track MIDI (spec §8): split around middle C, adjusted so that each
// hand's line stays smooth and playable.
import type { Hand } from './types';

export interface PitchAt {
  pitch: number;
  startBeat: number;
}

/** Notes within this distance of the split point are assigned by proximity to each hand. */
const AMBIGUOUS = 5;
/** Widest span one hand plays at once (a ninth). */
const MAX_SPAN = 14;
const MAX_NOTES_PER_HAND = 5;

/**
 * Returns a hand for each note (same order as the input).
 *
 * Notes are processed chord by chord. Clear cases go by the split point; notes near it go to the
 * hand whose recent position is closer, so a melody that dips just below middle C stays in the
 * right hand. Chords are then fixed up so no hand spans more than a ninth or holds more than five
 * notes.
 */
export function splitHands(notes: readonly PitchAt[], splitPoint = 60): Hand[] {
  const order = notes
    .map((n, i) => ({ ...n, i }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const hands: Hand[] = new Array<Hand>(notes.length).fill('right');
  let right = splitPoint + 7;
  let left = splitPoint - 12;

  let k = 0;
  while (k < order.length) {
    const start = order[k]?.startBeat ?? 0;
    const chord: typeof order = [];
    while (k < order.length && Math.abs((order[k]?.startBeat ?? 0) - start) < 1e-6) {
      chord.push(order[k] as (typeof order)[number]);
      k += 1;
    }
    // chord is sorted by pitch (ascending).
    const assign = chord.map((n): Hand => {
      if (n.pitch >= splitPoint + AMBIGUOUS) return 'right';
      if (n.pitch < splitPoint - AMBIGUOUS) return 'left';
      return Math.abs(n.pitch - right) <= Math.abs(n.pitch - left) ? 'right' : 'left';
    });
    // Keep hands from crossing inside a chord: everything below a left note is left.
    for (let j = assign.length - 2; j >= 0; j--) {
      if (assign[j + 1] === 'left') assign[j] = 'left';
    }
    // Span and finger limits.
    const fix = () => {
      const rh = chord.filter((_, j) => assign[j] === 'right');
      const lh = chord.filter((_, j) => assign[j] === 'left');
      const span = (xs: typeof chord) =>
        xs.length === 0 ? 0 : (xs[xs.length - 1]?.pitch ?? 0) - (xs[0]?.pitch ?? 0);
      if (
        (span(rh) > MAX_SPAN || rh.length > MAX_NOTES_PER_HAND) &&
        lh.length < MAX_NOTES_PER_HAND
      ) {
        assign[chord.indexOf(rh[0] as (typeof chord)[number])] = 'left';
        return true;
      }
      if (
        (span(lh) > MAX_SPAN || lh.length > MAX_NOTES_PER_HAND) &&
        rh.length < MAX_NOTES_PER_HAND
      ) {
        assign[chord.indexOf(lh[lh.length - 1] as (typeof chord)[number])] = 'right';
        return true;
      }
      return false;
    };
    for (let guard = 0; guard < 10 && fix(); guard++);

    chord.forEach((n, j) => (hands[n.i] = assign[j] ?? 'right'));
    const rp = chord.filter((_, j) => assign[j] === 'right').map((n) => n.pitch);
    const lp = chord.filter((_, j) => assign[j] === 'left').map((n) => n.pitch);
    if (rp.length) right = 0.6 * right + 0.4 * (rp.reduce((s, p) => s + p, 0) / rp.length);
    if (lp.length) left = 0.6 * left + 0.4 * (lp.reduce((s, p) => s + p, 0) / lp.length);
  }
  return hands;
}

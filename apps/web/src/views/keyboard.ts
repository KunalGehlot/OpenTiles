// Piano keyboard geometry and hit testing (pure, unit-tested).
import { isBlackKey } from '@opentiles/song-model';

export interface KeyRect {
  pitch: number;
  x: number;
  width: number;
  black: boolean;
}

export interface KeyboardLayout {
  low: number;
  high: number;
  whiteWidth: number;
  keys: KeyRect[];
}

/** Black keys sit across the boundary of white keys, nudged as on a real keyboard. */
const BLACK_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };
export const BLACK_WIDTH = 0.6;
export const BLACK_HEIGHT = 0.62;

/** The widest a white key is drawn (CSS px); on a wide window the keyboard grows, then centres. */
export const MAX_WHITE_WIDTH = 64;

function whiteCount(lo: number, hi: number): number {
  let n = 0;
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) n += 1;
  return n;
}

/**
 * Widens a range by whole octaves, alternately down and up, until the white keys are no wider than
 * `MAX_WHITE_WIDTH` at `width`, or the piano's 88 keys are all there. A narrow window keeps the range.
 */
export function widenRange(
  range: { low: number; high: number },
  width: number,
): { low: number; high: number } {
  let { low, high } = range;
  let down = true;
  for (let guard = 0; guard < 16; guard++) {
    if (width <= 0 || width / whiteCount(low, high) <= MAX_WHITE_WIDTH) break;
    const nextLow = Math.max(21, low - 12);
    const nextHigh = Math.min(108, high + 12);
    if (down && nextLow < low) low = nextLow;
    else if (nextHigh > high) high = nextHigh;
    else if (nextLow < low) low = nextLow;
    else break;
    down = !down;
  }
  return { low, high };
}

export function layoutKeyboard(
  low: number,
  high: number,
  width: number,
  maxWhite = Infinity,
): KeyboardLayout {
  let lo = low;
  let hi = high;
  if (isBlackKey(lo)) lo -= 1;
  if (isBlackKey(hi)) hi += 1;
  let whites = 0;
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) whites += 1;
  const whiteWidth = Math.min(width / Math.max(1, whites), maxWhite);
  const keys: KeyRect[] = [];
  let x = Math.max(0, (width - whiteWidth * whites) / 2);
  for (let p = lo; p <= hi; p++) {
    if (isBlackKey(p)) {
      const offset = BLACK_OFFSET[p % 12] ?? 0;
      const w = whiteWidth * BLACK_WIDTH;
      keys.push({ pitch: p, x: x - w / 2 + offset * whiteWidth, width: w, black: true });
    } else {
      keys.push({ pitch: p, x, width: whiteWidth, black: false });
      x += whiteWidth;
    }
  }
  return { low: lo, high: hi, whiteWidth, keys };
}

/** The pitch under a point; `y` is measured from the top of the keyboard, `height` its height. */
export function hitTest(
  layout: KeyboardLayout,
  x: number,
  y: number,
  height: number,
): number | null {
  if (y < height * BLACK_HEIGHT) {
    for (const k of layout.keys) if (k.black && x >= k.x && x < k.x + k.width) return k.pitch;
  }
  for (const k of layout.keys) if (!k.black && x >= k.x && x < k.x + k.width) return k.pitch;
  return null;
}

/** A keyboard range covering `pitches` with some room, at least two octaves, starting on a C. */
export function rangeFor(pitches: readonly number[], minSpan = 24): { low: number; high: number } {
  if (pitches.length === 0) return { low: 48, high: 84 };
  let low = Math.min(...pitches) - 2;
  let high = Math.max(...pitches) + 2;
  while (high - low < minSpan) {
    low -= 1;
    high += 1;
  }
  low = Math.max(21, low - (low % 12));
  high = Math.min(108, high + ((12 - (high % 12)) % 12));
  return { low, high };
}

export function keyAt(layout: KeyboardLayout, pitch: number): KeyRect | undefined {
  return layout.keys.find((k) => k.pitch === pitch);
}

/**
 * Height of the on-screen keyboard at the bottom of a practice canvas: tall enough to tap, but
 * never more than 40 % of the canvas, so short landscape windows (phones, small Stage Manager
 * windows) keep room for the falling notes (P1-27).
 */
export function keyboardHeightFor(canvasHeight: number, whiteWidth: number): number {
  return Math.min(170, canvasHeight * 0.4, Math.max(70, canvasHeight * 0.3, whiteWidth * 4.2));
}

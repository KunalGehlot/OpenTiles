// What the Player draws while a piece plays (P6-06): a keyboard with the sounding keys lit in the
// hand colours, the notes rising from the keys ("stage"), and the picture of the whole piece used
// as its seek bar. Called from requestAnimationFrame with the position read through refs; React
// never redraws these.
import type { Song } from '@opentiles/song-model';
import { noteMarks } from '../practice/overview';
import type { Palette } from '../views/renderer';
import { BLACK_HEIGHT, layoutKeyboard, rangeFor } from '../views/keyboard';
import type { KeyboardLayout } from '../views/keyboard';

export type Lit = Map<number, 'left' | 'right'>;

/** Keys sounding at `beat`, with the hand that plays each. */
export function soundingAt(song: Song, beat: number): Lit {
  const lit: Lit = new Map();
  for (const n of song.notes) {
    if (n.startBeat > beat) break;
    if (n.startBeat + n.durationBeats > beat) lit.set(n.pitch, n.hand);
  }
  return lit;
}

/** The keyboard for a piece across `width`: its range, widened to whole octaves around it. */
export function stageLayout(song: Song, width: number): KeyboardLayout {
  const { low, high } = rangeFor(
    song.notes.map((n) => n.pitch),
    36,
  );
  const lo = Math.max(21, low - (low % 12));
  const hi = Math.min(108, high + (11 - (high % 12)));
  return layoutKeyboard(lo, hi, width);
}

/** Draws the keys from `top` down `height` px, the lit ones in their hand's colour. */
export function drawKeys(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardLayout,
  top: number,
  height: number,
  lit: Lit,
  p: Palette,
): void {
  const colourOf = (pitch: number) => {
    const hand = lit.get(pitch);
    return hand === 'left' ? p.left : hand === 'right' ? p.right : null;
  };
  for (const k of layout.keys) {
    if (k.black) continue;
    ctx.fillStyle = colourOf(k.pitch) ?? p.white;
    ctx.fillRect(k.x + 0.5, top, k.width - 1, height);
    ctx.fillStyle = p.whiteEdge;
    ctx.fillRect(k.x + k.width - 0.5, top, 1, height);
  }
  const blackHeight = height * BLACK_HEIGHT;
  for (const k of layout.keys) {
    if (!k.black) continue;
    ctx.fillStyle = colourOf(k.pitch) ?? p.black;
    ctx.beginPath();
    ctx.roundRect(k.x, top, k.width, blackHeight, [0, 0, 3, 3]);
    ctx.fill();
  }
  // The keybed's shadow along the top edge.
  const shade = ctx.createLinearGradient(0, top, 0, top + Math.min(10, height * 0.12));
  shade.addColorStop(0, p.keybed);
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, top, layout.keys.length ? ctx.canvas.width : 0, Math.min(10, height * 0.12));
}

/**
 * The stage: notes rise out of the keys as they are played and float up once released, over the
 * keyboard at the bottom. `beatsShown` beats fit between the keys and the top.
 */
export function drawStage(
  ctx: CanvasRenderingContext2D,
  song: Song,
  layout: KeyboardLayout,
  width: number,
  height: number,
  keysHeight: number,
  beat: number,
  p: Palette,
  beatsShown = 8,
): void {
  const keysTop = height - keysHeight;
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, width, height);
  const perBeat = keysTop / beatsShown;
  const keyOf = new Map(layout.keys.map((k) => [k.pitch, k]));
  for (const n of song.notes) {
    if (n.startBeat > beat) break;
    const end = n.startBeat + n.durationBeats;
    if (beat - end > beatsShown) continue;
    const k = keyOf.get(n.pitch);
    if (!k) continue;
    const top = keysTop - (beat - n.startBeat) * perBeat;
    const bottom = keysTop - Math.max(0, beat - end) * perBeat;
    // Older notes fade as they rise.
    ctx.globalAlpha = Math.max(0, Math.min(1, 1 - (keysTop - bottom) / keysTop));
    ctx.fillStyle = n.hand === 'left' ? p.left : p.right;
    const w = k.black ? k.width : k.width - 3;
    const x = k.black ? k.x : k.x + 1.5;
    ctx.beginPath();
    ctx.roundRect(x, top, w, Math.max(2, bottom - top), Math.min(4, w / 3));
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawKeys(ctx, layout, keysTop, keysHeight, soundingAt(song, beat), p);
}

/**
 * The whole piece as a strip of marks, lit up to `fraction` (the part already played), with a line
 * at the position. The Player's seek bar (P5-07's overview picture).
 */
export function drawSeekPicture(
  ctx: CanvasRenderingContext2D,
  song: Song,
  width: number,
  height: number,
  fraction: number,
  p: Palette,
  unplayed: string,
): void {
  ctx.clearRect(0, 0, width, height);
  const at = fraction * width;
  for (const m of noteMarks(song)) {
    const x = m.x * width;
    ctx.fillStyle = x < at ? (m.hand === 'left' ? p.left : p.right) : unplayed;
    ctx.fillRect(x, m.y * (height - 3), Math.max(1.5, m.width * width - 0.5), 3);
  }
  ctx.fillStyle = p.text;
  ctx.fillRect(Math.round(at) - 1, 0, 2, height);
}

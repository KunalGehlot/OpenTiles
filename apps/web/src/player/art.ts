// Generated cover art for the Player (P6-06): each piece gets a cover drawn from its own notes, a
// small piano roll of its opening on a colour chosen by its composer. Nothing is downloaded and no
// image is copied, so covers are CC0 by construction. The geometry is pure (unit-tested); drawing
// takes a canvas context.
import type { Song } from '@opentiles/song-model';
import type { Rgb } from '../views/colour';
import { rgba } from '../views/colour';

/** Cover colours in styles/tokens.css: --cover-1 … --cover-8. */
export const COVER_COUNT = 8;

/** Words left out of initials: name particles and the catalogue's "Traditional (…)" notes. */
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'la', 'le', 'du', 'di', 'da', 'del']);

function words(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,.;:/-]+/)
    .filter((w) => w && !PARTICLES.has(w.toLowerCase()) && /\p{L}/u.test(w));
}

/** 1 … COVER_COUNT, the same every time for the same name (FNV-1a over its words). */
export function coverIndex(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of words(name).join(' ').toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % COVER_COUNT) + 1;
}

/** Up to two letters: "Ludwig van Beethoven" → "LB", "Traditional (German …)" → "Tr". */
export function initials(name: string): string {
  const w = words(name);
  const first = w[0];
  if (!first) return '♪';
  const last = w.length > 1 ? w[w.length - 1] : undefined;
  if (!last) return [...first].slice(0, 2).join('');
  return ([...first][0] ?? '').toUpperCase() + ([...last][0] ?? '').toUpperCase();
}

/** A note of the cover's piano roll, in 0..1 of the cover (y from the top). */
export interface CoverNote {
  x: number;
  y: number;
  width: number;
  height: number;
  right: boolean;
}

/**
 * The opening `beats` of a song as a piano roll filling the cover: time across, pitch up. Empty
 * for a song without notes (a sheet-only piece).
 */
export function coverNotes(song: Song, beats = 16): CoverNote[] {
  const opening = song.notes.filter((n) => n.startBeat < beats);
  if (opening.length === 0) return [];
  let low = Infinity;
  let high = -Infinity;
  for (const n of opening) {
    low = Math.min(low, n.pitch);
    high = Math.max(high, n.pitch);
  }
  const span = Math.max(12, high - low + 1);
  const mid = (low + high) / 2;
  const end = Math.min(beats, Math.max(...opening.map((n) => n.startBeat + n.durationBeats)));
  const rowHeight = 0.7 / span;
  return opening.map((n) => ({
    x: 0.1 + (n.startBeat / end) * 0.8,
    width: Math.max(0.012, (Math.min(n.durationBeats, end - n.startBeat) / end) * 0.8 - 0.008),
    y: 0.5 - ((n.pitch - mid) / span) * 0.7 - rowHeight / 2,
    height: Math.max(0.018, rowHeight * 0.92),
    right: n.hand === 'right',
  }));
}

/** Draws a cover into a square of `size` CSS px at the context's origin. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  size: number,
  notes: readonly CoverNote[],
  colour: Rgb,
  ink: Rgb,
  radius = size * 0.06,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.clip();
  // The colour, a little lighter towards the top left, as if lit from there.
  const lit: Rgb = [
    Math.min(255, colour[0] + 38),
    Math.min(255, colour[1] + 38),
    Math.min(255, colour[2] + 38),
  ];
  const wash = ctx.createLinearGradient(0, 0, size, size);
  wash.addColorStop(0, `rgb(${lit.join(',')})`);
  wash.addColorStop(1, `rgb(${colour.join(',')})`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);
  // Faint staff-like lines behind the notes.
  ctx.strokeStyle = rgba(ink, 0.07);
  ctx.lineWidth = Math.max(1, size / 400);
  for (let i = 1; i < 8; i++) {
    const y = Math.round((size * i) / 8) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (const n of notes) {
    ctx.fillStyle = rgba(ink, n.right ? 0.85 : 0.5);
    const h = n.height * size;
    ctx.beginPath();
    ctx.roundRect(n.x * size, n.y * size, n.width * size, h, Math.min(h / 2, size * 0.01));
    ctx.fill();
  }
  ctx.restore();
}

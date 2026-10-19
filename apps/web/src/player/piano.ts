// The Player's music room (P6-06, docs/phase-6/player-piano.md §4.2): a player piano. A paper roll
// moves down onto a drawn grand keyboard; every note is a perforation, and as it passes the brass
// tracker bar its hole lights and its key goes down, deeper for a louder note. The pedals under the
// keys move with the piece's pedals (P6-10). Between two pieces the roll's leader passes, with the
// next title printed on it, and the next piece's holes follow it in.
//
// The geometry and what each key and pedal is doing are pure functions, unit-tested in Node. The
// drawing is called from requestAnimationFrame with the transport's position in song seconds,
// read through refs; React never redraws it.
import type { PedalKind, PlaybackEvent, PlaybackNote, PlaybackPedal } from '@opentiles/practice';
import type { Hand, Song } from '@opentiles/song-model';
import { noteMarks } from '../practice/overview';
import type { Palette } from '../views/renderer';
import { BLACK_HEIGHT, layoutKeyboard, rangeFor } from '../views/keyboard';
import type { KeyboardLayout, KeyRect } from '../views/keyboard';
import { mix, parseColour, rgba } from '../views/colour';
import type { Rgb } from '../views/colour';

/** Song seconds of the roll shown above the tracker bar. */
export const ROLL_SECONDS = 4;
/** A key comes back up over this long after its note ends (P5-09's return glide). */
export const RETURN_SECONDS = 0.08;
/** Below this width the keyboard fits the piece; from it on, all 88 keys of a grand. */
export const FULL_KEYBOARD_WIDTH = 1000;
/** Song seconds the leader's printed title takes up on the roll. */
export const LEADER_SECONDS = 1.1;

/** A piece's notes and pedals, sorted for quick lookups each frame. */
export interface RollData {
  notes: PlaybackNote[];
  /** The longest note, so a search can start early enough to find notes still sounding. */
  longest: number;
  pedals: Record<PedalKind, PlaybackPedal[]>;
  /** Spans of song seconds with the sustain pedal down, for the pedal track along the roll. */
  sustain: [number, number][];
  low: number;
  high: number;
}

export function rollData(events: readonly PlaybackEvent[]): RollData {
  const notes = events
    .filter((e): e is PlaybackNote => e.kind === 'note')
    .sort((a, b) => a.start - b.start);
  const pedals: Record<PedalKind, PlaybackPedal[]> = { sustain: [], soft: [], sostenuto: [] };
  for (const e of events) if (e.kind === 'pedal') pedals[e.pedal].push(e);
  for (const list of Object.values(pedals)) list.sort((a, b) => a.start - b.start);
  const sustain: [number, number][] = [];
  let down: number | null = null;
  for (const e of pedals.sustain) {
    if (e.value >= 64 && down === null) down = e.start;
    else if (e.value < 64 && down !== null) {
      sustain.push([down, e.start]);
      down = null;
    }
  }
  if (down !== null) sustain.push([down, Infinity]);
  let low = 108;
  let high = 21;
  let longest = 0;
  for (const n of notes) {
    low = Math.min(low, n.pitch);
    high = Math.max(high, n.pitch);
    longest = Math.max(longest, n.end - n.start);
  }
  if (notes.length === 0) [low, high] = [60, 72];
  return { notes, longest, pedals, sustain, low, high };
}

/** First index whose note starts at or after `seconds`. */
function firstFrom(notes: readonly PlaybackNote[], seconds: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((notes[mid] as PlaybackNote).start < seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface KeyState {
  /** 1 while the note sounds, falling to 0 as the key comes back up. */
  depth: number;
  velocity: number;
  hand: Hand;
}

/** What every key is doing at `seconds`: down while its note sounds, then gliding back up. */
export function keysAt(data: RollData, seconds: number): Map<number, KeyState> {
  const keys = new Map<number, KeyState>();
  const from = firstFrom(data.notes, seconds - data.longest - RETURN_SECONDS);
  for (let i = from; i < data.notes.length; i++) {
    const n = data.notes[i] as PlaybackNote;
    if (n.start > seconds) break;
    const depth = seconds < n.end ? 1 : 1 - (seconds - n.end) / RETURN_SECONDS;
    if (depth <= 0) continue;
    const was = keys.get(n.pitch);
    if (!was || depth > was.depth) keys.set(n.pitch, { depth, velocity: n.velocity, hand: n.hand });
  }
  return keys;
}

/** How far down each pedal is at `seconds`, 0–127. */
export function pedalsAt(data: RollData, seconds: number): Record<PedalKind, number> {
  const at = (list: readonly PlaybackPedal[]) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as PlaybackPedal).start <= seconds) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? 0 : (list[lo - 1] as PlaybackPedal).value;
  };
  return {
    sustain: at(data.pedals.sustain),
    soft: at(data.pedals.soft),
    sostenuto: at(data.pedals.sostenuto),
  };
}

export interface RoomGeometry {
  width: number;
  height: number;
  layout: KeyboardLayout;
  /** The paper spans the keyboard: from `paperLeft` to `paperRight`, from the top to the bar. */
  paperLeft: number;
  paperRight: number;
  trackerY: number;
  barHeight: number;
  keysTop: number;
  keysHeight: number;
  /** The white keys' front edge, which shortens as a key goes down. */
  front: number;
  pedalsTop: number;
  pedalsHeight: number;
  pxPerSecond: number;
  /** Width of a perforation. */
  hole: number;
}

/**
 * Where everything goes in a `width` × `height` room. A wide room gets all 88 keys; a narrow one
 * the piece's range in whole octaves (as the practice keyboard's "Fit piece"), so the keys stay
 * wide enough to see go down.
 */
export function roomGeometry(
  width: number,
  height: number,
  range: { low: number; high: number },
): RoomGeometry {
  let low = 21;
  let high = 108;
  if (width < FULL_KEYBOARD_WIDTH) {
    const fit = rangeFor([range.low, range.high], 24);
    low = fit.low;
    high = Math.min(108, fit.high + (11 - (fit.high % 12)));
  }
  const layout = layoutKeyboard(low, high, width);
  const ww = layout.whiteWidth;
  const pedalsHeight = Math.round(Math.max(26, Math.min(46, height * 0.09)));
  const keysHeight = Math.round(Math.max(64, Math.min(ww * 5.4, height * 0.36, 210)));
  const barHeight = Math.max(3, Math.round(ww * 0.12));
  const keysTop = height - pedalsHeight - keysHeight;
  const trackerY = keysTop - barHeight;
  const first = layout.keys[0];
  const last = layout.keys[layout.keys.length - 1];
  const paperLeft = first ? first.x : 0;
  const paperRight = last ? last.x + last.width : width;
  return {
    width,
    height,
    layout,
    paperLeft,
    paperRight,
    trackerY,
    barHeight,
    keysTop,
    keysHeight,
    front: Math.max(4, Math.min(9, Math.round(keysHeight * 0.055))),
    pedalsTop: keysTop + keysHeight,
    pedalsHeight,
    pxPerSecond: Math.max(1, trackerY) / ROLL_SECONDS,
    hole: Math.max(3, ww * 0.38),
  };
}

/** The colours of the room, read once from the design tokens (styles/tokens.css). */
export interface RoomColours {
  paper: string;
  /** The paper's edges and the shadow where it comes off the spool. */
  edge: Rgb;
  hole: string;
  lit: Rgb;
  ink: string;
  brass: Rgb;
  keyLit: Rgb;
  white: Rgb;
  whiteEdge: string;
  black: Rgb;
  left: Rgb;
  right: Rgb;
  /** Light marks (dark mode) or dark ones (light mode) for gloss and shade. */
  dark: boolean;
  /** High contrast: no grain, no glow, solid shapes. */
  plain: boolean;
  serif: string;
}

export function readRoomColours(el: Element): RoomColours {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const rgb = (name: string, fallback: Rgb): Rgb => parseColour(v(name, ''))?.rgb ?? fallback;
  const paper = rgb('--roll-paper', [239, 232, 214]);
  return {
    paper: v('--roll-paper', '#efe8d6'),
    edge: rgb('--roll-edge', [221, 210, 184]),
    hole: v('--roll-hole', '#2b2721'),
    lit: rgb('--roll-lit', [154, 107, 22]),
    ink: v('--roll-ink', '#6b5c3e'),
    brass: rgb('--brass', [156, 122, 53]),
    keyLit: rgb('--key-lit', [229, 184, 92]),
    white: rgb('--key-white', [255, 255, 255]),
    whiteEdge: v('--key-edge', '#c9d1ce'),
    black: rgb('--key-black', [28, 35, 33]),
    left: rgb('--hand-left', [180, 90, 28]),
    right: rgb('--hand-right', [43, 120, 184]),
    dark: (paper[0] + paper[1] + paper[2]) / 3 < 128,
    plain: document.documentElement.hasAttribute('data-high-contrast'),
    serif: v('--font-serif', 'Georgia, serif'),
  };
}

/** A small tile of paper grain (fixed noise, so it looks the same on every frame and device). */
export function paperGrain(dark: boolean): HTMLCanvasElement | null {
  const tile = document.createElement('canvas');
  tile.width = 96;
  tile.height = 96;
  const ctx = tile.getContext('2d');
  if (!ctx) return null;
  let seed = 20261018;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const image = ctx.createImageData(96, 96);
  for (let i = 0; i < image.data.length; i += 4) {
    // Fibres run along the roll: a little more change across than down.
    const shade = dark ? 255 : 0;
    image.data[i] = shade;
    image.data[i + 1] = shade;
    image.data[i + 2] = shade;
    image.data[i + 3] = Math.round(random() * (dark ? 10 : 16));
  }
  ctx.putImageData(image, 0, 0);
  return tile;
}

export interface Leader {
  title: string;
  composer?: string;
  /** Roll seconds of the bottom of the printed title. */
  at: number;
}

export interface RoomFrame {
  data: RollData;
  /** The position on the roll in song seconds; past the end while the leader passes. */
  seconds: number;
  /** The piece after the gap, with where its first second lies on this roll. */
  next?: { data: RollData; offset: number } | null;
  leader?: Leader | null;
  /** The practice hand colours on the holes and keys, instead of the piano's own light. */
  hands: boolean;
  /** Reduce motion: the paper stands still and the keys light without moving. */
  still: boolean;
}

/** Draws the whole room: paper, holes, leader, tracker bar, keys and pedals. */
export function drawRoom(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  f: RoomFrame,
  c: RoomColours,
  grain: CanvasPattern | null,
): void {
  ctx.clearRect(0, 0, g.width, g.height);
  drawPaper(ctx, g, f, c, grain);
  drawHoles(ctx, g, f.data, f.seconds, f, c, true);
  if (f.next) drawHoles(ctx, g, f.next.data, f.seconds - f.next.offset, f, c, false);
  if (f.leader && !f.still) drawLeader(ctx, g, f.leader, f.seconds, c);
  drawTrackerBar(ctx, g, c);
  const keys = keysAt(f.data, f.seconds);
  drawKeys(ctx, g, keys, f, c);
  drawPedals(ctx, g, pedalsAt(f.data, f.seconds), f.still, c);
}

function drawPaper(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  f: RoomFrame,
  c: RoomColours,
  grain: CanvasPattern | null,
): void {
  const w = g.paperRight - g.paperLeft;
  ctx.fillStyle = c.paper;
  ctx.fillRect(g.paperLeft, 0, w, g.trackerY);
  if (c.plain) return;
  // The grain moves with the paper, so the roll is seen to turn even through a long rest.
  if (grain) {
    const offset = f.still ? 0 : (f.seconds * g.pxPerSecond) % 96;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.paperLeft, 0, w, g.trackerY);
    ctx.clip();
    ctx.translate(0, offset);
    ctx.fillStyle = grain;
    ctx.fillRect(g.paperLeft, -96, w, g.trackerY + 96);
    ctx.restore();
  }
  // Where the paper comes off the spool at the top, and its two edges.
  const spool = ctx.createLinearGradient(0, 0, 0, Math.min(56, g.trackerY * 0.25));
  spool.addColorStop(0, rgba(c.edge, 0.95));
  spool.addColorStop(1, rgba(c.edge, 0));
  ctx.fillStyle = spool;
  ctx.fillRect(g.paperLeft, 0, w, Math.min(56, g.trackerY * 0.25));
  for (const [x, dir] of [
    [g.paperLeft, 1],
    [g.paperRight, -1],
  ] as const) {
    const edge = ctx.createLinearGradient(x, 0, x + dir * 10, 0);
    edge.addColorStop(0, rgba(c.edge, 0.9));
    edge.addColorStop(1, rgba(c.edge, 0));
    ctx.fillStyle = edge;
    ctx.fillRect(dir > 0 ? x : x - 10, 0, 10, g.trackerY);
  }
}

const centre = (k: KeyRect) => k.x + k.width / 2;

function drawHoles(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  data: RollData,
  seconds: number,
  f: RoomFrame,
  c: RoomColours,
  current: boolean,
): void {
  const keyOf = new Map(g.layout.keys.map((k) => [k.pitch, k]));
  const w = g.hole;
  const r = w / 2;
  const bar = g.trackerY;
  const shown = f.still ? 0.35 : ROLL_SECONDS;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.paperLeft, 0, g.paperRight - g.paperLeft, bar);
  ctx.clip();
  const from = firstFrom(data.notes, seconds - data.longest);
  for (let i = from; i < data.notes.length; i++) {
    const n = data.notes[i] as PlaybackNote;
    if (n.start > seconds + shown) break;
    if (n.end <= seconds) continue;
    const k = keyOf.get(n.pitch);
    if (!k) continue;
    const sounding = current && n.start <= seconds;
    const bottom = f.still ? bar : bar - (n.start - seconds) * g.pxPerSecond;
    const top = f.still ? bar - w * 2.2 : bar - (n.end - seconds) * g.pxPerSecond;
    if (f.still && !sounding) continue;
    const x = centre(k) - r;
    const handColour = n.hand === 'left' ? c.left : c.right;
    if (sounding && !c.plain) {
      // The light through a hole at the bar spills a little onto the paper around it.
      ctx.fillStyle = rgba(f.hands ? handColour : c.lit, c.dark ? 0.28 : 0.18);
      ctx.beginPath();
      ctx.roundRect(x - r * 0.9, top - r * 0.6, w + r * 1.8, bottom - top + r * 1.2, r * 1.6);
      ctx.fill();
    }
    ctx.fillStyle = sounding
      ? rgba(f.hands ? handColour : c.lit, 1)
      : f.hands
        ? rgba(handColour, 0.85)
        : c.hole;
    ctx.beginPath();
    ctx.roundRect(x, top, w, Math.max(w, bottom - top), r);
    ctx.fill();
  }
  // The sustain pedal's track runs down the roll's right margin.
  if (current && !f.still) {
    ctx.fillStyle = c.hole;
    const x = g.paperRight - Math.max(4, w * 0.5) - 3;
    for (const [down, up] of data.sustain) {
      if (up <= seconds || down > seconds + ROLL_SECONDS) continue;
      const y0 = bar - (Math.min(up, seconds + ROLL_SECONDS + 1) - seconds) * g.pxPerSecond;
      const y1 = bar - (down - seconds) * g.pxPerSecond;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.roundRect(x, y0, Math.max(3, w * 0.35), Math.max(2, y1 - y0), 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** The roll's leader: the title and composer printed across the paper, between two rules. */
function drawLeader(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  leader: Leader,
  seconds: number,
  c: RoomColours,
): void {
  const bottom = g.trackerY - (leader.at - seconds) * g.pxPerSecond;
  const height = LEADER_SECONDS * g.pxPerSecond;
  const top = bottom - height;
  if (bottom < 0 || top > g.trackerY) return;
  const mid = (g.paperLeft + g.paperRight) / 2;
  const width = g.paperRight - g.paperLeft;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.paperLeft, 0, width, g.trackerY);
  ctx.clip();
  ctx.fillStyle = c.ink;
  ctx.strokeStyle = c.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const size = Math.max(16, Math.min(40, height * 0.32, width / 22));
  ctx.font = `italic 500 ${Math.round(size)}px ${c.serif}`;
  const titleY = top + height * 0.5;
  ctx.fillText(leader.title, mid, titleY, width * 0.86);
  if (leader.composer) {
    ctx.font = `500 ${Math.round(size * 0.42)}px ${c.serif}`;
    const caps = leader.composer.toLocaleUpperCase();
    // Letter-spaced small capitals, as printed on a roll's label.
    ctx.letterSpacing = `${Math.round(size * 0.12)}px`;
    ctx.fillText(caps, mid, titleY + size * 0.95, width * 0.86);
    ctx.letterSpacing = '0px';
  }
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  const rule = Math.min(width * 0.36, size * 9);
  for (const y of [top + height * 0.12, bottom - height * 0.04]) {
    ctx.beginPath();
    ctx.moveTo(mid - rule / 2, Math.round(y) + 0.5);
    ctx.lineTo(mid + rule / 2, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrackerBar(ctx: CanvasRenderingContext2D, g: RoomGeometry, c: RoomColours): void {
  const x = g.paperLeft;
  const w = g.paperRight - g.paperLeft;
  const y = g.trackerY;
  const h = g.barHeight;
  if (c.plain) {
    ctx.fillStyle = rgba(c.brass, 1);
    ctx.fillRect(x, y, w, h);
    return;
  }
  const brass = ctx.createLinearGradient(0, y, 0, y + h);
  brass.addColorStop(0, rgba(mix(c.brass, [255, 255, 255], 0.45), 1));
  brass.addColorStop(0.45, rgba(c.brass, 1));
  brass.addColorStop(1, rgba(mix(c.brass, [0, 0, 0], 0.45), 1));
  ctx.fillStyle = brass;
  ctx.fillRect(x, y, w, h);
}

function drawKeys(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  keys: Map<number, KeyState>,
  f: RoomFrame,
  c: RoomColours,
): void {
  const top = g.keysTop;
  const h = g.keysHeight;
  const lightOf = (s: KeyState) => (f.hands ? (s.hand === 'left' ? c.left : c.right) : c.keyLit);
  /** How far a key goes down: its depth, more for a louder note; none under Reduce motion. */
  const dipOf = (s: KeyState | undefined) =>
    !s || f.still ? 0 : s.depth * g.front * (0.35 + 0.45 * Math.min(1, s.velocity / 110));
  const whiteTop = rgba(c.white, 1);
  const whiteFront = rgba(mix(c.white, c.black, c.dark ? 0.32 : 0.18), 1);
  const whiteShade = rgba(mix(c.white, c.black, 0.12), 1);
  // The keybed behind the keys shows in the gaps.
  ctx.fillStyle = rgba(mix(c.black, [0, 0, 0], 0.4), 1);
  ctx.fillRect(g.paperLeft, top, g.paperRight - g.paperLeft, h);
  for (const k of g.layout.keys) {
    if (k.black) continue;
    const s = keys.get(k.pitch);
    const dip = dipOf(s);
    const surface = h - g.front + dip;
    const x = k.x + 0.5;
    const w = k.width - 1;
    // The ivory, darkening a touch towards the back where the fallboard shades it.
    const ivory = ctx.createLinearGradient(0, top, 0, top + surface);
    ivory.addColorStop(0, whiteShade);
    ivory.addColorStop(0.18, whiteTop);
    ivory.addColorStop(1, whiteTop);
    ctx.fillStyle = c.plain ? whiteTop : ivory;
    ctx.fillRect(x, top, w, surface);
    if (s && s.depth > 0) {
      // The light gathers towards the front of the key, where a finger would be.
      const alpha = (f.hands ? 0.85 : 0.3 + 0.55 * Math.min(1, s.velocity / 110)) * s.depth;
      const glow = ctx.createLinearGradient(0, top, 0, top + surface);
      glow.addColorStop(0, rgba(lightOf(s), alpha * (f.hands ? 1 : 0.25)));
      glow.addColorStop(1, rgba(lightOf(s), alpha));
      ctx.fillStyle = c.plain ? rgba(lightOf(s), 1) : glow;
      ctx.fillRect(x, top, w, surface);
    }
    // The key's front edge: shorter while it is down.
    ctx.fillStyle = whiteFront;
    ctx.fillRect(x, top + surface, w, g.front - dip);
  }
  const blackHeight = h * BLACK_HEIGHT;
  const bevel = Math.max(3, Math.min(10, blackHeight * 0.1));
  const ebony = rgba(c.black, 1);
  const ebonyTop = rgba(mix(c.black, [255, 255, 255], c.dark ? 0.16 : 0.22), 1);
  for (const k of g.layout.keys) {
    if (!k.black) continue;
    const s = keys.get(k.pitch);
    const dip = dipOf(s) * 0.7;
    // A shadow on the white keys beside it.
    if (!c.plain) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(k.x + 1.5, top, k.width, blackHeight + 2);
    }
    ctx.fillStyle = ebony;
    ctx.beginPath();
    ctx.roundRect(k.x, top, k.width, blackHeight, [0, 0, 2, 2]);
    ctx.fill();
    // The top of the key, narrower than its base; its sloped front shortens as it goes down.
    const inset = k.width * 0.12;
    const faceHeight = blackHeight - bevel + dip;
    if (!c.plain) {
      const face = ctx.createLinearGradient(0, top, 0, top + faceHeight);
      face.addColorStop(0, ebony);
      face.addColorStop(1, ebonyTop);
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(k.x + inset, top, k.width - inset * 2, faceHeight, [0, 0, 2, 2]);
      ctx.fill();
    }
    if (s && s.depth > 0) {
      ctx.fillStyle = rgba(lightOf(s), (f.hands ? 0.9 : 0.35 + 0.5 * (s.velocity / 127)) * s.depth);
      ctx.beginPath();
      ctx.roundRect(k.x + inset, top, k.width - inset * 2, faceHeight, [0, 0, 2, 2]);
      ctx.fill();
    }
  }
  // The fallboard's shadow across the top of the keys.
  if (!c.plain) {
    const shade = ctx.createLinearGradient(0, top, 0, top + Math.min(14, h * 0.1));
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(g.paperLeft, top, g.paperRight - g.paperLeft, Math.min(14, h * 0.1));
  }
}

const PEDAL_ORDER: PedalKind[] = ['soft', 'sostenuto', 'sustain'];

/** Three brass pedals, left to right soft, sostenuto and sustain, pressed as the piece presses them. */
function drawPedals(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  pedals: Record<PedalKind, number>,
  still: boolean,
  c: RoomColours,
): void {
  const mid = (g.paperLeft + g.paperRight) / 2;
  const h = g.pedalsHeight - 10;
  const w = Math.max(12, Math.min(26, h * 0.62));
  const gap = w * 0.9;
  const top = g.pedalsTop + 7;
  PEDAL_ORDER.forEach((pedal, i) => {
    const down = Math.min(1, pedals[pedal] / 127);
    const pressed = pedal === 'sustain' ? (pedals[pedal] >= 64 ? 1 : 0) : down;
    const x = mid + (i - 1) * (w + gap) - w / 2;
    const y = top + (still ? 0 : pressed * 3);
    if (c.plain) {
      ctx.fillStyle = rgba(c.brass, pressed ? 1 : 0.6);
    } else {
      const shine = ctx.createLinearGradient(x, 0, x + w, 0);
      const base = pressed ? mix(c.brass, [255, 255, 255], 0.25) : c.brass;
      shine.addColorStop(0, rgba(mix(base, [0, 0, 0], 0.35), 1));
      shine.addColorStop(0.35, rgba(mix(base, [255, 255, 255], 0.35), 1));
      shine.addColorStop(1, rgba(mix(base, [0, 0, 0], 0.4), 1));
      ctx.fillStyle = shine;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, w, h - (still ? 0 : pressed * 3), [w * 0.35, w * 0.35, w * 0.5, w * 0.5]);
    ctx.fill();
  });
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

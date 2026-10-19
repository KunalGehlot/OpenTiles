// The Player's music room (P6-06, docs/phase-6/player-piano.md §4.2): a player piano on a stage of
// black lacquer. The roll moves down onto a drawn grand keyboard; every note is a fine line of
// light coming through its perforation, and as it reaches the gold tracker bar it brightens and its
// key goes down, deeper and warmer for a louder note. A thin light under the keys shows the sustain
// pedal (P6-10). Between two pieces the roll's leader passes, with the next title printed on it,
// and the next piece's holes follow it in.
//
// The geometry and what each key and pedal is doing are pure functions, unit-tested in Node. The
// drawing is called from requestAnimationFrame with the transport's position in song seconds,
// read through refs; React never redraws it.
import type { PedalKind, PlaybackEvent, PlaybackNote, PlaybackPedal } from '@opentiles/practice';
import { isBlackKey } from '@opentiles/song-model';
import type { Hand } from '@opentiles/song-model';
import { BLACK_HEIGHT, layoutKeyboard, rangeFor } from '../views/keyboard';
import type { KeyboardLayout, KeyRect } from '../views/keyboard';
import { mix, parseColour, rgba } from '../views/colour';
import type { Rgb } from '../views/colour';
import type { Light } from './hdr';
import { hdrColour, p3Colour } from './wide';

/** Song seconds of the roll shown above the tracker bar. */
export const ROLL_SECONDS = 4;
/**
 * A key travels down over this long before its note sounds, as on a real piano, where the hammer
 * strikes when the key is nearly down; a loud note goes down faster (`pressSeconds`).
 */
export const PRESS_SECONDS = 0.04;
/** A key springs back up over this long after its note ends, quickly at first (P5-09's glide). */
export const RETURN_SECONDS = 0.12;

/** How long a key takes to go down for a note of `velocity`: 40 ms soft, 22 ms loud. */
export function pressSeconds(velocity: number): number {
  return PRESS_SECONDS - 0.018 * Math.min(1, Math.max(0, velocity / 127));
}
/**
 * The narrowest a white key is drawn (CSS px). The keyboard widens from the piece's octaves to all
 * 88 keys of a grand as far as the room allows at this width.
 */
export const MIN_WHITE_WIDTH = 14;
/** Song seconds the leader's printed title takes up on the roll. */
export const LEADER_SECONDS = 1.1;
/** How much richer the gold and the warm light are on a Display P3 screen. */
export const WARM_BOOST = 1.3;

/** A piece's notes and pedals, sorted for quick lookups each frame. */
export interface RollData {
  notes: PlaybackNote[];
  /** The longest note, so a search can start early enough to find notes still sounding. */
  longest: number;
  pedals: Record<PedalKind, PlaybackPedal[]>;
  /** Spans of song seconds with the sustain pedal down. */
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

/**
 * What every key is doing at `seconds`: going down just before its note, gathering speed like a
 * finger pressing it, so it is down as the note sounds; down while the note sounds; then springing
 * back up, quickly at first and settling. A key struck again soon rises only part of the way.
 */
export function keysAt(data: RollData, seconds: number): Map<number, KeyState> {
  const keys = new Map<number, KeyState>();
  const from = firstFrom(data.notes, seconds - data.longest - RETURN_SECONDS);
  for (let i = from; i < data.notes.length; i++) {
    const n = data.notes[i] as PlaybackNote;
    const press = pressSeconds(n.velocity);
    if (n.start - PRESS_SECONDS > seconds) break;
    if (n.start - press > seconds) continue;
    let depth: number;
    if (seconds < n.start) {
      const t = (seconds - (n.start - press)) / press;
      depth = t * t;
    } else if (seconds < n.end) depth = 1;
    else {
      const u = Math.min(1, (seconds - n.end) / RETURN_SECONDS);
      depth = (1 - u) ** 3;
    }
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
  /** The roll spans the keyboard: from `paperLeft` to `paperRight`, from the top to the bar. */
  paperLeft: number;
  paperRight: number;
  trackerY: number;
  keysTop: number;
  keysHeight: number;
  /** The white keys' front edge, which shortens as a key goes down. */
  front: number;
  /** The strip under the keys where the sustain pedal's light is. */
  footTop: number;
  footHeight: number;
  pxPerSecond: number;
  /** Width of a perforation's line of light. */
  hole: number;
}

const whites = (low: number, high: number) => {
  let n = 0;
  for (let p = low; p <= high; p++) if (!isBlackKey(p)) n += 1;
  return n;
};

/**
 * The keys for a room `width` px wide: the piece's octaves, widened an octave at a time (down,
 * then up) while every white key stays at least `MIN_WHITE_WIDTH` wide, up to the 88 of a grand.
 */
export function roomRange(
  width: number,
  range: { low: number; high: number },
): { low: number; high: number } {
  if (width / whites(21, 108) >= MIN_WHITE_WIDTH) return { low: 21, high: 108 };
  const fit = rangeFor([range.low, range.high], 24);
  let low = fit.low;
  let high = Math.min(108, fit.high + (11 - (fit.high % 12)));
  let down = true;
  for (let guard = 0; guard < 16; guard++) {
    const nextLow = Math.max(21, low - 12);
    const nextHigh = Math.min(108, high + 12);
    const tryDown = down && nextLow < low;
    const [l, h] = tryDown ? [nextLow, high] : nextHigh > high ? [low, nextHigh] : [nextLow, high];
    if ((l === low && h === high) || width / whites(l, h) < MIN_WHITE_WIDTH) break;
    [low, high] = [l, h];
    down = !down;
  }
  return { low, high };
}

/** Where everything goes in a `width` × `height` room. */
export function roomGeometry(
  width: number,
  height: number,
  range: { low: number; high: number },
): RoomGeometry {
  const { low, high } = roomRange(width, range);
  const layout = layoutKeyboard(low, high, width);
  const ww = layout.whiteWidth;
  const footHeight = Math.round(Math.max(14, Math.min(24, height * 0.04)));
  const keysHeight = Math.round(Math.max(64, Math.min(ww * 6.2, height * 0.34, 200)));
  const keysTop = height - footHeight - keysHeight;
  const trackerY = keysTop - 2;
  const first = layout.keys[0];
  const last = layout.keys[layout.keys.length - 1];
  return {
    width,
    height,
    layout,
    paperLeft: first ? first.x : 0,
    paperRight: last ? last.x + last.width : width,
    trackerY,
    keysTop,
    keysHeight,
    front: Math.max(5, Math.min(11, Math.round(keysHeight * 0.075))),
    footTop: keysTop + keysHeight,
    footHeight,
    pxPerSecond: Math.max(1, trackerY) / ROLL_SECONDS,
    hole: Math.max(2.5, Math.min(4.5, ww * 0.26)),
  };
}

/** The colours of the room, read once from the design tokens (styles/tokens.css). */
export interface RoomColours {
  /** The lacquer the stage is made of. */
  stage: Rgb;
  hole: Rgb;
  lit: Rgb;
  ink: string;
  gold: Rgb;
  keyLit: Rgb;
  ivory: Rgb;
  ebony: Rgb;
  left: Rgb;
  right: Rgb;
  /** High contrast: no glow, solid shapes. */
  plain: boolean;
  /** A Display P3 screen and canvas: the gold and the warm light are drawn richer than sRGB. */
  wide: boolean;
  serif: string;
}

/** The gold and the warm light as canvas colours: richer on a wide-gamut screen. */
function warm(c: RoomColours, rgb: Rgb, alpha: number): string {
  return c.wide ? p3Colour(rgb, alpha, WARM_BOOST) : rgba(rgb, alpha);
}

export function readRoomColours(el: Element, wide = false): RoomColours {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const rgb = (name: string, fallback: Rgb): Rgb => parseColour(v(name, ''))?.rgb ?? fallback;
  return {
    stage: rgb('--roll-paper', [13, 13, 15]),
    hole: rgb('--roll-hole', [191, 167, 120]),
    lit: rgb('--roll-lit', [255, 243, 214]),
    ink: v('--roll-ink', '#c9ae78'),
    gold: rgb('--brass', [200, 169, 106]),
    keyLit: rgb('--key-lit', [240, 200, 120]),
    ivory: rgb('--room-ivory', [242, 237, 227]),
    ebony: rgb('--room-ebony', [17, 17, 19]),
    left: rgb('--hand-left', [180, 90, 28]),
    right: rgb('--hand-right', [43, 120, 184]),
    plain: document.documentElement.hasAttribute('data-high-contrast'),
    wide: wide && !document.documentElement.hasAttribute('data-high-contrast'),
    serif: v('--font-serif', 'Georgia, serif'),
  };
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
  /** Playing: keys go down and holes light only then, not while paused or stopped. */
  active: boolean;
  /** The piece after the gap, with where its first second lies on this roll. */
  next?: { data: RollData; offset: number } | null;
  leader?: Leader | null;
  /** The practice hand colours on the holes and keys, instead of the piano's own light. */
  hands: boolean;
  /** Reduce motion: the roll stands still and the keys light without moving. */
  still: boolean;
}

/** Draws the whole room: the roll, the leader, the tracker bar, the keys and the pedal's light. */
export function drawRoom(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  f: RoomFrame,
  c: RoomColours,
): void {
  ctx.fillStyle = rgba(c.stage, 1);
  ctx.fillRect(0, 0, g.width, g.height);
  drawGuides(ctx, g, c);
  drawHoles(ctx, g, f.data, f.seconds, f, c, f.active);
  if (f.next) drawHoles(ctx, g, f.next.data, f.seconds - f.next.offset, f, c, false);
  if (f.leader && !f.still) drawLeader(ctx, g, f.leader, f.seconds, c);
  // The roll comes out of the dark at the top.
  if (!c.plain) {
    const fade = ctx.createLinearGradient(0, 0, 0, g.trackerY * 0.42);
    fade.addColorStop(0, rgba(c.stage, 1));
    fade.addColorStop(1, rgba(c.stage, 0));
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, g.width, g.trackerY * 0.42);
  }
  drawTrackerBar(ctx, g, c);
  const keys = f.active ? keysAt(f.data, f.seconds) : new Map<number, KeyState>();
  drawKeys(ctx, g, keys, f, c);
  drawPedalLight(ctx, g, f.active ? pedalsAt(f.data, f.seconds).sustain : 0, c);
}

/** Faint lines above every C, so the eye can tell where on the keyboard a note will land. */
function drawGuides(ctx: CanvasRenderingContext2D, g: RoomGeometry, c: RoomColours): void {
  if (c.plain) return;
  ctx.fillStyle = warm(c, c.gold, 0.07);
  for (const k of g.layout.keys) {
    if (k.pitch % 12 === 0) ctx.fillRect(Math.round(k.x), 0, 1, g.trackerY);
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
  live: boolean,
): void {
  const keyOf = new Map(g.layout.keys.map((k) => [k.pitch, k]));
  const w = g.hole;
  const r = w / 2;
  const bar = g.trackerY;
  const shown = f.still ? 0.35 : ROLL_SECONDS;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, g.width, bar);
  ctx.clip();
  const from = firstFrom(data.notes, seconds - data.longest);
  for (let i = from; i < data.notes.length; i++) {
    const n = data.notes[i] as PlaybackNote;
    if (n.start > seconds + shown) break;
    if (n.end <= seconds) continue;
    const k = keyOf.get(n.pitch);
    if (!k) continue;
    const sounding = live && n.start <= seconds;
    if (f.still && !sounding) continue;
    const bottom = f.still ? bar : bar - (n.start - seconds) * g.pxPerSecond;
    const top = f.still ? bar - w * 6 : bar - (n.end - seconds) * g.pxPerSecond;
    const x = centre(k) - r;
    const hand = n.hand === 'left' ? c.left : c.right;
    const light = f.hands ? hand : sounding ? c.lit : c.hole;
    if (sounding && !c.plain) {
      // The light coming through the hole meets the bar and spreads a little along it.
      const glowRadius = w * 7;
      const glow = ctx.createRadialGradient(x + r, bar, 0, x + r, bar, glowRadius);
      glow.addColorStop(0, f.hands ? rgba(hand, 0.55) : warm(c, c.keyLit, 0.55));
      glow.addColorStop(1, f.hands ? rgba(hand, 0) : warm(c, c.keyLit, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(x + r - glowRadius, bar - glowRadius, glowRadius * 2, glowRadius);
    }
    ctx.fillStyle = f.hands ? rgba(light, sounding ? 1 : 0.8) : warm(c, light, sounding ? 1 : 0.72);
    ctx.beginPath();
    ctx.roundRect(x, top, w, Math.max(w, bottom - top), r);
    ctx.fill();
  }
  ctx.restore();
}

/** The roll's leader: the title and composer printed across it, between two fine rules. */
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
  ctx.rect(0, 0, g.width, g.trackerY);
  ctx.clip();
  ctx.fillStyle = c.ink;
  ctx.strokeStyle = c.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const size = Math.max(16, Math.min(34, height * 0.3, width / 24));
  ctx.font = `italic 400 ${Math.round(size)}px ${c.serif}`;
  const titleY = top + height * 0.52;
  ctx.fillText(leader.title, mid, titleY, width * 0.86);
  if (leader.composer) {
    ctx.font = `400 ${Math.round(size * 0.4)}px ${c.serif}`;
    // Letter-spaced capitals, as printed on a roll's label.
    ctx.letterSpacing = `${Math.round(size * 0.14)}px`;
    ctx.fillText(leader.composer.toLocaleUpperCase(), mid, titleY + size * 0.95, width * 0.86);
    ctx.letterSpacing = '0px';
  }
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  const rule = Math.min(width * 0.3, size * 7);
  for (const y of [top + height * 0.14, bottom - height * 0.02]) {
    ctx.beginPath();
    ctx.moveTo(mid - rule / 2, Math.round(y) + 0.5);
    ctx.lineTo(mid + rule / 2, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** A gold hairline where the roll meets the keys, with a faint glow above it. */
function drawTrackerBar(ctx: CanvasRenderingContext2D, g: RoomGeometry, c: RoomColours): void {
  const x = g.paperLeft;
  const w = g.paperRight - g.paperLeft;
  if (!c.plain) {
    const glow = ctx.createLinearGradient(0, g.trackerY - 18, 0, g.trackerY);
    glow.addColorStop(0, warm(c, c.gold, 0));
    glow.addColorStop(1, warm(c, c.gold, 0.12));
    ctx.fillStyle = glow;
    ctx.fillRect(x, g.trackerY - 18, w, 18);
  }
  ctx.fillStyle = warm(c, c.gold, 0.9);
  ctx.fillRect(x, g.trackerY, w, 1.5);
}

/**
 * How far a key's front goes down at its depth, in px: most of the white keys' front edge for a
 * loud note, a little less for a soft one; nothing under Reduce motion.
 */
export function keyTravel(g: RoomGeometry, s: KeyState | undefined, still: boolean): number {
  if (!s || still) return 0;
  return s.depth * g.front * (0.6 + 0.3 * Math.min(1, s.velocity / 110));
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
  const light = (s: KeyState, a: number) => (f.hands ? rgba(lightOf(s), a) : warm(c, c.keyLit, a));
  // The ivory, shaded at the back under the fallboard.
  const ivory = ctx.createLinearGradient(0, top, 0, top + h);
  ivory.addColorStop(0, rgba(mix(c.ivory, c.ebony, 0.28), 1));
  ivory.addColorStop(0.1, rgba(c.ivory, 1));
  ivory.addColorStop(1, rgba(mix(c.ivory, c.ebony, 0.06), 1));
  for (const k of g.layout.keys) {
    if (k.black) continue;
    const s = keys.get(k.pitch);
    const d = s?.depth ?? 0;
    const travel = keyTravel(g, s, f.still);
    const surface = h - g.front + travel;
    const x = k.x + 0.5;
    const w = k.width - 1;
    ctx.fillStyle = c.plain ? rgba(c.ivory, 1) : ivory;
    ctx.fillRect(x, top, w, surface);
    if (s && d > 0 && !c.plain) {
      // The key tips forward into the fallboard's shadow, darker at the back...
      const tilt = ctx.createLinearGradient(0, top, 0, top + surface);
      tilt.addColorStop(0, `rgba(0, 0, 0, ${(0.34 * d).toFixed(3)})`);
      tilt.addColorStop(0.35, `rgba(0, 0, 0, ${(0.1 * d).toFixed(3)})`);
      tilt.addColorStop(1, `rgba(0, 0, 0, ${(0.04 * d).toFixed(3)})`);
      ctx.fillStyle = tilt;
      ctx.fillRect(x, top, w, surface);
      // ...and sinks between its neighbours, whose edges shade its sides.
      const side = Math.min(4, w * 0.18);
      for (const [from, dir] of [
        [x, 1],
        [x + w, -1],
      ] as const) {
        const edge = ctx.createLinearGradient(from, 0, from + dir * side, 0);
        edge.addColorStop(0, `rgba(0, 0, 0, ${(0.3 * d).toFixed(3)})`);
        edge.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = edge;
        ctx.fillRect(dir > 0 ? from : from - side, top, side, surface);
      }
    }
    if (s && d > 0) {
      // A warm light gathers towards the front of the key, where a finger would be.
      const alpha = (f.hands ? 0.85 : 0.1 + 0.2 * Math.min(1, s.velocity / 110)) * d;
      const glow = ctx.createLinearGradient(0, top, 0, top + surface);
      glow.addColorStop(0, light(s, f.hands ? alpha : 0));
      glow.addColorStop(1, light(s, alpha));
      ctx.fillStyle = c.plain ? rgba(lightOf(s), 1) : glow;
      ctx.fillRect(x, top, w, surface);
    }
    // The key's front edge, catching the light along its top; it slides away as the key goes
    // down, and what is left of it is in shadow.
    const lip = g.front - travel;
    if (lip > 0.25) {
      ctx.fillStyle = rgba(mix(c.ivory, c.ebony, 0.3 + 0.2 * d), 1);
      ctx.fillRect(x, top + surface, w, lip);
      if (!c.plain) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * (1 - d)).toFixed(3)})`;
        ctx.fillRect(x, top + surface, w, 1);
      }
    }
  }
  const blackHeight = h * BLACK_HEIGHT;
  const bevel = Math.max(4, Math.min(11, blackHeight * 0.11));
  const ebony = rgba(c.ebony, 1);
  for (const k of g.layout.keys) {
    if (!k.black) continue;
    const s = keys.get(k.pitch);
    const d = s?.depth ?? 0;
    // A black key's sloped front shortens as it goes down; it sits lower, so its shadow on the
    // white keys beside it shrinks and its top loses some of its sheen.
    const travel = f.still || !s ? 0 : d * bevel * (0.7 + 0.3 * Math.min(1, s.velocity / 110));
    if (!c.plain) {
      const reach = 2 - 1.4 * d;
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.22 - 0.08 * d).toFixed(3)})`;
      ctx.fillRect(k.x + reach * 0.5, top, k.width + reach, blackHeight + reach);
    }
    ctx.fillStyle = ebony;
    ctx.beginPath();
    ctx.roundRect(k.x, top, k.width, blackHeight, [0, 0, 2, 2]);
    ctx.fill();
    const inset = k.width * 0.13;
    const faceHeight = blackHeight - bevel + travel;
    if (!c.plain) {
      const face = ctx.createLinearGradient(0, top, 0, top + faceHeight);
      face.addColorStop(0, ebony);
      face.addColorStop(1, rgba(mix(c.ebony, c.ivory, 0.17 * (1 - 0.55 * d)), 1));
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(k.x + inset, top, k.width - inset * 2, faceHeight, [0, 0, 2, 2]);
      ctx.fill();
      // A thin highlight along the front of the top, gone while the key is down.
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.16 * (1 - d)).toFixed(3)})`;
      ctx.fillRect(k.x + inset, top + faceHeight - 1, k.width - inset * 2, 1);
    }
    if (s && d > 0) {
      if (f.hands || c.plain) {
        ctx.fillStyle = rgba(lightOf(s), (c.plain ? 1 : 0.9) * d);
        ctx.beginPath();
        ctx.roundRect(k.x + inset, top, k.width - inset * 2, faceHeight, [0, 0, 2, 2]);
        ctx.fill();
      } else {
        // Ebony does not take a tint well: the light catches the front edge of its top instead.
        ctx.fillStyle = warm(c, c.keyLit, 0.85 * d);
        ctx.fillRect(k.x + inset, top + faceHeight - 1.5, k.width - inset * 2, 1.5);
        const sheen = ctx.createLinearGradient(0, top + faceHeight * 0.55, 0, top + faceHeight);
        sheen.addColorStop(0, warm(c, c.keyLit, 0));
        sheen.addColorStop(1, warm(c, c.keyLit, 0.16 * d));
        ctx.fillStyle = sheen;
        ctx.fillRect(k.x + inset, top + faceHeight * 0.55, k.width - inset * 2, faceHeight * 0.45);
      }
    }
  }
  if (!c.plain) {
    // The fallboard's shadow across the top of the keys.
    const shade = ctx.createLinearGradient(0, top, 0, top + Math.min(12, h * 0.1));
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(g.paperLeft, top, g.paperRight - g.paperLeft, Math.min(12, h * 0.1));
  }
}

/** A thin gold light under the keys that comes on while the sustain pedal is down. */
function drawPedalLight(
  ctx: CanvasRenderingContext2D,
  g: RoomGeometry,
  sustain: number,
  c: RoomColours,
): void {
  const down = sustain >= 64;
  const w = Math.min(160, (g.paperRight - g.paperLeft) * 0.14);
  const x = (g.paperLeft + g.paperRight) / 2 - w / 2;
  const y = g.footTop + g.footHeight / 2 - 1;
  ctx.fillStyle = warm(c, c.gold, down ? 0.95 : 0.1);
  ctx.beginPath();
  ctx.roundRect(x, y, w, 2, 1);
  ctx.fill();
  if (down && !c.plain) {
    ctx.fillStyle = warm(c, c.gold, 0.14);
    ctx.beginPath();
    ctx.roundRect(x - 6, y - 4, w + 12, 10, 5);
    ctx.fill();
  }
}

/** How bright the HDR lights are, as multiples of the screen's white. */
const HDR = { hole: 3, bar: 1.4, pedal: 2.2, tracker: 1.3 };

/**
 * The lights the HDR layer adds over the room for this frame, in the room's CSS px: each hole at
 * the tracker bar and its light along the bar, the sustain pedal's light and the gold bar itself.
 * The keys are not lit: they are the piano's own ivory and ebony, and their going down is shown
 * by shade and movement. Empty under high contrast.
 */
export function roomLights(g: RoomGeometry, f: RoomFrame, c: RoomColours): Light[] {
  if (c.plain) return [];
  const lights: Light[] = [];
  const colourOf = (rgb: Rgb, intensity: number, hand?: Hand) =>
    f.hands && hand
      ? hdrColour(hand === 'left' ? c.left : c.right, intensity)
      : hdrColour(rgb, intensity, WARM_BOOST);
  lights.push({
    x: g.paperLeft,
    y: g.trackerY,
    w: g.paperRight - g.paperLeft,
    h: 1.5,
    radius: 0,
    soft: 0.75,
    colour: colourOf(c.gold, HDR.tracker),
  });
  if (!f.active) return lights;
  const keyOf = new Map(g.layout.keys.map((k) => [k.pitch, k]));
  const w = g.hole;
  const bar = g.trackerY;
  const from = firstFrom(f.data.notes, f.seconds - f.data.longest);
  for (let i = from; i < f.data.notes.length; i++) {
    const n = f.data.notes[i] as PlaybackNote;
    if (n.start > f.seconds) break;
    if (n.end <= f.seconds) continue;
    const k = keyOf.get(n.pitch);
    if (!k) continue;
    const x = centre(k);
    const top = Math.max(bar - (n.end - f.seconds) * g.pxPerSecond, bar - w * 12);
    lights.push({
      x: x - w / 2,
      y: top,
      w,
      h: bar - top,
      radius: w / 2,
      soft: 1,
      colour: colourOf(c.lit, HDR.hole, n.hand),
      fade: true,
    });
    lights.push({
      x: x - w * 2,
      y: bar - w,
      w: w * 4,
      h: w * 1.5,
      radius: w,
      soft: w * 4,
      colour: colourOf(c.keyLit, HDR.bar, n.hand),
    });
  }
  if (pedalsAt(f.data, f.seconds).sustain >= 64) {
    const pw = Math.min(160, (g.paperRight - g.paperLeft) * 0.14);
    lights.push({
      x: (g.paperLeft + g.paperRight) / 2 - pw / 2,
      y: g.footTop + g.footHeight / 2 - 1,
      w: pw,
      h: 2,
      radius: 1,
      soft: 5,
      colour: colourOf(c.gold, HDR.pedal),
    });
  }
  return lights;
}

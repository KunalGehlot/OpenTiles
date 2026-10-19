// The Player's music room (P6-06): what each key and pedal is doing on the player piano, and
// where the roll, keys and pedals go. Events are generated here (CC0).
import { describe, expect, it } from 'vitest';
import type { PlaybackEvent } from '@opentiles/practice';
import {
  MIN_WHITE_WIDTH,
  PRESS_SECONDS,
  RETURN_SECONDS,
  ROLL_SECONDS,
  keysAt,
  pedalsAt,
  pressSeconds,
  rollData,
  roomGeometry,
  roomLights,
  roomRange,
} from '../src/player/piano';
import type { RoomColours } from '../src/player/piano';

const note = (pitch: number, start: number, end: number, velocity = 80): PlaybackEvent => ({
  kind: 'note',
  pitch,
  start,
  end,
  held: end,
  velocity,
  hand: pitch < 60 ? 'left' : 'right',
  noteId: `n${pitch}-${start}`,
});

const pedal = (start: number, value: number): PlaybackEvent => ({
  kind: 'pedal',
  start,
  pedal: 'sustain',
  value,
});

describe('the roll (P6-06)', () => {
  it('sorts the notes, finds the range and the sustain pedal’s spans', () => {
    const data = rollData([
      note(64, 1, 2),
      pedal(0.5, 127),
      note(48, 0, 4),
      pedal(2.5, 0),
      pedal(3, 127),
    ]);
    expect(data.notes.map((n) => n.pitch)).toEqual([48, 64]);
    expect([data.low, data.high]).toEqual([48, 64]);
    expect(data.longest).toBe(4);
    expect(data.sustain).toEqual([
      [0.5, 2.5],
      [3, Infinity],
    ]);
  });

  it('has a range to show for a piece with no notes', () => {
    const data = rollData([]);
    expect(data.low).toBeLessThan(data.high);
  });
});

describe('the keys and pedals of the player piano (P6-06)', () => {
  const data = rollData([
    note(48, 0, 4, 60),
    note(60, 1, 1.5, 100),
    note(60, 2, 2.5, 40),
    pedal(0.5, 127),
    pedal(2.5, 0),
  ]);

  it('holds a key down while its note sounds, even a long one that began long ago', () => {
    const keys = keysAt(data, 3.9);
    expect(keys.get(48)).toEqual({ depth: 1, velocity: 60, hand: 'left' });
    expect(keys.has(60)).toBe(false);
  });

  it('springs a key back up after its note ends, quickly at first', () => {
    const quarter = keysAt(data, 1.5 + RETURN_SECONDS / 4).get(60)?.depth ?? 0;
    const half = keysAt(data, 1.5 + RETURN_SECONDS / 2).get(60)?.depth ?? 0;
    expect(quarter).toBeLessThan(0.5);
    expect(half).toBeCloseTo(0.125, 5);
    expect(keysAt(data, 1.5 + RETURN_SECONDS / 2).get(60)?.velocity).toBe(100);
    expect(keysAt(data, 1.5 + RETURN_SECONDS + 0.001).has(60)).toBe(false);
  });

  it('takes a key down just before its note, faster for a loud one, so it is down as it sounds', () => {
    expect(pressSeconds(127)).toBeLessThan(pressSeconds(30));
    expect(pressSeconds(30)).toBeLessThanOrEqual(PRESS_SECONDS);
    const press = pressSeconds(100);
    expect(keysAt(data, 1 - press - 0.001).has(60)).toBe(false);
    const halfway = keysAt(data, 1 - press / 2).get(60)?.depth ?? 0;
    // Gathering speed: a quarter of the way down at half the time.
    expect(halfway).toBeCloseTo(0.25, 5);
    expect(keysAt(data, 1).get(60)?.depth).toBe(1);
  });

  it('lets a key struck again soon rise only part of the way', () => {
    const quick = rollData([note(60, 0, 0.5), note(60, 0.55, 1)]);
    const between = keysAt(quick, 0.535).get(60)?.depth ?? 0;
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1);
  });

  it('shows the same key struck again at its new loudness', () => {
    expect(keysAt(data, 2.1).get(60)).toMatchObject({ depth: 1, velocity: 40 });
  });

  it('presses no key before the music starts', () => {
    expect(keysAt(data, -0.5).size).toBe(0);
  });

  it('presses the pedals as the piece does', () => {
    expect(pedalsAt(data, 0).sustain).toBe(0);
    expect(pedalsAt(data, 0.5).sustain).toBe(127);
    expect(pedalsAt(data, 2.4).sustain).toBe(127);
    expect(pedalsAt(data, 3).sustain).toBe(0);
    expect(pedalsAt(data, 1).soft).toBe(0);
  });
});

describe('where the music room puts things (P6-06)', () => {
  it('draws a grand’s 88 keys when they fit, the roll above them and the pedal’s light below', () => {
    const g = roomGeometry(52 * MIN_WHITE_WIDTH, 700, { low: 60, high: 72 });
    expect(g.layout.keys).toHaveLength(88);
    expect(g.trackerY).toBeLessThan(g.keysTop);
    expect(g.keysTop + g.keysHeight).toBe(g.footTop);
    expect(g.footTop + g.footHeight).toBe(700);
    expect(g.pxPerSecond * ROLL_SECONDS).toBeCloseTo(g.trackerY, 5);
    expect(g.paperLeft).toBeGreaterThanOrEqual(0);
    expect(g.paperRight).toBeLessThanOrEqual(52 * MIN_WHITE_WIDTH);
  });

  it('widens the piece’s octaves as far as the keys stay wide enough to see', () => {
    const width = 36 * MIN_WHITE_WIDTH;
    const { low, high } = roomRange(width, { low: 50, high: 76 });
    expect(low % 12).toBe(0);
    expect(high % 12).toBe(11);
    expect(low).toBeLessThanOrEqual(50);
    expect(high).toBeGreaterThanOrEqual(76);
    // Five octaves (35 white keys) fit; a sixth would make the keys too narrow.
    expect(high - low + 1).toBe(60);
    expect(
      roomGeometry(width, 600, { low: 50, high: 76 }).layout.whiteWidth,
    ).toBeGreaterThanOrEqual(MIN_WHITE_WIDTH);
  });

  it('keeps the piece’s own octaves in a very narrow room', () => {
    const { low, high } = roomRange(200, { low: 50, high: 70 });
    expect([low, high]).toEqual([48, 83]);
  });

  it('keeps the keys a sensible height in a short room', () => {
    const g = roomGeometry(1200, 300, { low: 60, high: 72 });
    expect(g.keysHeight).toBeGreaterThanOrEqual(64);
    expect(g.trackerY).toBeGreaterThan(0);
  });
});

describe('the HDR lights over the music room (P6-06)', () => {
  const colours: RoomColours = {
    stage: [13, 13, 15],
    hole: [191, 167, 120],
    lit: [255, 243, 214],
    ink: '#c9ae78',
    gold: [200, 169, 106],
    keyLit: [240, 200, 120],
    ivory: [242, 237, 227],
    ebony: [17, 17, 19],
    left: [180, 90, 28],
    right: [43, 120, 184],
    plain: false,
    wide: true,
    serif: 'serif',
  };
  const data = rollData([note(60, 0, 1, 100), note(64, 0.5, 2, 40), pedal(0, 127)]);
  const g = roomGeometry(1200, 600, data);
  const frame = { data, seconds: 0.75, active: true, hands: false, still: false };

  it('lights the gold bar, each hole at it and its glow, and the pedal, but not the keys', () => {
    const lights = roomLights(g, frame, colours);
    // Bar + 2 × (hole + glow) + pedal.
    expect(lights).toHaveLength(6);
    expect(lights.some((l) => l.y >= g.keysTop && l.y < g.footTop)).toBe(false);
    expect(lights.every((l) => l.w > 0 && l.h > 0)).toBe(true);
    // The holes are well past white; the bar only a little brighter than its gold (0.79 in P3).
    const brightest = (l: { colour: readonly number[] }) => Math.max(...l.colour);
    expect(brightest(lights[1] as (typeof lights)[number])).toBeGreaterThan(1.3);
    expect(brightest(lights[0] as (typeof lights)[number])).toBeGreaterThan(0.85);
  });

  it('leaves only the bar lit while paused, and nothing under high contrast', () => {
    expect(roomLights(g, { ...frame, active: false }, colours)).toHaveLength(1);
    expect(roomLights(g, frame, { ...colours, plain: true })).toEqual([]);
  });
});

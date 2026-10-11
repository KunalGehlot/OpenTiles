import { describe, expect, it } from 'vitest';
import { parseNoteNames } from '../src/lib/notes';
import { encodeWav } from '../src/lib/wav';
import { hitTest, keyboardHeightFor, layoutKeyboard, rangeFor } from '../src/views/keyboard';

// The router and storage modules touch `window`/IndexedDB at import time, so they are tested
// through the end-to-end suite instead; these are the pure pieces.

describe('keyboard layout', () => {
  const layout = layoutKeyboard(60, 71, 700);

  it('lays out an octave of 7 white and 5 black keys', () => {
    expect(layout.keys.filter((k) => !k.black)).toHaveLength(7);
    expect(layout.keys.filter((k) => k.black)).toHaveLength(5);
    expect(layout.whiteWidth).toBe(100);
  });

  it('hit-tests black keys above white ones', () => {
    const cSharp = layout.keys.find((k) => k.pitch === 61);
    expect(cSharp).toBeDefined();
    const x = (cSharp?.x ?? 0) + (cSharp?.width ?? 0) / 2;
    expect(hitTest(layout, x, 10, 100)).toBe(61);
    expect(hitTest(layout, x, 90, 100)).toBe(x < 100 ? 60 : 62);
    expect(hitTest(layout, 650, 90, 100)).toBe(71);
  });

  it('extends black-key edges to white keys', () => {
    const l = layoutKeyboard(61, 70, 100);
    expect(l.low).toBe(60);
    expect(l.high).toBe(71);
  });

  it('chooses a range of at least two octaves starting on C', () => {
    const r = rangeFor([64, 67]);
    expect(r.low % 12).toBe(0);
    expect(r.high - r.low).toBeGreaterThanOrEqual(24);
    expect(rangeFor([])).toEqual({ low: 48, high: 84 });
  });
});

describe('parseNoteNames', () => {
  it('reads names with accidentals', () => {
    expect(parseNoteNames('C4 E4, G#4 Bb3')).toEqual([60, 64, 68, 58]);
    expect(parseNoteNames('')).toEqual([]);
  });
  it('rejects nonsense and out-of-range notes', () => {
    expect(parseNoteNames('H4')).toBeNull();
    expect(parseNoteNames('C9')).toBeNull();
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono header and clamps samples', () => {
    const wav = encodeWav([new Float32Array([0, 0.5]), new Float32Array([2])], 48000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(32767);
  });
});

describe('keyboard height', () => {
  it('keeps the usual size on tall canvases', () => {
    expect(keyboardHeightFor(650, 78)).toBe(170);
    expect(keyboardHeightFor(490, 14.5)).toBeCloseTo(147);
  });

  it('never takes more than 40 % of a short canvas', () => {
    // A phone in landscape: wide keys would ask for 170 px of a 240 px canvas.
    expect(keyboardHeightFor(240, 37)).toBeCloseTo(96);
    expect(keyboardHeightFor(150, 50)).toBeCloseTo(60);
  });
});

describe('wide windows', () => {
  it('caps the white key width and centres the keyboard', async () => {
    const { MAX_WHITE_WIDTH } = await import('../src/views/keyboard');
    const l = layoutKeyboard(60, 71, 2000, MAX_WHITE_WIDTH);
    expect(l.whiteWidth).toBe(MAX_WHITE_WIDTH);
    const first = l.keys[0];
    const last = l.keys.filter((k) => !k.black).at(-1);
    expect(first?.x).toBeCloseTo(2000 - ((last?.x ?? 0) + (last?.width ?? 0)));
  });

  it('widens the range by octaves until the keys fit, and keeps a narrow window as it is', async () => {
    const { widenRange } = await import('../src/views/keyboard');
    expect(widenRange({ low: 36, high: 72 }, 600)).toEqual({ low: 36, high: 72 });
    const wide = widenRange({ low: 36, high: 72 }, 2560);
    expect(wide.low).toBeLessThan(36);
    expect(wide.high).toBeGreaterThan(72);
    expect(wide.low).toBeGreaterThanOrEqual(21);
    expect(wide.high).toBeLessThanOrEqual(108);
  });

  // P5-16: a wide window used to add octaves to the learner's own keyboard too.
  it('draws a chosen keyboard with exactly its keys, centred, at any width', async () => {
    const { MAX_WHITE_WIDTH, practiceLayout } = await import('../src/views/keyboard');
    const boards = [
      { low: 21, high: 108, whites: 52 },
      { low: 36, high: 96, whites: 36 },
      { low: 36, high: 84, whites: 29 },
      { low: 48, high: 84, whites: 22 },
      { low: 48, high: 72, whites: 15 },
    ];
    for (const b of boards) {
      for (const width of [320, 600, 2056, 2560]) {
        const l = practiceLayout({ low: b.low, high: b.high, fixed: true }, width);
        expect([l.low, l.high]).toEqual([b.low, b.high]);
        expect(l.keys).toHaveLength(b.high - b.low + 1);
        expect(l.keys.filter((k) => !k.black)).toHaveLength(b.whites);
        expect(l.whiteWidth).toBeCloseTo(Math.min(width / b.whites, MAX_WHITE_WIDTH));
        const left = l.keys[0]?.x ?? NaN;
        const last = l.keys.at(-1);
        expect(left).toBeCloseTo(width - ((last?.x ?? 0) + (last?.width ?? 0)));
      }
    }
  });

  it('still widens the keys a piece needs on a wide window', async () => {
    const { MAX_WHITE_WIDTH, practiceLayout } = await import('../src/views/keyboard');
    const l = practiceLayout({ low: 48, high: 72, fixed: false }, 2056);
    expect(l.low).toBeLessThan(48);
    expect(l.high).toBeGreaterThanOrEqual(72);
    expect(l.whiteWidth).toBeLessThanOrEqual(MAX_WHITE_WIDTH);
    const narrow = practiceLayout({ low: 48, high: 72, fixed: false }, 320);
    expect([narrow.low, narrow.high]).toEqual([48, 72]);
  });
});

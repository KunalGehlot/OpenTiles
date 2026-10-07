import { describe, expect, it } from 'vitest';
import { packValue, unpackValue } from '../src/codec';

describe('packValue / unpackValue', () => {
  it('round-trips nested plain data with byte arrays', () => {
    const value = {
      title: 'Prélude (self-made test piece)',
      bytes: new Uint8Array([0, 1, 2, 250, 255]),
      song: {
        notes: [
          { pitch: 60, startBeat: 0, durationBeats: 1.5 },
          { pitch: 64, startBeat: 1, durationBeats: 0.5 },
        ],
        empty: [],
        nothing: null,
      },
      parts: [new Uint8Array(0), new Uint8Array([7])],
      flag: false,
      count: -12.25,
    };
    const back = unpackValue(packValue(value));
    expect(back).toEqual(value);
    expect((back as { bytes: unknown }).bytes).toBeInstanceOf(Uint8Array);
  });

  it('keeps objects that happen to use the tag keys', () => {
    const value = {
      a: { $bin: 0 },
      b: { $esc: { $bin: 3 } },
      c: { $bin: 'x', other: true },
      d: [{ $esc: 1 }],
    };
    expect(unpackValue(packValue(value))).toEqual(value);
  });

  it('keeps a "__proto__" key as data, not as a prototype', () => {
    const value: unknown = JSON.parse('{"__proto__": {"polluted": true}, "x": 1}');
    const back = unpackValue(packValue(value)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(back, '__proto__')).toBe(true);
  });

  it('drops undefined object fields and turns undefined array items into null, like JSON', () => {
    expect(unpackValue(packValue({ a: undefined, b: [undefined, 1] }))).toEqual({ b: [null, 1] });
  });

  it('round-trips top-level scalars', () => {
    for (const v of [null, 0, 'text', true, new Uint8Array([9])]) {
      expect(unpackValue(packValue(v))).toEqual(v);
    }
  });

  it('refuses values JSON would silently mangle', () => {
    class Thing {}
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const bad of [
      NaN,
      Infinity,
      { when: new Date(0) },
      { m: new Map() },
      new Thing(),
      { f: () => 1 },
      undefined,
      10n,
      cyclic,
      new Uint16Array(2),
    ]) {
      expect(() => packValue(bad)).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    }
  });

  it('allows the same object twice when it is not a cycle', () => {
    const shared = { x: 1 };
    expect(unpackValue(packValue({ a: shared, b: shared }))).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it('rejects malformed input', () => {
    const good = packValue({ bytes: new Uint8Array([1, 2, 3]) });
    expect(() => unpackValue(good.subarray(0, good.length - 1))).toThrow(
      expect.objectContaining({ code: 'corrupt' }),
    );
    const extra = new Uint8Array(good.length + 1);
    extra.set(good);
    expect(() => unpackValue(extra)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    const wrongVersion = good.slice();
    wrongVersion[0] = 9;
    expect(() => unpackValue(wrongVersion)).toThrow();
    expect(() => unpackValue(new Uint8Array(3))).toThrow();
  });
});

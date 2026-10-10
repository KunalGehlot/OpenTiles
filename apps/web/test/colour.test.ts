import { describe, expect, it } from 'vitest';
import { isDark, luminance, mix, parseColour, rgba } from '../src/views/colour';

describe('parseColour', () => {
  it('reads hex colours, short and long', () => {
    expect(parseColour('#2b78b8')).toEqual({ rgb: [43, 120, 184], alpha: 1 });
    expect(parseColour('  #FFF ')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
  });

  it('reads rgb() and rgba()', () => {
    expect(parseColour('rgba(43, 120, 184, 0.3)')).toEqual({ rgb: [43, 120, 184], alpha: 0.3 });
    expect(parseColour('rgb(0,0,0)')).toEqual({ rgb: [0, 0, 0], alpha: 1 });
  });

  it('gives null for what a canvas token should never hold', () => {
    expect(parseColour('')).toBeNull();
    expect(parseColour('red')).toBeNull();
    expect(parseColour('var(--accent)')).toBeNull();
    expect(parseColour('color-mix(in srgb, #000 50%, #fff)')).toBeNull();
  });
});

describe('colour maths', () => {
  it('writes a fill style with a chosen opacity', () => {
    expect(rgba([1, 2, 3], 0.5)).toBe('rgba(1, 2, 3, 0.5)');
    expect(rgba([1, 2, 3], 2)).toBe('rgba(1, 2, 3, 1)');
    expect(rgba([1, 2, 3], -1)).toBe('rgba(1, 2, 3, 0)');
  });

  it('measures luminance and tells dark from light', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(isDark([14, 20, 19])).toBe(true);
    expect(isDark([238, 242, 240])).toBe(false);
  });

  it('mixes two colours', () => {
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
    expect(mix([10, 20, 30], [10, 20, 30], 0.7)).toEqual([10, 20, 30]);
  });
});

// Wide-gamut and HDR colour for the music room (P6-06): tokens move into Display P3 unchanged
// unless asked for more colour, and HDR lights get brighter than white without changing hue.
import { describe, expect, it } from 'vitest';
import { encode, hdrColour, linearP3, p3Colour, toLinear } from '../src/player/wide';

describe('wide-gamut colour (P6-06)', () => {
  it('undoes and redoes the sRGB transfer function', () => {
    for (const c of [0, 10, 128, 200, 255]) {
      expect(encode(toLinear(c)) * 255).toBeCloseTo(c, 6);
    }
  });

  it('keeps white white and grey grey in Display P3, at any boost', () => {
    for (const [r, g, b] of linearP3([255, 255, 255], 1.3).map((v) => [v, v, v])) {
      expect(r).toBeCloseTo(1, 4);
      expect(g).toBeCloseTo(1, 4);
      expect(b).toBeCloseTo(1, 4);
    }
    const grey = linearP3([128, 128, 128], 1.5);
    expect(grey[0]).toBeCloseTo(grey[1], 4);
    expect(grey[1]).toBeCloseTo(grey[2], 4);
  });

  it('gives the gold more colour at the same luminance when boosted', () => {
    const plain = linearP3([200, 169, 106]);
    const rich = linearP3([200, 169, 106], 1.3);
    const luma = (p: readonly number[]) =>
      0.2289746 * (p[0] ?? 0) + 0.6917385 * (p[1] ?? 0) + 0.0792869 * (p[2] ?? 0);
    expect(luma(rich)).toBeCloseTo(luma(plain), 6);
    expect(rich[0] - rich[2]).toBeGreaterThan(plain[0] - plain[2]);
  });

  it('writes a canvas colour in Display P3, matching the token when not boosted', () => {
    expect(p3Colour([200, 169, 106], 0.5)).toBe('color(display-p3 0.7646 0.6672 0.4490 / 0.5)');
    expect(p3Colour([0, 0, 0], 2)).toBe('color(display-p3 0.0000 0.0000 0.0000 / 1)');
  });

  it('makes an HDR light brighter than white without changing its hue', () => {
    const once = hdrColour([255, 243, 214], 1);
    const thrice = hdrColour([255, 243, 214], 3);
    expect(Math.max(...thrice)).toBeGreaterThan(1);
    expect(Math.max(...once)).toBeLessThanOrEqual(1.0001);
    // The same ratios between channels in linear light.
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    expect(lin(thrice[2]) / lin(thrice[0])).toBeCloseTo(lin(once[2]) / lin(once[0]), 4);
  });
});

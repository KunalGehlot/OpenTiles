// Wide-gamut and high-dynamic-range colour for the music room (P6-06): the gold and the warm
// light, richer than sRGB can show on a Display P3 screen, and brighter than paper white on an HDR
// one. Every colour starts as a design token (sRGB, styles/tokens.css); these functions only move
// it into Display P3, give it a little more colour and, for HDR, more light. Pure, so they are
// unit-tested in Node.
import type { Rgb } from '../views/colour';

export type Vec3 = readonly [number, number, number];

/** The sRGB transfer function, undone: 0–255 to linear light, 0–1. */
export function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The sRGB transfer function (Display P3 uses the same), extended past 1 for HDR. */
export function encode(linear: number): number {
  const x = Math.max(0, linear);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Linear sRGB to linear Display P3 (both D65). */
const SRGB_TO_P3 = [
  [0.8224621, 0.177538, 0],
  [0.0331941, 0.9668058, 0],
  [0.0170827, 0.0723974, 0.9105199],
] as const;

/** Relative luminance of a linear Display P3 colour. */
const P3_LUMA = [0.2289746, 0.6917385, 0.0792869] as const;

/**
 * A token's colour as linear Display P3, with its colour pushed `boost` times further from grey at
 * the same luminance (1 keeps it as it is). Channels stay at or above 0; they may pass 1 only if
 * the boost asks for more than the gamut holds, so callers for plain colour clamp them.
 */
export function linearP3(rgb: Rgb, boost = 1): Vec3 {
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const [m0, m1, m2] = SRGB_TO_P3;
  const p: Vec3 = [
    m0[0] * r + m0[1] * g + m0[2] * b,
    m1[0] * r + m1[1] * g + m1[2] * b,
    m2[0] * r + m2[1] * g + m2[2] * b,
  ];
  const y = P3_LUMA[0] * p[0] + P3_LUMA[1] * p[1] + P3_LUMA[2] * p[2];
  const push = (c: number) => Math.max(0, y + (c - y) * boost);
  return [push(p[0]), push(p[1]), push(p[2])];
}

/** A canvas or CSS colour string in Display P3 for a token's colour, richer by `boost`. */
export function p3Colour(rgb: Rgb, alpha = 1, boost = 1): string {
  const [r, g, b] = linearP3(rgb, boost);
  const c = (v: number) => encode(Math.min(1, v)).toFixed(4);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `color(display-p3 ${c(r)} ${c(g)} ${c(b)} / ${a})`;
}

/**
 * A light for an HDR canvas: the token's colour in Display P3, `intensity` times as bright as the
 * screen's white (1 is paper white, 2 twice as much light), encoded as the canvas expects.
 */
export function hdrColour(rgb: Rgb, intensity: number, boost = 1): Vec3 {
  const [r, g, b] = linearP3(rgb, boost);
  return [encode(r * intensity), encode(g * intensity), encode(b * intensity)];
}

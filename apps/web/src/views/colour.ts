// Colours for the canvas views (P4-10). The design tokens (src/styles/tokens.css) are plain
// #rrggbb or rgba() values because a canvas cannot resolve var() or color-mix(); these helpers
// take them apart so the renderer can derive glows and edges once, when the palette is read.
// Pure, so they are unit-tested in Node.

export type Rgb = readonly [number, number, number];

export interface Colour {
  rgb: Rgb;
  alpha: number;
}

/** Reads `#rgb`, `#rrggbb`, `rgb()` and `rgba()`; null for anything else (named colours, var()). */
export function parseColour(value: string): Colour | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      (hex[1] as string).length === 3 ? (hex[1] as string).replace(/./g, '$&$&') : hex[1];
    const n = parseInt(digits as string, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (fn) {
    const channel = (s: string | undefined) => Math.min(255, Number(s));
    return {
      rgb: [channel(fn[1]), channel(fn[2]), channel(fn[3])],
      alpha: fn[4] === undefined ? 1 : Math.min(1, Number(fn[4])),
    };
  }
  return null;
}

/** The colour as a canvas fill style, with its own opacity replaced by `alpha`. */
export function rgba(rgb: Rgb, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** `t` of the way from `a` to `b`, per channel. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const m = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * t);
  return [m(0), m(1), m(2)];
}

/** A colour that is dark enough to need light marks on it. */
export function isDark(rgb: Rgb): boolean {
  return luminance(rgb) < 0.2;
}

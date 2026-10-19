// The design tokens (src/styles/tokens.css, ADR 0011) keep readable contrast in all four colour
// sets: light, dark, and high contrast in each. The stylesheet is parsed as plain text, so this
// runs in Node with no browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Tokens = Record<string, string>;

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

interface Block {
  media: string | null;
  selector: string;
  tokens: Tokens;
}

/** Reads `selector { --name: value; }` blocks, with the @media condition they sit in, if any. */
function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const ruleBody = /([^{}]+)\{([^{}]*)\}/g;
  const mediaStart = /@media\s*([^{]+)\{/g;
  // Find each @media region by brace matching, then read the rules inside it.
  const regions: { from: number; start: number; end: number; media: string }[] = [];
  for (let m = mediaStart.exec(source); m; m = mediaStart.exec(source)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    regions.push({
      from: m.index,
      start: m.index + m[0].length,
      end: i - 1,
      media: (m[1] ?? '').trim(),
    });
    mediaStart.lastIndex = i;
  }
  // What is left once the @media regions (header, body and closing brace) are blanked out.
  const outside = regions.reduceRight(
    (text, r) => text.slice(0, r.from) + ' '.repeat(r.end + 1 - r.from) + text.slice(r.end + 1),
    source,
  );
  const read = (text: string, media: string | null) => {
    for (let m = ruleBody.exec(text); m; m = ruleBody.exec(text)) {
      const tokens: Tokens = {};
      for (const d of (m[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        tokens[d[1] as string] = (d[2] as string).trim();
      }
      blocks.push({ media, selector: (m[1] ?? '').trim(), tokens });
    }
    ruleBody.lastIndex = 0;
  };
  read(outside, null);
  for (const r of regions) read(source.slice(r.start, r.end), r.media);
  return blocks;
}

const blocks = parseBlocks(css);
const find = (selector: string, media: string | null): Tokens => {
  const block = blocks.find((b) => b.selector === selector && b.media === media);
  if (!block) throw new Error(`no ${media ?? 'plain'} block for ${selector}`);
  return block.tokens;
};
const DARK = '(prefers-color-scheme: dark)';

// The cascade: html[data-high-contrast] (more specific) beats :root, so its values win in both
// colour schemes; the dark variant of it then overrides the light one.
// A theme chosen in Settings (P5-09): the media query's dark sets apply unless light is chosen,
// and the same sets are written again for dark chosen. `:where()` adds nothing to specificity.
const SYSTEM_DARK = ":root:where(:not([data-theme='light']))";
const CHOSEN_DARK = ":root:where([data-theme='dark'])";
const HC = 'html[data-high-contrast]';
const HC_SYSTEM_DARK = "html[data-high-contrast]:where(:not([data-theme='light']))";
const HC_CHOSEN_DARK = "html[data-high-contrast]:where([data-theme='dark'])";

const light: Tokens = find(':root', null);
const dark: Tokens = { ...light, ...find(SYSTEM_DARK, DARK) };
const hcLight: Tokens = { ...light, ...find(HC, null) };
const hcDark: Tokens = { ...dark, ...find(HC, null), ...find(HC_SYSTEM_DARK, DARK) };
describe('dark chosen in Settings (P5-09)', () => {
  it('has the same colours as the device’s dark mode, in full', () => {
    expect(find(CHOSEN_DARK, null)).toEqual(find(SYSTEM_DARK, DARK));
    expect(find(HC_CHOSEN_DARK, null)).toEqual(find(HC_SYSTEM_DARK, DARK));
  });
});

const SETS: [string, Tokens][] = [
  ['light', light],
  ['dark', dark],
  ['high contrast', hcLight],
  ['high contrast (dark)', hcDark],
];

type Rgba = [number, number, number, number];

function parseColour(value: string, name: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = (hex[1] as string).length === 3 ? (hex[1] as string).replace(/./g, '$&$&') : hex[1];
    const n = parseInt(h as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4] ?? 1)];
  throw new Error(`${name}: "${value}" is not a plain #rrggbb or rgba() colour`);
}

/** `fg` laid over an opaque `bg`. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [0, 1, 2]
    .map((i) => Math.round((fg[i] as number) * a + (bg[i] as number) * (1 - a)))
    .concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(set: Tokens, fg: string, bg: string): number {
  const bgColour = parseColour(set[bg] ?? '', bg);
  const fgColour = over(parseColour(set[fg] ?? '', fg), bgColour);
  const [hi, lo] = [luminance(fgColour), luminance(bgColour)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text pairs: WCAG AA for body text. */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ['--text', '--bg'],
  ['--text', '--surface'],
  ['--text', '--surface-2'],
  ['--text', '--sunken'],
  ['--muted', '--bg'],
  ['--muted', '--surface'],
  ['--muted', '--surface-2'],
  ['--muted', '--sunken'],
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  ['--accent-ink', '--accent-soft'],
  ['--accent-ink', '--surface'],
  ['--accent-text', '--accent'],
  ['--accent-text', '--accent-hover'],
  ['--ok', '--surface'],
  ['--ok', '--ok-soft'],
  ['--bad', '--surface'],
  ['--bad', '--bad-soft'],
  ['--warn', '--surface'],
  ['--warn', '--warn-soft'],
  // Fingering digits and early/late labels are drawn on the hand colours and on --warn.
  ['--on-hand', '--hand-right'],
  ['--on-hand', '--hand-left'],
  ['--on-hand', '--warn'],
  // The initials on the Player's generated covers (P6-06).
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string] => ['--on-cover', `--cover-${n}`]),
  // The Player's music room (P6-06): the title, the composer and the controls on the stage, and
  // the title printed on the roll's leader.
  ['--room-text', '--roll-paper'],
  ['--room-text', '--roll-edge'],
  ['--room-text', '--room-hover'],
  ['--room-muted', '--roll-paper'],
  ['--room-muted', '--roll-edge'],
  ['--roll-ink', '--roll-paper'],
  ['--brass', '--roll-paper'],
  ['--room-on-gold', '--brass'],
  ['--room-on-gold', '--brass-hover'],
];

/** Marks that must be seen but are not text: control outlines, focus ring, notes on the canvas. */
const MARK_PAIRS: [fg: string, bg: string][] = [
  ['--control', '--surface'],
  ['--control', '--bg'],
  ['--focus', '--bg'],
  ['--focus', '--surface'],
  ['--accent', '--sunken'],
  ['--hand-right', '--canvas-bg'],
  ['--hand-left', '--canvas-bg'],
  ['--ok', '--canvas-bg'],
  ['--bad', '--canvas-bg'],
  ['--warn', '--canvas-bg'],
  ['--now-line', '--canvas-bg'],
  // The music room (P6-06): holes in the roll, the hole at the tracker bar, the keys on the stage.
  ['--roll-hole', '--roll-paper'],
  ['--roll-lit', '--roll-paper'],
  ['--room-ivory', '--roll-paper'],
];

describe('design tokens', () => {
  it('defines the same names in every set, with plain colours the canvas can read', () => {
    const colourNames = Object.keys(light).filter((n) => /^--(?!font|text-|leading)/.test(n));
    for (const [label, set] of SETS) {
      for (const name of colourNames) {
        expect(set[name], `${label}: ${name}`).toBeDefined();
      }
    }
    for (const name of [
      '--bg',
      '--surface',
      '--text',
      '--muted',
      '--accent',
      '--hand-right',
      '--hand-left',
      '--on-hand',
      '--canvas-bg',
      '--key-white',
      '--key-black',
      '--now-line',
    ]) {
      for (const [label, set] of SETS) {
        expect(() => parseColour(set[name] ?? '', `${label} ${name}`)).not.toThrow();
      }
    }
  });

  describe.each(SETS)('%s', (label, set) => {
    it.each(TEXT_PAIRS)('%s on %s reads as text (4.5:1)', (fg, bg) => {
      expect(contrast(set, fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });

    it.each(MARK_PAIRS)('%s on %s is visible (3:1)', (fg, bg) => {
      expect(contrast(set, fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  });
});

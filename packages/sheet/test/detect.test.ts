// Bar detection on generated pages (test/fixtures.ts), read through pdf.js as the app reads them.
import { describe, expect, it } from 'vitest';
import { detectLayout, detectPage, drawingFromBitmap } from '../src';
import type { SheetBar } from '../src';
import { PAGE, plainPages, scanBitmap, scanPdf, scorePdf, truthOf } from './fixtures';
import type { FixturePage } from './fixtures';
import { drawingsOf } from './pdf';

const perSystem = (bars: readonly SheetBar[]) => {
  const out: number[] = [];
  for (const b of bars) out[b.system] = (out[b.system] ?? 0) + 1;
  return out;
};

describe('bar detection', () => {
  it('finds the staves, systems and bars of an engraved page', async () => {
    const pages = plainPages(22, { perSystem: 4, systems: 6, heads: 6 });
    const [drawing] = await drawingsOf(scorePdf(pages, { pedal: true }));
    const result = detectPage(drawing!, 0);
    expect(result.staves).toHaveLength(12);
    expect(result.systems).toHaveLength(6);
    expect(perSystem(result.bars)).toEqual(truthOf(pages).barsPerSystem[0]);
    expect(result.bars.every((b) => b.heads === 6)).toBe(true);
    expect(result.bars.at(-1)?.end).toBe('final');
    expect(result.bars.slice(0, -1).every((b) => b.end === 'single')).toBe(true);
    // Bars are in reading order, each one right of the one before in its system.
    for (let i = 1; i < result.bars.length; i++) {
      const [a, b] = [result.bars[i - 1]!, result.bars[i]!];
      if (a.system === b.system) expect(b.box.x).toBeGreaterThan(a.box.x);
      else expect(b.system).toBe(a.system + 1);
    }
  });

  it('puts every page in one layout with systems counted through the document', async () => {
    const pages = plainPages(40, { perSystem: 4, systems: 6 });
    const layout = detectLayout(await drawingsOf(scorePdf(pages)));
    expect(layout.source).toBe('vector');
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]?.width).toBeCloseTo(PAGE.width, 1);
    expect(layout.bars).toHaveLength(40);
    expect(layout.bars.filter((b) => b.page === 1)).toHaveLength(16);
    expect(layout.bars[24]?.system).toBe(6);
  });

  it('reads staff lines and barlines drawn as thin rectangles, in pieces', async () => {
    const pages = plainPages(12, { perSystem: 3, systems: 4 });
    const [drawing] = await drawingsOf(scorePdf(pages, { style: 'rect', brokenStaffLines: true }));
    const result = detectPage(drawing!, 0);
    expect(result.systems).toHaveLength(4);
    expect(perSystem(result.bars)).toEqual([3, 3, 3, 3]);
    expect(result.bars.at(-1)?.end).toBe('final');
  });

  it('reads single-staff systems, which have no line at the left', async () => {
    const page: FixturePage = {
      systems: [1, 2, 3].map(() => ({
        staves: 1,
        bars: [
          { width: 130, heads: 4 },
          { width: 130, heads: 4 },
          { width: 130, heads: 3 },
        ],
      })),
    };
    const [drawing] = await drawingsOf(scorePdf([page], { space: 6 }));
    const result = detectPage(drawing!, 0);
    expect(result.systems).toHaveLength(3);
    expect(perSystem(result.bars)).toEqual([3, 3, 3]);
    expect(result.bars.map((b) => b.heads)).toEqual([4, 4, 3, 4, 4, 3, 4, 4, 3]);
  });

  it('tells repeat signs, double and final barlines apart', async () => {
    const page: FixturePage = {
      systems: [
        {
          bars: [
            { width: 120, heads: 4 },
            { width: 110, heads: 4, start: 'repeat-start' },
            { width: 110, heads: 4, end: 'repeat-end' },
            { width: 110, heads: 4, end: 'double' },
          ],
        },
        {
          bars: [
            { width: 140, heads: 4, start: 'repeat-start' },
            { width: 110, heads: 4, end: 'repeat-end' },
            { width: 110, heads: 4, start: 'repeat-start', end: 'repeat-end' },
            { width: 110, heads: 4, end: 'final' },
          ],
        },
      ],
    };
    const [drawing] = await drawingsOf(scorePdf([page]));
    const bars = detectPage(drawing!, 0).bars;
    expect(bars.map((b) => [b.start, b.end])).toEqual([
      ['none', 'double'],
      ['repeat-start', 'single'],
      ['single', 'repeat-end'],
      ['single', 'double'],
      // A repeat sign after the clef and key: its bar still starts at the system's line.
      ['repeat-start', 'single'],
      ['single', 'repeat-end'],
      ['repeat-start', 'repeat-end'],
      ['single', 'final'],
    ]);
    expect(bars[4]?.box.x).toBeLessThan(60);
  });

  it('does not take dotted notes before a barline for a repeat sign', async () => {
    const page: FixturePage = {
      systems: [
        {
          bars: [
            { width: 130, heads: 4, dotted: true },
            { width: 130, heads: 4, dotted: true },
            { width: 130, heads: 4 },
          ],
        },
      ],
    };
    const [drawing] = await drawingsOf(scorePdf([page]));
    const bars = detectPage(drawing!, 0).bars;
    expect(bars.map((b) => b.end)).toEqual(['single', 'single', 'single']);
  });

  it('finds first and second endings, also when one runs on into the next system', async () => {
    const page: FixturePage = {
      systems: [
        {
          bars: [
            { width: 120, heads: 4, start: 'repeat-start' },
            { width: 120, heads: 4 },
            { width: 120, heads: 4, ending: 1, end: 'repeat-end' },
            { width: 120, heads: 4, ending: 2 },
          ],
        },
        {
          bars: [
            { width: 140, heads: 4, ending: 2 },
            { width: 120, heads: 4 },
            { width: 120, heads: 4, ending: 1, tuplet: true },
            { width: 120, heads: 4, ending: 1, end: 'repeat-end' },
          ],
        },
        {
          bars: [
            { width: 140, heads: 4, ending: 2, tuplet: true },
            { width: 120, heads: 4, tuplet: true },
            { width: 120, heads: 4, end: 'final' },
          ],
        },
      ],
    };
    const layout = detectLayout(await drawingsOf(scorePdf([page])));
    expect(layout.bars.map((b) => b.ending ?? 0)).toEqual([0, 0, 1, 2, 2, 0, 1, 1, 2, 0, 0]);
  });

  it('does not take a triplet bracket for an ending', async () => {
    const page: FixturePage = {
      systems: [
        {
          bars: [
            { width: 130, heads: 6, tuplet: true },
            { width: 130, heads: 6, tuplet: true },
          ],
        },
      ],
    };
    const layout = detectLayout(await drawingsOf(scorePdf([page])));
    expect(layout.bars.map((b) => b.ending)).toEqual([undefined, undefined]);
  });

  it('keeps a narrow pickup bar, and ignores a courtesy signature after the last barline', async () => {
    const page: FixturePage = {
      systems: [
        {
          bars: [
            { width: 70, heads: 1 },
            { width: 120, heads: 4 },
            { width: 120, heads: 4 },
          ],
          courtesy: true,
        },
        {
          bars: [
            { width: 140, heads: 4 },
            { width: 120, heads: 4, end: 'final' },
          ],
        },
      ],
    };
    const [drawing] = await drawingsOf(scorePdf([page]));
    const bars = detectPage(drawing!, 0).bars;
    expect(perSystem(bars)).toEqual([3, 2]);
    expect(bars[0]?.heads).toBe(1);
    // Where the notes start, after the clef and key.
    expect(bars[0]?.firstNoteX).toBeGreaterThan((bars[0]?.box.x ?? 0) + 20);
  });

  it('works at other print sizes and scales', async () => {
    const pages = plainPages(8, { perSystem: 4, systems: 2, width: 100 });
    for (const options of [
      { space: 3.5, scale: 1.2 },
      { space: 8, scale: 0.7 },
    ]) {
      const [drawing] = await drawingsOf(scorePdf(pages, options));
      expect(perSystem(detectPage(drawing!, 0).bars)).toEqual([4, 4]);
    }
  });

  it('finds nothing on a page without music', () => {
    const result = detectPage({ page: PAGE, lines: [], blobs: [], scanned: false }, 0);
    expect(result.bars).toEqual([]);
  });
});

describe('scanned pages', () => {
  it('finds systems and bars in a page image, slightly tilted', () => {
    const [page] = plainPages(16, { perSystem: 4, systems: 4 });
    for (const tilt of [0, 3]) {
      const drawing = drawingFromBitmap(scanBitmap(page!, { dpi: 150, tilt }), PAGE);
      const result = detectPage(drawing, 0);
      expect(result.systems).toHaveLength(4);
      expect(perSystem(result.bars)).toEqual([4, 4, 4, 4]);
    }
  });

  it('knows a scanned PDF page for one the drawing reader cannot see into', async () => {
    const [drawing] = await drawingsOf(scanPdf(plainPages(8, { perSystem: 4, systems: 2 })));
    expect(drawing?.scanned).toBe(true);
    expect(detectPage(drawing!, 0).bars).toEqual([]);
  });

  it('reads an RGBA canvas image as well as grey', () => {
    const [page] = plainPages(4, { perSystem: 2, systems: 2 });
    const grey = scanBitmap(page!, { dpi: 100 });
    const rgba = new Uint8ClampedArray(grey.width * grey.height * 4);
    grey.data.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
    const drawing = drawingFromBitmap({ ...grey, data: rgba, channels: 4 }, PAGE);
    expect(perSystem(detectPage(drawing, 0).bars)).toEqual([2, 2]);
  });
});

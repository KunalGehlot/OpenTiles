// Engraving a score with Verovio (ADR 0009): laying it out, drawing its pages and linking the
// song's notes to the drawn glyphs. This is the work the engraver worker does (P5-13), kept apart
// from the worker's messages so Node tests can run it with a toolkit of their own.
import type { Song } from '@opentiles/song-model';
import {
  glyphsFromTimemap,
  linkByRefs,
  linkNotes,
  measureOrderFromSvg,
  noteIdsFromSvg,
} from './glyph-map';
import type { ScoreLinks, TimemapEntry } from './glyph-map';
import { sanitiseSvg } from './sanitise';
import type { Toolkit } from './verovio';

export type ScoreLayout = 'scroll' | 'page';

/** The widest the engraved page gets (CSS px); wider windows centre it. */
const MAX_PAGE_WIDTH = 1100;

/** Verovio scale (percent) for a view width: smaller on narrow screens (⅓ iPad, P1-27). */
export function scaleFor(width: number, layout: ScoreLayout): number {
  if (layout === 'scroll') return width < 500 ? 32 : width < 1000 ? 40 : width < 1600 ? 52 : 64;
  return width < 500 ? 26 : width < 900 ? 32 : width < 1600 ? 42 : 52;
}

/** Verovio's layout options for a view of this size: one long system, or pages that fit it. */
export function layoutOptions(
  width: number,
  height: number,
  layout: ScoreLayout,
): Record<string, unknown> {
  const scale = scaleFor(width, layout);
  const units = (px: number) => Math.round((px * 100) / scale);
  if (layout === 'scroll') {
    return {
      scale,
      breaks: 'none',
      adjustPageHeight: true,
      adjustPageWidth: true,
      pageMarginLeft: 0,
      pageMarginRight: 0,
      pageMarginTop: 40,
      pageMarginBottom: 40,
    };
  }
  return {
    scale,
    breaks: 'auto',
    adjustPageHeight: false,
    adjustPageWidth: false,
    // A page, not the whole window: on a wide screen it is centred instead of stretched.
    pageWidth: Math.max(units(Math.min(width, MAX_PAGE_WIDTH)), 600),
    pageHeight: Math.max(units(height), 600),
    pageMarginLeft: 60,
    pageMarginRight: 60,
    pageMarginTop: 60,
    pageMarginBottom: 60,
  };
}

export interface DrawnScore {
  /** Every page as sanitised SVG. */
  pages: string[];
  /** Measure element ids in document order (index = `Measure.sourceIndex`). */
  measureIds: string[];
  /** Source measure index → the page (from 1) it is first drawn on. */
  measurePage: Map<number, number>;
}

/** Lays the score out with these options and draws every page. */
export function drawPages(tk: Toolkit, options: Record<string, unknown>): DrawnScore {
  tk.setOptions(options);
  tk.redoLayout();
  const count = Math.max(1, tk.getPageCount());
  const pages = Array.from({ length: count }, (_, i) => sanitiseSvg(tk.renderToSVG(i + 1)));
  const measureIds = measureOrderFromSvg(pages);
  const order = new Map(measureIds.map((id, i) => [id, i]));
  const measurePage = new Map<number, number>();
  pages.forEach((svg, i) => {
    for (const id of measureOrderFromSvg([svg])) {
      const index = order.get(id);
      if (index !== undefined && !measurePage.has(index)) measurePage.set(index, i + 1);
    }
  });
  return { pages, measureIds, measurePage };
}

/**
 * Links the song's notes to the glyphs of the drawn score: by ref for a score written from the
 * song (P5-13), otherwise by measure, onset and pitch from Verovio's timemap.
 */
export function linkScore(
  tk: Toolkit,
  song: Song,
  drawn: DrawnScore,
  generated: boolean,
): ScoreLinks {
  if (generated) return linkByRefs(song, noteIdsFromSvg(drawn.pages));
  const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: false });
  const glyphs = glyphsFromTimemap(
    Array.isArray(timemap) ? (timemap as TimemapEntry[]) : [],
    drawn.measureIds,
    (id) => tk.getMIDIValuesForElement(id)?.pitch,
  );
  return linkNotes(song, glyphs);
}

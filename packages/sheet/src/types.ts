// The shared shape of a sheet-music PDF's layout and of its link to a song (ADR 0018). The PDF is
// drawn, and its notes are never taken from it: the notes come from the MIDI (or other score) file
// beside it. These types say where on the pages each of the song's measures is written, and
// (P5-18) how the PDF writes them, for engraving the song the same way.
import type { ScoreHints } from '@opentiles/song-model';

/** A rectangle on a PDF page, in PDF points (1/72 inch), origin at the page's top-left corner. */
export interface SheetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page's size in PDF points, as drawn (after the page's own rotation). */
export interface SheetPage {
  width: number;
  height: number;
}

/**
 * How a written bar starts or ends. Repeat signs and endings matter because the song's measures
 * are in playback order (a MIDI file plays repeats out) while the sheet writes a repeated passage
 * once.
 */
export type SheetBarline = 'single' | 'double' | 'final' | 'repeat-start' | 'repeat-end' | 'none';

/** One written bar: from one barline to the next, across every staff of its system. */
export interface SheetBar {
  /** 0-based page number. */
  page: number;
  /** 0-based system number, counted through the whole document. */
  system: number;
  box: SheetRect;
  start: SheetBarline;
  end: SheetBarline;
  /** The volta number written over this bar ("1." or "2."), when one was found. */
  ending?: number;
  /**
   * Note heads found in the bar, across its staves. The alignment compares them with the notes of
   * each measure; absent when the layout came from a scan or was drawn by hand.
   */
  heads?: number;
  /**
   * Where the bar's first note head starts. At the start of a system the bar's box also holds the
   * clef and key signature, so a cursor moving through the bar starts here rather than at the box.
   */
  firstNoteX?: number;
}

/** Where the bars are on the pages, in reading order. */
export interface SheetLayout {
  pages: SheetPage[];
  bars: SheetBar[];
  /**
   * How the layout was found: from the PDF's vector drawing (exact for engraved PDFs such as
   * MuseScore's), from the rendered page image (scans), or drawn by the learner.
   */
  source: 'vector' | 'raster' | 'manual';
}

/** Which written bar each of the song's measures is played from. */
export interface SheetMap {
  layout: SheetLayout;
  /**
   * One entry per `Song.measures` element, in the same order (playback order): the index into
   * `layout.bars`, or null where no bar could be matched.
   */
  barOfMeasure: (number | null)[];
  /** True once the learner has corrected the map; a newer analyser must not overwrite it. */
  edited: boolean;
  /** Version of the analysis that made the map, so unedited maps can be redone when it improves. */
  analyser: number;
  /**
   * How the sheet writes the song (P5-18): each note's staff and spelling and each bar's clefs,
   * read from the printed heads of a vector PDF. Absent for scans and for maps of older analysers;
   * not used once the learner has corrected the map.
   */
  score?: ScoreHints;
}

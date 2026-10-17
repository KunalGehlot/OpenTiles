// Reading the notation of scores engraved by Verovio in five music fonts (P5-18): the PDF is read
// as the app reads it, the bars are found and matched with the song, and the heads must give back
// the staves, clefs, octave signs and spellings the score was written with. The score is made up
// in notation-score.ts (CC0).
import { describe, expect, it } from 'vitest';
import {
  alignSong,
  detectPage,
  layoutFromPages,
  printedHeads,
  readNotation,
  scoreHints,
} from '../src';
import type { PageResult } from '../src';
import { engrave, svgPdf } from './engraved';
import type { MusicFont } from './engraved';
import { BARS, musicXml, songOf } from './notation-score';
import type { Expected } from './notation-score';
import { drawingsOf } from './pdf';

async function read(font: MusicFont) {
  const drawings = await drawingsOf(svgPdf(await engrave(musicXml(), font)));
  let open = false;
  const pages: PageResult[] = drawings.map((d, i) => {
    const r = detectPage(d, i, open);
    open = r.openEnding;
    return r;
  });
  const layout = layoutFromPages(
    drawings.map((drawing, i) => ({ drawing, result: pages[i] as PageResult, source: 'vector' })),
  );
  const { song, expected } = songOf();
  const { barOfMeasure } = alignSong(layout, song);
  return {
    song,
    expected,
    barOfMeasure,
    reading: readNotation(printedHeads(pages), song, barOfMeasure),
  };
}

// Petaluma is left out: its half and whole note heads are 1.4 spaces tall, and the bar
// detection's head test (isNoteHead) takes heads up to 1.35 only.
describe.each<MusicFont>(['Leipzig', 'Bravura', 'Leland', 'Gootville'])(
  'a score engraved in %s',
  (font) => {
    it('gives back every note’s staff, spelling, clef and octave sign', async () => {
      const { song, expected, barOfMeasure, reading } = await read(font);
      expect(barOfMeasure).toEqual(BARS.map((_, i) => i));
      song.notes.forEach((note, i) => {
        const r = reading.notes[i];
        const e = expected[i] as Expected;
        expect(r, `note ${i} (${note.pitch} at ${note.startBeat})`).toBeDefined();
        expect(r?.staff).toBe(e.staff - 1);
        // The written octave, plus the octave sign over it, is the octave the note sounds in.
        expect({
          ...r?.spelling,
          octave: (r?.spelling?.octave ?? 0) + (r?.frame?.ottava ?? 0),
        }).toEqual({
          step: e.written.step,
          alter: e.written.alter ?? 0,
          octave: e.written.octave,
        });
      });
      const clefs = reading.frames.map((f) =>
        f.start.map((s) => `${s.frame?.clef}${s.frame?.ottava ? '8va' : ''}`).join('/'),
      );
      expect(clefs).toEqual(['G/F', 'G/F', 'G/G', 'G/G', 'G/F', 'G8va/F', 'G8va/F', 'G/F']);
      expect(reading.frames.map((f) => f.changes.map((c) => `${c.staff}${c.frame.clef}`))).toEqual([
        [],
        [],
        [],
        ['1F'],
        [],
        [],
        [],
        [],
      ]);
    });
  },
);

describe('hints for engraving the song as the sheet writes it (P5-18)', () => {
  it('give each note its printed staff and spelling, and each bar its clefs', async () => {
    const { song, expected, barOfMeasure, reading } = await read('Leipzig');
    const hints = scoreHints(reading, song, barOfMeasure);
    expect(hints).not.toBeNull();
    song.notes.forEach((note, i) => {
      const e = expected[i] as Expected;
      expect(hints?.notes[note.id], `note ${i}`).toEqual({
        staff: e.staff,
        step: e.written.step,
        alter: e.written.alter ?? 0,
      });
    });
    // The clefs each bar starts with; the octave sign over bars 6 and 7 is not a clef.
    expect(Object.values(hints?.clefs ?? {}).map((c) => `${c[1]}/${c[2]}`)).toEqual([
      'G/F',
      'G/F',
      'G/G',
      'G/G',
      'G/F',
      'G/F',
      'G/F',
      'G/F',
    ]);
  });
});

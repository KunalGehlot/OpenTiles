// Every catalogue score renders with the engraver the app uses (P2-04, ADR 0009): Verovio, in
// Node, draws it, every note of the song read from it has its glyph, so the score views can
// follow and mark each one, and every triplet group is drawn as one. Scores are the catalogue's own (public domain or CC0, with provenance).
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '@opentiles/song-model';
import type { DomParserLike } from '@opentiles/song-model';
import { glyphsFromTimemap, linkNotes, measureOrderFromSvg } from '../src/views/score/glyph-map';
import type { TimemapEntry } from '../src/views/score/glyph-map';

interface Toolkit {
  setOptions(o: object): void;
  loadData(d: string): boolean | number;
  renderToSVG(p: number): string;
  renderToTimemap(o: object): TimemapEntry[];
  getMIDIValuesForElement(id: string): { pitch?: number };
  destroy(): void;
}

const domParser = new DOMParser() as unknown as DomParserLike;
const catalogue = new URL('../../../catalogue/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', catalogue), 'utf8')) as {
  pieces: { slug: string; score: string }[];
};

describe('the catalogue in the engraver (P2-04)', () => {
  it('has pieces to check', () => {
    expect(index.pieces.length).toBeGreaterThan(30);
  });

  it('renders every score and finds a glyph for every note', async () => {
    const { default: createModule } = await import('verovio/wasm');
    const { VerovioToolkit, enableLog, LOG_OFF } = await import('verovio/esm');
    const module = await createModule();
    enableLog(LOG_OFF, module);
    const problems: string[] = [];
    for (const piece of index.pieces) {
      const xml = readFileSync(new URL(piece.score, catalogue), 'utf8');
      const song = parseMusicXml(xml, { domParser });
      const tk = new (VerovioToolkit as new (m: unknown) => Toolkit)(module);
      try {
        // As the scrolling score draws it: one system, no header.
        tk.setOptions({ breaks: 'none', header: 'none', footer: 'none' });
        if (!tk.loadData(xml)) {
          problems.push(`${piece.slug}: not read`);
          continue;
        }
        const svg = tk.renderToSVG(1);
        const glyphs = glyphsFromTimemap(
          tk.renderToTimemap({ includeMeasures: true, includeRests: false }),
          measureOrderFromSvg([svg]),
          (id) => tk.getMIDIValuesForElement(id).pitch,
        );
        const { unmatched } = linkNotes(song, glyphs);
        // Each written triplet group is drawn as one (its "3"), not as plain shorter notes.
        const groups = xml.split('<tuplet type="start"').length - 1;
        const drawn = svg.split('class="tuplet"').length - 1;
        if (drawn !== groups)
          problems.push(`${piece.slug}: ${groups} tuplets written, ${drawn} drawn`);
        if (song.notes.length === 0) problems.push(`${piece.slug}: no notes`);
        if (unmatched.length) {
          problems.push(
            `${piece.slug}: ${unmatched.length} of ${song.notes.length} notes unmatched`,
          );
        }
      } finally {
        tk.destroy();
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);
});

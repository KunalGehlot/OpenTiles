// Every catalogue score renders with the engraver the app uses (P2-04, ADR 0009): Verovio, in
// Node, draws it, every note of the song read from it has its glyph, so the score views can
// follow and mark each one, every triplet group is drawn as one, and every accidental the key
// signature does not give is drawn (issue #75). Scores are the catalogue's own (public domain or
// CC0, with provenance).
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

const SHARP_ORDER = 'FCGDAEB';

/** The alteration a key signature of `fifths` gives a step. */
function keyAlter(step: string, fifths: number): number {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && [...SHARP_ORDER].reverse().slice(0, -fifths).includes(step)) return -1;
  return 0;
}

function childText(el: Element, name: string): string | undefined {
  return el.getElementsByTagName(name)[0]?.textContent?.trim() ?? undefined;
}

/**
 * Notes written without the <accidental> they need: Verovio draws accidentals only from
 * <accidental>, so such a note is heard altered but drawn plain. Per bar and staff in time order;
 * a tie continuation needs none. The same rule as tools/pipeline/score_checks.py.
 */
function missingAccidentals(xml: string): string[] {
  const doc = domParser.parseFromString(xml, 'application/xml');
  const missing: string[] = [];
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let fifths = 0;
    let divisions = 1;
    for (const measure of Array.from(part.getElementsByTagName('measure'))) {
      const notes: {
        start: number;
        staff: string;
        line: string;
        alter: number;
        written: boolean;
      }[] = [];
      let pos = 0;
      let lastStart = 0;
      for (let el = measure.firstChild; el; el = el.nextSibling) {
        if (el.nodeType !== 1) continue;
        const e = el as Element;
        if (e.tagName === 'attributes') {
          const f = childText(e, 'fifths');
          if (f !== undefined) fifths = Number(f);
          const d = childText(e, 'divisions');
          if (d !== undefined) divisions = Number(d);
        } else if (e.tagName === 'backup' || e.tagName === 'forward') {
          const d = Number(childText(e, 'duration') ?? 0) / divisions;
          pos += e.tagName === 'backup' ? -d : d;
        } else if (e.tagName === 'note') {
          const chord = e.getElementsByTagName('chord').length > 0;
          const start = chord ? lastStart : pos;
          lastStart = start;
          const pitch = e.getElementsByTagName('pitch')[0];
          const tieStop = Array.from(e.getElementsByTagName('tie')).some(
            (t) => t.getAttribute('type') === 'stop',
          );
          if (pitch && !tieStop) {
            const step = childText(pitch, 'step') ?? '';
            notes.push({
              start,
              staff: childText(e, 'staff') ?? '1',
              line: `${step}${childText(pitch, 'octave') ?? ''}`,
              alter: Number(childText(pitch, 'alter') ?? 0),
              written: e.getElementsByTagName('accidental').length > 0,
            });
          }
          if (!chord && e.getElementsByTagName('grace').length === 0)
            pos += Number(childText(e, 'duration') ?? 0) / divisions;
        }
      }
      const state = new Map<string, number>();
      for (const n of notes.sort((a, b) => a.start - b.start)) {
        const key = `${n.staff}:${n.line}`;
        const current = state.get(key) ?? keyAlter(n.line.charAt(0), fifths);
        if (n.alter !== current && !n.written)
          missing.push(`bar ${measure.getAttribute('number') ?? '?'} ${n.line}`);
        state.set(key, n.alter);
      }
    }
  }
  return missing;
}

/** Accidentals Verovio drew next to notes (gestural ones are empty groups). */
function drawnAccidentals(svg: string): number {
  return (svg.match(/<g [^>]*class="accid"[^>]*>[\s\S]*?<\/g>/g) ?? []).filter((g) =>
    g.includes('<use'),
  ).length;
}
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
        // Every accidental the key does not give is written, and every written one is drawn.
        const missing = missingAccidentals(xml);
        if (missing.length)
          problems.push(`${piece.slug}: no accidental on ${missing.slice(0, 3).join(', ')}…`);
        const accidentals = xml.split('<accidental').length - 1;
        if (drawnAccidentals(svg) !== accidentals)
          problems.push(
            `${piece.slug}: ${accidentals} accidentals written, ${drawnAccidentals(svg)} drawn`,
          );
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

  it('draws the accidentals of the Mountain King, also transposed (issue #75)', async () => {
    const { default: createModule } = await import('verovio/wasm');
    const { VerovioToolkit, enableLog, LOG_OFF } = await import('verovio/esm');
    const module = await createModule();
    enableLog(LOG_OFF, module);
    const xml = readFileSync(
      new URL('pieces/hall-of-the-mountain-king/score.musicxml', catalogue),
      'utf8',
    );
    const drawnWith = (transpose?: string) => {
      const tk = new (VerovioToolkit as new (m: unknown) => Toolkit)(module);
      try {
        tk.setOptions({
          breaks: 'none',
          header: 'none',
          footer: 'none',
          ...(transpose ? { transpose } : {}),
        });
        tk.loadData(xml);
        return drawnAccidentals(tk.renderToSVG(1));
      } finally {
        tk.destroy();
      }
    };
    // E sharp, then naturals on E and C, in bars 2 and 6.
    expect(drawnWith()).toBe(6);
    // Moved up a tone (as the app's transpose control does): F double sharp, then naturals on F and D.
    expect(drawnWith('2')).toBe(6);
  }, 60_000);
});

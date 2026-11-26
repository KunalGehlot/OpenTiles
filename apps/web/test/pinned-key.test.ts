// The scrolling score's pinned clefs and key signature (issue #75) are read from what Verovio drew:
// a catalogue piece as it is and transposed, and scores written here in code with key and clef
// changes mid-piece. The catalogue score is public domain; the others are generated (CC0).
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import { drawPages, layoutOptions } from '../src/views/score/engrave-core';
import { changePoints, headsAt, readSystemHeads } from '../src/views/score/pinned-key';
import type { DrawnGlyph, SystemHeads } from '../src/views/score/pinned-key';
import { createToolkit } from '../src/views/score/verovio';

const hall = readFileSync(
  new URL('../../../catalogue/pieces/hall-of-the-mountain-king/score.musicxml', import.meta.url),
  'utf8',
);

/** The scrolling score's SVG for a MusicXML text, read back as a document. */
async function drawn(text: string, transpose = 0): Promise<SystemHeads> {
  const tk = await createToolkit({ kind: 'musicxml', text, transpose }, {});
  try {
    const svg = drawPages(tk, layoutOptions(1200, 300, 'scroll')).pages[0] ?? '';
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const heads = readSystemHeads(doc.documentElement as unknown as Element);
    if (!heads) throw new Error('no system');
    return heads;
  } finally {
    tk.destroy();
  }
}

const code = (g: DrawnGlyph | null | undefined) => /E[0-9A-F]{3}/.exec(g?.href ?? '')?.[0];

interface Bar {
  attributes?: string;
  /** Pitches as step + octave on each staff, one whole note each. */
  notes: string[];
}

/** A small piano score, one whole note per staff and bar. */
function score(bars: Bar[], staves = 1): string {
  const note = (pitch: string, staff: number) =>
    `<note><pitch><step>${pitch[0]}</step><octave>${pitch.slice(1)}</octave></pitch><duration>4</duration><type>whole</type><staff>${staff}</staff></note>`;
  const measures = bars.map((bar, i) => {
    const notes = bar.notes
      .map((p, s) => (s > 0 ? '<backup><duration>4</duration></backup>' : '') + note(p, s + 1))
      .join('');
    const attrs = bar.attributes ? `<attributes>${bar.attributes}</attributes>` : '';
    return `<measure number="${i + 1}">${attrs}${notes}</measure>`;
  });
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`.replace(
    '<attributes>',
    `<attributes><divisions>1</divisions>${staves > 1 ? `<staves>${staves}</staves>` : ''}`,
  );
}

const clef = (sign: string, line: number, staff?: number) =>
  `<clef${staff ? ` number="${staff}"` : ''}><sign>${sign}</sign><line>${line}</line></clef>`;
const key = (fifths: number) => `<key><fifths>${fifths}</fifths></key>`;
const time = '<time><beats>4</beats><beat-type>4</beat-type></time>';

/** Accidental heights measured from the staff's top line. */
function heights(heads: SystemHeads, staff: number, x: number): number[] {
  const top = heads.staves[staff]?.lines[0] ?? 0;
  return (headsAt(heads, x)[staff]?.accids ?? []).map((a) => a.y - top);
}

describe('the pinned clefs and key signature (issue #75)', () => {
  let hallHeads: SystemHeads;
  beforeAll(async () => {
    hallHeads = await drawn(hall);
  }, 30_000);

  it('reads the opening of a grand staff: both clefs and two sharps on each staff', () => {
    const heads = hallHeads;
    expect(heads.staves).toHaveLength(2);
    expect(heads.staves.every((s) => s.lines.length === 5)).toBe(true);
    expect(changePoints(heads)).toEqual([]);
    const [upper, lower] = headsAt(heads, Infinity);
    expect(code(upper?.clef)).toBe('E050'); // treble clef
    expect(code(lower?.clef)).toBe('E062'); // bass clef
    expect(upper?.accids.map(code)).toEqual(['E262', 'E262']); // sharps
    expect(lower?.accids.map(code)).toEqual(['E262', 'E262']);
    // Placed where Verovio drew the opening, and the brace and the system's line come along.
    expect(upper?.accids).toEqual(heads.opening[0]?.key);
    expect(heads.frame.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a transposed score’s key as engraved, not the file’s', async () => {
    const heads = await drawn(hall, 1);
    const [upper, lower] = headsAt(heads, Infinity);
    expect(upper?.accids.map(code)).toEqual(['E260', 'E260', 'E260']); // E♭ major: three flats
    expect(lower?.accids.map(code)).toEqual(['E260', 'E260', 'E260']);
  }, 30_000);

  it('follows key and clef changes, staff by staff, from where each is drawn', async () => {
    const heads = await drawn(
      score(
        [
          {
            attributes: `${key(3)}${time}${clef('G', 2, 1)}${clef('F', 4, 2)}`,
            notes: ['C5', 'C3'],
          },
          { notes: ['C5', 'C3'] },
          { attributes: `${key(-2)}${clef('G', 2, 2)}`, notes: ['C5', 'C4'] },
          { attributes: clef('F', 4, 1), notes: ['C3', 'C4'] },
          { attributes: `${key(0)}${clef('C', 3, 1)}`, notes: ['C4', 'C4'] },
          { notes: ['C4', 'C4'] },
        ],
        2,
      ),
    );
    const points = changePoints(heads);
    expect(points.length).toBeGreaterThanOrEqual(4);
    const before = (i: number) => (points[i] ?? Infinity) - 1;

    // The opening: three sharps on both staves.
    let [upper, lower] = headsAt(heads, before(0));
    expect(upper?.accids.map(code)).toEqual(['E262', 'E262', 'E262']);
    expect(code(lower?.clef)).toBe('E062');

    // Bar 3: the lower staff takes a treble clef (the full-size glyph, not the smaller change
    // glyph Verovio draws mid-staff), then both take two flats, placed where the opening's sharps
    // begin.
    const flats = heads.changes.find((c) => c.key?.every((g) => code(g) === 'E260'));
    if (!flats) throw new Error('no change to flats');
    [upper, lower] = headsAt(heads, flats.x);
    expect(code(lower?.clef)).toBe('E050');
    expect(lower?.clef?.x).toBe(heads.opening[1]?.clef?.x);
    expect(upper?.accids.map(code)).toEqual(['E260', 'E260']);
    expect(upper?.accids[0]?.x).toBe(heads.keyX);
    expect(heights(heads, 0, flats.x)).toEqual(heights(heads, 1, flats.x));

    // Bar 4: the upper staff takes a bass clef with no new key signature. The flats drawn under
    // the treble clef move down to where a bass clef has them: B♭ on the second line from the
    // bottom, E♭ in the third space from the bottom.
    const toBass = heads.changes.find((c) => c.staff === 0 && code(c.clef) === 'E07C');
    if (!toBass) throw new Error('no change to a bass clef');
    [upper] = headsAt(heads, toBass.x);
    expect(code(upper?.clef)).toBe('E062');
    const space = 180;
    expect(heights(heads, 0, toBass.x)).toEqual([3 * space, 1.5 * space]);

    // Bar 5: C major (Verovio's cancelling naturals are not a key) and an alto clef, whose
    // full-size glyph was never drawn here, so the drawn change glyph is used.
    [upper, lower] = headsAt(heads, Infinity);
    expect(upper?.accids).toEqual([]);
    expect(lower?.accids).toEqual([]);
    expect(code(upper?.clef)).toBe('E07B');
  }, 30_000);

  it('moves a key signature under a new clef to where Verovio draws it for that clef', async () => {
    for (const [sign, line] of [
      ['F', 4],
      ['C', 3],
    ] as const) {
      for (const fifths of [4, -5]) {
        const changed = await drawn(
          score([
            { attributes: `${key(fifths)}${time}${clef('G', 2)}`, notes: ['C5'] },
            { attributes: clef(sign, line), notes: ['C4'] },
            { notes: ['C4'] },
          ]),
        );
        const native = await drawn(
          score([{ attributes: `${key(fifths)}${time}${clef(sign, line)}`, notes: ['C4'] }]),
        );
        expect(heights(changed, 0, Infinity), `${sign} clef, ${fifths} fifths`).toEqual(
          heights(native, 0, Infinity),
        );
      }
    }
  }, 60_000);

  it('finds nothing to pin in an empty drawing', () => {
    const doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'image/svg+xml',
    );
    expect(readSystemHeads(doc.documentElement as unknown as Element)).toBeNull();
  });
});

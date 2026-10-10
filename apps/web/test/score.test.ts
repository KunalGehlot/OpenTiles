// Score views (P1-15, P2-11, P2-12): note-to-glyph matching, cursor positions and note colours.
// The fixture is generated here (self-made, CC0); the Verovio tests run the real engraver in Node.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '@opentiles/song-model';
import type { DomParserLike, Song } from '@opentiles/song-model';
import { beatAt, buildAnchors, positionAt } from '../src/views/score/cursor-map';
import type { MeasureBox } from '../src/views/score/cursor-map';
import {
  baseId,
  glyphsFromTimemap,
  linkNotes,
  measureOrderFromSvg,
} from '../src/views/score/glyph-map';
import type { Glyph, TimemapEntry } from '../src/views/score/glyph-map';
import { formatOfPath, notationFor } from '../src/views/score/notation';
import { glyphStates, nearestByBeat, noteStates } from '../src/views/score/note-states';

const domParser = new DOMParser() as unknown as DomParserLike;

const TYPES: Record<number, string> = { 1: 'quarter', 2: 'half', 3: 'half', 4: 'whole' };

interface Extra {
  chord?: boolean;
  tie?: 'start' | 'stop';
  fingering?: number;
  staff?: number;
}

/** A note in MusicXML element order (durations in quarters, divisions = 1). */
const n = (step: string, octave: number, duration: number, x: Extra = {}) => {
  const notations =
    (x.tie ? `<tied type="${x.tie}"/>` : '') +
    (x.fingering ? `<technical><fingering>${x.fingering}</fingering></technical>` : '');
  return `<note>${x.chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${x.tie ? `<tie type="${x.tie}"/>` : ''}<voice>${x.staff === 2 ? 5 : 1}</voice><type>${TYPES[duration]}</type>${duration === 3 ? '<dot/>' : ''}<staff>${x.staff ?? 1}</staff>${notations ? `<notations>${notations}</notations>` : ''}</note>`;
};
const lh = (step: string, octave: number, duration: number) =>
  n(step, octave, duration, { staff: 2 });

/**
 * Five 4/4 bars on a grand staff: a repeat with first and second endings, a tie over the first
 * barline, a chord, fingering and a left-hand part.
 */
function fixture(): string {
  const back = '<backup><duration>4</duration></backup>';
  const m = (num: number, body: string, left = '', right = '') =>
    `<measure number="${num}">${left ? `<barline location="left">${left}</barline>` : ''}${body}${right ? `<barline location="right">${right}</barline>` : ''}</measure>`;
  const attrs =
    '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
  const measures = [
    m(
      1,
      attrs +
        n('C', 4, 2, { fingering: 1 }) +
        n('E', 4, 2, { tie: 'start' }) +
        back +
        lh('C', 3, 4),
      '<repeat direction="forward"/>',
    ),
    m(2, n('E', 4, 1, { tie: 'stop' }) + n('D', 4, 3) + back + lh('G', 2, 4)),
    m(
      3,
      n('E', 4, 4) + n('G', 4, 4, { chord: true }) + back + lh('C', 3, 4),
      '<ending number="1" type="start"/>',
      '<ending number="1" type="stop"/><repeat direction="backward"/>',
    ),
    m(
      4,
      n('F', 4, 4) + back + lh('F', 2, 4),
      '<ending number="2" type="start"/>',
      '<ending number="2" type="discontinue"/>',
    ),
    m(5, n('G', 4, 4) + back + lh('C', 3, 4)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
}

const parse = (xml: string): Song => parseMusicXml(xml, { domParser });

/** The glyphs Verovio would report for the fixture (ids are made up). */
function fixtureGlyphs(): { glyphs: Glyph[]; timemap: TimemapEntry[] } {
  // Playback: 1 2 3 1 2 4 5. Verovio suffixes repeated passes with -rend2.
  // e4 starts at beat 2 and is tied into bar 2, where its continuation e4b is a glyph of its own.
  const timemap: TimemapEntry[] = [
    { qstamp: 0, measureOn: 'm1', on: ['c4', 'c3'] },
    { qstamp: 2, on: ['e4'] },
    { qstamp: 4, measureOn: 'm2', on: ['e4b', 'g2'] },
    { qstamp: 5, on: ['d4'] },
    { qstamp: 8, measureOn: 'm3', on: ['e4c', 'g4', 'c3b'] },
    { qstamp: 12, measureOn: 'm1-rend2', on: ['c4-rend2', 'c3-rend2'] },
    { qstamp: 14, on: ['e4-rend2'] },
    { qstamp: 16, measureOn: 'm2-rend2', on: ['e4b-rend2', 'g2-rend2'] },
    { qstamp: 17, on: ['d4-rend2'] },
    { qstamp: 20, measureOn: 'm4', on: ['f4', 'f2'] },
    { qstamp: 24, measureOn: 'm5', on: ['g4b', 'c3c'] },
  ];
  const pitches: Record<string, number> = {
    c4: 60,
    e4: 64,
    c3: 48,
    e4b: 64,
    g2: 43,
    d4: 62,
    e4c: 64,
    g4: 67,
    c3b: 48,
    f4: 65,
    f2: 41,
    g4b: 67,
    c3c: 48,
  };
  const glyphs = glyphsFromTimemap(timemap, ['m1', 'm2', 'm3', 'm4', 'm5'], (id) => pitches[id]);
  return { glyphs, timemap };
}

describe('glyph matching', () => {
  it('reads measure order from SVG and strips repeat suffixes', () => {
    const svg =
      '<svg><g id="s1" class="system"><g id="a" class="measure"></g><g id="b" class="measure ot-hardest-bar"></g></g></svg>';
    expect(measureOrderFromSvg([svg, '<g id="c" class="measure">'])).toEqual(['a', 'b', 'c']);
    expect(baseId('x1y-rend2')).toBe('x1y');
    expect(baseId('x1y')).toBe('x1y');
  });

  it('lists each glyph once with its measure, onset and pitch', () => {
    const { glyphs } = fixtureGlyphs();
    expect(glyphs.map((g) => g.id)).toEqual([
      'c4',
      'c3',
      'e4',
      'e4b',
      'g2',
      'd4',
      'e4c',
      'g4',
      'c3b',
      'f4',
      'f2',
      'g4b',
      'c3c',
    ]);
    expect(glyphs.find((g) => g.id === 'd4')).toMatchObject({ measure: 1, onset: 1, pitch: 62 });
    expect(glyphs.find((g) => g.id === 'f4')).toMatchObject({ measure: 3, onset: 0, absolute: 20 });
  });

  it('links every note, both repeat passes to the same glyph, and tie continuations', () => {
    const song = parse(fixture());
    expect(song.measures.map((m) => m.sourceIndex)).toEqual([0, 1, 2, 0, 1, 3, 4]);
    const { glyphs } = fixtureGlyphs();
    const links = linkNotes(song, glyphs);
    expect(links.unmatched).toEqual([]);
    const head = (pitch: number, beat: number) => {
      const note = song.notes.find((x) => x.pitch === pitch && x.startBeat === beat);
      return note ? links.glyphsOf.get(note.id) : undefined;
    };
    expect(head(60, 0)).toEqual(['c4']);
    expect(head(60, 12)).toEqual(['c4']);
    expect(head(62, 5)).toEqual(['d4']);
    expect(head(67, 8)).toEqual(['g4']);
    expect(head(65, 20)).toEqual(['f4']);
    // The tied E4 (beats 2–5) owns its head and the continuation in bar 2.
    expect(head(64, 2)).toEqual(['e4', 'e4b']);
    expect(head(64, 14)).toEqual(['e4', 'e4b']);
    expect(links.notesOf.get('c4')).toHaveLength(2);
  });

  it('falls back to the closest pitch and to the unrolled onset', () => {
    const song = parse(fixture());
    const { glyphs } = fixtureGlyphs();
    // An octave sign: the renderer reports C5 where the song has C4.
    const shifted = glyphs.map((g) => (g.id === 'c4' ? { ...g, pitch: 72 } : g));
    const c4 = song.notes.find((x) => x.pitch === 60 && x.startBeat === 0);
    expect(linkNotes(song, shifted).glyphsOf.get(c4?.id ?? '')).toEqual(['c4']);
    // Bars counted differently: only the unrolled onset agrees.
    const renumbered = glyphs.map((g) => (g.id === 'g4b' ? { ...g, measure: 9 } : g));
    const g4 = song.notes.find((x) => x.pitch === 67 && x.startBeat === 24);
    expect(linkNotes(song, renumbered).glyphsOf.get(g4?.id ?? '')).toEqual(['g4b']);
  });

  it('reports notes it cannot place', () => {
    const song = parse(fixture());
    const links = linkNotes(song, []);
    expect(links.unmatched).toHaveLength(song.notes.length);
  });
});

describe('Verovio in Node', () => {
  const loadToolkit = async (data: string) => {
    const { default: createModule } = await import('verovio/wasm');
    const { VerovioToolkit, enableLog, LOG_OFF } = await import('verovio/esm');
    const module = await createModule();
    enableLog(LOG_OFF, module);
    const tk = new (
      VerovioToolkit as new (m: unknown) => {
        setOptions(o: object): void;
        loadData(d: string): boolean | number;
        renderToSVG(p: number): string;
        getPageCount(): number;
        renderToTimemap(o: object): TimemapEntry[];
        getMIDIValuesForElement(id: string): { pitch?: number };
        destroy(): void;
      }
    )(module);
    tk.setOptions({ breaks: 'none', header: 'none', footer: 'none' });
    expect(tk.loadData(data)).toBeTruthy();
    return tk;
  };

  const linkWithVerovio = async (xml: string) => {
    const tk = await loadToolkit(xml);
    const svg = tk.renderToSVG(1);
    const glyphs = glyphsFromTimemap(
      tk.renderToTimemap({ includeMeasures: true, includeRests: false }),
      measureOrderFromSvg([svg]),
      (id) => tk.getMIDIValuesForElement(id).pitch,
    );
    tk.destroy();
    return { svg, glyphs, links: linkNotes(parse(xml), glyphs) };
  };

  it('links every note of the fixture to a rendered glyph and draws its fingering', async () => {
    const { svg, links } = await linkWithVerovio(fixture());
    expect(links.unmatched).toEqual([]);
    expect(svg).toContain('class="fing"');
  }, 30_000);

  it('links every note of the catalogue pieces', async () => {
    for (const slug of ['minuet-in-g', 'ode-to-joy', 'prelude-in-c']) {
      const xml = readFileSync(
        resolve(import.meta.dirname, `../../../catalogue/pieces/${slug}/score.musicxml`),
        'utf8',
      );
      const { links } = await linkWithVerovio(xml);
      expect(links.unmatched, slug).toEqual([]);
    }
  }, 60_000);
});

describe('cursor positions', () => {
  const song = parse(fixture());
  const boxes = new Map<number, MeasureBox>(
    [0, 1, 2, 3, 4].map((i) => [
      i,
      { left: i * 100, right: i * 100 + 100, top: 10, height: 80, page: 1 },
    ]),
  );
  // Note heads 20 px after the barline for the downbeat and 70 px for beat 2 (C4 and E4 in bar 1).
  const noteX = new Map<string, number>();
  for (const note of song.notes) {
    const m = song.measures[note.measureIndex];
    if (!m) continue;
    const box = boxes.get(m.sourceIndex);
    if (box) noteX.set(note.id, box.left + 20 + (note.startBeat - m.startBeat) * 20);
  }
  const anchors = buildAnchors(song, boxes, noteX);

  it('sits on the downbeat note and glides through the bar', () => {
    expect(positionAt(anchors, 0)?.x).toBe(20);
    expect(positionAt(anchors, 2)?.x).toBe(60);
    expect(positionAt(anchors, 1)?.x).toBe(40);
    expect(positionAt(anchors, 3)?.x).toBeGreaterThan(80);
  });

  it('crosses a bar line without a step (P4-11)', () => {
    const before = positionAt(anchors, 4 - 1e-3)?.x ?? 0;
    const after = positionAt(anchors, 4 + 1e-3)?.x ?? 0;
    expect(Math.abs(after - before)).toBeLessThan(1);
    // Moving on in small steps never jumps more than a frame's worth of the bar.
    let last = positionAt(anchors, 0)?.x ?? 0;
    for (let beat = 0.01; beat < 8; beat += 0.01) {
      const x = positionAt(anchors, beat)?.x ?? 0;
      expect(Math.abs(x - last)).toBeLessThan(2);
      last = x;
    }
  });

  it('jumps back at the repeat and on to the second ending', () => {
    expect(positionAt(anchors, 12)?.x).toBe(20);
    expect(positionAt(anchors, 20)?.x).toBe(320);
    expect(positionAt(anchors, 24)?.x).toBe(420);
  });

  it('clamps before the start and after the end', () => {
    expect(positionAt(anchors, -5)?.x).toBe(20);
    expect(positionAt(anchors, 1000)?.x).toBe(500);
    expect(positionAt([], 1)).toBeNull();
  });

  it('turns a position back into a beat for scrubbing (P4-18)', () => {
    // The inverse of positionAt on every beat of the first pass.
    for (let beat = 0; beat < 12; beat += 0.25) {
      const x = positionAt(anchors, beat)?.x ?? 0;
      expect(beatAt(anchors, x, beat)).toBeCloseTo(beat, 1);
    }
    // Inside a repeat the same place is two beats; the pass nearest the current one wins.
    const x = positionAt(anchors, 1)?.x ?? 0;
    expect(beatAt(anchors, x, 0)).toBeCloseTo(1, 1);
    expect(beatAt(anchors, x, 13)).toBeCloseTo(13, 1);
    // Before the first note and after the last: the ends of the piece.
    expect(beatAt(anchors, -50, 0)).toBe(0);
    expect(beatAt(anchors, 10_000, 0)).toBe(anchors.at(-1)?.beat);
    expect(beatAt([], 10, 0)).toBeNull();
  });

  it('does not interpolate across systems or pages', () => {
    const paged = new Map(boxes);
    paged.set(1, { left: 0, right: 100, top: 200, height: 80, page: 2 });
    const a = buildAnchors(song, paged, new Map());
    const p = positionAt(a, 7.9);
    expect(p?.page).toBe(2);
    expect(p?.top).toBe(200);
  });
});

describe('note colours', () => {
  const song = parse(fixture());
  const both = () => true;

  it('marks the current step, played notes, mistakes and passed notes', () => {
    const c4 = song.notes.find((x) => x.pitch === 60 && x.startBeat === 0);
    const e4 = song.notes.find((x) => x.pitch === 64 && x.startBeat === 2);
    const lowC = song.notes.find((x) => x.pitch === 48 && x.startBeat === 0);
    const states = noteStates({
      notes: song.notes,
      beat: 2,
      current: new Set(song.notes.filter((x) => x.startBeat === 2).map((x) => x.id)),
      marks: new Map([[c4?.id ?? '', 'correct' as const]]),
      inHands: both,
    });
    expect(states.get(c4?.id ?? '')).toBe('correct');
    expect(states.get(e4?.id ?? '')).toBe('expected');
    expect(states.get(lowC?.id ?? '')).toBe('done');
    expect(states.get(song.notes.at(-1)?.id ?? '')).toBeUndefined();
  });

  it('keeps wrong notes red and dims the hand not practised', () => {
    const target = song.notes.find((x) => x.hand === 'right');
    const states = noteStates({
      notes: song.notes,
      beat: 0,
      current: new Set([target?.id ?? '']),
      marks: new Map([[target?.id ?? '', 'wrong' as const]]),
      inHands: (x) => x.hand === 'right',
    });
    expect(states.get(target?.id ?? '')).toBe('wrong');
    expect(states.get(song.notes.find((x) => x.hand === 'left')?.id ?? '')).toBe('other');
  });

  it('uses the sounding notes when there is no step (listen, play-along)', () => {
    const states = noteStates({
      notes: song.notes,
      beat: 3,
      current: null,
      marks: new Map(),
      inHands: both,
    });
    const e4 = song.notes.find((x) => x.pitch === 64 && x.startBeat === 2);
    expect(states.get(e4?.id ?? '')).toBe('expected');
  });

  it('shows the repeat pass nearest the cursor on a shared glyph', () => {
    const passes = song.notes.filter((x) => x.pitch === 60 && x.hand === 'right');
    const [first, second] = passes;
    const states = new Map([
      [first?.id ?? '', 'wrong' as const],
      [second?.id ?? '', 'expected' as const],
    ]);
    const start = new Map(song.notes.map((x) => [x.id, x.startBeat]));
    const glyphs = glyphStates(states, new Map([['c4', passes.map((p) => p.id)]]), (ids) =>
      nearestByBeat(ids, (id) => start.get(id), 12),
    );
    expect(glyphs.get('c4')).toBe('expected');
  });
});

describe('notation source', () => {
  const xml = new TextEncoder().encode(fixture());

  it('draws MusicXML and ABC, transposed like the song', () => {
    expect(notationFor('musicxml', xml, 2)).toMatchObject({ kind: 'musicxml', transpose: 2 });
    const abc = new TextEncoder().encode('X:1\nT:Scale\nK:C\nCDEF|\n');
    expect(notationFor('abc', abc)).toMatchObject({ kind: 'abc', transpose: 0 });
    expect(notationFor('musicxml', abc).kind).toBe('abc');
  });

  it('has no score for MIDI, audio and MuseScore imports, and says why', () => {
    for (const format of ['midi', 'audio', 'mscz'] as const) {
      const n = notationFor(format, xml);
      expect(n.kind).toBe('none');
      if (n.kind === 'none') expect(n.reason).toMatch(/falling notes/);
    }
    expect(notationFor('musicxml', new Uint8Array()).kind).toBe('none');
    expect(notationFor('mxl', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])).kind).toBe('none');
  });

  it('knows catalogue formats by extension', () => {
    expect(formatOfPath('pieces/a/score.musicxml')).toBe('musicxml');
    expect(formatOfPath('pieces/a/score.MXL')).toBe('mxl');
    expect(formatOfPath('pieces/a/tune.abc')).toBe('abc');
  });
});

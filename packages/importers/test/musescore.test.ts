import { strToU8, zipSync } from 'fflate';
import { ImportError } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import { parseMscx, readMuseScore, unzipMscz } from '../src/musescore';
import {
  chord,
  domParser,
  keySig3,
  keySig4,
  measure,
  mscx,
  rest,
  tempoMark,
  timeSig,
  tuplet,
  volta,
  voltaEnd,
} from './fixtures';

const parse = (xml: string) => parseMscx(xml, { domParser });
const piano = { staves: [1, 2], clefs: [undefined, 'F'] };

describe('parseMscx (MuseScore 3)', () => {
  const song = parse(
    mscx({
      meta: { workTitle: 'Little Waltz', composer: '' },
      frame: [
        ['Title', 'Frame Title'],
        ['Composer', 'A. Composer'],
      ],
      parts: [piano],
      staves: {
        1: [
          measure({
            len: '1/4',
            voices: [keySig3(1) + timeSig(3, 4) + tempoMark(100) + chord('quarter', [67])],
          }),
          measure({
            voices: [
              chord('quarter', [{ pitch: 71, fingering: 3 }], { dots: 1 }) +
                chord('eighth', [72]) +
                chord('quarter', [74, 79]),
            ],
          }),
          measure({ voices: [chord('half', [78], { dots: 1 })] }),
        ],
        2: [
          measure({ len: '1/4', voices: [keySig3(1) + timeSig(3, 4) + rest('quarter')] }),
          measure({ voices: [chord('half', [43, 50], { dots: 1 })] }),
          measure({ voices: [rest('measure', '3/4')] }),
        ],
      },
    }),
  );

  it('reads title, composer, tempo, time and key', () => {
    expect(song.title).toBe('Little Waltz');
    expect(song.composer).toBe('A. Composer');
    expect(song.format).toBe('mscz');
    expect(song.tempos).toEqual([{ beat: 0, bpm: 100 }]);
    expect(song.timeSignatures).toEqual([{ beat: 0, numerator: 3, denominator: 4 }]);
    expect(song.keySignatures).toEqual([{ beat: 0, fifths: 1 }]);
    expect(song.warnings).toEqual([]);
  });

  it('reads notes, dots, chords and rests, with hands by staff', () => {
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats, n.hand])).toEqual([
      [67, 0, 1, 'right'],
      [43, 1, 3, 'left'],
      [50, 1, 3, 'left'],
      [71, 1, 1.5, 'right'],
      [72, 2.5, 0.5, 'right'],
      [74, 3, 1, 'right'],
      [79, 3, 1, 'right'],
      [78, 4, 3, 'right'],
    ]);
    expect(song.notes.find((n) => n.pitch === 71)?.fingering).toBe(3);
    expect(song.notes.find((n) => n.pitch === 43)?.staff).toBe(2);
  });

  it('gives the pickup bar its real length and number', () => {
    expect(song.measures.map((m) => [m.number, m.startBeat, m.lengthBeats])).toEqual([
      ['0', 0, 1],
      ['1', 1, 3],
      ['2', 4, 3],
    ]);
    expect(song.lengthBeats).toBe(7);
  });
});

describe('parseMscx (MuseScore 4)', () => {
  it('reads concert keys, inline tuplets and the title from the frame', () => {
    const song = parse(
      mscx({
        version: '4.20',
        frame: [['title', 'Triplet Study']],
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({
              voices: [
                keySig4(-2) +
                  timeSig(2, 4) +
                  tuplet(3, 2) +
                  chord('eighth', [70]) +
                  chord('eighth', [72]) +
                  chord('eighth', [74]) +
                  '<endTuplet/>' +
                  chord('quarter', [75]),
              ],
            }),
          ],
        },
      }),
    );
    expect(song.title).toBe('Triplet Study');
    expect(song.keySignatures[0]?.fifths).toBe(-2);
    expect(
      song.notes.map((n) => [n.pitch, +n.startBeat.toFixed(3), +n.durationBeats.toFixed(3)]),
    ).toEqual([
      [70, 0, 0.333],
      [72, 0.333, 0.333],
      [74, 0.667, 0.333],
      [75, 1, 1],
    ]);
    expect(song.warnings[0]).toMatch(/no tempo/);
  });

  it('nests tuplets', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({
              voices: [
                timeSig(1, 4) +
                  tuplet(3, 2) +
                  chord('eighth', [60]) +
                  tuplet(3, 2, '16th') +
                  chord('16th', [62]) +
                  chord('16th', [64]) +
                  chord('16th', [65]) +
                  '<endTuplet/>' +
                  chord('eighth', [67]) +
                  '<endTuplet/>',
              ],
            }),
          ],
        },
      }),
    );
    const starts = song.notes.map((n) => +n.startBeat.toFixed(4));
    expect(starts).toEqual([0, 0.3333, 0.4444, 0.5556, 0.6667]);
    expect(song.measures[0]?.lengthBeats).toBe(1);
  });
});

describe('parseMscx structure', () => {
  it('merges ties across bar lines', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({
              voices: [
                timeSig(2, 4) +
                  chord('quarter', [60]) +
                  chord('quarter', [{ pitch: 64, tie: 'start' }]),
              ],
            }),
            measure({
              voices: [chord('quarter', [{ pitch: 64, tie: 'both' }]) + chord('quarter', [62])],
            }),
            measure({ voices: [chord('half', [{ pitch: 64, tie: 'stop' }])] }),
          ],
        },
      }),
    );
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual([
      [60, 0, 1],
      [64, 1, 2],
      [62, 3, 1],
      [64, 4, 2],
    ]);
    expect(song.notes[1]?.sourceRefs).toEqual(['p0-m0-n1', 'p0-m1-n0']);
  });

  it('unrolls repeats and voltas', () => {
    const bar = (pitch: number, extra: Partial<Parameters<typeof measure>[0]> = {}, before = '') =>
      measure({ voices: [before + chord('whole', [pitch])], ...extra });
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            bar(60, { startRepeat: true }, timeSig(4, 4)),
            bar(62),
            bar(64, { endRepeat: 2 }, volta('1')),
            bar(65, {}, voltaEnd() + volta('2')),
            bar(67, {}, voltaEnd()),
          ],
        },
      }),
    );
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 60, 62, 65, 67]);
    expect(song.measures.map((m) => m.number)).toEqual(['1', '2', '3', '1', '2', '4', '5']);
  });

  it('extends an open volta to the next end repeat, as MuseScore does', () => {
    const bar = (pitch: number, extra: Partial<Parameters<typeof measure>[0]> = {}, before = '') =>
      measure({ voices: [before + chord('whole', [pitch])], ...extra });
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            bar(60, { startRepeat: true }, timeSig(4, 4)),
            bar(62, { endRepeat: 2 }, volta('1')),
            bar(64, {}, voltaEnd() + volta('2', 1, true)),
            bar(65, { endRepeat: 2 }, voltaEnd()),
            bar(67),
          ],
        },
      }),
    );
    expect(song.measures.map((m) => m.number)).toEqual(['1', '2', '1', '3', '4', '1', '5']);
  });

  it('restarts repeats and bar numbers after a section break', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({
              voices: [timeSig(4, 4) + chord('whole', [60])],
              extra: '<LayoutBreak><subtype>section</subtype></LayoutBreak>',
            }),
            measure({ voices: [chord('whole', [62])] }),
            measure({ endRepeat: 2, voices: [chord('whole', [64])] }),
          ],
        },
      }),
    );
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 62, 64]);
    expect(song.measures.map((m) => m.number)).toEqual(['1', '1', '2', '1', '2']);
  });

  it('leaves bars excluded from the count out of the numbering', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({ voices: [timeSig(2, 4) + chord('half', [60])] }),
            measure({
              len: '1/4',
              extra: '<irregular>1</irregular>',
              voices: [chord('quarter', [62])],
            }),
            measure({ voices: [chord('half', [64])] }),
          ],
        },
      }),
    );
    expect(song.measures.map((m) => [m.number, m.lengthBeats])).toEqual([
      ['1', 2],
      ['1', 1],
      ['2', 2],
    ]);
  });

  it('honours repeat counts', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [measure({ startRepeat: true, endRepeat: 3, voices: [chord('whole', [60])] })],
        },
      }),
    );
    expect(song.notes).toHaveLength(3);
  });

  it('reads several voices, gaps and skips grace notes', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({
              voices: [
                timeSig(4, 4) +
                  chord('eighth', [74], { grace: 'acciaccatura' }) +
                  chord('whole', [72]),
                '<location><fractions>1/2</fractions></location>' + chord('half', [64]),
              ],
            }),
          ],
        },
      }),
    );
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.voice])).toEqual([
      [72, 0, 1],
      [64, 2, 2],
    ]);
  });

  it('splits separate single-staff parts by pitch and leaves out percussion', () => {
    const song = parse(
      mscx({
        parts: [
          { name: 'Flute', staves: [1] },
          { name: 'Drums', staves: [2], drums: true },
          { name: 'Cello', staves: [3] },
        ],
        staves: {
          1: [measure({ voices: [chord('whole', [72])] })],
          2: [measure({ voices: [chord('whole', [36])] })],
          3: [measure({ voices: [chord('whole', [48])] })],
        },
      }),
    );
    expect(song.parts.map((p) => p.name)).toEqual(['Flute', 'Cello']);
    expect(song.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [48, 'left'],
      [72, 'right'],
    ]);
    expect(song.warnings).toContain('Percussion parts were left out.');
  });

  it('uses the bass clef of a single staff for the left hand', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1], clefs: ['F'] }],
        staves: { 1: [measure({ voices: [chord('whole', [48])] })] },
      }),
    );
    expect(song.notes[0]?.hand).toBe('left');
  });

  it('plays measure-repeat signs as the bar they repeat', () => {
    const song = parse(
      mscx({
        parts: [piano],
        staves: {
          1: [
            measure({ voices: [timeSig(2, 4) + chord('quarter', [60]) + chord('quarter', [64])] }),
            measure({
              voices: [
                '<RepeatMeasure><durationType>measure</durationType><duration>2/4</duration></RepeatMeasure>',
              ],
            }),
          ],
          2: [
            measure({ voices: [timeSig(2, 4) + chord('half', [48])] }),
            measure({ voices: [chord('half', [43])] }),
          ],
        },
      }),
    );
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.hand])).toEqual([
      [48, 0, 'left'],
      [60, 0, 'right'],
      [64, 1, 'right'],
      [43, 2, 'left'],
      [60, 2, 'right'],
      [64, 3, 'right'],
    ]);
  });

  it('warns about jumps it does not follow', () => {
    const song = parse(
      mscx({
        parts: [{ staves: [1] }],
        staves: {
          1: [
            measure({
              voices: [chord('whole', [60])],
              extra:
                '<Jump><style>Repeat Text Right</style><text>D.C. al Fine</text><jumpTo>start</jumpTo><playUntil>fine</playUntil></Jump>',
            }),
          ],
        },
      }),
    );
    expect(song.warnings.join(' ')).toMatch(/D\.C\./);
  });
});

describe('MuseScore 2 files', () => {
  it('reads measures without voices, tuplet references and Tie/endSpanner ties', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="2.06"><Score><Division>480</Division><metaTag name="workTitle">Old Format</metaTag>
<Part><Staff id="1"><StaffType group="pitched"/></Staff><trackName>Piano</trackName><Instrument><longName>Piano</longName></Instrument></Part>
<Staff id="1">
<Measure number="1">${timeSig(2, 4)}<Tuplet id="1"><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>
${chord('eighth', [60], { tuplet: '1' })}${chord('eighth', [62], { tuplet: '1' })}${chord('eighth', [64], { tuplet: '1' })}
<Chord><durationType>quarter</durationType><Note><Tie id="2"></Tie><pitch>65</pitch></Note></Chord></Measure>
<Measure number="2"><Chord><durationType>quarter</durationType><Note><endSpanner id="2"/><pitch>65</pitch></Note></Chord>${chord('quarter', [67])}</Measure>
</Staff></Score></museScore>`;
    const song = parse(xml);
    expect(song.title).toBe('Old Format');
    expect(
      song.notes.map((n) => [n.pitch, +n.startBeat.toFixed(3), +n.durationBeats.toFixed(3)]),
    ).toEqual([
      [60, 0, 0.333],
      [62, 0.333, 0.333],
      [64, 0.667, 0.333],
      [65, 1, 2],
      [67, 3, 1],
    ]);
  });

  it('rejects MuseScore 1 files and other XML', () => {
    expect(() => parse('<museScore version="1.14"><Score/></museScore>')).toThrow(/MuseScore 1/);
    expect(() => parse('<score-partwise/>')).toThrow(ImportError);
    expect(() => parse('<museScore version="3.02"></museScore>')).toThrow(/no score/);
  });
});

describe('.mscz files', () => {
  const xml = mscx({
    parts: [{ staves: [1] }],
    staves: { 1: [measure({ voices: [timeSig(4, 4) + chord('whole', [69])] })] },
  });

  it('finds the score through the container', () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="Song.mscx"/><rootfile full-path="Thumbnails/thumbnail.png"/></rootfiles></container>',
      ),
      'Song.mscx': strToU8(xml),
      'Thumbnails/thumbnail.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'Excerpts/Part/Part.mscx': strToU8('<museScore/>'),
    });
    const song = readMuseScore('My Song.mscz', zip, { domParser });
    expect(song.title).toBe('My Song');
    expect(song.notes[0]?.pitch).toBe(69);
  });

  it('falls back to the first .mscx outside the excerpts', () => {
    const zip = zipSync({ 'Excerpts/a.mscx': strToU8('<museScore/>'), 'score.mscx': strToU8(xml) });
    expect(unzipMscz(zip)).toBe(xml);
  });

  it('explains broken files', () => {
    expect(() => unzipMscz(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(ImportError);
    expect(() => unzipMscz(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/No score/);
  });
});

import { describe, expect, it } from 'vitest';
import { ImportError, parseMusicXml, playbackOrder } from '../src/musicxml';
import { attrs, domParser, note, score, tempo } from './fixtures';

const parse = (xml: string) => parseMusicXml(xml, { domParser });
const q = (step: string, octave: number, extra: Partial<Parameters<typeof note>[0]> = {}) =>
  note({ step, octave, duration: 1, ...extra });

describe('parseMusicXml', () => {
  it('reads title, composer, notes, tempo, key and time', () => {
    const song = parse(
      score(
        [
          [
            {
              attributes: attrs({ divisions: 1, fifths: 0, beats: 4 }),
              content: tempo(90) + q('C', 4) + q('D', 4) + q('E', 4) + q('F', 4, { alter: 1 }),
            },
          ],
        ],
        { title: 'Scale' },
      ),
    );
    expect(song.title).toBe('Scale');
    expect(song.composer).toBe('Test Composer');
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 66]);
    expect(song.notes.map((n) => n.startBeat)).toEqual([0, 1, 2, 3]);
    expect(song.tempos).toEqual([{ beat: 0, bpm: 90 }]);
    expect(song.timeSignatures).toEqual([{ beat: 0, numerator: 4, denominator: 4 }]);
    expect(song.keySignatures[0]?.fifths).toBe(0);
    expect(song.lengthBeats).toBe(4);
    expect(song.warnings).toEqual([]);
  });

  it('handles chords, divisions, rests and the grand staff with backup', () => {
    const rh =
      q('E', 4, { duration: 2, staff: 1 }) +
      note({ step: 'G', octave: 4, duration: 2, chord: true, staff: 1 }) +
      note({ rest: true, duration: 2, staff: 1 });
    const lh =
      '<backup><duration>4</duration></backup>' +
      note({ step: 'C', octave: 3, duration: 4, staff: 2, voice: 5 });
    const song = parse(
      score([
        [
          {
            attributes: attrs({
              divisions: 2,
              beats: 2,
              staves: 2,
              clefs: '<clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef>',
            }),
            content: rh + lh,
          },
        ],
      ]),
    );
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats, n.hand])).toEqual([
      [48, 0, 2, 'left'],
      [64, 0, 1, 'right'],
      [67, 0, 1, 'right'],
    ]);
    expect(song.warnings[0]).toMatch(/no tempo/);
  });

  it('merges ties across bar lines and keeps fingering', () => {
    const song = parse(
      score([
        [
          {
            attributes: attrs({ divisions: 1, beats: 2 }),
            content: q('G', 4) + q('C', 5, { tie: ['start'], fingering: 5 }),
          },
          { content: q('C', 5, { tie: ['stop'] }) + q('B', 4) },
        ],
      ]),
    );
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual([
      [67, 0, 1],
      [72, 1, 2],
      [71, 3, 1],
    ]);
    expect(song.notes[1]?.fingering).toBe(5);
    expect(song.notes[1]?.sourceRefs).toHaveLength(2);
  });

  it('gives a pickup bar its real length and skips grace notes', () => {
    const song = parse(
      score([
        [
          {
            implicit: true,
            number: '0',
            attributes: attrs({ divisions: 1, beats: 3 }),
            content: note({ step: 'D', octave: 5, duration: 0, grace: true }) + q('G', 4),
          },
          { number: '1', content: q('C', 5) + q('D', 5) + q('E', 5) },
        ],
      ]),
    );
    expect(song.measures.map((m) => [m.number, m.startBeat, m.lengthBeats])).toEqual([
      ['0', 0, 1],
      ['1', 1, 3],
    ]);
    expect(song.notes).toHaveLength(4);
  });

  it('unrolls repeats with first and second endings', () => {
    const one = (step: string) => ({ content: q(step, 4, { duration: 4 }) });
    const song = parse(
      score([
        [
          {
            attributes: attrs({ divisions: 1, beats: 4 }),
            left: '<repeat direction="forward"/>',
            ...one('C'),
          },
          one('D'),
          {
            left: '<ending number="1" type="start"/>',
            right: '<ending number="1" type="stop"/><repeat direction="backward"/>',
            ...one('E'),
          },
          {
            left: '<ending number="2" type="start"/>',
            right: '<ending number="2" type="discontinue"/>',
            ...one('F'),
          },
          one('G'),
        ],
      ]),
    );
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 60, 62, 65, 67]);
    expect(song.measures.map((m) => m.number)).toEqual(['1', '2', '3', '1', '2', '4', '5']);
    expect(song.notes.map((n) => n.measureIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(song.lengthBeats).toBe(28);
  });

  it('puts separate single-staff parts in hands by pitch', () => {
    const song = parse(
      score([
        [{ attributes: attrs({ divisions: 1, beats: 1 }), content: q('C', 3) }],
        [{ attributes: attrs({ divisions: 1, beats: 1 }), content: q('C', 5) }],
      ]),
    );
    expect(song.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [48, 'left'],
      [72, 'right'],
    ]);
  });

  it('rejects things that are not partwise MusicXML', () => {
    expect(() => parse('<html></html>')).toThrow(ImportError);
    expect(() => parse('<score-timewise/>')).toThrow(/Timewise/);
  });
});

describe('playbackOrder', () => {
  const bar = (o: Partial<Parameters<typeof playbackOrder>[0][number]> = {}) => ({
    forwardRepeat: false,
    backwardRepeat: false,
    repeatTimes: 2,
    endingStop: false,
    ...o,
  });
  it('repeats from the start when there is no forward repeat', () => {
    expect(playbackOrder([bar(), bar({ backwardRepeat: true }), bar()])).toEqual([0, 1, 0, 1, 2]);
  });
  it('honours repeat counts', () => {
    expect(
      playbackOrder([bar({ forwardRepeat: true, backwardRepeat: true, repeatTimes: 3 })]),
    ).toEqual([0, 0, 0]);
  });
  it('handles two repeated sections in a row', () => {
    expect(
      playbackOrder([
        bar(),
        bar({ backwardRepeat: true }),
        bar({ forwardRepeat: true }),
        bar({ backwardRepeat: true }),
      ]),
    ).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });
});

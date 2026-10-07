// ABC import. Every tune here is a self-made snippet written for these tests (CC0).
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeAbcText, parseAbc, parseKey, parseMeter, parseTempo } from '../src/abc';
import { ImportError } from '../src/errors';
import { importScore } from '../src/import';

const tune = (body: string, header = 'M:4/4\nL:1/4\nK:C') => `X:1\nT:Test\n${header}\n${body}\n`;
const pitches = (abc: string) => parseAbc(abc).notes.map((n) => n.pitch);
const timing = (abc: string) => parseAbc(abc).notes.map((n) => [n.startBeat, n.durationBeats]);

describe('parseAbc header', () => {
  it('reads title, composer, meter, tempo and key', () => {
    const song = parseAbc(
      'X:7\nT:Morning Walk\nT:Second title\nC:A. Composer\nM:3/4\nL:1/8\nQ:1/4=90\nK:G\nG2 A2 B2|d6|]\n',
    );
    expect(song.title).toBe('Morning Walk');
    expect(song.composer).toBe('A. Composer');
    expect(song.format).toBe('abc');
    expect(song.tempos).toEqual([{ beat: 0, bpm: 90 }]);
    expect(song.timeSignatures).toEqual([{ beat: 0, numerator: 3, denominator: 4 }]);
    expect(song.keySignatures).toEqual([{ beat: 0, fifths: 1, mode: 'major' }]);
    expect(song.notes.map((n) => n.pitch)).toEqual([67, 69, 71, 74]);
    expect(song.measures.map((m) => m.lengthBeats)).toEqual([3, 3]);
    expect(song.warnings).toEqual([]);
  });

  it('uses the default unit length from the meter and warns about a missing tempo', () => {
    // Below 3/4 the unit is a sixteenth, otherwise an eighth (ABC 2.1 §3.1.7).
    expect(timing('X:1\nM:2/4\nK:C\nCD|\n')).toEqual([
      [0, 0.25],
      [0.25, 0.25],
    ]);
    const song = parseAbc('X:1\nM:6/8\nK:C\nCDE FGA|\n');
    expect(song.notes[1]?.startBeat).toBe(0.5);
    expect(song.warnings[0]).toMatch(/no tempo/);
  });

  it('falls back to the file name for the title and decodes text escapes', () => {
    expect(parseAbc('X:1\nK:C\nC\n', { fallbackTitle: 'tune' }).title).toBe('tune');
    expect(parseAbc('X:1\nT:Caf\\\'e \\"uber Stra\\sse\nK:C\nC\n').title).toBe('Café über Straße');
    expect(decodeAbcText('Fran\\ccois &amp; \\u00e9')).toBe('François & é');
    expect(parseAbc('X:1\nT:A Long\n+:Title\nK:C\nC\n').title).toBe('A Long Title');
  });

  it('rejects text that is not ABC', () => {
    expect(() => parseAbc('just some words')).toThrow(ImportError);
  });

  it('warns about further tunes and part orders', () => {
    const song = parseAbc('X:1\nT:One\nP:AB\nK:C\nC\n\nX:2\nT:Two\nK:C\nD\n');
    expect(song.title).toBe('One');
    expect(song.notes).toHaveLength(1);
    expect(song.warnings.join(' ')).toMatch(/2 tunes/);
    expect(song.warnings.join(' ')).toMatch(/P:/);
  });
});

describe('ABC fields', () => {
  it('parses meters', () => {
    expect(parseMeter('C')).toEqual({ numerator: 4, denominator: 4 });
    expect(parseMeter('C|')).toEqual({ numerator: 2, denominator: 2 });
    expect(parseMeter('2+3+2/8')).toEqual({ numerator: 7, denominator: 8 });
    expect(parseMeter('(3+2)/8')).toEqual({ numerator: 5, denominator: 8 });
    expect(parseMeter('none')).toBeUndefined();
  });

  it('parses tempos in quarter notes per minute', () => {
    expect(parseTempo('1/4=120', 0.5)).toBe(120);
    expect(parseTempo('3/8=60', 0.5)).toBe(90);
    expect(parseTempo('"Allegro" 1/2=60', 0.5)).toBe(120);
    expect(parseTempo('1/8 1/4=40', 0.5)).toBe(60);
    // Old forms count unit notes.
    expect(parseTempo('C=120', 0.5)).toBe(60);
    expect(parseTempo('200', 0.5)).toBe(100);
    expect(parseTempo('"Slowly"', 0.5)).toBeUndefined();
  });

  it('parses keys, modes, extra accidentals and clefs', () => {
    const fifths = (k: string) => parseKey(k).key?.fifths;
    expect(fifths('D')).toBe(2);
    expect(fifths('Bb')).toBe(-2);
    expect(fifths('F#m')).toBe(3);
    expect(fifths('Am')).toBe(0);
    expect(fifths('A minor')).toBe(0);
    expect(fifths('Dmix')).toBe(1);
    expect(fifths('E dorian')).toBe(2);
    expect(fifths('Ephr')).toBe(0);
    expect(fifths('Flyd')).toBe(0);
    expect(fifths('Bloc')).toBe(0);
    expect(fifths('Ebmaj')).toBe(-3);
    expect(parseKey('Am').key?.mode).toBe('minor');
    expect(parseKey('Dmix').key?.mode).toBeUndefined();
    expect(parseKey('none').key?.accidentals.size).toBe(0);
    expect([...(parseKey('D exp ^f ^c ^g').key?.accidentals ?? [])]).toEqual([
      ['F', 1],
      ['C', 1],
      ['G', 1],
    ]);
    expect(parseKey('D _c').key?.accidentals.get('C')).toBe(-1);
    expect(parseKey('G clef=bass').options.clef).toBe('F');
    expect(parseKey('bass').key).toBeUndefined();
    expect(parseKey('bass').options.clef).toBe('F');
    expect(parseKey('C octave=-1').options.octave).toBe(-1);
  });
});

describe('ABC notes', () => {
  it('reads letters, octave marks and the key signature', () => {
    expect(pitches(tune("C, C c c' C,, c''"))).toEqual([48, 60, 72, 84, 36, 96]);
    expect(pitches(tune('F c f B', 'L:1/4\nK:D'))).toEqual([66, 73, 78, 71]);
    expect(pitches(tune('B e', 'L:1/4\nK:Bb'))).toEqual([70, 75]);
  });

  it('keeps accidentals to the end of the bar, per octave', () => {
    expect(pitches(tune('^F F f =F | F'))).toEqual([66, 66, 77, 65, 65]);
    expect(pitches(tune('^^C __B =C _E', 'L:1/4\nK:C'))).toEqual([62, 69, 60, 63]);
    expect(pitches(tune('F ^F =F F | F', 'L:1/4\nK:G'))).toEqual([66, 66, 65, 65, 66]);
  });

  it('reads note lengths', () => {
    expect(timing(tune('C2 D/2 E3/2 F/ G// A3/ B/4', 'L:1/4\nK:C'))).toEqual([
      [0, 2],
      [2, 0.5],
      [2.5, 1.5],
      [4, 0.5],
      [4.5, 0.25],
      [4.75, 1.5],
      [6.25, 0.25],
    ]);
  });

  it('applies broken rhythm', () => {
    expect(timing(tune('C>D E<F G>>A', 'L:1/8\nK:C'))).toEqual([
      [0, 0.75],
      [0.75, 0.25],
      [1, 0.25],
      [1.25, 0.75],
      [2, 0.875],
      [2.875, 0.125],
    ]);
  });

  it('reads rests, invisible rests and whole-bar rests', () => {
    const song = parseAbc(tune('C z D x | Z2 | E4 |'));
    expect(song.notes.map((n) => [n.pitch, n.startBeat])).toEqual([
      [60, 0],
      [62, 2],
      [64, 12],
    ]);
    expect(song.measures).toHaveLength(4);
    expect(song.lengthBeats).toBe(16);
  });

  it('reads chords with their own lengths and ties', () => {
    const song = parseAbc(tune('[CEG]2 [C2E2]- | [CE]2 [c-e] c', 'L:1/4\nK:C'));
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual([
      [60, 0, 2],
      [64, 0, 2],
      [67, 0, 2],
      [60, 2, 4],
      [64, 2, 4],
      [72, 6, 2],
      [76, 6, 1],
    ]);
    expect(song.notes[3]?.sourceRefs).toHaveLength(2);
  });

  it('merges ties across bar lines and carries the accidental through the tie', () => {
    const song = parseAbc(tune('C D E ^F- | F G A B |'));
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 1],
      [66, 3, 2],
      [67, 5, 1],
      [69, 6, 1],
      [71, 7, 1],
    ]);
  });

  it('reads triplets and general tuplets', () => {
    const three = timing(tune('(3CDE F', 'L:1/8\nK:C'));
    expect(three.map(([s, d]) => [s?.toFixed(3), d?.toFixed(3)])).toEqual([
      ['0.000', '0.333'],
      ['0.333', '0.333'],
      ['0.667', '0.333'],
      ['1.000', '0.500'],
    ]);
    // (p:q:r — five notes in the time of four, applied to the next five.
    const five = parseAbc(tune('(5:4:5CDEFG A', 'L:1/16\nK:C'));
    expect(five.notes.at(-1)?.startBeat).toBeCloseTo(1);
    // A triplet counts a chord as one note and can include rests.
    const chord = parseAbc(tune('(3[CE]zG c', 'L:1/8\nK:C'));
    expect(chord.notes.map((n) => +n.startBeat.toFixed(3))).toEqual([0, 0, 0.667, 1]);
    // In compound meter a quintuplet takes the time of three.
    const compound = parseAbc(tune('(5CDEFG A', 'M:6/8\nL:1/8\nK:C'));
    expect(compound.notes.at(-1)?.startBeat).toBeCloseTo(1.5);
  });

  it('skips grace notes, decorations, chord symbols and slurs, and keeps fingering', () => {
    const song = parseAbc(tune('{ga}"Am"!1!A .B ~c !trill!(d +5+e) "^text"T f', 'L:1/4\nK:C'));
    expect(song.notes.map((n) => n.pitch)).toEqual([69, 71, 72, 74, 76, 77]);
    expect(song.notes.map((n) => n.fingering)).toEqual([
      1,
      undefined,
      undefined,
      undefined,
      5,
      undefined,
    ]);
    const chord = parseAbc(tune('[!1!C!3!E!5!G]', 'L:1/4\nK:C'));
    expect(chord.notes.map((n) => n.fingering)).toEqual([1, 3, 5]);
  });

  it('ignores comments, lyrics and continues lines ending in a backslash', () => {
    const song = parseAbc(tune('C D % a comment\nw: la la\nE \\\nF |'));
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);
    expect(song.measures).toHaveLength(1);
  });
});

describe('ABC bars and repeats', () => {
  const order = (abc: string) => parseAbc(abc).notes.map((n) => n.pitch);

  it('gives a pickup bar its real length and number', () => {
    const song = parseAbc(tune('G | c2 e2 | d4 |]', 'M:4/4\nL:1/4\nK:C'));
    expect(song.measures.map((m) => [m.number, m.startBeat, m.lengthBeats])).toEqual([
      ['0', 0, 1],
      ['1', 1, 4],
      ['2', 5, 4],
    ]);
  });

  it('unrolls simple repeats and :: double repeats', () => {
    expect(order(tune('C D | E F :| G A |]', 'L:1/2\nK:C'))).toEqual([
      60, 62, 64, 65, 60, 62, 64, 65, 67, 69,
    ]);
    expect(order(tune('|: C2 :: D2 :| E2 |]', 'M:2/4\nL:1/4\nK:C'))).toEqual([60, 60, 62, 62, 64]);
  });

  it('unrolls first and second endings in both spellings', () => {
    const expected = [60, 62, 64, 60, 62, 65, 67];
    expect(order(tune('|: C | D |1 E :|2 F || G |]', 'L:1\nK:C'))).toEqual(expected);
    expect(order(tune('|: C | D | [1 E :| [2 F || G |]', 'L:1\nK:C'))).toEqual(expected);
    expect(order(tune('|: C | D |[1 E :|[2 F |] G', 'L:1\nK:C'))).toEqual(expected);
  });

  it('plays a two-bar first ending fully only on the first pass', () => {
    expect(order(tune('|: C |1 D | E :|2 F |: G :|', 'L:1\nK:C'))).toEqual([
      60, 62, 64, 60, 65, 67, 67,
    ]);
  });

  it('plays three endings', () => {
    expect(order(tune('|: C |1 D :|2 E :|3 F |]', 'L:1\nK:C'))).toEqual([60, 62, 60, 64, 60, 65]);
  });

  it('keeps a pickup across a repeat with a short last bar', () => {
    const song = parseAbc(tune('|: G | c2 e2 | d3 :|', 'M:4/4\nL:1/4\nK:C'));
    expect(song.notes.map((n) => n.pitch)).toEqual([67, 72, 76, 74, 67, 72, 76, 74]);
    expect(song.lengthBeats).toBe(16);
  });
});

describe('ABC voices', () => {
  it('maps voices to hands by clef, or by order', () => {
    const song = parseAbc(
      'X:1\nT:Duet\nM:4/4\nL:1/4\nQ:1/4=100\nV:1 clef=treble name="Right"\nV:2 clef=bass\nK:C\n' +
        '[V:1] e d c2 |\n[V:2] C,4 |\nV:1\n g4 |]\nV:2\n G,,4 |]\n',
    );
    expect(song.notes.map((n) => [n.pitch, n.startBeat, n.hand, n.staff])).toEqual([
      [48, 0, 'left', 2],
      [76, 0, 'right', 1],
      [74, 1, 'right', 1],
      [72, 2, 'right', 1],
      [43, 4, 'left', 2],
      [79, 4, 'right', 1],
    ]);
    expect(song.measures).toHaveLength(2);
    const unnamed = parseAbc('X:1\nL:1/4\nK:C\nV:A\nc|\nV:B\nC|\n');
    expect(unnamed.notes.map((n) => n.hand)).toEqual(['left', 'right']);
    const both = parseAbc('X:1\nL:1/4\nK:C\nV:1 clef=treble\nc|\nV:2 clef=treble\ne|\n');
    expect(both.notes.map((n) => n.hand)).toEqual(['right', 'right']);
  });

  it('honours octave and transpose voice options', () => {
    const song = parseAbc('X:1\nL:1/4\nV:1 octave=-1\nV:2 transpose=-12\nK:C\nV:1\nc|\nV:2\nc|\n');
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 60]);
  });

  it('overlays notes in the same bar with &', () => {
    const song = parseAbc(tune('c2 d2 & E4 | f4 |'));
    expect(song.notes.map((n) => [n.pitch, n.startBeat])).toEqual([
      [64, 0],
      [72, 0],
      [74, 2],
      [77, 4],
    ]);
  });
});

describe('ABC inline fields', () => {
  it('changes key, meter, unit length and tempo mid-tune', () => {
    const song = parseAbc(
      'X:1\nT:Changes\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nF4 | [K:G] F4 | [M:3/4][L:1/8] F6 | [Q:1/4=50] c6 |]\n',
    );
    expect(song.notes.map((n) => n.pitch)).toEqual([65, 66, 66, 72]);
    expect(song.keySignatures.map((k) => [k.beat, k.fifths])).toEqual([
      [0, 0],
      [4, 1],
    ]);
    expect(song.timeSignatures).toEqual([
      { beat: 0, numerator: 4, denominator: 4 },
      { beat: 8, numerator: 3, denominator: 4 },
    ]);
    expect(song.tempos).toEqual([
      { beat: 0, bpm: 100 },
      { beat: 11, bpm: 50 },
    ]);
    expect(song.measures.map((m) => m.lengthBeats)).toEqual([4, 4, 3, 3]);
  });

  it('changes key on a body field line', () => {
    expect(pitches(tune('F |\nK:F\nB |', 'L:1/4\nK:C'))).toEqual([65, 70]);
  });
});

describe('importScore with ABC', () => {
  it('picks ABC by extension and by content', () => {
    const abc = strToU8('X:1\nT:Little Tune\nL:1/4\nK:C\nCDEF|\n');
    expect(importScore('tune.abc', abc).format).toBe('abc');
    expect(importScore('tune.txt', abc).title).toBe('Little Tune');
    const untitled = strToU8('X:1\nL:1/4\nK:C\nCDEF|\n');
    expect(importScore('My Tune.abc', untitled).title).toBe('My Tune');
  });

  it('reads Latin-1 files as well as UTF-8', () => {
    const latin1 = new Uint8Array(
      [...'X:1\nT:Caf']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0xe9],
          [...'\nK:C\nC|\n'].map((c) => c.charCodeAt(0)),
        ),
    );
    expect(importScore('old.abc', latin1).title).toBe('Café');
    expect(importScore('new.abc', strToU8('X:1\nT:Café\nK:C\nC|\n')).title).toBe('Café');
  });
});

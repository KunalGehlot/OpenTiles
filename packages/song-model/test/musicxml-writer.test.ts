// Song → MusicXML (P5-13). Fixtures are MIDI files generated here (self-made, CC0).
import { describe, expect, it } from 'vitest';
import { midiToSong } from '../src/midi';
import { parseMusicXml } from '../src/musicxml';
import { songToMusicXml, spellPitch } from '../src/musicxml-writer';
import { swapHands, transpose } from '../src/transform';
import type { Song } from '../src/types';
import { domParser, notatedMidi } from './fixtures';
import type { WrittenNote } from './fixtures';

const parse = (xml: string) => parseMusicXml(xml, { domParser });

const name = (s: { step: string; alter: number; octave: number }) =>
  `${s.step}${s.alter === 1 ? '#' : s.alter === -1 ? 'b' : s.alter === 0 ? '' : `(${s.alter})`}${s.octave}`;

/** Two staves over 4/4, 3/4 and 6/8, a key change, ties, rests, chords, two voices and triplets. */
function piece(): WrittenNote[] {
  const rh = (pitch: number, start: number, value: number): WrittenNote => ({
    pitch,
    start,
    value,
  });
  const lh = (pitch: number, start: number, value: number): WrittenNote => ({
    pitch,
    start,
    value,
    track: 1,
  });
  return [
    // Bar 1 (4/4, B flat major): quarters, beamed eighths, a chord.
    rh(70, 0, 1),
    rh(72, 1, 0.5),
    rh(74, 1.5, 0.5),
    rh(75, 2, 1),
    rh(79, 2, 1),
    rh(77, 3, 1.5), // tied over the barline
    lh(46, 0, 4),
    lh(53, 0, 2),
    lh(58, 2, 2),
    // Bar 2: the tie ends; a rest; a dotted eighth and a sixteenth on a chromatic note (F sharp);
    // beamed eighths.
    rh(78, 5, 0.75),
    rh(79, 5.75, 0.25),
    rh(81, 6, 0.5),
    rh(82, 6.5, 0.5),
    rh(84, 7, 1),
    lh(43, 4, 4),
    // Bar 3 (3/4, D major from here): a triplet beat and two voices on the upper staff.
    rh(74, 8, 3),
    rh(66, 8, 1 / 3),
    rh(67, 8 + 1 / 3, 1 / 3),
    rh(69, 8 + 2 / 3, 1 / 3),
    rh(71, 9, 1),
    rh(73, 10, 1),
    lh(50, 8, 3),
    // Bars 4–5 (6/8): three beamed eighths and dotted quarters.
    rh(74, 11, 0.5),
    rh(76, 11.5, 0.5),
    rh(78, 12, 0.5),
    rh(79, 12.5, 1.5),
    rh(81, 14, 1.5),
    rh(78, 15.5, 1.5),
    lh(38, 11, 3),
    lh(45, 14, 3),
  ];
}

function pieceSong(): Song {
  return midiToSong(
    notatedMidi(piece(), {
      tempos: [
        [0, 96],
        [8, 90],
        [11, 72],
      ],
      times: [
        [0, 4, 4],
        [8, 3, 4],
        [11, 6, 8],
      ],
      keys: [
        [0, -2],
        [8, 2],
      ],
    }),
    { fallbackTitle: 'Round <trip> & back' },
  );
}

describe('pitch spelling', () => {
  it('spells chromatic notes as in tonal music: flats in flat keys, sharps in sharp keys', () => {
    expect([61, 63, 66, 68, 70].map((p) => name(spellPitch(p, 0)))).toEqual([
      'C#4',
      'Eb4',
      'F#4',
      'G#4',
      'Bb4',
    ]);
    expect([70, 63, 61, 68, 64].map((p) => name(spellPitch(p, -2)))).toEqual([
      'Bb4',
      'Eb4',
      'Db4',
      'Ab4',
      'E4',
    ]);
    expect([63, 68, 60, 70].map((p) => name(spellPitch(p, 4)))).toEqual([
      'D#4',
      'G#4',
      'C4',
      'A#4',
    ]);
  });

  it('raises the leading note in minor keys', () => {
    // D minor (one flat): G sharp leads to A; in F major the same key is A flat.
    expect(name(spellPitch(68, -1, true))).toBe('G#4');
    expect(name(spellPitch(68, -1, false))).toBe('Ab4');
  });

  it('keeps remote keys free of double accidentals and gets octaves right across B and C', () => {
    expect(name(spellPitch(71, -7))).toBe('Cb5');
    expect(name(spellPitch(64, -6))).toBe('E4');
    expect(name(spellPitch(77, 6))).toBe('E#5');
    expect(name(spellPitch(60, 6))).toBe('C4');
    expect(name(spellPitch(60, 7))).toBe('B#3');
  });
});

describe('song → MusicXML', () => {
  it('reads back as the same notes, bars, tempos and signatures', () => {
    const song = pieceSong();
    const { xml, song: linked } = songToMusicXml(song);
    const back = parse(xml);
    const key = (n: Song['notes'][number]) =>
      [n.pitch, n.startBeat.toFixed(6), n.durationBeats.toFixed(6), n.staff, n.hand].join(' ');
    expect(back.notes.map(key)).toEqual(song.notes.map(key));
    expect(back.measures.map((m) => [m.startBeat, m.lengthBeats])).toEqual(
      song.measures.map((m) => [m.startBeat, m.lengthBeats]),
    );
    expect(back.timeSignatures).toEqual(song.timeSignatures);
    expect(back.keySignatures.map((k) => [k.beat, k.fifths])).toEqual(
      song.keySignatures.map((k) => [k.beat, k.fifths]),
    );
    expect(back.tempos.map((t) => [t.beat, Math.round(t.bpm)])).toEqual(
      song.tempos.map((t) => [t.beat, Math.round(t.bpm)]),
    );
    expect(back.title).toBe('Round <trip> & back');
    // The refs the writer reports are the ones the parser gives the same notes.
    expect(linked.notes.map((n) => n.sourceRefs)).toEqual(back.notes.map((n) => n.sourceRefs));
    // Each written note carries its ref as its id, for the score views to link by.
    for (const ref of linked.notes.flatMap((n) => n.sourceRefs)) {
      expect(xml).toContain(`<note id="${ref}">`);
    }
    // Tied notes own every glyph they are drawn with.
    const tied = linked.notes.find((n) => n.pitch === 77 && n.startBeat === 3);
    expect(tied?.sourceRefs).toHaveLength(2);
  });

  it('changes only the refs of the song it was given', () => {
    const song = pieceSong();
    const { song: linked } = songToMusicXml(song);
    expect(linked.notes.map(({ sourceRefs: _, ...n }) => n)).toEqual(
      song.notes.map(({ sourceRefs: _, ...n }) => n),
    );
    expect(linked.notes.every((n) => n.sourceRefs.length >= 1)).toBe(true);
    expect({ ...linked, notes: [] }).toEqual({ ...song, notes: [] });
  });

  it('keeps the staves when the hands are swapped, and writes a transposed song in its new key', () => {
    const song = pieceSong();
    const swapped = parse(songToMusicXml(swapHands(song)).xml);
    expect(swapped.notes.map((n) => n.staff)).toEqual(song.notes.map((n) => n.staff));
    const up = transpose(song, 2);
    const back = parse(songToMusicXml(up).xml);
    expect(back.notes.map((n) => n.pitch)).toEqual(up.notes.map((n) => n.pitch));
    expect(back.keySignatures.map((k) => k.fifths)).toEqual([0, 4]);
  });

  it('writes accidentals, beams, triplets, ties and two voices', () => {
    const { xml } = songToMusicXml(pieceSong());
    const bars = xml.split('<measure ').slice(1);
    const bar = (i: number) => bars[i] ?? '';
    // Bar 2: F sharp in B flat major gets its sharp; the tied F continues without one.
    expect(bar(1)).toMatch(/<step>F<\/step><alter>1<\/alter>.*?<accidental>sharp<\/accidental>/);
    expect(bar(1)).toContain('<tie type="stop"/>');
    expect(bar(1).match(/<accidental>/g)).toHaveLength(1);
    // Beams: one group in bar 1; in bar 2 the dotted eighth and sixteenth (with a hook), then two
    // eighths.
    expect(bar(0).match(/<beam number="1">begin<\/beam>/g)).toHaveLength(1);
    expect(bar(1).match(/<beam number="1">begin<\/beam>/g)).toHaveLength(2);
    expect(bar(1)).toContain('<beam number="2">backward hook</beam>');
    // Bar 3: a triplet beat, bracketed once, and stems up and down for two voices.
    expect(bar(2)).toContain('<time-modification><actual-notes>3</actual-notes>');
    expect(bar(2).match(/<tuplet type="start"/g)).toHaveLength(1);
    expect(bar(2)).toContain('<stem>up</stem>');
    expect(bar(2)).toContain('<stem>down</stem>');
    // D major from bar 3: C sharp needs no accidental there.
    expect(bar(2)).toContain('<key><fifths>2</fifths>');
    expect(bar(2)).not.toContain('<accidental>');
    // 6/8: eighths beamed in threes, and the time signature written once per change.
    expect(bar(3)).toContain('<beats>6</beats><beat-type>8</beat-type>');
    expect(bar(3).match(/<beam number="1">begin<\/beam>/g)).toHaveLength(1);
    expect(xml.match(/<time>/g)).toHaveLength(3);
    // Grand staff without a printed instrument name; bars close with a final barline.
    expect(xml).toContain('<staves>2</staves>');
    expect(xml).toContain('<part-name print-object="no">');
    expect(xml).toContain('<bar-style>light-heavy</bar-style>');
  });

  it('cancels an accidental later in the bar with a natural', () => {
    const song = midiToSong(
      notatedMidi([
        { pitch: 61, start: 0, value: 1 },
        { pitch: 60, start: 1, value: 1 },
        { pitch: 61, start: 2, value: 1 },
        { pitch: 61, start: 3, value: 1 },
      ]),
    );
    const accidentals = songToMusicXml(song).xml.match(/<accidental>[^<]+<\/accidental>/g);
    expect(accidentals).toEqual([
      '<accidental>sharp</accidental>',
      '<accidental>natural</accidental>',
      '<accidental>sharp</accidental>',
    ]);
  });

  it('writes quarter-note triplets as triplet quarters under one bracket', () => {
    const song = midiToSong(
      notatedMidi([
        { pitch: 72, start: 0, value: 2 / 3 },
        { pitch: 74, start: 2 / 3, value: 2 / 3 },
        { pitch: 76, start: 4 / 3, value: 2 / 3 },
        { pitch: 77, start: 2, value: 2 },
        { pitch: 48, start: 0, value: 4, track: 1 },
      ]),
    );
    const { xml } = songToMusicXml(song);
    const upper = xml.split('<backup>')[0] ?? '';
    expect(upper.match(/<type>quarter<\/type><time-modification>/g)).toHaveLength(3);
    expect(upper.match(/<tuplet type="start"/g)).toHaveLength(1);
    expect(upper).not.toContain('<tie ');
    expect(parse(xml).notes.map((n) => n.startBeat.toFixed(3))).toEqual(
      song.notes.map((n) => n.startBeat.toFixed(3)),
    );
  });

  it('writes rests where they fall in the bar', () => {
    // 4/4: a quarter on beat 2, a sixteenth after the middle; 6/8: one eighth.
    const song = midiToSong(
      notatedMidi(
        [
          { pitch: 72, start: 1, value: 1 },
          { pitch: 72, start: 6.25, value: 0.25 },
          { pitch: 72, start: 8, value: 0.5 },
          ...[0, 4, 8].map((start) => ({ pitch: 48, start, value: 4, track: 1 })),
        ],
        {
          times: [
            [0, 4, 4],
            [8, 6, 8],
          ],
        },
      ),
    );
    const { xml } = songToMusicXml(song);
    const rests = (bar: number) =>
      [
        ...(xml.split('<measure ')[bar + 1] ?? '').matchAll(
          /<rest\/>.*?<type>(\w+)<\/type>(<dot\/>)?/g,
        ),
      ]
        .map((m) => `${m[1]}${m[2] ? '.' : ''}`)
        .join(' ');
    expect(rests(0)).toBe('quarter half');
    expect(rests(1)).toBe('half 16th eighth quarter');
    expect(rests(2)).toBe('eighth eighth quarter.');
  });

  it('puts the lower staff in the treble clef while it stays high, and back', () => {
    const notes: WrittenNote[] = [];
    for (let bar = 0; bar < 6; bar++) {
      notes.push({ pitch: 76, start: bar * 4, value: 4 });
      const low = bar < 2 || bar > 3;
      for (let b = 0; b < 4; b++) {
        notes.push({ pitch: low ? 43 + b : 67 + b, start: bar * 4 + b, value: 1, track: 1 });
      }
    }
    const xml = songToMusicXml(midiToSong(notatedMidi(notes))).xml;
    const clefs = [...xml.matchAll(/<measure number="(\d+)".*?<\/measure>/g)].map((m) =>
      [...(m[0].matchAll(/<clef number="2"><sign>(\w)/g) ?? [])].map((c) => c[1]).join(''),
    );
    expect(clefs).toEqual(['F', '', 'G', '', 'F', '']);
  });

  it('writes a short bar as implicit and fills an empty staff with a bar rest', () => {
    const song = midiToSong(notatedMidi([{ pitch: 72, start: 0, value: 1 }]));
    const short: Song = {
      ...song,
      measures: [
        {
          ...song.measures[0],
          index: 0,
          number: '0',
          sourceIndex: 0,
          startBeat: 0,
          lengthBeats: 1,
        },
      ],
      lengthBeats: 1,
    };
    const { xml } = songToMusicXml(short);
    expect(xml).toContain('<measure number="0" implicit="yes">');
    expect(xml).toContain('<rest measure="yes"/>');
    const back = parse(xml);
    expect(back.measures.map((m) => m.lengthBeats)).toEqual([1]);
  });

  it('writes a 2,000-note piece quickly', () => {
    const notes: WrittenNote[] = [];
    for (let i = 0; i < 1000; i++) {
      notes.push({ pitch: 60 + (i % 12), start: i / 2, value: 0.5 });
      notes.push({ pitch: 36 + (i % 7), start: i / 2, value: 0.5, track: 1 });
    }
    const song = midiToSong(notatedMidi(notes));
    const t0 = performance.now();
    const { song: linked } = songToMusicXml(song);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(linked.notes).toHaveLength(2000);
  });
});

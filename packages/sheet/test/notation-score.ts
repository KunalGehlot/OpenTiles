// A piano score made up here (CC0) with what a MIDI file cannot say: chords with seconds, sharps
// and flats spelled several ways, a rolled chord with the lower staff's notes above it (hands
// crossed), a tie over a barline, a clef change at the start of a bar and one inside a bar, and an
// 8va sign. As MusicXML for an engraver, as the song a MIDI export of it would give, and with the
// answers a reading of its print should find.
import type { Measure, Song, SongNote } from '@opentiles/song-model';

/** A written note: its spelling and the octave it sounds in. */
export interface W {
  step: string;
  octave: number;
  alter?: number;
}

interface Ev {
  notes: W[];
  beats: number;
  tie?: 'start' | 'stop';
  /** Played as a roll, note after note from the bottom (a MIDI export's arpeggio). */
  roll?: boolean;
  /** A clef change just before this note. */
  clef?: 'G' | 'F';
  /** An 8va sign starting at this note, or ending after it. */
  ottava?: 'start' | 'stop';
}

const w = (name: string): W => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(name);
  return {
    step: m[1] ?? 'C',
    octave: Number(m[3]),
    alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0,
  };
};
const ev = (names: string, beats: number, extra: Partial<Ev> = {}): Ev => ({
  notes: names.split(' ').map(w),
  beats,
  ...extra,
});

// Eight 4/4 bars: [upper staff, lower staff].
export const BARS: [Ev[], Ev[]][] = [
  [
    [ev('E5', 1), ev('D5', 1), ev('C5', 1), ev('B4', 1)],
    [ev('C3', 2), ev('G3', 2)],
  ],
  [
    [ev('C#5', 1), ev('Db5', 1), ev('B#4', 1), ev('Cb5', 1)],
    [ev('E3', 1), ev('G3', 1), ev('C3 G3', 2)],
  ],
  [
    [ev('C5 D5 E5', 2), ev('F4 A4 C5', 2, { roll: true })],
    [ev('G4', 1, { clef: 'G' }), ev('A4', 1), ev('B4 D5', 2)],
  ],
  [
    [ev('E5', 1), ev('F#5', 1), ev('G5', 2, { tie: 'start' })],
    [ev('C5', 1), ev('B4', 1), ev('C3', 1, { clef: 'F' }), ev('E3', 1)],
  ],
  [[ev('G5', 1, { tie: 'stop' }), ev('A5', 1), ev('B5', 2)], [ev('G2', 4)]],
  [[ev('C6', 1, { ottava: 'start' }), ev('D6', 1), ev('E6', 1), ev('F6', 1)], [ev('C3', 4)]],
  [[ev('G6', 2), ev('E6', 2, { ottava: 'stop' })], [ev('G2', 4)]],
  [[ev('C5', 4)], [ev('C3 G3', 4)]],
];

const TYPES: Record<number, string> = { 1: 'quarter', 2: 'half', 4: 'whole' };
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pitchOf = (n: W) => (n.octave + 1) * 12 + (LETTER[n.step] ?? 0) + (n.alter ?? 0);
const ACCIDENTAL: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' };

/** The score as MusicXML (pitches as they sound, as MusicXML writes them under an 8va sign). */
export function musicXml(): string {
  const clef = (staff: number, c: 'G' | 'F') =>
    `<clef number="${staff}"><sign>${c}</sign><line>${c === 'G' ? 2 : 4}</line></clef>`;
  const measures = BARS.map(([upper, lower], b) => {
    const parts: string[] = [];
    if (b === 0)
      parts.push(
        `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clef(1, 'G')}${clef(2, 'F')}</attributes>`,
      );
    [upper, lower].forEach((events, s) => {
      const staff = s + 1;
      if (s === 1) parts.push('<backup><duration>4</duration></backup>');
      for (const e of events) {
        if (e.clef) parts.push(`<attributes>${clef(staff, e.clef)}</attributes>`);
        if (e.ottava === 'start')
          parts.push(
            `<direction placement="above"><direction-type><octave-shift type="down" size="8" number="1"/></direction-type><staff>${staff}</staff></direction>`,
          );
        e.notes.forEach((n, k) => {
          const tie = e.tie ? `<tie type="${e.tie}"/>` : '';
          const notations =
            (e.tie ? `<tied type="${e.tie}"/>` : '') + (e.roll ? '<arpeggiate/>' : '');
          parts.push(
            `<note>${k > 0 ? '<chord/>' : ''}<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>` +
              `<duration>${e.beats}</duration>${tie}<voice>${staff === 1 ? 1 : 5}</voice><type>${TYPES[e.beats]}</type>` +
              `${n.alter ? `<accidental>${ACCIDENTAL[n.alter]}</accidental>` : ''}<staff>${staff}</staff>` +
              `${notations ? `<notations>${notations}</notations>` : ''}</note>`,
          );
        });
        if (e.ottava === 'stop')
          parts.push(
            `<direction><direction-type><octave-shift type="stop" size="8" number="1"/></direction-type><staff>${staff}</staff></direction>`,
          );
      }
    });
    return `<measure number="${b + 1}">${parts.join('')}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name print-object="no">Piano</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
}

export interface Expected {
  staff: number;
  written: W;
}

/** The song a MIDI export of the score would give (ties joined, the roll spread), and the answers. */
export function songOf(): { song: Song; expected: Expected[] } {
  const raw: { pitch: number; start: number; length: number; staff: number; written: W }[] = [];
  BARS.forEach((staves, b) =>
    staves.forEach((events, s) => {
      let at = 4 * b;
      for (const e of events) {
        e.notes.forEach((n, k) => {
          const pitch = pitchOf(n);
          const held =
            e.tie === 'stop' && raw.find((r) => r.pitch === pitch && r.start + r.length === at);
          if (held) held.length += e.beats;
          else {
            const offset = e.roll ? k / 16 : 0;
            raw.push({
              pitch,
              start: at + offset,
              length: e.beats - offset,
              staff: s + 1,
              written: n,
            });
          }
        });
        at += e.beats;
      }
    }),
  );
  raw.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const measures: Measure[] = BARS.map((_, i) => ({
    index: i,
    number: String(i + 1),
    sourceIndex: i,
    startBeat: 4 * i,
    lengthBeats: 4,
  }));
  const notes: SongNote[] = raw.map((r, i) => ({
    id: `n${i}`,
    pitch: r.pitch,
    startBeat: r.start,
    durationBeats: r.length,
    hand: r.staff === 1 ? 'right' : 'left',
    staff: r.staff,
    voice: 1,
    part: 0,
    measureIndex: Math.floor(r.start / 4),
    sourceRefs: [],
  }));
  return {
    song: {
      title: 'Test',
      format: 'midi',
      notes,
      measures,
      tempos: [{ beat: 0, bpm: 100 }],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
      keySignatures: [{ beat: 0, fifths: 0 }],
      parts: [{ name: 'Piano' }],
      lengthBeats: 32,
      warnings: [],
    },
    expected: raw.map((r) => ({ staff: r.staff, written: r.written })),
  };
}

// Chord vocabulary for the chord drills (P7-01, ADR 0022): qualities, spelling, inversions and
// voicings. Every interval has a size in semitones and in letter steps, so a chord is spelled the
// way musicians write it (E♭ major is E♭ G B♭, never D♯ G A♯). Names come back as parts, not
// text: the web app writes them in the learner's label style, and this package knows no language.

export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'sus2'
  | 'sus4'
  | 'maj7'
  | 'dom7'
  | 'min7'
  | 'm7b5'
  | 'dim7'
  | 'add9'
  | 'six'
  | 'min6';

/** Every quality, in the order the setup page lists them. */
export const CHORD_QUALITIES: readonly ChordQuality[] = [
  'maj',
  'min',
  'dim',
  'aug',
  'sus2',
  'sus4',
  'maj7',
  'dom7',
  'min7',
  'm7b5',
  'dim7',
  'add9',
  'six',
  'min6',
];

/** Intervals above the root as [semitones, letter steps]. */
const INTERVALS: Record<ChordQuality, readonly (readonly [number, number])[]> = {
  maj: [
    [0, 0],
    [4, 2],
    [7, 4],
  ],
  min: [
    [0, 0],
    [3, 2],
    [7, 4],
  ],
  dim: [
    [0, 0],
    [3, 2],
    [6, 4],
  ],
  aug: [
    [0, 0],
    [4, 2],
    [8, 4],
  ],
  sus2: [
    [0, 0],
    [2, 1],
    [7, 4],
  ],
  sus4: [
    [0, 0],
    [5, 3],
    [7, 4],
  ],
  maj7: [
    [0, 0],
    [4, 2],
    [7, 4],
    [11, 6],
  ],
  dom7: [
    [0, 0],
    [4, 2],
    [7, 4],
    [10, 6],
  ],
  min7: [
    [0, 0],
    [3, 2],
    [7, 4],
    [10, 6],
  ],
  m7b5: [
    [0, 0],
    [3, 2],
    [6, 4],
    [10, 6],
  ],
  dim7: [
    [0, 0],
    [3, 2],
    [6, 4],
    [9, 6],
  ],
  add9: [
    [0, 0],
    [4, 2],
    [7, 4],
    [14, 8],
  ],
  six: [
    [0, 0],
    [4, 2],
    [7, 4],
    [9, 5],
  ],
  min6: [
    [0, 0],
    [3, 2],
    [7, 4],
    [9, 5],
  ],
};

/** The symbol after the root, as lead sheets write it. Symbols are the same in every language. */
const SUFFIXES: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  maj7: 'maj7',
  dom7: '7',
  min7: 'm7',
  m7b5: 'm7♭5',
  dim7: 'dim7',
  add9: 'add9',
  six: '6',
  min6: 'm6',
};

/** Letter index: 0 is C, 6 is B. */
export type Letter = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface PitchName {
  letter: Letter;
  /** −1 flat, 0 natural, 1 sharp. */
  alter: number;
}

export interface SpelledPitch extends PitchName {
  /** The octave MusicXML writes, which follows the letter (B♯4 sounds as C5). */
  octave: number;
  midi: number;
}

export interface Chord {
  root: PitchName;
  quality: ChordQuality;
  /** 0 root position, 1 first inversion, and so on, up to one less than the notes. */
  inversion: number;
}

export interface ChordSymbolParts {
  root: PitchName;
  suffix: string;
  /** The lowest note, for an inversion written as a slash chord (C/E). */
  bass?: PitchName;
}

const NATURAL = [0, 2, 4, 5, 7, 9, 11];

export const pitchClassOf = (p: PitchName): number =>
  ((((NATURAL[p.letter] ?? 0) + p.alter) % 12) + 12) % 12;

/** The notes a quality has: three for triads, four for sevenths, add9 and sixths. */
export const noteCount = (quality: ChordQuality): number => INTERVALS[quality].length;

/** Inversions a quality is offered in: add9 and sixths stay in root position (P7-09, level 7). */
export const inversionsOf = (quality: ChordQuality): number =>
  quality === 'add9' || quality === 'six' || quality === 'min6' ? 1 : noteCount(quality);

/** The spellings a pitch class can have as a root: no B♯, E♯, C♭ or F♭ roots. */
const ROOT_SPELLINGS: readonly (readonly PitchName[])[] = [
  [{ letter: 0, alter: 0 }],
  [
    { letter: 1, alter: -1 },
    { letter: 0, alter: 1 },
  ],
  [{ letter: 1, alter: 0 }],
  [
    { letter: 2, alter: -1 },
    { letter: 1, alter: 1 },
  ],
  [{ letter: 2, alter: 0 }],
  [{ letter: 3, alter: 0 }],
  [
    { letter: 3, alter: 1 },
    { letter: 4, alter: -1 },
  ],
  [{ letter: 4, alter: 0 }],
  [
    { letter: 5, alter: -1 },
    { letter: 4, alter: 1 },
  ],
  [{ letter: 5, alter: 0 }],
  [
    { letter: 6, alter: -1 },
    { letter: 5, alter: 1 },
  ],
  [{ letter: 6, alter: 0 }],
];

function spell(root: PitchName, quality: ChordQuality, octave: number): SpelledPitch[] {
  const rootMidi = (octave + 1) * 12 + (NATURAL[root.letter] ?? 0) + root.alter;
  return INTERVALS[quality].map(([semis, steps]) => {
    const index = root.letter + steps;
    const letter = (index % 7) as Letter;
    const noteOctave = octave + Math.floor(index / 7);
    const midi = rootMidi + semis;
    return {
      letter,
      alter: midi - ((noteOctave + 1) * 12 + (NATURAL[letter] ?? 0)),
      octave: noteOctave,
      midi,
    };
  });
}

/**
 * The root's spelling for a pitch class and quality: the one whose chord needs the fewest
 * accidentals, the way musicians choose (D♭ major but C♯ minor, A♭ augmented, not G♯). Ties go to
 * the first spelling listed (E♭ minor, F♯ major), which the table orders as the common one.
 */
export function rootFor(pitchClass: number, quality: ChordQuality): PitchName {
  const options = ROOT_SPELLINGS[((pitchClass % 12) + 12) % 12] ?? [{ letter: 0, alter: 0 }];
  let best = options[0] ?? { letter: 0, alter: 0 };
  let bestCost = Infinity;
  for (const root of options) {
    // A double accidental costs more than any number of single ones.
    const cost = spell(root, quality, 4).reduce(
      (sum, n) => sum + (Math.abs(n.alter) >= 2 ? 10 : Math.abs(n.alter)),
      0,
    );
    if (cost < bestCost) {
      best = root;
      bestCost = cost;
    }
  }
  return best;
}

/** A note that would need a double flat or sharp, written as its neighbour letter instead. */
function simplify(n: SpelledPitch): SpelledPitch {
  if (Math.abs(n.alter) < 2) return n;
  const up = n.alter > 0;
  const index = n.letter + (up ? 1 : -1);
  const letter = (((index % 7) + 7) % 7) as Letter;
  const octave = n.octave + (index > 6 ? 1 : index < 0 ? -1 : 0);
  return {
    letter,
    octave,
    midi: n.midi,
    alter: n.midi - ((octave + 1) * 12 + (NATURAL[letter] ?? 0)),
  };
}

/**
 * The chord's notes from the lowest up, its root (before inverting) in `octave`. An inversion
 * moves the lowest notes up an octave. A note that would need a double accidental (the seventh of
 * C dim7, B𝄫) is written as the natural it sounds as (A), as chord books do (ADR 0022).
 */
export function chordNotes(chord: Chord, octave = 4): SpelledPitch[] {
  const notes = spell(chord.root, chord.quality, octave).map(simplify);
  return invert(notes, chord.inversion);
}

/** Moves the lowest `n` notes up an octave each, keeping the order from the lowest up. */
export function invert(notes: readonly SpelledPitch[], n: number): SpelledPitch[] {
  const out = [...notes];
  for (let i = 0; i < n && out.length > 1; i++) {
    const low = out.shift();
    if (!low) break;
    out.push({ ...low, octave: low.octave + 1, midi: low.midi + 12 });
  }
  return out;
}

/** Moves spelled notes by whole octaves. */
export const shiftOctaves = (notes: readonly SpelledPitch[], octaves: number): SpelledPitch[] =>
  notes.map((n) => ({ ...n, octave: n.octave + octaves, midi: n.midi + 12 * octaves }));

/**
 * The chord placed by octaves so the middle of its notes is nearest `centre` (a MIDI pitch), and
 * its lowest note no lower than `lowest`. Ties go to the higher placement, which reads on the
 * staff rather than below it.
 */
export function voicing(chord: Chord, centre: number, lowest = 0): SpelledPitch[] {
  const base = chordNotes(chord, 4);
  let best = base;
  let bestDistance = Infinity;
  for (let shift = -4; shift <= 4; shift++) {
    const notes = shiftOctaves(base, shift);
    const low = notes[0]?.midi ?? 0;
    if (low < lowest) continue;
    const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
    const distance = Math.abs(mean - centre);
    if (distance <= bestDistance + 1e-9) {
      best = notes;
      bestDistance = distance;
    }
  }
  return best;
}

/** The chord's name as parts: root, the quality's symbol, and the bass of an inversion. */
export function chordSymbol(chord: Chord): ChordSymbolParts {
  const parts: ChordSymbolParts = { root: chord.root, suffix: SUFFIXES[chord.quality] };
  if (chord.inversion > 0) {
    const low = chordNotes(chord, 4)[0];
    if (low) parts.bass = { letter: low.letter, alter: low.alter };
  }
  return parts;
}

/** The chord on a pitch class, spelled as `rootFor` chooses. */
export const chordOn = (pitchClass: number, quality: ChordQuality, inversion = 0): Chord => ({
  root: rootFor(pitchClass, quality),
  quality,
  inversion: Math.max(0, Math.min(inversionsOf(quality) - 1, Math.floor(inversion))),
});

/** A short key for a chord, the same however it is voiced: "0.maj.1" is C major, first inversion. */
export const chordKey = (chord: Chord): string =>
  `${pitchClassOf(chord.root)}.${chord.quality}.${chord.inversion}`;

/** The pitch classes a chord sounds, from the root up (before inverting). */
export const chordPitchClasses = (chord: Chord): number[] =>
  INTERVALS[chord.quality].map(([semis]) => (pitchClassOf(chord.root) + semis) % 12);

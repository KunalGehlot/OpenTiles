// Scales (P7-15, ADR 0024): what a scale is, how it is spelled, and the key signature it is
// written with, so a scale drill can be drawn as musicians read it. Pure, like the chords.
import { pitchClassOf } from './chords';
import type { Letter, PitchName, SpelledPitch } from './chords';

export type ScaleKind =
  | 'major'
  | 'natural-minor'
  | 'harmonic-minor'
  | 'melodic-minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'major-pentatonic'
  | 'minor-pentatonic'
  | 'blues'
  | 'chromatic';

/** Every kind, in the order the setup page lists them; ids store kinds by this index. */
export const SCALE_KINDS: readonly ScaleKind[] = [
  'major',
  'natural-minor',
  'harmonic-minor',
  'melodic-minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
  'major-pentatonic',
  'minor-pentatonic',
  'blues',
  'chromatic',
];

export interface Scale {
  tonic: PitchName;
  kind: ScaleKind;
}

/** A note of a scale as it is played: where in the scale it is and which way the run goes. */
export interface ScaleNote extends SpelledPitch {
  /** 0 for the tonic, then each step of the kind (0 to 11 for chromatic). */
  degree: number;
  direction: 'up' | 'down';
}

/** Each degree as [semitones, letters] above the tonic, going up. */
type Steps = readonly (readonly [number, number])[];

const SEVEN = (semitones: readonly number[]): Steps => semitones.map((s, i) => [s, i] as const);

const STEPS: Record<Exclude<ScaleKind, 'chromatic'>, Steps> = {
  major: SEVEN([0, 2, 4, 5, 7, 9, 11]),
  'natural-minor': SEVEN([0, 2, 3, 5, 7, 8, 10]),
  'harmonic-minor': SEVEN([0, 2, 3, 5, 7, 8, 11]),
  'melodic-minor': SEVEN([0, 2, 3, 5, 7, 9, 11]),
  dorian: SEVEN([0, 2, 3, 5, 7, 9, 10]),
  phrygian: SEVEN([0, 1, 3, 5, 7, 8, 10]),
  lydian: SEVEN([0, 2, 4, 6, 7, 9, 11]),
  mixolydian: SEVEN([0, 2, 4, 5, 7, 9, 10]),
  locrian: SEVEN([0, 1, 3, 5, 6, 8, 10]),
  'major-pentatonic': [
    [0, 0],
    [2, 1],
    [4, 2],
    [7, 4],
    [9, 5],
  ],
  'minor-pentatonic': [
    [0, 0],
    [3, 2],
    [5, 3],
    [7, 4],
    [10, 6],
  ],
  // The blue note is the flattened fifth (A blues: A C D E♭ E G).
  blues: [
    [0, 0],
    [3, 2],
    [5, 3],
    [6, 4],
    [7, 4],
    [10, 6],
  ],
};

/**
 * The classical melodic minor (ADR 0024, Q3): the sixth and seventh raised going up and natural
 * coming down, so its way down is the natural minor.
 */
const DOWN_STEPS: Partial<Record<ScaleKind, Steps>> = {
  'melodic-minor': STEPS['natural-minor'],
};

/** Notes in one octave of the kind, going up. */
export const scaleLength = (kind: ScaleKind): number =>
  kind === 'chromatic' ? 12 : STEPS[kind].length;

/** The kinds with seven notes, which have a standard fingering (P7-16). */
export const isHeptatonic = (kind: ScaleKind): boolean => scaleLength(kind) === 7;

export const isMinor = (kind: ScaleKind): boolean =>
  kind === 'natural-minor' || kind === 'harmonic-minor' || kind === 'melodic-minor';

const NATURAL = [0, 2, 4, 5, 7, 9, 11];

/**
 * The major keys whose key signatures scales are written with, by the tonic's pitch class: the
 * spelling with at most six sharps or flats, F♯ (six sharps) rather than G♭ (six flats).
 */
const MAJOR_KEYS: readonly { tonic: PitchName; fifths: number }[] = [
  { tonic: { letter: 0, alter: 0 }, fifths: 0 },
  { tonic: { letter: 1, alter: -1 }, fifths: -5 },
  { tonic: { letter: 1, alter: 0 }, fifths: 2 },
  { tonic: { letter: 2, alter: -1 }, fifths: -3 },
  { tonic: { letter: 2, alter: 0 }, fifths: 4 },
  { tonic: { letter: 3, alter: 0 }, fifths: -1 },
  { tonic: { letter: 3, alter: 1 }, fifths: 6 },
  { tonic: { letter: 4, alter: 0 }, fifths: 1 },
  { tonic: { letter: 5, alter: -1 }, fifths: -4 },
  { tonic: { letter: 5, alter: 0 }, fifths: 3 },
  { tonic: { letter: 6, alter: -1 }, fifths: -2 },
  { tonic: { letter: 6, alter: 0 }, fifths: 5 },
];
/** G♭ major, the parent of E♭ minor: the minors take six flats over six sharps (E♭ minor, not D♯). */
const G_FLAT = { tonic: { letter: 4, alter: -1 } as PitchName, fifths: -6 };

/**
 * Where each kind sits in its parent major key, whose key signature it is written with: the
 * semitones and letters from the parent's tonic up to the scale's. The minors are written in their
 * relative major's signature, the modes in their parent's (D dorian has no sharps, ADR 0024 Q2),
 * the pentatonics in their major or minor key, blues in its minor key.
 */
const IN_PARENT: Record<Exclude<ScaleKind, 'chromatic'>, readonly [number, number]> = {
  major: [0, 0],
  'natural-minor': [9, 5],
  'harmonic-minor': [9, 5],
  'melodic-minor': [9, 5],
  dorian: [2, 1],
  phrygian: [4, 2],
  lydian: [5, 3],
  mixolydian: [7, 4],
  locrian: [11, 6],
  'major-pentatonic': [0, 0],
  'minor-pentatonic': [9, 5],
  blues: [9, 5],
};

const usesMinorKey = (kind: ScaleKind): boolean =>
  isMinor(kind) || kind === 'minor-pentatonic' || kind === 'blues';

/** E♯, B♯, C♭ and F♭: a tonic no one writes when a spelling with a plain letter exists. */
const oddTonic = (p: PitchName) =>
  (p.alter > 0 && (p.letter === 2 || p.letter === 6)) ||
  (p.alter < 0 && (p.letter === 0 || p.letter === 3));

const tonicIn = (parent: { tonic: PitchName }, pitchClass: number, kind: ScaleKind) => {
  const letter = ((parent.tonic.letter + IN_PARENT[kind as Exclude<ScaleKind, 'chromatic'>][1]) %
    7) as Letter;
  return { letter, alter: ((pitchClass - (NATURAL[letter] ?? 0) + 18) % 12) - 6 };
};

function parentKey(pitchClass: number, kind: Exclude<ScaleKind, 'chromatic'>) {
  const [semis] = IN_PARENT[kind];
  const pc = (((pitchClass - semis) % 12) + 12) % 12;
  const plain = MAJOR_KEYS[pc] ?? MAJOR_KEYS[0]!;
  if (pc !== 6) return plain;
  // Six sharps or six flats: the minors take G♭'s flats (E♭ minor, not D♯ minor), and so does a
  // mode whose tonic F♯ major would spell oddly (F locrian, not E♯ locrian).
  if (usesMinorKey(kind) || oddTonic(tonicIn(plain, pitchClass, kind))) return G_FLAT;
  return plain;
}

/**
 * The scale on a pitch class, spelled as its key signature has it: D♭ major, C♯ minor, E♭ minor,
 * G♯ dorian. A chromatic scale's tonic is spelled as its major's.
 */
export function scaleOn(pitchClass: number, kind: ScaleKind): Scale {
  const pc = ((pitchClass % 12) + 12) % 12;
  if (kind === 'chromatic') return { tonic: (MAJOR_KEYS[pc] ?? MAJOR_KEYS[0]!).tonic, kind };
  return { tonic: tonicIn(parentKey(pc, kind), pc, kind), kind };
}

/** The sharps (positive) or flats (negative) of the key signature the scale is written with. */
export function keySignatureOf(scale: Scale): number {
  if (scale.kind === 'chromatic') return 0;
  return parentKey(pitchClassOf(scale.tonic), scale.kind).fifths;
}

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B, as letters
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

/** The alteration a key signature gives a letter. */
export function keyAlter(letter: number, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

function spellAt(tonic: PitchName, tonicMidi: number, semis: number, letters: number) {
  const index = tonic.letter + letters;
  const letter = (index % 7) as Letter;
  const octave = Math.floor((tonicMidi - (NATURAL[tonic.letter] ?? 0) - tonic.alter) / 12) - 1;
  const noteOctave = octave + Math.floor(index / 7);
  const midi = tonicMidi + semis;
  return {
    letter,
    alter: midi - ((noteOctave + 1) * 12 + (NATURAL[letter] ?? 0)),
    octave: noteOctave,
    midi,
  };
}

/** A pitch class written with a sharp (going up) or a flat (coming down), for chromatic scales. */
function chromaticName(midi: number, up: boolean): SpelledPitch {
  const pc = ((midi % 12) + 12) % 12;
  let letter = NATURAL.indexOf(pc);
  let alter = 0;
  if (letter < 0) {
    letter = up ? NATURAL.indexOf(pc - 1) : NATURAL.indexOf(pc + 1);
    alter = up ? 1 : -1;
  }
  const octave = Math.floor((midi - alter) / 12) - 1;
  return { letter: letter as Letter, alter, octave, midi };
}

/** The tonic's MIDI pitch in `octave` (MusicXML's octave of its letter: C♭4 sounds as B3). */
export const tonicMidi = (scale: Scale, octave: number): number =>
  (octave + 1) * 12 + (NATURAL[scale.tonic.letter] ?? 0) + scale.tonic.alter;

/**
 * The scale's notes from the tonic at `from` (a MIDI pitch) up `octaves` octaves and back, the top
 * note once. Going `down` first starts at the top instead (the left hand in contrary motion): from
 * `from` down and back up. A chromatic scale is written with sharps going up and flats coming
 * down, its tonic as the scale names it.
 */
export function scaleNotes(
  scale: Scale,
  from: number,
  octaves: number,
  first: 'up' | 'down' = 'up',
): ScaleNote[] {
  const run = (base: number, direction: 'up' | 'down'): ScaleNote[] => {
    const out: ScaleNote[] = [];
    const n = scaleLength(scale.kind);
    for (let i = 0; i <= n * octaves; i++) {
      const octave = Math.floor(i / n);
      const degree = i % n;
      out.push({ ...noteAt(base, octave, degree, direction), degree, direction });
    }
    return out;
  };
  const noteAt = (base: number, octave: number, degree: number, direction: 'up' | 'down') => {
    if (scale.kind === 'chromatic') {
      const midi = base + 12 * octave + degree;
      if (degree === 0) return spellAt(scale.tonic, base, 12 * octave, 7 * octave);
      return chromaticName(midi, direction === 'up');
    }
    const steps = (direction === 'down' ? DOWN_STEPS[scale.kind] : undefined) ?? STEPS[scale.kind];
    const [semis, letters] = steps[degree] ?? [0, 0];
    const note = spellAt(scale.tonic, base, semis + 12 * octave, letters + 7 * octave);
    // A blue note that would need a double flat (E♭ blues: B𝄫) is the raised fourth instead (A).
    if (scale.kind === 'blues' && note.alter <= -2)
      return spellAt(scale.tonic, base, semis + 12 * octave, letters - 1 + 7 * octave);
    return note;
  };
  if (first === 'up') {
    const up = run(from, 'up');
    const down = run(from, 'down').reverse().slice(1);
    return [...up, ...down];
  }
  const bottom = from - 12 * octaves;
  const down = run(bottom, 'down').reverse();
  const up = run(bottom, 'up').slice(1);
  return [...down, ...up];
}

/** A short key for a scale, as the statistics and `focus` count scales: "3.harmonic-minor". */
export const scaleKind = (scale: Scale): string => `${pitchClassOf(scale.tonic)}.${scale.kind}`;

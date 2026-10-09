// Sight-reading drills (P5-05, ADR 0015): short pieces generated here, written as MusicXML so the
// same text draws the score (Verovio) and becomes the `Song` (parseMusicXml). Notes stay in the key, one at a
// time, a quarter each, so a drill tests reading pitches, not rhythm. Generated material has no
// author but this code, so it is CC0 by construction. Seeded, so a drill can be played again.

export type DrillClef = 'treble' | 'bass' | 'both';
export type DrillKind = 'notes' | 'phrases';

export interface DrillOptions {
  clef: DrillClef;
  /** Key signature: sharps (positive) or flats (negative), -3 to 3. */
  fifths: number;
  /** 1: around middle C; 2: the whole staff; 3: ledger lines too. */
  level: 1 | 2 | 3;
  kind: DrillKind;
  /** Bars of 4/4, four notes each. */
  bars: number;
  seed: number;
}

export const DRILL_DEFAULTS: Readonly<DrillOptions> = Object.freeze({
  clef: 'treble',
  fifths: 0,
  level: 1,
  kind: 'notes',
  bars: 8,
  seed: 1,
});

/** The tonic's letter for the key signatures a drill offers. */
const TONICS: Record<number, string> = {
  [-3]: 'E',
  [-2]: 'B',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
};
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B, as letter indices
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

/** Lowest and highest staff step (octave × 7 + letter) for each clef and level. */
const RANGES: Record<'treble' | 'bass', Record<1 | 2 | 3, [number, number]>> = {
  // C4–G4 (middle C position), C4–G5 (the staff and middle C), A3–C6 (ledger lines).
  treble: { 1: [28, 32], 2: [28, 39], 3: [26, 42] },
  // F3–C4, E2–C4, C2–E4.
  bass: { 1: [24, 28], 2: [16, 28], 3: [14, 30] },
};

export interface DrillNote {
  /** Staff step: octave × 7 + letter index (C4 is 28). */
  step: number;
  /** MIDI pitch, with the key signature applied. */
  pitch: number;
  clef: 'treble' | 'bass';
}

export interface Drill {
  options: DrillOptions;
  notes: DrillNote[];
  musicxml: string;
}

/** A small, fast, seeded generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Options from anything, kept to what a drill can do. */
export function normaliseDrillOptions(
  value: Partial<Record<keyof DrillOptions, unknown>>,
): DrillOptions {
  const d = DRILL_DEFAULTS;
  const int = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  return {
    clef: value.clef === 'bass' || value.clef === 'both' ? value.clef : 'treble',
    fifths: int(value.fifths, -3, 3, d.fifths),
    level: int(value.level, 1, 3, d.level) as 1 | 2 | 3,
    kind: value.kind === 'phrases' ? 'phrases' : 'notes',
    bars: int(value.bars, 1, 32, d.bars),
    seed: int(value.seed, 0, 2 ** 31 - 1, d.seed),
  };
}

/** The accidental the key signature puts on a letter: +1, -1 or 0. */
function keyAccidental(letter: number, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

export function stepPitch(step: number, fifths: number): number {
  const letter = ((step % 7) + 7) % 7;
  const octave = Math.floor(step / 7);
  return (octave + 1) * 12 + (NATURAL[letter] ?? 0) + keyAccidental(letter, fifths);
}

/** The step as MusicXML writes a pitch: letter, octave and the key signature's alteration. */
export function stepXml(
  step: number,
  fifths: number,
): { step: string; octave: number; alter: number } {
  const letter = ((step % 7) + 7) % 7;
  return {
    step: LETTERS[letter] ?? 'C',
    octave: Math.floor(step / 7),
    alter: keyAccidental(letter, fifths),
  };
}

/** The tonic's step nearest the middle of a range, for phrases to start and end on. */
function tonicNear(lo: number, hi: number, fifths: number): number {
  const tonicLetter = LETTERS.indexOf(TONICS[fifths] ?? 'C');
  const mid = (lo + hi) / 2;
  let best = lo;
  for (let s = lo; s <= hi; s++) {
    if (((s % 7) + 7) % 7 !== tonicLetter) continue;
    if (Math.abs(s - mid) < Math.abs(best - mid) || ((best % 7) + 7) % 7 !== tonicLetter) best = s;
  }
  return best;
}

function pickNotes(o: DrillOptions, rand: () => number): DrillNote[] {
  const count = o.bars * 4;
  const clefFor = (): 'treble' | 'bass' =>
    o.clef === 'both' ? (rand() < 0.5 ? 'treble' : 'bass') : o.clef === 'bass' ? 'bass' : 'treble';
  const notes: DrillNote[] = [];
  let previous: { step: number; clef: 'treble' | 'bass' } | null = null;
  for (let i = 0; i < count; i++) {
    const clef: 'treble' | 'bass' =
      o.kind === 'phrases' && previous && i % 8 !== 0 ? previous.clef : clefFor();
    const [lo, hi] = RANGES[clef][o.level];
    let step: number;
    if (o.kind === 'phrases' && (i % 8 === 0 || i % 8 === 7)) {
      // Each two-bar phrase starts and ends on the tonic.
      step = tonicNear(lo, hi, o.fifths);
    } else if (o.kind === 'phrases' && previous && previous.clef === clef) {
      // Mostly steps, some skips, now and then a leap of a fourth; never outside the range.
      const r = rand();
      const wanted = r < 0.65 ? 1 : r < 0.9 ? 2 : 3;
      const from = previous.step;
      const fits = (size: number) => [from + size, from - size].filter((s) => s >= lo && s <= hi);
      const choices = fits(wanted).length > 0 ? fits(wanted) : fits(1);
      step = choices[Math.floor(rand() * choices.length)] ?? from;
    } else {
      // Single notes: any step in the range, but not the same note twice in a row.
      do {
        step = lo + Math.floor(rand() * (hi - lo + 1));
      } while (previous && previous.clef === clef && previous.step === step && hi > lo);
    }
    notes.push({ step, pitch: stepPitch(step, o.fifths), clef });
    previous = { step, clef };
  }
  return notes;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clefXml = (number: number, clef: 'treble' | 'bass') =>
  clef === 'treble'
    ? `<clef number="${number}"><sign>G</sign><line>2</line></clef>`
    : `<clef number="${number}"><sign>F</sign><line>4</line></clef>`;

/**
 * A drill: its notes and the MusicXML that draws them. `letters` writes a name under each note.
 * With both clefs, each beat has a note on one staff and a hidden rest on the other.
 */
export function generateDrill(options: DrillOptions, letters?: (pitch: number) => string): Drill {
  const o = normaliseDrillOptions(options);
  const notes = pickNotes(o, seededRandom(o.seed));
  const staves = o.clef === 'both' ? 2 : 1;
  const staffOf = (clef: 'treble' | 'bass') => (staves === 2 && clef === 'bass' ? 2 : 1);
  const noteXml = (n: DrillNote) => {
    const p = stepXml(n.step, o.fifths);
    const alter = p.alter ? `<alter>${p.alter}</alter>` : '';
    const lyric = letters
      ? `<lyric number="1"><syllabic>single</syllabic><text>${escapeXml(letters(n.pitch))}</text></lyric>`
      : '';
    const staff = staffOf(n.clef);
    return (
      `<note><pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch>` +
      `<duration>1</duration><voice>${staff}</voice><type>quarter</type>` +
      `<staff>${staff}</staff>${lyric}</note>`
    );
  };
  const restXml = (staff: number) =>
    `<note print-object="no"><rest/><duration>1</duration><voice>${staff}</voice>` +
    `<type>quarter</type><staff>${staff}</staff></note>`;
  const measures: string[] = [];
  for (let b = 0; b < o.bars; b++) {
    const bar = notes.slice(b * 4, b * 4 + 4);
    let body = '';
    if (b === 0) {
      const clefs =
        o.clef === 'both'
          ? clefXml(1, 'treble') + clefXml(2, 'bass')
          : clefXml(1, o.clef === 'bass' ? 'bass' : 'treble');
      body +=
        `<attributes><divisions>1</divisions><key><fifths>${o.fifths}</fifths></key>` +
        '<time><beats>4</beats><beat-type>4</beat-type></time>' +
        (staves === 2 ? '<staves>2</staves>' : '') +
        `${clefs}</attributes>` +
        '<direction placement="above"><direction-type><words/></direction-type>' +
        '<sound tempo="60"/></direction>';
    }
    for (let staff = 1; staff <= staves; staff++) {
      if (staff === 2) body += '<backup><duration>4</duration></backup>';
      for (const n of bar) body += staffOf(n.clef) === staff ? noteXml(n) : restXml(staff);
    }
    const end =
      b === o.bars - 1
        ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
        : '';
    measures.push(`<measure number="${b + 1}">${body}${end}</measure>`);
  }
  const musicxml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name print-object="no">Piano</part-name>' +
    `</score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>\n`;
  return { options: o, notes, musicxml };
}

/** Drill options as a short id for a link: "treble.0.1.notes.8.12345". */
export function drillId(o: DrillOptions): string {
  return [o.clef, o.fifths, o.level, o.kind, o.bars, o.seed].join('.');
}

export function parseDrillId(id: string): DrillOptions {
  const [clef, fifths, level, kind, bars, seed] = id.split('.');
  return normaliseDrillOptions({ clef, fifths, level, kind, bars, seed });
}

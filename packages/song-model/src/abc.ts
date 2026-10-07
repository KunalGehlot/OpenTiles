// ABC notation (standard 2.1) → Song. ABC is plain text, so this parser needs no DOM.
//
// Supported: the first tune of a file; header fields X T C M L Q K V P; notes with accidentals
// (^ ^^ _ __ =) that last to the end of the bar, octave marks (' ,), lengths (A2 A/2 A3/2 A/
// A//), broken rhythm (> < >> <<), rests (z x, whole-bar Z X), bar lines and repeats (| || |] [|
// |: :| :: |1 :|2 [1 [2), chords ([CEG], with per-note lengths and ties), ties (-), tuplets ((3abc
// and (p:q:r), several voices (V:), voice overlay (&), inline fields ([K:] [M:] [L:] [Q:] [V:]),
// clef/octave/transpose voice options and fingering decorations (!1! … !5!). Grace notes, other
// decorations, chord symbols, annotations, slurs and lyrics are skipped.
//
// Repeats go through the shared builder, so they are unrolled exactly like MusicXML repeats.
import { assembleSong, parseEndingNumbers, rawMeasure } from './builder';
import type { RawMeasure, RawNote, RawPart } from './builder';
import { ImportError } from './errors';
import { stepToMidi } from './pitch';
import type { Hand, Song } from './types';

export interface AbcOptions {
  /** Title used when the tune has no T: field (usually the file name). */
  fallbackTitle?: string;
}

const EPS = 1e-9;

interface Meter {
  numerator: number;
  denominator: number;
}

interface Key {
  fifths: number;
  mode?: 'major' | 'minor';
  /** Alteration in semitones per upper-case note letter, from the key and its extra accidentals. */
  accidentals: Map<string, number>;
}

/** Voice options that can be set on V: and K: fields. */
interface VoiceOptions {
  clef?: string;
  octave?: number;
  transpose?: number;
}

interface Voice {
  id: string;
  /** Order of first appearance; voice 0 is the top voice. */
  ordinal: number;
  /** Clef sign (`G`, `F`, `C`) when the file names one. */
  clef?: string;
  octave: number;
  transpose: number;
  meter?: Meter;
  /** Length of the unit note (L:) in quarter-note beats. */
  unitBeats: number;
  key: Key;
  /** Source measure the voice is writing into. */
  measure: number;
  /** Position in the current measure, in beats. */
  pos: number;
  /** Furthest position reached by an earlier `&` overlay in this measure. */
  overlayEnd: number;
  /** Explicit accidentals in the current bar, by note letter and octave (`F4`). */
  barAccidentals: Map<string, number>;
  /** Notes tied into the next event, by note letter and octave → pitch. */
  ties: Map<string, number>;
  tuplet?: { left: number; factor: number };
  /** Duration factor for the next event from a broken rhythm (`>`/`<`). */
  broken: number;
  /** The previous event, which a following `>`/`<` lengthens or shortens. */
  last?: { notes: RawNote[]; dur: number };
  /** Inside a first/second ending that has not been closed yet. */
  inEnding: boolean;
  /** Created only because music came before any V: field. */
  implicit?: boolean;
  /** Has written music. */
  used?: boolean;
  /** Fingering decoration waiting for the next note. */
  fingering?: number;
}

/** Header values every new voice starts from. */
interface Defaults {
  meter?: Meter;
  unitBeats: number;
  key: Key;
  options: VoiceOptions;
}

interface Tune {
  measures: RawMeasure[];
  /** Notes written so far per measure, for source references. */
  noteCounts: number[];
  voices: Map<string, Voice>;
  current: Voice;
  defaults: Defaults;
}

interface ParsedNote {
  letter: string;
  /** Explicit accidental in semitones, if any (`=` is 0). */
  accidental?: number;
  octave: number;
  mult: number;
  tie: boolean;
  fingering?: number;
}

// --- Text helpers -------------------------------------------------------------------------------

const COMBINING: Record<string, string> = {
  '`': '\u0300',
  "'": '\u0301',
  '^': '\u0302',
  '~': '\u0303',
  '=': '\u0304',
  u: '\u0306',
  '.': '\u0307',
  '"': '\u0308',
  o: '\u030A',
  H: '\u030B',
  v: '\u030C',
  c: '\u0327',
  ';': '\u0328',
};
const LIGATURES: Record<string, string> = {
  ss: 'ß',
  AE: 'Æ',
  ae: 'æ',
  OE: 'Œ',
  oe: 'œ',
  AA: 'Å',
  aa: 'å',
  '/O': 'Ø',
  '/o': 'ø',
};

/** Decodes ABC text escapes (`\'e` → é, `\ss` → ß, `\u00e9`, `&amp;`) in titles and names. */
export function decodeAbcText(raw: string): string {
  let out = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  out = out.replace(/\\(ss|AE|ae|OE|oe|AA|aa|\/O|\/o)/g, (_, l: string) => LIGATURES[l] ?? l);
  out = out.replace(/\\([`'^~=u."oHvc;])([A-Za-z])/g, (whole, mark: string, letter: string) => {
    const combining = COMBINING[mark];
    return combining ? `${letter}${combining}`.normalize('NFC') : whole;
  });
  out = out
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return out.trim();
}

/** Removes a `%` comment (an escaped `\%` is kept). */
function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%' && line[i - 1] !== '\\') return line.slice(0, i);
  }
  return line;
}

// --- Field parsers ------------------------------------------------------------------------------

/** M: field. `undefined` means free meter. */
export function parseMeter(value: string): Meter | undefined {
  const v = value.trim();
  if (v === '' || /^none$/i.test(v)) return undefined;
  if (v === 'C') return { numerator: 4, denominator: 4 };
  if (v === 'C|') return { numerator: 2, denominator: 2 };
  const m = /^\(?([\d+\s]+)\)?\s*\/\s*(\d+)/.exec(v);
  if (!m) return undefined;
  const numerator = (m[1] ?? '')
    .split('+')
    .reduce((sum, part) => sum + (Number.parseInt(part.trim(), 10) || 0), 0);
  const denominator = Number.parseInt(m[2] ?? '', 10);
  if (!(numerator > 0) || !(denominator > 0)) return undefined;
  return { numerator, denominator };
}

/** L: field as quarter-note beats, e.g. `1/8` → 0.5. */
function parseUnitLength(value: string): number | undefined {
  const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?/.exec(value);
  if (!m) return undefined;
  const num = Number(m[1]);
  const den = m[2] ? Number(m[2]) : 1;
  if (!(num > 0) || !(den > 0)) return undefined;
  return (num / den) * 4;
}

/**
 * Q: field as quarter notes per minute. Accepts `1/4=120`, `3/8=60`, `1/4 1/8=80`,
 * `"Allegro" 1/4=120` and the old forms `C=120` and `120`, which count unit notes (L:).
 */
export function parseTempo(value: string, unitBeats: number): number | undefined {
  const v = value.replace(/"[^"]*"/g, ' ').trim();
  const full = /((?:\d+\s*\/\s*\d+\s*)+)=\s*(\d+(?:\.\d+)?)/.exec(v);
  if (full) {
    let beats = 0;
    for (const f of (full[1] ?? '').matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
      beats += (Number(f[1]) / Number(f[2])) * 4;
    }
    const perMinute = Number(full[2]);
    return beats > 0 && perMinute > 0 ? perMinute * beats : undefined;
  }
  const old = /^(?:C(\d*)\s*=\s*)?(\d+(?:\.\d+)?)$/.exec(v);
  if (old) {
    const mult = old[1] ? Number(old[1]) : 1;
    const perMinute = Number(old[2]);
    return perMinute > 0 ? perMinute * unitBeats * mult : undefined;
  }
  return undefined;
}

const TONIC_FIFTHS: Record<string, number> = { C: 0, D: 2, E: 4, F: -1, G: 1, A: 3, B: 5 };
const MODE_OFFSET: Record<string, number> = {
  maj: 0,
  ion: 0,
  min: -3,
  aeo: -3,
  mix: -1,
  dor: -2,
  phr: -4,
  lyd: 1,
  loc: -5,
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

function keyAccidentals(fifths: number): Map<string, number> {
  const map = new Map<string, number>();
  const n = Math.min(7, Math.abs(fifths));
  for (let i = 0; i < n; i++) {
    if (fifths > 0) map.set(SHARP_ORDER[i] as string, 1);
    else map.set(SHARP_ORDER[6 - i] as string, -1);
  }
  return map;
}

const CLEFS: Record<string, string> = {
  treble: 'G',
  g: 'G',
  bass: 'F',
  f: 'F',
  bass3: 'F',
  baritone: 'F',
  alto: 'C',
  tenor: 'C',
  c: 'C',
  alto1: 'C',
  alto2: 'C',
};

/** Reads `clef=`, `octave=` and `transpose=` options (and bare clef names) from field words. */
function parseVoiceOptions(words: string[]): VoiceOptions {
  const out: VoiceOptions = {};
  for (const word of words) {
    const [rawName, rawValue] = word.split('=');
    const name = (rawName ?? '').toLowerCase();
    const value = rawValue?.replace(/^"|"$/g, '');
    if (value === undefined) {
      const clef = CLEFS[name.replace(/[+-]8$/, '')];
      if (clef) out.clef = clef;
      continue;
    }
    if (name === 'clef') {
      const clef = CLEFS[value.toLowerCase().replace(/[+-]8$/, '')];
      if (clef) out.clef = clef;
    } else if (name === 'octave') {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) out.octave = n;
    } else if (name === 'transpose' || name === 't') {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) out.transpose = n;
    }
  }
  return out;
}

/** Splits a field value into words, keeping quoted strings together. */
function words(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

/** K: field. Returns the key (if the field names one) and any voice options it carries. */
export function parseKey(value: string): { key?: Key; options: VoiceOptions } {
  const parts = words(value.trim());
  const first = parts[0] ?? '';
  let rest = parts.slice(1);
  let key: Key | undefined;
  if (/^none$/i.test(first) || first === 'HP') {
    key = { fifths: 0, accidentals: new Map() };
  } else if (first === 'Hp') {
    key = {
      fifths: 2,
      mode: 'major',
      accidentals: new Map([
        ['F', 1],
        ['C', 1],
      ]),
    };
  } else {
    const m = /^([A-Ga-g])([#b]?)([A-Za-z]*)$/.exec(first);
    const attached = (m?.[3] ?? '').toLowerCase();
    if (m && (attached === '' || modeOf(attached))) {
      let modeWord = attached;
      if (modeWord === '' && rest[0] && modeOf(rest[0])) {
        modeWord = rest[0].toLowerCase();
        rest = rest.slice(1);
      }
      const mode = modeOf(modeWord);
      const letter = (m[1] ?? 'C').toUpperCase();
      let fifths = (TONIC_FIFTHS[letter] ?? 0) + (m[2] === '#' ? 7 : m[2] === 'b' ? -7 : 0);
      fifths += MODE_OFFSET[mode ?? 'maj'] ?? 0;
      if (fifths > 7) fifths -= 12;
      if (fifths < -7) fifths += 12;
      const modeName = mode === 'maj' || mode === 'ion' || mode === undefined ? 'major' : mode;
      key = {
        fifths,
        ...(modeName === 'major'
          ? { mode: 'major' as const }
          : modeName === 'min' || modeName === 'aeo'
            ? { mode: 'minor' as const }
            : {}),
        accidentals: keyAccidentals(fifths),
      };
    } else {
      // No tonic: the field only carries options (`K: clef=bass`) or extra accidentals.
      rest = parts;
    }
  }
  // Explicit accidentals: `K:D exp ^f ^c` replaces the signature, `K:D ^g` adds to it.
  const explicit = rest.filter((w) => /^(\^\^|\^|__|_|=)[A-Ga-g]$/.test(w));
  if (explicit.length > 0) {
    const base: Key = key ?? { fifths: 0, accidentals: new Map() };
    const accidentals = rest.some((w) => /^exp$/i.test(w))
      ? new Map<string, number>()
      : new Map(base.accidentals);
    for (const w of explicit) {
      const letter = (w.at(-1) ?? 'C').toUpperCase();
      const acc = w.slice(0, -1);
      accidentals.set(
        letter,
        acc === '^^' ? 2 : acc === '^' ? 1 : acc === '__' ? -2 : acc === '_' ? -1 : 0,
      );
    }
    key = { ...base, accidentals };
  }
  return { ...(key ? { key } : {}), options: parseVoiceOptions(rest) };
}

function modeOf(word: string): string | undefined {
  const w = word.toLowerCase();
  if (w === 'm') return 'min';
  const prefix = w.slice(0, 3);
  return w.length >= 3 && prefix in MODE_OFFSET ? prefix : undefined;
}

// --- Tune structure -----------------------------------------------------------------------------

function measureAt(tune: Tune, index: number): RawMeasure {
  while (tune.measures.length <= index) {
    tune.measures.push(rawMeasure(''));
    tune.noteCounts.push(0);
  }
  return tune.measures[index] as RawMeasure;
}

function newVoice(
  voices: Map<string, Voice>,
  defaults: Defaults,
  id: string,
  options: VoiceOptions,
): Voice {
  const merged = { ...defaults.options, ...options };
  const voice: Voice = {
    id,
    ordinal: voices.size,
    ...(merged.clef ? { clef: merged.clef } : {}),
    octave: merged.octave ?? 0,
    transpose: merged.transpose ?? 0,
    ...(defaults.meter ? { meter: defaults.meter } : {}),
    unitBeats: defaults.unitBeats,
    key: defaults.key,
    measure: 0,
    pos: 0,
    overlayEnd: 0,
    barAccidentals: new Map(),
    ties: new Map(),
    broken: 1,
    inEnding: false,
  };
  voices.set(id, voice);
  return voice;
}

function applyOptions(voice: Voice, options: VoiceOptions): void {
  if (options.clef) voice.clef = options.clef;
  if (options.octave !== undefined) voice.octave = options.octave;
  if (options.transpose !== undefined) voice.transpose = options.transpose;
}

function meterBeats(meter: Meter | undefined): number {
  return meter ? (meter.numerator * 4) / meter.denominator : 4;
}

function isCompound(meter: Meter | undefined): boolean {
  return !!meter && meter.denominator === 8 && meter.numerator % 3 === 0 && meter.numerator > 3;
}

interface BarKind {
  backward?: boolean;
  forward?: boolean;
  /** `||`, `|]` or `[|`: closes an open ending. */
  heavy?: boolean;
}

/** Ends the voice's current measure at a bar line and records the bar's repeat marks. */
function bar(tune: Tune, v: Voice, kind: BarKind = {}): void {
  const content = Math.max(v.pos, v.overlayEnd);
  let closed: number;
  if (content > EPS) {
    const m = measureAt(tune, v.measure);
    m.lengthBeats = Math.max(m.lengthBeats, content);
    closed = v.measure;
    v.measure += 1;
  } else {
    // A bar line right after another one: its marks belong to the bar already closed.
    closed = v.measure - 1;
  }
  v.pos = 0;
  v.overlayEnd = 0;
  v.barAccidentals.clear();
  v.broken = 1;
  v.last = undefined;
  const prev = closed >= 0 ? measureAt(tune, closed) : undefined;
  if (prev && kind.backward) prev.backwardRepeat = true;
  if ((kind.backward || kind.heavy || kind.forward) && v.inEnding) {
    if (prev) prev.endingStop = true;
    v.inEnding = false;
  }
  if (kind.forward) measureAt(tune, v.measure).forwardRepeat = true;
}

function startEnding(tune: Tune, v: Voice, numbers: number[]): void {
  if (numbers.length === 0) return;
  if (v.inEnding && v.measure > 0 && v.pos <= EPS) measureAt(tune, v.measure - 1).endingStop = true;
  measureAt(tune, v.measure).endingStart = numbers;
  v.inEnding = true;
}

function setKey(tune: Tune, v: Voice, key: Key): void {
  v.key = key;
  if (v.ordinal === 0) {
    measureAt(tune, v.measure).key = {
      fifths: key.fifths,
      ...(key.mode ? { mode: key.mode } : {}),
    };
  }
}

function setMeter(tune: Tune, v: Voice, meter: Meter | undefined): void {
  if (meter) {
    v.meter = meter;
    measureAt(tune, v.measure).time = { ...meter };
  } else {
    delete v.meter;
  }
}

function setTempo(tune: Tune, v: Voice, bpm: number | undefined): void {
  if (bpm !== undefined) measureAt(tune, v.measure).tempos.push({ posBeats: v.pos, bpm });
}

/** Handles a field met in the tune body, either on its own line or inline (`[K:G]`). */
function bodyField(tune: Tune, letter: string, value: string): void {
  const v = tune.current;
  switch (letter) {
    case 'K': {
      const { key, options } = parseKey(value);
      if (key) setKey(tune, v, key);
      applyOptions(v, options);
      break;
    }
    case 'M':
      setMeter(tune, v, parseMeter(value));
      break;
    case 'L': {
      const unit = parseUnitLength(value);
      if (unit) v.unitBeats = unit;
      break;
    }
    case 'Q':
      setTempo(tune, v, parseTempo(value, v.unitBeats));
      break;
    case 'V': {
      const [id = '1', ...rest] = words(value.trim());
      const options = parseVoiceOptions(rest);
      const existing = tune.voices.get(id);
      if (existing) applyOptions(existing, options);
      // The unnamed voice the body started in is replaced by the first named one, unless it holds
      // music already.
      if (!existing && tune.current.implicit && !tune.current.used) {
        tune.voices.delete(tune.current.id);
      }
      tune.current = existing ?? newVoice(tune.voices, tune.defaults, id, options);
      break;
    }
    default:
      // P: part labels, T: section titles, w:/W: lyrics, I:, N:, R: … do not change the notes.
      break;
  }
}

// --- Music --------------------------------------------------------------------------------------

/** Reads a note length suffix (`2`, `/2`, `3/2`, `/`, `//`) as a multiplier of the unit. */
function readLength(s: string, start: number): [number, number] {
  let i = start;
  let digits = '';
  while (i < s.length && /\d/.test(s[i] ?? '')) digits += s[i++];
  let num = digits ? Number(digits) : 1;
  let den = 1;
  while (s[i] === '/') {
    i += 1;
    let d = '';
    while (i < s.length && /\d/.test(s[i] ?? '')) d += s[i++];
    den *= d ? Number(d) : 2;
  }
  if (!Number.isFinite(num)) num = 1;
  return [den > 0 ? num / den : num, i];
}

/** Reads accidental, letter and octave marks, then length and tie. */
function readNote(s: string, start: number): [ParsedNote, number] | undefined {
  let i = start;
  let accidental: number | undefined;
  if (s[i] === '^') {
    accidental = s[i + 1] === '^' ? 2 : 1;
    i += s[i + 1] === '^' || s[i + 1] === '/' ? 2 : 1;
  } else if (s[i] === '_') {
    accidental = s[i + 1] === '_' ? -2 : -1;
    i += s[i + 1] === '_' || s[i + 1] === '/' ? 2 : 1;
  } else if (s[i] === '=') {
    accidental = 0;
    i += 1;
  }
  const letter = s[i];
  if (!letter || !/[A-Ga-g]/.test(letter)) return undefined;
  i += 1;
  let octave = letter === letter.toUpperCase() ? 4 : 5;
  while (s[i] === "'" || s[i] === ',') {
    octave += s[i] === "'" ? 1 : -1;
    i += 1;
  }
  const [mult, afterLength] = readLength(s, i);
  i = afterLength;
  const tie = s[i] === '-';
  if (tie) i += 1;
  return [
    {
      letter: letter.toUpperCase(),
      ...(accidental !== undefined ? { accidental } : {}),
      octave,
      mult,
      tie,
    },
    i,
  ];
}

/** Index after a `!…!` or `+…+` decoration, and its fingering if it is one. */
function readDecoration(s: string, start: number): [number | undefined, number] {
  const close = s.indexOf(s[start] as string, start + 1);
  if (close < 0) return [undefined, start + 1];
  const name = s.slice(start + 1, close);
  const finger = /^[1-5]$/.test(name) ? Number(name) : undefined;
  return [finger, close + 1];
}

/** Writes one note, chord or rest at the voice's position and advances it. */
function addEvent(tune: Tune, v: Voice, notes: ParsedNote[], restMult?: number): void {
  let factor = v.broken;
  v.broken = 1;
  if (v.tuplet) {
    factor *= v.tuplet.factor;
    v.tuplet.left -= 1;
    if (v.tuplet.left <= 0) delete v.tuplet;
  }
  const first = notes[0];
  const dur = (first ? first.mult : (restMult ?? 1)) * v.unitBeats * factor;
  if (!(dur > 0)) return;
  const m = measureAt(tune, v.measure);
  const written: RawNote[] = [];
  const ties = new Map<string, number>();
  for (const n of notes) {
    const noteDur = n.mult * v.unitBeats * factor;
    if (!(noteDur > 0)) continue;
    const id = `${n.letter}${n.octave}`;
    const tiedFrom = v.ties.get(id);
    let pitch: number | null;
    if (n.accidental === undefined && tiedFrom !== undefined) {
      // A tie carries its accidental across the bar line.
      pitch = tiedFrom;
    } else {
      if (n.accidental !== undefined) v.barAccidentals.set(id, n.accidental);
      const alter =
        n.accidental ?? v.barAccidentals.get(id) ?? v.key.accidentals.get(n.letter) ?? 0;
      pitch = stepToMidi(n.letter, alter, n.octave + v.octave);
      if (pitch !== null) pitch += v.transpose;
    }
    if (pitch === null || pitch < 0 || pitch > 127) continue;
    const index = tune.noteCounts[v.measure] ?? 0;
    tune.noteCounts[v.measure] = index + 1;
    const note: RawNote = {
      part: 0,
      pitch,
      posBeats: v.pos,
      durBeats: noteDur,
      staff: v.ordinal + 1,
      voice: v.ordinal + 1,
      tieStart: n.tie,
      tieStop: [...v.ties.values()].includes(pitch),
      ...(n.fingering !== undefined ? { fingering: n.fingering } : {}),
      ref: `p0-m${v.measure}-n${index}`,
    };
    m.notes.push(note);
    written.push(note);
    if (n.tie) ties.set(`${n.letter}${n.octave}`, pitch);
  }
  v.ties = ties;
  v.used = true;
  v.pos += dur;
  v.last = { notes: written, dur };
}

/** `>` / `<` after an event: lengthens one of the pair and shortens the other. */
function brokenRhythm(v: Voice, count: number, longFirst: boolean): void {
  const short = 1 / 2 ** count;
  const long = 2 - short;
  const prevFactor = longFirst ? long : short;
  v.broken = longFirst ? short : long;
  const last = v.last;
  if (!last) return;
  for (const n of last.notes) n.durBeats *= prevFactor;
  v.pos += last.dur * (prevFactor - 1);
  last.dur *= prevFactor;
  v.last = undefined;
}

/** Parses one line of music for the current voice. */
function musicLine(tune: Tune, line: string): void {
  const s = line;
  let i = 0;
  while (i < s.length) {
    const v = tune.current;
    const c = s[i] as string;

    // Notes.
    if (/[A-Ga-g^_=]/.test(c)) {
      const read = readNote(s, i);
      if (!read) {
        i += 1;
        continue;
      }
      const [note, next] = read;
      if (v.fingering !== undefined) note.fingering = v.fingering;
      delete v.fingering;
      addEvent(tune, v, [note]);
      i = next;
      continue;
    }

    switch (c) {
      case 'z':
      case 'x': {
        const [mult, next] = readLength(s, i + 1);
        addEvent(tune, v, [], mult);
        v.ties = new Map();
        i = next;
        continue;
      }
      case 'Z':
      case 'X': {
        let j = i + 1;
        let digits = '';
        while (/\d/.test(s[j] ?? '')) digits += s[j++];
        const bars = Math.max(1, Math.min(1000, digits ? Number(digits) : 1));
        const len = meterBeats(v.meter);
        for (let b = 0; b < bars; b++) {
          if (b > 0) bar(tune, v);
          v.pos += len;
        }
        v.used = true;
        v.ties = new Map();
        v.last = undefined;
        i = j;
        continue;
      }
      case '"': {
        const close = s.indexOf('"', i + 1);
        i = close < 0 ? s.length : close + 1;
        continue;
      }
      case '!':
      case '+': {
        const [finger, next] = readDecoration(s, i);
        if (finger !== undefined) v.fingering = finger;
        i = next;
        continue;
      }
      case '{': {
        // Grace notes take no time in the Song.
        const close = s.indexOf('}', i + 1);
        i = close < 0 ? s.length : close + 1;
        continue;
      }
      case '(': {
        const m = /^\((\d+)(?::(\d*))?(?::(\d*))?/.exec(s.slice(i));
        if (m) {
          const p = Number(m[1]);
          const defaultQ: Record<number, number> = { 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 };
          const q = m[2] ? Number(m[2]) : (defaultQ[p] ?? (isCompound(v.meter) ? 3 : 2));
          const r = m[3] ? Number(m[3]) : p;
          if (p > 0 && q > 0 && r > 0) v.tuplet = { left: r, factor: q / p };
          i += m[0].length;
        } else {
          i += 1; // slur
        }
        continue;
      }
      case '>':
      case '<': {
        let j = i;
        while (s[j] === c) j += 1;
        brokenRhythm(v, j - i, c === '>');
        i = j;
        continue;
      }
      case '&': {
        // Voice overlay: the following notes start again at the beginning of the bar.
        v.overlayEnd = Math.max(v.overlayEnd, v.pos);
        v.pos = 0;
        v.ties = new Map();
        v.last = undefined;
        i += 1;
        continue;
      }
      case '[': {
        const next = s[i + 1] ?? '';
        const field = /^\[([A-Za-z]):([^\]]*)\]/.exec(s.slice(i));
        if (field) {
          bodyField(tune, field[1] as string, field[2] ?? '');
          i += field[0].length;
          continue;
        }
        if (/\d/.test(next)) {
          const m = /^\[(\d+(?:[,-]\d+)*)/.exec(s.slice(i));
          startEnding(tune, v, parseEndingNumbers(m?.[1]));
          i += m ? m[0].length : 1;
          continue;
        }
        if (next === '|') {
          i = barLine(tune, s, i);
          continue;
        }
        i = chord(tune, s, i + 1);
        continue;
      }
      case '|':
      case ':':
        i = barLine(tune, s, i);
        continue;
      default:
        // Spaces, decorations (. ~ H–W h–w), slur ends, spacers and other layout marks.
        i += 1;
    }
  }
}

/** Parses `[CEG]2-` (the opening bracket is already consumed) and returns the index after it. */
function chord(tune: Tune, s: string, start: number): number {
  const v = tune.current;
  const notes: ParsedNote[] = [];
  let i = start;
  let fingering: number | undefined;
  while (i < s.length && s[i] !== ']') {
    const c = s[i] as string;
    if (c === '!' || c === '+') {
      const [finger, next] = readDecoration(s, i);
      if (finger !== undefined) fingering = finger;
      i = next;
      continue;
    }
    if (c === '"') {
      const close = s.indexOf('"', i + 1);
      i = close < 0 ? s.length : close + 1;
      continue;
    }
    const read = /[A-Ga-g^_=]/.test(c) ? readNote(s, i) : undefined;
    if (!read) {
      i += 1;
      continue;
    }
    const [note, next] = read;
    if (fingering !== undefined) note.fingering = fingering;
    fingering = undefined;
    notes.push(note);
    i = next;
  }
  i += 1; // ]
  const [mult, afterLength] = readLength(s, i);
  i = afterLength;
  const tieAll = s[i] === '-';
  if (tieAll) i += 1;
  for (const n of notes) {
    n.mult *= mult;
    if (tieAll) n.tie = true;
  }
  if (notes.length > 0) {
    if (v.fingering !== undefined && notes[0] && notes[0].fingering === undefined) {
      notes[0].fingering = v.fingering;
    }
    delete v.fingering;
    addEvent(tune, v, notes);
  }
  return i;
}

/** Parses a bar line (with repeat dots and ending numbers) and returns the index after it. */
function barLine(tune: Tune, s: string, start: number): number {
  const v = tune.current;
  let i = start;
  let run = '';
  while (i < s.length) {
    const c = s[i] as string;
    if (c === '|' || c === ':' || c === ']' || (c === '[' && s[i + 1] === '|')) {
      // `[` only belongs to the bar when another bar follows; `|[1` is an ending.
      if (c === ']' && !run.includes('|')) break;
      run += c;
      i += 1;
    } else break;
  }
  if (!run.includes('|') && run !== '::') {
    // A lone colon is not a bar line.
    return i > start ? i : start + 1;
  }
  const leading = /^:+/.exec(run)?.[0].length ?? 0;
  const trailing = /:+$/.exec(run)?.[0].length ?? 0;
  const both = run === '::';
  bar(tune, v, {
    backward: both || leading > 0,
    forward: both || trailing > 0,
    heavy: run.includes('||') || run.includes(']') || run.startsWith('['),
  });
  const ending = /^(\d+(?:[,-]\d+)*)/.exec(s.slice(i));
  if (ending) {
    startEnding(tune, v, parseEndingNumbers(ending[1]));
    i += ending[0].length;
  }
  return i;
}

// --- Entry point --------------------------------------------------------------------------------

const FIELD_LINE = /^([A-Za-z+]):(.*)$/;

/** Parses the first tune of an ABC file into a Song. */
export function parseAbc(text: string, options: AbcOptions = {}): Song {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const tuneStarts = lines.filter((l) => /^X:/.test(l)).length;
  let start = lines.findIndex((l) => /^X:/.test(l));
  if (start < 0) start = 0;
  if (!lines.some((l) => /^[XK]:/.test(l))) {
    throw new ImportError('This does not look like ABC notation (no X: or K: field).');
  }

  const warnings = new Set<string>();
  const titles: string[] = [];
  const composers: string[] = [];
  const headerVoices: { id: string; options: VoiceOptions }[] = [];
  let meter: Meter | undefined;
  let meterSeen = false;
  let unitBeats: number | undefined;
  let tempoField: string | undefined;
  let key: Key = { fifths: 0, mode: 'major', accidentals: new Map() };
  let keyOptions: VoiceOptions = {};

  // Header: from X: to K:.
  let i = start;
  let lastField = '';
  for (; i < lines.length; i++) {
    const line = stripComment(lines[i] ?? '').trimEnd();
    if (i > start && /^X:/.test(line)) break;
    if (line.trim() === '') continue;
    const field = FIELD_LINE.exec(line);
    if (!field) break; // music without a K: field: be lenient and start the body here.
    const [, letter = '', value = ''] = field;
    if (letter === '+') {
      // `+:` continues the previous field's text.
      const list = lastField === 'T' ? titles : lastField === 'C' ? composers : undefined;
      if (list && list.length > 0) list[list.length - 1] += ` ${decodeAbcText(value)}`;
      continue;
    }
    lastField = letter;
    if (letter === 'T') titles.push(decodeAbcText(value));
    else if (letter === 'C') composers.push(decodeAbcText(value));
    else if (letter === 'M') {
      meter = parseMeter(value);
      meterSeen = true;
    } else if (letter === 'L') unitBeats = parseUnitLength(value) ?? unitBeats;
    else if (letter === 'Q') tempoField = value;
    else if (letter === 'P' && value.replace(/[\s.]/g, '').length > 1) {
      warnings.add('The order of parts (P:) is not followed; the tune plays as written.');
    } else if (letter === 'V') {
      const [id = '1', ...rest] = words(value.trim());
      headerVoices.push({ id, options: parseVoiceOptions(rest) });
    } else if (letter === 'K') {
      const parsed = parseKey(value);
      if (parsed.key) key = parsed.key;
      keyOptions = parsed.options;
      i += 1;
      break;
    }
  }

  // Default unit length (ABC 2.1 §3.1.7): 1/16 for meters below 3/4, otherwise 1/8.
  if (unitBeats === undefined) {
    unitBeats = meter && meter.numerator / meter.denominator < 0.75 ? 0.25 : 0.5;
  }

  const defaults: Defaults = {
    ...(meter ? { meter } : {}),
    unitBeats,
    key,
    options: keyOptions,
  };
  const voices = new Map<string, Voice>();
  for (const hv of headerVoices) {
    if (!voices.has(hv.id)) newVoice(voices, defaults, hv.id, hv.options);
  }
  let firstVoice = voices.values().next().value;
  if (!firstVoice) {
    firstVoice = newVoice(voices, defaults, '1', {});
    firstVoice.implicit = true;
  }
  const tune: Tune = { measures: [], noteCounts: [], voices, current: firstVoice, defaults };

  const m0 = measureAt(tune, 0);
  if (meterSeen && meter) m0.time = { ...meter };
  m0.key = { fifths: key.fifths, ...(key.mode ? { mode: key.mode } : {}) };
  if (tempoField !== undefined) {
    const bpm = parseTempo(tempoField, unitBeats);
    if (bpm !== undefined) m0.tempos.push({ posBeats: 0, bpm });
  }

  // Body: until a blank line (end of tune) or the next X:.
  let pending = '';
  for (; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    if (/^X:/.test(rawLine)) break;
    if (rawLine.trim() === '') break;
    if (rawLine.startsWith('%')) continue;
    const line = stripComment(rawLine);
    const field = FIELD_LINE.exec(line);
    if (field && !/^[A-Ga-gxz]:[|:]/.test(line)) {
      bodyField(tune, field[1] as string, field[2] ?? '');
      continue;
    }
    // A trailing backslash continues the line; line breaks never change the music.
    pending += line.replace(/\\\s*$/, ' ');
    if (/\\\s*$/.test(line)) continue;
    musicLine(tune, pending);
    pending = '';
  }
  if (pending) musicLine(tune, pending);

  if (tuneStarts > 1) {
    warnings.add(`This file contains ${tuneStarts} tunes; only the first one was imported.`);
  }

  // Close what is still open at the end of the tune.
  for (const v of tune.voices.values()) {
    const content = Math.max(v.pos, v.overlayEnd);
    if (content > EPS) {
      const m = measureAt(tune, v.measure);
      m.lengthBeats = Math.max(m.lengthBeats, content);
    }
    if (v.inEnding) {
      const last = content > EPS ? v.measure : v.measure - 1;
      if (last >= 0) measureAt(tune, last).endingStop = true;
    }
  }
  while (tune.measures.length > 1) {
    const last = tune.measures[tune.measures.length - 1] as RawMeasure;
    if (last.lengthBeats > EPS || last.notes.length > 0) break;
    tune.measures.pop();
  }
  for (const m of tune.measures) if (m.lengthBeats <= EPS) m.lengthBeats = meterBeats(meter);

  // Bar numbers: a short first bar is a pickup, numbered 0.
  const first = tune.measures[0];
  const pickup =
    tune.measures.length > 1 && first !== undefined && first.lengthBeats < meterBeats(meter) - EPS;
  tune.measures.forEach((m, idx) => (m.number = String(pickup ? idx : idx + 1)));

  // Hands: a bass clef means the left hand, any other clef the right; without a clef the top
  // voice is the right hand and the voices below it the left.
  const hands = new Map<number, Hand>();
  const clefs = new Map<number, string>();
  for (const v of tune.voices.values()) {
    const hand: Hand = v.clef
      ? v.clef === 'F'
        ? 'left'
        : 'right'
      : v.ordinal === 0
        ? 'right'
        : 'left';
    hands.set(v.ordinal + 1, hand);
    if (v.clef) clefs.set(v.ordinal + 1, v.clef);
  }
  for (const m of tune.measures) {
    for (const n of m.notes) n.hand = hands.get(n.voice) ?? 'right';
  }
  const parts: RawPart[] = [{ name: 'Piano', staves: tune.voices.size, clefs }];

  return assembleSong({
    title: titles[0] || options.fallbackTitle || 'Untitled',
    ...(composers.length > 0 ? { composer: composers.join(', ') } : {}),
    format: 'abc',
    measures: tune.measures,
    parts,
    warnings,
  });
}

/** True when `text` looks like ABC notation (used to detect ABC files without an extension). */
export function looksLikeAbc(text: string): boolean {
  const head = text.replace(/^\uFEFF/, '').slice(0, 2000);
  return /^%abc/.test(head) || (/^X:/m.test(head) && /^K:/m.test(head));
}

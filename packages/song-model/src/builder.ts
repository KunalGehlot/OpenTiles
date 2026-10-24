// Shared Song assembly for notation importers (MusicXML, ABC, MuseScore).
//
// A notation importer only has to describe the source measures in reading order: their notes
// (positions relative to the measure), tempo, time and key changes, and repeat marks. This module
// unrolls the repeats into playback order, lays the measures out on the beat axis, merges ties,
// assigns hands and produces a sorted Song (spec §8, ADR 0003).
import { applyDynamics } from './dynamics';
import type { DynamicEvent, RawDynamic } from './dynamics';
import { tidyPedals } from './pedals';
import { DEFAULT_BPM } from './tempo';
import type {
  Hand,
  KeySignatureEvent,
  Measure,
  Part,
  PedalEvent,
  PedalKind,
  Song,
  SongFormat,
  SongNote,
  TempoEvent,
  TimeSignatureEvent,
} from './types';

export interface RawNote {
  /** 0-based index into `SongDraft.parts`. */
  part: number;
  /** MIDI pitch. */
  pitch: number;
  /** Quarter-note beats from the start of the source measure. */
  posBeats: number;
  durBeats: number;
  /** 1-based staff within the part. */
  staff: number;
  voice: number;
  /** The note is tied to the next note of the same pitch. */
  tieStart: boolean;
  /** The note continues a tie from the previous note of the same pitch. */
  tieStop: boolean;
  fingering?: number;
  /** Source glyph reference, `p{part}-m{sourceMeasure}-n{index}`. */
  ref: string;
  /** Set when the importer knows the hand (ABC voices); otherwise it comes from the layout. */
  hand?: Hand;
}

/** Repeat marks of one source measure, as `playbackOrder` reads them. */
export interface RepeatMarks {
  forwardRepeat: boolean;
  backwardRepeat: boolean;
  /** How often the section ending at a backward repeat is played (2 = once repeated). */
  repeatTimes: number;
  /** Ending (volta) numbers that start at this measure. */
  endingStart?: number[];
  /** The ending that contains this measure ends with it. */
  endingStop: boolean;
  /** A new section starts here (MuseScore section break): repeats go back no further. */
  sectionStart?: boolean;
}

export interface RawMeasure extends RepeatMarks {
  /** Bar number as printed. */
  number: string;
  lengthBeats: number;
  notes: RawNote[];
  tempos: { posBeats: number; bpm: number }[];
  /** Pedal marks and pedal sounds in the measure (P6-10). */
  pedals: { posBeats: number; pedal: PedalKind; value: number }[];
  /** Dynamics marks and hairpins in the measure (P6-16). */
  dynamics?: RawDynamic[];
  time?: { numerator: number; denominator: number };
  key?: { fifths: number; mode?: 'major' | 'minor' };
}

export interface RawPart {
  name: string;
  /** Number of staves (2 for a piano grand staff). */
  staves: number;
  /** First clef sign per staff (`G`, `F`, `C`, …). */
  clefs: Map<number, string>;
}

export interface SongDraft {
  title: string;
  composer?: string;
  format: SongFormat;
  /** Source measures in reading order (before repeats are unrolled). */
  measures: RawMeasure[];
  parts: RawPart[];
  warnings: Set<string>;
  /** How repeats are read; see `PlaybackOptions`. */
  repeatFrom?: PlaybackOptions['repeatFrom'];
}

/** An empty source measure with no repeat marks. */
export function rawMeasure(number: string): RawMeasure {
  return {
    number,
    lengthBeats: 0,
    notes: [],
    tempos: [],
    pedals: [],
    dynamics: [],
    forwardRepeat: false,
    backwardRepeat: false,
    repeatTimes: 2,
    endingStop: false,
  };
}

/** Parses ending numbers such as "1", "1, 2" or "1-3". */
export function parseEndingNumbers(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(/[,\s]+/)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let n = from; n <= to && n - from < 32; n++) out.push(n);
      continue;
    }
    const n = Number.parseInt(part, 10);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

export interface PlaybackOptions {
  /**
   * Where a backward repeat jumps to once an earlier repeated section has been played and no new
   * forward repeat follows it. `afterPreviousRepeat` (default; the MusicXML and ABC convention)
   * starts again after that section; `lastForwardRepeat` (MuseScore) goes back to the most recent
   * forward repeat, or to the start of the section.
   */
  repeatFrom?: 'afterPreviousRepeat' | 'lastForwardRepeat';
}

/**
 * Playback order of source measures with repeats and numbered endings (voltas) unrolled.
 *
 * Every backward repeat keeps its own count, so a repeat inside a longer repeated section is not
 * played again on the second pass. Inside an ending, a backward repeat jumps once for each ending
 * number it carries (an ending "1, 2" repeats twice), or as often as its repeat count says.
 */
export function playbackOrder(
  measures: readonly RepeatMarks[],
  options: PlaybackOptions = {},
): number[] {
  const keepStart = options.repeatFrom === 'lastForwardRepeat';
  // Which ending numbers each measure belongs to (from an ending start through its stop).
  const endings: (number[] | undefined)[] = [];
  let open: number[] | undefined;
  measures.forEach((m, i) => {
    if (m.sectionStart) open = undefined;
    if (m.endingStart && m.endingStart.length > 0) open = m.endingStart;
    endings[i] = open;
    if (m.endingStop) open = undefined;
  });

  const order: number[] = [];
  const jumps = measures.map(() => 0);
  const limit = measures.length * 16 + 16;
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  while (i < measures.length && order.length < limit) {
    const m = measures[i];
    if (!m) break;
    if ((m.forwardRepeat || m.sectionStart) && !jumped) {
      repeatStart = i;
      pass = 1;
    }
    jumped = false;
    const inEnding = endings[i];
    if (inEnding && !inEnding.includes(pass)) {
      i += 1;
      continue;
    }
    order.push(i);
    if (m.backwardRepeat) {
      const allowed = Math.max(m.repeatTimes - 1, inEnding ? inEnding.length : 0);
      if ((jumps[i] ?? 0) < allowed) {
        jumps[i] = (jumps[i] ?? 0) + 1;
        pass += 1;
        i = repeatStart;
        jumped = true;
        continue;
      }
      if (!keepStart || inEnding) {
        pass = 1;
        repeatStart = i + 1;
      }
    } else if (inEnding && m.endingStop && !measures[i + 1]?.endingStart?.length) {
      // Last ending of a repeated section: the section is done.
      pass = 1;
      repeatStart = i + 1;
    }
    i += 1;
  }
  return order;
}

interface Draft extends Omit<SongNote, 'id' | 'hand'> {
  tieStart: boolean;
  tieStop: boolean;
  hand?: Hand;
}

/** Turns source measures into a Song: repeats unrolled, ties merged, hands assigned. */
export function assembleSong(input: SongDraft): Song {
  const order = playbackOrder(
    input.measures,
    input.repeatFrom ? { repeatFrom: input.repeatFrom } : {},
  );
  const measures: Measure[] = [];
  const tempos: TempoEvent[] = [];
  const pedals: PedalEvent[] = [];
  const dynamics: DynamicEvent[] = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  const keySignatures: KeySignatureEvent[] = [];
  const drafts: Draft[] = [];
  let beat = 0;
  let lastTime: string | undefined;
  let lastKey: string | undefined;

  order.forEach((src, index) => {
    const raw = input.measures[src];
    if (!raw) return;
    measures.push({
      index,
      number: raw.number,
      sourceIndex: src,
      startBeat: beat,
      lengthBeats: raw.lengthBeats,
    });
    if (raw.time) {
      const key = `${raw.time.numerator}/${raw.time.denominator}`;
      if (key !== lastTime) {
        timeSignatures.push({ beat, ...raw.time });
        lastTime = key;
      }
    }
    if (raw.key) {
      const key = `${raw.key.fifths}${raw.key.mode ?? ''}`;
      if (key !== lastKey) {
        keySignatures.push({ beat, ...raw.key });
        lastKey = key;
      }
    }
    for (const t of raw.tempos) {
      const prev = tempos[tempos.length - 1];
      if (!prev || prev.bpm !== t.bpm) tempos.push({ beat: beat + t.posBeats, bpm: t.bpm });
    }
    // A repeated measure repeats its pedalling too.
    for (const p of raw.pedals ?? []) {
      pedals.push({ beat: beat + p.posBeats, pedal: p.pedal, value: p.value });
    }
    for (const { posBeats, ...d } of raw.dynamics ?? [])
      dynamics.push({ ...d, beat: beat + posBeats });
    for (const n of raw.notes) {
      drafts.push({
        pitch: n.pitch,
        startBeat: beat + n.posBeats,
        durationBeats: n.durBeats,
        staff: n.staff,
        voice: n.voice,
        part: n.part,
        measureIndex: index,
        ...(n.fingering !== undefined ? { fingering: n.fingering } : {}),
        sourceRefs: [n.ref],
        tieStart: n.tieStart,
        tieStop: n.tieStop,
        ...(n.hand ? { hand: n.hand } : {}),
      });
    }
    beat += raw.lengthBeats;
  });

  if (tempos.length === 0 || (tempos[0]?.beat ?? 0) > 1e-9) {
    if (tempos.length === 0) {
      input.warnings.add(
        `This score has no tempo marking; ${DEFAULT_BPM} beats per minute is assumed.`,
      );
    }
    tempos.unshift({ beat: 0, bpm: tempos[0]?.bpm ?? DEFAULT_BPM });
  }

  const pedalled = tidyPedals(pedals);
  const merged = mergeTies(drafts);
  applyDynamics(merged, dynamics);
  const hands = handAssigner(input.parts, merged);
  const notes: SongNote[] = merged
    .map(({ tieStart: _a, tieStop: _b, hand, ...n }) => ({
      ...n,
      id: '',
      hand: hand ?? hands(n),
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  notes.forEach((n, i) => (n.id = `n${i}`));

  if (notes.length === 0) input.warnings.add('This score contains no notes to play.');

  return {
    title: input.title,
    ...(input.composer ? { composer: input.composer } : {}),
    format: input.format,
    notes,
    measures,
    tempos,
    timeSignatures,
    keySignatures,
    parts: input.parts.map((p): Part => ({ name: p.name })),
    lengthBeats: beat,
    ...(pedalled.length > 0 ? { pedals: pedalled } : {}),
    warnings: [...input.warnings],
  };
}

/** Merges tied notes (same part and pitch, contiguous) into single notes. */
function mergeTies(drafts: Draft[]): Draft[] {
  // At equal positions a tie continuation sorts first, so an unrelated note of the same pitch in
  // another voice cannot cut the tie off.
  const sorted = [...drafts].sort(
    (a, b) =>
      a.startBeat - b.startBeat || a.pitch - b.pitch || Number(b.tieStop) - Number(a.tieStop),
  );
  const open = new Map<string, Draft>();
  const out: Draft[] = [];
  for (const n of sorted) {
    const key = `${n.part}:${n.pitch}`;
    const o = open.get(key);
    if (n.tieStop && o && Math.abs(o.startBeat + o.durationBeats - n.startBeat) < 1e-3) {
      o.durationBeats += n.durationBeats;
      o.sourceRefs.push(...n.sourceRefs);
      if (!n.tieStart) open.delete(key);
      continue;
    }
    out.push(n);
    if (n.tieStart) open.set(key, n);
    else open.delete(key);
  }
  return out;
}

/**
 * Hands from the score's layout: on a grand staff the upper staff is the right hand; separate
 * single-staff parts are split by average pitch; otherwise a bass clef means the left hand.
 */
function handAssigner(
  parts: RawPart[],
  notes: Draft[],
): (n: { part: number; staff: number }) => Hand {
  const singleStaffParts = parts.length >= 2 && parts.every((p) => p.staves < 2);
  let leftPart = -1;
  if (singleStaffParts) {
    let lowest = Infinity;
    parts.forEach((_, i) => {
      const own = notes.filter((n) => n.part === i);
      if (own.length === 0) return;
      const avg = own.reduce((s, n) => s + n.pitch, 0) / own.length;
      if (avg < lowest) {
        lowest = avg;
        leftPart = i;
      }
    });
  }
  return (n) => {
    const part = parts[n.part];
    if (!part) return 'right';
    if (part.staves >= 2) return n.staff >= 2 ? 'left' : 'right';
    if (singleStaffParts) return n.part === leftPart ? 'left' : 'right';
    return part.clefs.get(n.staff) === 'F' ? 'left' : 'right';
  };
}

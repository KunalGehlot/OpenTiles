// The internal Song model (spec §8, ADR 0003). Every importer produces a Song; the practice
// engine and the views only know this format.
//
// Musical time is in quarter-note beats from the start of the piece, with repeats unrolled into
// playback order. Seconds come only from the tempo map (see tempo.ts).

export type Hand = 'left' | 'right';

/** `audio`: approximate notes transcribed from a recording (P4-02). */
export type SongFormat = 'musicxml' | 'mxl' | 'midi' | 'audio';

export interface SongNote {
  /** Stable within the song: `n0`, `n1`, … in sorted order. */
  id: string;
  /** MIDI pitch (C4 = 60). */
  pitch: number;
  startBeat: number;
  /** Always > 0. Tied notes are merged into one note. */
  durationBeats: number;
  hand: Hand;
  /** 1-based staff within its part. */
  staff: number;
  voice: number;
  /** 0-based index into `Song.parts`. */
  part: number;
  /** Index into `Song.measures` (playback order). */
  measureIndex: number;
  /** 1–127, when the source has it (MIDI). */
  velocity?: number;
  /** 1–5, from the score's fingering marks. */
  fingering?: number;
  /**
   * References to the source glyphs this note came from (more than one for ties), as
   * `p{part}-m{sourceMeasure}-n{noteIndexInMeasure}`. The score view links these to rendered
   * glyphs.
   */
  sourceRefs: string[];
}

export interface TempoEvent {
  beat: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface TimeSignatureEvent {
  beat: number;
  numerator: number;
  denominator: number;
}

export interface KeySignatureEvent {
  beat: number;
  /** Sharps (positive) or flats (negative). */
  fifths: number;
  mode?: 'major' | 'minor';
}

export interface Measure {
  /** Position in playback order. */
  index: number;
  /** The bar number printed in the score. */
  number: string;
  /** Index of the measure in the source file (repeats share it). */
  sourceIndex: number;
  startBeat: number;
  lengthBeats: number;
}

export interface Part {
  name: string;
}

export interface Song {
  title: string;
  composer?: string;
  format: SongFormat;
  /** Sorted by `startBeat`, then `pitch`. */
  notes: SongNote[];
  measures: Measure[];
  /** Sorted by beat; the first is at beat 0. */
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  keySignatures: KeySignatureEvent[];
  parts: Part[];
  lengthBeats: number;
  /** Non-fatal import issues to show on the import review screen. */
  warnings: string[];
}

/** Beats closer than this are treated as equal (floating-point positions). */
export const BEAT_EPSILON = 1e-6;

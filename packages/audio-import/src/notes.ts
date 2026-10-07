// Post-processing of transcribed notes and conversion to a Song. Pure: no tfjs, DOM or Web
// Audio, so it runs in Node tests and loads without the model.
import {
  PIANO_HIGH,
  PIANO_LOW,
  measureIndexAt,
  measuresFromTimeSignatures,
  splitHands,
} from '@opentiles/song-model';
import type { Song, SongNote, TimeSignatureEvent } from '@opentiles/song-model';

/** One note heard in the recording, in seconds from its start. */
export interface AudioNote {
  /** MIDI pitch (C4 = 60). */
  pitch: number;
  startSeconds: number;
  durationSeconds: number;
  /** Model confidence / loudness, 0–1. */
  amplitude: number;
}

export interface CleanOptions {
  /** Notes shorter than this (after merging) are dropped as model noise. Default 0.06 s. */
  minDurationSeconds?: number;
  /**
   * Two notes of the same pitch separated by less than this are merged into one. Basic Pitch
   * sometimes splits a held note where its loudness dips; a re-struck note on a piano leaves a
   * longer gap than this. Default 0.03 s (under three model frames).
   */
  mergeGapSeconds?: number;
  /** Notes outside this range are dropped. Default: the 88 piano keys. */
  lowPitch?: number;
  highPitch?: number;
  /** Notes quieter than this are dropped. Default 0 (keep all). */
  minAmplitude?: number;
}

export const DEFAULT_CLEAN_OPTIONS: Required<CleanOptions> = {
  minDurationSeconds: 0.06,
  mergeGapSeconds: 0.03,
  lowPitch: PIANO_LOW,
  highPitch: PIANO_HIGH,
  minAmplitude: 0,
};

/**
 * Tidies raw model output: drops invalid and out-of-range notes, merges fragments of the same
 * pitch, then drops notes that are still too short. Returns notes sorted by start, then pitch.
 * Applying it twice gives the same result as applying it once.
 */
export function cleanNotes(notes: readonly AudioNote[], options: CleanOptions = {}): AudioNote[] {
  const o = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  const valid = notes
    .filter(
      (n) =>
        Number.isFinite(n.pitch) &&
        Number.isFinite(n.startSeconds) &&
        Number.isFinite(n.durationSeconds) &&
        n.durationSeconds > 0 &&
        Math.round(n.pitch) >= o.lowPitch &&
        Math.round(n.pitch) <= o.highPitch &&
        (Number.isFinite(n.amplitude) ? n.amplitude : 0) >= o.minAmplitude,
    )
    .map((n) => ({
      pitch: Math.round(n.pitch),
      startSeconds: Math.max(0, n.startSeconds),
      durationSeconds: n.durationSeconds + Math.min(0, n.startSeconds),
      amplitude: clamp01(n.amplitude),
    }))
    .filter((n) => n.durationSeconds > 0)
    .sort((a, b) => a.pitch - b.pitch || a.startSeconds - b.startSeconds);

  const merged: AudioNote[] = [];
  for (const n of valid) {
    const last = merged[merged.length - 1];
    const lastEnd = last ? last.startSeconds + last.durationSeconds : -Infinity;
    if (last && last.pitch === n.pitch && n.startSeconds - lastEnd < o.mergeGapSeconds) {
      const end = Math.max(lastEnd, n.startSeconds + n.durationSeconds);
      last.durationSeconds = end - last.startSeconds;
      last.amplitude = Math.max(last.amplitude, n.amplitude);
    } else {
      merged.push({ ...n });
    }
  }

  return merged
    .filter((n) => n.durationSeconds >= o.minDurationSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds || a.pitch - b.pitch);
}

/** Tempo of the generated song: at 120 bpm one beat is half a second. */
export const AUDIO_BPM = 120;
const BEATS_PER_SECOND = AUDIO_BPM / 60;

export const APPROXIMATE_WARNING =
  'These notes were detected automatically from a recording and are approximate. ' +
  'Expect missing, extra or wrong notes, and bar lines that do not match the music.';
export const NO_NOTES_WARNING = 'No notes were detected in this recording.';

export interface ToSongOptions extends CleanOptions {
  /** Hand split point for `splitHands` (MIDI pitch). Default middle C. */
  splitPoint?: number;
}

/**
 * Builds a Song from transcribed notes. The recording has no reliable beat, so time maps
 * straight onto a fixed 120 bpm grid (beats = seconds × 2) in 4/4; the falling-notes view then
 * plays it back at the recording's speed. Notes are cleaned first (see `cleanNotes`).
 */
export function toSong(
  notes: readonly AudioNote[],
  title: string,
  options: ToSongOptions = {},
): Song {
  const cleaned = cleanNotes(notes, options);
  const timed = cleaned.map((n) => ({
    pitch: n.pitch,
    startBeat: n.startSeconds * BEATS_PER_SECOND,
    durationBeats: n.durationSeconds * BEATS_PER_SECOND,
    velocity: Math.min(127, Math.max(1, Math.round(n.amplitude * 127))),
  }));
  const hands = splitHands(timed, options.splitPoint);

  const timeSignatures: TimeSignatureEvent[] = [{ beat: 0, numerator: 4, denominator: 4 }];
  const endBeat = timed.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0);
  const measures = measuresFromTimeSignatures(timeSignatures, endBeat);

  const songNotes: SongNote[] = timed
    .map((n, i) => {
      const hand = hands[i] ?? 'right';
      return {
        id: '',
        pitch: n.pitch,
        startBeat: n.startBeat,
        durationBeats: n.durationBeats,
        hand,
        staff: hand === 'right' ? 1 : 2,
        voice: 1,
        part: 0,
        measureIndex: measureIndexAt(measures, n.startBeat),
        velocity: n.velocity,
        sourceRefs: [],
      };
    })
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  songNotes.forEach((n, i) => (n.id = `n${i}`));

  const warnings = [APPROXIMATE_WARNING];
  if (songNotes.length === 0) warnings.push(NO_NOTES_WARNING);

  return {
    title: title.trim() || 'Untitled recording',
    format: 'audio',
    notes: songNotes,
    measures,
    tempos: [{ beat: 0, bpm: AUDIO_BPM }],
    timeSignatures,
    keySignatures: [{ beat: 0, fifths: 0 }],
    parts: [{ name: 'Piano' }],
    lengthBeats: measures.reduce((s, m) => s + m.lengthBeats, 0),
    warnings,
  };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

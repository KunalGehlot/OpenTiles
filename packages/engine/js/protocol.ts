// Messages between the main thread and the detector AudioWorklet.

export type DetectorMode = 'wait' | 'play-along';

/** Threshold names accepted by the engine (see `ot_detector_set_threshold`). */
export const THRESHOLD_IDS = {
  accept: 0,
  wrong: 1,
  wrongMargin: 2,
  octaveBelow: 3,
} as const;
export type ThresholdName = keyof typeof THRESHOLD_IDS;

export type ToWorklet =
  | { type: 'expected'; pitches: number[] }
  | { type: 'mode'; mode: DetectorMode }
  | { type: 'tuning'; cents: number }
  | { type: 'threshold'; name: ThresholdName; value: number }
  | { type: 'calibrate-noise-start' }
  | { type: 'calibrate-noise-end' }
  | { type: 'record'; on: boolean }
  | { type: 'stats' };

export type EventKindName = 'onset' | 'expected' | 'wrong' | 'rejected';
export const EVENT_KINDS: readonly EventKindName[] = ['onset', 'expected', 'wrong', 'rejected'];

/** One detector decision, with times on the AudioContext clock (seconds). */
export interface DetectorEvent {
  kind: EventKindName;
  /** MIDI pitch; 0 for onsets. */
  pitch: number;
  /** Estimated onset time. */
  time: number;
  /** Harmonic score of fresh energy, 0..1. */
  confidence: number;
  /** Odd-partial evidence, 0..1 (diagnostics). */
  odd: number;
  /** When the detector decided. */
  decidedAt: number;
  /** Generation of the expected set the decision used. */
  generation: number;
}

export type FromWorklet =
  | { type: 'ready'; sampleRate: number; version: number }
  | { type: 'error'; message: string }
  | { type: 'events'; events: DetectorEvent[] }
  | { type: 'expected-set'; generation: number }
  | { type: 'noise-calibrated'; noiseDb: number }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'stats'; droppedEvents: number; tuningEstimate: number; generation: number };

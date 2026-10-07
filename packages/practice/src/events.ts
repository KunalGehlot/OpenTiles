// The one event stream every input produces (spec §7 "Input abstraction"). Practice modes never
// know whether a note came from MIDI, the microphone or a tap.

export type InputSource = 'midi' | 'microphone' | 'touch' | 'native-midi';

export interface NoteEvent {
  /** MIDI pitch. */
  pitch: number;
  /** Onset time in seconds on the practice clock (the AudioContext clock in the app). */
  time: number;
  /** 1–127 where the input knows it. */
  velocity?: number;
  /** 0–1; MIDI and touch are always 1. */
  confidence: number;
  source: InputSource;
}

/** What an input adapter looks like to the app; implementations live in apps/web. */
export interface InputAdapter {
  readonly source: InputSource;
  /** Starts listening. For the microphone this must run from a user gesture. */
  start(): Promise<void>;
  stop(): void;
  onNote: (event: NoteEvent) => void;
  /** Key released (MIDI and touch only); used to draw held keys. */
  onRelease?: (pitch: number, time: number) => void;
}

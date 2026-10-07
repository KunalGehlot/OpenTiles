// Approximate audio-recording import (P4-02). Heavy: the web app loads this package with a
// dynamic import only when someone imports an audio file.
export {
  cleanNotes,
  toSong,
  DEFAULT_CLEAN_OPTIONS,
  AUDIO_BPM,
  APPROXIMATE_WARNING,
  NO_NOTES_WARNING,
} from './notes';
export type { AudioNote, CleanOptions, ToSongOptions } from './notes';
export { transcribe, SAMPLE_RATE, DEFAULT_MODEL_URL } from './transcribe';
export type { Backend, TranscribeOptions } from './transcribe';
export { decodeToMono22050, MAX_SECONDS } from './decode';

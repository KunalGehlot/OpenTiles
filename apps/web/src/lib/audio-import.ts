// Approximate import of an audio recording (P4-02). The transcriber (TensorFlow.js and the Basic
// Pitch model, about 2 MB) loads only when someone imports an audio file, never with the app.
// Everything runs on the device: the recording is decoded and transcribed locally, and the model
// is served from the app's own origin (hard rules 3 and 5).
import type { Song } from '@opentiles/song-model';

export const AUDIO_EXTENSIONS = [
  '.wav',
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.webm',
] as const;

/** True for files the audio importer should handle rather than the score importer. */
export function isAudioFile(name: string, type = ''): boolean {
  const lower = name.toLowerCase();
  // MIDI files arrive as audio/midi but are scores, not recordings.
  if (/\.midi?$/.test(lower) || /midi/.test(type)) return false;
  return type.startsWith('audio/') || AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type AudioImportStage = 'loading' | 'decoding' | 'transcribing';

export interface AudioImportOptions {
  /** Called with the current stage and, while transcribing, the fraction done (0–1). */
  onProgress?: (stage: AudioImportStage, fraction: number) => void;
  signal?: AbortSignal;
}

function titleFromFileName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Untitled recording';
}

export async function importAudioFile(
  file: Blob & { name: string },
  options: AudioImportOptions = {},
): Promise<Song> {
  const report = options.onProgress ?? (() => {});
  report('loading', 0);
  const [{ decodeToMono22050, toSong, transcribe }, bytes] = await Promise.all([
    import('@opentiles/audio-import'),
    file.arrayBuffer(),
  ]);
  report('decoding', 0);
  const samples = await decodeToMono22050(bytes);
  options.signal?.throwIfAborted();
  const notes = await transcribe(samples, (fraction) => report('transcribing', fraction), {
    model: new URL('models/basic-pitch/model.json', document.baseURI).href,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return toSong(notes, titleFromFileName(file.name));
}

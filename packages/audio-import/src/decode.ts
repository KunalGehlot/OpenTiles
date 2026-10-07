// Browser-only: decodes any audio file the browser can play and resamples it to the mono
// 22 050 Hz signal Basic Pitch expects. Runs locally; no audio leaves the device.
import { SAMPLE_RATE } from './transcribe';

/** Longest recording accepted, so a stray long file cannot exhaust memory. */
export const MAX_SECONDS = 15 * 60;

export async function decodeToMono22050(data: ArrayBuffer): Promise<Float32Array> {
  // Safari before 14.1 only has the prefixed constructor.
  const Offline: typeof OfflineAudioContext | undefined =
    globalThis.OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Offline) throw new Error('This browser cannot decode audio files.');

  // decodeAudioData resamples to the context's rate; decoding straight into a 22 050 Hz context
  // keeps memory low. decodeAudioData detaches the buffer, so give it a copy.
  const decoder = new Offline(1, 1, SAMPLE_RATE);
  const decoded = await decoder.decodeAudioData(data.slice(0));
  if (decoded.duration > MAX_SECONDS) {
    throw new Error(`Recordings longer than ${MAX_SECONDS / 60} minutes are not supported.`);
  }

  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
  const mixer = new Offline(1, length, SAMPLE_RATE);
  const source = mixer.createBufferSource();
  source.buffer = decoded;
  // A mono destination down-mixes every channel layout using the Web Audio rules.
  source.connect(mixer.destination);
  source.start();
  const rendered = await mixer.startRendering();
  return rendered.getChannelData(0).slice();
}

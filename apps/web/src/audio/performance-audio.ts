// Listening back to a run (P4-09): the learner's performance as played or polished, through the
// same piano the app plays, and a WAV file of it rendered offline. Nothing leaves the device.
import type { RenderNote } from '@opentiles/practice';
import type { Instrument, Voice } from './instrument';
import { loadPianoSamples } from './sampler';
import { Piano, pianoSampleBase } from './synth';
import { t } from '../i18n';

const LOOK_AHEAD = 0.3;
const TICK_MS = 50;
/** Silence after the last note ends, so its release rings out (seconds). */
const TAIL = 1.5;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

// Called as plain functions: browsers throw "Illegal invocation" when setInterval runs as a
// method of another object.
const browserTimers: Timers = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface Playback {
  /** Silences the playback now. */
  stop(): void;
  /** Resolves when the last note has ended or the playback was stopped. */
  readonly ended: Promise<void>;
}

/** When the last note of a rendering stops sounding, from its start. */
export function renderLength(notes: readonly RenderNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.time + n.duration);
  return end;
}

/**
 * Plays notes through an instrument, scheduling only a short way ahead so that stopping is
 * immediate and long pieces do not queue thousands of voices at once.
 */
export function playNotes(
  piano: Instrument,
  notes: readonly RenderNote[],
  clock: () => number,
  timers: Timers = browserTimers,
): Playback {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const t0 = clock() + 0.1;
  const end = t0 + renderLength(sorted);
  const voices = new Set<Voice>();
  let next = 0;
  let finish: () => void = () => {};
  const ended = new Promise<void>((resolve) => (finish = resolve));
  let timer: unknown;
  const done = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    finish();
  };
  const tick = () => {
    const t = clock();
    while (next < sorted.length) {
      const n = sorted[next];
      if (!n || t0 + n.time > t + LOOK_AHEAD) break;
      next += 1;
      const v = piano.play(n.pitch, t0 + n.time, n.duration, n.velocity);
      voices.add(v);
    }
    if (next >= sorted.length && t > end + 0.2) done();
  };
  tick();
  timer = timers.set(tick, TICK_MS);
  return {
    stop: () => {
      const t = clock();
      for (const v of voices) v.stop(t);
      voices.clear();
      next = sorted.length;
      done();
    },
    ended,
  };
}

/** 16-bit PCM WAV of one or more channels of equal length. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const count = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytes = frames * count * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, count, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * 2, true);
  v.setUint16(32, count * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, bytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(at, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
      at += 2;
    }
  }
  return buf;
}

type OfflineCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

/**
 * Renders notes to a WAV file with the sampled piano (the synth when the samples cannot load),
 * entirely in the browser.
 */
export async function renderWav(notes: readonly RenderNote[], sampleRate = 44100): Promise<Blob> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext;
  if (!Ctor) throw new Error(t('This browser cannot render audio files.'));
  const seconds = renderLength(notes) + TAIL;
  const ctx = new Ctor(2, Math.ceil(seconds * sampleRate), sampleRate);
  const base = pianoSampleBase();
  const piano = new Piano(ctx, (c) => loadPianoSamples(c, base), Infinity);
  await piano.load();
  const lead = 0.05;
  for (const n of notes) piano.play(n.pitch, lead + n.time, n.duration, n.velocity);
  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) =>
    rendered.getChannelData(i),
  );
  return new Blob([encodeWav(channels, rendered.sampleRate)], { type: 'audio/wav' });
}

/** Offers a file to save, like a download link. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A title made safe for a file name on every system. */
export function fileSafe(title: string): string {
  const cleaned = Array.from(title, (c) => (c < ' ' ? ' ' : c))
    .join('')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) || 'OpenTiles performance';
}

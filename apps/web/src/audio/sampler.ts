// A Web Audio sampler for the Salamander Grand Piano samples (PLAN.md P1-17, ADR 0007). Each note
// plays the nearest sample at a shifted playback rate; velocity sets gain and brightness; letting
// go releases it like a damper.

import { playClick, type Instrument, type Voice } from './instrument';
import {
  SAMPLE_PITCHES,
  findOnset,
  nearestSample,
  playbackRate,
  releaseTime,
  sampleFileName,
  velocityCutoff,
  velocityGain,
} from './samples';

export interface PianoSample {
  pitch: number;
  buffer: AudioBuffer;
  /** Seconds into the buffer where the attack starts. */
  offset: number;
}

/**
 * Level of a note at the recorded velocity. Chosen so the samples sound as loud as the additive
 * synth they replace: within about 2 dB (RMS over the first second, C3 to C6, measured in
 * Chromium), with similar peaks for loud chords.
 */
const SAMPLE_LEVEL = 0.7;
/** More voices than this and the oldest is released quickly, to keep iPads responsive. */
const MAX_VOICES = 64;
const ATTACK = 0.002;
const STEAL_RELEASE = 0.015;

const silent: Voice = { stop: () => {} };

export class PianoSampler implements Instrument {
  private readonly out: GainNode;
  private readonly pitches: number[];
  private readonly samples = new Map<number, PianoSample>();
  /**
   * Sounding and scheduled voices, oldest first; the value releases the voice quickly, or with
   * `cut` also stops one that has not started yet.
   */
  private readonly voices = new Map<Voice, (cut?: boolean) => void>();

  constructor(
    private readonly ctx: BaseAudioContext,
    samples: readonly PianoSample[],
    destination: AudioNode = ctx.destination,
    /**
     * Voice limit. Rendering offline schedules a whole piece up front, while the context's clock
     * stands at 0, so it lifts the limit: stealing would cut notes that have not started yet.
     */
    private readonly maxVoices = MAX_VOICES,
  ) {
    for (const s of samples) this.samples.set(s.pitch, s);
    this.pitches = [...this.samples.keys()];
    this.out = ctx.createGain();
    this.out.connect(destination);
  }

  get volume(): number {
    return this.out.gain.value;
  }

  set volume(v: number) {
    this.out.gain.value = Math.max(0, Math.min(1, v));
  }

  noteOn(pitch: number, velocity = 90, when = this.ctx.currentTime): Voice {
    const ctx = this.ctx;
    const nearest = nearestSample(pitch, this.pitches);
    const sample = nearest === undefined ? undefined : this.samples.get(nearest);
    if (!sample) return silent;

    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = playbackRate(pitch, sample.pitch);
    const env = ctx.createGain();
    const level = velocityGain(velocity) * SAMPLE_LEVEL;
    // A 2 ms fade-in hides any step where playback starts mid-waveform.
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + ATTACK);
    const cutoff = velocityCutoff(velocity, pitch);
    if (cutoff === null) {
      src.connect(env);
    } else {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      filter.Q.value = -3.01; // Butterworth: no resonant bump (the Web Audio lowpass Q is in dB)
      src.connect(filter);
      filter.connect(env);
    }
    env.connect(this.out);
    src.start(when, sample.offset);

    // A voice stays counted until its sample ends, even with a release already scheduled (play()
    // schedules one up front); stealing may then move that release earlier.
    let releaseAt = Infinity;
    let ended = false;
    const release = (at: number, timeConstant: number) => {
      const t = Math.max(at, when + 0.01);
      if (ended || t >= releaseAt) return;
      releaseAt = t;
      env.gain.cancelScheduledValues(t);
      env.gain.setTargetAtTime(0, t, timeConstant);
      try {
        // After eight time constants the note is ~70 dB down.
        src.stop(t + timeConstant * 8);
      } catch {
        // Older Safari allows only one stop() per source; the envelope still silences it.
      }
    };
    let stopCalled = false;
    const voice: Voice = {
      stop: (at = ctx.currentTime) => {
        if (stopCalled) return;
        stopCalled = true;
        release(at, releaseTime(pitch));
      },
    };
    src.onended = () => {
      ended = true;
      this.voices.delete(voice);
      env.disconnect();
    };
    this.voices.set(voice, (cut = false) => {
      const now = ctx.currentTime;
      if (!cut || when <= now) {
        release(now, STEAL_RELEASE);
        return;
      }
      // Scheduled but not started: it never will (a stop before the start plays nothing).
      releaseAt = now;
      env.gain.cancelScheduledValues(now);
      env.gain.setValueAtTime(0, now);
      try {
        src.stop(now);
      } catch {
        // Older Safari allows only one stop() per source; the envelope is already at zero.
      }
    });
    if (this.voices.size > this.maxVoices) {
      const [oldest] = this.voices.keys();
      if (oldest) {
        this.voices.get(oldest)?.();
        this.voices.delete(oldest);
      }
    }
    return voice;
  }

  /**
   * Stops every note at once (the Player's Pause, P6-05): sounding notes fade in a few
   * milliseconds, and notes scheduled to start later never start.
   */
  silence(): void {
    for (const cut of [...this.voices.values()]) cut(true);
  }

  play(pitch: number, when: number, duration: number, velocity = 90, held?: number): Voice {
    const v = this.noteOn(pitch, velocity, when);
    // The piece's pedal holds it on past the key (P6-10).
    v.stop(when + Math.max(0.05, held ?? duration, duration));
    return v;
  }

  click(when: number, accent = false): void {
    playClick(this.ctx, this.out, when, accent);
  }
}

/**
 * Decodes with the callback form of decodeAudioData, which Safari before 14.1 needs (it has no
 * promise-returning version).
 */
function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, (e) =>
      reject(e ?? new Error('Could not decode a piano sample.')),
    );
    // Newer browsers also return a promise; its rejection is handled by the callback above.
    void Promise.resolve(result).catch(() => undefined);
  });
}

/** Fetches and decodes every piano sample from `base` (a URL ending in "/"). */
export async function loadPianoSamples(
  ctx: BaseAudioContext,
  base: URL,
  fetchFile: (url: URL) => Promise<Response> = (url) => fetch(url),
): Promise<PianoSample[]> {
  return Promise.all(
    SAMPLE_PITCHES.map(async (pitch) => {
      const name = sampleFileName(pitch);
      const res = await fetchFile(new URL(name, base));
      if (!res.ok) throw new Error(`Could not load piano sample ${name} (${res.status}).`);
      const buffer = await decode(ctx, await res.arrayBuffer());
      return { pitch, buffer, offset: findOnset(buffer.getChannelData(0), buffer.sampleRate) };
    }),
  );
}

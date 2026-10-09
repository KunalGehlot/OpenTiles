// The app's notes on a MIDI keyboard's own sound (MIDI out), and the instrument that plays on this
// device, the keyboard or both. The learner chooses in Settings → MIDI keyboard.
import type { Instrument, Voice } from './instrument';

/** What a Web MIDI output offers: `send` with an optional time on the performance.now() clock. */
export interface MidiSink {
  send(data: number[], timestamp?: number): void;
  clear?(): void;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL = 0xb0;

/**
 * Sends notes to a MIDI output. Times arrive on the audio clock; Web MIDI schedules on
 * performance.now(), so each time is turned into "now on that clock plus how far ahead it is".
 * Metronome clicks stay on this device, where their timing is exact.
 */
export class MidiOutInstrument implements Instrument {
  volume = 1;

  constructor(
    private readonly sink: MidiSink,
    /** The audio clock, in seconds. */
    private readonly audioNow: () => number,
    private readonly perfNow: () => number = () => performance.now(),
    private readonly channel = 0,
  ) {}

  /** The audio-clock time `when` on the performance clock, in ms; undefined for "now". */
  private at(when?: number): number | undefined {
    if (when === undefined) return undefined;
    const ahead = when - this.audioNow();
    return ahead > 0.001 ? this.perfNow() + ahead * 1000 : undefined;
  }

  private velocity(v: number | undefined): number {
    return Math.max(1, Math.min(127, Math.round((v ?? 80) * this.volume)));
  }

  noteOn(pitch: number, velocity?: number, when?: number): Voice {
    const p = Math.max(0, Math.min(127, Math.round(pitch)));
    this.sink.send([NOTE_ON | this.channel, p, this.velocity(velocity)], this.at(when));
    let stopped = false;
    return {
      stop: (at?: number) => {
        if (stopped) return;
        stopped = true;
        this.sink.send([NOTE_OFF | this.channel, p, 0], this.at(at));
      },
    };
  }

  play(pitch: number, when: number, duration: number, velocity?: number): Voice {
    const voice = this.noteOn(pitch, velocity, when);
    voice.stop(when + Math.max(0.02, duration));
    return voice;
  }

  click(): void {
    // Clicks stay on this device.
  }

  silence(): void {
    // Drop notes scheduled ahead (where the browser can), then all notes off.
    try {
      this.sink.clear?.();
    } catch {
      // Not every browser has clear().
    }
    this.sink.send([CONTROL | this.channel, 123, 0]);
  }
}

/** Plays on this device, on the MIDI keyboard, or on both at once. */
export class SplitInstrument implements Instrument {
  constructor(
    private readonly device: Instrument | null,
    private readonly keyboard: Instrument | null,
  ) {}

  private get parts(): Instrument[] {
    return [this.device, this.keyboard].filter((p): p is Instrument => p !== null);
  }

  get volume(): number {
    return (this.device ?? this.keyboard)?.volume ?? 1;
  }

  set volume(v: number) {
    for (const p of this.parts) p.volume = v;
  }

  noteOn(pitch: number, velocity?: number, when?: number): Voice {
    const voices = this.parts.map((p) => p.noteOn(pitch, velocity, when));
    return { stop: (at?: number) => voices.forEach((v) => v.stop(at)) };
  }

  play(pitch: number, when: number, duration: number, velocity?: number): Voice {
    const voices = this.parts.map((p) => p.play(pitch, when, duration, velocity));
    return { stop: (at?: number) => voices.forEach((v) => v.stop(at)) };
  }

  click(when: number, accent?: boolean): void {
    // The device keeps the clicks; a keyboard alone has none.
    this.device?.click(when, accent);
  }

  silence(): void {
    for (const p of this.parts) p.silence?.();
  }
}

export type PlaybackTarget = 'device' | 'keyboard' | 'both';

/** The instrument for the app's own notes, given where the learner wants them. */
export function playbackInstrument(
  device: Instrument,
  keyboard: Instrument | null,
  target: PlaybackTarget,
): Instrument {
  if (!keyboard || target === 'device') return device;
  return new SplitInstrument(target === 'both' ? device : null, keyboard);
}

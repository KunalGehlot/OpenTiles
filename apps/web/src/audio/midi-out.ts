// The app's notes on a MIDI keyboard's own sound (MIDI out), and the instrument that plays on this
// device, the keyboard or both. The learner chooses with "Plays on" in practice or in Settings.
import type { Instrument, Voice } from './instrument';

/** What a Web MIDI output offers: `send` with an optional time on the performance.now() clock. */
export interface MidiSink {
  send(data: number[], timestamp?: number): void;
  clear?(): void;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL = 0xb0;
const SUSTAIN = 64;
const SOSTENUTO = 66;
const SOFT = 67;
const ALL_NOTES_OFF = 123;
const PEDAL_CONTROL = { sustain: SUSTAIN, sostenuto: SOSTENUTO, soft: SOFT } as const;

/** How long after the app sends a note a keyboard's copy of it may arrive, in seconds. */
export const ECHO_WINDOW = 0.05;

/**
 * Look-ahead for an output without clear() (Chrome and Edge, checked 2026-10-17): every note
 * stamped ahead still starts after Stop, so hand them over at most this early.
 */
export const MIDI_LOOK_AHEAD_WITHOUT_CLEAR = 0.1;

/**
 * Notes the app sent to a keyboard that sends everything it receives back ("MIDI thru"), so the
 * input can tell those copies from the learner's own keys (P6-02). Without this, play-along would
 * score the app's own accompaniment as the learner's notes. Times are on the audio clock.
 */
export class SentNotes {
  // Note-ons under their pitch, note-offs under pitch + 128.
  private readonly times = new Map<number, number[]>();

  record(on: boolean, pitch: number, time: number): void {
    const key = on ? pitch : pitch + 128;
    const kept = (this.times.get(key) ?? []).filter((t) => t > time - 1);
    kept.push(time);
    this.times.set(key, kept);
  }

  /**
   * True when a note arriving at `time` is most likely the keyboard's copy of one the app sent; the
   * copy is used up, so the learner's own next press of that key counts.
   */
  isEcho(on: boolean, pitch: number, time: number): boolean {
    const list = this.times.get(on ? pitch : pitch + 128);
    // A little early is allowed too: the two clocks are mapped onto each other.
    const i = list?.findIndex((t) => time >= t - 0.01 && time <= t + ECHO_WINDOW) ?? -1;
    if (!list || i < 0) return false;
    list.splice(i, 1);
    return true;
  }
}

/**
 * Sends notes to a MIDI output. Times arrive on the audio clock; Web MIDI schedules on
 * performance.now(), so each time is turned into "now on that clock plus how far ahead it is".
 * Metronome clicks stay on this device, where their timing is exact.
 */
export class MidiOutInstrument implements Instrument {
  volume = 1;
  /** Set for a keyboard that sends the app's notes back, so the input can ignore them. */
  sent: SentNotes | null = null;
  /**
   * Notes sent that may still sound, with the time their note-off is due on the performance clock
   * (Infinity while held). Stopping sends a note-off for each: a browser that drops messages
   * stamped for later (clear) drops their note-offs too.
   */
  private readonly sounding = new Set<{ pitch: number; end: number }>();

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
    this.sent?.record(true, p, when ?? this.audioNow());
    if (this.sounding.size > 256) this.forgetEnded();
    const note = { pitch: p, end: Infinity };
    this.sounding.add(note);
    let stopped = false;
    return {
      stop: (at?: number) => {
        if (stopped) return;
        stopped = true;
        const stamp = this.at(at);
        this.sink.send([NOTE_OFF | this.channel, p, 0], stamp);
        this.sent?.record(false, p, at ?? this.audioNow());
        note.end = stamp ?? this.perfNow();
      },
    };
  }

  /** `held` is for instruments without pedals: the keyboard's own pedal holds the note (P6-10). */
  play(pitch: number, when: number, duration: number, velocity?: number, _held?: number): Voice {
    const voice = this.noteOn(pitch, velocity, when);
    voice.stop(when + Math.max(0.02, duration));
    return voice;
  }

  click(): void {
    // Clicks stay on this device.
  }

  /** The piece's pedal as a control change: the keyboard's own pedal sound (P6-10). */
  pedal(pedal: 'sustain' | 'soft' | 'sostenuto', value: number, when?: number): void {
    const v = Math.max(0, Math.min(127, Math.round(value)));
    this.sink.send([CONTROL | this.channel, PEDAL_CONTROL[pedal], v], this.at(when));
  }

  get lookAhead(): number | undefined {
    return this.sink.clear ? undefined : MIDI_LOOK_AHEAD_WITHOUT_CLEAR;
  }

  /** Pitches that may still sound, or are stamped to start, on the keyboard. */
  get soundingPitches(): number[] {
    this.forgetEnded();
    return [...new Set([...this.sounding].map((n) => n.pitch))].sort((a, b) => a - b);
  }

  /**
   * Stops everything on the keyboard (P6-02): drops messages stamped for later where the browser
   * can, ends every note that may sound or is stamped to start, lifts the sustain pedal, and sends
   * All Notes Off for keyboards that honour it.
   */
  silence(): void {
    try {
      this.sink.clear?.();
    } catch {
      // Not every browser has clear().
    }
    for (const pitch of this.soundingPitches) this.sink.send([NOTE_OFF | this.channel, pitch, 0]);
    this.sounding.clear();
    for (const pedal of [SUSTAIN, SOSTENUTO, SOFT])
      this.sink.send([CONTROL | this.channel, pedal, 0]);
    this.sink.send([CONTROL | this.channel, ALL_NOTES_OFF, 0]);
  }

  private forgetEnded(): void {
    const t = this.perfNow();
    for (const n of this.sounding) if (n.end <= t) this.sounding.delete(n);
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

  get lookAhead(): number | undefined {
    const asked = this.parts.flatMap((p) => (p.lookAhead === undefined ? [] : [p.lookAhead]));
    return asked.length ? Math.min(...asked) : undefined;
  }

  set volume(v: number) {
    for (const p of this.parts) p.volume = v;
  }

  noteOn(pitch: number, velocity?: number, when?: number): Voice {
    const voices = this.parts.map((p) => p.noteOn(pitch, velocity, when));
    return { stop: (at?: number) => voices.forEach((v) => v.stop(at)) };
  }

  play(pitch: number, when: number, duration: number, velocity?: number, held?: number): Voice {
    const voices = this.parts.map((p) => p.play(pitch, when, duration, velocity, held));
    return { stop: (at?: number) => voices.forEach((v) => v.stop(at)) };
  }

  pedal(pedal: 'sustain' | 'soft' | 'sostenuto', value: number, when?: number): void {
    for (const p of this.parts) p.pedal?.(pedal, value, when);
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

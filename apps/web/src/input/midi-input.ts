// MIDI keyboard input. Browsers use Web MIDI, which no iOS/iPadOS browser and no macOS Safari has
// (spec §5); the iPad app reads keyboards through CoreMIDI instead (native-midi-input.ts). Callers
// feature-detect with midiSupported(), get the right input from createMidiInput(), and offer the
// microphone when there is none.
import type { InputAdapter, NoteEvent } from '@opentiles/practice';
import { now } from '../audio/context';
import { audioTimeOf } from './clock-sync';
import { parseMidiMessage } from './midi-message';
import { NativeMidiInput, nativeMidiAvailable } from './native-midi-input';

/** What the practice screen needs from a MIDI keyboard, wherever its notes come from. */
export interface MidiKeyboardInput extends InputAdapter {
  onRelease: (pitch: number, time: number) => void;
  onDevicesChanged: (names: string[]) => void;
  readonly deviceNames: string[];
}

export function webMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

/** True when a MIDI keyboard can be used: CoreMIDI in the iPad app, Web MIDI in a browser. */
export function midiSupported(): boolean {
  return nativeMidiAvailable() || webMidiSupported();
}

/** The MIDI input for this platform: CoreMIDI in the iPad app, Web MIDI everywhere else. */
export function createMidiInput(): MidiKeyboardInput {
  return nativeMidiAvailable() ? new NativeMidiInput() : new MidiInput();
}

export class MidiInput implements MidiKeyboardInput {
  readonly source = 'midi' as const;
  onNote: (event: NoteEvent) => void = () => {};
  onRelease: (pitch: number, time: number) => void = () => {};
  onDevicesChanged: (names: string[]) => void = () => {};
  private access: MIDIAccess | null = null;

  async start(): Promise<void> {
    if (!webMidiSupported()) throw new Error('This browser has no MIDI support.');
    this.access = await navigator.requestMIDIAccess();
    this.attach();
    this.access.onstatechange = () => this.attach();
  }

  get deviceNames(): string[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => i.name ?? 'MIDI device');
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => this.onMessage(e);
    }
    this.onDevicesChanged(this.deviceNames);
  }

  private onMessage(e: MIDIMessageEvent): void {
    const message = parseMidiMessage(e.data);
    if (!message) return;
    // Map the event's own timestamp (performance clock) onto the audio clock.
    const time = audioTimeOf(e.timeStamp / 1000, performance.now() / 1000, now());
    if (message.on) {
      const { pitch, velocity } = message;
      this.onNote({ pitch, time, velocity, confidence: 1, source: 'midi' });
    } else {
      this.onRelease(message.pitch, time);
    }
  }

  stop(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.access.onstatechange = null;
    this.access = null;
  }
}

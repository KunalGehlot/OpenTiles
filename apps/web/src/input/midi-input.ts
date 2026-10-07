// MIDI keyboard input via Web MIDI. Not available in any iOS/iPadOS browser or macOS Safari
// (spec §5): callers must feature-detect with midiSupported() and offer the microphone instead.
import type { InputAdapter, NoteEvent } from '@opentiles/practice';
import { now } from '../audio/context';

export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

export class MidiInput implements InputAdapter {
  readonly source = 'midi' as const;
  onNote: (event: NoteEvent) => void = () => {};
  onRelease: (pitch: number, time: number) => void = () => {};
  onDevicesChanged: (names: string[]) => void = () => {};
  private access: MIDIAccess | null = null;

  async start(): Promise<void> {
    if (!midiSupported()) throw new Error('This browser has no MIDI support.');
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
    const data = e.data;
    if (!data || data.length < 3) return;
    const status = (data[0] ?? 0) & 0xf0;
    const pitch = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    // Map the event's own timestamp onto the audio clock.
    const age = Math.max(0, (performance.now() - e.timeStamp) / 1000);
    const time = now() - age;
    if (status === 0x90 && velocity > 0) {
      this.onNote({ pitch, time, velocity, confidence: 1, source: 'midi' });
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      this.onRelease(pitch, time);
    }
  }

  stop(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.access.onstatechange = null;
    this.access = null;
  }
}

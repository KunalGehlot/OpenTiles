// MIDI keyboard input. Browsers use Web MIDI, which no iOS/iPadOS browser and no macOS Safari has
// (spec §5); the iPad app reads keyboards through CoreMIDI instead (native-midi-input.ts). Callers
// feature-detect with midiSupported(), get the right input from createMidiInput(), and offer the
// microphone when there is none.
import type { InputAdapter, NoteEvent } from '@opentiles/practice';
import { now } from '../audio/context';
import { audioTimeOf } from './clock-sync';
import { parseMidiMessage } from './midi-message';
import { t } from '../i18n';
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

export type MidiUnavailable = 'apple-mobile' | 'safari' | 'insecure' | 'other';

/**
 * Why this browser cannot reach a MIDI keyboard, so the screen can say what to do instead. Pure on
 * its inputs, for tests: Safari (macOS and every iOS/iPadOS browser) has no Web MIDI at all;
 * Firefox and Chrome hide it on pages that are not https or localhost.
 */
export function midiUnavailableReason(env: {
  userAgent: string;
  maxTouchPoints: number;
  secure: boolean;
}): MidiUnavailable {
  const ua = env.userAgent;
  const appleMobile =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (appleMobile) return 'apple-mobile';
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua);
  if (safari) return 'safari';
  if (!env.secure) return 'insecure';
  return 'other';
}

/** What to tell the learner when MIDI is not available here. */
export function midiUnavailableMessage(reason: MidiUnavailable): string {
  switch (reason) {
    case 'apple-mobile':
      return t(
        'Browsers on iPad and iPhone cannot connect to MIDI keyboards (Apple does not allow it). Use the microphone instead: it listens to your piano.',
      );
    case 'safari':
      return t(
        'Safari cannot connect to MIDI keyboards (Apple does not support Web MIDI). Open OpenTiles in Chrome, Edge or Firefox on this computer, or use the microphone.',
      );
    case 'insecure':
      return t(
        'MIDI keyboards only work on a secure page. Open OpenTiles over https, or as localhost on this computer.',
      );
    default:
      return t(
        'This browser cannot connect to MIDI keyboards. Use Chrome, Edge or Firefox, or the microphone.',
      );
  }
}

/** A plain explanation of a failed MIDI request, with what to do about it. */
export function describeMidiError(error: unknown, userAgent: string): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const firefox = /Firefox\//.test(userAgent);
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return firefox
      ? t(
          'Firefox asks to install a small “site permission” add-on before a page may use MIDI. Click “Connect MIDI keyboard” again and accept it (Continue to installation, then Add). If you declined it before, allow MIDI for this site again in Firefox: Settings → Privacy & Security → Permissions.',
        )
      : t(
          'The browser did not allow MIDI for this page. Allow MIDI devices for this site in the browser settings, then try again.',
        );
  }
  if (name === 'NotSupportedError') {
    return t(
      'This browser cannot connect to MIDI keyboards. Use Chrome, Edge or Firefox, or the microphone.',
    );
  }
  return error instanceof Error ? t(error.message) : String(error);
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
    if (!webMidiSupported()) throw new Error(t('This browser has no MIDI support.'));
    this.access = await navigator.requestMIDIAccess();
    this.attach();
    // A keyboard plugged in, switched on or unplugged later shows up here.
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
      // Setting onmidimessage opens the port in Chrome; open it explicitly for other browsers.
      if (input.connection !== 'open') void input.open().catch(() => {});
    }
    this.onDevicesChanged(this.deviceNames);
  }

  private onMessage(e: MIDIMessageEvent): void {
    const message = parseMidiMessage(e.data);
    if (!message) return;
    // Map the event's own timestamp (performance clock) onto the audio clock. A timestamp more than a
    // second away from now is on another clock (or missing): then the note happened just now.
    const localNow = performance.now() / 1000;
    const stamp = e.timeStamp / 1000;
    const time = Math.abs(localNow - stamp) < 1 ? audioTimeOf(stamp, localNow, now()) : now();
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

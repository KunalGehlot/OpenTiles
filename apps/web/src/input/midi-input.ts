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
import type { MidiSink } from '../audio/midi-out';

/** What the practice screen needs from a MIDI keyboard, wherever its notes come from. */
export interface MidiKeyboardInput extends InputAdapter {
  onRelease: (pitch: number, time: number) => void;
  onDevicesChanged: (names: string[]) => void;
  readonly deviceNames: string[];
  /** MIDI outputs the app can play its notes on (Settings → MIDI keyboard). */
  readonly outputNames: string[];
  /** The output called `name`; with no name, the one belonging to the connected keyboard. */
  output(name?: string): MidiSink | null;
}

/**
 * The output to play on: the one asked for by name, else the one named like a connected keyboard
 * (a keyboard's input and output share its name), else the only one there is.
 */
export function pickOutput(
  outputs: readonly string[],
  inputs: readonly string[],
  name = '',
): string | null {
  if (name && outputs.includes(name)) return name;
  const same = outputs.find((o) => inputs.includes(o));
  if (same) return same;
  return outputs.length === 1 ? (outputs[0] ?? null) : null;
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
        'Web pages on iPad and iPhone cannot read MIDI keyboards: Safari and every other browser there use Apple’s WebKit engine, which has no Web MIDI. App Store apps such as Flowkey use Apple’s CoreMIDI instead, and so does the OpenTiles iPad app. In the browser, use the microphone: it listens to your piano.',
      );
    case 'safari':
      return t(
        'Safari cannot read MIDI keyboards: its WebKit engine has no Web MIDI (native apps use Apple’s CoreMIDI instead). Open OpenTiles in Chrome, Edge or Firefox on this Mac, or use the microphone.',
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

/** What to say when MIDI access worked but no keyboard is there. */
export function noKeyboardMessage(userAgent: string): string {
  return /Firefox\//.test(userAgent)
    ? t(
        'Firefox found no MIDI keyboard. It only sees keyboards that were connected and switched on when it started: quit Firefox completely, check the keyboard is on, and open Firefox again.',
      )
    : t('No MIDI keyboard found. Connect it and switch it on; it appears here by itself.');
}

/** A plain explanation of a failed MIDI request, with what to do about it. */
export function describeMidiError(error: unknown, userAgent: string): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const firefox = /Firefox\//.test(userAgent);
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return firefox
      ? t(
          'Firefox did not give this page access to MIDI. Firefox only sees keyboards that were connected and switched on when it started: connect the keyboard, quit Firefox completely and open it again, then click “Connect MIDI keyboard” and allow access. On a website (not localhost) Firefox also asks to add a small “site permission” add-on: accept it. If you declined before, allow MIDI again under Settings → Privacy & Security → Permissions.',
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

let sharedAccess: Promise<MIDIAccess> | null = null;

/**
 * The page's one MIDIAccess, requested on first use and kept until the page closes. Firefox gives
 * every requestMIDIAccess() its own port objects but closes a device by its id when any of them is
 * garbage-collected (midirMIDIPlatformService::ScheduleClose), which silences the others; and when
 * the last access is gone it stops its MIDI service, whose CoreMIDI client on a Mac may then not
 * be created again until Firefox restarts (Apple's MIDIClientDispose note). Each screen used to
 * request its own access and drop it on leaving, so the keyboard fell silent and then went
 * missing. A refusal is not kept, so allowing MIDI later and trying again works.
 */
export function midiAccess(): Promise<MIDIAccess> {
  sharedAccess ??= navigator.requestMIDIAccess().catch((error: unknown) => {
    sharedAccess = null;
    throw error;
  });
  return sharedAccess;
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
  // Listeners, not onmidimessage: the access and its ports are shared with every other screen.
  private readonly onMidiMessage = (e: Event) => this.onMessage(e as MIDIMessageEvent);
  private readonly onStateChange = () => this.attach();

  async start(): Promise<void> {
    if (!webMidiSupported()) throw new Error(t('This browser has no MIDI support.'));
    this.access = await midiAccess();
    this.attach();
    // A keyboard plugged in, switched on or unplugged later shows up here.
    this.access.addEventListener('statechange', this.onStateChange);
  }

  get deviceNames(): string[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => i.name ?? 'MIDI device');
  }

  get outputNames(): string[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((o) => o.name ?? 'MIDI device');
  }

  output(name = ''): MidiSink | null {
    if (!this.access) return null;
    const outputs = [...this.access.outputs.values()];
    const pick = pickOutput(this.outputNames, this.deviceNames, name);
    const port = outputs.find((o) => (o.name ?? 'MIDI device') === pick);
    if (!port) return null;
    return {
      send: (data, timestamp) => port.send(data, timestamp),
      clear: () => (port as MIDIOutput & { clear?: () => void }).clear?.(),
    };
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      // Adding the same listener again does nothing, so this only reaches new ports.
      input.addEventListener('midimessage', this.onMidiMessage);
      // A listener opens the port in Chrome; open it explicitly for other browsers. Ports are
      // never closed: in Firefox that would close the device for the whole page.
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

  /** Stops listening. The access and its open ports stay for the next screen (see midiAccess). */
  stop(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.removeEventListener('midimessage', this.onMidiMessage);
    }
    this.access.removeEventListener('statechange', this.onStateChange);
    this.access = null;
  }
}

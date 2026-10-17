// Where the app's notes play (P6-01, ADR 0019): the learner's choice, and where they really go.
// The choice never changes silently: when the keyboard was chosen but cannot be reached, the notes
// play on this device (so Play always makes a sound) and the screen says why (plan Q2).
import { t } from '../i18n';
import { pickOutput } from '../input/midi-input';
import type { MidiUnavailable } from '../input/midi-input';
import type { MidiPlayback } from '../settings/model';

/** Why the notes play on this device although the learner chose the keyboard. */
export type PlaysOnProblem =
  /** This browser has no MIDI at all (Safari, every iPad browser). */
  | 'no-midi'
  /** MIDI is not connected on this screen yet (no permission, or Connect not pressed). */
  | 'not-connected'
  /** MIDI works, but no keyboard is plugged in and switched on. */
  | 'no-keyboard'
  /** A keyboard sends notes, but there is no MIDI output to play on. */
  | 'no-output'
  /** Several outputs, none named like the keyboard: the learner picks one. */
  | 'ambiguous';

export interface PlaysOn {
  /** Where the app's notes actually play. */
  effective: MidiPlayback;
  /** The MIDI output they play on, when it is the keyboard or both. */
  output: string | null;
  /** Why they play on this device only, although the learner chose the keyboard. */
  problem: PlaysOnProblem | null;
}

export interface MidiState {
  /** The browser (or the iPad app) can reach MIDI keyboards. */
  supported: boolean;
  /** MIDI is connected on this screen. */
  connected: boolean;
  inputs: readonly string[];
  outputs: readonly string[];
  /** The output chosen by name in Settings; empty for the keyboard that is connected. */
  name: string;
}

export function playsOn(choice: MidiPlayback, midi: MidiState): PlaysOn {
  const device = (problem: PlaysOnProblem | null): PlaysOn => ({
    effective: 'device',
    output: null,
    problem,
  });
  if (choice === 'device') return device(null);
  if (!midi.supported) return device('no-midi');
  if (!midi.connected) return device('not-connected');
  const output = pickOutput(midi.outputs, midi.inputs, midi.name);
  if (output) return { effective: choice, output, problem: null };
  if (midi.outputs.length > 1) return device('ambiguous');
  return device(midi.inputs.length === 0 ? 'no-keyboard' : 'no-output');
}

/** What to tell the learner when the notes play on this device instead of the keyboard. */
export function playsOnMessage(problem: PlaysOnProblem): string {
  switch (problem) {
    case 'no-midi':
      return t(
        'This browser cannot play on a MIDI keyboard, so the app’s notes play on this device.',
      );
    case 'not-connected':
      return t('Your keyboard isn’t connected, so the app’s notes play on this device.');
    case 'no-keyboard':
      return t(
        'No MIDI keyboard is connected, so the app’s notes play on this device. Plug it in and switch it on; the notes move to it by themselves.',
      );
    case 'no-output':
      return t(
        'Your keyboard sends notes but offers no MIDI output here, so the app’s notes play on this device.',
      );
    case 'ambiguous':
      return t(
        'Choose which MIDI output is your keyboard under “Plays on”; until then the app’s notes play on this device.',
      );
  }
}

/** What "Plays on" says where no MIDI keyboard can be reached, and what works instead. */
export function playsOnUnavailableHint(reason: MidiUnavailable): string {
  switch (reason) {
    case 'apple-mobile':
      return t(
        'Here the app’s notes play on this device. Many digital pianos also work as a USB audio interface: plugged into the iPad or iPhone, they play its sound, the app’s notes included, through their own speakers.',
      );
    case 'safari':
      return t(
        'Here the app’s notes play on this device. To play them on a MIDI keyboard, open OpenTiles in Chrome, Edge or Firefox.',
      );
    default:
      return t(
        'Here the app’s notes play on this device: this browser cannot reach MIDI keyboards.',
      );
  }
}

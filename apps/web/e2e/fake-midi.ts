// A stand-in MIDI keyboard for the e2e tests (shared by the MIDI and Player specs).
import type { Page } from '@playwright/test';

// MIDI keyboards through Web MIDI, with a stand-in keyboard: the page gets a fake
// navigator.requestMIDIAccess with one input and one output called "Test Keyboard". Notes are
// "played" with window.__midiPress, and window.__midiRequests counts the requests for access.
// window.__midiStateChange fires the access's statechange, as browsers do when a port opens or a
// keyboard comes or goes. The output keeps what the app sends with its timestamp, and clear() drops
// what is not due yet, as the Web MIDI spec says: window.__midiSent is what the keyboard has
// received so far, in time order. With `output: false` the keyboard has no output until
// window.__midiAddOutput() plugs one in.
export async function fakeKeyboard(
  page: Page,
  { firstRequestHangs = false, output: withOutput = true } = {},
) {
  await page.addInitScript(
    ([hangs, hasOutput]: [boolean, boolean]) => {
      const w = window as unknown as {
        __midiSent: number[][];
        __midiPress: (pitch: number) => void;
        __midiRequests: number;
        __midiStateChange: () => void;
        __midiAddOutput: () => void;
        __deviceNotes: number;
      };
      const log: { data: number[]; at: number }[] = [];
      Object.defineProperty(w, '__midiSent', {
        get: () =>
          log
            .filter((m) => m.at <= performance.now())
            .sort((a, b) => a.at - b.at)
            .map((m) => m.data),
      });
      w.__midiRequests = 0;
      // Notes this device plays itself (sampled or synthesised), not the metronome's clicks.
      w.__deviceNotes = 0;
      // Oscillators (the stand-in synth) and buffer sources (the samples) each have their own start().
      for (const Node of [OscillatorNode, AudioBufferSourceNode]) {
        const start = Node.prototype.start as (...a: unknown[]) => void;
        Node.prototype.start = function (this: AudioScheduledSourceNode, ...args: unknown[]) {
          const click =
            this instanceof OscillatorNode && [1320, 1760].includes(this.frequency.value);
          if (!click) w.__deviceNotes += 1;
          start.apply(this, args);
        };
      }
      const input = Object.assign(new EventTarget(), {
        id: 'in',
        name: 'Test Keyboard',
        state: 'connected',
        connection: 'closed',
        open: async () => {
          input.connection = 'open';
          return input;
        },
      });
      const message = (data: number[]) =>
        Object.defineProperty(new Event('midimessage'), 'data', { value: new Uint8Array(data) });
      const output = {
        id: 'out',
        name: 'Test Keyboard',
        state: 'connected',
        connection: 'closed',
        send: (data: number[], at?: number) => {
          log.push({ data: [...data], at: at ?? performance.now() });
          // The first note out opens the port, and the browser says so.
          if (output.connection !== 'open') {
            output.connection = 'open';
            w.__midiStateChange();
          }
        },
        clear: () => {
          const now = performance.now();
          for (let i = log.length - 1; i >= 0; i--) if ((log[i]?.at ?? 0) > now) log.splice(i, 1);
        },
        open: async () => output,
      };
      const outputs = new Map(hasOutput ? [['out', output]] : []);
      w.__midiPress = (pitch: number) => {
        input.dispatchEvent(message([0x90, pitch, 100]));
        setTimeout(() => input.dispatchEvent(message([0x80, pitch, 0])), 100);
      };
      const accesses: EventTarget[] = [];
      w.__midiStateChange = () => {
        for (const a of accesses) a.dispatchEvent(new Event('statechange'));
      };
      w.__midiAddOutput = () => {
        outputs.set('out', output);
        w.__midiStateChange();
      };
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async () => {
          w.__midiRequests += 1;
          // Like a permission prompt the learner never answers.
          if (hangs && w.__midiRequests === 1) await new Promise(() => {});
          const access = Object.assign(new EventTarget(), {
            inputs: new Map([['in', input]]),
            outputs,
          });
          accesses.push(access);
          return access;
        },
      });
    },
    [firstRequestHangs, withOutput] as [boolean, boolean],
  );
}

export const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __midiSent: number[][] }).__midiSent);
export const deviceNotes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __deviceNotes: number }).__deviceNotes);
export const noteOns = async (page: Page) => (await sent(page)).filter((m) => m[0] === 0x90).length;

/** Every note-on the keyboard received has a note-off after it: nothing is left sounding. */
export function unendedNotes(messages: number[][]): number[] {
  const down = new Map<number, number>();
  for (const [status, pitch = 0] of messages) {
    if (status === 0x90) down.set(pitch, (down.get(pitch) ?? 0) + 1);
    if (status === 0x80) down.set(pitch, 0);
  }
  return [...down].filter(([, n]) => n > 0).map(([p]) => p);
}

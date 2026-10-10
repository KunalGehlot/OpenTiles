import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteEvent } from '@opentiles/practice';

// A Web MIDI stand-in built on EventTarget, so listeners behave as in a browser.
class FakeInput extends EventTarget {
  readonly state = 'connected';
  connection = 'closed';
  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }
  open = async () => {
    this.connection = 'open';
    return this;
  };
  press(pitch: number) {
    const e = Object.assign(new Event('midimessage'), {
      data: new Uint8Array([0x90, pitch, 100]),
    });
    this.dispatchEvent(e);
  }
}

class FakeAccess extends EventTarget {
  readonly inputs = new Map<string, FakeInput>();
  readonly outputs = new Map();
  constructor(...inputs: FakeInput[]) {
    super();
    for (const i of inputs) this.inputs.set(i.id, i);
  }
}

async function load() {
  vi.resetModules();
  return import('../src/input/midi-input');
}

function listen(input: { onNote: (e: NoteEvent) => void }): number[] {
  const heard: number[] = [];
  input.onNote = (e) => heard.push(e.pitch);
  return heard;
}

describe('Web MIDI input (P5-12)', () => {
  let keyboard: FakeInput;
  let access: FakeAccess;
  let requestMIDIAccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    keyboard = new FakeInput('in', 'Test Keyboard');
    access = new FakeAccess(keyboard);
    requestMIDIAccess = vi.fn(async () => access);
    vi.stubGlobal('navigator', { requestMIDIAccess });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the browser once per page, however many screens connect', async () => {
    const { MidiInput } = await load();
    const settings = new MidiInput();
    const practice = new MidiInput();
    await settings.start();
    await practice.start();
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(practice.deviceNames).toEqual(['Test Keyboard']);
    expect(keyboard.connection).toBe('open');
  });

  it('keeps the keyboard for the next screen when one stops', async () => {
    const { MidiInput } = await load();
    const first = new MidiInput();
    const firstHeard = listen(first);
    await first.start();
    keyboard.press(60);
    first.stop();

    const next = new MidiInput();
    const nextHeard = listen(next);
    await next.start();
    keyboard.press(62);

    expect(firstHeard).toEqual([60]);
    expect(nextHeard).toEqual([62]);
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(keyboard.connection).toBe('open');
  });

  it('lets two screens listen at once without taking the keyboard from each other', async () => {
    const { MidiInput } = await load();
    const a = new MidiInput();
    const b = new MidiInput();
    const aHeard = listen(a);
    const bHeard = listen(b);
    await a.start();
    await b.start();
    keyboard.press(64);
    expect(aHeard).toEqual([64]);
    expect(bHeard).toEqual([64]);
  });

  it('hears a keyboard switched on later, once', async () => {
    const { MidiInput } = await load();
    const input = new MidiInput();
    const heard = listen(input);
    const names: string[][] = [];
    input.onDevicesChanged = (n) => names.push(n);
    await input.start();
    const later = new FakeInput('in2', 'Second Keyboard');
    access.inputs.set(later.id, later);
    access.dispatchEvent(new Event('statechange'));
    access.dispatchEvent(new Event('statechange'));
    later.press(65);
    expect(heard).toEqual([65]);
    expect(names.at(-1)).toEqual(['Test Keyboard', 'Second Keyboard']);
  });

  it('asks again after a refusal, so allowing MIDI later works', async () => {
    requestMIDIAccess.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const { MidiInput } = await load();
    await expect(new MidiInput().start()).rejects.toThrow('no');
    const input = new MidiInput();
    await input.start();
    expect(requestMIDIAccess).toHaveBeenCalledTimes(2);
    expect(input.deviceNames).toEqual(['Test Keyboard']);
  });
});

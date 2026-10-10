import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteEvent } from '@opentiles/practice';
import type { MidiKeyboardInput } from '../src/input/midi-input';

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

  it('asks again while a request is still waiting on the prompt, then keeps one access', async () => {
    // The first request waits on a permission prompt the learner never sees; pressing Connect
    // again must ask again (so the browser shows its prompt again), not wait on the old request.
    requestMIDIAccess.mockReturnValueOnce(new Promise(() => {}));
    const { MidiInput } = await load();
    void new MidiInput().start();
    const input = new MidiInput();
    await input.start();
    await new MidiInput().start();
    expect(requestMIDIAccess).toHaveBeenCalledTimes(2);
    expect(input.deviceNames).toEqual(['Test Keyboard']);
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

describe('waiting on the browser’s MIDI prompt', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fakeInput = (start: () => Promise<void>) => ({ start }) as unknown as MidiKeyboardInput;

  it('says where the prompt is when the browser has not answered after a moment', async () => {
    const { startMidiInput } = await load();
    let answer = () => {};
    const waiting = vi.fn();
    const started = startMidiInput(
      fakeInput(() => new Promise<void>((resolve) => (answer = resolve))),
      waiting,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(waiting).toHaveBeenCalledTimes(1);
    answer();
    await started;
  });

  it('says nothing when access comes at once', async () => {
    const { startMidiInput } = await load();
    const waiting = vi.fn();
    await startMidiInput(
      fakeInput(async () => {}),
      waiting,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(waiting).not.toHaveBeenCalled();
  });

  it('names Firefox’s add-on prompt in Firefox and the Allow button elsewhere', async () => {
    const { midiWaitingMessage } = await load();
    expect(midiWaitingMessage('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/157.0')).toContain(
      'add-on',
    );
    expect(midiWaitingMessage('Mozilla/5.0 (Macintosh) Chrome/154.0.0.0 Safari/537.36')).toContain(
      'Allow',
    );
  });
});

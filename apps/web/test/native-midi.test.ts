import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreMidiPlugin } from '@opentiles/capacitor-core-midi';
import type { NoteEvent } from '@opentiles/practice';
import { audioTimeOf, ClockSync } from '../src/input/clock-sync';
import { createMidiInput, MidiInput, midiSupported } from '../src/input/midi-input';
import { parseMidiMessage, parseNativeNote, parseNativeSources } from '../src/input/midi-message';
import { NativeMidiInput, nativeMidiAvailable } from '../src/input/native-midi-input';
import { hasNativePlugin, isNativeShell } from '../src/lib/native-shell';

describe('parseMidiMessage (Web MIDI bytes)', () => {
  it('reads note-on on any channel', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ on: true, pitch: 60, velocity: 100 });
    expect(parseMidiMessage(new Uint8Array([0x9f, 21, 1]))).toEqual({
      on: true,
      pitch: 21,
      velocity: 1,
    });
  });

  it('treats note-off and note-on with velocity 0 as note-off', () => {
    expect(parseMidiMessage([0x80, 60, 64])).toEqual({ on: false, pitch: 60, velocity: 64 });
    expect(parseMidiMessage([0x93, 64, 0])).toEqual({ on: false, pitch: 64, velocity: 0 });
  });

  it('ignores everything else', () => {
    expect(parseMidiMessage([0xb0, 64, 127])).toBeNull(); // sustain pedal
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([0x90, 60])).toBeNull();
    expect(parseMidiMessage(null)).toBeNull();
  });
});

describe('parseNativeNote (CoreMIDI plugin payloads)', () => {
  it('accepts a well-formed payload', () => {
    expect(parseNativeNote({ pitch: 60, velocity: 90, channel: 0, time: 1234.5 })).toEqual({
      pitch: 60,
      velocity: 90,
      time: 1234.5,
    });
  });

  it('drops payloads without a valid pitch or time', () => {
    expect(parseNativeNote({ pitch: 128, velocity: 90, time: 1 })).toBeNull();
    expect(parseNativeNote({ pitch: 60.5, velocity: 90, time: 1 })).toBeNull();
    expect(parseNativeNote({ pitch: '60', velocity: 90, time: 1 })).toBeNull();
    expect(parseNativeNote({ pitch: 60, velocity: 90 })).toBeNull();
    expect(parseNativeNote({ pitch: 60, velocity: 90, time: Number.NaN })).toBeNull();
    expect(parseNativeNote(null)).toBeNull();
    expect(parseNativeNote('noteOn')).toBeNull();
  });

  it('treats a missing or odd velocity as unknown (0)', () => {
    expect(parseNativeNote({ pitch: 60, time: 2 })?.velocity).toBe(0);
    expect(parseNativeNote({ pitch: 60, velocity: 300, time: 2 })?.velocity).toBe(0);
  });
});

describe('parseNativeSources', () => {
  it('reads ids and names and falls back for odd entries', () => {
    expect(
      parseNativeSources({
        sources: [{ id: -12, name: 'Digital Piano' }, { id: 'x', name: '  ' }, null, 3],
      }),
    ).toEqual([
      { id: -12, name: 'Digital Piano' },
      { id: 1, name: 'MIDI device' },
    ]);
  });

  it('returns an empty list for anything else', () => {
    expect(parseNativeSources({})).toEqual([]);
    expect(parseNativeSources({ sources: 'none' })).toEqual([]);
    expect(parseNativeSources(undefined)).toEqual([]);
  });
});

describe('ClockSync', () => {
  it('has no estimate before the first sample', () => {
    const clock = new ClockSync();
    expect(clock.offset).toBeNull();
    expect(clock.toLocal(10)).toBeNull();
  });

  it('assumes the remote time was read half-way through the round trip', () => {
    const clock = new ClockSync();
    clock.add({ localBefore: 10, remote: 5010.001, localAfter: 10.004 });
    expect(clock.offset).toBeCloseTo(-5000.001 + 0.002, 9);
    expect(clock.uncertainty).toBeCloseTo(0.002, 9);
    expect(clock.toLocal(5011)).toBeCloseTo(11.001, 9);
  });

  it('trusts the sample with the shortest round trip', () => {
    const clock = new ClockSync();
    clock.add({ localBefore: 0, remote: 100.03, localAfter: 0.05 }); // slow: offset -100.005
    clock.add({ localBefore: 1, remote: 101.001, localAfter: 1.002 }); // fast: offset -100
    clock.add({ localBefore: 2, remote: 102, localAfter: 2.03 }); // slow: offset -99.985
    expect(clock.offset).toBeCloseTo(-100, 9);
  });

  it('ignores impossible samples and forgets old ones', () => {
    const clock = new ClockSync(2);
    clock.add({ localBefore: 5, remote: 1, localAfter: 4 }); // negative round trip
    clock.add({ localBefore: 0, remote: Number.NaN, localAfter: 0.001 });
    expect(clock.offset).toBeNull();
    clock.add({ localBefore: 0, remote: 50, localAfter: 0 }); // perfect, but will age out
    clock.add({ localBefore: 1, remote: 60, localAfter: 1.01 });
    clock.add({ localBefore: 2, remote: 61, localAfter: 2.02 });
    expect(clock.offset).toBeCloseTo(1.005 - 60, 9);
    clock.reset();
    expect(clock.offset).toBeNull();
  });
});

describe('audioTimeOf', () => {
  it('subtracts the age of the event from the audio clock', () => {
    expect(audioTimeOf(99.98, 100, 7)).toBeCloseTo(6.98, 9);
  });

  it('never places an event in the future', () => {
    expect(audioTimeOf(100.5, 100, 7)).toBe(7);
  });
});

type Listener = (event: unknown) => void;

/**
 * A stand-in for the native plugin. Its host clock runs 5000 s ahead of the local clock, and the
 * audio clock started when the local clock read 50 s.
 */
function fakeShell(options: { failStart?: boolean } = {}) {
  const state = { local: 100 };
  const listeners = new Map<string, Set<Listener>>();
  const calls: string[] = [];
  let sources = [{ id: 7, name: 'Digital Piano' }];
  let destinations = [{ id: 8, name: 'Digital Piano' }];
  const sent: { destination: number; messages: { data: number[]; time?: number }[] }[] = [];
  const flushed: (number | undefined)[] = [];
  const plugin = {
    listSources: async () => ({ sources }),
    listDestinations: async () => ({ destinations }),
    send: async (options: (typeof sent)[number]) => {
      sent.push(options);
      return { sent: true };
    },
    flush: async (options: { destination?: number }) => {
      flushed.push(options.destination);
    },
    start: async () => {
      calls.push('start');
      if (options.failStart) throw new Error('MIDIClientCreateWithBlock failed (OSStatus -50).');
      return { sources };
    },
    stop: async () => {
      calls.push('stop');
    },
    getTime: async () => {
      calls.push('getTime');
      state.local += 0.001; // half of a 2 ms round trip on the way there...
      const time = state.local + 5000;
      state.local += 0.001; // ...and half on the way back
      return { time };
    },
    addListener: async (eventName: string, listener: Listener) => {
      const set = listeners.get(eventName) ?? new Set<Listener>();
      listeners.set(eventName, set);
      set.add(listener);
      return { remove: async () => void set.delete(listener) };
    },
    removeAllListeners: async () => listeners.clear(),
  };
  const emit = (eventName: string, payload: unknown) =>
    listeners.get(eventName)?.forEach((l) => l(payload));
  const listenerCount = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  const input = new NativeMidiInput(
    async () => ({ CoreMidi: plugin as unknown as CoreMidiPlugin }),
    () => state.local,
    () => state.local - 50,
  );
  const setSources = (next: typeof sources) => {
    sources = next;
    emit('devicesChanged', { sources: next });
  };
  const setDestinations = (next: typeof destinations) => {
    destinations = next;
    emit('destinationsChanged', { destinations: next });
  };
  return { state, input, emit, calls, listenerCount, setSources, setDestinations, sent, flushed };
}

describe('NativeMidiInput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns plugin notes into native-midi NoteEvents on the audio clock', async () => {
    const shell = fakeShell();
    const notes: NoteEvent[] = [];
    const releases: [number, number][] = [];
    shell.input.onNote = (e) => notes.push(e);
    shell.input.onRelease = (pitch, time) => releases.push([pitch, time]);
    await shell.input.start();
    expect(shell.calls.filter((c) => c === 'getTime')).toHaveLength(3);
    expect(shell.calls).toContain('start');

    // The key went down at local 110.010 (host 5110.010); the bridge delivered it 25 ms later.
    shell.state.local = 110.035;
    shell.emit('noteOn', { pitch: 60, velocity: 80, channel: 0, time: 5110.01 });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.source).toBe('native-midi');
    expect(notes[0]?.pitch).toBe(60);
    expect(notes[0]?.velocity).toBe(80);
    expect(notes[0]?.confidence).toBe(1);
    expect(notes[0]?.time).toBeCloseTo(110.01 - 50, 6);

    shell.state.local = 110.6;
    shell.emit('noteOff', { pitch: 60, velocity: 0, channel: 0, time: 5110.59 });
    expect(releases).toHaveLength(1);
    expect(releases[0]?.[0]).toBe(60);
    expect(releases[0]?.[1]).toBeCloseTo(110.59 - 50, 6);
  });

  it('drops malformed notes', async () => {
    const shell = fakeShell();
    const notes: NoteEvent[] = [];
    shell.input.onNote = (e) => notes.push(e);
    await shell.input.start();
    shell.emit('noteOn', { pitch: 200, velocity: 80, time: 5100 });
    shell.emit('noteOn', { velocity: 80, time: 5100 });
    shell.emit('noteOn', 'C4');
    expect(notes).toHaveLength(0);
  });

  it('reports devices on start and when they change', async () => {
    const shell = fakeShell();
    const seen: string[][] = [];
    shell.input.onDevicesChanged = (names) => seen.push(names);
    await shell.input.start();
    expect(shell.input.deviceNames).toEqual(['Digital Piano']);
    shell.setSources([
      { id: 7, name: 'Digital Piano' },
      { id: 9, name: 'Bluetooth MIDI' },
    ]);
    expect(shell.input.deviceNames).toEqual(['Digital Piano', 'Bluetooth MIDI']);
    expect(seen.at(-1)).toEqual(['Digital Piano', 'Bluetooth MIDI']);
  });

  it('measures the clock again while listening, and stops everything on stop()', async () => {
    vi.useFakeTimers();
    const shell = fakeShell();
    await shell.input.start();
    const syncs = () => shell.calls.filter((c) => c === 'getTime').length;
    expect(syncs()).toBe(3);
    vi.advanceTimersByTime(5000);
    expect(syncs()).toBe(4);
    // Notes on and off, sources and (P6-12) destinations.
    expect(shell.listenerCount()).toBe(4);

    shell.input.stop();
    expect(shell.listenerCount()).toBe(0);
    expect(shell.calls.at(-1)).toBe('stop');
    vi.advanceTimersByTime(60_000);
    expect(syncs()).toBe(4);
  });

  it('leaves nothing listening when stopped before start() finishes', async () => {
    const shell = fakeShell();
    const starting = shell.input.start();
    shell.input.stop();
    await starting;
    await Promise.resolve();
    expect(shell.listenerCount()).toBe(0);
    expect(shell.calls).not.toContain('start');
  });

  it('cleans up and rethrows when the plugin cannot start', async () => {
    vi.useFakeTimers();
    const shell = fakeShell({ failStart: true });
    await expect(shell.input.start()).rejects.toThrow('MIDIClientCreateWithBlock');
    expect(shell.listenerCount()).toBe(0);
    const syncs = shell.calls.filter((c) => c === 'getTime').length;
    vi.advanceTimersByTime(60_000);
    expect(shell.calls.filter((c) => c === 'getTime')).toHaveLength(syncs);
  });
});

describe('native shell detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds no shell in a browser', () => {
    expect(isNativeShell()).toBe(false);
    expect(nativeMidiAvailable()).toBe(false);
    expect(createMidiInput()).toBeInstanceOf(MidiInput);
  });

  it('uses CoreMIDI inside the iPad app', () => {
    vi.stubGlobal('Capacitor', {
      isNativePlatform: () => true,
      isPluginAvailable: (name: string) => name === 'CoreMidi',
    });
    expect(isNativeShell()).toBe(true);
    expect(hasNativePlugin('CoreMidi')).toBe(true);
    expect(hasNativePlugin('Camera')).toBe(false);
    expect(midiSupported()).toBe(true);
    expect(createMidiInput()).toBeInstanceOf(NativeMidiInput);
  });

  it('ignores a Capacitor global that is not native or lacks the plugin', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => false, isPluginAvailable: () => true });
    expect(nativeMidiAvailable()).toBe(false);
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, isPluginAvailable: () => false });
    expect(nativeMidiAvailable()).toBe(false);
    vi.stubGlobal('Capacitor', {
      isNativePlatform: () => {
        throw new Error('bridge gone');
      },
    });
    expect(isNativeShell()).toBe(false);
  });
});

describe('MIDI out in the iPad app (P6-12)', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('lists the keyboards it can play on and follows them', async () => {
    const shell = fakeShell();
    const seen: string[][] = [];
    shell.input.onOutputsChanged = (names) => seen.push(names);
    await shell.input.start();
    expect(shell.input.outputNames).toEqual(['Digital Piano']);
    shell.setDestinations([]);
    expect(shell.input.outputNames).toEqual([]);
    expect(seen.at(-1)).toEqual([]);
  });

  it('sends a tick’s messages in one call, stamped on the host clock', async () => {
    const shell = fakeShell();
    await shell.input.start();
    const sink = shell.input.output();
    expect(sink).not.toBeNull();
    // Local 110.5 s is host 5110.5 s (the fake's host clock runs 5000 s ahead).
    sink?.send([0x90, 60, 80], 110_500);
    sink?.send([0x80, 60, 0], 111_000);
    sink?.send([0xb0, 64, 0]);
    expect(shell.sent).toHaveLength(0);
    await flush();
    expect(shell.sent).toHaveLength(1);
    expect(shell.sent[0]?.destination).toBe(8);
    const messages = shell.sent[0]?.messages ?? [];
    expect(messages.map((m) => m.data)).toEqual([
      [0x90, 60, 80],
      [0x80, 60, 0],
      [0xb0, 64, 0],
    ]);
    expect(messages[0]?.time).toBeCloseTo(5110.5, 6);
    expect(messages[1]?.time).toBeCloseTo(5111, 6);
    expect(messages[2]).not.toHaveProperty('time');
  });

  it('clears what is still waiting, here and in CoreMIDI', async () => {
    const shell = fakeShell();
    await shell.input.start();
    const sink = shell.input.output();
    sink?.send([0x90, 62, 80], 120_000);
    sink?.clear?.();
    sink?.send([0x80, 62, 0]);
    await flush();
    expect(shell.flushed).toEqual([8]);
    expect(shell.sent.flatMap((s) => s.messages.map((m) => m.data))).toEqual([[0x80, 62, 0]]);
  });

  it('has no output before it is started or without a keyboard', async () => {
    const shell = fakeShell();
    expect(shell.input.output()).toBeNull();
    await shell.input.start();
    shell.setDestinations([
      { id: 1, name: 'Network Session' },
      { id: 2, name: 'Synth' },
    ]);
    // Two outputs, neither named like the keyboard: the learner has to choose.
    expect(shell.input.output()).toBeNull();
    expect(shell.input.output('Synth')).not.toBeNull();
  });
});

// Listening back (P4-09): the look-ahead player and the WAV encoder.
import { describe, expect, it } from 'vitest';
import type { Instrument } from '../src/audio/instrument';
import { encodeWav, playNotes, renderLength } from '../src/audio/performance-audio';

function fakePiano() {
  const played: { pitch: number; when: number; duration: number; velocity?: number }[] = [];
  const stopped: number[] = [];
  const piano: Instrument = {
    volume: 1,
    noteOn: () => ({ stop: () => {} }),
    play: (pitch, when, duration, velocity) => {
      played.push({ pitch, when, duration, velocity });
      return { stop: (at) => stopped.push(at ?? -1) };
    },
    click: () => {},
  };
  return { piano, played, stopped };
}

function fakeTimers() {
  let fn: (() => void) | null = null;
  return {
    timers: {
      set: (f: () => void) => {
        fn = f;
        return 1;
      },
      clear: () => {
        fn = null;
      },
    },
    tick: () => fn?.(),
    get running() {
      return fn !== null;
    },
  };
}

const notes = [
  { pitch: 64, time: 1, duration: 0.5, velocity: 70 },
  { pitch: 60, time: 0, duration: 0.5, velocity: 90 },
  { pitch: 62, time: 0.5, duration: 1, velocity: 80 },
];

describe('playNotes', () => {
  it('schedules notes a little ahead, in time order, and ends after the last one', async () => {
    const clock = { t: 10 };
    const { piano, played } = fakePiano();
    const t = fakeTimers();
    const playback = playNotes(piano, notes, () => clock.t, t.timers);
    expect(played.map((p) => p.pitch)).toEqual([60]);
    expect(played[0]?.when).toBeCloseTo(10.1);
    clock.t = 10.5;
    t.tick();
    expect(played.map((p) => p.pitch)).toEqual([60, 62]);
    clock.t = 11;
    t.tick();
    expect(played.map((p) => [p.pitch, p.velocity])).toEqual([
      [60, 90],
      [62, 80],
      [64, 70],
    ]);
    clock.t = 12;
    t.tick();
    expect(t.running).toBe(false);
    await playback.ended;
  });

  it('stops every sounding note at once', async () => {
    const clock = { t: 0 };
    const { piano, played, stopped } = fakePiano();
    const t = fakeTimers();
    const playback = playNotes(piano, notes, () => clock.t, t.timers);
    clock.t = 0.2;
    playback.stop();
    expect(stopped).toEqual([0.2]);
    clock.t = 5;
    t.tick();
    expect(played).toHaveLength(1);
    await playback.ended;
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit PCM header and interleaved, clipped samples', () => {
    const left = new Float32Array([0, 1, -1, 2]);
    const right = new Float32Array([0.5, -0.5, 0, -2]);
    const buf = encodeWav([left, right], 44100);
    const v = new DataView(buf);
    const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buf, at, n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(36, 4)).toBe('data');
    expect(v.getUint32(4, true)).toBe(36 + 16);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(16);
    const samples = Array.from({ length: 8 }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 16384, 32767, -16384, -32768, 0, 32767, -32768]);
  });

  it('measures how long a rendering sounds', () => {
    expect(renderLength(notes)).toBe(1.5);
    expect(renderLength([])).toBe(0);
  });
});

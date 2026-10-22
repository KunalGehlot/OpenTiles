import { describe, expect, it } from 'vitest';
import {
  MIDI_LOOK_AHEAD_WITHOUT_CLEAR,
  MidiOutInstrument,
  playbackInstrument,
  SentNotes,
  SplitInstrument,
} from '../src/audio/midi-out';
import type { Instrument, Voice } from '../src/audio/instrument';
import { pickOutput } from '../src/input/midi-input';
import { normaliseSettings } from '../src/settings/model';

function sink() {
  const sent: { data: number[]; at?: number }[] = [];
  let cleared = 0;
  return {
    sent,
    get cleared() {
      return cleared;
    },
    send: (data: number[], at?: number) => sent.push({ data, at }),
    clear: () => {
      cleared += 1;
    },
  };
}

function fakeInstrument() {
  const log: string[] = [];
  const inst: Instrument = {
    volume: 1,
    noteOn: (p) => {
      log.push(`on ${p}`);
      return { stop: () => log.push(`off ${p}`) } as Voice;
    },
    play: (p) => {
      log.push(`play ${p}`);
      return { stop: () => {} };
    },
    click: () => log.push('click'),
  };
  return { inst, log };
}

describe('MIDI out', () => {
  it('sends note on and off, timed on the performance clock', () => {
    const s = sink();
    let audio = 10;
    const out = new MidiOutInstrument(
      s,
      () => audio,
      () => 5000,
    );
    out.play(60, 10.5, 1, 100);
    expect(s.sent).toEqual([
      { data: [0x90, 60, 100], at: 5500 },
      { data: [0x80, 60, 0], at: 6500 },
    ]);
    // A note for now has no timestamp; stop() only counts once.
    audio = 20;
    const v = out.noteOn(64, 200);
    v.stop();
    v.stop();
    expect(s.sent.slice(2)).toEqual([
      { data: [0x90, 64, 127], at: undefined },
      { data: [0x80, 64, 0], at: undefined },
    ]);
  });

  it('silences the keyboard: drops stamped notes, ends every note, lifts the pedal', () => {
    const s = sink();
    let perf = 1000;
    const out = new MidiOutInstrument(
      s,
      () => 0,
      () => perf,
    );
    out.play(60, 0.5, 1); // stamped from 1500 to 2500 ms
    out.play(62, 0, 0.1); // now, off at 1100 ms
    out.noteOn(64); // held
    perf = 1200; // 62 has ended
    expect(out.soundingPitches).toEqual([60, 64]);
    s.sent.length = 0;
    out.silence();
    expect(s.cleared).toBe(1);
    // A browser with clear() also dropped 60's stamped note-off, so each note gets one now.
    expect(s.sent.map((m) => m.data)).toEqual([
      [0x80, 60, 0],
      [0x80, 64, 0],
      [0xb0, 64, 0],
      [0xb0, 66, 0],
      [0xb0, 67, 0],
      [0xb0, 123, 0],
    ]);
    expect(s.sent.every((m) => m.at === undefined)).toBe(true);
    expect(out.soundingPitches).toEqual([]);
  });

  it('silences a keyboard whose browser has no clear()', () => {
    const sent: number[][] = [];
    const out = new MidiOutInstrument(
      { send: (d) => sent.push(d) },
      () => 0,
      () => 0,
    );
    out.noteOn(70);
    out.silence();
    expect(sent.slice(1)).toEqual([
      [0x80, 70, 0],
      [0xb0, 64, 0],
      [0xb0, 66, 0],
      [0xb0, 67, 0],
      [0xb0, 123, 0],
    ]);
  });

  it('sends the piece’s pedals as control changes, and plays keys for their own length', () => {
    const s = sink();
    const out = new MidiOutInstrument(
      s,
      () => 10,
      () => 5000,
    );
    out.pedal('sustain', 127, 10.5);
    out.pedal('soft', 90);
    // A held length is for instruments without pedals: the keyboard's pedal holds the note.
    out.play(60, 10, 0.5, 80, 3);
    expect(s.sent.map((m) => [m.data, m.at])).toEqual([
      [[0xb0, 64, 127], 5500],
      [[0xb0, 67, 90], undefined],
      [[0x90, 60, 80], undefined],
      [[0x80, 60, 0], 5500],
    ]);
    const device = fakeInstrument();
    const keyboard = {
      ...fakeInstrument().inst,
      pedal: (p: string, v: number) => device.log.push(`${p} ${v}`),
    };
    new SplitInstrument(device.inst, keyboard).pedal('sustain', 0);
    expect(device.log).toEqual(['sustain 0']);
  });

  it('asks for a short look-ahead only where the output cannot drop stamped notes', () => {
    const withClear = new MidiOutInstrument(sink(), () => 0);
    const without = new MidiOutInstrument({ send: () => {} }, () => 0);
    expect(withClear.lookAhead).toBeUndefined();
    expect(without.lookAhead).toBe(MIDI_LOOK_AHEAD_WITHOUT_CLEAR);
    const device = fakeInstrument().inst;
    expect(new SplitInstrument(device, without).lookAhead).toBe(MIDI_LOOK_AHEAD_WITHOUT_CLEAR);
    expect(new SplitInstrument(device, withClear).lookAhead).toBeUndefined();
  });

  it('knows the copies a MIDI thru keyboard sends back', () => {
    const sent = new SentNotes();
    sent.record(true, 60, 10);
    sent.record(false, 60, 10.5);
    expect(sent.isEcho(true, 62, 10.01)).toBe(false);
    expect(sent.isEcho(true, 60, 10.2)).toBe(false); // too late: the learner's own key
    expect(sent.isEcho(true, 60, 10.01)).toBe(true);
    // Used up, so the learner's next press of the key counts.
    expect(sent.isEcho(true, 60, 10.02)).toBe(false);
    expect(sent.isEcho(false, 60, 10.52)).toBe(true);
  });

  it('records what it sends for a MIDI thru keyboard, on the audio clock', () => {
    const s = sink();
    const out = new MidiOutInstrument(
      s,
      () => 3,
      () => 0,
    );
    out.sent = new SentNotes();
    out.play(65, 3.25, 0.5);
    expect(out.sent.isEcho(true, 65, 3.26)).toBe(true);
    expect(out.sent.isEcho(false, 65, 3.76)).toBe(true);
  });

  it('plays on the device, the keyboard or both', () => {
    const device = fakeInstrument();
    const keyboard = fakeInstrument();
    expect(playbackInstrument(device.inst, keyboard.inst, 'device')).toBe(device.inst);
    expect(playbackInstrument(device.inst, null, 'keyboard')).toBe(device.inst);
    const both = playbackInstrument(device.inst, keyboard.inst, 'both');
    both.noteOn(60).stop();
    both.click(0);
    expect(device.log).toEqual(['on 60', 'off 60', 'click']);
    expect(keyboard.log).toEqual(['on 60', 'off 60']);
    const only = new SplitInstrument(null, keyboard.inst);
    only.play(62, 0, 1);
    expect(keyboard.log.at(-1)).toBe('play 62');
    // Before sound starts on this device, the keyboard still plays its part.
    expect(playbackInstrument(null, null, 'both')).toBeNull();
    expect(playbackInstrument(null, keyboard.inst, 'device')).toBeNull();
    playbackInstrument(null, keyboard.inst, 'both')?.play(64, 0, 1);
    playbackInstrument(null, keyboard.inst, 'keyboard')?.play(65, 0, 1);
    expect(keyboard.log.slice(-2)).toEqual(['play 64', 'play 65']);
  });

  it('picks the output that belongs to the connected keyboard', () => {
    expect(pickOutput(['IAC Bus 1', 'Digital Keyboard'], ['Digital Keyboard'])).toBe(
      'Digital Keyboard',
    );
    expect(pickOutput(['Synth'], ['Digital Keyboard'])).toBe('Synth');
    expect(pickOutput(['A', 'B'], ['C'])).toBeNull();
    expect(pickOutput(['A', 'B'], ['C'], 'B')).toBe('B');
  });

  it('keeps the MIDI settings and defaults damaged ones', () => {
    expect(normaliseSettings(undefined).midi).toEqual({
      echo: false,
      playback: 'auto',
      playbackVersion: 2,
      output: '',
      thru: [],
    });
    expect(
      normaliseSettings({ midi: { echo: true, playback: 'both', output: 'X', thru: ['X', 3] } })
        .midi,
    ).toEqual({
      echo: true,
      playback: 'both',
      playbackVersion: 2,
      output: 'X',
      thru: ['X'],
    });
    expect(normaliseSettings({ midi: { playback: 'loud', echo: 'yes' } }).midi.playback).toBe(
      'auto',
    );
  });
});

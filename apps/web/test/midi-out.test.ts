import { describe, expect, it } from 'vitest';
import { MidiOutInstrument, playbackInstrument, SplitInstrument } from '../src/audio/midi-out';
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

  it('silences the keyboard: drops scheduled notes and sends all notes off', () => {
    const s = sink();
    const out = new MidiOutInstrument(
      s,
      () => 0,
      () => 0,
    );
    out.silence();
    expect(s.cleared).toBe(1);
    expect(s.sent.at(-1)?.data).toEqual([0xb0, 123, 0]);
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
      playback: 'device',
      output: '',
    });
    expect(normaliseSettings({ midi: { echo: true, playback: 'both', output: 'X' } }).midi).toEqual(
      {
        echo: true,
        playback: 'both',
        output: 'X',
      },
    );
    expect(normaliseSettings({ midi: { playback: 'loud', echo: 'yes' } }).midi.playback).toBe(
      'device',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { playsOn, playsOnMessage } from '../src/audio/plays-on';
import type { MidiState } from '../src/audio/plays-on';

const connected: MidiState = {
  supported: true,
  connected: true,
  inputs: ['Digital Keyboard'],
  outputs: ['Digital Keyboard'],
  name: '',
};

describe('Plays on (P6-01)', () => {
  it('plays on the keyboard when it can be reached', () => {
    expect(playsOn('keyboard', connected)).toEqual({
      effective: 'keyboard',
      output: 'Digital Keyboard',
      problem: null,
    });
    expect(playsOn('both', connected).effective).toBe('both');
    expect(playsOn('device', connected)).toEqual({
      effective: 'device',
      output: null,
      problem: null,
    });
  });

  it('plays on this device and says why when the keyboard cannot be reached', () => {
    const why = (midi: Partial<MidiState>) => playsOn('keyboard', { ...connected, ...midi });
    expect(why({ supported: false })).toMatchObject({ effective: 'device', problem: 'no-midi' });
    expect(why({ connected: false })).toMatchObject({
      effective: 'device',
      problem: 'not-connected',
    });
    expect(why({ inputs: [], outputs: [] }).problem).toBe('no-keyboard');
    expect(why({ outputs: [] }).problem).toBe('no-output');
    expect(why({ outputs: ['IAC Bus 1', 'Synth'] })).toMatchObject({
      effective: 'device',
      output: null,
      problem: 'ambiguous',
    });
    // Choosing one of several outputs by name settles it.
    expect(why({ outputs: ['IAC Bus 1', 'Synth'], name: 'Synth' })).toEqual({
      effective: 'keyboard',
      output: 'Synth',
      problem: null,
    });
  });

  it('has a message for every problem', () => {
    for (const p of [
      'no-midi',
      'not-connected',
      'no-keyboard',
      'no-output',
      'ambiguous',
    ] as const) {
      expect(playsOnMessage(p)).toMatch(/this device/);
    }
  });
});

// Pedals in the Song (P6-10, ADR 0020): read from MIDI control changes and MusicXML marks, kept
// through repeats and trimming. Files are generated here (CC0).
import { describe, expect, it } from 'vitest';
import { midiToSong } from '../src/midi';
import { parseMusicXml } from '../src/musicxml';
import { pedalsBefore, tidyPedals } from '../src/pedals';
import { trimMeasures } from '../src/transform';
import { attrs, domParser, midiFile, midiTrack, note, noteOff, noteOn, score } from './fixtures';

const PPQ = 480;
const cc = (tick: number, controller: number, value: number, channel = 0) => ({
  tick,
  data: [0xb0 | channel, controller, value],
});

describe('pedals from MIDI files', () => {
  it('reads the sustain, soft and sostenuto pedals on the piano’s channel', () => {
    const track = midiTrack([
      noteOn(0, 60),
      noteOff(PPQ, 60),
      noteOn(PPQ, 64),
      noteOff(2 * PPQ, 64),
      cc(0, 64, 127),
      cc(PPQ / 2, 67, 100),
      cc(PPQ, 64, 0),
      cc(PPQ, 64, 127),
      cc(2 * PPQ, 64, 0),
      // The drum channel's pedal is not the piano's.
      cc(3 * PPQ, 64, 127, 9),
    ]);
    const song = midiToSong(midiFile([track]));
    expect(song.pedals).toEqual([
      { beat: 0, pedal: 'sustain', value: 127 },
      { beat: 0.5, pedal: 'soft', value: 100 },
      { beat: 1, pedal: 'sustain', value: 0 },
      { beat: 1, pedal: 'sustain', value: 127 },
      { beat: 2, pedal: 'sustain', value: 0 },
    ]);
  });

  it('has no pedals field for a file without them', () => {
    const song = midiToSong(midiFile([midiTrack([noteOn(0, 60), noteOff(PPQ, 60)])]));
    expect(song).not.toHaveProperty('pedals');
  });
});

const parse = (xml: string) => parseMusicXml(xml, { domParser });
const pedal = (type: string, extra = '') =>
  `<direction placement="below"><direction-type><pedal type="${type}"/></direction-type>${extra}</direction>`;
const q = (step: string) => note({ step, octave: 4, duration: 1 });

describe('pedals from MusicXML', () => {
  it('reads pedal marks, a change, and the sound of a half pedal', () => {
    const song = parse(
      score([
        [
          {
            attributes: attrs({ divisions: 1, beats: 4 }),
            content:
              pedal('start') +
              q('C') +
              q('D') +
              pedal('change') +
              q('E') +
              '<direction><direction-type><words>½</words></direction-type><sound damper-pedal="50"/></direction>' +
              q('F') +
              pedal('stop'),
          },
        ],
      ]),
    );
    expect(song.pedals).toEqual([
      { beat: 0, pedal: 'sustain', value: 127 },
      { beat: 2, pedal: 'sustain', value: 0 },
      { beat: 2, pedal: 'sustain', value: 127 },
      { beat: 3, pedal: 'sustain', value: 64 },
      { beat: 4, pedal: 'sustain', value: 0 },
    ]);
  });

  it('pedals a repeated bar again when it repeats', () => {
    const song = parse(
      score([
        [
          {
            attributes: attrs({ divisions: 1, beats: 2 }),
            content: pedal('start') + q('C') + q('D') + pedal('stop'),
            left: '<repeat direction="forward"/>',
            right: '<repeat direction="backward"/>',
          },
        ],
      ]),
    );
    expect(song.pedals?.map((p) => [p.beat, p.value])).toEqual([
      [0, 127],
      [2, 0],
      [2, 127],
      [4, 0],
    ]);
  });
});

describe('pedal events', () => {
  it('are tidied: sorted, clamped, without repeats of the same value', () => {
    expect(
      tidyPedals([
        { beat: 2, pedal: 'sustain', value: 0 },
        { beat: 0, pedal: 'sustain', value: 200 },
        { beat: 1, pedal: 'sustain', value: 127 },
        { beat: 1, pedal: 'soft', value: 0 },
      ]),
    ).toEqual([
      { beat: 0, pedal: 'sustain', value: 127 },
      { beat: 2, pedal: 'sustain', value: 0 },
    ]);
    expect(
      pedalsBefore(
        [
          { beat: 0, pedal: 'sustain', value: 127 },
          { beat: 1, pedal: 'soft', value: 90 },
        ],
        1,
      ),
    ).toEqual({ sustain: 127, soft: 0, sostenuto: 0 });
  });

  it('survive trimming, with the pedal held at the cut', () => {
    const song = parse(
      score([
        [
          {
            attributes: attrs({ divisions: 1, beats: 2 }),
            content: pedal('start') + q('C') + q('D'),
          },
          { content: q('E') + pedal('stop') + q('F') },
        ],
      ]),
    );
    const trimmed = trimMeasures(song, 1, 1);
    expect(trimmed.pedals).toEqual([
      { beat: 0, pedal: 'sustain', value: 127 },
      { beat: 1, pedal: 'sustain', value: 0 },
    ]);
  });
});

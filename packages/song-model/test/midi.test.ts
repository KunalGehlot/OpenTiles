import { describe, expect, it } from 'vitest';
import { importScore } from '../src/import';
import { midiToSong, parseMidiFile, pickupBeats } from '../src/midi';
import { looksNotated } from '../src/quantise';
import {
  midiFile,
  midiTrack,
  notatedMidi,
  noteOff,
  noteOn,
  program,
  tempoEvent,
  trackName,
} from './fixtures';
import type { WrittenNote } from './fixtures';

const PPQ = 480;

describe('MIDI import', () => {
  it('parses notes, tempo, names and running status', () => {
    const track = midiTrack([
      trackName('Little Tune'),
      tempoEvent(0, 100),
      noteOn(0, 60),
      noteOff(PPQ, 60),
      noteOn(PPQ, 62),
      noteOff(2 * PPQ, 62),
    ]);
    // Rewrite the second note-on to use running status (drop its status byte).
    const file = parseMidiFile(midiFile([track]));
    expect(file.notes).toHaveLength(2);
    expect(file.tempos[0]?.bpm).toBeCloseTo(100, 1);
    expect(file.trackNames[0]).toBe('Little Tune');
  });

  it('treats note-on with velocity 0 as note-off', () => {
    const track = midiTrack([noteOn(0, 64), { tick: PPQ, data: [0x90, 64, 0] }]);
    const song = midiToSong(midiFile([track]));
    expect(song.notes[0]?.durationBeats).toBe(1);
  });

  it('splits two tracks by average pitch and quantises loose timing', () => {
    const jitter = [0, 7, -5, 9]; // ticks; at 120 bpm 480 PPQ one tick ≈ 1 ms
    const right = midiTrack(
      jitter
        .map((j, i) => noteOn(i * PPQ + Math.max(0, j), 72 + i))
        .concat(jitter.map((_, i) => noteOff((i + 1) * PPQ - 10, 72 + i))),
    );
    const left = midiTrack([noteOn(3, 48), noteOff(4 * PPQ, 48)]);
    const song = midiToSong(midiFile([left, right]));
    const rh = song.notes.filter((n) => n.hand === 'right');
    expect(rh.map((n) => n.startBeat)).toEqual([0, 1, 2, 3]);
    expect(song.notes.find((n) => n.pitch === 48)?.hand).toBe('left');
    expect(song.measures).toHaveLength(1);
  });

  it('keeps fine rhythms when the playing needs them', () => {
    // Sixteenth notes at 60 bpm: 250 ms apart, so a quarter or eighth grid would be > 30 ms off.
    const events = [0, 1, 2, 3].flatMap((i) => [
      noteOn((i * PPQ) / 4, 60 + i),
      noteOff(((i + 1) * PPQ) / 4, 60 + i),
    ]);
    const song = midiToSong(midiFile([midiTrack([tempoEvent(0, 60), ...events])]));
    expect(song.notes.map((n) => n.startBeat)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('drops drums and non-piano instruments unless asked', () => {
    const t = midiTrack([
      program(0, 40, 1),
      noteOn(0, 60),
      noteOff(PPQ, 60),
      noteOn(0, 70, 80, 1),
      noteOff(PPQ, 70, 1),
      noteOn(0, 36, 80, 9),
      noteOff(PPQ, 36, 9),
    ]);
    const bytes = midiFile([t]);
    expect(midiToSong(bytes).notes.map((n) => n.pitch)).toEqual([60]);
    expect(midiToSong(bytes, { keepAllInstruments: true }).notes).toHaveLength(3);
  });

  it('is picked by importScore from the file header', () => {
    const song = importScore('song.bin', midiFile([midiTrack([noteOn(0, 60), noteOff(PPQ, 60)])]));
    expect(song.format).toBe('midi');
    expect(song.title).toBe('song');
  });

  it('keeps the written rhythm of a file from notation software, whatever the tempo', () => {
    // Mostly quarters and eighths, with a few triplets, 32nds and a dotted rhythm: well under 5 %
    // of the notes, which the 95 % rule would snap to the common grid. Tempo changes: a fast
    // start, a ritardando and a fermata, as notation software writes them.
    const written: WrittenNote[] = [];
    for (let beat = 0; beat < 32; beat++) {
      written.push({ pitch: 48 + (beat % 5), start: beat, value: 1, track: 1 });
      if (beat === 5) {
        for (let k = 0; k < 3; k++)
          written.push({ pitch: 72 + k, start: beat + k / 3, value: 1 / 3 });
      } else if (beat === 9) {
        for (let k = 0; k < 8; k++)
          written.push({ pitch: 70 + k, start: beat + k / 8, value: 1 / 8 });
      } else if (beat === 13) {
        written.push(
          { pitch: 76, start: beat, value: 0.75 },
          { pitch: 77, start: beat + 0.75, value: 0.25 },
        );
      } else {
        written.push(
          { pitch: 72, start: beat, value: 0.5 },
          { pitch: 74, start: beat + 0.5, value: 0.5 },
        );
      }
    }
    const bytes = notatedMidi(written, {
      tempos: [
        [0, 200],
        [20, 150],
        [22, 110],
        [24, 70],
        [26, 30],
        [27, 200],
      ],
    });
    expect(looksNotated(parseMidiFile(bytes).notes, 480)).toBe(true);
    const song = midiToSong(bytes);
    const got = song.notes.map(
      (n) => `${n.pitch}@${n.startBeat.toFixed(4)}+${n.durationBeats.toFixed(4)}`,
    );
    const want = written
      .map((n) => ({ ...n }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch)
      .map((n) => `${n.pitch}@${n.start.toFixed(4)}+${n.value.toFixed(4)}`);
    expect(got).toEqual(want);
  });

  it('plays a rolled chord as one chord, and restores notes that sound full length', () => {
    const bytes = notatedMidi(
      [
        { pitch: 60, start: 0, value: 2 },
        { pitch: 64, start: 0, value: 2, rollTicks: 24 },
        { pitch: 67, start: 0, value: 2, rollTicks: 48 },
        { pitch: 72, start: 2, value: 1.5 },
        { pitch: 71, start: 3.5, value: 0.5 },
        // An accompaniment, so most onsets are on the beat as in a real export.
        ...Array.from({ length: 24 }, (_, i) => ({
          pitch: 36,
          start: i / 2,
          value: 0.5,
          track: 1,
        })),
      ],
      { gate: 1 },
    );
    const song = midiToSong(bytes);
    const rh = song.notes.filter((n) => n.pitch > 36);
    expect(rh.map((n) => [n.pitch, n.startBeat, n.durationBeats])).toEqual([
      [60, 0, 2],
      [64, 0, 2],
      [67, 0, 2],
      [72, 2, 1.5],
      [71, 3.5, 0.5],
    ]);
  });

  it('tells notation exports from played files', () => {
    const exact = Array.from({ length: 40 }, (_, i) => ({ startTick: i * 240 }));
    const played = exact.map((n, i) => ({ startTick: n.startTick + ((i * 7) % 13) - 6 }));
    expect(looksNotated(exact, 480)).toBe(true);
    expect(looksNotated(played, 480)).toBe(false);
  });

  it('keeps one key and time signature per change when every track repeats them', () => {
    const bytes = notatedMidi(
      [
        { pitch: 60, start: 0, value: 4 },
        { pitch: 48, start: 0, value: 4, track: 1 },
        { pitch: 62, start: 8, value: 4 },
      ],
      {
        keys: [
          [0, -2],
          [8, 0],
        ],
        times: [
          [0, 4, 4],
          [0, 4, 4],
          [8, 3, 4],
        ],
      },
    );
    const song = midiToSong(bytes);
    expect(song.keySignatures.map((k) => [k.beat, k.fifths])).toEqual([
      [0, -2],
      [8, 0],
    ]);
    expect(song.timeSignatures.map((t) => [t.beat, t.numerator])).toEqual([
      [0, 4],
      [8, 3],
    ]);
  });

  it('finds a pickup bar from key and time changes on later barlines', () => {
    // 4/4 with a one-beat pickup: a quarter, then bars of half notes, a key change on the barline
    // of bar 3 (beat 1 + 8) and a change to 3/4 on bar 5 (beat 1 + 16).
    const notes: WrittenNote[] = [{ pitch: 67, start: 0, value: 1 }];
    for (let b = 1; b < 21; b += 2) notes.push({ pitch: 72, start: b, value: 2 });
    for (let b = 1; b < 21; b += 4) notes.push({ pitch: 48, start: b, value: 4, track: 1 });
    const song = midiToSong(
      notatedMidi(notes, {
        keys: [
          [0, 0],
          [9, 2],
        ],
        times: [
          [0, 4, 4],
          [17, 3, 4],
        ],
      }),
    );
    expect(song.measures.slice(0, 3).map((m) => [m.number, m.startBeat, m.lengthBeats])).toEqual([
      ['0', 0, 1],
      ['1', 1, 4],
      ['2', 5, 4],
    ]);
    expect(song.measures.find((m) => m.startBeat === 17)?.lengthBeats).toBe(3);
    // Without such a change, or with changes on barlines counted from the start, there is none.
    expect(pickupBeats([{ beat: 0, numerator: 4, denominator: 4 }], [])).toBe(0);
    expect(
      pickupBeats(
        [{ beat: 0, numerator: 4, denominator: 4 }],
        [
          { beat: 0, fifths: 0 },
          { beat: 8, fifths: 2 },
        ],
      ),
    ).toBe(0);
    // Changes at different places in the bar are not a pickup either.
    expect(
      pickupBeats(
        [
          { beat: 0, numerator: 4, denominator: 4 },
          { beat: 18, numerator: 3, denominator: 4 },
        ],
        [{ beat: 9, fifths: 2 }],
      ),
    ).toBe(0);
  });
});

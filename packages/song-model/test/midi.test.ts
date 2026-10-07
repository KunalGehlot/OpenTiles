import { describe, expect, it } from 'vitest';
import { importScore } from '../src/import';
import { midiToSong, parseMidiFile } from '../src/midi';
import { midiFile, midiTrack, noteOff, noteOn, program, tempoEvent, trackName } from './fixtures';

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
});

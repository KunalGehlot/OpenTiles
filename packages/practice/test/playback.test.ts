import type { Song, SongNote } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import { buildPlayback, DEFAULT_VELOCITY, PlaybackCursor } from '../src/playback';
import type { PlaybackEvent, TimedPlaybackNote } from '../src/playback';

const n = (
  pitch: number,
  startBeat: number,
  hand: 'left' | 'right',
  durationBeats = 1,
  velocity?: number,
): SongNote => ({
  id: `${pitch}@${startBeat}`,
  pitch,
  startBeat,
  durationBeats,
  hand,
  staff: hand === 'right' ? 1 : 2,
  voice: 1,
  part: 0,
  measureIndex: Math.floor(startBeat / 4),
  sourceRefs: [],
  ...(velocity === undefined ? {} : { velocity }),
});

// 120 bpm: half a second a beat.
const song = (notes: SongNote[], extra: Partial<Song> = {}): Song => ({
  title: 'Test',
  format: 'musicxml',
  notes,
  measures: [
    { index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: 4 },
    { index: 1, number: '2', sourceIndex: 1, startBeat: 4, lengthBeats: 4 },
  ],
  tempos: [{ beat: 0, bpm: 120 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  keySignatures: [],
  parts: [{ name: 'Piano' }],
  lengthBeats: 8,
  warnings: [],
  ...extra,
});

const piece = song([
  n(48, 0, 'left', 4),
  n(64, 0, 'right'),
  n(67, 0, 'right'),
  n(65, 1, 'right'),
  n(62, 2, 'right', 2, 100),
  n(43, 4, 'left'),
  n(64, 4, 'right'),
]);

const pitches = (events: readonly PlaybackEvent[]) =>
  events.map((e) => (e.kind === 'note' ? e.pitch : e.pedal));
const notes = (events: readonly PlaybackEvent[]) =>
  events.filter((e): e is TimedPlaybackNote => e.kind === 'note');

describe('buildPlayback (P6-03)', () => {
  it('times every note in song seconds, with its velocity', () => {
    const events = buildPlayback(piece);
    expect(pitches(events)).toEqual([48, 64, 67, 65, 62, 43, 64]);
    expect(events[0]).toEqual({
      kind: 'note',
      pitch: 48,
      start: 0,
      end: 2,
      velocity: DEFAULT_VELOCITY,
      hand: 'left',
      noteId: '48@0',
    });
    const d = events[4];
    expect(d && d.kind === 'note' && [d.start, d.end, d.velocity]).toEqual([1, 2, 100]);
  });

  it('follows the tempo map', () => {
    // 60 bpm from bar 2: a beat there lasts a second.
    const slower = song(piece.notes, {
      tempos: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
      ],
    });
    const last = buildPlayback(slower).at(-1);
    expect(last && last.kind === 'note' && [last.start, last.end]).toEqual([2, 3]);
  });

  it('plays the chosen hands, or the other hand to accompany them', () => {
    expect(pitches(buildPlayback(piece, { hands: 'left' }))).toEqual([48, 43]);
    expect(pitches(buildPlayback(piece, { hands: 'left', accompany: true }))).toEqual([
      64, 67, 65, 62, 64,
    ]);
    // Accompanying both hands leaves nothing to play.
    expect(buildPlayback(piece, { accompany: true })).toEqual([]);
  });

  it('keeps to a loop’s bars', () => {
    expect(pitches(buildPlayback(piece, { fromBeat: 1, toBeat: 4 }))).toEqual([65, 62]);
    expect(pitches(buildPlayback(piece, { fromBeat: 4 }))).toEqual([43, 64]);
  });

  it('plays a pickup bar from its first note, and an empty song as nothing', () => {
    const pickup = song([n(67, 0, 'right'), n(72, 1, 'right')], {
      measures: [
        { index: 0, number: '0', sourceIndex: 0, startBeat: 0, lengthBeats: 1 },
        { index: 1, number: '1', sourceIndex: 1, startBeat: 1, lengthBeats: 4 },
      ],
      lengthBeats: 5,
    });
    const cursor = new PlaybackCursor(buildPlayback(pickup), { time: 10, seconds: 0 });
    expect(notes(cursor.take(10.6)).map((e) => [e.pitch, e.time])).toEqual([
      [67, 10],
      [72, 10.5],
    ]);
    const empty = new PlaybackCursor(buildPlayback(song([])), { time: 0, seconds: 0 });
    expect(empty.done).toBe(true);
    expect(empty.take(100)).toEqual([]);
  });
});

describe('PlaybackCursor (P6-03)', () => {
  it('hands out what is due before the look-ahead, once', () => {
    const cursor = new PlaybackCursor(buildPlayback(piece), { time: 10, seconds: 0 });
    expect(pitches(cursor.take(10.3))).toEqual([48, 64, 67]);
    expect(pitches(cursor.take(10.3))).toEqual([]);
    const next = notes(cursor.take(10.6));
    expect(next.map((e) => [e.pitch, e.time, e.duration])).toEqual([[65, 10.5, 0.5]]);
  });

  it('starts from the anchor, so a loop plays from its first bar', () => {
    const events = buildPlayback(piece, { fromBeat: 4 });
    const cursor = new PlaybackCursor(events, { time: 0, seconds: 2 }, 0.5);
    // At half speed, beat 4 (two song seconds) plays at once, each note twice as long.
    expect(notes(cursor.take(0.01)).map((e) => [e.pitch, e.time, e.duration])).toEqual([
      [43, 0, 1],
      [64, 0, 1],
    ]);
  });

  it('skips notes that are late, as a busy page would otherwise play a burst', () => {
    const cursor = new PlaybackCursor(buildPlayback(piece), { time: 0, seconds: 0 });
    // The page was away for 1.2 s: the notes at 0, 0.5 and 1 s are gone; 2 s is still ahead.
    expect(pitches(cursor.take(1.5, 1.2))).toEqual([]);
    expect(pitches(cursor.take(2.1, 2))).toEqual([43, 64]);
  });

  it('seeks into a held note and plays what is left of it', () => {
    const cursor = new PlaybackCursor(buildPlayback(piece), { time: 0, seconds: 0 });
    const { sounding } = cursor.seek(1.25, 20);
    // The left hand's C (0–2 s) and the D (1–2 s) are sounding at 1.25 s.
    expect(sounding.map((e) => [e.pitch, e.time, e.duration])).toEqual([
      [48, 20, 0.75],
      [62, 20, 0.75],
    ]);
    // Then it goes on from there on the new anchor.
    expect(notes(cursor.take(21)).map((e) => [e.pitch, e.time])).toEqual([
      [43, 20.75],
      [64, 20.75],
    ]);
  });

  it('changes tempo in the middle of a note without a jump', () => {
    const cursor = new PlaybackCursor(buildPlayback(piece), { time: 0, seconds: 0 });
    cursor.take(0.6);
    // At clock 0.75 the music is at 0.75 s; from there on it plays at half speed.
    cursor.setTempo(0.5, 0.75);
    expect(cursor.secondsAt(0.75)).toBeCloseTo(0.75);
    const d = notes(cursor.take(2)).map((e) => [e.pitch, e.time, e.duration]);
    // The D at 1 s comes 0.25 song seconds later, which now takes 0.5 s, and lasts twice as long.
    expect(d).toEqual([[62, 1.25, 2]]);
    expect(cursor.factor).toBe(0.5);
  });

  it('never skips pedal events, and knows the pedals’ position after a seek', () => {
    const events: PlaybackEvent[] = [
      { kind: 'pedal', start: 0, pedal: 'sustain', value: 127 } as const,
      ...buildPlayback(piece),
      { kind: 'pedal', start: 1.75, pedal: 'sustain', value: 0 } as const,
      { kind: 'pedal', start: 1.75, pedal: 'soft', value: 100 } as const,
    ].sort((a, b) => a.start - b.start);
    const late = new PlaybackCursor(events, { time: 0, seconds: 0 });
    const taken = late.take(1, 1);
    expect(taken.filter((e) => e.kind === 'pedal').map((e) => e.start)).toEqual([0]);
    // The notes at 0 and 0.5 s are late; the D at 1 s is not.
    expect(pitches(notes(taken))).toEqual([62]);
    const seeking = new PlaybackCursor(events, { time: 0, seconds: 0 });
    expect(seeking.seek(1, 5).pedals).toEqual({ sustain: 127, soft: 0, sostenuto: 0 });
    expect(seeking.seek(2, 5).pedals).toEqual({ sustain: 0, soft: 100, sostenuto: 0 });
  });
});

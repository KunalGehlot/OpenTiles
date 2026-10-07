import type { Song, SongNote } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/events';
import { PlayAlongScorer, windowScale } from '../src/play-along';
import { accompanimentBetween, buildSteps } from '../src/steps';
import { summarise } from '../src/summary';
import { Timeline } from '../src/timeline';
import { WaitMode } from '../src/wait-mode';

const n = (
  pitch: number,
  startBeat: number,
  hand: 'left' | 'right',
  measureIndex = 0,
): SongNote => ({
  id: `${pitch}@${startBeat}`,
  pitch,
  startBeat,
  durationBeats: 1,
  hand,
  staff: hand === 'right' ? 1 : 2,
  voice: 1,
  part: 0,
  measureIndex,
  sourceRefs: [],
});

const song: Song = {
  title: 'Test',
  format: 'musicxml',
  notes: [
    n(48, 0, 'left'),
    n(64, 0, 'right'),
    n(67, 0, 'right'),
    n(65, 1, 'right'),
    n(43, 2, 'left', 0),
    n(64, 4, 'right', 1),
  ],
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
};

const ev = (pitch: number, time = 0): NoteEvent => ({
  pitch,
  time,
  confidence: 1,
  source: 'touch',
});

describe('buildSteps', () => {
  it('groups simultaneous notes and filters hands', () => {
    expect(buildSteps(song).map((s) => s.pitches)).toEqual([[48, 64, 67], [65], [43], [64]]);
    expect(buildSteps(song, 'right').map((s) => s.pitches)).toEqual([[64, 67], [65], [64]]);
    expect(buildSteps(song, 'left', { fromBeat: 1 }).map((s) => s.beat)).toEqual([2]);
  });
  it('finds the other hand to accompany', () => {
    expect(accompanimentBetween(song, 'right', 0, 4).map((x) => x.pitch)).toEqual([48, 43]);
    expect(accompanimentBetween(song, 'both', 0, 4)).toEqual([]);
  });
});

describe('WaitMode', () => {
  it('waits for the whole chord, in any order', () => {
    const w = new WaitMode(buildSteps(song, 'right'));
    const seen: number[] = [];
    w.onStep = (s) => seen.push(s?.index ?? -1);
    expect(w.handle(ev(67))).toMatchObject({ kind: 'correct', completed: false });
    expect(w.remaining).toEqual([64]);
    expect(w.handle(ev(67))).toMatchObject({ kind: 'repeat' });
    expect(w.handle(ev(64))).toMatchObject({ kind: 'correct', completed: true });
    expect(w.index).toBe(1);
    expect(seen).toEqual([1]);
  });

  it('counts wrong notes without advancing', () => {
    const w = new WaitMode(buildSteps(song, 'right'));
    expect(w.handle(ev(66))).toMatchObject({ kind: 'wrong', pitch: 66, step: 0 });
    expect(w.index).toBe(0);
    expect(w.stats.wrong).toBe(1);
    expect(w.stats.wrongByMeasure.get(0)).toBe(1);
  });

  it('finishes after the last step', () => {
    const w = new WaitMode(buildSteps(song, 'left'));
    w.handle(ev(48));
    w.handle(ev(43));
    expect(w.finished).toBe(true);
    expect(w.handle(ev(43))).toEqual({ kind: 'finished' });
    w.reset();
    expect(w.index).toBe(0);
    expect(w.stats.correct).toBe(0);
  });
});

describe('PlayAlongScorer', () => {
  const notes = [
    { id: 'a', pitch: 60, time: 1.0, measureIndex: 0 },
    { id: 'b', pitch: 62, time: 1.5, measureIndex: 0 },
    { id: 'c', pitch: 64, time: 2.0, measureIndex: 1 },
  ];

  it('judges hit, early, late and missed', () => {
    const s = new PlayAlongScorer(notes);
    expect(s.handle(ev(60, 1.05))).toMatchObject({ kind: 'judged', result: { judgement: 'hit' } });
    expect(s.handle(ev(62, 1.38))).toMatchObject({
      kind: 'judged',
      result: { judgement: 'early' },
    });
    expect(s.update(2.1)).toEqual([]);
    expect(s.update(2.2).map((r) => r.note.id)).toEqual(['c']);
    expect(s.handle(ev(64, 2.3))).toMatchObject({ kind: 'extra' });
  });

  it('compensates input latency and widens windows when slow', () => {
    const s = new PlayAlongScorer(notes, { latency: 0.1 });
    expect(s.handle(ev(60, 1.1))).toMatchObject({ result: { judgement: 'hit' } });
    expect(windowScale(1)).toBe(1);
    expect(windowScale(0.25)).toBe(2);
    const slow = new PlayAlongScorer(notes, { tempoFactor: 0.25 });
    expect(slow.handle(ev(60, 1.14))).toMatchObject({ result: { judgement: 'hit' } });
  });

  it('summarises a run', () => {
    const s = new PlayAlongScorer(notes);
    s.handle(ev(60, 1.0));
    s.handle(ev(62, 1.6));
    s.finish();
    const sum = summarise(s.results);
    expect(sum).toMatchObject({ notes: 3, hit: 1, late: 1, missed: 1 });
    expect(sum.accuracy).toBeCloseTo(2 / 3);
    expect(sum.meanOffsetMs).toBeCloseTo(50);
    expect(sum.hardestMeasures.map((m) => m.measureIndex)).toEqual([0, 1]);
  });
});

describe('Timeline', () => {
  it('maps beats to the practice clock at a tempo factor', () => {
    const t = new Timeline(song, 0.5, 10, 0);
    expect(t.timeOf(2)).toBeCloseTo(12);
    expect(t.beatAt(12)).toBeCloseTo(2);
    expect(t.timedNotes(song, 'left').map((x) => x.time)).toEqual([10, 12]);
  });
});

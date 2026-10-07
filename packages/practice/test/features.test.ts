// Tests for the metronome, loop, step-practice and calibration helpers. Songs are generated in
// code (AGENTS.md: no third-party material in fixtures).
import type { Measure, Song, SongNote, TimeSignatureEvent } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import { clickTrain, latencyFromAnswers, median, micLevelVerdict, rmsDb } from '../src/calibration';
import {
  isCleanRun,
  LoopTrainer,
  loopBeats,
  loopFromBeats,
  measureAtBeat,
  nextLoopTempo,
  normaliseLoop,
} from '../src/loop';
import { metronomeClicks, pulseOf } from '../src/metronome';
import { boundaryStrength, splitPhrases, StepPractice } from '../src/phrases';
import { PlayAlongScorer } from '../src/play-along';

let nextId = 0;
const note = (
  pitch: number,
  startBeat: number,
  durationBeats = 1,
  hand: 'left' | 'right' = 'right',
): SongNote => ({
  id: `n${nextId++}`,
  pitch,
  startBeat,
  durationBeats,
  hand,
  staff: hand === 'right' ? 1 : 2,
  voice: 1,
  part: 0,
  measureIndex: 0,
  sourceRefs: [],
});

/** A song of `bars` equal bars; notes get their measure index from their start. */
function makeSong(
  bars: number,
  notes: SongNote[],
  ts: TimeSignatureEvent[] = [{ beat: 0, numerator: 4, denominator: 4 }],
  barLength = 4,
  firstBarLength = barLength,
): Song {
  const measures: Measure[] = [];
  let beat = 0;
  for (let i = 0; i < bars; i++) {
    const len = i === 0 ? firstBarLength : barLength;
    measures.push({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: beat,
      lengthBeats: len,
    });
    beat += len;
  }
  const song: Song = {
    title: 'Generated',
    format: 'musicxml',
    notes: [],
    measures,
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: ts,
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: beat,
    warnings: [],
  };
  song.notes = notes.map((n) => ({ ...n, measureIndex: measureAtBeat(song, n.startBeat) }));
  return song;
}

/** Quarter notes on every beat of every bar. */
const steadyQuarters = (bars: number) =>
  Array.from({ length: bars * 4 }, (_, i) => note(60 + (i % 5), i));

describe('metronome', () => {
  it('counts simple and compound metres', () => {
    expect(pulseOf({ numerator: 4, denominator: 4 })).toEqual({ unit: 1, perBar: 4 });
    expect(pulseOf({ numerator: 3, denominator: 4 })).toEqual({ unit: 1, perBar: 3 });
    expect(pulseOf({ numerator: 6, denominator: 8 })).toEqual({ unit: 1.5, perBar: 2 });
    expect(pulseOf({ numerator: 3, denominator: 8 })).toEqual({ unit: 0.5, perBar: 3 });
    expect(pulseOf({ numerator: 2, denominator: 2 })).toEqual({ unit: 2, perBar: 2 });
  });

  it('accents the downbeat of each bar', () => {
    const song = makeSong(2, steadyQuarters(2));
    const clicks = metronomeClicks(song, 0, song.lengthBeats);
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 4]);
  });

  it('follows time signature changes and limits to the range', () => {
    const song = makeSong(
      3,
      [],
      [
        { beat: 0, numerator: 3, denominator: 4 },
        { beat: 3, numerator: 6, denominator: 8 },
      ],
      3,
    );
    const clicks = metronomeClicks(song, 0, 9);
    expect(clicks.map((c) => [c.beat, c.accent])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, true],
      [4.5, false],
      [6, true],
      [7.5, false],
    ]);
    expect(metronomeClicks(song, 4, 6.5).map((c) => c.beat)).toEqual([4.5, 6]);
  });

  it('counts a pickup bar from its end without a downbeat accent', () => {
    const song = makeSong(2, [], undefined, 4, 1);
    const clicks = metronomeClicks(song, 0, song.lengthBeats);
    expect(clicks[0]).toEqual({ beat: 0, accent: false });
    expect(clicks[1]).toEqual({ beat: 1, accent: true });
  });
});

describe('loop', () => {
  const song = makeSong(4, steadyQuarters(4));

  it('maps beats to bars and bars to beats', () => {
    expect(measureAtBeat(song, 0)).toBe(0);
    expect(measureAtBeat(song, 5.5)).toBe(1);
    expect(measureAtBeat(song, 100)).toBe(3);
    expect(loopFromBeats(song, 9, 2)).toEqual({ fromMeasure: 0, toMeasure: 2 });
    expect(loopBeats(song, { fromMeasure: 1, toMeasure: 2 })).toEqual({ fromBeat: 4, toBeat: 12 });
    expect(normaliseLoop(song, 7, -2)).toEqual({ fromMeasure: 0, toMeasure: 3 });
  });

  it('calls a run clean only without wrong or missed notes', () => {
    expect(isCleanRun({ wrong: 0, missed: 0 })).toBe(true);
    expect(isCleanRun({ wrong: 1, missed: 0 })).toBe(false);
    expect(isCleanRun({ wrong: 0, missed: 2 })).toBe(false);
  });

  it('raises the tempo by 5 % per clean run up to 100 %', () => {
    const auto = { autoTempo: true };
    expect(nextLoopTempo(0.5, true, auto)).toBe(0.55);
    expect(nextLoopTempo(0.5, false, auto)).toBe(0.5);
    expect(nextLoopTempo(0.5, true, {})).toBe(0.5);
    expect(nextLoopTempo(0.98, true, auto)).toBe(1);
    expect(nextLoopTempo(1.2, true, auto)).toBe(1.2);
    let t = 0.5;
    for (let i = 0; i < 20; i++) t = nextLoopTempo(t, true, auto);
    expect(t).toBe(1);
  });

  it('tracks runs and clean streaks', () => {
    const trainer = new LoopTrainer({ autoTempo: true });
    const clean = { wrong: 0, missed: 0, accuracy: 1 };
    expect(trainer.record(clean, 0.6)).toEqual({
      run: 1,
      clean: true,
      streak: 1,
      tempo: 0.65,
      raised: true,
    });
    expect(trainer.record({ wrong: 1, missed: 0, accuracy: 0.9 }, 0.65)).toMatchObject({
      clean: false,
      streak: 0,
      tempo: 0.65,
      raised: false,
    });
    expect(trainer.runs).toBe(2);
    expect(trainer.cleanRuns).toBe(1);
  });
});

describe('phrases', () => {
  it('splits a piece with no cues into four-bar phrases', () => {
    const song = makeSong(8, steadyQuarters(8));
    expect(splitPhrases(song).map((p) => [p.fromMeasure, p.toMeasure])).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it('ends a phrase at a rest', () => {
    // Bar 2 (index 1) ends with a rest on beat 4; everything else is steady.
    const notes = steadyQuarters(6).filter((n) => n.startBeat !== 7);
    const song = makeSong(6, notes);
    expect(boundaryStrength(song, song.notes, 1)).toBeGreaterThanOrEqual(2);
    expect(boundaryStrength(song, song.notes, 2)).toBe(0);
    expect(splitPhrases(song).map((p) => [p.fromMeasure, p.toMeasure])).toEqual([
      [0, 1],
      [2, 5],
    ]);
  });

  it('ends a phrase at a long note', () => {
    const notes = [
      ...steadyQuarters(9).filter((n) => n.startBeat < 8 || n.startBeat >= 12),
      note(67, 8, 4),
    ];
    const song = makeSong(9, notes);
    const phrases = splitPhrases(song);
    expect(phrases[0]).toMatchObject({ fromMeasure: 0, toMeasure: 2, fromBeat: 0, toBeat: 12 });
    // Every bar is covered exactly once, in order.
    const covered = phrases.flatMap((p) =>
      Array.from({ length: p.toMeasure - p.fromMeasure + 1 }, (_, i) => p.fromMeasure + i),
    );
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const p of phrases) expect(p.toMeasure - p.fromMeasure + 1).toBeGreaterThanOrEqual(2);
  });

  it('keeps short pieces in one phrase and never leaves a one-bar tail', () => {
    expect(splitPhrases(makeSong(3, steadyQuarters(3)))).toHaveLength(1);
    const five = splitPhrases(makeSong(5, steadyQuarters(5)));
    expect(five.map((p) => p.toMeasure - p.fromMeasure + 1)).not.toContain(1);
  });

  it('suggests the next phrase once accuracy reaches 90 %', () => {
    const song = makeSong(8, steadyQuarters(8));
    const sp = new StepPractice(splitPhrases(song));
    expect(sp.record(0.85)).toMatchObject({ suggestNext: false, pieceDone: false });
    expect(sp.record(0.9)).toMatchObject({ suggestNext: true, pieceDone: false });
    expect(sp.best[0]).toBe(0.9);
    expect(sp.next()?.fromMeasure).toBe(4);
    expect(sp.record(1)).toMatchObject({ suggestNext: false, pieceDone: true });
    expect(sp.next()?.index).toBe(1);
    expect(sp.previous()?.index).toBe(0);
  });
});

describe('calibration', () => {
  it('takes the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it('finds the median answer delay and ignores stray answers', () => {
    const clicks = clickTrain(1, 8, 0.75);
    const answers = clicks.map((c, i) => c + (i === 3 ? 0.3 : 0.04 + (i % 2) * 0.01));
    answers.push(2.1); // a stray key press between clicks
    const r = latencyFromAnswers(clicks, answers);
    expect(r.matched).toBe(8);
    expect(r.latency).toBeCloseTo(0.045, 3);
  });

  it('needs at least half the clicks answered', () => {
    const clicks = clickTrain(0, 8, 1);
    expect(latencyFromAnswers(clicks, [0.05, 1.05, 2.05]).latency).toBeNull();
    expect(latencyFromAnswers(clicks, []).matched).toBe(0);
  });

  it('clamps anticipation to zero', () => {
    const clicks = clickTrain(0, 4, 1);
    expect(
      latencyFromAnswers(
        clicks,
        clicks.map((c) => c - 0.05),
      ).latency,
    ).toBe(0);
  });

  it('judges the microphone level', () => {
    expect(micLevelVerdict(-60, -20)).toBe('ok');
    expect(micLevelVerdict(-60, -50)).toBe('quiet');
    expect(micLevelVerdict(-60, -1)).toBe('loud');
    expect(micLevelVerdict(-30, -10)).toBe('noisy');
    expect(micLevelVerdict(-60, -Infinity)).toBe('unknown');
    expect(rmsDb(new Float32Array([0.5, -0.5]))).toBeCloseTo(-6.02, 1);
    expect(rmsDb(new Float32Array(4))).toBe(-Infinity);
  });
});

describe('per-source latency', () => {
  it('compensates each input by its own latency', () => {
    const scorer = new PlayAlongScorer(
      [
        { id: 'a', pitch: 60, time: 1, measureIndex: 0 },
        { id: 'b', pitch: 62, time: 2, measureIndex: 0 },
      ],
      { latencyBySource: { midi: 0.02, microphone: 0.12 } },
    );
    const a = scorer.handle({ pitch: 60, time: 1.02, confidence: 1, source: 'midi' });
    const b = scorer.handle({ pitch: 62, time: 2.12, confidence: 0.8, source: 'microphone' });
    expect(a.kind === 'judged' && a.result.offset).toBeCloseTo(0, 6);
    expect(b.kind === 'judged' && b.result.offset).toBeCloseTo(0, 6);
  });

  it('waits for the slowest input before calling a note missed', () => {
    const scorer = new PlayAlongScorer([{ id: 'a', pitch: 60, time: 1, measureIndex: 0 }], {
      latencyBySource: { microphone: 0.2 },
    });
    expect(scorer.update(1.25)).toHaveLength(0);
    expect(scorer.update(1.4)).toHaveLength(1);
  });
});

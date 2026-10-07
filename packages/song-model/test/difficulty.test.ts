// Difficulty estimate (P2-05). Tunes are self-made ABC snippets (CC0); the catalogue check uses
// the public-domain arrangements in catalogue/pieces.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAbc } from '../src/abc';
import { estimateDifficulty } from '../src/difficulty';
import { importScore } from '../src/import';
import type { Song, SongNote } from '../src/types';
import { domParser } from './fixtures';

const piecesDir = fileURLToPath(new URL('../../../catalogue/pieces/', import.meta.url));

describe('estimateDifficulty on the catalogue', () => {
  const pieces = readdirSync(piecesDir).map((slug) => {
    const prov = JSON.parse(readFileSync(`${piecesDir}${slug}/provenance.json`, 'utf8')) as {
      score_file: string;
      difficulty: number;
    };
    const bytes = readFileSync(`${piecesDir}${slug}/${prov.score_file}`);
    const song = importScore(prov.score_file, new Uint8Array(bytes), { domParser });
    return { slug, recorded: prov.difficulty, estimate: estimateDifficulty(song) };
  });

  it.each(pieces)('$slug is within one level of its recorded difficulty', (p) => {
    expect(Math.abs(p.estimate.level - p.recorded)).toBeLessThanOrEqual(1);
  });

  it('puts the beginner arrangements on levels 1–2', () => {
    for (const p of pieces.filter((x) => x.recorded <= 2)) {
      expect(p.estimate.level, p.slug).toBeGreaterThanOrEqual(1);
      expect(p.estimate.level, p.slug).toBeLessThanOrEqual(2);
    }
  });
});

const header = (meter: string, tempo: number) => `X:1\nT:t\nM:${meter}\nL:1/16\nQ:1/4=${tempo}\n`;

describe('estimateDifficulty levels', () => {
  it('rates a slow one-hand melody as level 1', () => {
    const song = parseAbc(`${header('4/4', 90)}K:C\nC4 D4 E4 F4 | G8 G8 | E4 E4 D4 D4 | C16 |]\n`);
    const d = estimateDifficulty(song);
    expect(d.level).toBe(1);
    expect(d.measures.maxSimultaneous).toBe(1);
    expect(d.measures.handIndependence).toBe(0);
  });

  it('rates running sixteenths over chords in E major as intermediate', () => {
    const rh = 'efge fgaf gabg afge | efge fgaf gabg afge |';
    const lh =
      '[E,G,B,]4 [E,G,B,]4 [A,,C,E,]4 [B,,D,F,]4 | [E,G,B,]4 [A,,C,E,]4 [B,,D,F,]4 [E,G,B,]4 |';
    const song = parseAbc(
      `${header('4/4', 96)}V:1 clef=treble\nV:2 clef=bass\nK:E\n[V:1] ${rh} ${rh}\n[V:2] ${lh} ${lh}\n`,
    );
    const d = estimateDifficulty(song);
    expect(d.measures.accidentals).toBe(4);
    expect(d.measures.maxSimultaneous).toBe(3);
    expect(d.level).toBeGreaterThanOrEqual(3);
    expect(d.level).toBeLessThanOrEqual(4);
  });

  it('rates interleaved hands, wide chords, triplets and six flats as level 4', () => {
    const rh = '(3c2e2g2 (3c2e2g2 z2 [CEGc]2 z2 [DFAd]2 | (3d2f2a2 z2 [EGBe]2 z c3 z2 c2 |';
    const lh = 'C,2 z2 [C,G,C]2 z2 E,2 z2 G,2 z2 | [D,,A,,D,]2 z2 F,2 z2 [E,,B,,E,]2 z2 A,2 z2 |';
    const song = parseAbc(
      `${header('4/4', 152)}V:1 clef=treble\nV:2 clef=bass\nK:Gb\n[V:1] ${rh} ${rh} ${rh}\n[V:2] ${lh} ${lh} ${lh}\n`,
    );
    const d = estimateDifficulty(song);
    expect(d.measures.accidentals).toBe(6);
    expect(d.measures.maxSimultaneous).toBe(4);
    expect(d.measures.maxStretch).toBeGreaterThanOrEqual(12);
    expect(d.measures.rhythmComplexity).toBeGreaterThanOrEqual(2);
    expect(d.measures.handIndependence).toBeGreaterThan(0.3);
    expect(d.level).toBe(4);
  });

  it('rates fast running sixteenths with chords, triplets and six flats as level 5', () => {
    const rh = 'cdef gfed cdef gfed | (3c2B2A2 (3G2F2E2 [CEGc]4 [EGce]4 |';
    const lh =
      '[C,,C,]4 [G,,D,G,]4 [C,,C,]4 [G,,D,G,]4 | [C,,C,]4 [G,,D,G,]4 [C,,C,]4 [G,,D,G,]4 |';
    const song = parseAbc(
      `${header('4/4', 160)}V:1 clef=treble\nV:2 clef=bass\nK:Gb\n[V:1] ${rh} ${rh}\n[V:2] ${lh} ${lh}\n`,
    );
    const d = estimateDifficulty(song);
    expect(d.measures.notesPerSecond).toBeGreaterThan(9);
    expect(d.level).toBe(5);
  });

  it('returns level 1 for a song without notes', () => {
    const song = parseAbc('X:1\nK:C\nz4|\n');
    expect(estimateDifficulty(song)).toMatchObject({ level: 1, measures: { notesPerSecond: 0 } });
  });
});

/** A one-bar-per-four-beats song from notes, as a MIDI import would give (no key signature). */
function songOf(notes: Partial<SongNote>[], bpm = 120): Song {
  const full: SongNote[] = notes.map((n, i) => ({
    id: `n${i}`,
    pitch: 60,
    startBeat: 0,
    durationBeats: 1,
    hand: 'right',
    staff: 1,
    voice: 1,
    part: 0,
    measureIndex: 0,
    sourceRefs: [],
    ...n,
  }));
  const length = Math.max(4, ...full.map((n) => n.startBeat + n.durationBeats));
  const bars = Math.ceil(length / 4);
  for (const n of full) n.measureIndex = Math.floor(n.startBeat / 4);
  return {
    title: 't',
    format: 'midi',
    notes: full,
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: i * 4,
      lengthBeats: 4,
    })),
    tempos: [{ beat: 0, bpm }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: bars * 4,
    warnings: [],
  };
}

describe('estimateDifficulty measures', () => {
  it('counts onsets per second in the busier hand, a chord once', () => {
    // Eight eighth-note chords in one bar at 120 bpm: 8 onsets in 2 s.
    const notes = Array.from({ length: 8 }, (_, i) => [
      { pitch: 60, startBeat: i / 2, durationBeats: 0.5 },
      { pitch: 64, startBeat: i / 2, durationBeats: 0.5 },
    ]).flat();
    expect(estimateDifficulty(songOf(notes)).measures.notesPerSecond).toBe(4);
  });

  it('measures the widest held interval and the largest chord per hand', () => {
    const song = songOf([
      { pitch: 48, startBeat: 0, durationBeats: 4, hand: 'left' },
      { pitch: 64, startBeat: 2, durationBeats: 1, hand: 'left' },
      { pitch: 60, startBeat: 0, hand: 'right' },
      { pitch: 64, startBeat: 0, hand: 'right' },
      { pitch: 67, startBeat: 0, hand: 'right' },
      { pitch: 84, startBeat: 1, hand: 'right' },
    ]);
    const d = estimateDifficulty(song);
    expect(d.measures.maxStretch).toBe(16); // C3 held under E4 in the left hand
    expect(d.measures.maxSimultaneous).toBe(3);
  });

  it('estimates the key from the notes when the file has none', () => {
    const scale = [62, 64, 66, 67, 69, 71, 73, 74]; // D major
    const d = estimateDifficulty(songOf(scale.map((pitch, i) => ({ pitch, startBeat: i }))));
    expect(d.measures.accidentals).toBe(2);
    const white = estimateDifficulty(
      songOf([60, 62, 64].map((pitch, i) => ({ pitch, startBeat: i }))),
    );
    expect(white.measures.accidentals).toBe(0);
  });

  it('scores subdivision, tuplets and syncopation', () => {
    const quarters = songOf([0, 1, 2, 3].map((startBeat) => ({ startBeat })));
    expect(estimateDifficulty(quarters).measures.rhythmComplexity).toBe(0);
    const sixteenths = songOf(
      Array.from({ length: 16 }, (_, i) => ({ startBeat: i / 4, durationBeats: 0.25 })),
    );
    expect(estimateDifficulty(sixteenths).measures.rhythmComplexity).toBe(2);
    const triplets = songOf(
      Array.from({ length: 12 }, (_, i) => ({ startBeat: i / 3, durationBeats: 1 / 3 })),
    );
    expect(estimateDifficulty(triplets).measures.rhythmComplexity).toBe(1);
    // Eighth, quarter, quarter, quarter, eighth: the quarters are held across the beats.
    const syncopated = songOf([
      { startBeat: 0, durationBeats: 0.5 },
      { startBeat: 0.5, durationBeats: 1 },
      { startBeat: 1.5, durationBeats: 1 },
      { startBeat: 2.5, durationBeats: 1 },
      { startBeat: 3.5, durationBeats: 0.5 },
    ]);
    expect(estimateDifficulty(syncopated).measures.rhythmComplexity).toBe(2);
  });

  it('counts interleaved hands as independent, but not a melody over an Alberti bass', () => {
    const melody = [0, 1, 2, 3].map((startBeat) => ({
      pitch: 72,
      startBeat,
      hand: 'right' as const,
    }));
    const alberti = Array.from({ length: 8 }, (_, i) => ({
      pitch: [48, 55, 52, 55][i % 4] ?? 48,
      startBeat: i / 2,
      durationBeats: 0.5,
      hand: 'left' as const,
    }));
    expect(estimateDifficulty(songOf([...melody, ...alberti])).measures.handIndependence).toBe(0);
    const offbeat = [0, 1, 2, 3].map((b) => ({
      pitch: 72,
      startBeat: b + 0.5,
      durationBeats: 0.5,
      hand: 'right' as const,
    }));
    const onbeat = [0, 1, 2, 3].map((b) => ({
      pitch: 48,
      startBeat: b,
      durationBeats: 0.5,
      hand: 'left' as const,
    }));
    const both = [0, 1, 2, 3].map((b) => ({
      pitch: 76,
      startBeat: b + 0.75,
      durationBeats: 0.25,
      hand: 'left' as const,
    }));
    expect(
      estimateDifficulty(songOf([...offbeat, ...onbeat, ...both])).measures.handIndependence,
    ).toBe(1);
  });
});

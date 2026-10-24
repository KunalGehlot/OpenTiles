import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXml } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import {
  addScaleRound,
  buildSteps,
  drillScales,
  evennessOf,
  evennessWord,
  generateScaleDrill,
  hardestScales,
  isChordDrillId,
  isScaleDrillId,
  normaliseScaleDrillOptions,
  normaliseScaleStats,
  NO_SCALE_STATS,
  parseDrillId,
  parseScaleDrillId,
  SCALE_DRILL_DEFAULTS,
  SCALE_LEVELS,
  scaleDrillEntries,
  scaleDrillId,
  scaleKind,
  scaleLevelEntries,
  scaleMissCause,
  scaleRoundOf,
  scaleSteps,
  ScaleTally,
  weakScales,
} from '../src';
import type { NoteResult, ScaleDrillOptions, ScaleStep } from '../src';

type DomParser = NonNullable<Parameters<typeof parseMusicXml>[1]>['domParser'];
const parse = (xml: string) =>
  parseMusicXml(xml, { domParser: new DOMParser() as unknown as DomParser });
const options = (o: Partial<ScaleDrillOptions>): ScaleDrillOptions =>
  normaliseScaleDrillOptions({ ...SCALE_DRILL_DEFAULTS, ...o });

describe('scale drill generator (P7-17)', () => {
  it('makes the same drill from the same options and seed', () => {
    const o = options({ level: 4, seed: 42 });
    expect(generateScaleDrill(o).musicxml).toBe(generateScaleDrill(o).musicxml);
    expect(generateScaleDrill({ ...o, seed: 43 }).musicxml).not.toBe(
      generateScaleDrill(o).musicxml,
    );
  });

  it('draws only the scales of its level, each once before any repeats, never twice running', () => {
    for (const level of SCALE_LEVELS) {
      const allowed = new Set(scaleLevelEntries(level).map((e) => `${e.pitchClass}.${e.kind}`));
      for (let seed = 1; seed <= 5; seed++) {
        const scales = drillScales(options({ level, count: 8, seed }));
        const kinds = scales.map((s) => scaleKind(s.scale));
        for (const k of kinds) expect(allowed.has(k), `${level} ${k}`).toBe(true);
        for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
        if (allowed.size >= 8) expect(new Set(kinds).size).toBe(8);
      }
    }
    expect(scaleLevelEntries(1).map((e) => `${e.pitchClass}.${e.kind}`)).toEqual([
      '0.major',
      '7.major',
      '5.major',
      '9.natural-minor',
    ]);
  });

  it('leaves the melodic minor out of contrary motion', () => {
    const kinds = scaleDrillEntries(options({ level: 8, hands: 'contrary' })).map((e) => e.kind);
    expect(kinds).not.toContain('melodic-minor');
    expect(kinds).toContain('harmonic-minor');
  });

  it('reads back as the drill: one step a note, two pitches with both hands, the fingers written', () => {
    for (const o of [
      options({ level: 3, seed: 7 }),
      options({ level: 6, hands: 'together', octaves: 2, rhythm: 'quavers', seed: 8 }),
      options({ level: 8, hands: 'contrary', seed: 9 }),
      options({ level: 7, hands: 'left', octaves: 2, seed: 10 }),
    ]) {
      const drill = generateScaleDrill(o);
      const song = parse(drill.musicxml);
      const steps = buildSteps(song);
      const expected = scaleSteps(drill);
      expect(steps.map((s) => s.pitches)).toEqual(expected.map((s) => s.pitches));
      const step = o.rhythm === 'quavers' ? 0.5 : 1;
      steps.forEach((s, i) => {
        const scale = drill.scales[expected[i]?.scale ?? 0];
        const n = scale?.upper.find((u) => Math.abs(u.beat - s.beat) < 1e-6);
        expect(n, `step ${i}`).toBeDefined();
      });
      for (const s of drill.scales) {
        expect(s.beat % 4).toBe(0);
        expect(s.upper[1]!.beat - s.upper[0]!.beat).toBe(step);
      }
      const fingered = drill.scales
        .flatMap((s) => [...s.upper, ...s.lower])
        .filter((n) => n.finger);
      expect(song.notes.filter((n) => n.fingering !== undefined)).toHaveLength(fingered.length);
    }
  });

  it('writes key signatures, and accidentals only where the key does not cover a note', () => {
    const drill = generateScaleDrill(
      options({ level: 'custom', set: { tonics: [9], kinds: ['harmonic-minor'] }, count: 1 }),
    );
    expect(drill.musicxml).toContain('<fifths>0</fifths>');
    // G♯ twice (going up and coming down, in different bars), nothing else.
    expect(drill.musicxml.match(/<accidental>/g)).toHaveLength(2);
    expect(drill.musicxml.match(/<accidental>sharp<\/accidental>/g)).toHaveLength(2);
    const melodic = generateScaleDrill(
      options({ level: 'custom', set: { tonics: [9], kinds: ['melodic-minor'] }, count: 1 }),
    ).musicxml;
    // F♯ G♯ going up, then G and F natural coming down.
    expect(melodic.match(/<accidental>natural<\/accidental>/g)).toHaveLength(2);
    const two = generateScaleDrill(
      options({ level: 'custom', set: { tonics: [2, 3], kinds: ['major'] }, count: 2, seed: 3 }),
    ).musicxml;
    expect(two.match(/<key>/g)).toHaveLength(2);
    expect(two).toContain('light-light');
    expect(two).toContain('light-heavy');
  });

  it('writes names as words above the staff, and beams quavers in pairs', () => {
    const drill = generateScaleDrill(options({ rhythm: 'quavers', count: 2 }), (s) => `N${s.kind}`);
    expect(drill.musicxml.match(/<words font-weight="bold">N/g)?.length).toBe(2);
    const begins = drill.musicxml.match(/<beam number="1">begin<\/beam>/g)?.length ?? 0;
    const ends = drill.musicxml.match(/<beam number="1">end<\/beam>/g)?.length ?? 0;
    expect(begins).toBe(ends);
    expect(begins).toBe(14);
  });

  it('places the hands on their staves: an octave or two apart, contrary from one key', () => {
    const c = drillScales(
      options({
        hands: 'together',
        octaves: 2,
        set: { tonics: [0], kinds: ['major'] },
        level: 'custom',
        count: 1,
      }),
    )[0]!;
    expect(c.upper[0]?.midi).toBe(60);
    expect(c.lower[0]?.midi).toBe(36);
    const one = drillScales(
      options({
        hands: 'together',
        level: 'custom',
        set: { tonics: [0], kinds: ['major'] },
        count: 1,
      }),
    )[0]!;
    expect(one.upper[0]?.midi).toBe(60);
    expect(one.lower[0]?.midi).toBe(48);
    const contrary = drillScales(
      options({
        hands: 'contrary',
        level: 'custom',
        set: { tonics: [0], kinds: ['major'] },
        count: 1,
      }),
    )[0]!;
    expect(contrary.upper.map((n) => n.midi).slice(0, 3)).toEqual([60, 62, 64]);
    expect(contrary.lower.map((n) => n.midi).slice(0, 3)).toEqual([60, 59, 57]);
    expect(
      contrary.lower
        .map((n) => n.finger)
        .slice(0, 8)
        .join(''),
    ).toBe('12312345');
    for (const level of SCALE_LEVELS) {
      for (const s of drillScales(options({ level, hands: 'together', octaves: 2, count: 8 }))) {
        for (const n of s.upper) expect(n.midi).toBeLessThanOrEqual(96);
        for (const n of s.lower) expect(n.midi).toBeGreaterThanOrEqual(28);
      }
    }
  });

  it('round-trips ids and keeps other drills apart', () => {
    for (const o of [
      options({ level: 5, hands: 'left', octaves: 2, rhythm: 'quavers', tempo: 120, seed: 99 }),
      options({
        level: 'custom',
        set: { tonics: [1, 6], kinds: ['blues', 'dorian'] },
        hands: 'contrary',
        focus: ['1.blues'],
        seed: 3,
      }),
    ]) {
      const id = scaleDrillId(o);
      expect(isScaleDrillId(id)).toBe(true);
      expect(isChordDrillId(id)).toBe(false);
      expect(parseScaleDrillId(id)).toEqual(o);
    }
    expect(scaleDrillId(options({ seed: 5 }))).toBe('scales.l1.hr.o1.d4.n4.t80.s5');
    expect(isScaleDrillId('treble.0.1.notes.8.1')).toBe(false);
    expect(parseDrillId('treble.0.1.notes.8.1').clef).toBe('treble');
    expect(parseScaleDrillId('scales.lzz.n999.t7')).toEqual(
      options({ count: 12, tempo: 40, seed: 1 }),
    );
  });
});

/** Steps of C major, one octave, right hand, as the session sees them. */
function cMajorSteps(): ScaleStep[] {
  const drill = generateScaleDrill(
    options({ level: 'custom', set: { tonics: [0], kinds: ['major'] }, count: 2 }),
  );
  return scaleSteps(drill);
}

describe('judging a scale (P7-18)', () => {
  it('names the cause of a wrong key', () => {
    const steps = cMajorSteps();
    expect(scaleMissCause(66, steps, 3)).toBe('key'); // F♯ for F
    expect(scaleMissCause(67, steps, 3)).toBe('skip'); // G, the next note
    expect(scaleMissCause(72, steps, 3)).toBe('other');
    const minor = scaleSteps(
      generateScaleDrill(
        options({ level: 'custom', set: { tonics: [9], kinds: ['harmonic-minor'] }, count: 1 }),
      ),
    );
    const gSharp = minor[6]?.pitches[0] ?? 0;
    expect(scaleMissCause(gSharp - 1, minor, 6)).toBe('form'); // G for G♯
    expect(scaleMissCause((minor[1]?.pitches[0] ?? 0) - 1, minor, 1)).toBe('key'); // B♭ for B
  });

  it('measures evenness and finds where a run was uneven', () => {
    const even = Array.from({ length: 15 }, (_, i) => i * 0.5);
    expect(evennessOf(even)?.evenness).toBeCloseTo(0, 5);
    expect(evennessWord(0.05)).toBe('very-even');
    expect(evennessWord(0.2)).toBe('even');
    expect(evennessWord(0.4)).toBe('uneven');
    expect(evennessOf([0, 1, 2])).toBeNull();
    // A hitch before the fourth note: the thumb passing under after the third finger.
    const steps = cMajorSteps();
    const tally = new ScaleTally();
    tally.setSteps(steps);
    let t = 0;
    for (let i = 0; i < 15; i++) {
      t += i === 3 ? 1.5 : 0.5;
      tally.played(i, t);
    }
    const [a] = tally.attempts;
    expect(a?.firstTry).toBe(true);
    expect(a?.evenness).toBeGreaterThan(0.25);
    expect(a?.unevenAt).toBe('thumb');
    expect(a?.seconds).toBeCloseTo(t - 0.5, 5);
  });

  it('counts wrong keys against the scale in wait mode and closes each scale at its last note', () => {
    const steps = cMajorSteps();
    const tally = new ScaleTally();
    tally.setSteps(steps);
    for (let i = 0; i < 30; i++) {
      if (i === 18) tally.wrong(i, 66); // F♯ for F
      tally.played(i, i * 0.5);
    }
    expect(tally.attempts.map((a) => a.firstTry)).toEqual([true, false]);
    expect(tally.attempts[1]?.causes).toEqual(['key']);
    const s = tally.summary();
    expect(s.scales).toBe(2);
    expect(s.share).toBe(0.5);
    expect(s.notesPerMinute).toBe(120);
    expect(hardestScales(s).map((k) => k.kind)).toEqual(['0.major']);
  });

  it('judges a scale at a tempo: missing notes, hands apart, keys between', () => {
    const steps = scaleSteps(
      generateScaleDrill(
        options({
          level: 'custom',
          set: { tonics: [0], kinds: ['major'] },
          count: 1,
          hands: 'together',
        }),
      ),
    );
    const tally = new ScaleTally();
    tally.setSteps(steps);
    const result = (pitch: number, time: number, offset: number | undefined): NoteResult => ({
      note: { id: `${pitch}`, pitch, time, measureIndex: 0 },
      judgement: offset === undefined ? 'missed' : 'hit',
      ...(offset === undefined ? {} : { offset }),
    });
    steps.forEach((s, i) => {
      const [lo, hi] = s.pitches as [number, number];
      const apart = i === 4 ? 0.2 : 0.01;
      tally.judged(
        i,
        [result(lo, i, 0), result(hi, i, i === 9 ? undefined : apart)],
        i === 2 ? [70] : [],
      );
    });
    const [a] = tally.attempts;
    expect(a?.firstTry).toBe(false);
    expect(a?.causes).toEqual(['other', 'apart', 'missing']);
    expect(a?.evenness).toBeNull();
  });

  it('keeps progress, finds weak scales and drops damaged rounds', () => {
    let stats = NO_SCALE_STATS;
    for (let r = 0; r < 3; r++) {
      const tally = new ScaleTally();
      const steps = cMajorSteps();
      tally.setSteps(steps);
      for (let i = 0; i < 30; i++) {
        if (i === 2) tally.wrong(i, 63);
        tally.played(i, i * 0.5);
      }
      stats = addScaleRound(stats, scaleRoundOf(tally.summary(), 1000 + r));
    }
    expect(stats.rounds).toHaveLength(3);
    expect(weakScales(stats).map((k) => k.kind)).toEqual(['0.major']);
    expect(weakScales(stats, new Set(['7.major']))).toEqual([]);
    expect(normaliseScaleStats(JSON.parse(JSON.stringify(stats)))).toEqual(stats);
    expect(normaliseScaleStats({ rounds: [{ at: 'x' }, null, 3] }).rounds).toEqual([]);
  });
});

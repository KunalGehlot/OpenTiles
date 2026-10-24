// Natural touch (P6-11): the melody over the accompaniment, the downbeat over the off-beat, a fixed
// variation, and MIDI velocities left alone. Songs are generated here (CC0).
import type { Song, SongNote } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import { buildPlayback } from '../src/playback';
import { EVEN_VELOCITY, touchVelocities } from '../src/touch';

const n = (
  id: string,
  pitch: number,
  startBeat: number,
  hand: 'left' | 'right',
  velocity?: number,
): SongNote => ({
  id,
  pitch,
  startBeat,
  durationBeats: 0.5,
  hand,
  staff: hand === 'right' ? 1 : 2,
  voice: 1,
  part: 0,
  measureIndex: Math.floor(startBeat / 4),
  sourceRefs: [],
  ...(velocity === undefined ? {} : { velocity }),
});

function song(
  notes: SongNote[],
  measures = [
    { start: 0, length: 4 },
    { start: 4, length: 4 },
  ],
): Song {
  return {
    title: 't',
    // MIDI: velocities in these songs stand for a file's own touch; a score's come from its marks.
    format: 'midi',
    notes,
    measures: measures.map((m, i) => ({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: m.start,
      lengthBeats: m.length,
    })),
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [],
    lengthBeats: 8,
    warnings: [],
  };
}

describe('natural touch (P6-11)', () => {
  // A chord on the downbeat (melody G4 over E4, bass C3), then off-beat and mid-bar melody notes.
  const piece = song([
    n('bass', 48, 0, 'left'),
    n('inner', 64, 0, 'right'),
    n('top', 67, 0, 'right'),
    n('off', 69, 0.5, 'right'),
    n('mid', 71, 2, 'right'),
    n('midi', 60, 4, 'right', 101),
  ]);

  it('leans into the melody and the downbeat, and leaves a file’s velocities alone', () => {
    const v = touchVelocities(piece);
    const at = (id: string) => v.get(id) ?? 0;
    expect(at('top')).toBeGreaterThan(at('inner'));
    expect(at('inner')).toBeGreaterThan(at('bass') - 7);
    expect(at('top')).toBeGreaterThan(at('off'));
    expect(at('mid')).toBeGreaterThan(at('off'));
    expect(v.has('midi')).toBe(false);
    for (const value of v.values()) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(127);
    }
  });

  it('is the same every time', () => {
    expect([...touchVelocities(piece)]).toEqual([...touchVelocities(piece)]);
  });

  it('plays evenly when asked, and the scheduler uses it', () => {
    expect([...touchVelocities(piece, 'even').values()].every((x) => x === EVEN_VELOCITY)).toBe(
      true,
    );
    const events = buildPlayback(piece);
    const velocity = (id: string) => events.find((e) => e.kind === 'note' && e.noteId === id);
    const midi = velocity('midi');
    expect(midi?.kind === 'note' && midi.velocity).toBe(101);
    const top = velocity('top');
    expect(top?.kind === 'note' && top.velocity).toBe(touchVelocities(piece).get('top'));
  });

  it('counts a pickup bar from the end of the bar', () => {
    // One beat of pickup, then a full bar: the pickup note is a weak beat, the next a downbeat.
    const pickup = song(
      [n('up', 67, 0, 'right'), n('down', 72, 1, 'right')].map((x, i) => ({
        ...x,
        measureIndex: i,
      })),
      [
        { start: 0, length: 1 },
        { start: 1, length: 4 },
      ],
    );
    const v = touchVelocities(pickup);
    expect(v.get('down') ?? 0).toBeGreaterThan(v.get('up') ?? 0);
  });
});

describe('natural touch over a score’s dynamics marks (P6-16)', () => {
  const notes = [n('top', 67, 0, 'right'), n('inner', 64, 0, 'right'), n('off', 69, 0.5, 'right')];
  const marked = (velocity?: number): Song => ({
    ...song(notes.map((x) => ({ ...x, ...(velocity === undefined ? {} : { velocity }) }))),
    format: 'musicxml',
  });

  it('leans the same way around the marked level, a mezzo-forte mark as no mark', () => {
    const none = touchVelocities(marked());
    const mf = touchVelocities(marked(EVEN_VELOCITY));
    const p = touchVelocities(marked(49));
    expect([...mf]).toEqual([...none]);
    for (const id of ['top', 'inner', 'off']) {
      expect((none.get(id) ?? 0) - (p.get(id) ?? 0)).toBe(EVEN_VELOCITY - 49);
    }
    expect(p.get('top') ?? 0).toBeGreaterThan(p.get('off') ?? 0);
  });

  it('keeps the softest marks audible', () => {
    const left = (id: string, beat: number) => ({ ...n(id, 40, beat, 'left'), velocity: 16 });
    const ppp = touchVelocities({
      ...song([left('down', 0), left('off', 0.5)]),
      format: 'musicxml',
    });
    for (const v of ppp.values()) expect(v).toBeGreaterThanOrEqual(12);
    expect(ppp.get('down') ?? 0).toBeGreaterThanOrEqual(ppp.get('off') ?? 0);
  });

  it('plays the marks as they are when even', () => {
    const events = buildPlayback(marked(49), { touch: 'even' });
    expect(events.every((e) => e.kind !== 'note' || e.velocity === 49)).toBe(true);
  });
});

// Edits made on the import review screen (spec §8). All return a new Song.
import { splitHands } from './handsplit';
import { measureIndexAt } from './midi';
import { pedalsBefore, tidyPedals } from './pedals';
import type { Hand, Song, SongNote } from './types';

function withNotes(song: Song, notes: SongNote[]): Song {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  return { ...song, notes: sorted.map((n, i) => ({ ...n, id: `n${i}` })) };
}

/** Shifts every note by `semitones`, keeping notes on the piano keyboard (A0–C8). */
export function transpose(song: Song, semitones: number): Song {
  const shift = Math.round(semitones);
  if (shift === 0) return song;
  const notes = song.notes
    .map((n) => ({ ...n, pitch: n.pitch + shift }))
    .filter((n) => n.pitch >= 21 && n.pitch <= 108);
  const keySignatures = song.keySignatures.map((k) => {
    // Move the key by the interval's equivalent on the circle of fifths, spelled within ±6.
    let fifths = (k.fifths + shift * 7) % 12;
    if (fifths > 6) fifths -= 12;
    if (fifths < -6) fifths += 12;
    return { ...k, fifths };
  });
  return { ...withNotes(song, notes), keySignatures };
}

/** Swaps left and right hands. */
export function swapHands(song: Song): Song {
  const flip = (h: Hand): Hand => (h === 'left' ? 'right' : 'left');
  return { ...song, notes: song.notes.map((n) => ({ ...n, hand: flip(n.hand) })) };
}

/** Re-splits the hands around `splitPoint` (for MIDI files without separate hand tracks). */
export function resplitHands(song: Song, splitPoint: number): Song {
  const hands = splitHands(song.notes, splitPoint);
  return {
    ...song,
    notes: song.notes.map((n, i) => {
      const hand = hands[i] ?? n.hand;
      return { ...n, hand, staff: hand === 'right' ? 1 : 2 };
    }),
  };
}

/** Scales every tempo so the first one becomes `bpm`. */
export function setBaseTempo(song: Song, bpm: number): Song {
  const first = song.tempos[0]?.bpm ?? 120;
  if (!(bpm > 0) || first <= 0) return song;
  const factor = bpm / first;
  return { ...song, tempos: song.tempos.map((t) => ({ ...t, bpm: t.bpm * factor })) };
}

/** Keeps measures `from`..`to` (playback indices, inclusive) and moves them to the start. */
export function trimMeasures(song: Song, from: number, to: number): Song {
  const first = song.measures[Math.max(0, from)];
  const last = song.measures[Math.min(song.measures.length - 1, to)];
  if (!first || !last || last.index < first.index) return song;
  const start = first.startBeat;
  const end = last.startBeat + last.lengthBeats;
  const measures = song.measures
    .filter((m) => m.index >= first.index && m.index <= last.index)
    .map((m, i) => ({ ...m, index: i, startBeat: m.startBeat - start }));
  const shiftEvents = <T extends { beat: number }>(events: readonly T[]): T[] => {
    const before = events.filter((e) => e.beat <= start + 1e-9);
    const atStart = before[before.length - 1];
    const inside = events.filter((e) => e.beat > start + 1e-9 && e.beat < end - 1e-9);
    return [
      ...(atStart ? [{ ...atStart, beat: 0 }] : []),
      ...inside.map((e) => ({ ...e, beat: e.beat - start })),
    ];
  };
  const notes = song.notes
    .filter((n) => n.startBeat >= start - 1e-9 && n.startBeat < end - 1e-9)
    .map((n) => ({
      ...n,
      startBeat: n.startBeat - start,
      durationBeats: Math.min(n.durationBeats, end - n.startBeat),
      measureIndex: measureIndexAt(measures, n.startBeat - start),
    }));
  // Each pedal as it stood at the start, then its changes inside.
  const held = pedalsBefore(song.pedals ?? [], start + 1e-9);
  const pedals = tidyPedals([
    ...(['sustain', 'soft', 'sostenuto'] as const)
      .filter((p) => held[p] > 0)
      .map((pedal) => ({ beat: 0, pedal, value: held[pedal] })),
    ...(song.pedals ?? [])
      .filter((e) => e.beat > start + 1e-9 && e.beat < end - 1e-9)
      .map((e) => ({ ...e, beat: e.beat - start })),
  ]);
  const { pedals: _old, ...rest } = withNotes(song, notes);
  return {
    ...rest,
    ...(pedals.length > 0 ? { pedals } : {}),
    measures,
    tempos: shiftEvents(song.tempos),
    timeSignatures: shiftEvents(song.timeSignatures),
    keySignatures: shiftEvents(song.keySignatures),
    lengthBeats: end - start,
  };
}

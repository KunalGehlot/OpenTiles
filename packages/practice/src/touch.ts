// Natural touch (P6-11, plan Q4). Files without velocities (MusicXML, ABC, the whole catalogue)
// would play every note at one loudness, which sounds mechanical on a real piano. "Natural" plays
// them the way a pianist leans into music: the melody over the accompaniment, the downbeat over the
// off-beat, and a little variation, the same every time. "Even" keeps one loudness. Notes whose
// file has a velocity (MIDI) always keep it. Pure, so it runs in Node tests.
import type { Song, SongNote } from '@opentiles/song-model';
import { pulseAt } from './metronome';

export type Touch = 'natural' | 'even';

/** Mezzo-forte: the loudness of a note with no velocity and no shaping. */
export const EVEN_VELOCITY = 80;
/** Where natural touch starts from, before the accents below. */
const BASE = 72;
const MELODY = 8;
const LEFT_HAND = -6;
const DOWNBEAT = 6;
const SECOND_STRONG = 3;
const OFF_BEAT = -4;
/** The variation each note gets from its id: −3 … +3. */
const SPREAD = 3;

const EPS = 1e-6;

/** −SPREAD … +SPREAD, fixed for a note id (FNV-1a). */
export function wobble(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % (2 * SPREAD + 1)) - SPREAD;
}

/** How strongly a note's place in the bar is felt: the downbeat most, an off-beat least. */
export function metricAccent(song: Song, n: SongNote): number {
  const m = song.measures[n.measureIndex];
  if (!m) return 0;
  const { unit, perBar } = pulseAt(song, m.startBeat);
  const bar = unit * perBar;
  // A pickup bar is the end of a bar: count its notes from where that bar would begin.
  const pickup = n.measureIndex === 0 && m.lengthBeats < bar - EPS ? bar - m.lengthBeats : 0;
  const pos = n.startBeat - m.startBeat + pickup;
  if (Math.abs(pos) < EPS || Math.abs(pos - bar) < EPS) return DOWNBEAT;
  const counted = pos / unit;
  if (Math.abs(counted - Math.round(counted)) > EPS) return OFF_BEAT;
  // The middle of a bar of four (or six) counts is strong too.
  return perBar % 2 === 0 && perBar >= 4 && Math.round(counted) === perBar / 2 ? SECOND_STRONG : 0;
}

/** The melody, by note id: the highest right-hand note of each onset. */
export function melodyIds(song: Song): Set<string> {
  const top = new Map<number, SongNote>();
  for (const n of song.notes) {
    if (n.hand !== 'right') continue;
    const key = Math.round(n.startBeat / EPS);
    const best = top.get(key);
    if (!best || n.pitch > best.pitch) top.set(key, n);
  }
  return new Set([...top.values()].map((n) => n.id));
}

/**
 * The velocity of each note that has none, by note id. With "even" every such note gets
 * `EVEN_VELOCITY`; notes with a velocity of their own are not in the map.
 */
export function touchVelocities(song: Song, touch: Touch = 'natural'): Map<string, number> {
  const out = new Map<string, number>();
  const unshaped = song.notes.filter((n) => n.velocity === undefined);
  if (touch === 'even') {
    for (const n of unshaped) out.set(n.id, EVEN_VELOCITY);
    return out;
  }
  const melody = melodyIds(song);
  for (const n of unshaped) {
    const voice = melody.has(n.id) ? MELODY : n.hand === 'left' ? LEFT_HAND : 0;
    const v = BASE + voice + metricAccent(song, n) + wobble(n.id);
    out.set(n.id, Math.max(1, Math.min(127, Math.round(v))));
  }
  return out;
}

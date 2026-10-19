// Expressive playing for the Player (P6-16, ADR 0021). None of the catalogue's scores has a
// dynamics mark or a pedal mark, so a piece played as written sounds typed: every note at nearly one
// loudness and nothing sounding beyond its written length. A pianist adds both from the music
// itself, and so does this, in plain rules that can be explained and tested:
//
// - Touch: the melody sings over the accompaniment, the bass carries, inner notes stay back, and
//   each phrase grows towards its highest note and settles at its end.
// - Pedal: the sustain pedal goes down just after each new harmony (a legato pedal) and comes up
//   where holding on would blur: a new harmony, a melody note a step from one still ringing, or a
//   rest. Where changes would come faster than a foot can follow, it stays up.
//
// The Player only (plan Q12): practice keeps natural touch and the file's own pedal. Applied at
// playback and never stored. A file's own velocities and pedal marks always win. Pure, so it runs
// in Node tests.
import { PEDAL_DOWN, TempoMap } from '@opentiles/song-model';
import type { PedalEvent, Song, SongNote } from '@opentiles/song-model';
import { pulseAt } from './metronome';
import { splitPhrases } from './phrases';
import { melodyIds, metricAccent, wobble } from './touch';

const EPS = 1e-6;

// ---- Touch ----

/** Where expressive touch starts from: a little above mezzo-piano, so phrases have room to grow. */
const BASE = 66;
const MELODY = 14;
const RIGHT_INNER = -8;
const BASS = -4;
const LEFT_INNER = -13;
/** A phrase starts this far below its level, peaks this far above it and ends this far below. */
const CONTOUR_START = -8;
const CONTOUR_PEAK = 12;
const CONTOUR_END = -12;
/** The accompaniment follows the phrase's shape, less strongly than the melody. */
const ACCOMPANIMENT_FOLLOWS = 0.6;
/** A phrase sung higher than the piece's average is a little louder (per semitone, capped). */
const REGISTER_LIFT = 0.5;
const REGISTER_CAP = 5;
const SOFTEST = 24;
const LOUDEST = 112;

/**
 * A recorded performance: its notes carry velocities that vary. Its touch, timing and pedal are the
 * pianist's own, so expressive playing leaves it as it is (ADR 0021).
 */
export function isPerformance(song: Song): boolean {
  const velocities = new Set(
    song.notes.flatMap((n) => (n.velocity === undefined ? [] : [n.velocity])),
  );
  return velocities.size > 1;
}

/** True when the file gives every note one velocity: it says nothing about touch. */
function uniformVelocities(song: Song): boolean {
  let only: number | undefined;
  for (const n of song.notes) {
    if (n.velocity === undefined) continue;
    if (only === undefined) only = n.velocity;
    else if (n.velocity !== only) return false;
  }
  return only !== undefined;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, f));
}

/**
 * Expressive velocities, by note id, for the notes the file leaves unshaped: those without a
 * velocity, or every note when the file gives all of them the same one. Notes with velocities of
 * their own (a performance recorded as MIDI) are not in the map.
 */
export function expressiveVelocities(song: Song): Map<string, number> {
  const out = new Map<string, number>();
  const uniform = uniformVelocities(song);
  const unshaped = song.notes.filter((n) => uniform || n.velocity === undefined);
  if (unshaped.length === 0) return out;

  const melody = melodyIds(song);
  // The bass: the lowest left-hand note of each onset.
  const lowest = new Map<number, SongNote>();
  for (const n of song.notes) {
    if (n.hand !== 'left') continue;
    const key = Math.round(n.startBeat / EPS);
    const known = lowest.get(key);
    if (!known || n.pitch < known.pitch) lowest.set(key, n);
  }
  const bass = new Set([...lowest.values()].map((n) => n.id));
  const melodyNotes = song.notes.filter((n) => melody.has(n.id));
  const pieceMean =
    melodyNotes.reduce((sum, n) => sum + n.pitch, 0) / Math.max(1, melodyNotes.length);

  // Each phrase's shape: a rise to its highest melody note, then a fall to its end.
  const shapeAt = new Map<string, number>();
  for (const phrase of splitPhrases(song)) {
    const inside = (n: SongNote) =>
      n.startBeat >= phrase.fromBeat - EPS && n.startBeat < phrase.toBeat - EPS;
    const sung = melodyNotes.filter(inside);
    if (sung.length === 0) continue;
    let peak = sung[0] as SongNote;
    for (const n of sung) if (n.pitch > peak.pitch) peak = n;
    const mean = sung.reduce((sum, n) => sum + n.pitch, 0) / sung.length;
    const lift = Math.max(
      -REGISTER_CAP,
      Math.min(REGISTER_CAP, (mean - pieceMean) * REGISTER_LIFT),
    );
    const rise = peak.startBeat - phrase.fromBeat;
    const fall = phrase.toBeat - peak.startBeat;
    for (const n of song.notes) {
      if (!inside(n)) continue;
      const shape =
        n.startBeat <= peak.startBeat + EPS && rise > EPS
          ? lerp(CONTOUR_START, CONTOUR_PEAK, (n.startBeat - phrase.fromBeat) / rise)
          : lerp(CONTOUR_PEAK, CONTOUR_END, (n.startBeat - peak.startBeat) / Math.max(fall, EPS));
      shapeAt.set(n.id, shape + lift);
    }
  }

  for (const n of unshaped) {
    const sings = melody.has(n.id);
    const role = sings
      ? MELODY
      : n.hand === 'right'
        ? RIGHT_INNER
        : bass.has(n.id)
          ? BASS
          : LEFT_INNER;
    const shape = (shapeAt.get(n.id) ?? 0) * (sings ? 1 : ACCOMPANIMENT_FOLLOWS);
    const v = BASE + role + metricAccent(song, n) + shape + wobble(n.id);
    out.set(n.id, Math.max(SOFTEST, Math.min(LOUDEST, Math.round(v))));
  }
  return out;
}

// ---- The ending ----

/** The slowest the ending gets, as a share of the tempo (brief §5.3: at most 10 % slower). */
const RIT_FLOOR = 0.9;
/** The last chord sounds this much longer than written, with what follows it. */
const LAST_CHORD_HOLD = 1.5;

/**
 * The ending a pianist plays (P6-16): from the start of the bar before the last chord the tempo
 * eases to 90 %, and the last chord is held half as long again. Returns the map from song seconds
 * as written to song seconds as played; before the slowing it changes nothing, and a recorded
 * performance keeps its own ending.
 */
export function endingWarp(song: Song): (seconds: number) => number {
  const notes = song.notes;
  const last = notes[notes.length - 1];
  if (!last || isPerformance(song)) return (t) => t;
  const tempo = new TempoMap(song.tempos);
  const lastOnset = Math.max(...notes.map((n) => n.startBeat));
  // The bar holding the last onset, or the one before when the last chord starts its bar.
  let bar = song.measures.findIndex(
    (m) => lastOnset >= m.startBeat - EPS && lastOnset < m.startBeat + m.lengthBeats - EPS,
  );
  if (bar > 0 && lastOnset - (song.measures[bar]?.startBeat ?? 0) < 1 - EPS) bar -= 1;
  const from = tempo.beatToSeconds(song.measures[bar]?.startBeat ?? Math.max(0, lastOnset - 4));
  const to = tempo.beatToSeconds(lastOnset);
  const span = to - from;
  const k = 1 - RIT_FLOOR;
  // Over the slowing the tempo falls in a straight line, so time stretches by the integral of
  // 1 / (1 − k·x/span); at its end it has run (−span/k)·ln(1 − k) seconds.
  const slowed = span > EPS ? (-span / k) * Math.log(1 - k) : 0;
  return (t) => {
    if (t <= from) return t;
    if (t <= to) return from - (span / k) * Math.log(1 - (k * (t - from)) / span);
    return from + slowed + (t - to) * LAST_CHORD_HOLD;
  };
}

// ---- Pedal ----

/** How long after a new harmony the pedal goes down again, so the old one is cleared (seconds). */
const CATCH = 0.1;
/** The pedal goes down only if it can stay down at least this long before it must change. */
const MIN_HOLD = 0.3;
/** A harmony is read over at least this long (seconds): whole pulses, never past the bar line. */
const HARMONY_SPAN = 0.4;
/** A gap with no key down at least this long (beats) is a rest, and the pedal comes up in it. */
const REST = 0.5;
/** How long into a rest the pedal comes up (beats, at most half the rest). */
const REST_RING = 0.25;
const DOWN = 127;
const UP = 0;

/**
 * The onsets (beats) where a new harmony starts: the bass moving to another note at or below where
 * it was, or two new pitch classes in the accompaniment (three in all). Read over whole pulses of
 * at least `HARMONY_SPAN`, so an Alberti bass (C G E G) or a waltz bass (C, then E G) stays one
 * harmony; C to G7 does not.
 */
export function harmonyChanges(song: Song): number[] {
  const tempo = new TempoMap(song.tempos);
  const melody = melodyIds(song);
  const windows: SongNote[][] = [];
  let i = 0;
  const notes = song.notes;
  for (const m of song.measures) {
    const { unit } = pulseAt(song, m.startBeat);
    const pulses = Math.max(
      1,
      Math.ceil(HARMONY_SPAN / (unit * tempo.secondsPerBeatAt(m.startBeat))),
    );
    const step = Math.min(unit * pulses, m.lengthBeats);
    const end = m.startBeat + m.lengthBeats;
    for (let b = m.startBeat; b < end - EPS; b += step) {
      const until = Math.min(b + step, end);
      const w: SongNote[] = [];
      while (i < notes.length && (notes[i] as SongNote).startBeat < until - EPS) {
        w.push(notes[i] as SongNote);
        i++;
      }
      if (w.length > 0) windows.push(w);
    }
  }
  const changes: number[] = [];
  let pcs = new Set<number>();
  let bass = Infinity;
  for (const w of windows) {
    const low = Math.min(...w.map((n) => n.pitch));
    const fresh = (list: SongNote[]) =>
      new Set(list.map((n) => n.pitch % 12).filter((pc) => !pcs.has(pc)));
    const newAll = fresh(w);
    const newAccompaniment = fresh(w.filter((n) => !melody.has(n.id)));
    const bassMoves = bass !== Infinity && low % 12 !== bass % 12 && low <= bass + 2;
    if (bass === Infinity || bassMoves || newAccompaniment.size >= 2 || newAll.size >= 3) {
      changes.push((w[0] as SongNote).startBeat);
      pcs = new Set(w.map((n) => n.pitch % 12));
      bass = low;
    } else {
      for (const n of w) pcs.add(n.pitch % 12);
      bass = Math.min(bass, low);
    }
  }
  return changes;
}

/**
 * The sustain pedal a pianist might use for a piece whose file has none, as pedal events in beats:
 * down just after each new harmony, changed where holding on would blur, up in rests and at the
 * end, and left up where it could not stay down long enough to be heard.
 */
export function autoPedal(song: Song): PedalEvent[] {
  const notes = song.notes;
  if (notes.length === 0) return [];
  const tempo = new TempoMap(song.tempos);
  const seconds = (beat: number) => tempo.beatToSeconds(beat);
  const melody = melodyIds(song);
  const harmonies = new Set(harmonyChanges(song).map((b) => Math.round(b / EPS)));
  const endOf = (n: SongNote) => n.startBeat + n.durationBeats;

  // Onsets: the notes starting together.
  const onsets: SongNote[][] = [];
  for (const n of notes) {
    const last = onsets[onsets.length - 1];
    if (last && Math.abs((last[0] as SongNote).startBeat - n.startBeat) < EPS) last.push(n);
    else onsets.push([n]);
  }
  // What each hand played just before each note: a step from there is a voice moving.
  const previousOfHand = new Map<string, readonly SongNote[]>();
  const lastOfHand: Partial<Record<SongNote['hand'], SongNote[]>> = {};
  for (const onset of onsets) {
    for (const hand of ['left', 'right'] as const) {
      const own = onset.filter((n) => n.hand === hand);
      if (own.length === 0) continue;
      const before = lastOfHand[hand];
      if (before) for (const n of own) previousOfHand.set(n.id, before);
      lastOfHand[hand] = own;
    }
  }

  // A note a step from one the pedal alone keeps sounding would smear the two into one sound: a
  // semitone anywhere, or a tone that the melody or a voice moves by (from what its hand played
  // just before). A tone between notes further apart (the seventh of a G7 against the root played
  // a beat before) is left to ring as the harmony.
  const blurs = (onset: SongNote[], beat: number, ringing: readonly SongNote[]) =>
    onset.some((n) =>
      ringing.some((r) => {
        if (endOf(r) > beat + EPS) return false;
        const d = Math.abs(n.pitch - r.pitch);
        if (d === 1) return true;
        const moves = melody.has(n.id) || melody.has(r.id) || previousOfHand.get(n.id)?.includes(r);
        return d === 2 && moves === true;
      }),
    );
  const harmonyAt = (beat: number) => harmonies.has(Math.round(beat / EPS));

  /**
   * Where a pedal pressed for onset `k` would have to come up (beats): the next harmony, the next
   * smear, a rest, or the end.
   */
  const mustLift = (k: number, keysDown: readonly SongNote[]): number => {
    const ringing = [...keysDown, ...(onsets[k] as SongNote[])];
    let keysUp = Math.max(...ringing.map(endOf));
    for (let j = k + 1; j < onsets.length; j++) {
      const onset = onsets[j] as SongNote[];
      const beat = (onset[0] as SongNote).startBeat;
      if (beat - keysUp >= REST - EPS) return keysUp + Math.min(REST_RING, (beat - keysUp) / 2);
      if (harmonyAt(beat) || blurs(onset, beat, ringing)) return beat;
      ringing.push(...onset);
      keysUp = Math.max(keysUp, ...onset.map(endOf));
    }
    return Math.max(song.lengthBeats, keysUp);
  };

  const events: PedalEvent[] = [];
  let down = false;
  /** The notes the pedal holds since it last went down. */
  let ringing: SongNote[] = [];
  /** Keys still held by the fingers. */
  let keysDown: SongNote[] = [];
  let keysUp = -Infinity;
  const lift = (beat: number) => {
    if (!down) return;
    down = false;
    ringing = [];
    // A change before the pedal even went down: it never goes down.
    const last = events[events.length - 1];
    if (last && last.value === DOWN && last.beat >= beat - EPS) events.pop();
    else events.push({ beat, pedal: 'sustain', value: UP });
  };

  onsets.forEach((onset, k) => {
    const beat = (onset[0] as SongNote).startBeat;
    keysDown = keysDown.filter((n) => endOf(n) > beat + EPS);
    // A rest: every key up for a while. The pedal comes up in it, after a short ring.
    if (down && beat - keysUp >= REST - EPS)
      lift(keysUp + Math.min(REST_RING, (beat - keysUp) / 2));
    if (down && !harmonyAt(beat) && !blurs(onset, beat, ringing)) {
      ringing.push(...onset);
    } else {
      // The pedal changes here, or is up: it goes down again only where it can stay down long
      // enough to be heard. Faster than that, a pianist keeps the foot up.
      lift(beat);
      const catchAt = tempo.secondsToBeat(seconds(beat) + CATCH);
      if (seconds(mustLift(k, keysDown)) - seconds(beat) >= MIN_HOLD) {
        events.push({ beat: catchAt, pedal: 'sustain', value: DOWN });
        down = true;
        // What the pedal catches: the new notes and those whose keys are still down.
        ringing = [...keysDown.filter((n) => endOf(n) > catchAt + EPS), ...onset];
      }
    }
    keysDown.push(...onset);
    keysUp = Math.max(keysUp, ...onset.map(endOf));
  });
  lift(Math.max(song.lengthBeats, keysUp));
  return events;
}

/**
 * The pedal events to play: the file's own when it has a sustain pedal or is a recorded
 * performance, otherwise the file's other pedals with the automatic sustain pedal, sorted by beat.
 */
export function expressivePedals(song: Song): PedalEvent[] {
  const own = song.pedals ?? [];
  if (isPerformance(song) || own.some((e) => e.pedal === 'sustain' && e.value >= PEDAL_DOWN)) {
    return own;
  }
  return [...own, ...autoPedal(song)].sort((a, b) => a.beat - b.beat);
}

// Metronome clicks (PLAN.md P1-13): one click per counted beat of the time signature, accented on
// the downbeat. Positions are in beats, so the app maps them through the same `Timeline` as the
// notes and the clicks stay locked to the practice tempo.
import type { Measure, Song, TimeSignatureEvent } from '@opentiles/song-model';

export interface Click {
  beat: number;
  /** True on the first beat of a bar. */
  accent: boolean;
}

export interface Pulse {
  /** Length of one counted beat in quarter-note beats (1 in 4/4, 1.5 in 6/8, 0.5 in 3/8). */
  unit: number;
  /** Counted beats per bar (4 in 4/4, 2 in 6/8). */
  perBar: number;
}

const EPS = 1e-6;

/** The time signature in effect at `beat` (4/4 when the song has none). */
export function timeSignatureAt(song: Song, beat: number): TimeSignatureEvent {
  let ts: TimeSignatureEvent = { beat: 0, numerator: 4, denominator: 4 };
  for (const t of song.timeSignatures) {
    if (t.beat <= beat + EPS) ts = t;
    else break;
  }
  return ts;
}

/**
 * How a time signature is counted. Compound metres (6/8, 9/8, 12/8, …) are counted in dotted
 * beats, as a teacher would count them; everything else in the denominator's note value.
 */
export function pulseOf(ts: Pick<TimeSignatureEvent, 'numerator' | 'denominator'>): Pulse {
  const num = Math.max(1, Math.round(ts.numerator));
  const den = Math.max(1, ts.denominator);
  const note = 4 / den;
  if (den >= 8 && num > 3 && num % 3 === 0) return { unit: note * 3, perBar: num / 3 };
  return { unit: note, perBar: num };
}

export function pulseAt(song: Song, beat: number): Pulse {
  return pulseOf(timeSignatureAt(song, beat));
}

function measureClicks(song: Song, m: Measure, isFirst: boolean): Click[] {
  const { unit, perBar } = pulseAt(song, m.startBeat);
  const full = unit * perBar;
  const out: Click[] = [];
  if (isFirst && m.lengthBeats < full - EPS) {
    // A pickup bar: count it from the end, so its beats line up with the beats they stand for
    // and none of them is accented as a downbeat.
    const end = m.startBeat + m.lengthBeats;
    for (let k = 1; end - k * unit >= m.startBeat - EPS; k++) {
      out.unshift({ beat: end - k * unit, accent: false });
    }
    return out;
  }
  for (let k = 0; k * unit < m.lengthBeats - EPS; k++) {
    out.push({ beat: m.startBeat + k * unit, accent: k === 0 });
  }
  return out;
}

/** Clicks with `fromBeat <= beat < toBeat`, in order. */
export function metronomeClicks(song: Song, fromBeat: number, toBeat: number): Click[] {
  const clicks: Click[] = [];
  if (song.measures.length === 0) {
    const { unit, perBar } = pulseAt(song, 0);
    const end = Math.min(toBeat, song.lengthBeats);
    for (let k = Math.max(0, Math.ceil((fromBeat - EPS) / unit)); k * unit < end - EPS; k++) {
      clicks.push({ beat: k * unit, accent: k % perBar === 0 });
    }
    return clicks;
  }
  song.measures.forEach((m, i) => {
    if (m.startBeat + m.lengthBeats <= fromBeat + EPS || m.startBeat >= toBeat - EPS) return;
    for (const c of measureClicks(song, m, i === 0)) {
      if (c.beat >= fromBeat - EPS && c.beat < toBeat - EPS) clicks.push(c);
    }
  });
  return clicks;
}

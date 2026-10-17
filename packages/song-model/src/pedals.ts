// Pedal events in a Song (P6-10, ADR 0020): shared by the readers and the transforms.
import type { PedalEvent, PedalKind } from './types';

/** MIDI control change numbers of the three pedals. */
export const PEDAL_CONTROLLERS: Readonly<Record<number, PedalKind>> = {
  64: 'sustain',
  66: 'sostenuto',
  67: 'soft',
};

/** A pedal at this value or above is down (MIDI's convention). */
export const PEDAL_DOWN = 64;

/**
 * Sorted by beat (events on one beat keep their order: "up, then down again" is a pedal change),
 * values clamped to 0–127, and an event dropped when its pedal is already at that value.
 */
export function tidyPedals(events: readonly PedalEvent[]): PedalEvent[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.beat - b.e.beat || a.i - b.i)
    .map(({ e }) => ({ ...e, value: Math.max(0, Math.min(127, Math.round(e.value))) }));
  const last = new Map<PedalKind, number>();
  const out: PedalEvent[] = [];
  for (const e of sorted) {
    if ((last.get(e.pedal) ?? 0) === e.value) continue;
    last.set(e.pedal, e.value);
    out.push(e);
  }
  return out;
}

export type PedalMark = 'start' | 'stop' | 'change';

/**
 * Lifted and pressed again within this many beats, the sustain pedal is written as one change.
 * Played files lift it briefly at a new harmony; exported ones lift and press on one tick.
 */
const CHANGE_WITHIN = 1 / 8;

/**
 * How a score marks the sustain pedal (P6-10): "Ped." where it goes down, the release star where
 * it comes up, and one change mark where it is lifted and pressed again at once, at the lift.
 * Half pedalling counts as down from 64, as MIDI has it.
 */
export function sustainMarks(events: readonly PedalEvent[]): { beat: number; mark: PedalMark }[] {
  const moves: { beat: number; down: boolean }[] = [];
  let down = false;
  for (const e of tidyPedals(events)) {
    if (e.pedal !== 'sustain' || e.value >= PEDAL_DOWN === down) continue;
    down = !down;
    moves.push({ beat: e.beat, down });
  }
  const out: { beat: number; mark: PedalMark }[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i] as { beat: number; down: boolean };
    const next = moves[i + 1];
    if (!m.down && next?.down && next.beat - m.beat <= CHANGE_WITHIN + 1e-9) {
      out.push({ beat: m.beat, mark: 'change' });
      i += 1;
    } else out.push({ beat: m.beat, mark: m.down ? 'start' : 'stop' });
  }
  return out;
}

/** Each pedal's value just before `beat` (0 when never pressed). */
export function pedalsBefore(
  events: readonly PedalEvent[],
  beat: number,
): Record<PedalKind, number> {
  const state: Record<PedalKind, number> = { sustain: 0, soft: 0, sostenuto: 0 };
  for (const e of events) {
    if (e.beat >= beat - 1e-9) break;
    state[e.pedal] = e.value;
  }
  return state;
}

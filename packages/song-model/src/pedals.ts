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

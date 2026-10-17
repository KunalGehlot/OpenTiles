// Lines up another process's monotonic clock with performance.now(), NTP style: note the local
// time, ask for the remote time, note the local time again, and assume the answer was taken
// half-way. The error is at most half the round trip, so the sample with the shortest round trip
// wins. The iPad app uses this for CoreMIDI timestamps, which are on the device's host clock.

export interface ClockSample {
  /** Local seconds just before asking. */
  localBefore: number;
  /** The remote clock's answer, in seconds. */
  remote: number;
  /** Local seconds when the answer arrived. */
  localAfter: number;
}

interface Estimate {
  /** local = remote + offset */
  offset: number;
  roundTrip: number;
}

export class ClockSync {
  private estimates: Estimate[] = [];

  /** Keeps only the latest `keep` samples, so a slow drift between the clocks ages out. */
  constructor(private readonly keep = 8) {}

  add(sample: ClockSample): void {
    const { localBefore, remote, localAfter } = sample;
    if (![localBefore, remote, localAfter].every(Number.isFinite)) return;
    const roundTrip = localAfter - localBefore;
    if (roundTrip < 0) return;
    this.estimates.push({ offset: (localBefore + localAfter) / 2 - remote, roundTrip });
    if (this.estimates.length > this.keep) this.estimates.shift();
  }

  private best(): Estimate | null {
    let best: Estimate | null = null;
    for (const e of this.estimates) if (!best || e.roundTrip < best.roundTrip) best = e;
    return best;
  }

  /** Seconds to add to a remote time to get local time; null before the first sample. */
  get offset(): number | null {
    return this.best()?.offset ?? null;
  }

  /** How far off `offset` can be, in seconds (half the best round trip). */
  get uncertainty(): number | null {
    const best = this.best();
    return best ? best.roundTrip / 2 : null;
  }

  /** A remote time on the local clock; null before the first sample. */
  toLocal(remote: number): number | null {
    const offset = this.offset;
    return offset === null ? null : remote + offset;
  }

  /** A local time on the remote clock; null before the first sample. */
  toRemote(local: number): number | null {
    const offset = this.offset;
    return offset === null ? null : local - offset;
  }

  reset(): void {
    this.estimates = [];
  }
}

/**
 * Places an event on the audio clock: how long ago it happened, measured on a clock the event and
 * "now" share, subtracted from the audio clock's current time. An event cannot be in the future,
 * so a negative age (clock jitter) counts as zero.
 */
export function audioTimeOf(eventLocal: number, localNow: number, audioNow: number): number {
  return audioNow - Math.max(0, localNow - eventLocal);
}

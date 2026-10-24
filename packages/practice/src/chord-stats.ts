// Chord progress (P7-08, ADR 0022): what the learner's last rounds say about each kind of chord,
// kept on the device so "Practise my weak chords" can draw those more often, and the tempo ladder
// (P7-07). Counts only: never a drill's notes or anything else. Pure, so the app stores the value.
import type { ChordMiss, ChordRoundSummary } from './chord-tally';
import { CHORD_TEMPO_STEP, MAX_CHORD_TEMPO, MIN_CHORD_TEMPO } from './chord-drills';

/** One finished round: when, how it went, and per kind [attempts, first tries, seconds]. */
export interface ChordRound {
  /** Milliseconds since 1970. */
  at: number;
  chords: number;
  firstTry: number;
  perMinute: number;
  kinds: Record<string, [number, number, number]>;
  /** Per kind, the cause it went wrong by most, when it did. */
  causes?: Record<string, ChordMiss>;
}

export interface ChordStats {
  version: 1;
  /** Oldest first, at most `MAX_ROUNDS`. */
  rounds: ChordRound[];
}

export const MAX_ROUNDS = 200;
/** A chord is weak below this share right at the first try. */
export const WEAK_SHARE = 0.8;
/** Attempts before a chord's share says anything. */
const MIN_ATTEMPTS = 3;

export const NO_CHORD_STATS: Readonly<ChordStats> = Object.freeze({ version: 1, rounds: [] });

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Stats from anything stored, keeping only well-formed rounds. */
export function normaliseChordStats(value: unknown): ChordStats {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const rounds = Array.isArray(v.rounds) ? v.rounds : [];
  const out: ChordRound[] = [];
  for (const r of rounds) {
    if (typeof r !== 'object' || r === null) continue;
    const x = r as Record<string, unknown>;
    if (!isNumber(x.at) || !isNumber(x.chords) || !isNumber(x.firstTry)) continue;
    const kinds: ChordRound['kinds'] = {};
    if (typeof x.kinds === 'object' && x.kinds !== null) {
      for (const [k, c] of Object.entries(x.kinds)) {
        if (Array.isArray(c) && c.length === 3 && c.every(isNumber)) {
          kinds[k] = [c[0], c[1], c[2]] as [number, number, number];
        }
      }
    }
    const round: ChordRound = {
      at: x.at,
      chords: x.chords,
      firstTry: x.firstTry,
      perMinute: isNumber(x.perMinute) ? x.perMinute : 0,
      kinds,
    };
    if (typeof x.causes === 'object' && x.causes !== null) {
      const causes: Record<string, ChordMiss> = {};
      for (const [k, c] of Object.entries(x.causes)) {
        if (c === 'missing' || c === 'extra' || c === 'quality' || c === 'inversion') causes[k] = c;
      }
      round.causes = causes;
    }
    out.push(round);
  }
  return { version: 1, rounds: out.slice(-MAX_ROUNDS) };
}

/** The round as it is kept, from the tally's summary and per-kind seconds. */
export function roundOf(
  summary: ChordRoundSummary,
  secondsByKind: ReadonlyMap<string, number>,
  at: number,
): ChordRound {
  const kinds: ChordRound['kinds'] = {};
  const causes: Record<string, ChordMiss> = {};
  for (const k of summary.byKind) {
    kinds[k.kind] = [
      k.attempts,
      k.firstTry,
      Math.round((secondsByKind.get(k.kind) ?? 0) * 100) / 100,
    ];
    let most = 0;
    for (const [cause, n] of Object.entries(k.causes) as [ChordMiss, number][]) {
      if (n > most) {
        most = n;
        causes[k.kind] = cause;
      }
    }
  }
  return {
    at,
    chords: summary.chords,
    firstTry: summary.firstTry,
    perMinute: summary.perMinute,
    kinds,
    causes,
  };
}

/** The stats with a round added, the oldest dropped past `MAX_ROUNDS`. */
export function addRound(stats: ChordStats, round: ChordRound): ChordStats {
  if (round.chords === 0) return stats;
  return { version: 1, rounds: [...stats.rounds, round].slice(-MAX_ROUNDS) };
}

export interface ChordKindStats {
  kind: string;
  attempts: number;
  firstTry: number;
  /** Mean seconds to complete one, over the rounds that timed it. */
  seconds: number;
  share: number;
}

/** Totals per kind over the kept rounds. */
export function kindTotals(stats: ChordStats): ChordKindStats[] {
  const totals = new Map<string, ChordKindStats>();
  for (const r of stats.rounds) {
    for (const [kind, [attempts, firstTry, seconds]] of Object.entries(r.kinds)) {
      const t = totals.get(kind) ?? { kind, attempts: 0, firstTry: 0, seconds: 0, share: 0 };
      t.attempts += attempts;
      t.firstTry += firstTry;
      t.seconds += seconds;
      totals.set(kind, t);
    }
  }
  return [...totals.values()].map((t) => ({
    ...t,
    seconds: t.attempts > 0 ? t.seconds / t.attempts : 0,
    share: t.attempts > 0 ? t.firstTry / t.attempts : 0,
  }));
}

/**
 * The weak chords: tried at least three times, right at the first try under 80 %, worst first.
 * `allowed` keeps only kinds the drill can draw.
 */
export function weakChords(
  stats: ChordStats,
  allowed?: ReadonlySet<string>,
  count = 6,
): ChordKindStats[] {
  return kindTotals(stats)
    .filter(
      (t) =>
        t.attempts >= MIN_ATTEMPTS && t.share < WEAK_SHARE && (!allowed || allowed.has(t.kind)),
    )
    .sort((a, b) => a.share - b.share || b.attempts - a.attempts)
    .slice(0, count);
}

/** The last `n` rounds' shares right at the first try, oldest first. */
export const recentShares = (stats: ChordStats, n = 5): number[] =>
  stats.rounds.slice(-n).map((r) => (r.chords > 0 ? r.firstTry / r.chords : 0));

/**
 * The tempo ladder (P7-07, off by default): after three rounds in a row with at least 90 % right
 * at the first try the tempo rises a step; after a round under 60 % it falls a step. `shares` are
 * the rounds played at `tempo`, oldest first. Scale drills use it with their own `limits`.
 */
export function nextChordTempo(
  shares: readonly number[],
  tempo: number,
  limits: { min: number; max: number; step: number } = {
    min: MIN_CHORD_TEMPO,
    max: MAX_CHORD_TEMPO,
    step: CHORD_TEMPO_STEP,
  },
): number {
  const last = shares[shares.length - 1];
  let next = tempo;
  if (last !== undefined && last < 0.6) next = tempo - limits.step;
  else if (shares.length >= 3 && shares.slice(-3).every((s) => s >= 0.9))
    next = tempo + limits.step;
  return Math.min(limits.max, Math.max(limits.min, next));
}

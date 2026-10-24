// Scale progress (P7-21, ADR 0024): what the learner's last rounds say about each scale, kept on
// the device so "Practise my weak scales" can draw those more often, as chord progress does
// (chord-stats.ts). Counts only: never a drill's notes or anything else. Pure; the app stores it.
import { MAX_ROUNDS, WEAK_SHARE } from './chord-stats';
import type { ScaleMiss, ScaleRoundSummary } from './scale-tally';

/** One finished round: when, how it went, and per scale [attempts, first tries]. */
export interface ScaleRound {
  /** Milliseconds since 1970. */
  at: number;
  scales: number;
  firstTry: number;
  notesPerMinute: number;
  /** The round's median evenness; null when it could not be measured. */
  evenness: number | null;
  kinds: Record<string, [number, number]>;
  /** Per scale, the cause it went wrong by most, when it did. */
  causes?: Record<string, ScaleMiss>;
}

export interface ScaleStats {
  version: 1;
  /** Oldest first, at most `MAX_ROUNDS`. */
  rounds: ScaleRound[];
}

/** Attempts before a scale's share says anything. */
const MIN_ATTEMPTS = 3;
const CAUSES: readonly ScaleMiss[] = ['key', 'form', 'skip', 'other', 'missing', 'apart', 'shown'];

export const NO_SCALE_STATS: Readonly<ScaleStats> = Object.freeze({ version: 1, rounds: [] });

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Stats from anything stored, keeping only well-formed rounds. */
export function normaliseScaleStats(value: unknown): ScaleStats {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const rounds = Array.isArray(v.rounds) ? v.rounds : [];
  const out: ScaleRound[] = [];
  for (const r of rounds) {
    if (typeof r !== 'object' || r === null) continue;
    const x = r as Record<string, unknown>;
    if (!isNumber(x.at) || !isNumber(x.scales) || !isNumber(x.firstTry)) continue;
    const kinds: ScaleRound['kinds'] = {};
    if (typeof x.kinds === 'object' && x.kinds !== null) {
      for (const [k, c] of Object.entries(x.kinds)) {
        if (Array.isArray(c) && c.length === 2 && c.every(isNumber))
          kinds[k] = [c[0], c[1]] as [number, number];
      }
    }
    const round: ScaleRound = {
      at: x.at,
      scales: x.scales,
      firstTry: x.firstTry,
      notesPerMinute: isNumber(x.notesPerMinute) ? x.notesPerMinute : 0,
      evenness: isNumber(x.evenness) ? x.evenness : null,
      kinds,
    };
    if (typeof x.causes === 'object' && x.causes !== null) {
      const causes: Record<string, ScaleMiss> = {};
      for (const [k, c] of Object.entries(x.causes)) {
        if (CAUSES.includes(c as ScaleMiss)) causes[k] = c as ScaleMiss;
      }
      round.causes = causes;
    }
    out.push(round);
  }
  return { version: 1, rounds: out.slice(-MAX_ROUNDS) };
}

/** The round as it is kept, from the tally's summary. */
export function scaleRoundOf(summary: ScaleRoundSummary, at: number): ScaleRound {
  const kinds: ScaleRound['kinds'] = {};
  const causes: Record<string, ScaleMiss> = {};
  for (const k of summary.byKind) {
    kinds[k.kind] = [k.attempts, k.firstTry];
    let most = 0;
    for (const [cause, n] of Object.entries(k.causes) as [ScaleMiss, number][]) {
      if (n > most) {
        most = n;
        causes[k.kind] = cause;
      }
    }
  }
  return {
    at,
    scales: summary.scales,
    firstTry: summary.firstTry,
    notesPerMinute: summary.notesPerMinute,
    evenness: summary.evenness === null ? null : Math.round(summary.evenness * 1000) / 1000,
    kinds,
    causes,
  };
}

/** The stats with a round added, the oldest dropped past `MAX_ROUNDS`. */
export function addScaleRound(stats: ScaleStats, round: ScaleRound): ScaleStats {
  if (round.scales === 0) return stats;
  return { version: 1, rounds: [...stats.rounds, round].slice(-MAX_ROUNDS) };
}

export interface ScaleKindStats {
  kind: string;
  attempts: number;
  firstTry: number;
  share: number;
}

/** Totals per scale over the kept rounds. */
export function scaleTotals(stats: ScaleStats): ScaleKindStats[] {
  const totals = new Map<string, ScaleKindStats>();
  for (const r of stats.rounds) {
    for (const [kind, [attempts, firstTry]] of Object.entries(r.kinds)) {
      const t = totals.get(kind) ?? { kind, attempts: 0, firstTry: 0, share: 0 };
      t.attempts += attempts;
      t.firstTry += firstTry;
      totals.set(kind, t);
    }
  }
  return [...totals.values()].map((t) => ({
    ...t,
    share: t.attempts > 0 ? t.firstTry / t.attempts : 0,
  }));
}

/**
 * The weak scales: tried at least three times, right at the first try under 80 %, worst first.
 * `allowed` keeps only scales the drill can draw.
 */
export function weakScales(
  stats: ScaleStats,
  allowed?: ReadonlySet<string>,
  count = 6,
): ScaleKindStats[] {
  return scaleTotals(stats)
    .filter(
      (t) =>
        t.attempts >= MIN_ATTEMPTS && t.share < WEAK_SHARE && (!allowed || allowed.has(t.kind)),
    )
    .sort((a, b) => a.share - b.share || b.attempts - a.attempts)
    .slice(0, count);
}

/** The last `n` rounds' shares right at the first try, oldest first. */
export const recentScaleShares = (stats: ScaleStats, n = 5): number[] =>
  stats.rounds.slice(-n).map((r) => (r.scales > 0 ? r.firstTry / r.scales : 0));

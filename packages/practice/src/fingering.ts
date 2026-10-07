// Automatic fingering (Phase 4): which finger plays each note, from common piano practice.
//
// A Viterbi search over each hand's chords picks the sequence of finger assignments with the
// lowest total difficulty. The cost model follows the rules of Parncutt et al. (1997, "An
// ergonomic model of keyboard fingering for melodic fragments"), simplified and extended to
// chords: comfortable and practical spans between finger pairs, weak fingers 4 and 5, thumbs and
// little fingers on black keys, thumb-under / finger-over crossings, and no one finger on two
// different consecutive notes. Fingerings written in the score are kept and constrain the search.
import { isBlackKey } from '@opentiles/song-model';
import type { Hand, Song, SongNote } from '@opentiles/song-model';

export type Finger = 1 | 2 | 3 | 4 | 5;

/**
 * Span limits in semitones between two fingers of the right hand, lower finger to higher finger
 * (a positive distance means the higher-numbered finger plays the higher note):
 * [minPractical, minComfortable, minRelaxed, maxRelaxed, maxComfortable, maxPractical].
 */
const SPANS: Record<string, readonly [number, number, number, number, number, number]> = {
  '1-2': [-5, -3, 1, 5, 8, 10],
  '1-3': [-4, -2, 3, 7, 10, 12],
  '1-4': [-3, -1, 5, 9, 12, 14],
  '1-5': [-1, 1, 7, 10, 13, 15],
  '2-3': [1, 1, 1, 2, 3, 5],
  '2-4': [1, 1, 3, 4, 5, 7],
  '2-5': [2, 2, 5, 6, 8, 10],
  '3-4': [1, 1, 1, 2, 2, 4],
  '3-5': [1, 1, 3, 4, 5, 7],
  '4-5': [1, 1, 1, 2, 3, 5],
};

/**
 * Signed span from finger `fa` on pitch `pa` to finger `fb` on pitch `pb`, normalised so the
 * table above applies: always measured from the lower-numbered finger, and mirrored for the left
 * hand (whose thumb is on the right).
 */
function span(
  fa: Finger,
  pa: number,
  fb: Finger,
  pb: number,
  hand: Hand,
): { key: string; d: number } {
  const [lo, loP, hi, hiP] = fa < fb ? [fa, pa, fb, pb] : [fb, pb, fa, pa];
  const d = hand === 'right' ? hiP - loP : loP - hiP;
  return { key: `${lo}-${hi}`, d };
}

/** Cost of placing two fingers at once or in succession, by how far the span is from relaxed. */
function spanCost(
  fa: Finger,
  pa: number,
  fb: Finger,
  pb: number,
  hand: Hand,
  chord: boolean,
): number {
  if (fa === fb) return 0;
  const { key, d } = span(fa, pa, fb, pb, hand);
  const s = SPANS[key];
  if (!s) return 0;
  const [minPrac, minComf, minRel, maxRel, maxComf, maxPrac] = s;
  let cost = 0;
  // Stretch: beyond comfortable.
  if (d > maxComf) cost += 2 * (d - maxComf);
  if (d < minComf) cost += 2 * (minComf - d);
  // Small-span / large-span: outside relaxed (doubled for chords, where there is no time to move).
  const rel = d > maxRel ? d - maxRel : d < minRel ? minRel - d : 0;
  cost += (chord ? 2 : 1) * rel;
  // Impractical: the hand has to jump.
  if (d > maxPrac) cost += 10 * (d - maxPrac);
  if (d < minPrac) cost += 10 * (minPrac - d);
  return cost;
}

/** Costs that depend on one finger on one key. */
function placementCost(f: Finger, pitch: number): number {
  let cost = 0;
  if (f === 4) cost += 0.25; // weaker fingers
  if (f === 5) cost += 0.5;
  if (isBlackKey(pitch)) {
    if (f === 1) cost += 2; // thumb on a black key
    if (f === 5) cost += 1;
  }
  return cost;
}

/** Costs between consecutive single notes beyond the span rules. */
function moveCost(fa: Finger, pa: number, fb: Finger, pb: number, hand: Hand): number {
  if (pa === pb) return fa === fb ? 0 : 3; // repeated notes: same finger is simplest for learners
  if (fa === fb) return 6 + Math.abs(pb - pa); // same finger on two different notes breaks legato
  let cost = spanCost(fa, pa, fb, pb, hand, false);
  const up = hand === 'right' ? pb > pa : pb < pa; // towards the little finger
  const crossing = up ? fb < fa : fb > fa;
  if (crossing) {
    // Only crossings involving the thumb are idiomatic (thumb under, finger over thumb).
    if (fa === 1 || fb === 1) {
      // Crossing means the hand changes position: worth it only when the line needs more room.
      cost += 5;
      if (isBlackKey(fb === 1 ? pb : pa) && fb === 1) cost += 2;
    } else {
      cost += 8;
    }
  }
  // 3 then 4 (or 4 then 3) is awkward.
  if ((fa === 3 && fb === 4) || (fa === 4 && fb === 3)) cost += 0.5;
  return cost;
}

type Assignment = readonly Finger[];

/** All ways to give a chord's notes (sorted low to high) fingers in hand order. */
function candidates(size: number, hand: Hand): Assignment[] {
  const out: Assignment[] = [];
  const pick = (start: number, acc: Finger[]) => {
    if (acc.length === size) {
      // Right hand: low note gets the lowest finger; left hand: low note gets the highest.
      out.push(hand === 'right' ? [...acc] : [...acc].reverse());
      return;
    }
    for (let f = start; f <= 5; f++) pick(f + 1, [...acc, f as Finger]);
  };
  pick(1, []);
  return out;
}

interface Group {
  pitches: number[];
  notes: SongNote[];
  /** Fingers written in the score, by index into `pitches`. */
  fixed: (Finger | undefined)[];
}

function groupsFor(notes: readonly SongNote[]): Group[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const groups: Group[] = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    const first = last?.notes[0];
    if (last && first && Math.abs(first.startBeat - n.startBeat) < 1e-3) {
      if (!last.pitches.includes(n.pitch)) {
        last.pitches.push(n.pitch);
        last.fixed.push(n.fingering as Finger | undefined);
      }
      last.notes.push(n);
    } else {
      groups.push({ pitches: [n.pitch], notes: [n], fixed: [n.fingering as Finger | undefined] });
    }
  }
  for (const g of groups) {
    const order = g.pitches.map((p, i) => ({ p, f: g.fixed[i] })).sort((a, b) => a.p - b.p);
    g.pitches = order.map((o) => o.p);
    g.fixed = order.map((o) => o.f);
  }
  return groups;
}

function stateCost(
  a: Assignment,
  pitches: number[],
  hand: Hand,
  fixed: (Finger | undefined)[],
): number {
  let cost = 0;
  for (let i = 0; i < a.length; i++) {
    const f = a[i] as Finger;
    const want = fixed[i];
    if (want !== undefined && want !== f) return Infinity;
    cost += placementCost(f, pitches[i] ?? 0);
    for (let j = i + 1; j < a.length; j++) {
      cost += spanCost(f, pitches[i] ?? 0, a[j] as Finger, pitches[j] ?? 0, hand, true);
    }
    // In chords, neighbouring notes take fingers about half their interval apart: a third skips a
    // finger (C-E-G with 1-3-5), an open fifth spans the hand (5-1).
    const next = a[i + 1];
    if (next !== undefined) {
      const interval = Math.abs((pitches[i + 1] ?? 0) - (pitches[i] ?? 0));
      const ideal = Math.min(4, Math.max(1, Math.round(interval / 2)));
      cost += 0.75 * Math.abs(Math.abs(next - f) - ideal);
    }
  }
  return cost;
}

function transitionCost(
  a: Assignment,
  pa: number[],
  b: Assignment,
  pb: number[],
  hand: Hand,
): number {
  // Judge the move by the notes that change most: the outer voices and each finger that stays.
  let cost = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const fa = a[i] as Finger;
      const fb = b[j] as Finger;
      const near = Math.abs((pa[i] ?? 0) - (pb[j] ?? 0)) <= 12;
      if (!near && a.length > 1 && b.length > 1) continue;
      if (fa === fb && (pa[i] ?? 0) !== (pb[j] ?? 0)) {
        cost += 6 + Math.abs((pb[j] ?? 0) - (pa[i] ?? 0));
      }
    }
  }
  // Single-note style rules between the top notes (melody) and between the bottom notes.
  const top = (x: Assignment, p: number[]) =>
    hand === 'right'
      ? { f: x[x.length - 1] as Finger, p: p[p.length - 1] ?? 0 }
      : { f: x[0] as Finger, p: p[0] ?? 0 };
  const ta = top(a, pa);
  const tb = top(b, pb);
  cost += moveCost(ta.f, ta.p, tb.f, tb.p, hand);
  if (a.length > 1 || b.length > 1) {
    const bot = (x: Assignment, p: number[]) =>
      hand === 'right'
        ? { f: x[0] as Finger, p: p[0] ?? 0 }
        : { f: x[x.length - 1] as Finger, p: p[p.length - 1] ?? 0 };
    const ba = bot(a, pa);
    const bb = bot(b, pb);
    if (ba.f !== ta.f || bb.f !== tb.f) cost += moveCost(ba.f, ba.p, bb.f, bb.p, hand) * 0.5;
  }
  return cost;
}

/**
 * Suggested finger for every note of one hand, keyed by note id. Notes are processed chord by
 * chord; chords wider than five notes keep only the five outermost-to-inner notes fingered.
 */
export function fingerHand(notes: readonly SongNote[], hand: Hand): Map<string, Finger> {
  const groups = groupsFor(notes).map((g) => {
    if (g.pitches.length <= 5) return g;
    // Keep the outer notes and every other inner one; the rest are left unfingered.
    const keep = new Set([
      0,
      g.pitches.length - 1,
      1,
      g.pitches.length - 2,
      Math.floor(g.pitches.length / 2),
    ]);
    const idx = [...keep].sort((a, b) => a - b).slice(0, 5);
    return { ...g, pitches: idx.map((i) => g.pitches[i] ?? 0), fixed: idx.map((i) => g.fixed[i]) };
  });
  const result = new Map<string, Finger>();
  if (groups.length === 0) return result;

  // Viterbi: best[k][s] = lowest cost ending group k with assignment s.
  const states = groups.map((g) => candidates(g.pitches.length, hand));
  let prevCost = (states[0] ?? []).map((s) =>
    stateCost(s, groups[0]?.pitches ?? [], hand, groups[0]?.fixed ?? []),
  );
  const back: number[][] = [];
  for (let k = 1; k < groups.length; k++) {
    const g = groups[k] as Group;
    const pg = groups[k - 1] as Group;
    const cur = states[k] ?? [];
    const prev = states[k - 1] ?? [];
    const costs: number[] = [];
    const from: number[] = [];
    for (let s = 0; s < cur.length; s++) {
      const own = stateCost(cur[s] as Assignment, g.pitches, hand, g.fixed);
      let best = Infinity;
      let arg = 0;
      for (let p = 0; p < prev.length; p++) {
        const c =
          (prevCost[p] ?? Infinity) +
          transitionCost(prev[p] as Assignment, pg.pitches, cur[s] as Assignment, g.pitches, hand);
        if (c < best) {
          best = c;
          arg = p;
        }
      }
      costs.push(best + own);
      from.push(arg);
    }
    // If a written fingering made every state impossible, fall back to ignoring it here.
    if (costs.every((c) => !Number.isFinite(c))) {
      for (let s = 0; s < cur.length; s++) {
        const own = stateCost(
          cur[s] as Assignment,
          g.pitches,
          hand,
          g.fixed.map(() => undefined),
        );
        let best = Infinity;
        let arg = 0;
        for (let p = 0; p < prev.length; p++) {
          const c =
            (prevCost[p] ?? Infinity) +
            transitionCost(
              prev[p] as Assignment,
              pg.pitches,
              cur[s] as Assignment,
              g.pitches,
              hand,
            );
          if (c < best) {
            best = c;
            arg = p;
          }
        }
        costs[s] = best + own;
        from[s] = arg;
      }
    }
    back.push(from);
    prevCost = costs;
  }
  let s = prevCost.indexOf(Math.min(...prevCost));
  if (s < 0) s = 0;
  for (let k = groups.length - 1; k >= 0; k--) {
    const g = groups[k] as Group;
    const a = (states[k] ?? [])[s];
    if (a) {
      g.pitches.forEach((p, i) => {
        for (const n of g.notes) if (n.pitch === p) result.set(n.id, a[i] as Finger);
      });
    }
    if (k > 0) s = back[k - 1]?.[s] ?? 0;
  }
  return result;
}

/** Suggested fingers for the whole song, keyed by note id. Written fingerings are kept. */
export function suggestFingering(song: Song): Map<string, Finger> {
  const out = new Map<string, Finger>();
  for (const hand of ['right', 'left'] as const) {
    for (const [id, f] of fingerHand(
      song.notes.filter((n) => n.hand === hand),
      hand,
    ))
      out.set(id, f);
  }
  return out;
}

/** The song with every note's `fingering` filled in (written fingerings win). */
export function withFingering(song: Song): Song {
  const fingers = suggestFingering(song);
  return {
    ...song,
    notes: song.notes.map((n) => ({ ...n, fingering: n.fingering ?? fingers.get(n.id) })),
  };
}

// The Player's queue (P6-05, P6-08): what plays now and what comes next, with shuffle and repeat.
// Pure, so it is unit-tested in Node. The pieces are kept in the order they were added (`keys`);
// `order` is the order they play in, a permutation of their indices, and `at` the place in it of
// the piece playing now. Without shuffle the order is the list's own; with shuffle the piece
// playing stays first and the rest follow in a random order, so every piece plays once before
// any plays again.
import type { CollectionKey } from './collection';

export type Repeat = 'off' | 'all' | 'one';

export interface Queue {
  readonly keys: readonly CollectionKey[];
  readonly order: readonly number[];
  readonly at: number;
  readonly repeat: Repeat;
  readonly shuffle: boolean;
}

/** A uniform random permutation (Fisher–Yates) of `items`. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** `first` and then every other index, shuffled. */
function shuffledFrom(first: number, n: number, random: () => number): number[] {
  return [
    first,
    ...shuffled(
      range(n).filter((i) => i !== first),
      random,
    ),
  ];
}

export function createQueue(
  keys: readonly CollectionKey[],
  start = 0,
  options: { repeat?: Repeat; shuffle?: boolean } = {},
  random: () => number = Math.random,
): Queue {
  const { repeat = 'off', shuffle = false } = options;
  const first = Math.max(0, Math.min(keys.length - 1, start));
  return shuffle
    ? { keys, order: shuffledFrom(first, keys.length, random), at: 0, repeat, shuffle }
    : { keys, order: range(keys.length), at: first, repeat, shuffle };
}

/** The piece playing now, if any. */
export function currentKey(q: Queue): CollectionKey | undefined {
  const i = q.order[q.at];
  return i === undefined ? undefined : q.keys[i];
}

/** The pieces after the one playing, in the order they will play (this round). */
export function upNext(q: Queue): CollectionKey[] {
  return q.order.slice(q.at + 1).flatMap((i) => (q.keys[i] ? [q.keys[i]] : []));
}

/**
 * The queue moved on to the next piece, or null at the end. `auto` is a piece that finished: with
 * repeat one it plays again; a press of Next always moves on. At the end of a round, repeat all
 * starts another (shuffled anew, never with the piece just heard first).
 */
export function advance(q: Queue, auto: boolean, random: () => number = Math.random): Queue | null {
  if (q.keys.length === 0) return null;
  if (auto && q.repeat === 'one') return q;
  if (q.at + 1 < q.order.length) return { ...q, at: q.at + 1 };
  if (q.repeat === 'off') return null;
  if (!q.shuffle) return { ...q, at: 0 };
  const last = q.order[q.at] ?? 0;
  let order = shuffled(range(q.keys.length), random);
  if (order.length > 1 && order[0] === last) order = [...order.slice(1), last];
  return { ...q, order, at: 0 };
}

/** The queue back one piece; at the start it wraps with repeat all and otherwise stays. */
export function retreat(q: Queue): Queue {
  if (q.at > 0) return { ...q, at: q.at - 1 };
  if (q.repeat !== 'off' && q.order.length > 1) return { ...q, at: q.order.length - 1 };
  return q;
}

export function setRepeat(q: Queue, repeat: Repeat): Queue {
  return { ...q, repeat };
}

/** Shuffle on or off; the piece playing stays and plays on. */
export function setShuffle(q: Queue, shuffle: boolean, random: () => number = Math.random): Queue {
  if (shuffle === q.shuffle) return q;
  const now = q.order[q.at] ?? 0;
  return shuffle
    ? { ...q, shuffle, order: shuffledFrom(now, q.keys.length, random), at: 0 }
    : { ...q, shuffle, order: range(q.keys.length), at: now };
}

/** Adds a piece to play next, or at the end of the queue. */
export function enqueue(q: Queue, key: CollectionKey, next = false): Queue {
  const index = q.keys.length;
  const keys = [...q.keys, key];
  const order = next
    ? [...q.order.slice(0, q.at + 1), index, ...q.order.slice(q.at + 1)]
    : [...q.order, index];
  return { ...q, keys, order };
}

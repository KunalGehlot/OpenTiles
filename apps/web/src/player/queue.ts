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

/** Up next with the piece at `from` moved to `to` (both counted from the next piece, 0). */
export function moveUpNext(q: Queue, from: number, to: number): Queue {
  const head = q.order.slice(0, q.at + 1);
  const rest = q.order.slice(q.at + 1);
  if (from < 0 || from >= rest.length || from === to) return q;
  const [moved] = rest.splice(from, 1);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, moved as number);
  return { ...q, order: [...head, ...rest] };
}

/** The queue without the pieces whose indices `drop` says, the rest kept in their places. */
function without(q: Queue, drop: (index: number) => boolean): Queue {
  const kept: number[] = [];
  const newIndex = new Map<number, number>();
  q.keys.forEach((_, i) => {
    if (drop(i)) return;
    newIndex.set(i, kept.length);
    kept.push(i);
  });
  const current = q.order[q.at];
  const order = q.order.flatMap((i) => (newIndex.has(i) ? [newIndex.get(i) as number] : []));
  const at = current === undefined ? 0 : Math.max(0, order.indexOf(newIndex.get(current) ?? -1));
  return { ...q, keys: kept.map((i) => q.keys[i] as CollectionKey), order, at };
}

/** Up next without the piece at `place` (counted from the next piece, 0). */
export function removeUpNext(q: Queue, place: number): Queue {
  const index = q.order[q.at + 1 + place];
  return index === undefined ? q : without(q, (i) => i === index);
}

/** Nothing up next: the piece playing (and those already heard) stay. */
export function clearUpNext(q: Queue): Queue {
  const coming = new Set(q.order.slice(q.at + 1));
  return without(q, (i) => coming.has(i));
}

/** The queue moved on to the piece at `place` in Up next (counted from the next piece, 0). */
export function skipTo(q: Queue, place: number): Queue {
  return q.at + 1 + place < q.order.length ? { ...q, at: q.at + 1 + place } : q;
}

/** Only the pieces `known` accepts (a library piece deleted since); the piece playing if it can. */
export function keepKnown(q: Queue, known: (key: CollectionKey) => boolean): Queue {
  return without(q, (i) => !known(q.keys[i] as CollectionKey));
}

/** A queue read back from storage, if it is one (P6-08: the queue is kept on this device). */
export function readQueue(value: unknown): Queue | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const keys = Array.isArray(v.keys) ? v.keys : null;
  const order = Array.isArray(v.order) ? v.order : null;
  if (!keys || !order || keys.length === 0 || order.length !== keys.length) return null;
  if (!keys.every((k) => typeof k === 'string' && /^(catalogue:.+|library:\d+)$/.test(k))) {
    return null;
  }
  const sorted = [...order].sort((a, b) => Number(a) - Number(b));
  if (!sorted.every((n, i) => n === i)) return null;
  const at = typeof v.at === 'number' && Number.isInteger(v.at) ? v.at : 0;
  return {
    keys: keys as CollectionKey[],
    order: order as number[],
    at: Math.max(0, Math.min(keys.length - 1, at)),
    repeat: v.repeat === 'all' || v.repeat === 'one' ? v.repeat : 'off',
    shuffle: v.shuffle === true,
  };
}

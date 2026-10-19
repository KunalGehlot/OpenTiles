// Up next (P6-08): reordering, removing, clearing and skipping ahead in the Player's queue, and the
// queue read back after a reload.
import { describe, expect, it } from 'vitest';
import type { CollectionKey } from '../src/player/collection';
import {
  advance,
  clearUpNext,
  createQueue,
  currentKey,
  keepKnown,
  moveUpNext,
  readQueue,
  removeUpNext,
  setShuffle,
  skipTo,
  upNext,
} from '../src/player/queue';
import type { Queue } from '../src/player/queue';

const k = (n: number): CollectionKey => `catalogue:p${n}`;
const keys = [k(0), k(1), k(2), k(3), k(4)];

describe('Up next (P6-08)', () => {
  // Playing p1; p2, p3, p4 to come.
  const q = createQueue(keys, 1);

  it('moves a piece within Up next, by drag or Alt with the arrow keys', () => {
    expect(upNext(moveUpNext(q, 2, 0))).toEqual([k(4), k(2), k(3)]);
    expect(upNext(moveUpNext(q, 0, 1))).toEqual([k(3), k(2), k(4)]);
    expect(upNext(moveUpNext(q, 0, 9))).toEqual([k(3), k(4), k(2)]);
    expect(moveUpNext(q, 5, 0)).toBe(q);
    expect(currentKey(moveUpNext(q, 2, 0))).toBe(k(1));
  });

  it('plays the new order, and keeps it for the next round of repeat all', () => {
    const moved: Queue = { ...moveUpNext(q, 2, 0), repeat: 'all' };
    expect(currentKey(advance(moved, true) ?? q)).toBe(k(4));
    let round = moved;
    for (let i = 0; i < 4; i++) round = advance(round, true) ?? round;
    // p1 p4 p2 p3, then from the start of the order again: p0.
    expect(currentKey(round)).toBe(k(0));
  });

  it('removes a piece, and the rest play on as they were', () => {
    const removed = removeUpNext(q, 1);
    expect(currentKey(removed)).toBe(k(1));
    expect(upNext(removed)).toEqual([k(2), k(4)]);
    expect(removed.keys).toEqual([k(0), k(1), k(2), k(4)]);
    // Shuffle off later does not bring it back.
    expect(
      setShuffle(
        setShuffle(removed, true, () => 0.5),
        false,
      ).keys,
    ).not.toContain(k(3));
  });

  it('clears Up next, keeping the piece playing', () => {
    const cleared = clearUpNext(q);
    expect(currentKey(cleared)).toBe(k(1));
    expect(upNext(cleared)).toEqual([]);
    expect(advance(cleared, true)).toBeNull();
  });

  it('skips ahead to a piece in Up next', () => {
    expect(currentKey(skipTo(q, 2))).toBe(k(4));
    expect(skipTo(q, 3)).toBe(q);
  });

  it('drops pieces that are gone, keeping the one playing where it can', () => {
    const known = keepKnown(q, (key) => key !== k(0) && key !== k(3));
    expect(currentKey(known)).toBe(k(1));
    expect(upNext(known)).toEqual([k(2), k(4)]);
    const gone = keepKnown(q, (key) => key !== k(1));
    expect(currentKey(gone)).toBe(k(0));
  });

  it('reads a stored queue back, and nothing that is not one', () => {
    const stored = JSON.parse(JSON.stringify(moveUpNext({ ...q, repeat: 'one' }, 2, 0))) as unknown;
    expect(readQueue(stored)).toEqual(moveUpNext({ ...q, repeat: 'one' }, 2, 0));
    expect(readQueue(null)).toBeNull();
    expect(readQueue({ keys: [k(0)], order: [1], at: 0 })).toBeNull();
    expect(readQueue({ keys: ['https://example.com'], order: [0], at: 0 })).toBeNull();
    expect(readQueue({ keys: [k(0), k(1)], order: [1, 0], at: 7 })?.at).toBe(1);
  });
});

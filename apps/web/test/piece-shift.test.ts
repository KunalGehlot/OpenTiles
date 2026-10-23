import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { isDeviceSetting } from '../src/backup/backup';
import {
  catalogueShiftKey,
  libraryShiftKey,
  loadPieceShift,
  normaliseShifts,
  PIECE_SHIFTS_KEY,
  savePieceShift,
} from '../src/practice/piece-shift';
import { getSetting, setSetting } from '../src/storage/db';

describe('remembered transposition per piece (P5-04)', () => {
  it('reads damaged stored values as no shift', () => {
    expect(normaliseShifts(null)).toEqual({});
    expect(normaliseShifts([1, 2])).toEqual({});
    expect(normaliseShifts({ a: 2, b: '3', c: 1.5, d: 40, e: 0, f: -12, g: NaN })).toEqual({
      a: 2,
      f: -12,
    });
  });

  it('keeps each piece on its own and forgets a shift back to 0', async () => {
    const ode = catalogueShiftKey('ode-to-joy');
    const mine = libraryShiftKey({ addedAt: 1_760_000_000_000, fileName: 'mine.mid' });
    await savePieceShift(ode, -1);
    await savePieceShift(catalogueShiftKey('twinkle-twinkle'), 3);
    await savePieceShift(mine, 2);
    expect(await loadPieceShift(ode)).toBe(-1);
    expect(await loadPieceShift(catalogueShiftKey('twinkle-twinkle'))).toBe(3);
    expect(await loadPieceShift(mine)).toBe(2);
    // Another file added at another time is another piece, whatever its id.
    expect(
      await loadPieceShift(libraryShiftKey({ addedAt: 1_760_000_000_001, fileName: 'mine.mid' })),
    ).toBe(0);

    await savePieceShift(ode, 0);
    expect(await loadPieceShift(ode)).toBe(0);
    expect(await getSetting(PIECE_SHIFTS_KEY, null)).toEqual({
      'catalogue:twinkle-twinkle': 3,
      'library:1760000000000:mine.mid': 2,
    });
  });

  it('go into the backup: the keys name the piece on every device', () => {
    expect(isDeviceSetting(PIECE_SHIFTS_KEY)).toBe(false);
  });

  it('opens at 0 when the stored map is damaged', async () => {
    await setSetting(PIECE_SHIFTS_KEY, 'nonsense');
    expect(await loadPieceShift(catalogueShiftKey('ode-to-joy'))).toBe(0);
    await savePieceShift(catalogueShiftKey('ode-to-joy'), 1);
    expect(await loadPieceShift(catalogueShiftKey('ode-to-joy'))).toBe(1);
  });
});

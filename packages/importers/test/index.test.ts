import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_EXTENSIONS, importAnyScore, isMuseScoreFile } from '../src/index';
import { chord, domParser, measure, mscx, timeSig } from './fixtures';

const xml = mscx({
  parts: [{ staves: [1] }],
  staves: { 1: [measure({ voices: [timeSig(4, 4) + chord('whole', [64])] })] },
});

describe('importAnyScore', () => {
  it('reads MuseScore files through the lazy-loaded reader', async () => {
    const mscz = zipSync({ 'score.mscx': strToU8(xml) });
    expect((await importAnyScore('a.mscz', mscz, { domParser })).notes[0]?.pitch).toBe(64);
    expect((await importAnyScore('a.mscx', strToU8(xml), { domParser })).format).toBe('mscz');
  });

  it('recognises MuseScore files by content', async () => {
    expect(isMuseScoreFile('download', strToU8(xml))).toBe(true);
    expect(isMuseScoreFile('download', zipSync({ 'x/score.mscx': strToU8(xml) }))).toBe(true);
    expect(isMuseScoreFile('a.mxl', zipSync({ 'score.musicxml': strToU8('<x/>') }))).toBe(false);
    expect((await importAnyScore('download', strToU8(xml), { domParser })).format).toBe('mscz');
  });

  it('hands every other format to song-model', async () => {
    const abc = await importAnyScore('tune.abc', strToU8('X:1\nT:Tune\nL:1/4\nK:C\nCDEF|\n'));
    expect(abc.format).toBe('abc');
    expect(abc.notes).toHaveLength(4);
    const midi = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0,
      13, 0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
    ]);
    expect((await importAnyScore('one.mid', midi)).format).toBe('midi');
  });

  it('lists every accepted extension', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining(['.abc', '.mscz', '.mscx', '.mxl']),
    );
  });
});

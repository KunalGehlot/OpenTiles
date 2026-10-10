import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importScore } from '../src/import';
import { unzipLimited, unzipMxl, ZIP_LIMITS } from '../src/mxl';
import { attrs, domParser, note, score } from './fixtures';

const xml = score([
  [
    {
      attributes: attrs({ divisions: 1, beats: 1 }),
      content: note({ step: 'A', octave: 4, duration: 1 }),
    },
  ],
]);

describe('importScore', () => {
  it('reads compressed MusicXML via its container', () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="score/main.musicxml"/></rootfiles></container>',
      ),
      'score/main.musicxml': strToU8(xml),
    });
    const song = importScore('My Piece.mxl', zip, { domParser });
    expect(song.format).toBe('mxl');
    expect(song.title).toBe('My Piece');
    expect(song.notes[0]?.pitch).toBe(69);
  });

  it('reads plain MusicXML, including UTF-16', () => {
    expect(importScore('a.musicxml', strToU8(xml), { domParser }).notes).toHaveLength(1);
    const utf16 = new Uint8Array(2 + xml.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < xml.length; i++) utf16[2 + i * 2] = xml.charCodeAt(i);
    expect(importScore('b.xml', utf16, { domParser }).notes).toHaveLength(1);
  });

  it('explains unsupported MuseScore files', () => {
    expect(() => importScore('x.mscz', new Uint8Array([1, 2, 3]))).toThrow(/MuseScore/);
  });
});

describe('unzipLimited', () => {
  it('refuses an archive that would expand to an unreasonable size', () => {
    // 70 MB of zeros compresses to a few kilobytes: a zip bomb in miniature.
    const bomb = zipSync({ 'score.xml': new Uint8Array(70 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => unzipLimited(bomb)).toThrow(/too large/);
    expect(() => unzipMxl(bomb)).toThrow(/too large/);
  });

  it('refuses an archive with too many entries', () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i <= ZIP_LIMITS.entries; i += 1) many[`f${i}.txt`] = new Uint8Array(1);
    expect(() => unzipLimited(zipSync(many))).toThrow(/too large/);
  });

  it('opens an ordinary archive and can skip entries by name', () => {
    const zip = zipSync({ 'a.xml': new Uint8Array([1, 2]), 'thumb.png': new Uint8Array(3) });
    expect(Object.keys(unzipLimited(zip))).toEqual(['a.xml', 'thumb.png']);
    expect(Object.keys(unzipLimited(zip, (n) => n.endsWith('.png')))).toEqual(['a.xml']);
  });
});

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importScore } from '../src/import';
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

// What the engraver worker does (P5-13), run in Node with Verovio: a catalogue piece laid out as
// pages that fit a view and as one long system, every measure on a page, every note linked; a
// score written from a MIDI file linked by its refs. The scores are the catalogue's own (public
// domain or CC0) and a MIDI file generated in the song-model tests' style here.
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '@opentiles/song-model';
import type { DomParserLike } from '@opentiles/song-model';
import { drawPages, layoutOptions, linkScore } from '../src/views/score/engrave-core';
import { scoreFor } from '../src/views/score/notation';
import { createToolkit } from '../src/views/score/verovio';

const domParser = new DOMParser() as unknown as DomParserLike;
const score = (slug: string) =>
  readFileSync(
    new URL(`../../../catalogue/pieces/${slug}/score.musicxml`, import.meta.url),
    'utf8',
  );
const minuet = score('minuet-in-g');
const elise = score('fur-elise-complete');

describe('the engraver’s work (P5-13)', () => {
  it('lays a long piece out as pages and as one system, and links every note', async () => {
    const song = parseMusicXml(elise, { domParser });
    const tk = await createToolkit({ kind: 'musicxml', text: elise, transpose: 0 }, {});
    try {
      const pages = drawPages(tk, layoutOptions(700, 500, 'page'));
      expect(pages.pages.length).toBeGreaterThan(1);
      expect(pages.measureIds.length).toBe(new Set(song.measures.map((m) => m.sourceIndex)).size);
      // Every measure is on a page, and the pages come in order.
      const onPages = pages.measureIds.map((_, i) => pages.measurePage.get(i) ?? 0);
      expect(onPages.every((p) => p >= 1)).toBe(true);
      expect(onPages).toEqual([...onPages].sort((a, b) => a - b));
      expect(linkScore(tk, song, pages, false).unmatched).toEqual([]);

      const strip = drawPages(tk, layoutOptions(1200, 300, 'scroll'));
      expect(strip.pages).toHaveLength(1);
      expect(linkScore(tk, song, strip, false).unmatched).toEqual([]);
    } finally {
      tk.destroy();
    }
  }, 30_000);

  it('links a score written from a song by its refs', async () => {
    const song = parseMusicXml(minuet, { domParser });
    const written = scoreFor('midi', undefined, { ...song, format: 'midi' });
    if (written.notation.kind !== 'musicxml') throw new Error('no score');
    const tk = await createToolkit(written.notation, {});
    try {
      const drawn = drawPages(tk, layoutOptions(1200, 300, 'scroll'));
      const links = linkScore(tk, written.song, drawn, true);
      expect(links.unmatched).toEqual([]);
      expect(links.glyphsOf.size).toBe(written.song.notes.length);
    } finally {
      tk.destroy();
    }
  }, 30_000);
});

// Every catalogue score must survive the Song model (spec §9, step 4).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importScore } from '../src/import';
import { domParser } from './fixtures';

const piecesDir = fileURLToPath(new URL('../../../catalogue/pieces/', import.meta.url));
const slugs = readdirSync(piecesDir);

describe('catalogue scores', () => {
  it.each(slugs)('%s parses into a playable song', (slug) => {
    const prov = JSON.parse(readFileSync(`${piecesDir}${slug}/provenance.json`, 'utf8')) as {
      score_file: string;
      title: string;
    };
    const bytes = readFileSync(`${piecesDir}${slug}/${prov.score_file}`);
    const song = importScore(prov.score_file, new Uint8Array(bytes), { domParser });
    expect(song.title).toBe(prov.title);
    expect(song.notes.length).toBeGreaterThan(8);
    expect(song.warnings).toEqual([]);
    expect(new Set(song.notes.map((n) => n.hand))).toEqual(new Set(['left', 'right']));
    for (const n of song.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(21);
      expect(n.pitch).toBeLessThanOrEqual(108);
      expect(n.durationBeats).toBeGreaterThan(0);
    }
    const end = song.measures.at(-1);
    expect(end && end.startBeat + end.lengthBeats).toBeCloseTo(song.lengthBeats);
  });

  it('reads the Für Elise pickup and sixteenths', () => {
    const bytes = readFileSync(`${piecesDir}fur-elise-opening/score.musicxml`);
    const song = importScore('score.musicxml', new Uint8Array(bytes), { domParser });
    expect(song.measures[0]?.lengthBeats).toBeCloseTo(0.5);
    expect(song.notes.slice(0, 2).map((n) => n.pitch)).toEqual([76, 75]);
    expect(song.notes[0]?.fingering).toBe(5);
  });
});

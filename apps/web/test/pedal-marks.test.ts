// The sustain pedal drawn in the score of a MIDI piece (P6-10): the written MusicXML engraved by
// Verovio, in Node, shows "Ped." and the release star where the file presses and lifts it. The song
// is made up here (CC0).
import { describe, expect, it } from 'vitest';
import { songToMusicXml } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';

interface Toolkit {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  renderToSVG(page: number): string;
  destroy(): void;
}

const song: Song = {
  title: 'Pedalled',
  format: 'midi',
  notes: [48, 55, 52, 55].map((pitch, i) => ({
    id: `n${i}`,
    pitch,
    startBeat: i * 2,
    durationBeats: 2,
    hand: 'left' as const,
    staff: 2,
    voice: 1,
    part: 0,
    measureIndex: Math.floor(i / 2),
    sourceRefs: [],
  })),
  measures: [0, 1].map((i) => ({
    index: i,
    number: String(i + 1),
    sourceIndex: i,
    startBeat: 4 * i,
    lengthBeats: 4,
  })),
  tempos: [{ beat: 0, bpm: 80 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  keySignatures: [{ beat: 0, fifths: 0 }],
  parts: [{ name: 'Piano' }],
  lengthBeats: 8,
  warnings: [],
  pedals: [
    { beat: 0, pedal: 'sustain', value: 127 },
    { beat: 4, pedal: 'sustain', value: 0 },
    { beat: 4, pedal: 'sustain', value: 127 },
    { beat: 7.5, pedal: 'sustain', value: 0 },
  ],
};

describe('the sustain pedal in the engraved score (P6-10)', () => {
  it('is drawn where the file presses, changes and lifts it', async () => {
    const [wasm, esm] = await Promise.all([import('verovio/wasm'), import('verovio/esm')]);
    const module = await wasm.default();
    esm.enableLog(esm.LOG_OFF, module);
    const tk = new (esm.VerovioToolkit as new (module: unknown) => Toolkit)(module);
    try {
      tk.setOptions({ header: 'none', footer: 'none' });
      expect(tk.loadData(songToMusicXml(song).xml)).toBeTruthy();
      const svg = tk.renderToSVG(1);
      // One drawn pedal mark for each press, change and lift.
      expect(svg.match(/class="pedal"/g)?.length).toBe(3);
    } finally {
      tk.destroy();
    }
  }, 30_000);
});

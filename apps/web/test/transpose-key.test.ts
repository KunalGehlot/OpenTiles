// The song's key after a shift and the key Verovio engraves the shifted score in must be the same
// (P5-04): the falling notes name black keys "as the key", the score writes them in its key. Checked
// against Verovio itself, in Node, for every key and every shift up to an octave either way. The
// one-note score is made up here (CC0).
import { describe, expect, it } from 'vitest';
import { transposeKey } from '@opentiles/song-model';

interface Toolkit {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  getMEI(): string;
  destroy(): void;
}

const score = (fifths: number) =>
  '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
  `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
  '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

describe('a shifted key (P5-04)', () => {
  it('is the key Verovio engraves the shifted score in, for every key and shift', async () => {
    const [wasm, esm] = await Promise.all([import('verovio/wasm'), import('verovio/esm')]);
    const module = await wasm.default();
    esm.enableLog(esm.LOG_OFF, module);
    const Toolkit = esm.VerovioToolkit as new (module: unknown) => Toolkit;
    const differ: string[] = [];
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (let shift = -12; shift <= 12; shift++) {
        const tk = new Toolkit(module);
        try {
          tk.setOptions(shift ? { transpose: String(shift) } : {});
          tk.loadData(score(fifths));
          const sig = /<keySig[^>]*\ssig="([^"]+)"/.exec(tk.getMEI())?.[1] ?? '0';
          const engraved =
            sig === '0' ? 0 : Number(sig.slice(0, -1)) * (sig.endsWith('f') ? -1 : 1);
          const ours = transposeKey(fifths, shift);
          if (ours !== engraved) differ.push(`${fifths} by ${shift}: ${ours}, Verovio ${engraved}`);
        } finally {
          tk.destroy();
        }
      }
    }
    expect(differ).toEqual([]);
  }, 60_000);
});

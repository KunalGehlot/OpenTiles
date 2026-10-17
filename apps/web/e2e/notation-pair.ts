// A MIDI file and the PDF of the same score (P5-18), both made here (CC0): the made-up score of
// packages/sheet/test/notation-score.ts, engraved by Verovio as a vector PDF the way notation
// programs export one, and the MIDI file such a program would export with it. Node only.
import { songOf, musicXml } from '../../../packages/sheet/test/notation-score';
import { engrave, svgPdf } from '../../../packages/sheet/test/engraved';
import { notatedMidi } from '../../../packages/song-model/test/fixtures';

export async function notationPdf(): Promise<Buffer> {
  return Buffer.from(svgPdf(await engrave(musicXml(), 'Leipzig')));
}

export function notationMidi(): Buffer {
  const { song } = songOf();
  return Buffer.from(
    notatedMidi(
      song.notes.map((n) => {
        // A rolled chord's notes start a little late and end with the chord.
        const beat = Math.floor(n.startBeat);
        const late = n.startBeat - beat;
        return {
          pitch: n.pitch,
          start: beat,
          value: n.durationBeats + late,
          track: n.staff - 1,
          rollTicks: Math.round(late * 480),
        };
      }),
    ),
  );
}

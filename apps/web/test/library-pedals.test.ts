// Pedals for library pieces stored before the importers read them (P6-10): read once from the
// kept file. The MIDI file is generated here (CC0).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { importScore } from '@opentiles/song-model';
import { songWithPedals } from '../src/library/pedals';
import { db } from '../src/storage/db';
import { addLibraryItem, getLibraryFiles } from '../src/storage/library';

/** C4 and E4 as quarter notes under the sustain pedal, which goes up after them. */
function pedalledMidi(): Uint8Array {
  const events = [
    0, 0xb0, 64, 127, 0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 0, 0, 0x90, 64, 80, 0x83, 0x60, 0x80,
    64, 0, 0, 0xb0, 64, 0, 0, 0xff, 0x2f, 0,
  ];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const len = events.length;
  return new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, 0, 0, len >> 8, len & 0xff, ...events]);
}

describe('pedals for stored library pieces (P6-10)', () => {
  it('are read from the kept file once, keeping the reviewed notes', async () => {
    await Promise.all([db.library.clear(), db.files.clear()]);
    const bytes = pedalledMidi();
    const { pedals: _none, ...stored } = importScore('Study.mid', bytes);
    // As stored before pedals were read: the notes, no pedals field.
    const id = await addLibraryItem({
      title: 'Study',
      fileName: 'Study.mid',
      format: 'midi',
      bytes,
      song: { ...stored, title: 'Reviewed' },
      settings: { transpose: 0, swapHands: false },
      tags: [],
      addedAt: 1,
    });
    const song = await songWithPedals(id);
    expect(song?.title).toBe('Reviewed');
    expect(song?.pedals).toEqual([
      { beat: 0, pedal: 'sustain', value: 127 },
      { beat: 2, pedal: 'sustain', value: 0 },
    ]);
    expect((await db.library.get(id))?.song.pedals).toHaveLength(2);
    expect((await getLibraryFiles(id))?.bytes).toEqual(bytes);
    // Read once: a file without pedals is stored as having none.
    await db.library.update(id, { 'song.pedals': [] });
    expect((await songWithPedals(id))?.pedals).toEqual([]);
    expect(await songWithPedals(id + 1)).toBeUndefined();
  });
});

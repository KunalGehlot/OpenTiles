# 0020 — Pedals in the `Song`

- **Status:** proposed
- **Date:** 2026-10-17
- **Plan task:** P6-10 (amends ADR 0003)

## Context

The Player (ADR 0019) plays whole pieces on the learner's own piano or keyboard. Without the
sustain pedal most piano music sounds dry and choppy there: Chopin, Satie, most of the Romantic
repertoire. MIDI files carry the pedals as control changes (64 sustain, 66 sostenuto, 67 soft), and
MusicXML has `<pedal>` marks and `<sound damper-pedal|soft-pedal|sostenuto-pedal>`. The `Song`
(ADR 0003) had no place for them, and the importers dropped them.

Two kinds of instrument play the app's notes. A MIDI keyboard has pedals of its own: it should get
the pedal as control changes and each key's own release. This device's sampler has no pedal; it is
handed each note ahead of time (at most 120 ms, P6-03), so it cannot wait for a pedal change it has
not been told about yet.

## Decision

- **`Song.pedals?: PedalEvent[]`**, each `{ beat, pedal: 'sustain' | 'soft' | 'sostenuto', value }`
  with `value` 0–127 as in MIDI (64 and up is down; values between are half pedalling). Positioned in
  beats, unrolled with the repeats like everything else in ADR 0003; sorted by beat, with events on
  one beat in their order (a pedal change is "up, then down again"). Absent in songs stored before
  the importers read pedals, and in files without any.
- **Readers.** MIDI: control changes 64, 66 and 67 on the channels whose notes are kept, snapped to
  the grid a played file's notes are quantised to. MusicXML: `<pedal>` start, stop, change (up and
  down again), resume, discontinue and sostenuto, with the `<direction>`'s `<offset>`, and the
  `<sound>` pedal attributes ("yes", "no" or a percentage) where no mark says it. A repeated bar
  repeats its pedalling. `tidyPedals` sorts, clamps and drops repeats of the same value.
- **Transforms** keep the pedals: those that spread the song keep them as they are, and
  `trimMeasures` keeps each pedal as it stood at the cut.
- **Playback** (`buildPlayback`, P6-03). Each note gets `held`: when it stops sounding, later than
  its key release while the sustain pedal is down then, or when the sostenuto pedal caught it.
  Instruments without pedals (this device's sampler and synth) sound a note for its held length;
  instruments with pedals (MIDI out) get the key's own length and the pedal events as control
  changes. A pedal event comes before the notes on its beat. Listen and the Player send the pedal;
  play-along's other hand does not (the learner plays on the same keyboard, and the file's pedal
  would hold their notes too), though its notes are still held as the pedal would hold them.
- **Stopping** lifts all three pedals on the keyboard, before All Notes Off (P6-02).
- **Stored library songs** get their pedals the first time they are opened or played, read from the
  kept file (`library/pedals.ts`); only the pedals are taken, so the notes stay as reviewed. A file
  without pedals is stored as having none, so it is read once.

## Consequences

- Pieces played on a keyboard sound as their files say, pedal included; on this device, notes ring
  for as long as the pedal holds them.
- The soft pedal reaches MIDI keyboards only; the sampler ignores it for now (P6-11 may use it).
- The score views do not engrave pedal marks yet: `songToMusicXml` does not write them.
- A song read with an older importer differs from a fresh one only in having no `pedals`, which
  the one-time read fills in.

## Alternatives considered

- **Pedal handling inside the sampler** (hold releases while it is down). Lost: notes are handed
  over before the pedal changes that end them are known, so the sampler would have to reschedule
  releases it has already set; working out held lengths from the whole song is exact and simple.
- **Lengthening the notes in the `Song`** by the pedal. Lost: the score, scoring and the keys to
  play would all see wrong lengths, and a keyboard would get no pedal at all.
- **Re-importing stored pieces** to pick up the pedals. Lost: an improved importer could change the
  notes the learner reviewed, and with them the bar map of a sheet-music PDF.

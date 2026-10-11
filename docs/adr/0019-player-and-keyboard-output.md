# 0019 — A Player page, and the app's notes on the learner's keyboard

- **Status:** proposed
- **Date:** 2026-10-11
- **Plan task:** P6-00 (the plan, [docs/phase-6/player.md](../phase-6/player.md)), P6-01 to P6-12

## Context

On 2026-10-11 the maintainer asked for three things:

- an elegant Player page that lists all their music (library and catalogue together) and plays it
  on the keyboard connected to the device;
- the same with a keyboard connected to an iPad through Firefox, Chrome or Edge;
- in practice, a way for Listen mode to play only on the keyboard and not on the laptop.

What the code and the platforms allow:

- **MIDI out exists** (P4-19): `settings.midi.playback` is `device`, `keyboard` or `both`. But the
  choice sits in the Options popover. `playbackInstrument()` also falls back to the device without
  a word whenever no MIDI output was found, and the output exists only while MIDI input runs.
- **Listen mode schedules notes from `requestAnimationFrame`,** which stops in a hidden tab. Stopping
  sends only All Notes Off. The `Song` has no pedal events, and notes have velocities only when the
  source is a MIDI file.
- **iPad browsers have no Web MIDI.** All of them use WebKit. Other engines are allowed in the EU
  since iPadOS 18, but none had shipped as of mid-2026.
- **USB audio on the iPad:** the maintainer found that with their Yamaha plugged in by USB, iPadOS
  plays all of the iPad's sound through the keyboard's speakers. The keyboard works as a USB audio
  interface, so the app's Listen mode already sounds from the keyboard in Edge. The keys played do
  not reach the app that way.
- **Spec §5:** "Keep sound playback in a Web Audio sampler; no reliance on Web MIDI output."
- **Hard rules 1 and 3:** library items have no way out, and processing stays on the device.

## Decision

1. **A Player page** (`#/player`) lists the catalogue and the library in one collection and plays
   pieces one after another, with a queue, shuffle and repeat. It always works on the device's
   sampler. MIDI out to the keyboard is an option on top, so spec §5 holds.
2. **One playback scheduler,** in `packages/practice` (pure), turns a `Song` into timed note and
   pedal events for given hands, tempo and range. Listen mode, play-along's accompaniment and the
   Player all use it, so a fix to pedal, touch or stopping reaches every place that plays notes.
3. **The Player's transport is a module-level singleton driven by a worker clock,** so playback
   continues on other pages and in a hidden tab. Only one thing owns the sound at a time: practice,
   drills and the Detector Lab stop the Player.
4. **Where the app's notes play is always visible and never changes silently.** A "Plays on"
   control sits in the practice session bar and in the Player. When the keyboard is chosen but
   cannot be reached, the screen says so. Practice plays on the device meanwhile; the Player pauses
   if the keyboard disappears mid-piece.
5. **Stopping on a keyboard is complete:** note-offs for every note sounding or scheduled, the
   sustain pedal released, All Notes Off, and `clear()` where the browser has it. This happens on
   stop, seek, mode change, leaving the page and `pagehide`.
6. **On iPad, two routes.** USB audio in any browser, for the sound: documented in the app, no
   code. The OpenTiles iPad app (CoreMIDI) for real MIDI in and out, with Bluetooth MIDI pairing.
   The web app keeps feature-detecting Web MIDI, so an iPad browser that ships it later works
   unchanged.
7. **Everything stays on the device.** The queue is stored locally as keys. There is no share
   link, cast, export or recording in the Player (hard rule 1, ADR 0010). Media Session metadata
   goes only to the device's own system controls.

The answers to the open questions in the plan (§7) amend this ADR when the maintainer decides. A
pedal field in the `Song` (P6-10) gets its own ADR (0020), because it changes the model of ADR 0003.

## Consequences

- **The learner can play every piece they have on their own piano's sound,** and hear on screen
  where the notes go.
- **Practice's scheduling code moves into a tested pure module,** a refactor of
  `views/session.ts` that must leave scoring and timing unchanged.
- **A worker clock adds a file to the build and the PWA precache.** Background timing has to be
  measured in Chrome, Edge and Firefox, because the browsers throttle hidden pages differently.
- **USB audio on iPad sends all of the iPad's sound to the keyboard.** The app cannot offer "both"
  or choose that output there, and it cannot detect the route reliably, so it only explains it.
- **The iPad app needs Swift work** (destinations, timed send, flush, pairing) and a device test by
  a person.

## Alternatives considered

- **A second scheduler just for the Player.** Lost: Listen and the Player would drift apart, and
  every MIDI out fix would have to be made twice.
- **Exporting a MIDI file for the keyboard's own player or a USB stick.** Lost: it is a way out for
  library items (hard rule 1) and would need the legal review (P2-18).
- **A third-party iPad browser that adds Web MIDI to WebKit** ("Web MIDI Browser", last updated
  around 2016), or a Web MIDI polyfill. Lost: unmaintained and outside the project's control; the
  project's own iPad app already reads CoreMIDI.
- **Always driving playback from `requestAnimationFrame`.** Lost: it stops in a hidden tab, and a
  player has to keep playing while the learner does something else.
- **Falling back to the device without a word** (today's behaviour). Lost: it is exactly what made
  "Listen only plays through my laptop" look like a missing feature.

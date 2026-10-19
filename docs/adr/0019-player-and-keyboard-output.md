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

A pedal field in the `Song` (P6-10) gets its own ADR (0020), because it changes the model of ADR 0003.

### The open questions, answered (2026-10-17)

The maintainer accepted the plan's recommendations (§7 of the plan) for Q1 to Q8:

- **Q1:** one "Plays on" setting for all of the app's notes, visible in the session bar and the
  Player. No separate setting for Listen.
- **Q2:** with the keyboard chosen but not reachable, practice plays on this device, says so and
  offers Connect.
- **Q3:** the metronome and count-in stay on this device.
- **Q4:** pieces without velocities play with natural touch by default; "even" is an option.
- **Q5:** the Player keeps playing on other pages, with a mini player; practice, drills and the
  Detector Lab stop it.
- **Q6:** a gap of 2 s between pieces, adjustable from 0 to 5 s.
- **Q7:** no programme change at the start, so the voice chosen on the keyboard stays.
- **Q8:** the German name of the page is "Wiedergabe", pending the native read-through.

### The Player's design, and what it added (2026-10-18)

The maintainer asked for the Player to "work like one of those self playing grand pianos" and
answered the design brief ([docs/phase-6/player-piano.md](../phase-6/player-piano.md), §7):

- **Q9:** the Player is a **player piano**: a paper roll moving down onto a drawn grand keyboard
  whose keys go down by themselves, pedals that move, the next title printed on the roll's leader
  between pieces, and a programme grouped by composer. Prototype variants A and B are dropped.
- **Q10:** hand colours are off in the Player, with a "Show hands" switch.
- **Q11:** a richer piano sound (more of the Salamander loudness layers, same licence as ADR 0007)
  becomes **the default sound**, with a soft room sound in the Player (P6-17).
- **Q12:** phrasing (expressive playback) is built now and is on in the Player, off in practice
  (P6-16).
- **Q13:** on the iPad the browser plays through the keyboard's speakers over USB audio; the iPad
  app (real MIDI) is installed together later.
- **Q14:** stand mode, the music room alone with controls that fade (P6-15).

### The keyboard's own sound by default (2026-10-19)

The maintainer heard the app's sampled piano from the Player through their keyboard's speakers
(the keyboard is also the computer's USB audio output) and asked for the keyboard's own sound:
the open sample set is not as good as the piano's. Q1 stands (one "Plays on" setting), with a
fourth choice that is now the default: **Automatic**, the keyboard's own sound over MIDI whenever
a keyboard is connected, and this device otherwise, with no warning for learners who have no
keyboard. A "This device" saved before it existed reads as Automatic. Automatic never prompts for
MIDI by itself; the Player offers "Play on your piano" to connect. On an iPad the keyboard's own
sound still needs the iPad app (P6-12, P3-01): no iPad browser has Web MIDI.

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

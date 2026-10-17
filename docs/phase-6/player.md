# Phase 6 — The Player, and playing on your own keyboard

- **Status:** planned on 2026-10-11; work started on 2026-10-17. The tasks are P6-00 to P6-14 in
  [PLAN.md](../../PLAN.md#phase-6--the-player-from-2026-10-11); the decisions are in
  [ADR 0019](../adr/0019-player-and-keyboard-output.md) (proposed).
- **Read first:** the [development guide](../development.md) (hard rules), [PLAN.md](../../PLAN.md),
  [architecture.md](../architecture.md), then this file. Each task below says why it exists, what
  the code does today, what to build, which files to touch, when it is done, how to test it and
  what to watch out for. Anyone can pick up a task whose dependencies are merged.

## 1. What the maintainer asked for (2026-10-11)

1. **A Player page** that looks "really nice and elegant": one list of all the music, the learner's
   library and the catalogue together. Pick a piece, or play them all, and it plays on the piano or
   keyboard connected to the device.
2. **Keyboard connected to the iPad** through Firefox, Chrome or Edge.
3. **Listen mode on the keyboard only.** Today the learner's keys play through the laptop, but the
   app's notes don't reach the keyboard: "if I'm in listen mode, it only plays through my laptop,
   whereas I want also a way, even in practice mode, where if I'm in listen mode, it only plays
   through my keyboard and not through the laptop."

## 2. Facts that shape the plan

### 2.1 iPad browsers have no MIDI, but USB audio already works

- Every browser on iPad (Safari, Chrome, Edge, Firefox) uses Apple's WebKit engine, and WebKit has
  no Web MIDI. Since iPadOS 18 the EU allows other engines, but as of mid-2026 Google and Mozilla
  had only shown prototypes. Rechecked on 2026-10-17: Chrome for iPad still uses WebKit, and no iPad
  browser has Web MIDI. **Recheck this when you pick the work up.** The app feature-detects
  `navigator.requestMIDIAccess`, so a browser that ships Web MIDI on iPad will work without changes.
- **The maintainer's finding (2026-10-11):** M1 iPad Pro, Edge, their Yamaha keyboard plugged in by
  USB. The app's notes came out of the keyboard's speakers without pressing Connect. Nothing else
  worked: the keys played did not reach the app. The cause is that the keyboard is also a
  class-compliant **USB audio interface**, so iPadOS sends all of the iPad's sound to it. That is
  not MIDI.

On iPad there are therefore three routes:

| Route               | Where                                                   | The app's notes on the keyboard                                                                                                                      | The keys played, into the app                                                                                    | Status            |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| USB audio           | Any iPad browser, keyboard with a USB audio function    | Yes. The app's own piano sound (the Salamander samples) through the keyboard's speakers. All iPad sound goes there; no "both" and no per-app choice. | Perhaps. The microphone may then listen to the keyboard's USB audio, a clean line signal. Not tried yet (P6-13). | Sound works today |
| iPad app (CoreMIDI) | The OpenTiles iPad app (`apps/ios-shell`)               | Yes, in the keyboard's own voice, once P6-12 adds MIDI out                                                                                           | Yes. Written (`input/native-midi-input.ts`), never run on a device.                                              | P3-01, P6-12      |
| Web MIDI            | Chrome, Edge, Firefox on macOS, Windows, Linux, Android | Yes (MIDI out, P4-19)                                                                                                                                | Yes                                                                                                              | In `main`         |

The Player page (P6-07) therefore works on an iPad from the first day through USB audio, with "This
device" as its output. The page should say so, not show MIDI controls that cannot work there.

### 2.2 Keyboard-only playback mostly exists, but can quietly fall back to the laptop

- `settings.midi.playback` is `'device' | 'keyboard' | 'both'` (`apps/web/src/settings/model.ts`,
  `MidiPlayback`). It appears in the practice Options popover as "App's notes play on"
  (`routes/Practice.tsx`, around line 800), and in Settings → MIDI keyboard with a test note.
- P5-12's third fix (`d6f9273`, merged and deployed on 2026-10-11 at 20:24) was for "the app's notes
  never reached the keyboard": the practice screen stopped its own MIDI input on every port change.
  The maintainer's report may predate that fix.
- **The silent fallback.** `applySound` (`routes/Practice.tsx`, around line 421) takes
  `midiInput?.output(midiOutput) ?? null`. `playbackInstrument` (`audio/midi-out.ts`) returns the
  device instrument whenever that is `null`. It is `null` in several cases: MIDI was never started
  on this screen (no Connect, no permission yet, or the automatic connection has not happened), or
  `pickOutput` found no output (several outputs, none named like the keyboard's input). In each
  case, choosing "My MIDI keyboard" plays on the laptop and nothing on screen says so.
- The choice is buried in the Options popover.
- **Clicks:** `MidiOutInstrument.click()` does nothing and `SplitInstrument` sends the metronome and
  count-in to the device only. So with "keyboard only" the clicks still come from the laptop. That
  is by design so far, but it needs a decision (Q3).
- **Stopping:** `silence()` sends only CC 123 (All Notes Off) on channel 1. Not every keyboard
  honours it, and it does not lift the sustain pedal. Whether `MIDIOutput.clear()` exists and drops
  messages already stamped is unchecked, so up to `SCHEDULE_AHEAD` (0.3 s, `views/session.ts`) of
  notes may still play after Stop.
- MIDI out only exists while MIDI _input_ is running: the output comes from
  `MidiKeyboardInput.output()`.

### 2.3 Other code facts

- **Scheduling:** `views/session.ts` builds `schedule` (around line 836), and `runSchedule` (around
  line 1009) sends notes 0.3 s ahead from `frame()`. `frame()` runs from `requestAnimationFrame` in
  `routes/Practice.tsx` (around line 387), which stops in a hidden tab, so nothing plays in the
  background. The Player needs a clock that keeps going.
- **Song model:** notes have a `velocity` only when the source is a MIDI file
  (`packages/song-model/src/types.ts`). There is no pedal and there are no dynamics: the MIDI parser
  (`midi.ts`) ignores controllers, including CC 64 sustain, and the MusicXML parser ignores
  `<pedal>` and `<dynamics>`. On a real piano a MIDI piece sounds dry, and catalogue pieces play
  every note at velocity 80.
- **Library:** a `LibraryItem` row (`apps/web/src/storage/db.ts`) holds the original file bytes and
  the sheet PDF bytes, and the Library page loads them all (the item left open in P5-15). A list of
  "all my music" must not do that.
- **Catalogue:** `loadCatalogue()` reads `catalogue/index.json`, which has no durations, and
  `loadCatalogueSong(slug)` loads one piece. A production build lists verified pieces only.
- **Reusable pieces:**
  - `practice/overview.ts` and `OverviewStrip.tsx` (P5-07): a picture of the whole piece, with
    seeking.
  - `views/keyboard.ts` and the renderer's keys, with the key dips from P5-09.
  - `practice/wake-lock.ts` (P5-02), `practice/transpose.ts` (P5-04).
  - `ui/SearchBox.tsx` with `catalogue/search.ts`, and `siblingsOf()` for song levels.
  - `styles/tokens.css` with its contrast test (ADR 0011).
- **iPad app:** `NativeMidiInput.output()` returns `null` (`input/native-midi-input.ts`), and the
  plugin's `definitions.ts` has no destinations and no send.
- **Spec §5** says "Keep sound playback in a Web Audio sampler; no reliance on Web MIDI output." The
  Player keeps to it: it always works on the device, and MIDI out is an option on top.
- **CSP:** `worker-src 'self' blob:` already allows a module worker (`apps/web/public/_headers`, and
  the meta tag in `index.html`).

## 3. What gets built, in short

1. **Practice:** show where the app's notes play, and play them there (P6-01). Stop cleanly on the
   keyboard, with no stuck notes (P6-02).
2. **One playback scheduler** shared by Listen, play-along and the Player (P6-03), and a Player
   transport that keeps playing in a hidden tab (P6-05).
3. **One fast list of all music**, library and catalogue (P6-04).
4. **The Player page**, designed with the maintainer (P6-06, P6-07), with a queue (P6-08) and a mini
   player with media keys (P6-09).
5. **Better sound on a real piano:** the sustain pedal from the file (P6-10) and natural touch for
   pieces without velocities (P6-11).
6. **iPad:** the USB audio route documented and the microphone tried over it (P6-01, P6-13); MIDI out
   and Bluetooth MIDI pairing in the iPad app (P6-12).
7. **Checks with the maintainer** (P6-13) and **docs** (P6-14).

## 4. Order and parallel lanes

Branch from `main` as `P6-NN-short-name`, one pull request per task. P6-01 and P6-02 may share a PR.

| Lane           | Tasks, in order               | Can start                                                  |
| -------------- | ----------------------------- | ---------------------------------------------------------- |
| A — sound path | P6-01 → P6-02 → P6-03 → P6-05 | Now. P6-01 is the quick win: ship it first, on its own     |
| B — storage    | P6-04                         | Now                                                        |
| C — the page   | P6-06 → P6-07 → P6-08 → P6-09 | P6-06 now. P6-07 needs P6-04, P6-05 and an approved design |
| D — sound      | P6-10 → P6-11                 | P6-10 now. P6-11 needs P6-03                               |
| E — iPad app   | P6-12                         | Now (Swift and the bridge). The device test is human       |
| Last           | P6-13 (human), P6-14 (docs)   | As the pieces land                                         |

Lanes A and D both touch `views/session.ts`. P6-03 should merge before P6-10 wires pedal events
into the scheduler.

## 5. Tasks

### P6-00 (GOV) This plan and ADR 0019

Done on branch `P6-00-player-plan`: this file, ADR 0019 (proposed), and the Phase 6 section in
PLAN.md.

### P6-01 (APP) Say where the app's notes play, and play them there

**Reason:** the maintainer's third point above. **Depends on:** nothing.

**Build:**

- **A "Plays on" control in the practice session bar,** next to Play/Start, in every mode. It is an
  icon button (lucide `Speaker`, `Piano` or both, matching the choice) that opens a small menu:
  - This device
  - My keyboard (with the output's name)
  - Both

  It writes the same `settings.midi.playback`. Remove the select from the Options popover, keeping
  the echo checkbox there, and keep Settings → MIDI keyboard. The select is driven by tests:
  `e2e/midi.spec.ts` picks "App's notes play on" by its label (around lines 98 and 181), and so does
  the real-browser script of section 9. Update them in the same PR, or keep the select in Options as
  well. When the keyboard is chosen, the
  button shows that at a glance (icon plus the short name on wide screens).

- **No silent fallback.** Have `playbackInstrument` also return the target actually in effect, and
  why it differs: `{ instrument, effective, reason?: 'no-access' | 'no-output' | 'ambiguous' }`. When
  the keyboard was chosen but cannot be used:
  - the control shows a warning state;
  - a line under the bar says "Your keyboard isn't connected, so the notes play on this device."
    with a Connect button;
  - the device plays, so Play always makes a sound (recommended, Q2).

  `applySound` already runs again when devices change, so the notes move to the keyboard as soon as
  its output appears. Test that.

- **Choosing "My keyboard" connects MIDI** (the same path as Connect, with the permission-waiting
  message from P5-12). It must not wait for the learner to find the MIDI button.
- **Several outputs, none named like the input** (`pickOutput` returns `null`): show the output list
  in the menu instead of falling back.
- **Clicks** follow the decision on Q3. Recommended: the metronome and count-in stay on this device,
  and the menu says "The metronome stays on this device."
- **No Web MIDI** (iPad, Safari): the control offers "This device" only, with a short tip: "Plug in a
  keyboard that works as a USB audio interface and the iPad plays through its speakers." Add the same
  tip to `midiUnavailableMessage('apple-mobile')` in `input/midi-input.ts`. Every new string needs
  its German entry in `i18n/de.ts`, or `test/i18n.test.ts` fails.
- **Per mode** (Q1): only if the maintainer asks for it. Then add `midi.listenPlayback`; otherwise
  one setting covers all of the app's notes.

**Files:** `routes/Practice.tsx`, `audio/midi-out.ts`, `input/midi-input.ts`, `i18n/de.ts`,
`styles/practice.css`, `e2e/midi.spec.ts`, plus `test/` units for `playbackInstrument`.

**Done when:**

- With the fake Web MIDI output in e2e, "My keyboard" in Listen sends every note to the output and
  the device instrument plays none. See how `e2e/no-sound.spec.ts` and `e2e/midi.spec.ts` observe
  sound and MIDI, and add a test-only hook if needed.
- With no output, the warning shows and the device plays.
- When the output appears during a run, the notes move to it.
- The control works at 320 px and at ⅓ iPad width, in English and German.
- Checked in real browser MIDI stacks (section 9): real Chrome and Playwright's Firefox, with notes
  counted at a virtual MIDI destination.

**Watch out:** Chrome's MIDI permission is per origin and port. Never close MIDI ports, or Firefox
drops the device for the whole page (P5-12).

### P6-02 (APP) Clean MIDI out

**Reason:** a keyboard must never keep sounding after Stop, a seek, a mode change or leaving the
page, and the app's notes should not depend on MIDI input being on. **Depends on:** P6-01 (same
files).

**Build:**

- **Output-only access:** `midiOutputs()` and `midiOutput(name)` (in `input/midi-input.ts` or a new
  `input/midi-output.ts`), built on the shared `midiAccess()`. They list outputs, follow
  `statechange` and reuse `pickOutput`. The native path stays `null` until P6-12.
- **`MidiOutInstrument` keeps track** of the notes it has sounding or scheduled. `silence()` then:
  1. calls `clear()` where it exists;
  2. sends a note-off for every note sounding or scheduled;
  3. sends CC 64 = 0 (pedal up) and CC 123.

  Call it on stop, seek, mode change, unmount and `pagehide`. Also call it on
  `visibilitychange` to hidden in practice, but not in the Player, which keeps playing.

- **Check in real Chrome, Edge and Firefox on the Mac** whether `MIDIOutput.clear()` exists and drops
  stamped messages. Extend `sink.swift` to log note-on and note-off with times. Write the result in
  `docs/architecture.md`. Where it is missing, the scheduler keeps its MIDI look-ahead at or below
  100 ms while visible (a parameter in P6-03).
- **The keyboard is unplugged** (`statechange`): the practice control says "Keyboard disconnected"
  and the device takes over with the notice. The Player pauses instead (P6-05).
- **Keyboards that echo MIDI back** ("MIDI thru"): the Settings test note listens for 200 ms for the
  same pitch on the input. If it comes back, remember that for this output name and ignore input
  note-ons that match a pitch sent in the last 50 ms. Otherwise play-along would score the app's own
  accompaniment as the learner's notes.

**Files:** `audio/midi-out.ts`, `input/midi-input.ts`, `views/session.ts` (stop and seek paths),
`routes/Practice.tsx`, `routes/Settings.tsx` (the test note), `settings/model.ts`, and the
virtual destination used for real-browser checks (section 9).

**Done when:** after Stop, a seek, leaving the page or `pagehide`, the virtual destination receives
a note-off for every note-on within 50 ms and the pedal goes up. No note-on arrives afterwards,
beyond the `clear()` gap that was measured. Unit tests use a fake `MidiSink` that records messages
(every note-on paired, CC 64 = 0 sent). An e2e test leaves practice during Listen and checks the
offs.

### P6-03 (PRAC, APP) One playback scheduler

**Reason:** Listen, play-along's accompaniment and the Player must play the same way (pedal, touch,
clean stops). Two schedulers would drift apart. **Depends on:** P6-02.

**Build:** `packages/practice/src/playback.ts`, pure, with no DOM and no Web Audio:

- `buildPlayback(song, { hands, fromBeat, toBeat, tempoFactor, accompanyOnly? })` returns
  `PlaybackEvent[]`, sorted by time. Each event is either
  `{ kind: 'note', pitch, start, end, velocity, hand, noteId }` or
  `{ kind: 'pedal', time, pedal: 'sustain' | 'soft' | 'sostenuto', value }`. Times are seconds from
  the existing `Timeline` and tempo map, never stored in the `Song`.
- `PlaybackCursor` has three methods:
  - `take(until)`: the events due before `until`.
  - `seek(seconds)`: the notes that should already be sounding there (started with their remaining
    length) and the pedal state.
  - `setTempo(factor, at)`: re-anchors the timing without a jump.
- `views/session.ts` uses it for Listen and the accompaniment, replacing `schedule` and
  `runSchedule`. `SCHEDULE_AHEAD` becomes the caller's choice (shorter for MIDI where `clear()` is
  missing). Keep the rule that skips notes more than 0.05 s late.

**Files:** `packages/practice/src/playback.ts`, the export in `index.ts`,
`packages/practice/test/playback.test.ts`, `apps/web/src/views/session.ts`.

**Done when:** Listen and play-along behave exactly as before (`release.spec.ts`,
`practice-tools.spec.ts` and `no-sound.spec.ts` pass unchanged). Unit tests cover:

- seeking into a held note;
- a tempo change in the middle of a note;
- loops and hand filters;
- pickup bars and an empty song.

Scoring does not change.

### P6-04 (STORE, APP) All the music in one fast list

**Reason:** the Player lists everything, and today the Library loads every file and PDF into memory
(left over from P5-15). **Depends on:** nothing.

**Build:**

- **Dexie version 2:**
  - a new table `files` keyed by the library id, holding `bytes` and `sheetBytes`;
  - `library` rows keep the metadata, `song` and the sheet map, without bytes;
  - the upgrade moves the bytes across;
  - new fields `composer?`, `seconds` (at 100 % tempo, from the tempo map), `noteCount` and
    `hasSheet`, filled on import and by the upgrade.
- **Every reader of bytes goes through `getLibraryFiles(id)`:** the score and sheet views,
  re-import, the encrypted backup (`backup/backup.ts`; old backups must still restore), sync
  (`sync/local.ts`, `sync/controller.ts`; the encrypted payload format stays the same or is
  versioned) and crash-report scrubbing.
- **`apps/web/src/player/collection.ts`:**
  - `CollectionEntry { key: 'catalogue:<slug>' | 'library:<id>', title, composer?, source,
difficulty?, seconds?, addedAt?, lastPlayedAt?, hasSheet?, song?, variant? }`;
  - `loadCollection()` merges `loadCatalogue()`, with the verified-only rule unchanged, and the
    library metadata. `lastPlayedAt` comes from the `progress` table;
  - search through `catalogue/search.ts`;
  - `loadPlayable(key)` returns `{ song, title, composer }` for the transport.
- **Catalogue durations:** either compute them in the browser the first time a piece loads and cache
  them in the settings table, or let `tools/pipeline` write `seconds` into `index.json` (Python
  standard library only). Pick the cheaper one and say why in the PR.

**Files:** `storage/db.ts`, `routes/Library.tsx`, `routes/Practice.tsx` (the load path),
`backup/backup.ts`, `sync/*`, `crash/scrub.ts`, and the new `player/collection.ts`.

**Done when:**

- The Library and the collection open in under 200 ms with 200 library items that each carry a
  20 MB PDF. Use a generated fixture under `fake-indexeddb`, which is already a dev dependency of
  the web app.
- An upgrade test starts from a version 1 database, with and without sheets.
- The backup round trip and the sync tests pass.

**Watch out:** hard rule 3. Nothing leaves the device, the backup stays encrypted, and the upgrade
must never lose a file.

### P6-05 (APP) The Player transport

**Reason:** play pieces one after another on the keyboard, with exact timing, also while the tab is
in the background. **Depends on:** P6-02, P6-03, and P6-04 for `loadPlayable`.

**Build:** `apps/web/src/player/transport.ts`, a module-level singleton, so it can outlive the page
(P6-09).

- **State:** the queue (`player/queue.ts`, pure), the current entry, position, playing, tempo
  factor, hands, transpose and output target. `subscribe()` serves React for the controls, and
  `positionNow()` serves the canvas, which reads it every frame through refs.
- **Clock:** a dedicated worker (`player/clock.worker.ts`) posts a tick every 25 ms, and the main
  thread calls `cursor.take(now + ahead)`. The reason is that a hidden tab stops
  `requestAnimationFrame` and throttles main-thread timers. Chrome waits at least 1 s between them,
  and after 5 minutes hidden it allows one wake-up a minute for pages that make no sound. A MIDI-only
  page makes no sound. Look ahead about 120 ms while visible (at most 100 ms for MIDI where
  `clear()` is missing) and 1.5 s while hidden. Measure Chrome, Edge and Firefox with the tab hidden
  for 10 minutes.
- **Output:** the same `playbackInstrument` as practice, with "Plays on" from P6-01. Keyboard only
  runs on the performance clock without needing the `AudioContext`. "This device" and "Both" unlock
  audio from the Play click and use the audio clock.
- **Between pieces:** a gap of 2 s (a setting, Q6) and no count-in.
- **The keyboard disappears** while playing: pause, and say "Your keyboard was disconnected." with
  "Play on this device" and "Wait" buttons.
- **Wake lock** while playing (`practice/wake-lock.ts`); `pagehide` silences.
- **One owner of the sound:** opening practice, a drill or the Detector Lab stops the Player.
- **Recently played:** `lastPlayedAt` in the local `progress` table. Not a run, so no accuracy
  changes.

**Files:** `player/transport.ts`, `player/clock.worker.ts`, `player/queue.ts`, and tests next to
them.

**Done when:**

- Unit tests with a fake clock and a fake sink cover play, pause, seek and next, plus:
  - auto-advance;
  - repeat one and repeat all;
  - shuffle that plays every piece once before repeating;
  - "previous" goes back a piece within the first 3 s, otherwise restarts the piece;
  - a lost output pauses playback.
- A real-stack check with the virtual destination: note timing jitter at most 5 ms while visible,
  and still playing after 10 minutes hidden in Chrome, Edge and Firefox. Put the numbers in the PR.

**Watch out:**

- Use Vite's `new Worker(new URL('./clock.worker.ts', import.meta.url), { type: 'module' })`.
- The PWA precache must include the worker file.
- No allocation-heavy work per tick.

### P6-06 (APP, human) Design the Player with the maintainer

**Reason:** "the player needs to look really nice and elegant, so I want you to find a very nice
way of setting this up." Elegance is the maintainer's call. They judge in their own Chrome, dark
mode, in a window 2,560 CSS px wide. **Depends on:** nothing.

**Build:** a prototype of the page with fixture data from the CC0 catalogue, at most two variants of
the Now playing area:

- **A, "record sleeve":** a large generated cover, title and composer, with the picture of the piece
  as the seek bar and a slim keyboard below.
- **B, "stage":** a wide keyboard as the centrepiece, with the piece's notes drifting up from the
  keys behind frosted glass and the title over them.

Screenshot both in the maintainer's own Chrome (dark first, then light, ⅓
iPad width and 320 px) and let the maintainer choose. Record the choice in ADR 0019 or the PR.

**Design direction** (a proposal to react to, not a decision):

- Calm and dark-first, one accent colour, generous space, and the system fonts (ADR 0011). Colours
  only from `styles/tokens.css`; new tokens such as cover hues go there too, with
  `test/tokens.test.ts` extended to check their contrast.
- **Generated cover art,** drawn on canvas in a rounded square: a small piano-roll of the piece's
  opening, with a hue derived from the composer's name. List rows show only the composer's initials
  on that hue, which needs no song load. Covers are CC0 by construction and need no images.
- **The seek bar is the overview picture of the whole piece** (P5-07), with the part already played
  lit.
- **A live keyboard strip:** keys light in the hand colours and dip on each strike (P5-09). It
  follows the chosen keyboard size (P5-16).
- **Motion:** 150–200 ms transitions, and a soft glow on the cover with each chord. All of it is off
  under Reduce motion.
- **Touch targets** of at least 44 px on coarse pointers.

**Done when:** the maintainer approves a variant (human).

### P6-07 (APP) The Player page

**Reason:** the maintainer's main ask. **Depends on:** P6-04, P6-05, and an approved P6-06.

**Build:**

- **Route** `{ name: 'player' }` at `#/player` (`lib/router.ts`), with an entry in the main nav
  (`nav()` in `App.tsx`). The label is "Player"; German "Wiedergabe" is proposed, pending the native
  read-through (Q8).
- **The collection:**
  - search with `SearchBox`;
  - filter chips (All, My library, Catalogue);
  - sort by title, composer, recently added, recently played or length;
  - rows: initials tile, title, composer, length, source badge and level chips (`siblingsOf`);
  - row actions: Play, Play next, Add to queue;
  - a windowed list above about 300 rows. Write it yourself; no new dependency.
- **Now playing:**
  - cover, title, composer and source;
  - the seek picture with elapsed and remaining time, tap or drag to seek, and the arrow keys;
  - previous, play/pause and next, plus shuffle and repeat;
  - tempo from 50 to 150 % (`clampTempo`), hands (both, left or right), transpose (the P5-04
    rules), the "Plays on" control from P6-01, and volume.
- **The keyboard strip** draws on a canvas from `requestAnimationFrame`, reading the transport
  through refs. React owns only the layout.
- **"Practise this"** opens the piece in practice and stops the Player.
- **Entry points:** a Play button on Library and Home cards, and "Open in Player" in the practice
  header.
- **Empty library:** the catalogue is still listed, with a link to import pieces.
- **No Web MIDI** (iPad, Safari): "Plays on" shows "This device" with the USB audio tip from P6-01.
- **Shortcuts:** Space for play/pause, ← and → to move 5 s, Shift + ← and → for the previous or next
  piece. List them with the other shortcuts in `settings/model.ts`.
- **Layout:**
  - at 1,100 px and wider: collection, Now playing, and the queue as a drawer;
  - iPad landscape: two areas;
  - ⅓ iPad width and phones: one column, the list as the main view and a mini transport fixed at
    the bottom;
  - no sideways scrolling at 320 px.
- **Accessibility:**
  - the list is a listbox or grid with arrow keys;
  - the seek bar is a slider with `aria-valuetext` such as "1:23 of 4:56";
  - a polite live region says "Now playing: …";
  - focus stays visible, and Reduce motion and the high-contrast tokens are respected.

**Files:** `routes/Player.tsx`, `player/*.tsx`, `styles/player.css`, `lib/router.ts`, `App.tsx`,
`i18n/de.ts`, `e2e/player.spec.ts`.

**Done when:**

- e2e on all four Playwright profiles: the list shows catalogue pieces and an imported generated
  MIDI file; play, pause and next with the fake MIDI output record notes on the output; the device
  plays when there is no MIDI; the layouts hold at ⅓ iPad width and 320 px.
- A dark-mode screenshot exists.
- The maintainer has reviewed the page in their Chrome (human).

**Watch out:** hard rule 1, so no share, export or cast. Screenshots use CC0 catalogue pieces only.
Production lists verified catalogue pieces only.

### P6-08 (APP) Queue: play all, shuffle, repeat

**Depends on:** P6-07.

- An "Up next" panel: a drawer on wide screens, a sheet on narrow ones.
- Reorder by dragging (pointer events; `views/loop-drag.ts` shows the pattern) and with the keyboard
  (Alt + ↑ and ↓). Remove and clear.
- "Play all" from the current filtered list, shuffle, and repeat off, all or one.
- The queue is kept on this device as keys only (setting `player.queue`). Keys whose library item
  was deleted are dropped quietly on load.
- **Done when:** unit tests for the queue model pass, an e2e test reorders by keyboard, and the queue
  survives a reload.

### P6-09 (APP) Mini player and media keys

**Depends on:** P6-07.

- A slim bar in the app shell on other pages while the Player has a queue: cover tile, title,
  play/pause and next. Tapping it opens the Player.
- Opening practice, a drill or the Detector Lab stops the Player, and the bar says "Stopped while you
  practise."
- **Media Session** (`navigator.mediaSession`): title, composer and the generated cover as artwork,
  with play, pause, previous, next and seekto actions, where the browser offers it. Check whether
  Chrome, Edge and Firefox show the controls when only Web Audio, or only MIDI, is playing. If they
  need a playing media element, skip it rather than add a silent `<audio>` trick, and say so in the
  PR.
- **Done when:** an e2e test goes from Home to the Library while the fake output keeps receiving
  notes, and opening practice stops it.
- **Watch out:** media metadata goes to this device's own system controls only, which is fine under
  hard rule 1. Titles go nowhere else.

### P6-10 (SONG) The sustain pedal in the Song (ADR 0020)

**Reason:** on a real piano, pieces without the pedal sound dry, and MIDI files do carry it (CC 64).
P5-13's note that "MIDI has none" is wrong for the pedal. **Depends on:** P6-03, for wiring into
the scheduler; the parser work can start at once.

**Build:**

- **The model:** `Song.pedals?: PedalEvent[]`, each `{ beat, pedal: 'sustain' | 'soft' |
'sostenuto', value }` with value 0–127, sorted by beat. Write ADR 0020 to amend ADR 0003.
- **MIDI:** the parser reads CC 64, 67 and 66, quantised on the notes' grid and unrolled with the
  repeats.
- **MusicXML:** read `<direction-type><pedal type="start|stop|change|continue"/>` and
  `<sound damper-pedal="…"/>`.
- **Transforms** (transpose, trim, hand swap, keyboard fit) keep the events, and `songToMusicXml`
  writes pedal marks.
- **Playback:** the scheduler emits pedal events, `MidiOutInstrument` sends them as control changes,
  and the sampler honours the sustain pedal by holding releases while the pedal is down
  (`audio/sampler.ts`).
- **Stored library songs** have no `pedals`. Re-import them once from the kept bytes with their saved
  import settings, using a song version field.

**Tests:** a generated MIDI file with CC 64, a MusicXML pedal fixture written in code, a round trip
through the writer and parser, and the transforms.

**Watch out:** never store seconds in the `Song`, and old songs lack the field.

### P6-11 (PRAC) Natural touch for pieces without velocities

**Reason:** catalogue MusicXML carries no velocities, so every note plays at 80, which sounds flat on
a real piano. **Depends on:** P6-03.

**Build:** a pure `shapeTouch(events, song, { style: 'natural' | 'even' })`, used only when the
source has no velocities:

- beat strength: a strong beat +6, a weak one −4;
- the melody (the top right-hand voice) +8, the left hand −6;
- MusicXML `<dynamics>` once they are parsed (p = 48, mf = 72, f = 96, and so on);
- a small variation seeded by the note id, so it is the same every time.

Add a setting "Touch: natural / even" (default natural, Q4).

**Tests:** the output is deterministic, stays within 1–127, and leaves MIDI velocities untouched.

### P6-12 (APP, iOS) MIDI out in the iPad app, and Bluetooth MIDI pairing

**Reason:** on iPad the app is the only way to reach the keyboard by MIDI: keys in, notes out, pedal.
**Depends on:** nothing for the code. The device check needs P3-01.

**Build:**

- **The Swift plugin** (`apps/ios-shell/plugins/core-midi`):
  - `listDestinations()`;
  - `send({ destination?, messages: [{ data: number[], time? }] })`, batched into one bridge call
    per scheduler tick. `time` is in host seconds (the clock `getTime()` uses), converted to host
    time and sent with `MIDISendEventList` (MIDI 1.0 UMP);
  - `flush(destination)` through `MIDIFlushOutput`;
  - a `destinationsChanged` event.
- **The web side:** `definitions.ts` and `index.ts` in step with the Swift code.
  `NativeMidiInput.output()` returns a `MidiSink` that maps performance-clock times to host time
  through `ClockSync` and batches messages per microtask.
- **Bluetooth:** a "Pair a Bluetooth MIDI keyboard" button in Settings → MIDI keyboard, shown in the
  iPad app only, that presents `CABTMIDICentralViewController`.
- **Keep the screen on** while the Player plays: the Wake Lock API if WKWebView has it, otherwise
  `isIdleTimerDisabled` through the plugin.
- **No background playback:** the web view's JavaScript stops when the app is in the background. Say
  so in the app.

**Tests:** Swift unit tests in the style of `UniversalPacketTests.swift` for packing and time
conversion, and a web unit test for the batching sink. The build must work with Xcode 27.

**Human:** install on the maintainer's iPad (P3-01) and try a USB and a Bluetooth keyboard.

### P6-13 (human) Checks with the maintainer

- **The Mac,** with their Yamaha ("Digital Keyboard" in CoreMIDI), in Chrome, Edge and Firefox:
  practice Listen on the keyboard only (P6-01, P6-02), then the Player.
- **The iPad, with Edge and USB audio:**
  - The Player plays through the keyboard's speakers, as Listen already does.
  - Then tap the microphone button with the keyboard plugged in. Does the detector hear the
    keyboard's USB audio and accept the notes in wait mode? Check the keyboard's audio loop-back
    setting (Yamaha's name for it): when it is on, the iPad's own sound comes back into the input,
    so in Listen and play-along the detector would hear the app.
  - If the detector works, add a small task: tune it for a line input and tell iPad learners about
    it.
- **The iPad app on the iPad,** after P6-12.
- **Design:** approval in P6-06, and a final review of the Player in Chrome, dark, at 2,560 px.

### P6-14 (GOV) Docs

- `docs/user-guide.md`: a Player section and the "Plays on" control.
- `docs/faq.md`: "Can I use a MIDI keyboard with Chrome, Edge or Firefox on an iPad?" No; use USB
  audio for the sound and the iPad app for MIDI.
- `docs/architecture.md`: the playback scheduler, the transport and its worker clock, the MIDI out
  rules and the `clear()` findings.
- `README.md`: the feature list.
- German where the app has German. Screenshots from CC0 catalogue pieces only.

## 6. Wireframes (proposal for P6-06)

Wide window (2,560 px, dark), variant A:

```text
┌ OpenTiles   Home  Library  Player  Sight-reading                                ┐
├──────────────────────────┬──────────────────────────────────────┬───────────────┤
│ 🔍 Search all music      │                                      │ Up next     ✕ │
│ [All] [My library] [Cat] │        ┌──────────────────┐          │ 2 Gymnopédie  │
│ Sort: Recently played ▾  │        │  ▁▃▅ ▂▆ ▃▇▅▂     │          │ 3 Minuet in G │
│ ──────────────────────── │        │   generated      │          │ 4 Für Elise   │
│ (JB) Minuet in G   1:32 ▶│        │   cover art      │          │               │
│ (ES) Gymnopédie 1  3:05 ▶│        └──────────────────┘          │ [Shuffle]     │
│ (LB) Für Elise     2:58 ▶│        Ode to Joy                    │ [Repeat all]  │
│ (FC) Prelude Op.28 1:45 ▶│        Beethoven · Catalogue         │               │
│  …                       │  ▁▂▅▇▅▃▂▁▃▅▆▇▆▅▃▂ picture of piece   │               │
│                          │  1:12 ━━━━━━━━●──────────── −1:48    │               │
│                          │     ⇄    ⏮    ( ▶ )    ⏭    ↻        │               │
│                          │  Tempo 100 %  Hands ◐  Plays on 🎹   │               │
├──────────────────────────┴──────────────────────────────────────┴───────────────┤
│ ▌▌▌ ▌▌ ▌▌▌ ▌▌ ▌▌▌ live keyboard strip, keys lit in hand colours ▌▌ ▌▌▌ ▌▌ ▌▌▌     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

⅓ iPad width or a phone:

```text
┌──────────────────────┐
│ Player          ≡ Q  │
│ 🔍 Search            │
│ [All][Library][Cat]  │
│ (JB) Minuet in G   ▶ │
│ (ES) Gymnopédie 1  ▶ │
│ (LB) Für Elise     ▶ │
│  …                   │
├──────────────────────┤
│ ▁▃▅ Ode to Joy  ⏸  ⏭ │  ← mini transport; tap opens Now playing
│ ━━━━━━●──────────    │
└──────────────────────┘
```

## 7. Open questions for the maintainer

Each has a recommendation, so work can start. On 2026-10-17 the maintainer accepted the
recommendations for Q1 to Q8 (recorded in ADR 0019); Q9 is decided in P6-06.

| #   | Question                                                              | Recommendation                                                                                         |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Q1  | One "Plays on" for all the app's notes, or a separate one for Listen? | One setting, visible in the session bar and the Player                                                 |
| Q2  | Practice with "keyboard" chosen but no keyboard connected             | Play on this device and say so, with a Connect button                                                  |
| Q3  | Metronome and count-in when playing on the keyboard only              | Stay on this device (keyboards without drum sounds would play nothing; GM channel 10 is not universal) |
| Q4  | Touch for pieces without velocities                                   | Natural by default, with "even" as an option                                                           |
| Q5  | Does the Player keep playing on other pages?                          | Yes, with a mini player; practice, drills and the Detector Lab stop it                                 |
| Q6  | Gap between pieces                                                    | 2 s, adjustable from 0 to 5 s                                                                          |
| Q7  | Send a piano programme change at the start?                           | No: it would override the voice chosen on the keyboard                                                 |
| Q8  | German name of the page                                               | "Wiedergabe", pending the native read-through                                                          |
| Q9  | Player design                                                         | Choose in P6-06 (variant A or B)                                                                       |

## 8. Out of scope, and why

- **Exporting, sharing or casting** a queue, a piece or a performance: hard rule 1 and ADR 0010.
- **Writing a MIDI file** for the keyboard's own player: hard rule 1. It needs an ADR and the
  lawyer (P2-18), like P5-06.
- **Streaming or importing from a URL:** hard rule 2.
- **General MIDI instruments other than piano:** left out in Phase 5 (sample licences and size).
- **Background playback in the iPad app,** which iPadOS does not allow for a web view.
- **Choosing the computer's audio output device** (`AudioContext.setSinkId`): offered earlier, still
  a separate item.

## 9. How to check MIDI in real browsers

Fakes in e2e are not enough for MIDI: in P5-12 three real bugs showed up only in real browser MIDI
stacks. On a Mac, check every MIDI change like this:

- **Virtual devices:** a small Swift program creates a virtual CoreMIDI _source_ (a keyboard that
  plays chosen notes) and another a virtual _destination_ that counts, or for P6-02 logs with
  times, every message it receives. The maintainer keeps such scripts, and Playwright scripts for the
  app's flows, outside this repository. Ask for them, or write the equivalent; they are a few dozen
  lines each.
- **Chrome:** use the real browser (Playwright `channel: 'chrome'`, temporary profile) with
  `grantPermissions(['midi', 'midi-sysex'])`; plain `midi` is not enough. Playwright's headless
  Chromium shell lists ports but delivers no messages.
- **Firefox:** Playwright's Firefox works with `MOZ_DISABLE_CONTENT_SANDBOX=1` and the prefs
  `dom.webmidi.gated=false`, `midi.prompt.testing=true` and
  `media.navigator.permission.disabled=true`.
- **A useful run:** set "Plays on" to the keyboard and the output to the virtual destination, then go
  wait → Listen + Play → wait, and compare the notes played with the notes counted.
- **Prompts:** the automation skips the browsers' permission prompts and Firefox's site-permission
  add-on. Always say that a person still has to answer the real prompts and press real keys (P6-13).

## 10. Hard rules, checked

1. **No distribution path:** playback is local, to the learner's own keyboard. The queue is stored
   on the device as keys, and nothing is shared, exported or cast.
2. **No imports from other sites:** imports are unchanged.
3. **No music leaves the device:** scheduling, parsing and pedal reading run in the browser. The
   storage split keeps the backup encrypted.
4. **No copyrighted music:** fixtures are generated in code. e2e tests and screenshots use CC0
   catalogue pieces only.
5. **No tracking:** "recently played" is a local field.
6. **No dark patterns:** nothing plays on its own except the next piece in a queue the learner
   started.
7. **Licences:** no new dependency is planned. If one becomes necessary, name its licence in the PR.

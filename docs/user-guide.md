# OpenTiles user guide

How to practise with OpenTiles: pick a piece, connect your keyboard (or don't), choose a mode and
use the tools that make hard bars easier. For quick answers see the [FAQ](faq.md).

> OpenTiles is not released yet and there is no hosted copy to open. Until there is, follow
> [Run it yourself](../README.md#run-it-yourself) in the README; it takes a few minutes and then
> everything below applies.

## Contents

- [Your first piece](#your-first-piece)
- [Ways to play](#ways-to-play)
- [Practice modes](#practice-modes)
- [Practice tools](#practice-tools)
- [Falling notes, score and sheet views](#falling-notes-score-and-sheet-views)
- [Drills: sight-reading and chords](#drills-sight-reading-and-chords)
- [The Player](#the-player)
- [Bringing your own music](#bringing-your-own-music)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Installing, offline use and your data](#installing-offline-use-and-your-data)
- [Languages and accessibility](#languages-and-accessibility)

## Your first piece

1. Open the **Pieces** page. The 81 public-domain pieces are sorted into five levels, from
   _First steps_ to harder repertoire. The card at the top, **Start here**, is the next piece on
   your path. A level counts as complete when every piece in it reaches 90 %.
2. Use the search box to find a piece by title, composer or level.
3. Press **Practise**. The piece opens in **Wait** mode with falling notes over a keyboard.
4. A big 3, 2, 1 counts you in while the first notes fall into place. Then play the notes that
   light up. In wait mode the piece waits for you; nothing is timed. If the app's sound has not
   started yet, the screen first asks you to tap it or press a key.

Your best result for each piece, your streak and the time you practised today are kept on your
device and shown on the home page.

## Ways to play

Choose the input at the top of the practice screen. You can switch at any time.

| Input                 | Best for                        | Works in                        |
| --------------------- | ------------------------------- | ------------------------------- |
| **MIDI keyboard**     | Digital pianos and controllers  | Chrome, Edge, Firefox (desktop) |
| **Microphone**        | Acoustic pianos                 | Chrome, Edge, Firefox (desktop) |
| **On-screen keys**    | Trying the app without any gear | Chrome, Edge, Firefox (desktop) |
| **Computer keyboard** | Quick tests on a laptop         | Chrome, Edge, Firefox (desktop) |

Safari is not supported (see [browser support](../README.md#browser-support)).

### MIDI keyboard

Plug the keyboard in (USB, or Bluetooth where your system pairs it) and switch it on. Press
**Connect MIDI keyboard**; the browser asks for permission once. The keyboard then appears by
itself whenever it is connected.

- MIDI needs a browser with Web MIDI: Chrome, Edge or Firefox.
- If your keyboard feels late or early, open **Options → Calibrate timing** or **Measure keyboard
  delay**. OpenTiles then corrects its scoring for that keyboard.
- **Play my MIDI keys on this device** makes the app play the sound of the keys you press. Leave it
  off if your keyboard has its own speakers, otherwise you hear everything twice.
- **Plays on**, next to Restart in practice, chooses where the app's own notes sound (Listen, the
  other hand, listening back): **This device**, **My keyboard** (its own sound) or **Both**. If you
  choose the keyboard but it isn't connected, the notes play on this device and a line under the
  controls says why; they move to the keyboard as soon as it appears. The metronome stays on this
  device.
- On an iPad or iPhone, browsers cannot reach MIDI keyboards. Many digital pianos also work as a USB
  audio interface: plugged in, they play the iPad's sound, the app's notes included, through their
  own speakers. The keys you play still need the microphone.

### Microphone (acoustic pianos)

Press **Use microphone** and allow the browser to use it. OpenTiles knows which notes should come
next, so it only has to decide whether those notes are sounding. That works much better than
guessing every note from scratch.

Tips for good results:

- Put the device near the piano, but not on it, and keep the room quiet.
- Run **Set up microphone** once for each room and device. It listens to the room and sets the
  sensitivity.
- Avoid **Listen** mode and **Play other hand** while the microphone is on: the app's own sound
  would reach the microphone along with the piano.
- Tell us how it goes with the [microphone report form](https://github.com/KunalGehlot/OpenTiles/issues/new?template=microphone.yml).
  The detector is being tuned on real pianos and your reports help.

The **Detector Lab** page in the navigation is a developer tool for watching what the microphone
hears. You do not need it to practise.

### On-screen and computer keys

Tap or click the keyboard at the bottom of the practice screen. On a computer you can also use the
letter keys like piano keys (see [Keyboard shortcuts](#keyboard-shortcuts)).

## Practice modes

| Mode           | What happens                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Wait**       | The piece stops at each note or chord until you play it. Wrong notes flash red.            |
| **Listen**     | The app plays the piece for you. Use it to hear what you are about to learn.               |
| **Play along** | The piece moves at the tempo you set and scores your timing: on time, early, late, missed. |

A good routine: **Listen** once, **Wait** with one hand, **Wait** with both hands, then **Play
along** at a slow tempo and raise it.

When you finish, the results show your accuracy, how many notes were on time, early, late or
missed, and which bars were hardest.

## Practice tools

All of these are on the practice screen or under **Options**.

- **Hands: Left / Both / Right.** Practise one hand alone. **Play other hand** makes the app play
  the hand you are not practising. When that hand begins first, its opening plays after the
  count-in, and the piece then waits for your first note.
- **Tempo.** Slow a piece down to a speed you can manage, then raise it. OpenTiles remembers your
  last mode, hand, tempo and metronome choice.
- **Loop.** Repeat the piece or a range of bars. **Loop** repeats the whole piece at once, so a
  run goes round again instead of ending; narrow it with the bar selectors, by dragging across the
  falling notes, or phrase by phrase. Press **Loop** again to stop.
- **Metronome.** A click track at the current tempo.
- **Transpose.** Move the piece up or down in semitones. The piece opens in that key next time.
- **Fingering.** Show fingering numbers from the score, suggested ones where the score has none,
  or none.
- **Overview strip.** The coloured strip above the notes shows the whole piece (blue is the right
  hand, orange the left). Click a bar to jump to it.
- **Live stats.** A small panel with your accuracy and timing as you play.
- **Keyboard size and fit.** Choose how many keys are shown, or let OpenTiles fit the keys to each
  piece.

## Falling notes, score and sheet views

Switch the view with the buttons at the top right of the practice area.

- **Falling notes** — bars fall toward the keys, like a rhythm game. Colours show the hand. The
  letter is the note name; the number is the finger.
- **Score** — a scrolling line of engraved sheet music with a cursor. For a MIDI file the score is
  written from the notes, with the sustain pedal marked where the file uses it.
- **Sheet** — the music in pages, which suits reading ahead: your own PDF if the piece has one
  (see [Sheet music PDFs](#sheet-music-pdfs)), otherwise the engraved score. A Bluetooth page-turn
  foot pedal works here (see [Settings](#settings)).

## Drills: sight-reading, chords and scales

The **Drills** page has three kinds of short exercise, made on your device and new every time.

### Sight-reading

**Sight-reading** generates endless note-reading practice: pick a clef and a range around middle C,
choose single notes or short phrases, and play what you see. Optional helps are note names under
the notes and a lit key to press. The next drill starts as soon as one ends.

### Chords

**Chords** gives you random chords to find and press, all notes together. Choose:

- **Level.** Each level adds to the ones before it:

  | Level | Adds                                                 |
  | ----- | ---------------------------------------------------- |
  | 1     | C, F and G major; A, D and E minor, in root position |
  | 2     | Major and minor on every white key                   |
  | 3     | All twelve roots, sharps and flats                   |
  | 4     | First and second inversions                          |
  | 5     | Diminished, augmented, sus2 and sus4                 |
  | 6     | Seventh chords: maj7, 7, m7, m7♭5, dim7              |
  | 7     | Seventh chords inverted, add9, 6 and m6              |
  | 8     | Both hands: the left hand plays the root and fifth   |

  **My own set** picks the roots and kinds of chord yourself, with inversions on or off; there the
  left hand can play the root, the root and fifth, or the same chord lower.

- **Hands.** Right, left or both. With both hands below level 8, the left hand plays the root.
- **Show.** **Sheet, no help** draws the chords on the staff and nothing else. **Falling keys**
  drops each chord onto the keyboard with its name on the bars; **Keys lit** decides how much the
  keyboard shows as the chord arrives (every key, the root only, or none; by default this fades as
  the levels climb).
- **Chord names.** Shown above the chords, hidden, or **Name only**: on the sheet only the name is
  there, and the notes appear once you have played them. **Show me** shows the chord to play, and
  counts it as a miss. Names follow Settings → How note names are written: B♭maj7, German Bmaj7
  (and Hmaj7 for B), or Si♭ maj7.
- **Pace.** **Wait for me**: the next chord comes when the last one is right. **At a tempo**: a
  chord every bar of four beats, 40 to 120 beats a minute, after the 3, 2, 1 count-in. **Speed up
  as I improve** raises the tempo by five after three rounds with 90 % right at the first try and
  lowers it after a round under 60 % (off by default). **Strict chords** wants a chord's notes
  within 60 ms of each other instead of 120 ms.

After a round you see chords a minute (or how many were together and on time), how many were right
at the first try, the chords that went wrong most and what was wrong (a note missing, a note not in
the chord, the wrong third or fifth, or the wrong inversion), and your last rounds for comparison.
These results stay on this device (and in your encrypted backup); **Practise my weak chords** then
draws the chords under 80 % more often.

Chords of four or more notes are hard for the microphone; when a drill has them, the practice
screen suggests a MIDI keyboard or the on-screen keys. The on-screen keys take several fingers at
once.

### Scales

**Scales** gives you random scales to play up and back down, each in its key signature with its
name above it and the finger for every note written over it. Choose:

- **Level.** Each level adds to the ones before it:

  | Level | Adds                                                   |
  | ----- | ------------------------------------------------------ |
  | 1     | C, G and F major; A minor                              |
  | 2     | Up to two sharps or flats, with their harmonic minors  |
  | 3     | All twelve major scales                                |
  | 4     | Every minor: natural, harmonic and melodic             |
  | 5     | Two octaves                                            |
  | 6     | Both hands together                                    |
  | 7     | Modes (Dorian to Locrian), pentatonics and blues       |
  | 8     | The chromatic scale, and both hands in contrary motion |

  **My own set** picks the keys and kinds of scale yourself. The melodic minor goes up with its
  sixth and seventh raised and comes down without them, as in most scale books.

- **Hands.** Right, left, together (an octave or two apart), or in **contrary motion**: both hands
  start on the same key, move apart and come back.
- **Octaves.** One or two.
- **Show.** **Sheet** writes the scales out. **Name only, from memory** shows the name and the key
  signature; the notes and their fingers appear once you have played them, which is how scales are
  asked for in lessons. **Show me** shows the rest of the scale, and counts it as a miss. **Falling
  keys** drops the notes onto the keyboard with the fingers on the bars. Sheet is the start at level
  1, from memory after that.
- **Show the fingers.** The fingers are those scale books print: in C major the right hand plays
  1 2 3 1 2 3 4 5, and the thumb never lands on a black key. Pentatonic and blues scales have no
  single standard and come without fingers.
- **Pace.** **Wait for me**, or **at a tempo** in crotchets or quavers, 40 to 160 beats a minute,
  after the count-in, with the same **Speed up as I improve** as chords.

Names follow Settings → How note names are written and the app's language: E♭ harmonic minor, or in
German es-Moll harmonisch.

After a round you see notes a minute (or how many scales were clean and on time), how many were
right at the first try, how **even** your playing was (very even, even, or uneven, and where: most
often where the thumb passes under), the scales that went wrong most and what was wrong (the key's
sharp or flat, the wrong form of minor, a note skipped), and your last rounds. These results stay on
this device (and in your encrypted backup); **Practise my weak scales** brings the weak ones back
more often.

Both hands at once are harder for the microphone to follow; with hands together it suggests a MIDI
keyboard or the on-screen keys.

## The Player

The **Player** plays your music to you, the catalogue and your own pieces, like a self-playing
grand piano: the notes come down a dark roll as lines of light, and the keys go down by themselves.
On a MIDI keyboard it plays the keyboard's own piano.

- **The programme.** Everything you can play, grouped by composer like a concert programme. Search
  it, or show only your library or the catalogue. Tap a piece to play it and everything after it;
  **Play all** plays one composer; **Let it play** shuffles everything, round and round.
- **Where it plays.** **Plays on** chooses: **Automatic** (the default) uses your MIDI keyboard's own
  sound whenever one is connected and this device otherwise; or always **This device**, **My
  keyboard**, or **Both**. **Play on your piano** connects a keyboard (the browser asks once).
- **Play expressively** (in the options, on by default) shapes each phrase and lets the melody sing
  over the accompaniment, and uses the sustain pedal where a piece has no pedal marks of its own,
  as a pianist would: changed with each new harmony, and lifted where it would blur, and eases
  into the last chord. A piece's own pedal marks are kept, and a MIDI recording of a pianist plays
  exactly as recorded. Practice always plays exactly what is written.
- **Up next** shows what comes after this piece. Tap one to play it now, drag it by its handle (or
  use ↑ and ↓ on the handle, or Alt with them anywhere on its row) to move it, and × to take it
  out. The queue is kept on this device, so it is still there next time.
- **Stand mode** (**F** or the button) fills the window with the piano, full screen where the
  browser allows. The controls fade after a few seconds and come back on any touch or key.
- **On other pages** the Player keeps playing, with a small bar to pause it or skip; practice stops
  it. While this device's piano plays, the media keys and the system's "Now playing" control it
  too (Chrome and Edge; with only a MIDI keyboard sounding, browsers offer no such control).
- **Listen** on a piece's card (and in practice's options) opens the Player playing it;
  **Practise this** in the Player's options goes the other way.

What you hear depends on the device:

| Device and connection                                    | What you hear                                                |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Mac or PC with Chrome, Edge or Firefox, USB or Bluetooth | your keyboard plays the piece itself (MIDI), its pedal too   |
| iPad, any browser, keyboard on USB                       | the app's piano, through the keyboard's speakers (USB audio) |
| [iPad app](ipad-app.md) (experimental), USB or Bluetooth | your keyboard plays the piece itself (MIDI)                  |

No browser on the iPad can send MIDI to a keyboard yet; see the [FAQ](faq.md).

## Bringing your own music

Open **My library** and press **Import a file…**.

| Format     | Extensions                          | Notes                                                    |
| ---------- | ----------------------------------- | -------------------------------------------------------- |
| MusicXML   | `.musicxml`, `.xml`, `.mxl`         | Best quality; exported by MuseScore, Finale, Dorico etc. |
| MuseScore  | `.mscz`, `.mscx`                    | Read directly                                            |
| ABC        | `.abc`                              | Plain-text notation, common for folk tunes               |
| MIDI       | `.mid`                              | Hands are split at a point you can change                |
| Recordings | `.wav` `.mp3` `.m4a` `.ogg` `.flac` | The notes are detected on your device; approximate       |
| Sheet PDF  | `.pdf`                              | Kept with a piece as your sheet music; no notes are read |

After choosing a file you see a **Check the import** step: the title, an estimated difficulty, the
hand split point (for MIDI) and the tempo. You can also keep only some bars (**Bars to keep**,
counted as the bars are played), to practise one part of a long piece, and add **Tags**: words,
with commas between them, that the library's search finds the piece by. Change what is wrong, then
**Save to my library**. You can pick or drop several files at once; each piece is checked in turn.

- Files are converted **in your browser** and stored in its private storage. Nothing is uploaded and
  there is no way to share a library item.
- Import only files you have the right to use for personal practice. The app asks you to confirm
  this the first time.
- Looking for music? The **Find sheet music** page lists sources of free and public-domain scores,
  and how to turn a PDF into a file OpenTiles can open.
- OpenTiles does not read notes from a PDF or a photo of sheet music. To practise a piece you only
  have as a PDF, find its MIDI or MusicXML file, or convert the PDF with a scanning tool.

To delete a piece, open **My library** and use **Delete** on its card. Its sheet music goes with it.

### Sheet music PDFs

Sites that offer a piece as a PDF usually offer a MIDI file of the same name. Pick both together, or
drop them on the library page, and they become one piece: the notes, the feedback and the falling
notes come from the MIDI file, and the PDF is kept as the sheet music you read.

- Files are matched by name, ignoring upper and lower case and the extension. If you pick one score
  file and one PDF whose names differ, OpenTiles asks whether they belong together.
- The check step shows **Sheet music:** and the PDF's name. **Leave out the sheet music** imports the
  notes alone.
- A PDF on its own becomes a _sheet only_ piece. You can open it, but to practise it add its MIDI or
  score file with **Add the MIDI or score file** on its card.
- Every piece's card can **Add sheet music (PDF)**, or **Replace** and **Remove** the one it has. A
  piece with sheet music has a **Sheet** badge.
- For a MIDI file with its PDF, the **Score** tab follows how the PDF writes the music: the staff
  each note is on, how it is spelt (F♯ or G♭) and where the clefs change. OpenTiles reads this from
  the printed notes of the PDF, on your device, the first time the piece opens. Scanned PDFs, and
  pieces whose bars you corrected with **Adjust bars**, keep OpenTiles' own engraving.
- PDFs up to 60 MB are accepted. Like the rest of your library they stay on this device and go only
  into your own encrypted backup.

## Settings

Open **Settings**; changes are kept on your device.

- **Language** — English or German.
- **Note names** — letters (C D E F G A B), German (with H), or fixed-do syllables; sharps or flats.
- **Keyboard** — number of keys, lowest key, fit-to-piece, which fingerings to show.
- **MIDI keyboard** — test it, and choose where the app's sound plays.
- **Foot pedal page turn** — pick the keys your Bluetooth pedal sends (arrows, Page Up/Down, Space
  and Enter are offered, or press **Detect key** and then the pedal). They turn the pages in the
  Sheet view, whether it shows your PDF or the engraved pages, and in a sheet-only piece; the
  arrows, Page Up/Down and Space always do. While Listen or Play along runs, the pages follow the
  music instead.
- **Accessibility** — appearance (light or dark, or the same as this device), high contrast, large
  print, reduced motion and a left-handed layout (practice controls on the left). On a touch screen
  every button is at least a finger's width.
- **Backup** — save an encrypted backup of your library (sheet music included) and progress, and
  restore it on another device. Optional encrypted sync needs a sync server; see [docs/sync.md](sync.md).
- **Crash reports** — off unless you switch them on, and only if your copy has a server to send to.

## Keyboard shortcuts

| Keys                                | Action                                      |
| ----------------------------------- | ------------------------------------------- |
| `Space`                             | Start or pause playback (not in wait mode)  |
| `R`                                 | Start the piece again                       |
| `A W S E D F T G Y H U J K O L P ;` | Play notes from C upwards, like piano keys  |
| `Z` / `X`                           | Move the computer-keyboard octave down / up |
| `Tab` / `Shift`+`Tab`               | Move between buttons and controls           |

In the Player:

| Keys                             | Action                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| `Space`                          | Play or pause                                                    |
| `←` / `→`                        | Back or forward 5 seconds                                        |
| `Shift`+`←` / `Shift`+`→`        | The piece before or after                                        |
| `F`, `Escape`                    | Stand mode on or off; `Escape` leaves it                         |
| `↑` / `↓` on a handle in Up next | Move that piece up or down (`Alt` with them anywhere on its row) |

The full, current list is in **Settings → Keyboard shortcuts**.

## Installing, offline use and your data

OpenTiles is a progressive web app (PWA).

- **Install it (optional).** In Chrome or Edge use the install icon in the address bar. OpenTiles
  then opens in its own window and works offline.
- **Updates.** The app asks before it updates itself.
- **Where your data lives.** Your library, progress and settings are in your browser's storage on
  this device. Clearing site data deletes them, so make an encrypted backup under **Settings →
  Backup** if you care about them.
- **What leaves your device.** Nothing. No analytics, no cookies, no third-party requests. See the
  in-app **Privacy** page and [docs/legal-guardrails.md](legal-guardrails.md).

## Languages and accessibility

The interface is available in English and German. Wording fixes and new languages are welcome; see
the [translation guide in CONTRIBUTING.md](../CONTRIBUTING.md#ways-to-help) and
[ADR 0014](adr/0014-translations-keyed-by-english.md).

If something is hard to use with a screen reader, keyboard or low vision, please
[open an issue](https://github.com/KunalGehlot/OpenTiles/issues/new/choose); accessibility
problems are treated as bugs.

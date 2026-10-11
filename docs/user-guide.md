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
- [Sight-reading drills](#sight-reading-drills)
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
4. Play the notes that light up. In wait mode the piece waits for you; nothing is timed.

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
  the hand you are not practising.
- **Tempo.** Slow a piece down to a speed you can manage, then raise it. OpenTiles remembers your
  last mode, hand, tempo and metronome choice.
- **Loop.** Repeat a range of bars. Choose the bars with the button or drag across the falling
  notes.
- **Metronome.** A click track at the current tempo.
- **Transpose.** Move the piece up or down in semitones.
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
- **Score** — a scrolling line of engraved sheet music with a cursor.
- **Sheet** — the music in pages, which suits reading ahead: your own PDF if the piece has one
  (see [Sheet music PDFs](#sheet-music-pdfs)), otherwise the engraved score. A Bluetooth page-turn
  foot pedal works here (see [Settings](#settings)).

## Sight-reading drills

The **Sight-reading** page generates endless note-reading practice: pick a clef and a range around
middle C, choose single notes or short phrases, and play what you see. Optional helps are note
names under the notes and a lit key to press. The next drill starts as soon as one ends.

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
hand split point (for MIDI) and the tempo. Change what is wrong, then **Save to my library**. You can
pick or drop several files at once; each piece is checked in turn.

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
- PDFs up to 60 MB are accepted. Like the rest of your library they stay on this device and go only
  into your own encrypted backup.

## Settings

Open **Settings**; changes are kept on your device.

- **Language** — English or German.
- **Note names** — letters (C D E F G A B), German (with H), or fixed-do syllables; sharps or flats.
- **Keyboard** — number of keys, lowest key, fit-to-piece, which fingerings to show.
- **MIDI keyboard** — test it, and choose where the app's sound plays.
- **Foot pedal page turn** — pick the keys your Bluetooth pedal sends (arrows and Page Up/Down are
  offered) and press the pedal to try it.
- **Accessibility** — high contrast, large print, reduced motion and a left-handed layout (practice
  controls on the left).
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

# The Player as a self-playing grand piano: design brief for P6-06

- **Status:** discussed with the maintainer and decided on 2026-10-18 (§7): the player piano,
  stand mode and phrasing now, the richer piano sound by default, the iPad app later. It answers
  P6-06 (the design) and changes how P6-07 to P6-09 and P6-14 are built; P6-15 to P6-17 are the
  three tasks it added to PLAN.md.
- **Read with:** [player.md](player.md), the Phase 6 plan. It still holds every task's
  background, and its Q1 to Q8 stay decided (ADR 0019). This brief carries on its numbering:
  the new questions are Q9 to Q14 in §7.

## 1. What the maintainer asked for (2026-10-18)

> "I want a really nice, elegant-looking player page where I'm able to connect my keyboard with the
> iPad through Firefox, Chrome, or Edge with MIDI, and then be able to just play the music I have in
> my library and the pieces altogether. So I get a list of all the music available, and then I'm
> able to play it through MIDI on the piano or the keyboard which is connected to the device. And
> the player needs to look really nice and elegant, so I want you to find a very nice way of setting
> this up. It needs to work like one of those self playing grand pianos."

The new part is the last sentence. A self-playing grand piano does three things this brief tries to
copy:

1. **You sit back.** You pick one piece, or nothing at all, and it plays on, piece after piece.
2. **The piano is the show.** The keys go down by themselves and the pedal moves. The screen next
   to it only tells you what is playing and what comes next.
3. **It sounds played, not typed.** Phrases swell and settle, and the last chord is held.

## 2. Where things stand

Most of the machinery behind the Player is already built. What is still open is the page itself,
the way it looks and the polish.

| Part                                                                                            | State                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------- |
| "Plays on" (this device, my keyboard, both), clean MIDI stops (P6-01, P6-02)                    | on `main`, deployed                           |
| One playback scheduler (P6-03), sustain and other pedals (P6-10), natural touch (P6-11)         | on `main`, deployed                           |
| One list of library and catalogue with lengths, search and sorting (P6-04)                      | on `main`, deployed                           |
| The transport: queue, shuffle, repeat, worker clock, wake lock, pause on unplug (P6-05)         | on `main`, deployed                           |
| MIDI out in the iPad app, Bluetooth MIDI pairing (P6-12)                                        | on `main`; compiles; **never run on an iPad** |
| `#/player` with two designs behind a switch, A "record sleeve" and B "stage" (P6-06 prototype)  | branch `P6-06-player-design`, not merged      |
| The page playing through the transport, shortcuts, seeking, e2e with a fake MIDI output (P6-07) | branch `P6-07-player-page`, not merged        |
| Mini player on other pages, media keys via Media Session (P6-09)                                | branch `P6-09-mini-player`, not merged        |
| Queue panel with reordering (P6-08), entry points from Home, Library and practice               | not started                                   |

"Play everything I have, library and catalogue together" therefore already works on the branches.
This brief is about how it looks and feels, plus three things a self-playing piano needs that the
plan did not have yet: stand mode, phrasing and a better sound on this device.

## 3. The iPad, plainly

**No browser on the iPad can talk MIDI to a keyboard.** That includes Firefox, Chrome and Edge.
All of them are built on Apple's WebKit, and WebKit has no Web MIDI. Since iPadOS 18, browsers in
the EU may use their own engines, but as of autumn 2026 no Blink or Gecko browser has shipped on the
iPad. Rechecked on 2026-10-18: Chrome, Edge and Firefox on the iPad are still WebKit apps. The app
feature-detects MIDI, so a browser that ships it later will simply work, but the plan cannot count
on that.

What does work, by device:

| Device and route                                     | What you hear                                                         | Keys you play reach the app | Keyboard's own piano voice and pedal |
| ---------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- | ------------------------------------ |
| Mac or PC, Chrome, Edge or Firefox, USB or Bluetooth | the keyboard plays the piece (MIDI)                                   | yes                         | yes                                  |
| iPad, any browser, keyboard on USB                   | the app's grand piano **through the keyboard's speakers** (USB audio) | no                          | no (the app's piano is used)         |
| iPad app (P6-12), keyboard on USB or Bluetooth       | the keyboard plays the piece (MIDI)                                   | yes                         | yes                                  |

What this means for the plan:

- **iPad in the browser: make USB audio a proper route, not a workaround.** A browser cannot see
  where its sound goes, so the app cannot detect it. The Player keeps the tip from P6-01 ("Plug the
  keyboard in by USB and the iPad plays through its speakers"). It also needs to sound as good as
  it can, because on the iPad what you hear is the app's piano (§5.3).
- **iPad with real MIDI needs the iPad app on the maintainer's iPad** (P3-01). It is built but has
  never run on a device. Installing it takes the iPad, a Mac with Xcode and an Apple ID. With a free
  Apple ID the app has to be re-installed every 7 days; a paid developer account ($99 a year)
  removes that. It is a session with the maintainer, separate from the web work (Q13).

## 4. The design: a player piano

### 4.1 The idea

Variant B, "stage", is the closest to a self-playing grand: the keyboard is the centrepiece and the
notes come from it. This design takes B's layout and turns it into an instrument. The idea comes
from the old player piano. A perforated paper **roll** moves over a tracker bar, and each hole that
passes makes a key go down. Variant A, "record sleeve", gives up its big cover, which belongs to
streaming apps rather than to pianos. What it keeps is A's calm typography and its generated
initials tiles in the list.

The Player has four places:

1. **The programme**: all the music, grouped like a concert programme.
2. **The music room**: the piece playing, with the roll, the keys and the pedals.
3. **Stand mode**: the music room alone, filling the screen, for a laptop or iPad on the music rest
   (§4.5).
4. **The mini player**: the bar on the other pages (built in P6-09).

### 4.2 The music room

From top to bottom:

- **Title block.** The title in a serif display size, with the composer in small capitals and the
  composer's dates underneath, as in a printed programme ("PRELUDE IN C · Johann Sebastian Bach,
  1685–1750"). "Plays on" sits at the right with a small status light: green when the keyboard
  plays, amber when the notes fall back to this device (P6-01's rules).
- **The roll.** A strip of paper above the keys. Each note is a perforation (a slot with rounded
  ends) as wide as its key and as long as the note. The paper moves down towards the keys at a speed
  set by the tempo.
  - In dark mode the paper is dark and warm, and light shines through the holes, a soft ivory glow.
    In light mode it is ivory paper with dark slots.
  - A faint paper grain is generated on the canvas, so no image is needed.
  - **The leader.** Every piece starts with the roll's leader: the title and composer printed on
    the paper, rolling towards the keys before the first note, as old rolls were labelled. The
    2 s gap between pieces (Q6) is the leader passing, so the gap becomes part of the show
    instead of a pause.
  - Pedal marks run along the right edge of the roll, the way expression lines ran on real rolls.
- **The tracker bar.** A thin brass line where the roll meets the keys. A hole lights up at the
  moment it passes the line.
- **The keyboard.** A drawn grand keyboard with depth: ivory keys with a visible front edge, ebony
  keys with a bevelled top. A key that plays goes down. Its front edge shortens by 2 to 3 px, and
  how deep it goes and how much it glows depend on how hard the note is played. It then comes back
  with the return glide from P5-09.
  - 88 keys when the room is at least about 1,000 px wide, so it reads as a grand. Narrower, it fits
    the piece (P5-16's "Fit piece").
  - Hand colours are off by default: a self-playing piano shows the piano, not the hands. A "Show
    hands" switch colours keys and holes in the practice hand colours (Q10).
- **The pedals.** Three small brass pedals under the keyboard. The right one goes down with the
  sustain pedal, the left with soft and the middle with sostenuto, using P6-10's pedal events.
  When the music plays on the keyboard, the drawn pedal moves at the moment the keyboard's pedal
  is sent.
- **Transport.** The seek bar (the overview picture of the piece from P5-07, with what has been
  played lit), elapsed and remaining time, then shuffle, previous, play/pause, next and repeat.
  After those come tempo, hands, volume and "Stand". These controls are quiet: small, grey, one
  accent for play/pause.

The roll and the keys draw on one canvas from `requestAnimationFrame`. The canvas reads the
transport through refs, as the prototype already does. React lays out only the title and the
controls.

### 4.3 The programme

- **Works, not files.** The catalogue has several versions of one tune, such as "Amazing Grace"
  and "Amazing Grace (melody)" (provenance fields `song` and `variant`). The programme lists each
  work once and plays its fullest version: both hands, never the melody-only one. A small chip on
  the row picks another version. Library pieces are one entry each.
- **Grouped by composer by default,** with each heading in small capitals with the composer's
  dates, as in a concert programme. Every heading has its own "Play all". Sorting by title, recently
  added, recently played and length stays (P6-04).
- **"Let it play".** One large button at the top. It plays everything in the current filter,
  shuffled, with repeat on, so the piano goes on until you stop it, like a self-playing piano in a
  hotel lobby. "Play all" plays the same list in order.
- **Filters:** All, My library, Catalogue (as in the prototype), plus a search across title,
  composer and tags.
- **Rows:** initials tile, title, length, and a small "playing" mark on the current piece. Play,
  Play next and Add to queue sit in the row's menu and show on hover on wide screens.
- **Composer dates:** add `composer_birth_year` to the catalogue's provenance records next to the
  existing `composer_death_year`. That is CC0 metadata, checked by the validator, and the index
  builder passes it on. Library pieces show the composer as typed at import.
- **Empty library:** the catalogue is still there, with "Import your own pieces" at the end.

### 4.4 Layouts

Wide window (the maintainer's Chrome, 2,560 px, dark): the programme on the left, the music room on the right,
and Up next as a drawer behind a button.

```text
┌ OpenTiles   Pieces  My library  Player  Sight-reading  …                                        ┐
├──────────────────────────────┬──────────────────────────────────────────────────────────────────┤
│ 🔍 Search all music          │  PRELUDE IN C                                   Up next ☰        │
│ [ ▶  Let it play ]           │  Johann Sebastian Bach, 1685–1750      Plays on ● Digital Keyboard│
│ All · My library · Catalogue │ ┌──────────────────────────────────────────────────────────────┐ │
│                              │ │ ░░░░░░░░░░░░░░░░░ the roll ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │
│ JOHANN SEBASTIAN BACH        │ │ ░░  ▮▮    ▮      ▮▮▮        ▮      perforations moving down ░ │ │
│ 1685–1750        Play all ▶  │ │ ░░      ▮    ▮▮       ▮▮        ▮  towards the keys      ░ │ │
│  Prelude in C        2:10 ♪  │ ├════════════════════════ tracker bar ═════════════════════════┤ │
│  Minuet in G         1:32    │ │▌┃▌▌┃▌┃▌▌▌┃▌┃▌▌┃▌┃▌▌▌┃▌┃▌▌┃  88 keys; played keys go down       │ │
│ LUDWIG VAN BEETHOVEN         │ └──────────────────────────────────────────────────────────────┘ │
│ 1770–1827        Play all ▶  │                        ◖ ◗ ◗  pedals (the right one moves)       │
│  Für Elise (theme)   0:58    │  0:42 ━━━━━━━━━━━━━●─────────────────────────────── 2:10         │
│  Ode to Joy          0:44    │        ⇄     ⏮     ( ⏸ )     ⏭     ↻     Tempo 100 %  Hands  ⛶   │
└──────────────────────────────┴──────────────────────────────────────────────────────────────────┘
```

iPad landscape uses the same two areas with a narrower programme. At ⅓ iPad width, in portrait on a
phone, and in any window under about 700 px, there is one column. The programme is the main view
and a mini transport stays at the bottom. Tapping the transport opens the music room as a
full-screen sheet:

```text
┌──────────────────────┐        ┌──────────────────────┐
│ Player            ☰  │        │ ⌄            Up next │
│ 🔍 Search            │        │ PRELUDE IN C         │
│ [ ▶ Let it play ]    │        │ J. S. Bach           │
│ JOHANN SEBASTIAN BACH│        │ ░░ ▮  ▮▮   ▮ ░░░░░░  │
│  Prelude in C ♪ 2:10 │  tap   │ ░ ▮▮    ▮  ▮▮ ░░░░░  │
│  Minuet in G    1:32 │ ─────► │ ════════════════════ │
│ L. VAN BEETHOVEN     │        │ ▌┃▌▌┃▌┃▌▌▌┃  keys fit│
│  Ode to Joy     0:44 │        │ the piece's range    │
├──────────────────────┤        │ 0:42 ━━━━●───── 2:10 │
│ ▮▮ Prelude in C ⏸  ⏭ │        │    ⏮    ( ⏸ )    ⏭   │
└──────────────────────┘        └──────────────────────┘
```

No sideways scrolling at 320 px. Touch targets are at least 44 px on touch screens (`touch.css`
stays the last stylesheet).

### 4.5 Stand mode

The music room alone, filling the window: title, roll, keys and pedals, and a line saying what comes
next ("Next: Minuet in G"). The controls appear on a tap, a mouse move or a key press, and fade
after 3 s. The screen stays awake while it plays (the wake lock from P6-05). `F` or the "Stand"
button switches it on and off; Escape leaves.

- On a Mac or PC it also asks the browser for full screen (Fullscreen API).
- On the iPad, Safari has element full screen and the iPhone does not. This needs checking on an
  iPad before the Player relies on it. The Home Screen app (Add to Home Screen) has no browser bars anyway,
  so it is the fallback.
- Under Reduce motion the roll stands still: the holes at the tracker bar light up, but the paper
  does not move. Keys light up without moving.

```text
┌──────────────────────────────────────────────────────────────┐
│                         PRELUDE IN C                         │
│                 Johann Sebastian Bach, 1685–1750             │
│   ░░░░░░░░░░░░░░░░░░░░░░ the roll ░░░░░░░░░░░░░░░░░░░░░░░░░   │
│   ══════════════════════════════════════════════════════════ │
│   ▌┃▌▌┃▌┃▌▌▌┃▌┃▌▌┃▌┃▌▌▌┃▌┃▌▌┃▌┃▌▌▌┃▌┃▌▌┃▌┃▌▌▌┃▌┃▌▌┃▌┃▌▌▌┃▌┃  │
│                          ◖ ◗ ◗                               │
│                 Next: Minuet in G · in 1:20                  │
└──────────────────────────────────────────────────────────────┘
```

### 4.6 Look and motion

- **Dark first, one accent.** All colours come from `styles/tokens.css`. New tokens: roll paper,
  hole light, brass, ivory, ebony and key shadow, in all four colour sets. `test/tokens.test.ts`
  checks that the holes and keys stand out against the paper (3:1).
- **Type:** the title and composer headings use the system's serif (New York on Apple devices,
  Georgia or Noto Serif elsewhere). Everything else stays in the system sans. Nothing is downloaded,
  which keeps within ADR 0011's "system fonts only".
- **Motion:** keys go down within one frame of the sound and come back in about 80 ms. The roll
  moves continuously. Panels use 150 to 200 ms transitions. Reduce motion turns all of it off, as
  described above.
- **High contrast:** the paper becomes plain black or white and the holes solid, with no grain and
  no glow.
- **No 3D library and no images.** The depth is drawn: one gradient per key, a shadow line and the
  front edge. The keys and roll are drawn by a new `player/piano.ts`, which reuses the measurements
  of the existing keyboard renderer, so the keys line up with the practice views.

### 4.7 What happens to variants A and B

The switch and variant A's cover go. B's drawing code (`player/stage.ts`: the notes rising from the
keys, sounding notes, the seek picture) is the starting point for the roll. The list, the "Plays
on" wiring, the transport hook and the one drawing loop in `routes/Player.tsx` all stay. So do the
fake MIDI output and `e2e/player.spec.ts`.

## 5. Making it sound played

### 5.1 Already there

The sustain pedal from MIDI and MusicXML is sent to the keyboard (P6-10). Pieces without
velocities get natural touch: the melody over the accompaniment and strong beats over weak ones
(P6-11). MIDI files keep their own velocities.

### 5.2 A finding

Natural touch was meant to read dynamics marks next (p, f, crescendo). But **none of the 81
catalogue scores has a dynamics mark, a hairpin or a fermata.** They come from `arrange.py`, which
writes none. Reading dynamics would help only MusicXML files people import themselves. For the
catalogue to sound played, the shaping has to come from the music itself.

### 5.3 Proposal: phrasing (P6-16), and a better sound on this device (P6-17)

**Phrasing**, in `packages/practice` next to `touchVelocities`. It is pure and tested, and it is
used by the Player only. Practice stays strict, because play-along scoring needs fixed timing.

- **Contour:** within a phrase the melody grows a little louder towards its highest note and
  softer at the end. A phrase ends at a rest in the melody, a long note or every 4 bars.
- **Ending:** the last bar slows by up to 10 % and the final chord is held a little longer.
  This is applied at playback time. The `Song` keeps beats only (ADR 0003), so nothing about this is
  stored.
- **Dynamics marks and hairpins,** when an imported MusicXML file has them, set the level the
  contour works around.
- **Settings:** the existing Touch setting gains "Expressive" (phrasing on) next to "Natural" and
  "Even". The Player defaults to Expressive, practice to Natural (Q12).

**Sound on this device.** This matters most on the iPad, where you hear the app's piano through the
keyboard's speakers.

- **Room sound:** a soft hall reverb from an impulse response generated in code when the page
  starts (decaying filtered noise, about 1.8 s, mixed in quietly). No file, so no licence question.
  It is on in the Player and off in practice, where it would blur timing.
- **A richer piano, optional:** today the app's piano is 30 Salamander samples at one loudness
  (1.9 MB). Salamander was recorded at 16 loudness levels. Shipping 3 or 4 of them makes soft notes
  sound soft rather than just quieter; the estimate is 6 to 10 MB. They are the default sound
  (Q11): the current set still loads first, so the music starts at once, and the richer layers
  follow from the app's own site and are kept for offline use. Settings can go back to the lighter
  set. The licence is
  the same as today's samples (CC-BY 3.0, ADR 0007). The cost is that the repository and the site
  grow by that much (Q11).

### 5.4 Keys in step with the sound

The whole illusion depends on one thing: a key must go down when its note is heard, not when the
note is sent. Today the drawing follows the transport's clock and ignores two delays:

- **This device's audio** comes out later than it is scheduled, by the output latency. Chrome and
  Firefox report it (`outputLatency`, `baseLatency`); what Safari reports needs checking. Over a
  USB audio keyboard it can be tens of milliseconds.
- **MIDI notes** are handed to the browser at least 58 ms early, with a time stamp, and the
  keyboard plays them on time (measured in P6-05). So for MIDI the time stamp is the right moment.

The rule, then:

- When playing on the keyboard, draw at the time stamp.
- When playing on this device, draw at the scheduled time plus the reported output latency.
- When playing on both, hold the MIDI notes back by the device's output latency so the two sound
  together, and draw at that time.

A unit test with fake latencies covers this, and `checks/player-timing.cjs` measures it again in
real Chrome, Edge and Firefox. It belongs inside P6-07, not in a task of its own.

## 6. Tasks, in order

Existing PLAN.md IDs keep their meaning; P6-15 to P6-17 were added on 2026-10-18.

1. **P6-06 Design (the prototype).** Build the music room as described: roll, tracker bar, drawn
   keyboard, pedals, title block and stand mode's layout. It goes into the real `#/player` on the
   existing branch, with the A/B switch removed, and plays catalogue pieces. Check it in the maintainer's
   Chrome (dark first), then light, ⅓ iPad width and 320 px, and send screenshots and a short
   screen recording. **Then stop for the maintainer's approval.** The choice is in ADR 0019.
2. **P6-07 The page.** The programme (works not files, composer grouping and dates, "Let it play",
   filters, search, row menu), the music room wired to the transport, keys in step with the sound
   (§5.4), and entry points: Play on Home and Library cards, "Open in Player" in practice,
   "Practise this" in the Player. Also shortcuts (Space, ← →, Shift + ← →, F), German strings,
   the layouts and accessibility: a list with arrow keys, a seek slider with
   `aria-valuetext`, and "Now playing" in a polite live region. e2e on all four Playwright profiles.
   One PR, merged when green.
3. **P6-08 Up next.** The drawer on wide screens and a sheet on narrow ones; reordering by drag and
   Alt + ↑ ↓; remove and clear; the queue kept on this device and still there after a reload.
4. **P6-09 Mini player.** Rebase the existing branch onto the above, restyle it to match, and keep
   "Stopped while you practise." and Media Session as built.
5. **P6-15 Stand mode** (new). Full window, controls that fade, full screen where offered, wake
   lock, Reduce motion rules, and an e2e test that the controls come back on a key press.
6. **P6-17 Sound on this device** (new). Room sound, and the richer piano as the default sound
   (Q11).
7. **P6-16 Phrasing** (new). As in §5.3, with unit tests: contour shape, a ritardando bound of at
   most 10 %, the same output for the same piece, and practice unaffected.
8. **P6-14 Docs.** The Player in the user guide (with the iPad table from §3), the README and the
   FAQ.
9. **P6-13 The maintainer's checks.** Their keyboard in Chrome, Edge and Firefox on the Mac; the iPad over USB
   audio; 10 minutes in a hidden tab; approving the design.
10. **P3-01 The iPad app on the maintainer's iPad** (together, later): build in Xcode on the Mac,
    install it, and check MIDI out to the keyboard.

Each step is one PR, merged and deployed once CI and the author's own checks pass, as agreed on 2026-10-17.
The only stop is step 1, for the design.

## 7. Questions, and the maintainer's answers (2026-10-18)

| #   | Question                                                                            | Recommendation                                                         | Answer                        |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| Q9  | Design: the player piano of §4 (B grown into an instrument), or A or B as they are? | The player piano                                                       | The player piano              |
| Q10 | Hand colours on the keys and roll by default?                                       | Off in the Player, with a "Show hands" switch                          | As recommended                |
| Q11 | A richer piano sound as an optional download (about 6–10 MB)?                       | Yes, off by default, switched on in Settings; room sound in the Player | **Yes, and on by default**    |
| Q12 | Phrasing (expressive playback) now or later, and on by default?                     | Now, after stand mode; on in the Player, off in practice               | Now, as recommended           |
| Q13 | iPad: browser over USB audio now, and the iPad app together for real MIDI?          | Yes to both; the web work does not wait for the app                    | Yes; the iPad app comes later |
| Q14 | Stand mode (full window, controls that fade)?                                       | Yes                                                                    | Yes                           |

## 8. Out of scope, and the hard rules

- **No casting, sharing or exporting** of a queue, a piece or a performance (hard rule 1). Media
  Session metadata goes to this device's own controls only (P6-09).
- **No new images, fonts or libraries.** Paper grain, keys, pedals and reverb are all made in code.
  Only the optional samples are new files, under the existing licence. They get an entry in
  `tools/licences/assets.json`.
- **Nothing leaves the device and nothing is tracked** (hard rules 3 and 5). The optional samples
  come from the app's own site.
- **Screenshots and recordings** use CC0 catalogue pieces only (hard rule 4).
- **Not planned:** recorded human performances (there are none the project could ship), other instruments,
  and a 3D piano.

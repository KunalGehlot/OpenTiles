# Frequently asked questions

Quick answers about OpenTiles. The [user guide](user-guide.md) explains each feature in full. If your
question is not here, [ask in Discussions](https://github.com/KunalGehlot/OpenTiles/discussions/new?category=q-a).

## About OpenTiles

### Is it really free?

Yes. There is no paywall, advertising or premium tier on any learning feature, and there never will
be. The code is licensed AGPL-3.0-or-later, so the project cannot be closed off later.

### Can I try it online?

Not yet. OpenTiles is a working app that has not been released; a hosted version is waiting on
the microphone tests on real pianos, a legal review and the deployment (see [PLAN.md](../PLAN.md)).
You can [run it yourself](../README.md#run-it-yourself) today.

### Do I need an account?

No. There are no accounts. Your library and progress are stored in your browser on your device.

### Which devices and browsers work?

Desktop Chrome, Edge and Firefox. **Safari is not supported**, and phones and tablets are not a
target. See [browser support](../README.md#browser-support).

### Does it work offline?

Yes, once it has loaded. In Chrome or Edge you can also install it as an app.

### How is it different from Flowkey, Simply Piano or Sightread?

OpenTiles keeps the practice loop (wait mode, play-along, hand separation, looping, tempo) free and
open source, and keeps your own files private. Its catalogue is only public-domain music.
[Sightread](https://github.com/sightread/sightread) is a similar free project that came first; see
[CREDITS.md](../CREDITS.md).

## Playing

### Does it work with an acoustic piano?

Yes, through the microphone. Because the app knows which notes should come next, it only has to
check whether they are sounding. The detector is still being tuned on real pianos, so reports are
very welcome: use the
[microphone report form](https://github.com/KunalGehlot/OpenTiles/issues/new?template=microphone.yml).

### My MIDI keyboard is not found.

- Use Chrome, Edge or Firefox. Safari has no Web MIDI and is not supported.
- Connect and switch on the keyboard, then reload the page and press **Connect MIDI keyboard**.
- Allow the MIDI permission when the browser asks. If you refused, reset the site's permissions in
  the browser's address bar.
- Check that no other app (a DAW, for instance) holds the keyboard exclusively.
- Test it under **Settings → Test your keyboard**: it shows the last key it heard.

### I hear every note twice.

Your keyboard makes sound itself and the app plays it too. Switch off **Play my MIDI keys on this
device** in **Settings → MIDI keyboard**, or turn the keyboard's speakers down.

### Can I use a MIDI keyboard on an iPad or iPhone?

Not in a browser: no browser on an iPad or iPhone can reach MIDI keyboards, and Safari is not
supported. Two things help in the meantime. Many digital pianos also work as a USB audio
interface: plugged into an iPad, they play its sound through their own speakers, the app's notes
included. And an acoustic or digital piano can be heard through the microphone. The OpenTiles iPad
app talks to MIDI keyboards over USB and Bluetooth. It is experimental and not in the App Store:
you sign it with your own Apple ID and install it yourself ([Installing the iPad app](ipad-app.md)).

### The timing feels off.

Run **Calibrate timing** or **Measure keyboard delay** under **Options** on the practice screen.
Bluetooth keyboards and speakers add delay; a wired connection is the most exact.

### The microphone misses notes or hears notes that I did not play.

Run **Set up microphone** for your room, keep the device close to the piano and keep the room quiet.
Do not use **Listen** mode or **Play other hand** at the same time, because the microphone would hear the app instead of the piano. If it still struggles, please report it with
your device, browser and piano type.

### Can I turn pages with a foot pedal?

Yes. Most pedals send the arrow keys or Page Up/Down, which turn the pages of the Sheet view
already. For a pedal that sends other keys, enable **Settings → Foot pedal page turn** and press
your pedal to teach OpenTiles which keys it sends.

## Your music

### Which files can I import?

MusicXML (`.musicxml`, `.xml`, `.mxl`), MuseScore (`.mscz`, `.mscx`), ABC (`.abc`), MIDI (`.mid`)
and recordings (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac`). Notes from a recording are detected on your
device and are only approximate. A sheet-music PDF (`.pdf`) is kept with a piece. See
[Bringing your own music](user-guide.md#bringing-your-own-music).

### Can I practise only part of a piece?

Yes. Loop a few bars in practice (**Loop**), or keep only some bars when you import the piece
(**Check the import → Bars to keep**).

### Can I import a PDF or a photo of sheet music?

A PDF, yes, as the sheet music of a piece. Import it together with the piece's MIDI or score file
(sites that offer a PDF usually offer a MIDI file of the same name): the notes come from the MIDI
file, and the PDF is kept as the sheet you read. A PDF on its own can be read but not practised,
because OpenTiles does not read notes from PDFs or photos. To get notes from a scan, convert it to
MusicXML with a scanning tool first; the **Find sheet music** page in the app explains how. See
[Sheet music PDFs](user-guide.md#sheet-music-pdfs).

### Can I share my imported pieces with other people?

No, on purpose. OpenTiles has no way to share or publish library items, so it can never become a
channel for copyrighted music. See [docs/legal-guardrails.md](legal-guardrails.md).

### Why is there no import from a link?

For the same reason: OpenTiles never fetches music from other websites. Download the file, then
import it from your device.

### Can I suggest a piece for the catalogue?

Yes, if it is in the public domain. Use the
[catalogue form](https://github.com/KunalGehlot/OpenTiles/issues/new?template=catalogue-piece.yml)
and read [catalogue/README.md](../catalogue/README.md) first. Pieces from a composer who died in
1955 or earlier (for a 2026 release) are candidates, and so are traditional tunes; the transcription
must also be free.

## Privacy and data

### What do you collect?

Nothing. No analytics, cookies or third-party requests. Crash reports are off unless you switch them
on, and only work where a server has been set up for them.

### Where is my data, and how do I move it?

In your browser's storage on this device. Make an encrypted backup under **Settings → Backup** and
restore it on another device. Optional encrypted sync is described in [docs/sync.md](sync.md).

### I cleared my browser data and my library is gone.

Without a backup it cannot be recovered; the data only ever existed on that device. Making a backup
now and then is the cure.

## Getting involved

### How can I help?

Code, catalogue reviews, recordings for the detector test set and translations are all welcome. See
[CONTRIBUTING.md](../CONTRIBUTING.md). Not a developer? A catalogue review takes about ten minutes
([catalogue/REVIEWING.md](../catalogue/REVIEWING.md)), and a bug report from your own piano is
valuable.

### I found a security problem.

Please report it privately, not in a public issue. See [SECURITY.md](../SECURITY.md).

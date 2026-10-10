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

Any current browser on a computer, tablet or phone. iPad Safari is a first-class target. Web MIDI
(plugging in a keyboard) works in Chrome, Edge and Firefox but not in Safari; on iPad a MIDI
keyboard needs the OpenTiles iPad app, which is not released yet. The microphone and on-screen keys
work everywhere.

### Does it work offline?

Yes, once it has loaded. Install it to your home screen for the most reliable offline use.

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

- Use Chrome, Edge or Firefox. Safari cannot do Web MIDI.
- Connect and switch on the keyboard, then reload the page and press **Connect MIDI keyboard**.
- Allow the MIDI permission when the browser asks. If you refused, reset the site's permissions in
  the browser's address bar.
- Check that no other app (a DAW, for instance) holds the keyboard exclusively.
- Test it under **Settings → Test your keyboard**: it shows the last key it heard.

### I hear every note twice.

Your keyboard makes sound itself and the app plays it too. Switch off **Play my MIDI keys on this
device** in **Settings → MIDI keyboard**, or turn the keyboard's speakers down.

### The timing feels off.

Run **Calibrate timing** or **Measure keyboard delay** under **Options** on the practice screen.
Bluetooth keyboards and speakers add delay; a wired connection is the most exact.

### The microphone misses notes or hears notes that I did not play.

Run **Set up microphone** for your room, keep the device close to the piano and keep the room quiet.
Do not use **Listen** mode or **Play other hand** at the same time, because the microphone would hear the app instead of the piano. If it still struggles, please report it with
your device, browser and piano type.

### Can I turn pages with a foot pedal?

Yes. Enable **Settings → Foot pedal page turn** and press your pedal to teach OpenTiles which keys it
sends.

## Your music

### Which files can I import?

MusicXML (`.musicxml`, `.xml`, `.mxl`), MuseScore (`.mscz`, `.mscx`), ABC (`.abc`), MIDI (`.mid`)
and recordings (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac`). Notes from a recording are detected on your
device and are only approximate. See [Bringing your own music](user-guide.md#bringing-your-own-music).

### Can I import a PDF or a photo of sheet music?

Not directly. Convert it to MusicXML with a notation program or a scanning tool first; the
**Find sheet music** page in the app explains how.

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
now and then is the cure. On iPad, install OpenTiles to the home screen so Safari does not clear its
data after a week without a visit.

## Getting involved

### How can I help?

Code, catalogue reviews, recordings for the detector test set and translations are all welcome. See
[CONTRIBUTING.md](../CONTRIBUTING.md). Not a developer? A catalogue review takes about ten minutes
([catalogue/REVIEWING.md](../catalogue/REVIEWING.md)), and a bug report from your own piano is
valuable.

### I found a security problem.

Please report it privately, not in a public issue. See [SECURITY.md](../SECURITY.md).

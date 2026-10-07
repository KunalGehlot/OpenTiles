# @opentiles/audio-import (P4-02)

Turns a recording of piano music into approximate falling notes. Everything runs on the device:
the browser decodes the file, Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch-ts)
model (Apache-2.0) runs in TensorFlow.js (Apache-2.0), and the notes become a `Song` with
`format: 'audio'`. Nothing is uploaded.

```ts
const samples = await decodeToMono22050(await file.arrayBuffer()); // browser only
const notes = await transcribe(samples, (fraction) => showProgress(fraction), {
  model: new URL('models/basic-pitch/model.json', document.baseURI).href,
});
const song = toSong(notes, 'My recording');
```

- `transcribe` tries the WebGL backend first and falls back to the CPU backend. It cleans its
  output with `cleanNotes`: notes outside the 88 keys go, fragments of the same pitch less than
  30 ms apart merge, and notes shorter than 60 ms are dropped.
- `toSong` puts the notes on a fixed 120 bpm grid (beats = seconds × 2) in 4/4, splits hands with
  `splitHands`, and always adds a warning that the notes are approximate.
- The model files are vendored in `apps/web/public/models/basic-pitch/` with their licence and
  checksums, so the app never fetches from a third-party origin.

The package is heavy (TensorFlow.js is about 840 kB of JavaScript, 215 kB gzipped, plus 917 kB of
model). The web app must load it with a dynamic `import()` only when someone imports an audio
file; `apps/web/src/lib/audio-import.ts` does that.

The model runs once per two-second window on the main thread, yielding between windows so the
page can repaint a progress bar.

# Basic Pitch model (vendored)

The TensorFlow.js graph model of Spotify's Basic Pitch audio-to-MIDI transcriber, used by
`packages/audio-import` for the approximate audio-recording import (P4-02). It is served from the
app's own origin so nothing is fetched from a third party at runtime.

- Source: npm package `@spotify/basic-pitch` 1.0.1, directory `model/`
  (<https://github.com/spotify/basic-pitch-ts>)
- Copyright 2022 Spotify AB
- Licence: Apache-2.0, see [LICENSE](LICENSE)
- Files, unchanged:

| File                   | Bytes   | SHA-256                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------ |
| `model.json`           | 174 537 | `1ed1aaee3409ec1dc098c8b01f430c0911f6fe9412e7af8086750f9e8f302f68` |
| `group1-shard1of1.bin` | 742 392 | `b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c` |

To update, copy `model/` from a newer release of the package and refresh this table.

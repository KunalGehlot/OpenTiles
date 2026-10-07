# apps/ios-shell (phase 3)

Placeholder for the Capacitor wrapper that ships the same web app on the App Store with a small
Swift CoreMIDI plugin, because no iOS/iPadOS browser supports Web MIDI (spec §5).

Planned in PLAN.md task **P3-01**. The plugin will emit the same `NoteEvent`s as the web MIDI input
(`NativeMidiInput`), so the practice engine needs no changes.

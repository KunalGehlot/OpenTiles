# Open-Source Piano Learning Platform — Project Plan

Oct 7, 2026 · @Kunal Gehlot

## 1. Aim and guiding principles

The aim is a free, open-source piano trainer that runs in any modern browser, including Safari on iPad. It should match Flowkey's core loop: see the music, play it, get instant feedback. It never distributes copyrighted music: the public catalogue is public-domain only, and everything else is a private library the user brings.

**Problem.** Commercial piano apps put their whole learning experience behind subscriptions, including the public-domain classical pieces that make up much of their catalogue. Learners who already own sheet music still pay for the practice tool.

**Goal.** Make the practice tool itself free. That means interactive feedback, wait mode, looping, tempo control and progress tracking. The music is either public domain or the learner's own.

| Principle | What it means in practice |
| --- | --- |
| Free forever | No paywall, ads or premium tier on any learning feature |
| Bring your own music | Each user's library is private; the platform never shares or distributes user files |
| Public-domain-only catalogue | The home page lists only verified public-domain or CC0 scores, with provenance recorded |
| Works everywhere | Web-first installable app (PWA); iPad Safari is a first-class target, not an afterthought |
| Local-first and private | Works offline; files stay on the device by default; optional sync is end-to-end encrypted |
| Open by default | Open-source code, open file formats (MusicXML, MIDI), CC0 catalogue metadata |

**Definition of success for v1.0:** a beginner on an iPad in Safari, playing an acoustic piano, can import a MusicXML file or pick a public-domain piece, then practise it in wait mode with reliable note recognition. No account, install or payment is needed.

## 2. Scope and content model

The product has two content zones that never mix: a public catalogue (public domain only) and a private library (bring your own music, visible only to its owner).

| Zone | Who sees it | What it may contain | Where files live |
| --- | --- | --- | --- |
| Public catalogue (home page) | Everyone | Verified public-domain or CC0 scores, each with source, licence and EU-term check | Static files on a CDN, in the project's repo |
| Private library | The owner only | Anything the user imports | The user's device; optional encrypted personal sync |

**In scope for v1.0:** interactive practice, the public-domain catalogue, private import of MusicXML, MIDI and MuseScore files, MIDI-keyboard and microphone input, progress tracking, offline use.

**Out of scope permanently:** sharing between users, public profiles that show library contents, search across users' libraries, any import that scrapes third-party sites, and hosting any copyrighted arrangement.

**Out of scope for v1.0 (later phases):** PDF import via optical music recognition, audio-to-score import, original courses and lessons, community CC0 arrangements.

### Legal guardrails written as product requirements

These turn the private-library design into rules the code and the marketing must keep. Germany is the operator's jurisdiction.

- [ ] **No distribution path exists in the code.** There is no share link, export-to-public or "publish" button for library items.
- [ ] **The operator cannot see library contents.** Sync blobs are end-to-end encrypted (section 10), so there is nothing for the operator to select, curate or promote.
- [ ] **No copyrighted titles in marketing.** Screenshots, demo videos and the README use public-domain pieces only.
- [ ] **No import tools aimed at other sites.** Imports take local files only; no URL import from score-sharing sites or video platforms.
- [ ] **Upload terms.** Users confirm they only import files they have the right to use for personal practice.
- [ ] **Notice-and-takedown contact.** Published in the Impressum, even though private encrypted storage makes takedowns unlikely to be needed.
- [ ] **Catalogue provenance.** Every public piece records its source, licence, composer death year, and the editor/arranger of the specific transcription.
- [ ] **Legal review before public launch.** A one-off consultation with a German copyright lawyer on the final design.

## 3. Target users and core journeys

The primary user is an adult beginner or returning player who wants structured practice without a subscription. The design is tuned to the hardest setup: an iPad on the music stand next to an acoustic piano.

| Persona | Setup | Main need | Hardest requirement |
| --- | --- | --- | --- |
| Adult beginner | iPad + acoustic or digital piano, no cable | Learn first pieces with guidance | Microphone recognition in Safari |
| Returning player | Laptop + MIDI keyboard over USB | Practise pieces they own on paper or as files | Fast, accurate import of their own files |
| Self-taught pop player | Phone or tablet + keyboard | Learn favourite songs from files they bought or transcribed | Smooth import, hand separation, looping |
| Teacher (later phase) | Any | Recommend public-domain pieces to students | Stable links to catalogue pieces |

### Journey A: first session from the catalogue (no account)

1. Open the site, pick a public-domain piece filtered by difficulty.
2. Choose input: MIDI keyboard (if the browser supports it) or microphone, with a 10-second calibration.
3. Practise in wait mode, one hand first, then both hands.
4. See accuracy and a streak; the progress stays saved on the device.

### Journey B: bring your own piece

1. Drag in or pick a file (.musicxml, .mxl, .mid, .mscz) from the device, or from the iPad Files app.
2. The app converts it on the device and shows a preview: hand split, tempo, key.
3. Fix the hand split or tempo if needed, then save to the private library.
4. Practise exactly as in Journey A.

### Journey C: continue on another device (optional account)

1. Create an account with an email link or passkey.
2. The library and progress sync as encrypted data; the server stores only unreadable blobs.
3. Sign in on the second device; it decrypts locally and continues.

## 4. Feature specification

Version 1.0 ships the Flowkey practice loop: wait mode, play-along at adjustable tempo, hand separation and section looping, with note-by-note feedback. Instead of Flowkey's filmed hands, a scrolling score sits above an animated keyboard.

### Practice modes

| Mode | Behaviour | Priority | Phase |
| --- | --- | --- | --- |
| Wait mode | The cursor stops at each chord until the correct notes are played; wrong notes flash red | Must | 1 |
| Play-along | The score scrolls at the set tempo; notes are scored as hit, early, late or missed | Must | 1 |
| Listen | The app plays the piece with the keyboard and cursor animated | Must | 1 |
| Hand separation | Practise left, right or both hands; the app can play the other hand | Must | 1 |
| Loop section | Drag across bars to loop them, with an optional automatic tempo increase per clean run | Must | 2 |
| Tempo control | 25–150% of the score tempo, with a count-in and metronome | Must | 1 |
| Step practice | Splits a piece into phrases and suggests the next phrase once accuracy passes 90% | Should | 3 |

### Views

| View | Description | Priority |
| --- | --- | --- |
| Scrolling score | A single horizontal staff line that scrolls under a fixed cursor, as Flowkey does | Must |
| Page score | Normal page layout for longer pieces and reading practice | Should |
| Falling notes | Synthesia-style falling bars onto the keyboard, for players who don't read notation yet | Should |
| Animated keyboard | Expected keys highlighted, with left and right hand in different colours | Must |
| Fingering | Shown from the score's fingering marks where present | Should |

### Feedback and motivation

- **Live feedback:** correct notes turn green, wrong notes red, missed notes grey; timing shown as early or late.
- **After each run:** accuracy %, timing deviation and the hardest bars marked on the score.
- **Progress:** per-piece best score, practice minutes per day, streaks, and a difficulty path through the catalogue.
- **No dark patterns:** no paywall nudges or push-notification nagging; reminders are opt-in.

### Input methods

| Input | Use | Priority |
| --- | --- | --- |
| MIDI keyboard | Most accurate; USB or Bluetooth | Must |
| Microphone | Acoustic pianos, and any browser without MIDI support (see section 5) | Must |
| On-screen keyboard | Trying the app with no instrument; touch on tablets | Should |

### Accessibility and comfort

Large-print mode for the music stand, a high-contrast theme, left-handed layout options, keyboard shortcuts on desktop, and a foot-pedal page turn (Bluetooth pedals that send key presses).

## 5. Platform compatibility

Everything except MIDI input works in every target browser. Safari on macOS, iOS and iPadOS has no Web MIDI API in any version, and every iOS/iPadOS browser inherits that gap because they all run on WebKit ([web-features](https://web-platform-dx.github.io/web-features-explorer/features/web-midi), [support overview](https://www.testmuai.com/learning-hub/web-midi-api-browser-support/)). So the microphone is the primary input on iPad, and MIDI there needs a native shell.

| Platform / browser | Sheet + playback | Microphone input | MIDI keyboard | Install as app | Offline storage risk |
| --- | --- | --- | --- | --- | --- |
| iPadOS / iOS, any browser (WebKit) | Yes | Yes | No in browser; yes via native shell (phase 3) | Add to Home Screen | Browser tab: data at risk after 7 days of no use; Home Screen app: exempt |
| macOS Safari | Yes | Yes | No (third-party extension only) | Add to Dock | Same 7-day rule as iOS Safari |
| macOS / Windows / Linux, Chrome or Edge | Yes | Yes | Yes | Yes | Low |
| Desktop Firefox 108+ | Yes | Yes | Yes (permission prompt) | No native install | Low |
| Android Chrome | Yes | Yes | Yes, USB-OTG or Bluetooth | Yes | Low |
| Android Firefox | Yes | Yes | No | Limited | Low |

### Decisions that follow from the matrix

1. **The microphone is a first-class input, not a fallback.** It's the only input that works everywhere, and Flowkey's own acoustic-piano mode works the same way. Section 7 covers how to make it reliable.
2. **iPad MIDI comes from a native shell, not the web.** WebKit has said it will not ship Web MIDI ([Safari-WebMIDI project notes](https://github.com/triglav-modular/Safari-WebMIDI)). In phase 3, wrap the same web app in Capacitor with a small CoreMIDI plugin and publish it free on the App Store. The cost is the Apple Developer Program fee.
3. **Steer iPad users to Add to Home Screen.** Safari deletes script-written site data after seven days of browser use without interaction with the site. Home Screen web apps keep their own usage counter and aren't expected to lose first-party data ([WebKit, via The Register](https://www.theregister.com/2020/03/26/apple_relax_were_not_totally/)). The app shows an install prompt after the first imported file.
4. **Request persistent storage.** Call `navigator.storage.persist()` on first import. WebKit grants it based on heuristics such as whether the site runs as a Home Screen web app ([WebKit storage policy](https://webkit.org/?p=14403)).
5. **Never trust local storage alone for a private library.** The app offers a one-tap encrypted backup file and optional encrypted sync (section 10).

### Safari-specific engineering checklist

- [ ] Start the audio context only from a user tap (Safari blocks audio without a user gesture).
- [ ] Request the microphone with echo cancellation, noise suppression and auto gain control turned off; they distort piano tones.
- [ ] Handle iPad split view and rotation; keep the score usable at 1/3 screen width.
- [ ] Test the WebAssembly SIMD build plus a non-SIMD fallback.
- [ ] Keep sound playback in a Web Audio sampler; no reliance on Web MIDI output.
- [ ] Run a device lab: an older iPad (A12-class chip), a current iPad, an iPhone, an Android tablet and a low-end Windows laptop.

## 6. System architecture and tech stack

The app is a static, installable web app that does all music processing on the device. The server side is only a CDN for the app and catalogue, plus optional encrypted sync. With no backend logic touching music, hosting is cheap and the privacy promise is enforced by the design.

*(Embedded diagram not included in this copy — see [docs/architecture.md](../architecture.md).)*

Every input becomes the same stream of note events, and every file becomes the same `Song` model, so the practice engine has one path regardless of device or format.

### Stack decisions

| Layer | Decision | Why | Alternative kept open |
| --- | --- | --- | --- |
| Language | TypeScript (strict) for app and API; Rust for the detector | One language across app and API; Rust gives fast, predictable WebAssembly | C++ via Emscripten |
| UI framework | React + Vite | Largest contributor pool; timing-critical drawing bypasses React anyway | Svelte for smaller bundles |
| Notation rendering | Verovio (WebAssembly) | Fast SVG engraving of MusicXML and ABC; outputs a timing map that links each note to its glyph | OpenSheetMusicDisplay, which has a built-in cursor |
| Falling notes + keyboard | Canvas 2D, 60 fps | Light on older iPads | WebGL if profiling demands it |
| Sound playback | Web Audio sampler with open-licence piano samples | Same sound on every platform; no MIDI output needed | Small synth fallback |
| Audio input | AudioWorklet → Rust/WebAssembly detector | Off the main thread, low latency, works in Safari | — |
| Local storage | IndexedDB via Dexie | Large blobs, works offline, well tested on Safari | Origin Private File System |
| Offline + install | Service worker (Workbox) + web app manifest | Home Screen install on iPad; full offline practice | — |
| iPad MIDI (phase 3) | Capacitor shell + Swift CoreMIDI plugin | Reuses the web app unchanged | — |
| Sync API | Small TypeScript service + S3-compatible EU object storage | Shares the `Song` types; stores blobs only | Serverless functions |
| Catalogue pipeline | Python (pandas, music21) | Fits PDMX's CSV and MusicXML tooling | — |
| Testing | Vitest; Playwright on Chromium, Firefox **and WebKit**; real-device runs before each release | WebKit in CI catches most Safari bugs early | — |
| CI/CD | GitHub Actions → static deploy | Free for open source | — |

## 7. Note detection engine

The engine never transcribes blindly. Because the app always knows which notes the score expects next, the microphone only has to answer "are these expected notes now sounding, and is anything clearly wrong?". That is far easier and faster than general polyphonic transcription, and it is what makes microphone input viable on an iPad.

### Input abstraction

Every input produces the same event stream, `NoteEvent {pitch, onsetTime, velocity?, confidence}`, so practice modes don't care where notes come from.

| Adapter | Source | Notes |
| --- | --- | --- |
| `MidiInput` | Web MIDI API | Exact pitch and timing; latency measured once and compensated |
| `MicInput` | `getUserMedia` → AudioWorklet → WebAssembly detector | Score-informed; confidence per note |
| `TouchInput` | On-screen keyboard | Demo and no-instrument mode |
| `NativeMidiInput` | Capacitor CoreMIDI plugin (iPad app) | Same events as `MidiInput` |

### Microphone pipeline (written in Rust, compiled to WebAssembly)

1. **Capture:** an AudioWorklet collects 128-sample blocks at the device sample rate (44.1 or 48 kHz) into a ring buffer, off the main thread.
2. **Spectrum:** a 2048-point FFT with a hop of about 5 ms, plus a 4096-point window for notes below C3.
3. **Onset detection:** spectral flux spots new attacks, so notes still ringing under the sustain pedal don't count as new hits.
4. **Expected-note test:** at each onset, every expected pitch gets a harmonic score: energy at its first 6–8 partials, adjusted for piano inharmonicity, compared with the measured noise floor.
5. **Wrong-note test:** the same score is computed for a short list of likely mistakes (neighbouring semitones and octave errors). A clearly stronger wrong pitch is reported as an error.
6. **Decision:** confidence thresholds differ by mode; wait mode errs towards accepting, play-along errs towards precision.

### Calibration (about 10 seconds, stored per device and instrument)

- Measure room noise for 2 seconds.
- The user plays a few keys spread across the keyboard; the app learns the instrument's harmonic profile and loudness.
- The app checks that this is a tuned piano at A = 440 Hz ± 30 cents, or offsets detection if it isn't.

### Timing and latency

| Stage | Target | How |
| --- | --- | --- |
| Audio input latency | ≤ 20 ms | Device-dependent; measured during calibration |
| Analysis window + hop | ≤ 50 ms | 2048 window plus onset look-ahead; the bass window only confirms pitch |
| WebAssembly processing per hop | ≤ 2 ms | SIMD build, preallocated buffers |
| Visual feedback | ≤ 16 ms | One animation frame on a 60 Hz display |
| **Total, microphone** | **≤ 100 ms** | Feels immediate in wait mode; play-along shifts its scoring window by the measured latency |
| **Total, MIDI** | **≤ 30 ms** |  |

Play-along scoring windows: ±75 ms counts as on time, ±150 ms as early or late, beyond that as missed. Windows widen at slower tempos.

### Accuracy targets and test set

- Wait mode, single notes and 2–3 note chords between C2 and C7: at least 95% of correct notes accepted, at most 3% of wrong notes accepted.
- Dense chords (5+ notes) and very low bass: best effort in v1.0; the app shows a hint to switch to MIDI.
- Test set: recordings of contributors' acoustic and digital pianos on several iPads, plus a public piano dataset with aligned MIDI used only for offline evaluation, never shipped. Accuracy runs in CI on every change to the detector.

**Later option:** if the rule-based detector stalls below target, train a small onset model on the same features and run it with ONNX Runtime Web.

## 8. Import pipeline (private library)

Every import is converted on the user's device and saved to their private library; no file is ever uploaded for processing. All formats end up in one internal `Song` model, so the practice engine only knows one format.

| Format | Converter (runs in browser) | Result | Phase |
| --- | --- | --- | --- |
| MusicXML (.musicxml, .xml, .mxl) | Native parser; .mxl unzipped in browser | Full notation + practice | 1 |
| MIDI (.mid) | MIDI parser + quantiser + hand-split heuristic | Falling notes + practice in v1; notation view later | 1 |
| ABC notation (.abc) | Rendered by the notation engine | Full notation + practice; good for folk tunes | 2 |
| MuseScore (.mscz) | webmscore (MuseScore compiled to WebAssembly) → MusicXML, loaded only when needed | Full notation + practice; check support for MuseScore 4 files | 2 |
| PDF / photo of sheet music | Optical music recognition model run in browser (experimental) | Draft MusicXML the user corrects | 4 |
| Audio recording | Audio-to-MIDI model (e.g. Spotify's Basic Pitch) | Falling notes only, marked as approximate | 4 |

### The internal Song model

- **Notes:** pitch, start and length in beats, staff/hand, voice, tie, fingering if present.
- **Timing:** tempo map and time signatures, so practice modes convert beats to seconds and back.
- **Layout link:** each note's ID in the rendered score, so the cursor and colour feedback land on the right glyph.
- **Practice metadata:** chosen hand split, loop markers, tempo preference, best scores.

### Import review screen

After conversion the user sees a preview and can fix the common problems in one place:

- [ ] Hand split: swap staves, or move the split point for MIDI files.
- [ ] Tempo: set the base tempo when the file has none.
- [ ] Transpose: shift the key, e.g. to an easier one.
- [ ] Trim: drop intro bars or repeats.
- [ ] Title and tags: for the user's own organisation only.

### Rules for MIDI files

- Two tracks: left hand = lower average pitch.
- One track: split around middle C, adjusted so that each hand's line stays smooth.
- Quantise to the smallest note value that keeps 95% of notes within ±30 ms of their original timing.
- Drop drum channel 10 and non-piano programmes unless the user keeps them.

## 9. Public-domain catalogue pipeline

The home-page catalogue targets 150 verified pieces at beta and 300 at v1.0. All of them come from openly licensed transcriptions and pass an EU copyright-term check plus a human review. The main source is PDMX: 254,077 MusicXML scores, all CC-0 or public domain, with complexity and rating metadata ([paper](https://arxiv.org/html/2409.10831v2), [dataset](https://zenodo.org/records/15571083)).

| Source | Licence | Role |
| --- | --- | --- |
| [PDMX](https://zenodo.org/records/15571083) | CC-0 / Public Domain Mark | Bulk source; use only its `no_license_conflict` subset |
| OpenScore | CC0 | High-quality transcriptions of the classics |
| Mutopia Project | Public domain or Creative Commons (some require attribution) | Supplement; attribution stored and shown per piece |
| Project contributors | CC0 only, via pull request | Simplified beginner arrangements of public-domain tunes |

### Pipeline (a script in the repo, re-run on each catalogue release)

1. **Filter the metadata.** Keep PDMX entries in the `no_license_conflict` subset; about 12% of the full set have mismatched licence data ([dataset notes](https://zenodo.org/records/15571083)). Keep piano-only scores above a rating threshold.
2. **Check the EU copyright term.** Match the composer (and lyricist, if there are lyrics) to Wikidata death years. Keep only works whose creators died at least 71 years ago, so 1955 or earlier for a 2026 release, plus traditional or anonymous tunes. Drop lyrics when the lyricist can't be verified.
3. **Exclude protected editions.** Scholarly and first editions have their own protection in Germany under §§ 70/71 UrhG ([VG Musikedition](https://cms.vg-musikedition.de/uploads/ekd_webinar_2024_b4ba47fe6c.pdf)). Only keep files that are the uploader's own transcription released as CC0, never scans or copies of a publisher edition.
4. **Validate the file.** It must render in the notation engine, play back correctly and survive a round trip through the `Song` model; broken files are dropped automatically.
5. **Score the difficulty.** Combine PDMX's complexity score with the project's own measures: notes per second, largest hand stretch, number of simultaneous notes, key signature and rhythm complexity. Map the result to five levels.
6. **Review by a human.** A volunteer listens to the piece, checks the hand split and title, and sets `verified: true`. Budget about 10 minutes per piece.
7. **Publish.** Static `.mxl` files plus a JSON index, deployed to a CDN from the repo. Every piece gets a stable URL.

### Provenance record (one per piece, in the repo)

| Field | Example |
| --- | --- |
| `title` | Gymnopédie No. 1 |
| `composer`, `composer_death_year` | Erik Satie, 1925 |
| `transcriber` | PDMX uploader ID |
| `source_url`, `source_licence` | PDMX record link, CC0 |
| `eu_term_check` | pass, 2026-10-07 |
| `difficulty` | 2 of 5 |
| `reviewed_by`, `verified` | GitHub handle, true |

### Launch shortlist (well-known and public domain in the EU)

Für Elise, Gymnopédie No. 1, Clair de lune, The Entertainer, Maple Leaf Rag, Canon in D (simplified), Ode to Joy, In the Hall of the Mountain King, the Turkish March, Greensleeves, Minuet in G, the Arabesque No. 1, and traditional carols and folk songs as easy beginner pieces.

## 10. Private library: storage, sync and privacy

The library lives on the device by default and works with no account. Optional sync uploads only data encrypted on the device, so the server, and the operator, can never read which pieces a user has. That keeps the platform a blind storage provider, which also supports the legal position in section 2.

### Layers

| Layer | Technology | Holds | Account needed |
| --- | --- | --- | --- |
| On-device store | IndexedDB (via Dexie) + `navigator.storage.persist()` | Song files, `Song` models, progress, settings | No |
| Backup file | One-tap export of an encrypted `.zip` | Whole library + progress | No |
| Encrypted sync | Object storage + small sync API | Encrypted blobs and a version log | Yes |

### Encryption design

1. On first sync, the device creates a random 256-bit library key.
2. The user sets a sync passphrase; Argon2id (WebAssembly) turns it into a wrapping key, which encrypts the library key. Only the wrapped key goes to the server.
3. Each file and progress record is encrypted with AES-GCM (WebCrypto) before upload; file names and titles are encrypted too.
4. A new device downloads the wrapped key, asks for the passphrase and decrypts locally.
5. A printable recovery code is shown once. Lose both the passphrase and the code, and the data is gone; the UI says so plainly.

**What the server can see:** account email, number and size of blobs, timestamps. Nothing about content or titles.

### Accounts and limits

- Sign-in with passkeys or an email link; no passwords to store.
- Per-user quota of 250 MB to cap hosting cost; MusicXML files are typically well under 1 MB each.
- Account deletion removes all blobs at once.

### Data protection (GDPR) and German requirements

- [ ] Host sync storage in the EU.
- [ ] Privacy policy describing exactly the data above; no tracking cookies, so no cookie banner needed.
- [ ] No analytics by default; optional anonymous crash reports, opt-in.
- [ ] Impressum with the operator's contact details, including the notice-and-takedown address.
- [ ] Records of processing kept, even if minimal.

## 11. Roadmap and milestones

v1.0 is planned for August 2027, assuming about 8–10 hours a week alongside a full-time job, with December 2026 kept light. Each phase ends at a gate; if a gate fails, the next phase is re-planned before work continues.

*(Embedded roadmap not included in this copy — see [PLAN.md](../../PLAN.md) for the phases and gates.)*

Phase 0 is the gamble: it proves microphone recognition on an iPad before any app polish. If it misses the gate, v1.0 becomes MIDI-first, with the microphone marked as beta.

### Phase 0 task list (first six weeks)

- [ ] Pick a working name, check the domain and trademarks, create the GitHub organisation and monorepo.
- [ ] Record a test set: 20 short passages on one acoustic and one digital piano, captured on an iPad in Safari, with matching MIDI as the answer key.
- [ ] Build the AudioWorklet capture and a Rust/WebAssembly FFT + onset detector, running in Safari.
- [ ] Implement the expected-note test for single notes and 2–3 note chords; measure accuracy against the test set.
- [ ] Measure end-to-end latency on an older and a current iPad.
- [ ] Write the gate report: accuracy, latency, go or no-go.

## 12. Open-source governance, licensing, hosting and costs

The code is AGPL-3.0, so anyone hosting a modified version must share their changes. Catalogue metadata is CC0, and each piece keeps its own source licence. Running costs stay well under €30 a month until there are many sync users.

### Licences

| Part | Licence | Reason |
| --- | --- | --- |
| App, engine, importers | AGPL-3.0 | Stops a closed, paid fork hosted by someone else |
| Catalogue metadata and scripts | CC0 | Free reuse by teachers and other projects |
| Catalogue scores | Each piece's source licence (CC0 / public domain / CC BY) | Attribution shown on the piece page where required |
| Piano samples | An openly licensed grand-piano sample set; check its licence | Playback without licensing costs |
| Third-party libraries | Checked in CI (licence scanner) | Catches incompatible licences early, e.g. confirm webmscore's licence fits AGPL-3.0 before bundling |

### Repository layout (one monorepo)

| Path | Contents |
| --- | --- |
| `apps/web` | The web app (TypeScript) |
| `apps/ios-shell` | Capacitor wrapper + CoreMIDI plugin (phase 3) |
| `packages/engine` | Rust detection engine → WebAssembly |
| `packages/song-model` | `Song` model, MusicXML/MIDI parsers, quantiser |
| `packages/importers` | Lazy-loaded heavy converters (MuseScore, OMR, audio) |
| `catalogue/` | Public-domain `.mxl` files + provenance records |
| `tools/pipeline` | Python catalogue pipeline (PDMX filter, term check, difficulty) |

### Contribution rules

- Contributing guide, code of conduct, and a Developer Certificate of Origin sign-off on every commit.
- Catalogue pull requests use a template with every provenance field; CI rejects a piece with any field missing or a composer death year inside the EU term.
- Issues labelled `good first issue` for difficulty tagging, review of pieces and translations (English and German first).

### Hosting and running costs (approximate; check current prices before committing)

| Item | Choice | Approx. cost |
| --- | --- | --- |
| Web app + catalogue | Static hosting with a global CDN, free tier | €0 |
| Encrypted sync storage | EU object storage | €5–10 / month |
| Sync API | Small EU virtual server or serverless functions | €5 / month |
| Domain | Project domain | \~€15 / year |
| iPad app (phase 3) | Apple Developer Program | \~€99 / year |
| Legal check before launch | German copyright lawyer, one consultation | a few hundred euros, one-off |

Donations through an open collective cover running costs transparently; there is never a paid tier.

## 13. Risks, success metrics and open decisions

The biggest risk is technical, not legal: if microphone recognition on an iPad isn't reliable, the core experience fails. That's why phase 0 builds the detector before anything else.

### Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Microphone accuracy below target on iPad | Medium | High | Phase 0 prototype with a pass/fail gate; MIDI and the iPad shell as alternatives; wait mode tolerant by design |
| Safari deletes the local library | Medium | High | Home Screen prompt, `persist()`, backup file, encrypted sync |
| A catalogue piece turns out to be protected | Low | Medium | EU-term filter, provenance records, human review, takedown within 48 hours |
| The platform is seen as a piracy tool | Low | High | No sharing features, end-to-end encryption, public-domain-only marketing, lawyer review before launch |
| App Store rejects the iPad shell as a thin web wrapper | Medium | Medium | Native CoreMIDI feature gives it real added value; the microphone path still works without the app |
| Licence conflict in a dependency (e.g. MuseScore converter) | Medium | Low | Licence scanner in CI; ship as a separate optional module or drop .mscz support |
| Slow rendering on older iPads | Medium | Medium | Render only visible bars; device lab tests per release |
| Solo maintainer runs out of time | High | Medium | Strict phase scope, `good first issue` backlog, contributor docs from day one |

### Success metrics

| Metric | Target for v1.0 | How measured |
| --- | --- | --- |
| Microphone recognition, wait mode | ≥ 95% correct notes accepted, ≤ 3% wrong notes accepted | Test set in CI |
| Feedback latency | ≤ 100 ms microphone, ≤ 30 ms MIDI | Loopback test on reference devices |
| First piece played after opening the site | ≤ 2 minutes, no account | Usability tests with 5–8 beginners |
| Catalogue size | 300 verified pieces across 5 levels | Catalogue index |
| Browser coverage | All rows in section 5 pass the release checklist | Device lab |
| Community | 10+ external contributors in the first year | GitHub |

There is no tracking by default, so usage numbers come only from opt-in telemetry and public signals.

### Open decisions

- [ ] Project name and domain; check for trademark conflicts.
- [ ] Whether encrypted sync ships in v1.0 or right after it.
- [ ] Sign-in method: passkeys only, or passkeys plus email link.
- [ ] Timing of the legal consultation: before the beta or before v1.0.
- [ ] Whether to run the project as an individual or set up a non-profit association (e.V.) later, which limits personal liability.

## Sources

- [Web MIDI support status (web-features)](https://web-platform-dx.github.io/web-features-explorer/features/web-midi)
- [Web MIDI API browser support overview](https://www.testmuai.com/learning-hub/web-midi-api-browser-support/)
- [Safari-WebMIDI project (WebKit position)](https://github.com/triglav-modular/Safari-WebMIDI)
- [WebKit 7-day storage cap and Home Screen apps (The Register)](https://www.theregister.com/2020/03/26/apple_relax_were_not_totally/)
- [WebKit storage policy update](https://webkit.org/?p=14403)
- [PDMX paper](https://arxiv.org/html/2409.10831v2) and [PDMX dataset](https://zenodo.org/records/15571083)
- [VG Musikedition on § 53 Abs. 4a and §§ 70/71 UrhG](https://cms.vg-musikedition.de/uploads/ekd_webinar_2024_b4ba47fe6c.pdf)
- [CJEU YouTube/Cyando judgment summary](https://curia.europa.eu/jcms/jcms/p1_3562062/da)

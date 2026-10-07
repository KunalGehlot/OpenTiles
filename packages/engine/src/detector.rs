//! The score-informed detector: onsets in, accepted / rejected / wrong notes out.

use crate::config::{DetectorConfig, Mode, Thresholds};
use crate::onset::{OnsetDetector, OnsetParams};
use crate::pitch::{PIANO_HIGH, PIANO_LOW};
use crate::ring::Ring;
use crate::score::{PitchScore, Scorer, PRE_FRAMES};
use crate::spectrum::Spectrum;
use realfft::RealFftPlanner;

/// Most pitches that can be expected at once.
pub const MAX_EXPECTED: usize = 16;
/// Onsets whose decisions can be outstanding at once.
const MAX_PENDING: usize = 8;
/// Events buffered per [`Detector::process`] call; extra events are dropped and counted.
pub const MAX_EVENTS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum EventKind {
    /// An attack was detected (no pitch).
    Onset = 0,
    /// An expected pitch was heard.
    Expected = 1,
    /// A likely wrong pitch (neighbour or octave of an expected one) was clearly heard.
    Wrong = 2,
    /// An expected pitch was tested at an onset but not accepted (diagnostics).
    Rejected = 3,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Event {
    pub kind: EventKind,
    pub pitch: u8,
    /// Estimated onset time in seconds since the detector started.
    pub time: f64,
    /// Harmonic score of fresh energy, `0..=1`.
    pub confidence: f32,
    /// Odd-partial evidence, `0..=1` (diagnostics: low values mean "could be the octave above").
    pub odd: f32,
    /// When the decision was made, in seconds since the detector started.
    pub decided_at: f64,
    /// Value of the expected-set generation counter the decision used, so callers can ignore
    /// decisions about a step they have already left.
    pub generation: u32,
}

#[derive(Clone, Copy)]
struct Pending {
    onset: u64,
    expected: [u8; MAX_EXPECTED],
    count: usize,
    generation: u32,
    normal_at: u64,
    bass_at: u64,
    normal_done: bool,
    bass_done: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Band {
    Normal,
    Bass,
}

/// Spectra for one resolution: post-onset and pre-onset frames, and their difference.
struct BandSpectra {
    post: Spectrum,
    pre: [Spectrum; PRE_FRAMES],
    diff: Spectrum,
    frame: usize,
    max_bin: usize,
    room: Option<Vec<f32>>,
}

impl BandSpectra {
    fn new(frame: usize, cfg: &DetectorConfig, planner: &mut RealFftPlanner<f32>) -> BandSpectra {
        let sr = cfg.sample_rate;
        let bin_hz = sr / frame as f32;
        BandSpectra {
            post: Spectrum::new(frame, sr, planner),
            pre: std::array::from_fn(|_| Spectrum::new(frame, sr, planner)),
            diff: Spectrum::new(frame, sr, planner),
            frame,
            max_bin: ((cfg.max_partial_hz * 1.1 / bin_hz) as usize + 8).min(frame / 2 + 1),
            room: None,
        }
    }

    /// Analyses the frame ending at `now` and the pre-onset frames ending at `pre_end`,
    /// `pre_end - frame/2`, `pre_end - frame`, then prepares the scorer.
    fn prepare(&mut self, ring: &Ring, scorer: &mut Scorer, now: u64, pre_end: u64) {
        self.post.analyze(ring, now, self.max_bin);
        for (i, pre) in self.pre.iter_mut().enumerate() {
            let end = pre_end.saturating_sub((i * self.frame / 2) as u64);
            pre.analyze(ring, end, self.max_bin);
        }
        let [a, b, c] = &self.pre;
        scorer.prepare(&self.post, [a, b, c], &mut self.diff, self.room.as_deref());
    }
}

struct NoiseCalibration {
    frames: u32,
    normal: Vec<f64>,
    bass: Vec<f64>,
    onset_mag: Vec<f64>,
}

pub struct Detector {
    cfg: DetectorConfig,
    ring: Ring,
    onset_spec: Spectrum,
    normal: BandSpectra,
    bass: BandSpectra,
    onset: OnsetDetector,
    scorer: Scorer,
    expected: [u8; MAX_EXPECTED],
    expected_count: usize,
    generation: u32,
    pending: Vec<Pending>,
    hop_fill: usize,
    events: Vec<Event>,
    dropped_events: u32,
    onset_max_bin: usize,
    calibration: Option<NoiseCalibration>,
    tuning_estimate: f32,
    tuning_samples: u32,
}

impl Detector {
    pub fn new(sample_rate: f32) -> Detector {
        Detector::with_config(DetectorConfig::new(sample_rate))
    }

    pub fn with_config(cfg: DetectorConfig) -> Detector {
        let mut planner = RealFftPlanner::<f32>::new();
        let sr = cfg.sample_rate;
        let onset_spec = Spectrum::new(cfg.onset_frame, sr, &mut planner);
        let normal = BandSpectra::new(cfg.frame, &cfg, &mut planner);
        let bass = BandSpectra::new(cfg.bass_frame, &cfg, &mut planner);

        // History needed: the oldest bass pre-onset frame up to the bass decision.
        let history = cfg.bass_frame * (2 + PRE_FRAMES / 2)
            + cfg.seconds_to_samples(cfg.bass_decision_delay_s + cfg.pre_gap_s + 0.05) as usize;
        let ring = Ring::new(history);

        let onset_bin_hz = sr / cfg.onset_frame as f32;
        let k_lo = (40.0 / onset_bin_hz).floor() as usize;
        let k_hi = ((6000.0_f32.min(sr * 0.45)) / onset_bin_hz).ceil() as usize;
        let onset = OnsetDetector::new(OnsetParams {
            k_lo,
            k_hi,
            lag: 2,
            delta: cfg.onset_delta,
            mean_factor: cfg.onset_mean_factor,
            min_interval: cfg.seconds_to_samples(cfg.onset_min_interval_s),
            offset_samples: (cfg.onset_offset_hops * cfg.hop as f32).round() as u64,
            compression: cfg.compression,
        });

        let mut scorer = Scorer::new(
            cfg.bass_frame / 2 + 1,
            cfg.max_partials,
            cfg.bass_partials,
            cfg.bass_below,
            cfg.max_partial_hz,
        );
        scorer.retune(cfg.a4_hz, cfg.tuning_cents);

        Detector {
            onset_max_bin: k_hi + 2,
            cfg,
            ring,
            onset_spec,
            normal,
            bass,
            onset,
            scorer,
            expected: [0; MAX_EXPECTED],
            expected_count: 0,
            generation: 0,
            pending: Vec::with_capacity(MAX_PENDING),
            hop_fill: 0,
            events: Vec::with_capacity(MAX_EVENTS),
            dropped_events: 0,
            calibration: None,
            tuning_estimate: 0.0,
            tuning_samples: 0,
        }
    }

    pub fn config(&self) -> &DetectorConfig {
        &self.cfg
    }

    /// Seconds of audio processed so far.
    pub fn time(&self) -> f64 {
        self.ring.written() as f64 / self.cfg.sample_rate as f64
    }

    /// Sets the pitches expected from now on and bumps the generation counter. Out-of-range
    /// and duplicate pitches are ignored; at most [`MAX_EXPECTED`] are kept.
    pub fn set_expected(&mut self, pitches: &[u8]) {
        self.expected_count = 0;
        for &p in pitches {
            if !(PIANO_LOW..=PIANO_HIGH).contains(&p) {
                continue;
            }
            if self.expected[..self.expected_count].contains(&p) {
                continue;
            }
            if self.expected_count == MAX_EXPECTED {
                break;
            }
            self.expected[self.expected_count] = p;
            self.expected_count += 1;
        }
        self.generation = self.generation.wrapping_add(1);
    }

    pub fn expected(&self) -> &[u8] {
        &self.expected[..self.expected_count]
    }

    pub fn generation(&self) -> u32 {
        self.generation
    }

    pub fn set_mode(&mut self, mode: Mode) {
        self.cfg.mode = mode;
        self.cfg.thresholds = Thresholds::for_mode(mode);
    }

    pub fn set_thresholds(&mut self, t: Thresholds) {
        self.cfg.thresholds = t;
    }

    /// Sets the instrument's tuning offset in cents (from calibration).
    pub fn set_tuning(&mut self, cents: f32) {
        self.cfg.tuning_cents = cents.clamp(-100.0, 100.0);
        self.tuning_estimate = 0.0;
        self.tuning_samples = 0;
        self.scorer.retune(self.cfg.a4_hz, self.cfg.tuning_cents);
    }

    /// Estimated tuning of the instrument in cents, from how far accepted notes' partials sit
    /// from the model. The calibration flow reads this and applies it with
    /// [`Detector::set_tuning`].
    pub fn tuning_estimate(&self) -> f32 {
        self.cfg.tuning_cents + self.tuning_estimate
    }

    /// Starts measuring the room's noise floor. Keep the room quiet until
    /// [`Detector::end_noise_calibration`].
    pub fn begin_noise_calibration(&mut self) {
        self.calibration = Some(NoiseCalibration {
            frames: 0,
            normal: vec![0.0; self.normal.post.bins()],
            bass: vec![0.0; self.bass.post.bins()],
            onset_mag: vec![0.0; self.onset_spec.bins()],
        });
    }

    /// Stores the measured noise floor and adapts onset compression to the room's level.
    /// Returns the median per-bin noise level in dB.
    pub fn end_noise_calibration(&mut self) -> f32 {
        let Some(cal) = self.calibration.take() else {
            return f32::NAN;
        };
        if cal.frames == 0 {
            return f32::NAN;
        }
        let n = cal.frames as f64;
        let to_db = |v: &Vec<f64>| -> Vec<f32> {
            v.iter()
                .map(|&p| (10.0 * (p / n + 1e-20).log10()) as f32)
                .collect()
        };
        self.normal.room = Some(to_db(&cal.normal));
        self.bass.room = Some(to_db(&cal.bass));
        let mut mags: Vec<f64> = cal.onset_mag[..self.onset_max_bin.min(cal.onset_mag.len())]
            .iter()
            .map(|m| m / n)
            .collect();
        mags.sort_by(|a, b| a.total_cmp(b));
        let median = mags.get(mags.len() / 2).copied().unwrap_or(1e-4).max(1e-7);
        // Map the room noise to ~0.1 before the log so noise stays near zero flux.
        let compression = (0.1 / median).clamp(10.0, 1e6) as f32;
        self.cfg.compression = compression;
        self.onset.set_compression(compression);
        (20.0 * median.log10()) as f32
    }

    /// Feeds samples (mono, `-1..=1`). Events produced by this call are available from
    /// [`Detector::events`] until the next call.
    pub fn process(&mut self, input: &[f32]) {
        self.events.clear();
        for &x in input {
            let x = if x.is_finite() { x } else { 0.0 };
            self.ring.push(x);
            self.hop_fill += 1;
            if self.hop_fill >= self.cfg.hop {
                self.hop_fill = 0;
                self.on_hop();
            }
        }
    }

    pub fn events(&self) -> &[Event] {
        &self.events
    }

    /// Events dropped because a single [`Detector::process`] call produced more than
    /// [`MAX_EVENTS`].
    pub fn dropped_events(&self) -> u32 {
        self.dropped_events
    }

    fn emit(&mut self, e: Event) {
        if self.events.len() < MAX_EVENTS {
            self.events.push(e);
        } else {
            self.dropped_events = self.dropped_events.saturating_add(1);
        }
    }

    fn seconds(&self, sample: u64) -> f64 {
        sample as f64 / self.cfg.sample_rate as f64
    }

    fn on_hop(&mut self) {
        let end = self.ring.written();
        self.onset_spec.analyze(&self.ring, end, self.onset_max_bin);

        if self.calibration.is_some() {
            self.calibrate_step(end);
            return;
        }

        if let Some(onset) = self.onset.step(&self.onset_spec.mag, end) {
            self.emit(Event {
                kind: EventKind::Onset,
                pitch: 0,
                time: self.seconds(onset),
                confidence: 1.0,
                odd: 1.0,
                decided_at: self.seconds(end),
                generation: self.generation,
            });
            if self.expected_count > 0 {
                let has_bass = self.expected().iter().any(|&p| p < self.cfg.bass_below);
                let has_normal = self.expected().iter().any(|&p| p >= self.cfg.bass_below);
                let p = Pending {
                    onset,
                    expected: self.expected,
                    count: self.expected_count,
                    generation: self.generation,
                    normal_at: onset + self.cfg.seconds_to_samples(self.cfg.decision_delay_s),
                    bass_at: onset + self.cfg.seconds_to_samples(self.cfg.bass_decision_delay_s),
                    normal_done: !has_normal,
                    bass_done: !has_bass,
                };
                if self.pending.len() == MAX_PENDING {
                    self.pending.remove(0);
                }
                self.pending.push(p);
            }
        }

        let mut i = 0;
        while i < self.pending.len() {
            let p = self.pending[i];
            if !p.normal_done && end >= p.normal_at {
                self.decide(&p, Band::Normal, end);
                self.pending[i].normal_done = true;
            }
            if !p.bass_done && end >= p.bass_at {
                self.decide(&p, Band::Bass, end);
                self.pending[i].bass_done = true;
            }
            if self.pending[i].normal_done && self.pending[i].bass_done {
                self.pending.remove(i);
            } else {
                i += 1;
            }
        }
    }

    fn calibrate_step(&mut self, end: u64) {
        self.normal
            .post
            .analyze(&self.ring, end, self.normal.max_bin);
        self.bass.post.analyze(&self.ring, end, self.bass.max_bin);
        if let Some(cal) = self.calibration.as_mut() {
            cal.frames += 1;
            for (acc, m) in cal.normal.iter_mut().zip(&self.normal.post.mag) {
                *acc += (*m as f64) * (*m as f64);
            }
            for (acc, m) in cal.bass.iter_mut().zip(&self.bass.post.mag) {
                *acc += (*m as f64) * (*m as f64);
            }
            for (acc, m) in cal.onset_mag.iter_mut().zip(&self.onset_spec.mag) {
                *acc += *m as f64;
            }
        }
    }

    fn decide(&mut self, p: &Pending, band: Band, now: u64) {
        let pre_end = p
            .onset
            .saturating_sub(self.cfg.seconds_to_samples(self.cfg.pre_gap_s));
        let spectra = match band {
            Band::Normal => &mut self.normal,
            Band::Bass => &mut self.bass,
        };
        spectra.prepare(&self.ring, &mut self.scorer, now, pre_end);
        let (post, diff) = match band {
            Band::Normal => (&self.normal.post, &self.normal.diff),
            Band::Bass => (&self.bass.post, &self.bass.diff),
        };

        let th = self.cfg.thresholds;
        let bass_below = self.cfg.bass_below;
        let expected = &p.expected[..p.count];
        let time = self.seconds(p.onset);
        let decided_at = self.seconds(now);
        let mut out = [None::<Event>; MAX_EXPECTED * 2];
        let mut n_out = 0usize;
        let mut wrong = [(0u8, 0.0f32, 0.0f32); MAX_EXPECTED * 6];
        let mut n_wrong = 0usize;
        let mut tuning_sum = 0.0f32;
        let mut tuning_n = 0u32;

        for &e in expected {
            if (e < bass_below) != (band == Band::Bass) {
                continue;
            }
            let se = self.scorer.score(post, diff, e, expected);
            let mut accept = se.score >= th.accept;

            // Octave below: every partial of `e` is also an (even) partial of the note an octave
            // lower, so `e`'s own evidence can't rule it out. The lower note's odd partials can:
            // fresh energy there means it was played. Spectrally, "the octave below alone" and
            // "both notes" are nearly indistinguishable, so `e` is not accepted at that onset;
            // playing the extra note is a mistake anyway.
            if e >= PIANO_LOW + 12 && !expected.contains(&(e - 12)) {
                let low = e - 12;
                let sl = self.scorer.score(post, diff, low, expected);
                if sl.odd >= th.octave_below {
                    push_wrong(&mut wrong, &mut n_wrong, low, sl.odd, sl.odd);
                    accept = false;
                }
            }
            // Neighbouring semitones and tones.
            for d in [-2i16, -1, 1, 2] {
                let w = e as i16 + d;
                if w < PIANO_LOW as i16 || w > PIANO_HIGH as i16 || expected.contains(&(w as u8)) {
                    continue;
                }
                let sw = self.scorer.score(post, diff, w as u8, expected);
                if is_wrong(&sw, &se, th) {
                    push_wrong(&mut wrong, &mut n_wrong, w as u8, sw.score, sw.odd);
                }
            }
            // Octave above: fully explained by `e` when `e` sounds, so only a candidate when `e`
            // was not accepted.
            if !accept && e + 12 <= PIANO_HIGH && !expected.contains(&(e + 12)) {
                let sa = self.scorer.score(post, diff, e + 12, expected);
                if sa.score >= th.wrong {
                    push_wrong(&mut wrong, &mut n_wrong, e + 12, sa.score, sa.odd);
                }
            }

            if accept && se.score > 0.5 {
                tuning_sum += se.dev_cents;
                tuning_n += 1;
            }
            out[n_out] = Some(Event {
                kind: if accept {
                    EventKind::Expected
                } else {
                    EventKind::Rejected
                },
                pitch: e,
                time,
                confidence: se.score,
                odd: se.odd,
                decided_at,
                generation: p.generation,
            });
            n_out += 1;
        }
        for &(pitch, score, odd) in &wrong[..n_wrong] {
            if n_out == out.len() {
                break;
            }
            out[n_out] = Some(Event {
                kind: EventKind::Wrong,
                pitch,
                time,
                confidence: score,
                odd,
                decided_at,
                generation: p.generation,
            });
            n_out += 1;
        }
        for e in out.iter().take(n_out).flatten() {
            self.emit(*e);
        }
        if tuning_n > 0 {
            let dev = tuning_sum / tuning_n as f32;
            let alpha = if self.tuning_samples < 20 { 0.2 } else { 0.05 };
            self.tuning_estimate += alpha * (dev - self.tuning_estimate);
            self.tuning_samples = self.tuning_samples.saturating_add(1);
        }
    }
}

fn is_wrong(sw: &PitchScore, se: &PitchScore, th: Thresholds) -> bool {
    sw.score >= th.wrong && sw.score > se.score + th.wrong_margin
}

fn push_wrong(list: &mut [(u8, f32, f32)], n: &mut usize, pitch: u8, score: f32, odd: f32) {
    if let Some(existing) = list[..*n].iter_mut().find(|w| w.0 == pitch) {
        existing.1 = existing.1.max(score);
        return;
    }
    if *n < list.len() {
        list[*n] = (pitch, score, odd);
        *n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::{render, SynthNote, SynthOptions};

    fn note(pitch: u8, onset_s: f32) -> SynthNote {
        SynthNote {
            pitch,
            onset_s,
            duration_s: 0.6,
            velocity: 0.7,
        }
    }

    /// Runs `notes` through a detector expecting `expected` and returns the events.
    fn run(notes: &[SynthNote], expected: &[u8], seed: u64) -> Vec<Event> {
        let opts = SynthOptions {
            seed,
            ..SynthOptions::default()
        };
        let audio = render(notes, 1.2, &opts);
        let mut d = Detector::new(48000.0);
        d.set_expected(expected);
        let mut events = Vec::new();
        for chunk in audio.chunks(128) {
            d.process(chunk);
            events.extend_from_slice(d.events());
        }
        events
    }

    fn accepted(events: &[Event]) -> Vec<u8> {
        events
            .iter()
            .filter(|e| e.kind == EventKind::Expected)
            .map(|e| e.pitch)
            .collect()
    }

    fn wrong(events: &[Event]) -> Vec<u8> {
        events
            .iter()
            .filter(|e| e.kind == EventKind::Wrong)
            .map(|e| e.pitch)
            .collect()
    }

    #[test]
    fn accepts_the_expected_note() {
        let ev = run(&[note(60, 0.3)], &[60], 1);
        assert_eq!(accepted(&ev), vec![60]);
        assert!(wrong(&ev).is_empty());
        let onset = ev.iter().find(|e| e.kind == EventKind::Expected).unwrap();
        assert!((onset.time - 0.3).abs() < 0.02, "onset at {}", onset.time);
    }

    #[test]
    fn accepts_a_chord() {
        let ev = run(
            &[note(60, 0.3), note(64, 0.3), note(67, 0.3)],
            &[60, 64, 67],
            2,
        );
        let mut a = accepted(&ev);
        a.sort();
        assert_eq!(a, vec![60, 64, 67]);
    }

    #[test]
    fn rejects_and_reports_a_semitone_neighbour() {
        let ev = run(&[note(61, 0.3)], &[60], 3);
        assert!(accepted(&ev).is_empty());
        assert_eq!(wrong(&ev), vec![61]);
    }

    #[test]
    fn rejects_the_octave_above_and_below() {
        let ev = run(&[note(72, 0.3)], &[60], 4);
        assert!(accepted(&ev).is_empty(), "octave above accepted");
        assert!(wrong(&ev).contains(&72));
        let ev = run(&[note(48, 0.3)], &[60], 5);
        assert!(accepted(&ev).is_empty(), "octave below accepted");
        assert!(wrong(&ev).contains(&48));
    }

    #[test]
    fn a_ringing_note_is_not_accepted_again() {
        // C4 is played, then E4. With C4 expected again at the E4 onset, the still-ringing C4
        // must not count.
        let opts = SynthOptions {
            seed: 6,
            sustain_pedal: true,
            ..SynthOptions::default()
        };
        let audio = render(&[note(60, 0.2), note(64, 0.6)], 1.2, &opts);
        let mut d = Detector::new(48000.0);
        let split = (0.5 * 48000.0) as usize;
        d.process(&audio[..split]);
        d.set_expected(&[60]);
        let mut events = Vec::new();
        for chunk in audio[split..].chunks(128) {
            d.process(chunk);
            events.extend_from_slice(d.events());
        }
        assert!(accepted(&events).is_empty());
    }

    #[test]
    fn processing_does_not_allocate_events_beyond_capacity() {
        let d = Detector::new(44100.0);
        assert_eq!(d.events.capacity(), MAX_EVENTS);
        assert!(d.config().frame == 2048 && d.config().bass_frame == 4096);
    }
}

#[cfg(test)]
mod probe {
    //! Diagnostics for tuning. Run with
    //! `PROBE_DELTA=-12 [PROBE_PEDAL=1] cargo test --release -p opentiles-engine probe -- --ignored --nocapture`.
    use super::*;
    use crate::eval::{group_chords, TruthNote};
    use crate::pitch::note_name;
    use crate::synth::{random_passage, render, PassageOptions, Rng, SynthOptions};

    /// Re-scores the decisions of a synthetic passage with one expected pitch per chord moved by
    /// `delta` semitones and prints the cases that would be accepted (or, for `delta == 0`, the
    /// correct notes that would be rejected).
    fn passage_failures(seed: u64, pedal: bool, delta: i16, max_print: usize) {
        let opts = SynthOptions {
            seed,
            sustain_pedal: pedal,
            ..SynthOptions::default()
        };
        let mut rng = Rng::new(seed * 7919);
        let (notes, length) = random_passage(&mut rng, &PassageOptions::default());
        let audio = render(&notes, length, &opts);
        let truth: Vec<_> = notes
            .iter()
            .map(|n| TruthNote {
                onset_s: n.onset_s,
                pitch: n.pitch,
            })
            .collect();
        let chords = group_chords(&truth, 0.04);
        let mut printed = 0;
        for (i, c) in chords.iter().enumerate() {
            let idx = i % c.pitches.len();
            let target = c.pitches[idx] as i16 + delta;
            if delta != 0 && (!(21..=108).contains(&target) || c.pitches.contains(&(target as u8)))
            {
                continue;
            }
            let mut expected = c.pitches.clone();
            expected[idx] = target as u8;
            let e = target as u8;
            let mut d = Detector::new(48000.0);
            let bass = e < d.cfg.bass_below;
            let delay = if bass {
                d.cfg.bass_decision_delay_s
            } else {
                d.cfg.decision_delay_s
            };
            let stop = (((c.onset_s + delay) * 48000.0) as usize).min(audio.len());
            for chunk in audio[..stop].chunks(256) {
                d.process(chunk);
            }
            let onset = (c.onset_s * 48000.0) as u64;
            let now = d.ring.written();
            let spectra = if bass { &mut d.bass } else { &mut d.normal };
            spectra.prepare(&d.ring, &mut d.scorer, now, onset - 240);
            let (post, diff) = if bass {
                (&d.bass.post, &d.bass.diff)
            } else {
                (&d.normal.post, &d.normal.diff)
            };
            let s = d.scorer.score(post, diff, e, &expected);
            let accepted = s.score >= d.cfg.thresholds.accept;
            if accepted == (delta != 0) && printed < max_print {
                printed += 1;
                let names: Vec<String> = c.pitches.iter().map(|&p| note_name(p)).collect();
                let exp: Vec<String> = expected.iter().map(|&p| note_name(p)).collect();
                println!(
                    "played {:?} expected {:?} target {} score {:.2} all {:.2} odd {:.2}",
                    names,
                    exp,
                    note_name(e),
                    s.score,
                    s.all,
                    s.odd
                );
            }
        }
    }

    #[test]
    #[ignore]
    fn print_passage_failures() {
        let delta: i16 = std::env::var("PROBE_DELTA")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(-12);
        let pedal = std::env::var("PROBE_PEDAL").is_ok();
        for seed in 1..4 {
            passage_failures(if pedal { seed + 10 } else { seed }, pedal, delta, 12);
        }
    }
}

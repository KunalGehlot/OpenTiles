//! Detector configuration and per-mode thresholds.

/// Practice mode the detector is tuned for (spec §7, step 6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Mode {
    /// Errs towards accepting: a missed correct note stalls the learner.
    Wait = 0,
    /// Errs towards precision: a wrongly accepted note inflates the score.
    PlayAlong = 1,
}

impl Mode {
    pub fn from_u32(v: u32) -> Mode {
        if v == 1 {
            Mode::PlayAlong
        } else {
            Mode::Wait
        }
    }
}

/// Decision thresholds. Scores are in `0..=1` and measured on the fresh-energy spectrum, so they
/// already require the note to have just been played.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Thresholds {
    /// Minimum score for an expected note to be accepted.
    pub accept: f32,
    /// Minimum score for a likely wrong note to be reported.
    pub wrong: f32,
    /// A neighbouring wrong note must beat the expected note's score by this much.
    pub wrong_margin: f32,
    /// Odd-partial evidence for the note an octave below the expected one that counts as "it was
    /// played". Lower than `wrong` because a correctly played note leaves nothing there.
    pub octave_below: f32,
}

impl Thresholds {
    pub fn for_mode(mode: Mode) -> Thresholds {
        match mode {
            Mode::Wait => Thresholds {
                accept: 0.25,
                wrong: 0.45,
                wrong_margin: 0.10,
                octave_below: 0.25,
            },
            Mode::PlayAlong => Thresholds {
                accept: 0.40,
                wrong: 0.40,
                wrong_margin: 0.05,
                octave_below: 0.25,
            },
        }
    }
}

/// Everything the detector needs to know up front. Built with [`DetectorConfig::new`] and then
/// adjusted field by field if needed (the Detector Lab exposes most of these).
#[derive(Clone, Debug)]
pub struct DetectorConfig {
    pub sample_rate: f32,
    /// Samples between analysis steps (~5 ms).
    pub hop: usize,
    /// FFT size for onset detection (~21 ms at 48 kHz).
    pub onset_frame: usize,
    /// FFT size for the expected-note test (2048 at 44.1/48 kHz).
    pub frame: usize,
    /// FFT size for pitches below [`DetectorConfig::bass_below`] (4096 at 44.1/48 kHz).
    pub bass_frame: usize,
    /// Pitches below this MIDI number use the bass frame (C3 = 48).
    pub bass_below: u8,
    /// Partials examined per pitch (spec: 6–8).
    pub max_partials: usize,
    /// Partials examined for bass pitches, whose partials are dense and individually weak.
    pub bass_partials: usize,
    /// Partials above this frequency are ignored.
    pub max_partial_hz: f32,
    /// Seconds after an onset at which the normal-resolution decision is made.
    pub decision_delay_s: f32,
    /// Seconds after an onset at which the bass decision is made.
    pub bass_decision_delay_s: f32,
    /// The latest pre-onset reference frame ends this many seconds before the onset.
    pub pre_gap_s: f32,
    /// Spectral-flux onset threshold above the running mean.
    pub onset_delta: f32,
    /// Multiplier on the running mean flux in the onset threshold.
    pub onset_mean_factor: f32,
    /// Minimum time between two onsets.
    pub onset_min_interval_s: f32,
    /// Onset time = end of the peak flux frame minus this many hops.
    pub onset_offset_hops: f32,
    /// Log compression for onset detection: `ln(1 + compression · |X|)`.
    pub compression: f32,
    /// Concert pitch.
    pub a4_hz: f32,
    /// Instrument tuning offset in cents (set by calibration).
    pub tuning_cents: f32,
    pub mode: Mode,
    pub thresholds: Thresholds,
}

impl DetectorConfig {
    /// Defaults for a sample rate. Frame sizes scale with the rate so the time windows stay the
    /// same (2048 / 4096 samples at 44.1 and 48 kHz).
    pub fn new(sample_rate: f32) -> DetectorConfig {
        let sample_rate = if sample_rate.is_finite() && sample_rate >= 8000.0 {
            sample_rate
        } else {
            48000.0
        };
        let frame = ((sample_rate * 0.040) as usize).next_power_of_two();
        DetectorConfig {
            sample_rate,
            hop: frame / 8,
            onset_frame: frame / 2,
            frame,
            bass_frame: frame * 2,
            bass_below: 48,
            max_partials: 8,
            bass_partials: 12,
            max_partial_hz: 8000.0_f32.min(sample_rate * 0.45),
            decision_delay_s: 0.036,
            bass_decision_delay_s: 0.066,
            pre_gap_s: 0.005,
            onset_delta: 0.035,
            onset_mean_factor: 1.5,
            onset_min_interval_s: 0.040,
            onset_offset_hops: 2.3,
            compression: 1000.0,
            a4_hz: 440.0,
            tuning_cents: 0.0,
            mode: Mode::Wait,
            thresholds: Thresholds::for_mode(Mode::Wait),
        }
    }

    pub fn with_mode(mut self, mode: Mode) -> DetectorConfig {
        self.mode = mode;
        self.thresholds = Thresholds::for_mode(mode);
        self
    }

    pub fn seconds_to_samples(&self, s: f32) -> u64 {
        (s.max(0.0) * self.sample_rate).round() as u64
    }
}

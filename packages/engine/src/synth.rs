//! A small piano-like synthesiser for the synthetic test set.
//!
//! It is deliberately imperfect but captures what makes piano detection hard: stretched
//! (inharmonic) partials with random strengths, weak bass fundamentals, beating between strings,
//! decaying tones ringing under the sustain pedal, hammer noise, room noise and a microphone that
//! loses low frequencies. Results on it are a smoke test; the Phase 0 gate uses real recordings.

use crate::pitch::{inharmonicity, midi_to_hz, partial_hz};
use std::f32::consts::PI;

/// Deterministic xorshift64* generator, so test runs are reproducible.
#[derive(Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in `[0, 1)`.
    pub fn f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f32()
    }

    pub fn int(&mut self, lo: i32, hi_inclusive: i32) -> i32 {
        lo + (self.next_u64() % ((hi_inclusive - lo + 1) as u64)) as i32
    }

    /// Standard normal (Box–Muller).
    pub fn normal(&mut self) -> f32 {
        let u1 = self.f32().max(1e-7);
        let u2 = self.f32();
        (-2.0 * u1.ln()).sqrt() * (2.0 * PI * u2).cos()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SynthNote {
    pub pitch: u8,
    pub onset_s: f32,
    /// Key-down time; with the pedal down the note keeps ringing afterwards.
    pub duration_s: f32,
    /// `0..=1`.
    pub velocity: f32,
}

#[derive(Clone, Debug)]
pub struct SynthOptions {
    pub sample_rate: f32,
    /// Broadband room noise level (RMS, dBFS).
    pub noise_dbfs: f32,
    /// Sustain pedal held throughout.
    pub sustain_pedal: bool,
    /// Each note's inharmonicity is the model value times a factor in this range.
    pub inharmonicity_scale: (f32, f32),
    /// Whole-instrument tuning offset in cents.
    pub tuning_cents: f32,
    /// Random per-note detuning, ± cents.
    pub detune_cents: f32,
    /// Peak level of a full-velocity note (dBFS).
    pub level_dbfs: f32,
    /// Microphone high-pass corner.
    pub highpass_hz: f32,
    pub seed: u64,
}

impl Default for SynthOptions {
    fn default() -> SynthOptions {
        SynthOptions {
            sample_rate: 48000.0,
            noise_dbfs: -62.0,
            sustain_pedal: false,
            inharmonicity_scale: (0.6, 1.6),
            tuning_cents: 0.0,
            detune_cents: 4.0,
            level_dbfs: -12.0,
            highpass_hz: 90.0,
            seed: 1,
        }
    }
}

fn db_to_amp(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Renders `notes` into a mono buffer of `length_s` seconds.
pub fn render(notes: &[SynthNote], length_s: f32, opts: &SynthOptions) -> Vec<f32> {
    let sr = opts.sample_rate;
    let len = (length_s * sr) as usize;
    let mut out = vec![0.0f32; len];
    let mut rng = Rng::new(opts.seed);
    let nyquist_limit = (sr * 0.45).min(12000.0);
    let level = db_to_amp(opts.level_dbfs);

    for (i, note) in notes.iter().enumerate() {
        let start = (note.onset_s * sr) as usize;
        if start >= len {
            continue;
        }
        // A string can only vibrate once: striking the same key again replaces the ringing tone
        // rather than adding a second, randomly phased copy of it.
        let restrike = notes
            .iter()
            .skip(i + 1)
            .filter(|n| n.pitch == note.pitch && n.onset_s > note.onset_s)
            .map(|n| n.onset_s)
            .fold(f32::INFINITY, f32::min);
        let vel = note.velocity.clamp(0.05, 1.0);
        let detune = rng.range(-opts.detune_cents, opts.detune_cents) + opts.tuning_cents;
        let f0 = midi_to_hz(note.pitch as f32, 440.0, detune);
        let b = inharmonicity(note.pitch)
            * rng.range(opts.inharmonicity_scale.0, opts.inharmonicity_scale.1);
        // Louder notes are brighter.
        let alpha = 1.5 - 0.7 * vel + rng.range(-0.15, 0.15);
        // Low notes ring longer.
        let tau0 = (4.0 * 2f32.powf(-(note.pitch as f32 - 36.0) / 24.0)).clamp(0.35, 4.0);
        let key_up = note.onset_s + note.duration_s;
        // With the pedal down, notes ring for up to 2.5 s and then fade out smoothly (rendering
        // every note to the end of the passage would be slow and adds nothing to the test).
        let ring_s = if opts.sustain_pedal {
            (length_s - note.onset_s).min(2.5)
        } else {
            note.duration_s + 0.4
        };
        let ring_s = ring_s.min(restrike - note.onset_s + 0.01);
        let end = len.min(start + (ring_s.max(0.02) * sr) as usize);
        let release_start = ((key_up * sr) as usize).max(start);
        let amp_note = level * vel.powf(1.2);

        let mut n = 1usize;
        loop {
            let f = partial_hz(f0, n, b);
            if f >= nyquist_limit || n > 24 {
                break;
            }
            let mut a = (n as f32).powf(-alpha) * db_to_amp(rng.normal() * 3.0);
            if note.pitch < 52 {
                // Thin fundamentals in the bass.
                if n == 1 {
                    a *= 0.35;
                } else if n == 2 {
                    a *= 0.7;
                }
            }
            let tau = tau0 / (1.0 + 0.18 * (n as f32 - 1.0));
            let strings = if note.pitch >= 34 && n <= 6 { 2 } else { 1 };
            for s in 0..strings {
                let beat_cents = if strings == 2 {
                    rng.range(0.2, 1.2) * if s == 0 { 1.0 } else { -1.0 }
                } else {
                    0.0
                };
                let fs = f * 2f32.powf(beat_cents / 1200.0);
                let amp = amp_note * a / strings as f32;
                add_partial(
                    &mut out,
                    start,
                    end,
                    release_start,
                    fs,
                    amp,
                    tau,
                    sr,
                    &mut rng,
                    opts,
                );
            }
            n += 1;
        }

        // Hammer noise: a short, decaying broadband burst.
        let burst = (0.012 * sr) as usize;
        let hammer = amp_note * 0.08;
        for i in 0..burst.min(len - start) {
            let env = (-(i as f32) / (0.003 * sr)).exp();
            out[start + i] += hammer * env * rng.normal();
        }
    }

    // Room noise: mix of white and low-passed (pinkish) noise.
    let noise_amp = db_to_amp(opts.noise_dbfs);
    let mut lp = 0.0f32;
    for x in out.iter_mut() {
        let w = rng.normal();
        lp = 0.98 * lp + 0.02 * rng.normal() * 7.0;
        *x += noise_amp * 0.7 * (w + lp);
    }

    // Microphone low-frequency roll-off (first-order high-pass).
    let rc = 1.0 / (2.0 * PI * opts.highpass_hz);
    let dt = 1.0 / sr;
    let k = rc / (rc + dt);
    let (mut prev_x, mut prev_y) = (0.0f32, 0.0f32);
    for x in out.iter_mut() {
        let y = k * (prev_y + *x - prev_x);
        prev_x = *x;
        prev_y = y;
        *x = y.clamp(-1.0, 1.0);
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn add_partial(
    out: &mut [f32],
    start: usize,
    end: usize,
    release_start: usize,
    freq: f32,
    amp: f32,
    tau: f32,
    sr: f32,
    rng: &mut Rng,
    opts: &SynthOptions,
) {
    // Phasor recurrence: cheap and accurate enough over a few seconds with renormalisation.
    let w = 2.0 * PI * freq / sr;
    let (rot_re, rot_im) = (w.cos() as f64, w.sin() as f64);
    let phase = rng.range(0.0, 2.0 * PI) as f64;
    let (mut re, mut im) = (phase.cos(), phase.sin());
    let decay = (-1.0 / (tau * sr)).exp() as f64;
    let release_decay = (-1.0 / (0.08 * sr)).exp() as f64;
    let attack = (0.002 * sr).max(1.0) as usize;
    let fade = ((0.01 * sr) as usize).min((end - start) / 2).max(1);
    let fade_start = end - fade;
    let mut env = amp as f64;
    for (i, sample) in out[start..end].iter_mut().enumerate() {
        let idx = start + i;
        let mut a = if i < attack {
            env * (i as f64 / attack as f64)
        } else {
            env
        };
        if idx >= fade_start {
            a *= (end - idx) as f64 / fade as f64;
        }
        *sample += (a * im) as f32;
        let nre = re * rot_re - im * rot_im;
        let nim = re * rot_im + im * rot_re;
        re = nre;
        im = nim;
        if i % 1024 == 0 {
            let norm = (re * re + im * im).sqrt();
            re /= norm;
            im /= norm;
        }
        env *= if !opts.sustain_pedal && idx >= release_start {
            release_decay
        } else {
            decay
        };
    }
}

#[derive(Clone, Debug)]
pub struct PassageOptions {
    pub chords: usize,
    pub low: u8,
    pub high: u8,
    pub max_chord: usize,
    pub min_gap_s: f32,
    pub max_gap_s: f32,
}

impl Default for PassageOptions {
    fn default() -> PassageOptions {
        PassageOptions {
            chords: 40,
            low: 36,
            high: 96,
            max_chord: 3,
            min_gap_s: 0.30,
            max_gap_s: 0.80,
        }
    }
}

/// A random passage of single notes and 2–3 note chords (spans up to an octave), starting at
/// 0.3 s. Returns the notes and the passage length in seconds.
pub fn random_passage(rng: &mut Rng, opts: &PassageOptions) -> (Vec<SynthNote>, f32) {
    let mut notes = Vec::new();
    let mut t = 0.3f32;
    const INTERVALS: [u8; 7] = [3, 4, 5, 7, 8, 9, 12];
    for _ in 0..opts.chords {
        let size = match rng.f32() {
            x if x < 0.5 => 1,
            x if x < 0.8 => 2,
            _ => 3,
        }
        .min(opts.max_chord);
        let root = rng.int(opts.low as i32, opts.high as i32) as u8;
        let mut pitches = vec![root];
        while pitches.len() < size {
            let top = *pitches.iter().max().unwrap_or(&root);
            let iv = INTERVALS[rng.int(0, INTERVALS.len() as i32 - 1) as usize];
            let next = top.saturating_add(iv);
            if next > opts.high || next > root + 12 {
                break;
            }
            pitches.push(next);
        }
        let gap = rng.range(opts.min_gap_s, opts.max_gap_s);
        let velocity = rng.range(0.3, 1.0);
        for &p in &pitches {
            notes.push(SynthNote {
                pitch: p,
                onset_s: t + rng.range(0.0, 0.008),
                duration_s: gap * rng.range(0.5, 0.95),
                velocity: (velocity + rng.range(-0.1, 0.1)).clamp(0.2, 1.0),
            });
        }
        t += gap;
    }
    (notes, t + 0.8)
}

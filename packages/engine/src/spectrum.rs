//! Windowed magnitude spectrum of the latest samples.

use crate::ring::Ring;
use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

/// Very low level used for bins that were not computed or are silent.
pub const SILENCE_DB: f32 = -200.0;

pub struct Spectrum {
    window: Vec<f32>,
    fft: Arc<dyn RealToComplex<f32>>,
    input: Vec<f32>,
    output: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    /// Linear magnitude, normalised so a sinusoid of amplitude `A` peaks at about `A`.
    pub mag: Vec<f32>,
    /// Magnitude in dB (20·log10 of `mag`).
    pub db: Vec<f32>,
    /// Number of bins computed by the last [`Spectrum::analyze`] call.
    pub valid_bins: usize,
    pub bin_hz: f32,
    norm: f32,
}

impl Spectrum {
    pub fn new(n: usize, sample_rate: f32, planner: &mut RealFftPlanner<f32>) -> Spectrum {
        let fft = planner.plan_fft_forward(n);
        let window: Vec<f32> = (0..n)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos())
            .collect();
        let sum: f32 = window.iter().sum();
        let bins = n / 2 + 1;
        Spectrum {
            input: fft.make_input_vec(),
            output: fft.make_output_vec(),
            scratch: fft.make_scratch_vec(),
            fft,
            window,
            mag: vec![0.0; bins],
            db: vec![SILENCE_DB; bins],
            valid_bins: 0,
            bin_hz: sample_rate / n as f32,
            norm: 2.0 / sum,
        }
    }

    pub fn bins(&self) -> usize {
        self.mag.len()
    }

    /// Analyses the frame of samples ending just before `end`, computing bins `0..max_bin`.
    pub fn analyze(&mut self, ring: &Ring, end: u64, max_bin: usize) {
        ring.read_ending_at(end, &mut self.input);
        for (x, w) in self.input.iter_mut().zip(&self.window) {
            *x *= *w;
        }
        if self
            .fft
            .process_with_scratch(&mut self.input, &mut self.output, &mut self.scratch)
            .is_err()
        {
            self.valid_bins = 0;
            return;
        }
        let top = max_bin.min(self.output.len());
        for k in 0..top {
            let m = self.output[k].norm() * self.norm;
            self.mag[k] = m;
            self.db[k] = 20.0 * (m + 1e-10).log10();
        }
        for k in top..self.valid_bins.max(top) {
            self.mag[k] = 0.0;
            self.db[k] = SILENCE_DB;
        }
        self.valid_bins = top;
    }

    /// Fractional bin index of a frequency.
    #[inline]
    pub fn bin_of(&self, hz: f32) -> f32 {
        hz / self.bin_hz
    }

    /// Finds the spectral peak nearest to `hz` by hill-climbing from the closest bin, then refines
    /// it with parabolic interpolation on the dB values. Returns `(peak_hz, peak_db, bin)`.
    pub fn peak_near(&self, hz: f32, max_steps: usize) -> Option<(f32, f32, usize)> {
        let last = self.valid_bins.checked_sub(2)?;
        let mut k = self.bin_of(hz).round() as usize;
        if k < 1 || k > last {
            return None;
        }
        for _ in 0..max_steps {
            let here = self.db[k];
            let left = self.db[k - 1];
            let right = self.db[k + 1];
            if left > here && left >= right && k > 1 {
                k -= 1;
            } else if right > here && k < last {
                k += 1;
            } else {
                break;
            }
        }
        let a = self.db[k - 1];
        let b = self.db[k];
        let c = self.db[k + 1];
        let denom = a - 2.0 * b + c;
        let delta = if denom.abs() > 1e-9 {
            (0.5 * (a - c) / denom).clamp(-0.5, 0.5)
        } else {
            0.0
        };
        // A Hann window's scalloping loss is at most ~1.4 dB; cap the correction so a peak next to
        // an empty bin can't be inflated.
        let peak_db = b + (-0.25 * (a - c) * delta).clamp(0.0, 2.0);
        Some(((k as f32 + delta) * self.bin_hz, peak_db, k))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_ring(freq: f32, amp: f32, sr: f32, len: usize) -> Ring {
        let mut r = Ring::new(len);
        for i in 0..len {
            r.push(amp * (2.0 * std::f32::consts::PI * freq * i as f32 / sr).sin());
        }
        r
    }

    #[test]
    fn sinusoid_peak_is_found_accurately() {
        let sr = 48000.0;
        let mut planner = RealFftPlanner::new();
        let mut s = Spectrum::new(2048, sr, &mut planner);
        let ring = sine_ring(440.0, 0.1, sr, 4096);
        s.analyze(&ring, 4096, s.bins());
        let (hz, db, _) = s.peak_near(445.0, 4).unwrap();
        assert!((crate::pitch::cents(hz, 440.0)).abs() < 5.0, "hz = {hz}");
        // amplitude 0.1 → -20 dB (Hann scalloping < 1.5 dB after interpolation)
        assert!((db + 20.0).abs() < 1.0, "db = {db}");
    }
}

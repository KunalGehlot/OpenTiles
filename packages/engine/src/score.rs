//! Harmonic scoring of candidate pitches (spec §7, steps 4–5).
//!
//! Each partial of a candidate pitch is found in the post-onset spectrum and rated by two things:
//! how far it stands out from the local floor (*level*), and how much louder it is than the
//! loudest of several frames just before the onset (*freshness*). Notes still ringing under the
//! sustain pedal, and the slow beating between a note's strings, have little freshness; what was
//! just played has plenty.
//!
//! Under the pedal a new partial can sit within a bin of a louder ringing one and vanish into its
//! peak. A second view catches those: the *difference* spectrum, post-onset power minus twice the
//! loudest pre-onset power per bin, where ringing partials cancel and the new one remains. Each
//! partial's evidence is the better of the two views; a pitch's score combines its partials.

use crate::pitch::{inharmonicity, midi_to_hz, partial_hz};
use crate::spectrum::Spectrum;

pub const MAX_PARTIALS: usize = 12;
/// Pre-onset frames compared against.
pub const PRE_FRAMES: usize = 3;

/// Partials of a context pitch closer than this ratio (≈35 cents) count as shared.
const SHARED_RATIO: f32 = 0.0204;
/// Weight of a partial that another expected pitch also explains.
const SHARED_WEIGHT: f32 = 0.3;
/// Weight of a shared partial in the odd-partial evidence. Odd partials are what separates a note
/// from the octave above it, so evidence another expected note explains should barely count.
const SHARED_ODD_WEIGHT: f32 = 0.1;
/// dB above the floor where a partial starts to count, and the range to full level.
const LEVEL_START_DB: f32 = 4.0;
const LEVEL_RANGE_DB: f32 = 20.0;
/// dB of increase over the loudest pre-onset frame where a partial starts to count as fresh, and
/// the range to fully fresh. The start is above zero so that beating strings, which can lift a
/// ringing note a few dB between frames, don't count; a real attack adds far more.
const FRESH_START_DB: f32 = 2.0;
const FRESH_RANGE_DB: f32 = 7.0;
/// Local floor: a low percentile of dB values within ±16 bins plus an offset. A low percentile
/// finds the valleys between partials, so dense chords don't lift the floor.
const FLOOR_PERCENTILE: f32 = 0.10;
const FLOOR_OFFSET_DB: f32 = 4.0;
/// Multiple of the loudest pre-onset power subtracted in the difference spectrum. Above 1 so that
/// beating strings don't leave residue.
const DIFF_SUBTRACT: f32 = 2.0;
/// Difference-spectrum values are clamped this far below the floor, which keeps peak
/// interpolation sane next to empty bins.
const DIFF_CLAMP_DB: f32 = 30.0;
/// Minimum partial salience that contributes to the tuning estimate.
const PRESENT: f32 = 0.2;

/// Evidence for one pitch at one decision.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PitchScore {
    /// Combined score: geometric mean of `all` and `odd`.
    pub score: f32,
    /// Weighted mean salience over all partials.
    pub all: f32,
    /// Weighted mean salience over odd partials (1, 3, 5, …), which the octave above cannot
    /// explain.
    pub odd: f32,
    /// Salience-weighted mean deviation of present partials from the model, in cents.
    pub dev_cents: f32,
}

pub struct Scorer {
    partials: Vec<[f32; MAX_PARTIALS]>,
    counts: Vec<usize>,
    max_partials: usize,
    bass_partials: usize,
    bass_below: u8,
    max_hz: f32,
    floor: Vec<f32>,
    /// Per bin, the loudest level (dB) among the pre-onset frames.
    pre_max: Vec<f32>,
    scratch: Vec<f32>,
}

impl Scorer {
    /// `max_partials` partials per pitch, `bass_partials` for pitches below `bass_below`.
    pub fn new(
        max_bins: usize,
        max_partials: usize,
        bass_partials: usize,
        bass_below: u8,
        max_hz: f32,
    ) -> Scorer {
        let mut s = Scorer {
            partials: vec![[0.0; MAX_PARTIALS]; 128],
            counts: vec![0; 128],
            max_partials: max_partials.clamp(1, MAX_PARTIALS),
            bass_partials: bass_partials.clamp(1, MAX_PARTIALS),
            bass_below,
            max_hz,
            floor: vec![0.0; max_bins],
            pre_max: vec![0.0; max_bins],
            scratch: Vec::with_capacity(64),
        };
        s.retune(440.0, 0.0);
        s
    }

    /// Recomputes the partial table for a concert pitch and tuning offset.
    pub fn retune(&mut self, a4_hz: f32, tuning_cents: f32) {
        for p in 0..128usize {
            let f0 = midi_to_hz(p as f32, a4_hz, tuning_cents);
            let b = inharmonicity(p as u8);
            let mut count = 0;
            let limit = if (p as u8) < self.bass_below {
                self.bass_partials
            } else {
                self.max_partials
            };
            for n in 1..=limit {
                let f = partial_hz(f0, n, b);
                if f > self.max_hz {
                    break;
                }
                self.partials[p][n - 1] = f;
                count = n;
            }
            self.counts[p] = count;
        }
    }

    /// Computes the floor of `post`, the per-bin maximum of the pre-onset frames and the
    /// difference spectrum `diff` used by [`Scorer::score`]. `room` is the calibrated noise floor
    /// (dB per bin) if there is one.
    pub fn prepare(
        &mut self,
        post: &Spectrum,
        pres: [&Spectrum; PRE_FRAMES],
        diff: &mut Spectrum,
        room: Option<&[f32]>,
    ) {
        let n = post.valid_bins.min(self.floor.len());
        if n == 0 {
            diff.valid_bins = 0;
            return;
        }
        percentile_floor(
            &post.db[..n],
            &mut self.floor[..n],
            &mut self.scratch,
            FLOOR_PERCENTILE,
            FLOOR_OFFSET_DB,
        );
        if let Some(room) = room {
            for (f, r) in self.floor[..n].iter_mut().zip(room) {
                *f = f.max(r + 3.0);
            }
        }
        for k in 0..n {
            let mut q = 0.0f32;
            let mut q_db = f32::MIN;
            for pre in pres {
                let m = pre.mag.get(k).copied().unwrap_or(0.0);
                q = q.max(m * m);
                q_db = q_db.max(pre.db.get(k).copied().unwrap_or(f32::MIN));
            }
            self.pre_max[k] = q_db;
            let p = post.mag[k] * post.mag[k];
            let d = (p - DIFF_SUBTRACT * q).max(0.0);
            diff.mag[k] = d.sqrt();
            diff.db[k] = (10.0 * (d + 1e-20).log10()).max(self.floor[k] - DIFF_CLAMP_DB);
        }
        for k in n..diff.valid_bins {
            diff.mag[k] = 0.0;
            diff.db[k] = crate::spectrum::SILENCE_DB;
        }
        diff.valid_bins = n;
    }

    fn is_shared(&self, hz: f32, context: &[u8], exclude: u8) -> bool {
        for &q in context {
            if q == exclude {
                continue;
            }
            let qi = q as usize;
            if qi >= 128 {
                continue;
            }
            for m in 0..self.counts[qi] {
                let fq = self.partials[qi][m];
                if (hz / fq - 1.0).abs() < SHARED_RATIO {
                    return true;
                }
            }
        }
        false
    }

    /// Scores `pitch` from `post` and the difference spectrum `diff` ([`Scorer::prepare`] must
    /// have been called for them). `context` lists the pitches expected at the same time;
    /// partials they also explain count less.
    pub fn score(&self, post: &Spectrum, diff: &Spectrum, pitch: u8, context: &[u8]) -> PitchScore {
        let p = pitch as usize;
        if p >= 128 || self.counts[p] == 0 {
            return PitchScore::default();
        }
        let (mut all_n, mut all_d) = (0.0f32, 0.0f32);
        let (mut odd_n, mut odd_d) = (0.0f32, 0.0f32);
        let (mut dev_n, mut dev_d) = (0.0f32, 0.0f32);
        for n in 1..=self.counts[p] {
            let f = self.partials[p][n - 1];
            let base = base_weight(n) * low_frequency_weight(f);
            let shared = self.is_shared(f, context, pitch);
            let w = if shared { base * SHARED_WEIGHT } else { base };
            let (s, dev) = self.partial_evidence(post, diff, f);
            all_n += w * s;
            all_d += w;
            if n % 2 == 1 {
                let wo = if shared {
                    base * SHARED_ODD_WEIGHT
                } else {
                    base
                };
                odd_n += wo * s;
                odd_d += wo;
            }
            if s > PRESENT {
                dev_n += w * s * dev;
                dev_d += w * s;
            }
        }
        let all = ratio(all_n, all_d);
        let odd = ratio(odd_n, odd_d);
        PitchScore {
            score: (all * odd).sqrt(),
            all,
            odd,
            dev_cents: ratio(dev_n, dev_d),
        }
    }

    /// Evidence in `0..=1` and deviation (cents) of the partial expected at `f`: the better of
    /// `matched × level × freshness` in the post-onset spectrum and `matched × level` in the
    /// difference spectrum.
    fn partial_evidence(&self, post: &Spectrum, diff: &Spectrum, f: f32) -> (f32, f32) {
        let steps = 2 + (post.bin_of(f) * 0.03) as usize;
        let sigma = (0.25 * bin_cents(f, post.bin_hz)).max(20.0);
        let matched = |hz: f32| {
            let dev = crate::pitch::cents(hz, f);
            ((-0.5 * (dev / sigma) * (dev / sigma)).exp(), dev)
        };
        let mut best = (0.0f32, 0.0f32);
        if let Some((peak_hz, peak_db, k)) = post.peak_near(f, steps) {
            let (m, dev) = matched(peak_hz);
            let floor = self.floor.get(k).copied().unwrap_or(0.0);
            let level = ((peak_db - floor - LEVEL_START_DB) / LEVEL_RANGE_DB).clamp(0.0, 1.0);
            let before = self.pre_max.get(k).copied().unwrap_or(f32::MIN).max(floor);
            let fresh = ((peak_db - before - FRESH_START_DB) / FRESH_RANGE_DB).clamp(0.0, 1.0);
            best = (m * level * fresh, dev);
        }
        if let Some((peak_hz, peak_db, k)) = diff.peak_near(f, steps) {
            let (m, dev) = matched(peak_hz);
            let floor = self.floor.get(k).copied().unwrap_or(0.0);
            let level = ((peak_db - floor - LEVEL_START_DB) / LEVEL_RANGE_DB).clamp(0.0, 1.0);
            if m * level > best.0 {
                best = (m * level, dev);
            }
        }
        best
    }
}

/// Writes into `out` a low percentile of `db` within ±16 bins (sampled every 8 bins and linearly
/// interpolated) plus `offset_db`.
fn percentile_floor(db: &[f32], out: &mut [f32], scratch: &mut Vec<f32>, q: f32, offset_db: f32) {
    const STEP: usize = 8;
    const HALF: usize = 16;
    let n = db.len().min(out.len());
    if n == 0 {
        return;
    }
    let mut prev: Option<(usize, f32)> = None;
    let mut center = 0usize;
    loop {
        let c = center.min(n - 1);
        let lo = c.saturating_sub(HALF);
        let hi = (c + HALF + 1).min(n);
        scratch.clear();
        scratch.extend_from_slice(&db[lo..hi]);
        let idx = ((scratch.len() as f32 * q) as usize).min(scratch.len() - 1);
        let (_, v, _) = scratch.select_nth_unstable_by(idx, |a, b| a.total_cmp(b));
        let value = *v + offset_db;
        match prev {
            None => out[..=c].fill(value),
            Some((pc, pv)) => {
                let span = (c - pc).max(1) as f32;
                for (k, o) in out.iter_mut().enumerate().take(c + 1).skip(pc) {
                    *o = pv + (value - pv) * ((k - pc) as f32 / span);
                }
            }
        }
        prev = Some((c, value));
        if c == n - 1 {
            break;
        }
        center += STEP;
    }
}

fn ratio(n: f32, d: f32) -> f32 {
    if d > 0.0 {
        n / d
    } else {
        0.0
    }
}

/// Lower partials carry most of a piano tone's energy.
fn base_weight(n: usize) -> f32 {
    match n {
        1..=4 => 1.0,
        5..=6 => 0.7,
        _ => 0.5,
    }
}

/// Phone and tablet microphones roll off below ~150 Hz.
fn low_frequency_weight(f: f32) -> f32 {
    if f < 100.0 {
        0.3
    } else if f < 150.0 {
        0.6
    } else {
        1.0
    }
}

/// Width of one FFT bin at frequency `f`, in cents.
fn bin_cents(f: f32, bin_hz: f32) -> f32 {
    1200.0 * (1.0 + bin_hz / f.max(1.0)).log2()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_floor_tracks_valleys() {
        // Peaks every 4 bins over a -60 dB floor.
        let db: Vec<f32> = (0..128)
            .map(|k| if k % 4 == 0 { -10.0 } else { -60.0 })
            .collect();
        let mut out = vec![0.0; 128];
        let mut scratch = Vec::new();
        percentile_floor(&db, &mut out, &mut scratch, 0.1, 4.0);
        assert!(out.iter().all(|&v| (v + 56.0).abs() < 1e-3));
    }
}

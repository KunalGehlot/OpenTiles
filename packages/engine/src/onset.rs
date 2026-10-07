//! Spectral-flux onset detection (spec §7, step 3).
//!
//! Flux is the mean positive increase of the log-compressed magnitude spectrum against the frame
//! `lag` hops earlier, max-filtered across neighbouring bins (the SuperFlux trick) so slight pitch
//! wobble and beating strings under the sustain pedal don't look like new attacks. Peaks are picked
//! with one hop of look-ahead against an adaptive threshold.

const MEAN_WINDOW: usize = 16;
const PRE_MAX: usize = 3;

pub struct OnsetParams {
    pub k_lo: usize,
    pub k_hi: usize,
    pub lag: usize,
    pub delta: f32,
    pub mean_factor: f32,
    pub min_interval: u64,
    pub offset_samples: u64,
    pub compression: f32,
}

pub struct OnsetDetector {
    p: OnsetParams,
    /// Ring of the last `lag + 1` compressed spectra (bins `k_lo..k_hi`).
    hist: Vec<Vec<f32>>,
    pos: usize,
    frames: u64,
    flux: [f32; MEAN_WINDOW],
    flux_pos: usize,
    /// Flux and frame-end sample of the previous frame, the peak candidate.
    prev: f32,
    prev_end: u64,
    last_onset: Option<u64>,
}

impl OnsetDetector {
    pub fn new(p: OnsetParams) -> OnsetDetector {
        let width = p.k_hi.saturating_sub(p.k_lo).max(1);
        OnsetDetector {
            hist: vec![vec![0.0; width]; p.lag + 1],
            pos: 0,
            frames: 0,
            flux: [0.0; MEAN_WINDOW],
            flux_pos: 0,
            prev: 0.0,
            prev_end: 0,
            last_onset: None,
            p,
        }
    }

    pub fn set_compression(&mut self, c: f32) {
        self.p.compression = c;
    }

    /// Feeds one frame of linear magnitudes whose last sample is just before `end`.
    /// Returns the estimated onset sample when the previous frame was a flux peak.
    pub fn step(&mut self, mag: &[f32], end: u64) -> Option<u64> {
        let lag = self.p.lag;
        let cur = self.pos;
        let old = (self.pos + 1) % (lag + 1);
        let c = self.p.compression;
        {
            let dst = &mut self.hist[cur];
            for (j, d) in dst.iter_mut().enumerate() {
                let m = mag.get(self.p.k_lo + j).copied().unwrap_or(0.0);
                *d = (1.0 + c * m).ln();
            }
        }
        let flux = if self.frames >= lag as u64 {
            let (now, then) = (&self.hist[cur], &self.hist[old]);
            let n = now.len();
            let mut sum = 0.0;
            for k in 0..n {
                let mut reference = then[k];
                if k > 0 {
                    reference = reference.max(then[k - 1]);
                }
                if k + 1 < n {
                    reference = reference.max(then[k + 1]);
                }
                let d = now[k] - reference;
                if d > 0.0 {
                    sum += d;
                }
            }
            sum / n as f32
        } else {
            0.0
        };
        self.pos = (self.pos + 1) % (lag + 1);
        self.frames += 1;

        // Peak picking on the previous frame, now that we know the current one.
        let mean = self.flux.iter().sum::<f32>() / MEAN_WINDOW as f32;
        let recent_max = (1..=PRE_MAX)
            .map(|i| self.flux[(self.flux_pos + MEAN_WINDOW - i) % MEAN_WINDOW])
            .fold(0.0_f32, f32::max);
        let candidate = self.prev;
        let threshold = self.p.delta + self.p.mean_factor * mean;
        let is_peak = candidate >= flux && candidate > recent_max && candidate >= threshold;
        let mut onset = None;
        if is_peak {
            let t = self.prev_end.saturating_sub(self.p.offset_samples);
            let far_enough = match self.last_onset {
                Some(last) => t >= last + self.p.min_interval,
                None => true,
            };
            if far_enough {
                self.last_onset = Some(t);
                onset = Some(t);
            }
        }
        self.flux[self.flux_pos] = candidate;
        self.flux_pos = (self.flux_pos + 1) % MEAN_WINDOW;
        self.prev = flux;
        self.prev_end = end;
        onset
    }
}

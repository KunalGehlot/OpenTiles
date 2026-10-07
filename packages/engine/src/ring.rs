//! Fixed-size ring buffer of input samples, indexed by absolute sample number.

pub struct Ring {
    buf: Vec<f32>,
    mask: usize,
    written: u64,
}

impl Ring {
    /// A ring holding at least `min_len` samples (rounded up to a power of two).
    pub fn new(min_len: usize) -> Ring {
        let len = min_len.max(2).next_power_of_two();
        Ring {
            buf: vec![0.0; len],
            mask: len - 1,
            written: 0,
        }
    }

    #[inline]
    pub fn push(&mut self, x: f32) {
        let i = (self.written as usize) & self.mask;
        self.buf[i] = x;
        self.written += 1;
    }

    /// Total samples written so far; also the index of the next sample.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// Copies the `out.len()` samples that end just before absolute sample index `end`.
    /// Samples never written, or already overwritten, read as zero.
    pub fn read_ending_at(&self, end: u64, out: &mut [f32]) {
        let n = out.len() as u64;
        let oldest = self.written.saturating_sub(self.buf.len() as u64);
        let start = end as i128 - n as i128;
        for (j, o) in out.iter_mut().enumerate() {
            let idx = start + j as i128;
            *o = if idx < oldest as i128 || idx >= self.written as i128 {
                0.0
            } else {
                self.buf[(idx as usize) & self.mask]
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_latest_samples() {
        let mut r = Ring::new(8);
        for i in 0..20 {
            r.push(i as f32);
        }
        let mut out = [0.0; 4];
        r.read_ending_at(20, &mut out);
        assert_eq!(out, [16.0, 17.0, 18.0, 19.0]);
        r.read_ending_at(18, &mut out);
        assert_eq!(out, [14.0, 15.0, 16.0, 17.0]);
    }

    #[test]
    fn missing_samples_are_zero() {
        let mut r = Ring::new(8);
        for i in 0..3 {
            r.push(1.0 + i as f32);
        }
        let mut out = [9.0; 5];
        r.read_ending_at(3, &mut out);
        assert_eq!(out, [0.0, 0.0, 1.0, 2.0, 3.0]);
        // Overwritten samples
        for _ in 0..20 {
            r.push(5.0);
        }
        r.read_ending_at(4, &mut out);
        assert_eq!(out, [0.0; 5]);
    }
}

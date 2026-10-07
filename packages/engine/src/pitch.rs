//! Pitch helpers and the piano partial model.

/// Lowest and highest piano keys (A0, C8).
pub const PIANO_LOW: u8 = 21;
pub const PIANO_HIGH: u8 = 108;

/// Frequency of a MIDI pitch at the given concert pitch and tuning offset.
pub fn midi_to_hz(pitch: f32, a4_hz: f32, tuning_cents: f32) -> f32 {
    a4_hz * 2f32.powf((pitch - 69.0) / 12.0 + tuning_cents / 1200.0)
}

/// Typical inharmonicity coefficient `B` of a piano string for a MIDI pitch.
///
/// Rough fit to published grand-piano measurements: about 2.5e-4 through the middle of the
/// keyboard, rising by ~2.5× per octave in the treble and gently in the low bass. Real
/// instruments differ, which is why partial matching allows a tolerance and calibration can
/// adjust tuning.
pub fn inharmonicity(pitch: u8) -> f32 {
    let p = pitch as f32;
    let base = 2.5e-4_f32;
    if p >= 55.0 {
        base * 2f32.powf((p - 55.0) / 12.0 * 1.3)
    } else if p < 40.0 {
        base * 2f32.powf((40.0 - p) / 12.0 * 0.5)
    } else {
        base
    }
}

/// Frequency of partial `n` (1-based) for fundamental `f0` and inharmonicity `b`:
/// `fₙ = n·f₀·√(1 + B·n²)`.
pub fn partial_hz(f0: f32, n: usize, b: f32) -> f32 {
    let nf = n as f32;
    nf * f0 * (1.0 + b * nf * nf).sqrt()
}

/// Signed distance between two frequencies in cents.
pub fn cents(f: f32, reference: f32) -> f32 {
    1200.0 * (f / reference).log2()
}

/// Note name for display and reports, e.g. 60 → "C4".
pub fn note_name(pitch: u8) -> String {
    const NAMES: [&str; 12] = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    let octave = pitch as i32 / 12 - 1;
    format!("{}{}", NAMES[(pitch % 12) as usize], octave)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_is_440() {
        assert!((midi_to_hz(69.0, 440.0, 0.0) - 440.0).abs() < 1e-3);
        assert!((midi_to_hz(60.0, 440.0, 0.0) - 261.6256).abs() < 1e-2);
    }

    #[test]
    fn tuning_offset_shifts_by_cents() {
        let f = midi_to_hz(69.0, 440.0, 100.0);
        assert!((cents(f, 440.0) - 100.0).abs() < 1e-2);
    }

    #[test]
    fn partials_are_stretched() {
        let f0 = 261.63;
        let b = inharmonicity(60);
        assert!(partial_hz(f0, 8, b) > 8.0 * f0);
        assert!((partial_hz(f0, 1, 0.0) - f0).abs() < 1e-3);
    }

    #[test]
    fn inharmonicity_rises_in_the_treble() {
        assert!(inharmonicity(96) > inharmonicity(72));
        assert!(inharmonicity(72) > inharmonicity(48));
    }

    #[test]
    fn names() {
        assert_eq!(note_name(60), "C4");
        assert_eq!(note_name(21), "A0");
        assert_eq!(note_name(108), "C8");
    }
}

//! C ABI for WebAssembly hosts (ADR 0002). The only module allowed to use `unsafe`.
//!
//! Protocol, as used by `js/detector-worklet.ts`:
//!
//! 1. `ot_detector_new(sampleRate)` → handle.
//! 2. Write up to `ot_input_capacity()` samples into the `Float32Array` at
//!    `ot_detector_input_ptr(handle)`, then call `ot_detector_process(handle, n)`; it returns the
//!    number of events now in the `Float64Array` at `ot_detector_events_ptr(handle)`, each
//!    `ot_event_stride()` values long: `[kind, pitch, time, confidence, odd, decided_at,
//!    generation]`.
//! 3. To change the expected pitches, write them to the `Uint8Array` at
//!    `ot_detector_expected_ptr(handle)` (capacity `ot_expected_capacity()`) and call
//!    `ot_detector_set_expected(handle, n)`; it returns the new generation.
//!
//! All buffers are allocated in `ot_detector_new`; later calls never allocate, so views on
//! `memory.buffer` stay valid after construction. Hosts should still re-create views if
//! `memory.buffer` changes identity.

use crate::config::{Mode, Thresholds};
use crate::detector::{Detector, MAX_EVENTS, MAX_EXPECTED};

/// Samples accepted per `ot_detector_process` call.
pub const INPUT_CAPACITY: usize = 4096;
/// `f64` values per event record.
pub const EVENT_STRIDE: usize = 7;

pub struct Handle {
    detector: Detector,
    input: Vec<f32>,
    expected: Vec<u8>,
    events: Vec<f64>,
}

#[no_mangle]
pub extern "C" fn ot_version() -> u32 {
    1
}

/// Bit in [`ot_build_features`] set when the module was compiled with WebAssembly SIMD.
pub const FEATURE_SIMD128: u32 = 1;

/// How this module was built, as a bit set ([`FEATURE_SIMD128`]). Lets hosts and the build check
/// confirm which of the two web builds (baseline or SIMD, P0-12) they loaded.
#[no_mangle]
pub extern "C" fn ot_build_features() -> u32 {
    if cfg!(target_feature = "simd128") {
        FEATURE_SIMD128
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn ot_input_capacity() -> u32 {
    INPUT_CAPACITY as u32
}

#[no_mangle]
pub extern "C" fn ot_expected_capacity() -> u32 {
    MAX_EXPECTED as u32
}

#[no_mangle]
pub extern "C" fn ot_event_stride() -> u32 {
    EVENT_STRIDE as u32
}

#[no_mangle]
pub extern "C" fn ot_detector_new(sample_rate: f32) -> *mut Handle {
    let h = Box::new(Handle {
        detector: Detector::new(sample_rate),
        input: vec![0.0; INPUT_CAPACITY],
        expected: vec![0; MAX_EXPECTED],
        events: vec![0.0; MAX_EVENTS * EVENT_STRIDE],
    });
    Box::into_raw(h)
}

/// # Safety
/// `h` must come from `ot_detector_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_free(h: *mut Handle) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_input_ptr(h: *mut Handle) -> *mut f32 {
    match h.as_mut() {
        Some(h) => h.input.as_mut_ptr(),
        None => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_expected_ptr(h: *mut Handle) -> *mut u8 {
    match h.as_mut() {
        Some(h) => h.expected.as_mut_ptr(),
        None => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_events_ptr(h: *mut Handle) -> *const f64 {
    match h.as_ref() {
        Some(h) => h.events.as_ptr(),
        None => std::ptr::null(),
    }
}

/// Processes the first `n` samples of the input buffer; returns the number of events written.
///
/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_process(h: *mut Handle, n: u32) -> u32 {
    let Some(h) = h.as_mut() else { return 0 };
    let n = (n as usize).min(INPUT_CAPACITY);
    h.detector.process(&h.input[..n]);
    let events = h.detector.events();
    for (i, e) in events.iter().enumerate() {
        let o = &mut h.events[i * EVENT_STRIDE..(i + 1) * EVENT_STRIDE];
        o[0] = e.kind as u32 as f64;
        o[1] = e.pitch as f64;
        o[2] = e.time;
        o[3] = e.confidence as f64;
        o[4] = e.odd as f64;
        o[5] = e.decided_at;
        o[6] = e.generation as f64;
    }
    events.len() as u32
}

/// Installs the first `n` pitches of the expected buffer; returns the new generation.
///
/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_set_expected(h: *mut Handle, n: u32) -> u32 {
    let Some(h) = h.as_mut() else { return 0 };
    let n = (n as usize).min(MAX_EXPECTED);
    let Handle {
        detector, expected, ..
    } = h;
    detector.set_expected(&expected[..n]);
    detector.generation()
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_set_mode(h: *mut Handle, mode: u32) {
    if let Some(h) = h.as_mut() {
        h.detector.set_mode(Mode::from_u32(mode));
    }
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_set_tuning(h: *mut Handle, cents: f32) {
    if let Some(h) = h.as_mut() {
        h.detector.set_tuning(cents);
    }
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_tuning_estimate(h: *mut Handle) -> f32 {
    h.as_ref()
        .map(|h| h.detector.tuning_estimate())
        .unwrap_or(0.0)
}

/// Overrides one threshold: 0 accept, 1 wrong, 2 wrong margin, 3 octave below.
///
/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_set_threshold(h: *mut Handle, id: u32, value: f32) {
    let Some(h) = h.as_mut() else { return };
    let mut t: Thresholds = h.detector.config().thresholds;
    match id {
        0 => t.accept = value,
        1 => t.wrong = value,
        2 => t.wrong_margin = value,
        3 => t.octave_below = value,
        _ => return,
    }
    h.detector.set_thresholds(t);
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_begin_noise_calibration(h: *mut Handle) {
    if let Some(h) = h.as_mut() {
        h.detector.begin_noise_calibration();
    }
}

/// Returns the measured noise level in dB, or NaN if nothing was measured.
///
/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_end_noise_calibration(h: *mut Handle) -> f32 {
    h.as_mut()
        .map(|h| h.detector.end_noise_calibration())
        .unwrap_or(f32::NAN)
}

/// # Safety
/// `h` must be a live handle.
#[no_mangle]
pub unsafe extern "C" fn ot_detector_dropped_events(h: *mut Handle) -> u32 {
    h.as_ref().map(|h| h.detector.dropped_events()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_features_match_the_compile_target() {
        let simd = ot_build_features() & FEATURE_SIMD128 != 0;
        assert_eq!(simd, cfg!(target_feature = "simd128"));
        // Native test builds never carry wasm SIMD; only scripts/build.mjs produces that module.
        #[cfg(not(target_arch = "wasm32"))]
        assert!(!simd);
    }
}

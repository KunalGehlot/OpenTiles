//! OpenTiles note-detection engine.
//!
//! A score-informed detector: the caller says which pitches are expected next, and at every
//! detected onset the engine answers "are those pitches sounding now, and is a likely wrong note
//! clearly stronger?" (spec §7). It is not a general polyphonic transcriber.
//!
//! The crate compiles to a dependency-free `wasm32` module with a C ABI (see [`ffi`] and
//! ADR 0002) so it can run inside an AudioWorklet.
//!
//! It is built twice for the web (P0-12): a baseline module and a WebAssembly SIMD module
//! (`--features simd` plus `-C target-feature=+simd128`); the app picks one at runtime.

// The `simd` feature only makes sense with SIMD code generation switched on as well; a half-SIMD
// module would combine the cost of the SIMD requirement with little of the speed.
#[cfg(all(
    target_arch = "wasm32",
    feature = "simd",
    not(target_feature = "simd128")
))]
compile_error!("the `simd` feature needs RUSTFLAGS=\"-C target-feature=+simd128\"");

pub mod config;
pub mod detector;
pub mod eval;
pub mod ffi;
mod onset;
pub mod pitch;
mod ring;
mod score;
pub mod smf;
mod spectrum;
pub mod synth;
pub mod wav;

pub use config::{DetectorConfig, Mode, Thresholds};
pub use detector::{Detector, Event, EventKind};

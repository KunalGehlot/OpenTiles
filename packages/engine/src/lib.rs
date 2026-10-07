//! OpenTiles note-detection engine.
//!
//! A score-informed detector: the caller says which pitches are expected next, and at every
//! detected onset the engine answers "are those pitches sounding now, and is a likely wrong note
//! clearly stronger?" (spec §7). It is not a general polyphonic transcriber.
//!
//! The crate compiles to a dependency-free `wasm32` module with a C ABI (see [`ffi`] and
//! ADR 0002) so it can run inside an AudioWorklet.

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

//! Synthetic accuracy harness (PLAN.md P0-08).
//!
//! Renders random passages of single notes and 2–3 note chords between C2 and C7 with the
//! piano-like synthesiser, then measures correct- and wrong-note acceptance exactly as the
//! `evaluate` CLI does for real recordings. Synthetic audio is easier than a real piano in a real
//! room, so these bounds are a regression guard, not evidence for the G0 gate.

use opentiles_engine::eval::{evaluate, EvalOptions, EvalReport, TruthNote};
use opentiles_engine::synth::{random_passage, render, PassageOptions, Rng, SynthOptions};
use opentiles_engine::{DetectorConfig, Mode};

/// Bounds (correct at least, wrong at most) for the four-note suites below, a little under what
/// was measured on 2026-10-23 (wait 81.2 % / 9.6 %, pedal 59.3 % / 8.1 %, play-along
/// 72.5 % / 2.7 %): regression guards, far from the spec's 95 % and 3 %; see `four_note`.
const FOUR_NOTE_WAIT: (f64, f64) = (0.78, 0.12);
const FOUR_NOTE_PEDAL: (f64, f64) = (0.55, 0.11);
const FOUR_NOTE_PLAY: (f64, f64) = (0.70, 0.04);

fn run_suite(mode: Mode, pedal: bool, seeds: std::ops::Range<u64>, sample_rate: f32) -> EvalReport {
    run_passages(mode, pedal, seeds, sample_rate, &PassageOptions::default())
}

fn run_passages(
    mode: Mode,
    pedal: bool,
    seeds: std::ops::Range<u64>,
    sample_rate: f32,
    passage: &PassageOptions,
) -> EvalReport {
    let mut total = EvalReport::default();
    for seed in seeds {
        let opts = SynthOptions {
            seed,
            sustain_pedal: pedal,
            sample_rate,
            ..SynthOptions::default()
        };
        let mut rng = Rng::new(seed * 7919);
        let (notes, length) = random_passage(&mut rng, passage);
        let audio = render(&notes, length, &opts);
        let truth: Vec<TruthNote> = notes
            .iter()
            .map(|n| TruthNote {
                onset_s: n.onset_s,
                pitch: n.pitch,
            })
            .collect();
        let cfg = DetectorConfig::new(sample_rate).with_mode(mode);
        total.merge(&evaluate(&audio, &cfg, &truth, &EvalOptions::default()));
    }
    total
}

#[test]
fn wait_mode_without_pedal() {
    let r = run_suite(Mode::Wait, false, 1..7, 48000.0);
    println!("Wait mode, no pedal, 48 kHz\n{}", r.summary());
    assert!(
        r.correct.rate() >= 0.95,
        "correct-note acceptance {}",
        r.correct.rate()
    );
    assert!(
        r.wrong.rate() <= 0.03,
        "wrong-note acceptance {}",
        r.wrong.rate()
    );
}

/// Deliberately harsh: every note rings for 2.5 s under the pedal while random chords across five
/// octaves follow every 0.3–0.8 s, so new bass notes compete with a dense bed of ringing partials.
/// This is the detector's known weak spot (bass under heavy pedal); the bound guards against
/// regressions until real recordings (PLAN.md P0-13) show where to improve.
#[test]
fn wait_mode_with_pedal() {
    let r = run_suite(Mode::Wait, true, 11..17, 48000.0);
    println!("Wait mode, sustain pedal, 48 kHz\n{}", r.summary());
    assert!(
        r.correct.rate() >= 0.85,
        "correct-note acceptance {}",
        r.correct.rate()
    );
    assert!(
        r.wrong.rate() <= 0.03,
        "wrong-note acceptance {}",
        r.wrong.rate()
    );
}

#[test]
fn play_along_mode_is_stricter() {
    let r = run_suite(Mode::PlayAlong, false, 21..25, 44100.0);
    println!("Play-along mode, no pedal, 44.1 kHz\n{}", r.summary());
    assert!(
        r.correct.rate() >= 0.90,
        "correct-note acceptance {}",
        r.correct.rate()
    );
    assert!(
        r.wrong.rate() <= 0.02,
        "wrong-note acceptance {}",
        r.wrong.rate()
    );
}

#[test]
fn decisions_are_fast_enough() {
    let r = run_suite(Mode::Wait, false, 31..33, 48000.0);
    let median = opentiles_engine::eval::percentile(&r.decision_latency_ms, 0.5);
    let p90 = opentiles_engine::eval::percentile(&r.decision_latency_ms, 0.9);
    println!("decision latency median {median:.1} ms, p90 {p90:.1} ms");
    // Spec §7 budget: analysis window + hop ≤ 50 ms (bass notes are allowed their longer window).
    assert!(median <= 50.0, "median decision latency {median} ms");
}

/// Four-note chords as the chord drills play them (P7-10): sevenths, add9 and sixths, some
/// inverted, from C3 to C6. Spec targets cover single notes and 2–3 note chords; four notes are
/// "best effort", so these bounds guard the numbers measured when they were added (2026-10-23)
/// and the drills show a hint to use MIDI or the on-screen keys until real recordings meet the
/// targets. Never loosen the detector to make these pass.
fn four_note() -> PassageOptions {
    PassageOptions {
        low: 48,
        high: 84,
        four_note: true,
        ..PassageOptions::default()
    }
}

#[test]
fn four_note_chords_in_wait_mode() {
    let r = run_passages(Mode::Wait, false, 41..47, 48000.0, &four_note());
    println!(
        "Four-note chords, wait mode, no pedal, 48 kHz\n{}",
        r.summary()
    );
    assert!(
        r.correct.rate() >= FOUR_NOTE_WAIT.0,
        "correct-note acceptance {}",
        r.correct.rate()
    );
    assert!(
        r.wrong.rate() <= FOUR_NOTE_WAIT.1,
        "wrong-note acceptance {}",
        r.wrong.rate()
    );
}

#[test]
fn four_note_chords_with_pedal() {
    let r = run_passages(Mode::Wait, true, 51..57, 48000.0, &four_note());
    println!(
        "Four-note chords, wait mode, sustain pedal, 48 kHz\n{}",
        r.summary()
    );
    assert!(
        r.correct.rate() >= FOUR_NOTE_PEDAL.0,
        "correct-note acceptance {}",
        r.correct.rate()
    );
    assert!(
        r.wrong.rate() <= FOUR_NOTE_PEDAL.1,
        "wrong-note acceptance {}",
        r.wrong.rate()
    );
}

#[test]
fn four_note_chords_in_play_along() {
    let r = run_passages(Mode::PlayAlong, false, 61..65, 44100.0, &four_note());
    println!(
        "Four-note chords, play-along, no pedal, 44.1 kHz\n{}",
        r.summary()
    );
    assert!(
        r.correct.rate() >= FOUR_NOTE_PLAY.0,
        "correct-note acceptance {}",
        r.correct.rate()
    );
    assert!(
        r.wrong.rate() <= FOUR_NOTE_PLAY.1,
        "wrong-note acceptance {}",
        r.wrong.rate()
    );
}

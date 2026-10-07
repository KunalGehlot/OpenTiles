//! Writes a synthetic piano passage as `<name>.wav` plus its answer key `<name>.csv`, for trying
//! the evaluator and the Detector Lab without a piano.
//!
//! ```text
//! synthesize <name> [--seed N] [--pedal] [--chords N]
//! ```

use opentiles_engine::synth::{random_passage, render, PassageOptions, Rng, SynthOptions};
use opentiles_engine::wav::write_wav_16;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(name) = args.next() else {
        eprintln!("usage: synthesize <name> [--seed N] [--pedal] [--chords N]");
        return ExitCode::from(2);
    };
    let mut opts = SynthOptions::default();
    let mut passage = PassageOptions::default();
    while let Some(a) = args.next() {
        match a.as_str() {
            "--seed" => opts.seed = args.next().and_then(|v| v.parse().ok()).unwrap_or(1),
            "--pedal" => opts.sustain_pedal = true,
            "--chords" => passage.chords = args.next().and_then(|v| v.parse().ok()).unwrap_or(40),
            _ => {
                eprintln!("unknown argument {a}");
                return ExitCode::from(2);
            }
        }
    }
    let mut rng = Rng::new(opts.seed);
    let (notes, length) = random_passage(&mut rng, &passage);
    let samples = render(&notes, length, &opts);
    let wav = write_wav_16(&samples, opts.sample_rate as u32);
    let mut csv = String::from("onset_s,pitch,duration_s\n");
    for n in &notes {
        csv += &format!("{:.4},{},{:.4}\n", n.onset_s, n.pitch, n.duration_s);
    }
    if let Err(e) = std::fs::write(format!("{name}.wav"), wav)
        .and_then(|_| std::fs::write(format!("{name}.csv"), csv))
    {
        eprintln!("{e}");
        return ExitCode::FAILURE;
    }
    println!(
        "wrote {name}.wav ({length:.1} s, {} notes) and {name}.csv",
        notes.len()
    );
    ExitCode::SUCCESS
}

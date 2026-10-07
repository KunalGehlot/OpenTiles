//! Runs the detector over recordings with answer keys and prints the Phase 0 accuracy report.
//!
//! ```text
//! evaluate [--mode wait|play] [--align] <recording.wav> <answer.csv>
//! evaluate [--mode wait|play] [--align] --dir <folder with X.wav + X.csv pairs>
//! ```

use opentiles_engine::eval::{
    evaluate, group_chords, parse_answer_csv, EvalOptions, EvalReport, TruthNote,
};
use opentiles_engine::wav::read_wav;
use opentiles_engine::{Detector, DetectorConfig, EventKind, Mode};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

struct Args {
    mode: Mode,
    align: bool,
    pairs: Vec<(PathBuf, PathBuf)>,
}

fn usage() -> ExitCode {
    eprintln!("usage: evaluate [--mode wait|play] [--align] <recording.wav> <answer.csv>");
    eprintln!("       evaluate [--mode wait|play] [--align] --dir <folder>");
    ExitCode::from(2)
}

fn parse_args() -> Result<Args, String> {
    let mut mode = Mode::Wait;
    let mut align = false;
    let mut dir: Option<PathBuf> = None;
    let mut positional = Vec::new();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--mode" => {
                mode = match it.next().as_deref() {
                    Some("wait") => Mode::Wait,
                    Some("play") => Mode::PlayAlong,
                    other => return Err(format!("unknown mode {other:?}")),
                }
            }
            "--align" => align = true,
            "--dir" => dir = it.next().map(PathBuf::from),
            "-h" | "--help" => return Err(String::new()),
            _ => positional.push(PathBuf::from(a)),
        }
    }
    let mut pairs = Vec::new();
    if let Some(dir) = dir {
        let mut wavs: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map_err(|e| format!("{}: {e}", dir.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("wav")))
            .collect();
        wavs.sort();
        for w in wavs {
            let csv = w.with_extension("csv");
            if csv.exists() {
                pairs.push((w, csv));
            } else {
                eprintln!("skipping {} (no matching .csv)", w.display());
            }
        }
    } else if positional.len() == 2 {
        pairs.push((positional[0].clone(), positional[1].clone()));
    } else {
        return Err(String::new());
    }
    Ok(Args { mode, align, pairs })
}

/// Shifts the answer key so its chords line up with detected onsets (for MIDI captured on another
/// device). Searches ±3 s in 5 ms steps and keeps the offset matching the most chords.
fn align(samples: &[f32], cfg: &DetectorConfig, truth: &[TruthNote]) -> f32 {
    let mut det = Detector::with_config(cfg.clone());
    let mut onsets = Vec::new();
    for block in samples.chunks(128) {
        det.process(block);
        onsets.extend(
            det.events()
                .iter()
                .filter(|e| e.kind == EventKind::Onset)
                .map(|e| e.time as f32),
        );
    }
    let chords = group_chords(truth, 0.04);
    // Most chords matched wins; ties go to the smallest total timing error.
    let mut best = (0usize, f32::INFINITY, 0.0f32);
    for step in -600..=600 {
        let offset = step as f32 * 0.005;
        let (mut hits, mut err) = (0usize, 0.0f32);
        for c in &chords {
            let t = c.onset_s + offset;
            if let Some(d) = onsets
                .iter()
                .map(|&o| (o - t).abs())
                .filter(|d| *d < 0.03)
                .reduce(f32::min)
            {
                hits += 1;
                err += d;
            }
        }
        if hits > best.0 || (hits == best.0 && err < best.1) {
            best = (hits, err, offset);
        }
    }
    best.2
}

fn run(path_wav: &Path, path_csv: &Path, args: &Args) -> Result<EvalReport, String> {
    let bytes = std::fs::read(path_wav).map_err(|e| format!("{}: {e}", path_wav.display()))?;
    let audio = read_wav(&bytes)?;
    let text =
        std::fs::read_to_string(path_csv).map_err(|e| format!("{}: {e}", path_csv.display()))?;
    let mut truth = parse_answer_csv(&text)?;
    let cfg = DetectorConfig::new(audio.sample_rate).with_mode(args.mode);
    if args.align {
        let offset = align(&audio.samples, &cfg, &truth);
        println!("  aligned answer key by {:+.3} s", offset);
        for n in &mut truth {
            n.onset_s += offset;
        }
    }
    Ok(evaluate(
        &audio.samples,
        &cfg,
        &truth,
        &EvalOptions::default(),
    ))
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            if !e.is_empty() {
                eprintln!("{e}");
            }
            return usage();
        }
    };
    let mut total = EvalReport::default();
    for (wav, csv) in &args.pairs {
        println!("== {}", wav.display());
        match run(wav, csv, &args) {
            Ok(r) => {
                print!("{}", r.summary());
                total.merge(&r);
            }
            Err(e) => {
                eprintln!("error: {e}");
                return ExitCode::FAILURE;
            }
        }
    }
    if args.pairs.len() > 1 {
        println!("== all {} recordings", args.pairs.len());
        print!("{}", total.summary());
    }
    ExitCode::SUCCESS
}

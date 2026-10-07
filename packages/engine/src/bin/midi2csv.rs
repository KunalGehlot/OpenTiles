//! Converts a MIDI capture into an answer-key CSV (`onset_s,pitch,duration_s`) on stdout.
//!
//! ```text
//! midi2csv take.mid > take.csv
//! ```

use opentiles_engine::smf::parse_smf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: midi2csv <file.mid>");
        return ExitCode::from(2);
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("{path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    match parse_smf(&bytes) {
        Ok(notes) => {
            println!("onset_s,pitch,duration_s");
            for n in notes.iter().filter(|n| n.channel != 9) {
                println!("{:.4},{},{:.4}", n.onset_s, n.pitch, n.duration_s);
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{path}: {e}");
            ExitCode::FAILURE
        }
    }
}

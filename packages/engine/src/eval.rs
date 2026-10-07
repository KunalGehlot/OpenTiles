//! Accuracy evaluation shared by the synthetic test harness and the `evaluate` CLI.
//!
//! The detector is replayed over a recording the way wait mode drives it: shortly before each
//! chord in the answer key, the expected pitches are set. One pass uses the chord actually played
//! (correct-note acceptance); further passes replace one pitch per chord with a likely mistake
//! (±1, ±2, ±12 semitones) as the *expected* pitch, so accepting it means a wrong note would have
//! been accepted (spec §7 accuracy targets).

use crate::config::DetectorConfig;
use crate::detector::{Detector, EventKind};
use crate::pitch::{PIANO_HIGH, PIANO_LOW};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TruthNote {
    pub onset_s: f32,
    pub pitch: u8,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Chord {
    pub onset_s: f32,
    pub pitches: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct EvalOptions {
    /// Notes starting within this window form one chord.
    pub chord_window_s: f32,
    /// How long before a chord the expected pitches are set (at most half the gap).
    pub lead_s: f32,
    /// Accepted onsets must fall within this window around the true onset.
    pub accept_window_s: (f32, f32),
    /// Substitutions used for the wrong-note passes.
    pub substitutions: Vec<i16>,
}

impl Default for EvalOptions {
    fn default() -> EvalOptions {
        EvalOptions {
            chord_window_s: 0.04,
            lead_s: 0.12,
            accept_window_s: (-0.06, 0.30),
            substitutions: vec![-12, -2, -1, 1, 2, 12],
        }
    }
}

/// Counts for one register or substitution.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Tally {
    pub total: u32,
    pub accepted: u32,
}

impl Tally {
    pub fn rate(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            self.accepted as f64 / self.total as f64
        }
    }

    fn add(&mut self, accepted: bool) {
        self.total += 1;
        if accepted {
            self.accepted += 1;
        }
    }

    fn merge(&mut self, o: &Tally) {
        self.total += o.total;
        self.accepted += o.accepted;
    }
}

#[derive(Clone, Debug, Default)]
pub struct EvalReport {
    pub correct: Tally,
    pub wrong: Tally,
    /// Correct notes by register: below C3, C3–B5, C6 and above.
    pub correct_by_register: [Tally; 3],
    /// Correct notes by chord size 1, 2, 3+.
    pub correct_by_size: [Tally; 3],
    /// Wrong-note passes by substitution, in [`EvalOptions::substitutions`] order.
    pub wrong_by_substitution: Vec<(i16, Tally)>,
    /// Detected onset minus true onset, ms (first accepted note of each chord).
    pub onset_error_ms: Vec<f32>,
    /// Decision time minus true onset, ms.
    pub decision_latency_ms: Vec<f32>,
}

impl EvalReport {
    pub fn merge(&mut self, o: &EvalReport) {
        self.correct.merge(&o.correct);
        self.wrong.merge(&o.wrong);
        for i in 0..3 {
            self.correct_by_register[i].merge(&o.correct_by_register[i]);
            self.correct_by_size[i].merge(&o.correct_by_size[i]);
        }
        for (d, t) in &o.wrong_by_substitution {
            match self.wrong_by_substitution.iter_mut().find(|(e, _)| e == d) {
                Some((_, mine)) => mine.merge(t),
                None => self.wrong_by_substitution.push((*d, *t)),
            }
        }
        self.onset_error_ms.extend_from_slice(&o.onset_error_ms);
        self.decision_latency_ms
            .extend_from_slice(&o.decision_latency_ms);
    }

    pub fn summary(&self) -> String {
        let pct = |t: &Tally| format!("{:6.2} % ({}/{})", t.rate() * 100.0, t.accepted, t.total);
        let mut s = String::new();
        s += &format!(
            "Correct notes accepted: {}  [target ≥ 95 %]\n",
            pct(&self.correct)
        );
        s += &format!(
            "Wrong notes accepted:   {}  [target ≤ 3 %]\n",
            pct(&self.wrong)
        );
        for (name, t) in ["below C3", "C3–B5", "C6 up"]
            .iter()
            .zip(&self.correct_by_register)
        {
            s += &format!("  correct, {name:<9} {}\n", pct(t));
        }
        for (name, t) in ["1 note", "2 notes", "3+ notes"]
            .iter()
            .zip(&self.correct_by_size)
        {
            s += &format!("  correct, {name:<9} {}\n", pct(t));
        }
        for (d, t) in &self.wrong_by_substitution {
            s += &format!("  wrong, {d:+3} semitones {}\n", pct(t));
        }
        s += &format!(
            "Onset error: median {:.1} ms, p90 |err| {:.1} ms\n",
            percentile(&self.onset_error_ms, 0.5),
            percentile(
                &self
                    .onset_error_ms
                    .iter()
                    .map(|x| x.abs())
                    .collect::<Vec<_>>(),
                0.9
            ),
        );
        s += &format!(
            "Decision latency after true onset: median {:.1} ms, p90 {:.1} ms\n",
            percentile(&self.decision_latency_ms, 0.5),
            percentile(&self.decision_latency_ms, 0.9),
        );
        s
    }
}

pub fn percentile(values: &[f32], q: f32) -> f32 {
    if values.is_empty() {
        return f32::NAN;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    let idx = ((v.len() - 1) as f32 * q).round() as usize;
    v[idx]
}

/// Groups notes whose onsets fall within `window_s` of the chord's first note.
pub fn group_chords(truth: &[TruthNote], window_s: f32) -> Vec<Chord> {
    let mut notes = truth.to_vec();
    notes.sort_by(|a, b| a.onset_s.total_cmp(&b.onset_s).then(a.pitch.cmp(&b.pitch)));
    let mut chords: Vec<Chord> = Vec::new();
    for n in notes {
        match chords.last_mut() {
            Some(c) if n.onset_s - c.onset_s <= window_s => {
                if !c.pitches.contains(&n.pitch) {
                    c.pitches.push(n.pitch);
                }
            }
            _ => chords.push(Chord {
                onset_s: n.onset_s,
                pitches: vec![n.pitch],
            }),
        }
    }
    chords
}

struct Accepted {
    pitches: Vec<u8>,
    first_onset_s: Option<f64>,
    first_decision_s: Option<f64>,
}

/// Runs the detector over `samples`, setting `expected[i]` shortly before `chords[i]`, and returns
/// the pitches accepted for each chord.
fn run_pass(
    samples: &[f32],
    cfg: &DetectorConfig,
    chords: &[Chord],
    expected: &[Vec<u8>],
    opts: &EvalOptions,
) -> Vec<Accepted> {
    let sr = cfg.sample_rate;
    let mut det = Detector::with_config(cfg.clone());
    let mut result: Vec<Accepted> = chords
        .iter()
        .map(|_| Accepted {
            pitches: Vec::new(),
            first_onset_s: None,
            first_decision_s: None,
        })
        .collect();
    // Sample index at which each chord's expected set is installed.
    let set_at: Vec<usize> = chords
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let prev = if i == 0 { 0.0 } else { chords[i - 1].onset_s };
            let lead = opts.lead_s.min(0.5 * (c.onset_s - prev).max(0.0));
            ((c.onset_s - lead).max(0.0) * sr) as usize
        })
        .collect();
    // Generation counter value after installing chord i.
    let mut generation_of_chord = vec![u32::MAX; chords.len()];
    let mut next = 0usize;
    let mut pos = 0usize;
    const BLOCK: usize = 128;
    while pos < samples.len() {
        while next < chords.len() && set_at[next] <= pos {
            det.set_expected(&expected[next]);
            generation_of_chord[next] = det.generation();
            next += 1;
        }
        let mut end = (pos + BLOCK).min(samples.len());
        if next < chords.len() && set_at[next] > pos {
            end = end.min(set_at[next]);
        }
        det.process(&samples[pos..end]);
        for ev in det.events() {
            if ev.kind != EventKind::Expected {
                continue;
            }
            let Some(ci) = generation_of_chord.iter().position(|&g| g == ev.generation) else {
                continue;
            };
            let c = &chords[ci];
            let dt = ev.time as f32 - c.onset_s;
            if dt < opts.accept_window_s.0 || dt > opts.accept_window_s.1 {
                continue;
            }
            let acc = &mut result[ci];
            if !acc.pitches.contains(&ev.pitch) {
                acc.pitches.push(ev.pitch);
            }
            acc.first_onset_s.get_or_insert(ev.time);
            acc.first_decision_s.get_or_insert(ev.decided_at);
        }
        pos = end;
    }
    result
}

/// Evaluates one recording against its answer key.
pub fn evaluate(
    samples: &[f32],
    cfg: &DetectorConfig,
    truth: &[TruthNote],
    opts: &EvalOptions,
) -> EvalReport {
    let chords = group_chords(truth, opts.chord_window_s);
    let mut report = EvalReport::default();

    // Correct notes.
    let expected: Vec<Vec<u8>> = chords.iter().map(|c| c.pitches.clone()).collect();
    let accepted = run_pass(samples, cfg, &chords, &expected, opts);
    for (c, acc) in chords.iter().zip(&accepted) {
        let size_idx = (c.pitches.len().clamp(1, 3)) - 1;
        for &p in &c.pitches {
            let ok = acc.pitches.contains(&p);
            report.correct.add(ok);
            let reg = if p < 48 {
                0
            } else if p < 84 {
                1
            } else {
                2
            };
            report.correct_by_register[reg].add(ok);
            report.correct_by_size[size_idx].add(ok);
        }
        if let (Some(on), Some(dec)) = (acc.first_onset_s, acc.first_decision_s) {
            report
                .onset_error_ms
                .push(((on - c.onset_s as f64) * 1000.0) as f32);
            report
                .decision_latency_ms
                .push(((dec - c.onset_s as f64) * 1000.0) as f32);
        }
    }

    // Wrong notes.
    for &d in &opts.substitutions {
        let mut tally = Tally::default();
        let mut expected = Vec::with_capacity(chords.len());
        let mut substituted: Vec<Option<u8>> = Vec::with_capacity(chords.len());
        for (i, c) in chords.iter().enumerate() {
            let idx = i % c.pitches.len();
            let target = c.pitches[idx] as i16 + d;
            let valid = (PIANO_LOW as i16..=PIANO_HIGH as i16).contains(&target)
                && !c.pitches.contains(&(target as u8));
            if valid {
                let mut e = c.pitches.clone();
                e[idx] = target as u8;
                expected.push(e);
                substituted.push(Some(target as u8));
            } else {
                expected.push(c.pitches.clone());
                substituted.push(None);
            }
        }
        let accepted = run_pass(samples, cfg, &chords, &expected, opts);
        for (sub, acc) in substituted.iter().zip(&accepted) {
            if let Some(p) = sub {
                tally.add(acc.pitches.contains(p));
            }
        }
        report.wrong.merge(&tally);
        report.wrong_by_substitution.push((d, tally));
    }
    report
}

/// Parses an answer-key CSV (`onset_s,pitch[,duration_s]`, header optional).
pub fn parse_answer_csv(text: &str) -> Result<Vec<TruthNote>, String> {
    let mut notes = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut cols = line.split(',').map(str::trim);
        let (Some(a), Some(b)) = (cols.next(), cols.next()) else {
            return Err(format!("line {}: expected at least two columns", i + 1));
        };
        let (Ok(onset_s), Ok(pitch)) = (a.parse::<f32>(), b.parse::<u8>()) else {
            if i == 0 {
                continue; // header
            }
            return Err(format!("line {}: cannot parse '{line}'", i + 1));
        };
        notes.push(TruthNote { onset_s, pitch });
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_chords_by_onset() {
        let t = [
            TruthNote {
                onset_s: 0.50,
                pitch: 60,
            },
            TruthNote {
                onset_s: 0.51,
                pitch: 64,
            },
            TruthNote {
                onset_s: 1.00,
                pitch: 62,
            },
        ];
        let c = group_chords(&t, 0.04);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].pitches, vec![60, 64]);
        assert_eq!(c[1].pitches, vec![62]);
    }

    #[test]
    fn parses_csv_with_header() {
        let notes = parse_answer_csv("onset_s,pitch,duration_s\n0.5,60,0.4\n\n1.0,62\n").unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[1].pitch, 62);
        assert!(parse_answer_csv("0.5,60\nx,y\n").is_err());
    }
}

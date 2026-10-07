//! Minimal Standard MIDI File reader, used to turn a digital piano's MIDI capture into an answer
//! key (`midi2csv`). The app's full MIDI importer lives in `packages/song-model`.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MidiNote {
    pub onset_s: f64,
    pub duration_s: f64,
    pub pitch: u8,
    pub velocity: u8,
    pub channel: u8,
}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Result<u8, String> {
        let v = *self.b.get(self.pos).ok_or("unexpected end of data")?;
        self.pos += 1;
        Ok(v)
    }

    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let s = self
            .b
            .get(self.pos..self.pos + n)
            .ok_or("unexpected end of data")?;
        self.pos += n;
        Ok(s)
    }

    fn u32(&mut self) -> Result<u32, String> {
        let s = self.bytes(4)?;
        Ok(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    }

    fn varlen(&mut self) -> Result<u32, String> {
        let mut v = 0u32;
        for _ in 0..4 {
            let b = self.u8()?;
            v = (v << 7) | (b & 0x7F) as u32;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        Err("variable-length quantity too long".into())
    }
}

enum Raw {
    On {
        tick: u64,
        ch: u8,
        pitch: u8,
        vel: u8,
    },
    Off {
        tick: u64,
        ch: u8,
        pitch: u8,
    },
    Tempo {
        tick: u64,
        us_per_quarter: u32,
    },
}

/// Parses an SMF (format 0 or 1, PPQ timing) into notes with times in seconds.
pub fn parse_smf(bytes: &[u8]) -> Result<Vec<MidiNote>, String> {
    let mut r = Reader { b: bytes, pos: 0 };
    if r.bytes(4)? != b"MThd" {
        return Err("not a MIDI file".into());
    }
    let hlen = r.u32()? as usize;
    let header = r.bytes(hlen)?;
    if header.len() < 6 {
        return Err("short MIDI header".into());
    }
    let ntracks = u16::from_be_bytes([header[2], header[3]]);
    let division = u16::from_be_bytes([header[4], header[5]]);
    if division & 0x8000 != 0 {
        return Err("SMPTE time division is not supported".into());
    }
    let ppq = division.max(1) as f64;

    let mut raw = Vec::new();
    for _ in 0..ntracks {
        if r.pos + 8 > bytes.len() {
            break;
        }
        let id = r.bytes(4)?;
        let len = r.u32()? as usize;
        let body = r.bytes(len.min(bytes.len() - r.pos))?;
        if id != b"MTrk" {
            continue;
        }
        let mut t = Reader { b: body, pos: 0 };
        let mut tick = 0u64;
        let mut status = 0u8;
        while t.pos < body.len() {
            tick += t.varlen()? as u64;
            let mut b = t.u8()?;
            if b < 0x80 {
                // Running status: this byte is the first data byte.
                if status == 0 {
                    return Err("running status without a status byte".into());
                }
                t.pos -= 1;
                b = status;
            } else if b < 0xF0 {
                status = b;
            }
            match b {
                0xFF => {
                    let kind = t.u8()?;
                    let len = t.varlen()? as usize;
                    let data = t.bytes(len)?;
                    if kind == 0x51 && len == 3 {
                        let us =
                            ((data[0] as u32) << 16) | ((data[1] as u32) << 8) | data[2] as u32;
                        raw.push(Raw::Tempo {
                            tick,
                            us_per_quarter: us,
                        });
                    }
                    if kind == 0x2F {
                        break;
                    }
                }
                0xF0 | 0xF7 => {
                    let len = t.varlen()? as usize;
                    t.bytes(len)?;
                }
                _ => {
                    let ch = b & 0x0F;
                    match b & 0xF0 {
                        0x80 => {
                            let pitch = t.u8()?;
                            t.u8()?;
                            raw.push(Raw::Off { tick, ch, pitch });
                        }
                        0x90 => {
                            let pitch = t.u8()?;
                            let vel = t.u8()?;
                            raw.push(if vel == 0 {
                                Raw::Off { tick, ch, pitch }
                            } else {
                                Raw::On {
                                    tick,
                                    ch,
                                    pitch,
                                    vel,
                                }
                            });
                        }
                        0xA0 | 0xB0 | 0xE0 => {
                            t.bytes(2)?;
                        }
                        0xC0 | 0xD0 => {
                            t.u8()?;
                        }
                        _ => return Err(format!("unexpected status byte {b:#x}")),
                    }
                }
            }
        }
    }

    let tick_of = |e: &Raw| match e {
        Raw::On { tick, .. } | Raw::Off { tick, .. } | Raw::Tempo { tick, .. } => *tick,
    };
    // Stable sort keeps note-offs before note-ons at the same tick within a track.
    raw.sort_by_key(tick_of);

    let mut notes = Vec::new();
    let mut open: Vec<(u8, u8, f64, u8)> = Vec::new();
    let (mut last_tick, mut last_s, mut us_per_q) = (0u64, 0.0f64, 500_000.0f64);
    for e in &raw {
        let tick = tick_of(e);
        last_s += (tick - last_tick) as f64 / ppq * us_per_q / 1e6;
        last_tick = tick;
        match *e {
            Raw::Tempo { us_per_quarter, .. } => us_per_q = us_per_quarter.max(1) as f64,
            Raw::On { ch, pitch, vel, .. } => open.push((ch, pitch, last_s, vel)),
            Raw::Off { ch, pitch, .. } => {
                if let Some(i) = open.iter().position(|o| o.0 == ch && o.1 == pitch) {
                    let (ch, pitch, start, vel) = open.remove(i);
                    notes.push(MidiNote {
                        onset_s: start,
                        duration_s: last_s - start,
                        pitch,
                        velocity: vel,
                        channel: ch,
                    });
                }
            }
        }
    }
    for (ch, pitch, start, vel) in open {
        notes.push(MidiNote {
            onset_s: start,
            duration_s: (last_s - start).max(0.0),
            pitch,
            velocity: vel,
            channel: ch,
        });
    }
    notes.sort_by(|a, b| a.onset_s.total_cmp(&b.onset_s).then(a.pitch.cmp(&b.pitch)));
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_tiny_file() {
        // Format 0, 1 track, 96 PPQ; tempo 120 bpm; C4 for one quarter, then E4 (running status).
        let track: Vec<u8> = vec![
            0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20, // tempo 500000
            0x00, 0x90, 60, 100, // C4 on
            0x60, 0x80, 60, 0, // C4 off after 96 ticks
            0x00, 0x90, 64, 90, // E4 on
            0x60, 64, 0, // running status: E4 velocity 0 = off
            0x00, 0xFF, 0x2F, 0x00,
        ];
        let mut f = b"MThd".to_vec();
        f.extend_from_slice(&6u32.to_be_bytes());
        f.extend_from_slice(&[0, 0, 0, 1, 0, 96]);
        f.extend_from_slice(b"MTrk");
        f.extend_from_slice(&(track.len() as u32).to_be_bytes());
        f.extend_from_slice(&track);
        let notes = parse_smf(&f).unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].pitch, 60);
        assert!((notes[0].duration_s - 0.5).abs() < 1e-9);
        assert!((notes[1].onset_s - 0.5).abs() < 1e-9);
        assert_eq!(notes[1].velocity, 90);
    }
}

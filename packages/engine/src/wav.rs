//! Minimal WAV reader and writer for the evaluation tools.

/// Decoded mono audio.
#[derive(Clone, Debug)]
pub struct Audio {
    pub sample_rate: f32,
    pub samples: Vec<f32>,
}

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

/// Reads a PCM (16/24/32-bit) or IEEE-float (32-bit) WAV file and mixes it down to mono.
pub fn read_wav(bytes: &[u8]) -> Result<Audio, String> {
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("not a RIFF/WAVE file".into());
    }
    let mut pos = 12;
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32_at(bytes, pos + 4).ok_or("truncated chunk header")? as usize;
        let body_start = pos + 8;
        let body_end = (body_start + size).min(bytes.len());
        let body = &bytes[body_start..body_end];
        match id {
            b"fmt " => {
                let mut format = u16_at(body, 0).ok_or("short fmt chunk")?;
                let channels = u16_at(body, 2).ok_or("short fmt chunk")?;
                let rate = u32_at(body, 4).ok_or("short fmt chunk")?;
                let bits = u16_at(body, 14).ok_or("short fmt chunk")?;
                if format == 0xFFFE {
                    // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the GUID.
                    format = u16_at(body, 24).ok_or("short extensible fmt chunk")?;
                }
                fmt = Some((format, channels, rate, bits));
            }
            b"data" => data = Some(body),
            _ => {}
        }
        pos = body_start + size + (size & 1);
    }
    let (format, channels, rate, bits) = fmt.ok_or("missing fmt chunk")?;
    let data = data.ok_or("missing data chunk")?;
    if channels == 0 {
        return Err("zero channels".into());
    }
    let bytes_per = (bits / 8) as usize;
    let frame = bytes_per * channels as usize;
    if frame == 0 {
        return Err("invalid sample size".into());
    }
    let decode = |s: &[u8]| -> Result<f32, String> {
        Ok(match (format, bits) {
            (1, 16) => i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0,
            (1, 24) => {
                let v = i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8;
                v as f32 / 8_388_608.0
            }
            (1, 32) => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2_147_483_648.0,
            (3, 32) => f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
            _ => return Err(format!("unsupported WAV format {format} with {bits} bits")),
        })
    };
    let mut samples = Vec::with_capacity(data.len() / frame);
    for f in data.chunks_exact(frame) {
        let mut sum = 0.0;
        for c in 0..channels as usize {
            sum += decode(&f[c * bytes_per..(c + 1) * bytes_per])?;
        }
        samples.push(sum / channels as f32);
    }
    Ok(Audio {
        sample_rate: rate as f32,
        samples,
    })
}

/// Encodes mono samples as a 16-bit PCM WAV file.
pub fn write_wav_16(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut out = Vec::with_capacity(44 + data_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_16_bit() {
        let samples: Vec<f32> = (0..100).map(|i| (i as f32 / 50.0) - 1.0).collect();
        let bytes = write_wav_16(&samples, 44100);
        let audio = read_wav(&bytes).unwrap();
        assert_eq!(audio.sample_rate, 44100.0);
        assert_eq!(audio.samples.len(), 100);
        for (a, b) in audio.samples.iter().zip(&samples) {
            assert!((a - b).abs() < 1e-4);
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(read_wav(b"not a wav file at all").is_err());
    }
}

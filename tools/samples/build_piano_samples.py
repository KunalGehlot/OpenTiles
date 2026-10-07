#!/usr/bin/env python3
"""Builds the web app's piano samples from the Salamander Grand Piano V3 release. CC0 1.0.

Takes one velocity layer of the original 44.1 kHz / 16-bit release (Alexander Holm, CC BY 3.0),
one sample every minor third from A0 to C8, and writes short mono MP3s that every browser
(Safari included) can decode with Web Audio. See docs/adr/0007-piano-samples.md for why.

Usage:
  build_piano_samples.py SOURCE OUT_DIR

SOURCE is either the release archive SalamanderGrandPianoV3_44.1khz16bit.tar.bz2 (its SHA-1 is
checked) or the directory it extracts to. Download the archive from
https://archive.org/details/SalamanderGrandPianoV3. Needs ffmpeg with libmp3lame on PATH.
Standard library only.
"""

from __future__ import annotations

import argparse
import array
import hashlib
import math
import operator
import re
import shutil
import statistics
import subprocess
import sys
import tarfile
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

ARCHIVE_SHA1 = "ec5a179a1218a590d2f88728f56b583e79876896"
WAV_DIR = "SalamanderGrandPianoV3_44.1khz16bit/44.1khz16bit"

# Layer 10 of 16 covers MIDI velocities 73-80 in the release's .sfz: the middle of what the
# practice session plays (70 for accompaniment, 80 for playback, 90 for touch).
LAYER = 10
FIRST_PITCH = 21  # A0
LAST_PITCH = 108  # C8
STEP = 3  # a minor third, as the release is sampled

# Longer notes are faded out: a piano note rarely needs more than this in practice, and every
# second costs download size and decoded memory on iPad.
MAX_SECONDS = 8.0
LONG_FADE = 2.0
SHORT_FADE = 0.25
PRE_ROLL = 0.003  # kept before the onset so the hammer attack is intact
ONSET_RATIO = 0.01  # onset = first sample at 1% of the attack peak
# Within one layer, neighbouring samples differ in loudness by up to 9 dB (middle C is the
# loudest), which makes a scale sound uneven. Each sample is moved towards the median loudness
# of itself and two neighbours on each side, measured over its first LOUDNESS_SECONDS.
LOUDNESS_SECONDS = 0.5
SMOOTH_RADIUS = 2
MAX_CORRECTION_DB = 6.0
PEAK_DBFS = -1.0  # the loudest sample after correction is normalised to this
VBR_QUALITY = "2"  # LAME -V2

NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
RELEASE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MIX = "pan=mono|c0=0.5*c0+0.5*c1"


@dataclass
class Plan:
    pitch: int
    src: Path
    rate: int
    start: int
    length: int
    truncated: bool
    peak: int
    loudness: float
    correction: float = 0.0


def pitch_name(pitch: int, names: list[str]) -> str:
    return f"{names[pitch % 12]}{pitch // 12 - 1}"


def pitches() -> list[int]:
    return list(range(FIRST_PITCH, LAST_PITCH + 1, STEP))


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract(archive: Path, into: Path) -> Path:
    digest = sha1(archive)
    if digest != ARCHIVE_SHA1:
        sys.exit(f"{archive}: SHA-1 {digest} does not match the release ({ARCHIVE_SHA1})")
    wanted = {f"{WAV_DIR}/{pitch_name(p, RELEASE_NAMES)}v{LAYER}.wav" for p in pitches()}
    with tarfile.open(archive, "r:bz2") as tar:
        members = [m for m in tar.getmembers() if m.name in wanted and m.isfile()]
        tar.extractall(into, members=members, filter="data")
    return into


def mono(path: Path) -> tuple[int, array.array]:
    """Returns the sample rate and the mid (L+R)/2 signal as 16-bit integers."""
    with wave.open(str(path)) as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 2:
            sys.exit(f"{path}: expected 16-bit stereo")
        rate = w.getframerate()
        frames = array.array("h", w.readframes(w.getnframes()))
    if sys.byteorder != "little":
        frames.byteswap()
    mid = array.array("h", (s // 2 for s in map(operator.add, frames[0::2], frames[1::2])))
    return rate, mid


def onset(signal: array.array, rate: int) -> int:
    head = signal[: int(rate * 0.5)]
    peak = max(map(abs, head))
    limit = peak * ONSET_RATIO
    for i, s in enumerate(head):
        if abs(s) >= limit:
            return i
    return 0


def loudness(src: Path, start: int, rate: int) -> float:
    """EBU R128 integrated loudness (LUFS) of the attack, measured by ffmpeg."""
    end = start + int(LOUDNESS_SECONDS * rate)
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(src)]
        + ["-af", f"{MIX},atrim=start_sample={start}:end_sample={end},ebur128"]
        + ["-f", "null", "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    summary = result.stderr.split("Summary:")[-1]
    match = re.search(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", summary)
    if not match:
        sys.exit(f"{src}: could not measure loudness")
    return float(match.group(1))


def smooth(plans: list[Plan]) -> None:
    levels = [p.loudness for p in plans]
    for i, p in enumerate(plans):
        window = levels[max(0, i - SMOOTH_RADIUS) : i + SMOOTH_RADIUS + 1]
        target = statistics.median(window)
        p.correction = max(-MAX_CORRECTION_DB, min(MAX_CORRECTION_DB, target - p.loudness))


def plan(pitch: int, root: Path) -> Plan:
    src = root / WAV_DIR / f"{pitch_name(pitch, RELEASE_NAMES)}v{LAYER}.wav"
    rate, signal = mono(src)
    start = max(0, onset(signal, rate) - int(PRE_ROLL * rate))
    length = min(len(signal) - start, int(MAX_SECONDS * rate))
    return Plan(
        pitch=pitch,
        src=src,
        rate=rate,
        start=start,
        length=length,
        truncated=len(signal) - start > length,
        peak=max(map(abs, signal[start : start + length])),
        loudness=loudness(src, start, rate),
    )


def encode(p: Plan, gain_db: float, dest: Path) -> None:
    fade = LONG_FADE if p.truncated else SHORT_FADE
    seconds = p.length / p.rate
    filters = ",".join(
        [
            MIX,
            f"atrim=start_sample={p.start}:end_sample={p.start + p.length}",
            "asetpts=PTS-STARTPTS",
            f"volume={gain_db + p.correction:.3f}dB",
            f"afade=t=out:st={seconds - fade:.4f}:d={fade}:curve=exp",
        ]
    )
    title = f"Salamander Grand Piano V3, {pitch_name(p.pitch, RELEASE_NAMES)} layer {LAYER}"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(p.src)]
        + ["-af", filters, "-c:a", "libmp3lame", "-q:a", VBR_QUALITY]
        + ["-map_metadata", "-1", "-id3v2_version", "3"]
        + ["-metadata", f"title={title}", "-metadata", "artist=Alexander Holm"]
        + ["-metadata", "copyright=CC BY 3.0 https://creativecommons.org/licenses/by/3.0/"]
        + [str(dest)],
        check=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("source", type=Path)
    ap.add_argument("out", type=Path)
    args = ap.parse_args()
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is not on PATH")

    with tempfile.TemporaryDirectory() as tmp:
        root = extract(args.source, Path(tmp)) if args.source.is_file() else args.source
        plans = [plan(p, root) for p in pitches()]
        smooth(plans)
        loudest = max(p.peak * 10 ** (p.correction / 20) for p in plans)
        gain_db = PEAK_DBFS - 20 * math.log10(loudest / 32768)
        print(f"overall gain {gain_db:+.2f} dB")

        args.out.mkdir(parents=True, exist_ok=True)
        sums = []
        for p in plans:
            name = f"{pitch_name(p.pitch, NAMES)}.mp3"
            dest = args.out / name
            encode(p, gain_db, dest)
            sums.append(f"{sha256(dest)}  {name}")
            print(
                f"{name:8} {p.length / p.rate:4.1f} s  {p.loudness:6.1f} LUFS  "
                f"{p.correction:+5.1f} dB  {dest.stat().st_size // 1024:3d} KiB"
            )
        (args.out / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

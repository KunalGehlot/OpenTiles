#!/usr/bin/env python3
"""Turn a typeset piano MIDI file into an `arrange.py` text arrangement. CC0 1.0.

Contributors use this for public-domain piano pieces typeset by someone else under a public-domain
or CC0 dedication (for example Mutopia Project files), where the MIDI is an exact rendering of the
typeset notes. The output is a *simplified* arrangement in the compact notation of arrange.py:

- one voice per hand: notes that start together become a chord, a note lasts until the next
  onset in its hand (a held note under moving notes is cut off), and a time that does not fit
  w, h, q, e, s (with dots) becomes the longest fitting note followed by a rest;
- notes are snapped to a sixteenth-note grid; a file with triplets or finer rhythms is refused,
  unless `--fine` is given: then the grid is 1/24 of a beat, which holds thirty-seconds and
  triplets (written as arrange.py's `t` and `s3`/`e3`/`q3` values);
- a chromatic note is spelled by where the melody goes next: sharp going up, flat going down;
- a note that crosses a barline is cut at the barline (arrange.py cannot write ties).

The result is meant to be read and corrected by a person before it is committed; keep the
`arrangement.txt` header comment honest about where the notes came from.

Usage: midi_arrange.py piece.mid --title "..." --composer "..." --tempo 90 [--hands auto] > arrangement.txt
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from fractions import Fraction

GRID = 4  # grid steps per quarter note: sixteenths
FINE_GRID = 24  # with --fine: thirty-seconds (3 steps) and triplet sixteenths (4 steps)
NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
# Step values in grid units, largest first, with the arrange.py letter and dot.
VALUES = [(16, "w", ""), (12, "h", "."), (8, "h", ""), (6, "q", "."), (4, "q", ""), (3, "e", "."), (2, "e", ""), (1, "s", "")]
# The same in 1/24 beats, with thirty-seconds and triplets ("q3" is one note of a quarter triplet).
FINE_VALUES = [
    (96, "w", ""),
    (72, "h", "."),
    (48, "h", ""),
    (36, "q", "."),
    (24, "q", ""),
    (18, "e", "."),
    (16, "q3", ""),
    (12, "e", ""),
    (9, "s", "."),
    (8, "e3", ""),
    (6, "s", ""),
    (4, "s3", ""),
    (3, "t", ""),
    (2, "t3", ""),
]


class MidiError(ValueError):
    pass


@dataclass
class RawNote:
    start: int  # ticks
    end: int
    pitch: int
    track: int


@dataclass
class MidiData:
    ppq: int
    notes: list[RawNote] = field(default_factory=list)
    tempos: list[tuple[int, float]] = field(default_factory=list)  # (tick, bpm)
    time_signature: tuple[int, int] = (4, 4)
    key_fifths: int = 0


def _vlq(data: bytes, pos: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if pos >= len(data):
            raise MidiError("truncated variable-length number")
        b = data[pos]
        pos += 1
        value = (value << 7) | (b & 0x7F)
        if not b & 0x80:
            return value, pos
    raise MidiError("variable-length number too long")


def parse_midi(data: bytes) -> MidiData:
    """Reads a format 0 or 1 standard MIDI file."""
    if len(data) < 14 or data[:4] != b"MThd":
        raise MidiError("not a MIDI file")
    ntracks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if division & 0x8000:
        raise MidiError("SMPTE time division is not supported")
    out = MidiData(ppq=division)
    pos = 8 + int.from_bytes(data[4:8], "big")
    seen_time_sig = False
    for index in range(ntracks):
        if data[pos : pos + 4] != b"MTrk":
            raise MidiError("missing track header")
        length = int.from_bytes(data[pos + 4 : pos + 8], "big")
        body = data[pos + 8 : pos + 8 + length]
        pos += 8 + length
        tick = 0
        i = 0
        status = 0
        open_notes: dict[tuple[int, int], int] = {}
        while i < len(body):
            delta, i = _vlq(body, i)
            tick += delta
            if i >= len(body):
                break
            b = body[i]
            if b == 0xFF:
                kind = body[i + 1]
                size, j = _vlq(body, i + 2)
                payload = body[j : j + size]
                i = j + size
                if kind == 0x51 and size == 3:
                    micros = int.from_bytes(payload, "big")
                    if micros > 0:
                        out.tempos.append((tick, 60_000_000 / micros))
                elif kind == 0x58 and size >= 2 and not seen_time_sig:
                    out.time_signature = (payload[0], 1 << payload[1])
                    seen_time_sig = True
                elif kind == 0x59 and size == 2 and tick == 0:
                    f = payload[0] - 256 if payload[0] > 127 else payload[0]
                    out.key_fifths = f
                continue
            if b in (0xF0, 0xF7):
                size, j = _vlq(body, i + 1)
                i = j + size
                continue
            if b & 0x80:
                status = b
                i += 1
            kind, channel = status & 0xF0, status & 0x0F
            if kind in (0xC0, 0xD0):
                i += 1
                continue
            if i + 1 >= len(body) + 0 and kind not in (0xC0, 0xD0):
                break
            d1, d2 = body[i], body[i + 1]
            i += 2
            if kind == 0x90 and d2 > 0:
                open_notes[(channel, d1)] = tick
            elif kind == 0x80 or (kind == 0x90 and d2 == 0):
                start = open_notes.pop((channel, d1), None)
                if start is not None and channel != 9 and tick > start:
                    out.notes.append(RawNote(start, tick, d1, index))
    if not out.notes:
        raise MidiError("the file has no notes")
    return out


def spell(pitch: int, fifths: int, direction: int = 0) -> str:
    """A note name like C4, F#4 or Bb3, spelled for the key signature.

    A note outside the key follows the melody: sharp when the next note is higher (a leading tone,
    F# to G in G minor), flat when it is lower (Ab to G in C major); otherwise the key's side.
    """
    pc = pitch % 12
    tonic = (fifths * 7) % 12
    in_key = {(tonic + s) % 12 for s in MAJOR_SCALE}
    names = NAMES_FLAT if fifths < 0 else NAMES_SHARP
    if pc not in in_key and direction:
        names = NAMES_SHARP if direction > 0 else NAMES_FLAT
    octave = pitch // 12 - 1
    return f"{names[pc]}{octave}"


def duration_tokens(steps: int, grid: int = GRID) -> list[tuple[int, str, str]]:
    """Splits a length (in grid steps) into (steps, letter, dot) values, longest first."""
    out: list[tuple[int, str, str]] = []
    left = steps
    for size, letter, dot in FINE_VALUES if grid == FINE_GRID else VALUES:
        while left >= size and (left - size != 1 or grid != FINE_GRID):
            out.append((size, letter, dot))
            left -= size
    if left:
        # A length no note value can write (one 1/24 step) would silently shorten the bar.
        raise MidiError(f"a length of {steps} grid steps cannot be written as note values")
    return out


@dataclass
class Hand:
    chords: list[tuple[int, list[int]]]  # (start step, pitches), sorted


def snap(tick: int, ppq: int, grid: int = GRID) -> int:
    return round(tick * grid / ppq)


def off_grid(tick: int, ppq: int, tolerance: float = 0.12, grid: int = GRID) -> bool:
    exact = tick * grid / ppq
    return abs(exact - round(exact)) > tolerance


def drop_ornaments(notes: list[RawNote], ppq: int, grid: int = GRID) -> tuple[list[RawNote], int]:
    """Removes grace notes: off-grid notes shorter than one grid step take no time of their own."""
    def ornament(n: RawNote) -> bool:
        length = (n.end - n.start) * grid / ppq
        if grid == FINE_GRID:
            # Sixty-fourths and shorter are graces on the fine grid, wherever they start.
            return length < 1.5
        return off_grid(n.start, ppq, grid=grid) and length < 0.75

    kept = [n for n in notes if not ornament(n)]
    return kept, len(notes) - len(kept)


def check_grid(notes: list[RawNote], ppq: int, allowed: float = 0.01, grid: int = GRID) -> None:
    """Refuses rhythms that do not sit on a sixteenth grid (triplets, rubato).

    Only onsets matter: a note lasts until the next onset, so a shortened end (staccato, a slur's
    gap) does not change the result. A few stray onsets (under 1 %) are snapped to the grid.
    """
    bad = [n for n in notes if off_grid(n.start, ppq, grid=grid)]
    if len(bad) > max(1, allowed * len(notes)):
        raise MidiError(
            f"rhythm is not on a sixteenth-note grid ({len(bad)} of {len(notes)} onsets); "
            "triplets and finer rhythms are not supported"
        )


def split_hands(notes: list[RawNote], mode: str) -> tuple[list[RawNote], list[RawNote]]:
    """Right-hand and left-hand notes. `auto`: two note tracks → by mean pitch; else a pitch split."""
    tracks = sorted({n.track for n in notes})
    if mode == "auto" and len(tracks) == 2:
        means = {t: sum(n.pitch for n in notes if n.track == t) / max(1, sum(1 for n in notes if n.track == t)) for t in tracks}
        low = min(tracks, key=lambda t: means[t])
        return [n for n in notes if n.track != low], [n for n in notes if n.track == low]
    if mode in ("auto", "pitch"):
        return [n for n in notes if n.pitch >= 60], [n for n in notes if n.pitch < 60]
    if mode == "single":
        return notes, []
    raise MidiError(f"unknown hands mode {mode!r}")


def hand_chords(notes: list[RawNote], ppq: int, grid: int = GRID) -> list[tuple[int, int, list[int]]]:
    """Groups notes that start together: (start, end, pitches) in grid steps, end cut at the next onset."""
    by_start: dict[int, list[RawNote]] = {}
    for n in notes:
        by_start.setdefault(snap(n.start, ppq, grid), []).append(n)
    starts = sorted(by_start)
    out: list[tuple[int, int, list[int]]] = []
    for k, s in enumerate(starts):
        group = by_start[s]
        end = max(snap(n.end, ppq, grid) for n in group)
        if k + 1 < len(starts):
            end = min(end, starts[k + 1])
            # On the fine grid a one-step gap (a staccato note) cannot be written as a rest.
            if grid == FINE_GRID and starts[k + 1] - end < 2:
                end = starts[k + 1]
        if end <= s:
            end = s + 1
        out.append((s, end, sorted({n.pitch for n in group})))
    return out


def bar_steps(numerator: int, denominator: int, grid: int = GRID) -> int:
    return int(Fraction(numerator * 4 * grid, denominator))


def render_hand(
    chords: list[tuple[int, int, list[int]]],
    bar: int,
    total_steps: int,
    first_bar: int,
    fifths: int,
    grid: int = GRID,
) -> list[str]:
    """One text string per bar of `<value tokens>` for the hand."""
    # Bar boundaries: the first (maybe short) bar, then full bars.
    bounds = [0]
    pos = first_bar
    while pos < total_steps:
        bounds.append(pos)
        pos += bar
    bounds.append(total_steps)
    bars: list[str] = []
    ci = 0
    for b in range(len(bounds) - 1):
        lo, hi = bounds[b], bounds[b + 1]
        tokens: list[str] = []
        cursor = lo

        def rest(upto: int) -> None:
            nonlocal cursor
            for _, letter, dot in duration_tokens(upto - cursor, grid):
                tokens.append(f"r{letter}{dot}")
            cursor = upto

        while ci < len(chords) and chords[ci][0] < hi:
            s, e, pitches = chords[ci]
            ci += 1
            if s < cursor:
                continue
            rest(s)
            e = min(e, hi)
            if grid == FINE_GRID and 0 < hi - e < 2:
                e = hi
            parts = duration_tokens(e - s, grid)
            if not parts:
                continue
            used, letter, dot = parts[0]
            # A single note outside the key is spelled by the direction of the next note.
            direction = 0
            if len(pitches) == 1 and ci < len(chords):
                nxt = chords[ci][2][-1]
                direction = (nxt > pitches[0]) - (nxt < pitches[0])
            names = [spell(p, fifths, direction if len(pitches) == 1 else 0) for p in pitches]
            name = names[0] if len(names) == 1 else "[" + " ".join(names) + "]"
            tokens.append(f"{name}{letter}{dot}")
            cursor = s + used
            # The remainder of the slot (a length that is not one note value) is a rest.
            if e > cursor:
                rest(e)
        rest(hi)
        bars.append(" ".join(tokens))
    return bars


def build(
    midi: MidiData,
    title: str,
    composer: str,
    tempo: float | None,
    hands: str = "auto",
    comments: list[str] | None = None,
    bars_per_line: int = 4,
    pickup: int = 0,
    fine: bool = False,
) -> str:
    """The arrangement text. `pickup` is in sixteenths; `fine` allows thirty-seconds and triplets."""
    grid = FINE_GRID if fine else GRID
    pickup = pickup * grid // GRID
    midi_notes, _ = drop_ornaments(midi.notes, midi.ppq, grid)
    if not fine:
        # Grace notes sit just before their main note, off any grid, and may be left out. Short notes
        # exactly on the fine grid are real thirty-seconds or triplets: dropping them thins the music
        # (Bach's Invention 14 lost 23 % of its notes this way), so ask for --fine instead.
        kept = {id(n) for n in midi_notes}
        real = [
            n
            for n in midi.notes
            if id(n) not in kept and not off_grid(n.start, midi.ppq, grid=FINE_GRID)
        ]
        if len(real) > max(2, 0.02 * len(midi.notes)):
            raise MidiError(
                f"{len(real)} of {len(midi.notes)} notes are thirty-seconds or triplets; use --fine"
            )
    check_grid(midi_notes, midi.ppq, grid=grid)
    midi = MidiData(midi.ppq, midi_notes, midi.tempos, midi.time_signature, midi.key_fifths)
    num, den = midi.time_signature
    bar = bar_steps(num, den, grid)
    if bar <= 0:
        raise MidiError("bad time signature")
    rh_notes, lh_notes = split_hands(midi.notes, hands)
    rh = hand_chords(rh_notes, midi.ppq, grid)
    lh = hand_chords(lh_notes, midi.ppq, grid)
    total = max(c[1] for c in rh + lh)
    # A pickup (an incomplete first bar) cannot be told from the notes alone: a file may end on a
    # short final note. The caller says how long it is, from the typesetting source (LilyPond's
    # \\partial); `0` means the first bar is a full one and a short last bar is padded with rests.
    first = pickup if 0 < pickup < bar else bar
    body = max(0, total - first)
    total = first + -(-body // bar) * bar if body else first
    lines: list[str] = []
    for c in comments or []:
        lines.append(f"# {c}")
    lines += [
        f"title: {title}",
        f"composer: {composer}",
        f"key: {midi.key_fifths}",
        f"time: {num}/{den}",
        f"tempo: {int(round(tempo if tempo else (midi.tempos[0][1] if midi.tempos else 100)))}",
    ]
    if 0 < pickup < bar:
        lines.append("pickup: yes")
    for label, chords in (("RH", rh), ("LH", lh)):
        if not chords:
            continue
        bars = render_hand(chords, bar, total, first, midi.key_fifths, grid)
        for i in range(0, len(bars), bars_per_line):
            lines.append(f"{label}: " + " | ".join(bars[i : i + bars_per_line]))
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("midi")
    ap.add_argument("--title", required=True)
    ap.add_argument("--composer", required=True)
    ap.add_argument("--tempo", type=float, default=None, help="quarter notes per minute (default: the file's)")
    ap.add_argument("--pickup", type=int, default=0, help="length of an incomplete first bar, in sixteenths (LilyPond \\\\partial 8 = 2)")
    ap.add_argument("--hands", default="auto", choices=["auto", "pitch", "single"])
    ap.add_argument("--fine", action="store_true", help="allow thirty-seconds and triplets")
    ap.add_argument("--comment", action="append", default=[], help="header comment line (repeatable)")
    args = ap.parse_args(argv)
    with open(args.midi, "rb") as f:
        data = f.read()
    try:
        text = build(
            parse_midi(data),
            args.title,
            args.composer,
            args.tempo,
            args.hands,
            args.comment,
            pickup=args.pickup,
            fine=args.fine,
        )
    except MidiError as e:
        print(f"midi_arrange: {e}", file=sys.stderr)
        return 1
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

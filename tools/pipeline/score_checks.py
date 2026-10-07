"""Musical sanity checks on catalogue scores (spec §9, step 4). CC0 1.0.

The web app's `Song` round trip (packages/song-model, catalogue.test.ts) proves a score parses
and plays. These checks catch files that parse but are musically broken, in plain Python so
the catalogue CI and the PDMX pipeline can run them without Node:

- both hands have notes, unless the provenance record declares a single-hand piece;
- every pitch lies on the piano, A0 (MIDI 21) to C8 (MIDI 108);
- every note and rest that is not a grace note has a positive duration;
- every bar is as long as its time signature says. Only the first bar (an upbeat), the last
  bar and bars marked implicit="yes" may be shorter; no bar may be longer.

Hands follow the same rules as the song-model parser: on a grand staff the upper staff is the
right hand; separate single-staff parts are split by average pitch; otherwise a bass clef means
the left hand.
"""

from __future__ import annotations

import io
import posixpath
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

LOWEST, HIGHEST = 21, 108  # A0 and C8
STEP_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def load_score(path: Path) -> ET.Element:
    """Root of a partwise MusicXML file, plain (.musicxml/.xml) or compressed (.mxl)."""
    if path.suffix.lower() == ".mxl":
        with zipfile.ZipFile(path) as z:
            container = ET.fromstring(z.read("META-INF/container.xml"))
            rootfile = next((el.get("full-path") for el in container.iter() if el.tag.endswith("rootfile")), None)
            if not rootfile:
                raise ValueError("the .mxl has no rootfile in META-INF/container.xml")
            data = z.read(posixpath.normpath(rootfile))
        root = ET.parse(io.BytesIO(data)).getroot()
    else:
        root = ET.parse(path).getroot()
    if root.tag != "score-partwise":
        raise ValueError(f"root element is <{root.tag}>, expected <score-partwise>")
    return root


def midi_pitch(pitch: ET.Element) -> int:
    step = (pitch.findtext("step") or "").strip()
    if step not in STEP_SEMITONES:
        raise ValueError(f"unknown pitch step {step!r}")
    alter = Fraction((pitch.findtext("alter") or "0").strip())
    octave = int((pitch.findtext("octave") or "").strip())
    return 12 * (octave + 1) + STEP_SEMITONES[step] + round(alter)


def _time_signature(time: ET.Element) -> Fraction | None:
    if time.find("senza-misura") is not None:
        return None
    total = Fraction(0)
    for beats_el, type_el in zip(time.findall("beats"), time.findall("beat-type")):
        beats = sum(Fraction(b) for b in (beats_el.text or "0").split("+"))
        total += beats * 4 / Fraction(type_el.text or "4")
    return total or None


@dataclass
class PartNotes:
    staves: int = 1
    clefs: dict[int, str] = field(default_factory=dict)
    notes: list[tuple[int, int]] = field(default_factory=list)  # (staff, midi pitch)


def check_score(root: ET.Element, single_hand: str | None = None) -> list[str]:
    """Problems with a parsed partwise score; empty when it is fine."""
    errors: list[str] = []
    parts: list[PartNotes] = []
    for part_index, part in enumerate(root.findall("part"), start=1):
        info = PartNotes()
        parts.append(info)
        label = f"part {part_index}, " if len(root.findall("part")) > 1 else ""
        divisions = Fraction(1)
        bar: Fraction | None = Fraction(4)
        measures = part.findall("measure")
        for index, measure in enumerate(measures):
            number = measure.get("number", str(index + 1))
            where = f"{label}bar {number}"
            pos = longest = Fraction(0)
            for el in measure:
                if el.tag == "attributes":
                    if el.findtext("divisions"):
                        divisions = Fraction(el.findtext("divisions").strip())
                        if divisions <= 0:
                            errors.append(f"{where}: divisions must be positive")
                            divisions = Fraction(1)
                    staves = el.findtext("staves")
                    if staves:
                        info.staves = max(info.staves, int(staves))
                    for clef in el.findall("clef"):
                        staff = int(clef.get("number", "1"))
                        info.clefs.setdefault(staff, (clef.findtext("sign") or "").strip())
                    time = el.find("time")
                    if time is not None:
                        bar = _time_signature(time)
                elif el.tag in ("backup", "forward"):
                    dur = Fraction(el.findtext("duration") or "0") / divisions
                    pos = pos - dur if el.tag == "backup" else pos + dur
                    if pos < 0:
                        errors.append(f"{where}: <backup> goes before the start of the bar")
                        pos = Fraction(0)
                    longest = max(longest, pos)
                elif el.tag == "note":
                    grace = el.find("grace") is not None
                    chord = el.find("chord") is not None
                    pitch = el.find("pitch")
                    if pitch is not None:
                        try:
                            midi = midi_pitch(pitch)
                        except ValueError as e:
                            errors.append(f"{where}: {e}")
                        else:
                            if not LOWEST <= midi <= HIGHEST:
                                errors.append(f"{where}: pitch {midi} is off the piano (A0–C8 is 21–108)")
                            if el.find("cue") is None:
                                info.notes.append((int(el.findtext("staff") or "1"), midi))
                    if grace:
                        continue
                    raw = el.findtext("duration")
                    dur = Fraction(raw.strip()) / divisions if raw and raw.strip() else Fraction(0)
                    if dur <= 0:
                        errors.append(f"{where}: a note or rest has no positive duration")
                        continue
                    if chord:
                        # A chord note shares the previous note's start; it does not move on.
                        longest = max(longest, pos)
                        continue
                    pos += dur
                    longest = max(longest, pos)
            if bar is None:
                continue
            short_allowed = index == 0 or index == len(measures) - 1 or measure.get("implicit") == "yes"
            if longest > bar:
                errors.append(f"{where}: {_beats(longest)} beats in a bar of {_beats(bar)}")
            elif longest < bar and not short_allowed:
                errors.append(f"{where}: only {_beats(longest)} of {_beats(bar)} beats")
            elif longest == 0:
                errors.append(f"{where}: the bar is empty")

    hands = _hands(parts)
    for hand in ("right", "left"):
        if single_hand and hand != single_hand:
            if hands[hand]:
                errors.append(f"marked single_hand '{single_hand}' but the {hand} hand has notes")
            continue
        if not hands[hand]:
            errors.append(
                f"the {hand} hand has no notes; add them or set single_hand in provenance.json"
            )
    return errors


def _beats(value: Fraction) -> str:
    return str(value.numerator) if value.denominator == 1 else f"{float(value):g}"


def _hands(parts: list[PartNotes]) -> dict[str, int]:
    counts = {"right": 0, "left": 0}
    single_staff_parts = len(parts) >= 2 and all(p.staves < 2 for p in parts)
    left_part = -1
    if single_staff_parts:
        lowest = float("inf")
        for i, p in enumerate(parts):
            if p.notes:
                avg = sum(n for _, n in p.notes) / len(p.notes)
                if avg < lowest:
                    lowest, left_part = avg, i
    for i, p in enumerate(parts):
        for staff, _pitch in p.notes:
            if p.staves >= 2:
                hand = "left" if staff >= 2 else "right"
            elif single_staff_parts:
                hand = "left" if i == left_part else "right"
            else:
                hand = "left" if p.clefs.get(staff) == "F" else "right"
            counts[hand] += 1
    return counts


def check_file(path: Path, single_hand: str | None = None) -> list[str]:
    try:
        root = load_score(path)
    except (ET.ParseError, ValueError, KeyError, zipfile.BadZipFile, OSError) as e:
        return [f"score is not valid partwise MusicXML: {e}"]
    return check_score(root, single_hand)

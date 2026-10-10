#!/usr/bin/env python3
"""Turn a compact text arrangement into two-staff piano MusicXML.

Contributors use this to write simple CC0 arrangements of public-domain tunes (spec §9,
"Project contributors"). Released under CC0 1.0 like the rest of tools/pipeline.

Format (one header per line, then one line per bar for each hand):

    title: Ode to Joy (theme)
    composer: Ludwig van Beethoven
    key: 0            # fifths: -7..7
    time: 4/4
    tempo: 100        # quarter notes per minute
    pickup: no        # yes: the first bar is an incomplete upbeat
    RH: E4q E4q F4q G4q | G4q F4q E4q D4q
    LH: C3w | G2w

Notes are <pitch><value>: pitch like C4, F#4, Bb3, a chord in brackets like [C4 E4 G4], or r
for a rest; value is w h q e s t (whole … thirty-second), optionally a triplet with '3' (e3 is
one note of an eighth-note triplet, s3 of a sixteenth-note triplet), optionally dotted with '.',
and optionally a fingering like @3. Bars are separated by '|'. RH and LH may span several lines; they are
joined in order.

Usage: arrange.py arrangement.txt > score.musicxml
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from fractions import Fraction
from xml.sax.saxutils import escape

DIVISIONS = 12  # per quarter: sixteenths, triplets and dots; thirty-seconds raise it to 24
VALUES = {
    "w": Fraction(4),
    "h": Fraction(2),
    "q": Fraction(1),
    "e": Fraction(1, 2),
    "s": Fraction(1, 4),
    "t": Fraction(1, 8),
}
TYPES = {"w": "whole", "h": "half", "q": "quarter", "e": "eighth", "s": "16th", "t": "32nd"}
STEPS = "CDEFGAB"
TOKEN = re.compile(r"^(?P<pitch>\[[^\]]+\]|r|[A-Ga-g](?:#|b)?-?\d)(?P<value>[whqest])(?P<triplet>3?)(?P<dot>\.?)(?:@(?P<finger>[1-5]))?$")
PITCH = re.compile(r"^([A-Ga-g])(#|b)?(-?\d)$")


@dataclass
class Event:
    pitches: list[tuple[str, int, int]]  # (step, alter, octave); empty for a rest
    value: str
    dotted: bool
    finger: int | None = None
    triplet: bool = False

    @property
    def beats(self) -> Fraction:
        base = VALUES[self.value]
        if self.dotted:
            base *= Fraction(3, 2)
        return base * Fraction(2, 3) if self.triplet else base


@dataclass
class Arrangement:
    headers: dict[str, str] = field(default_factory=dict)
    rh: list[list[Event]] = field(default_factory=list)
    lh: list[list[Event]] = field(default_factory=list)


class ArrangementError(ValueError):
    pass


def parse_pitch(text: str) -> tuple[str, int, int]:
    m = PITCH.match(text)
    if not m:
        raise ArrangementError(f"bad pitch {text!r}")
    step, acc, octave = m.groups()
    return step.upper(), {"#": 1, "b": -1}.get(acc or "", 0), int(octave)


def parse_bar(text: str) -> list[Event]:
    # Keep chords together when splitting on whitespace.
    tokens = re.findall(r"\[[^\]]*\][^\s]*|\S+", text)
    events = []
    for tok in tokens:
        m = TOKEN.match(tok)
        if not m:
            raise ArrangementError(f"cannot read {tok!r}")
        raw = m.group("pitch")
        if raw == "r":
            pitches = []
        elif raw.startswith("["):
            pitches = [parse_pitch(p) for p in raw[1:-1].split()]
        else:
            pitches = [parse_pitch(raw)]
        finger = int(m.group("finger")) if m.group("finger") else None
        events.append(
            Event(pitches, m.group("value"), m.group("dot") == ".", finger, m.group("triplet") == "3")
        )
    return events


def parse(text: str) -> Arrangement:
    arr = Arrangement()
    hands: dict[str, list[str]] = {"RH": [], "LH": []}
    for raw in text.splitlines():
        # Comments start with '#' at the line start or ' # ' (a sharp like F#4 is never spaced).
        line = re.sub(r"(^|\s)#(\s.*)?$", "", raw).strip()
        if not line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        if key in hands:
            hands[key].append(value)
        else:
            arr.headers[key.lower()] = value.strip()
    arr.rh = [parse_bar(b) for b in "|".join(hands["RH"]).split("|") if b.strip()]
    arr.lh = [parse_bar(b) for b in "|".join(hands["LH"]).split("|") if b.strip()]
    if len(arr.rh) != len(arr.lh):
        raise ArrangementError(f"RH has {len(arr.rh)} bars but LH has {len(arr.lh)}")
    return arr


def bar_length(arr: Arrangement) -> Fraction:
    num, den = (int(x) for x in arr.headers.get("time", "4/4").split("/"))
    return Fraction(num * 4, den)


def divisions_for(arr: Arrangement) -> int:
    """Divisions per quarter: 12, or a multiple of it when a note needs finer steps (thirty-seconds)."""
    d = DIVISIONS
    for bar in arr.rh + arr.lh:
        for ev in bar:
            while (ev.beats * d).denominator != 1:
                d *= 2
    return d


def note_xml(ev: Event, staff: int, voice: int, divisions: int = DIVISIONS) -> str:
    dur = int(ev.beats * divisions)
    dot = "<dot/>" if ev.dotted else ""
    tuplet = (
        "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
        if ev.triplet
        else ""
    )
    kind = f"<type>{TYPES[ev.value]}</type>{dot}{tuplet}"
    tail = f"<voice>{voice}</voice>{kind}<staff>{staff}</staff>"
    if not ev.pitches:
        return f"<note><rest/><duration>{dur}</duration>{tail}</note>"
    out = []
    for i, (step, alter, octave) in enumerate(ev.pitches):
        chord = "<chord/>" if i > 0 else ""
        alt = f"<alter>{alter}</alter>" if alter else ""
        finger = (
            f"<notations><technical><fingering>{ev.finger}</fingering></technical></notations>"
            if ev.finger and i == 0
            else ""
        )
        out.append(
            f"<note>{chord}<pitch><step>{step}</step>{alt}<octave>{octave}</octave></pitch>"
            f"<duration>{dur}</duration>{tail}{finger}</note>"
        )
    return "".join(out)


def to_musicxml(arr: Arrangement) -> str:
    h = arr.headers
    full = bar_length(arr)
    pickup = h.get("pickup", "no").lower() in ("yes", "true", "1")
    num, den = h.get("time", "4/4").split("/")
    divisions = divisions_for(arr)
    measures = []
    for i, (rh, lh) in enumerate(zip(arr.rh, arr.lh)):
        rh_len = sum((e.beats for e in rh), Fraction(0))
        lh_len = sum((e.beats for e in lh), Fraction(0))
        is_pickup = pickup and i == 0
        if is_pickup:
            if rh_len != lh_len or rh_len >= full:
                raise ArrangementError(f"pickup bar: RH {rh_len} and LH {lh_len} beats must match and be < {full}")
        elif rh_len != full or lh_len != full:
            raise ArrangementError(f"bar {i + 1}: RH has {rh_len} beats, LH {lh_len}, expected {full}")
        number = "0" if pickup and i == 0 else str(i if pickup else i + 1)
        parts = []
        if i == 0:
            parts.append(
                f"<attributes><divisions>{divisions}</divisions>"
                f"<key><fifths>{int(h.get('key', '0'))}</fifths><mode>major</mode></key>"
                f"<time><beats>{num}</beats><beat-type>{den}</beat-type></time><staves>2</staves>"
                "<clef number=\"1\"><sign>G</sign><line>2</line></clef>"
                "<clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes>"
            )
            bpm = h.get("tempo")
            if bpm:
                parts.append(
                    "<direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit>"
                    f"<per-minute>{int(bpm)}</per-minute></metronome></direction-type>"
                    f"<sound tempo=\"{int(bpm)}\"/></direction>"
                )
        parts.extend(note_xml(e, 1, 1, divisions) for e in rh)
        parts.append(f"<backup><duration>{int(rh_len * divisions)}</duration></backup>")
        parts.extend(note_xml(e, 2, 5, divisions) for e in lh)
        implicit = ' implicit="yes"' if is_pickup else ""
        measures.append(f'<measure number="{number}"{implicit}>{"".join(parts)}</measure>')
    if measures:
        measures[-1] = measures[-1].replace(
            "</measure>", '<barline location="right"><bar-style>light-heavy</bar-style></barline></measure>'
        )
    title = escape(h.get("title", "Untitled"))
    composer = escape(h.get("composer", ""))
    arranger = escape(h.get("arranger", "OpenTiles contributors"))
    rights = "CC0 1.0: no rights reserved"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n'
        f'<score-partwise version="4.0"><work><work-title>{title}</work-title></work>'
        f'<identification><creator type="composer">{composer}</creator>'
        f'<creator type="arranger">{arranger}</creator><rights>{rights}</rights>'
        "<encoding><software>OpenTiles arrange.py</software></encoding></identification>"
        '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        f'<part id="P1">{"".join(measures)}</part></score-partwise>\n'
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        try:
            sys.stdout.write(to_musicxml(parse(f.read())))
        except ArrangementError as e:
            print(f"{argv[1]}: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

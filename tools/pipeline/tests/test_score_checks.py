"""Musical sanity checks on scores (spec §9 step 4). Fixtures are built in code."""

from __future__ import annotations

import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import arrange  # noqa: E402
from score_checks import check_file, check_score, load_score, midi_pitch  # noqa: E402


def from_arrangement(text: str) -> ET.Element:
    return ET.fromstring(arrange.to_musicxml(arrange.parse(text)).split("\n", 2)[2])


def note(step: str, octave: int, duration: int, staff: int = 1, extra: str = "") -> str:
    return (
        f"<note>{extra}<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
        f"<duration>{duration}</duration><staff>{staff}</staff></note>"
    )


def score(*measures: str, parts: int = 1, staves: int = 2, time: str = "4/4") -> ET.Element:
    beats, beat_type = time.split("/")
    attrs = (
        f"<attributes><divisions>1</divisions><time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>"
        f"<staves>{staves}</staves><clef number=\"1\"><sign>G</sign></clef><clef number=\"2\"><sign>F</sign></clef></attributes>"
    )
    body = "".join(
        f'<measure number="{i + 1}">{attrs if i == 0 else ""}{m}</measure>' for i, m in enumerate(measures)
    )
    part_xml = "".join(f'<part id="P{p + 1}">{body}</part>' for p in range(parts))
    return ET.fromstring(f"<score-partwise>{part_xml}</score-partwise>")


BOTH = note("C", 4, 4) + "<backup><duration>4</duration></backup>" + note("C", 3, 4, staff=2)


class GoodScoresTest(unittest.TestCase):
    def test_arranged_score_passes(self):
        root = from_arrangement(
            "time: 3/4\npickup: yes\nRH: G4q | C5q E5q G5q | [C5 E5]h.\nLH: rq | C3h. | C3h.\n"
        )
        self.assertEqual(check_score(root), [])

    def test_compound_time_and_chords(self):
        root = from_arrangement("time: 6/8\nRH: [C4 E4 G4]q. D4e E4e F4e\nLH: C3h.\n")
        self.assertEqual(check_score(root), [])

    def test_grace_notes_take_no_time(self):
        grace = note("D", 4, 0, extra="<grace/>").replace("<duration>0</duration>", "")
        self.assertEqual(check_score(score(grace + BOTH)), [])

    def test_additive_time_signature(self):
        bar = note("C", 4, 5) + "<backup><duration>5</duration></backup>" + note("C", 3, 5, staff=2)
        root = score(bar, time="3+2/4")
        self.assertEqual(check_score(root), [])

    def test_two_single_staff_parts_split_by_pitch(self):
        high = note("C", 5, 4)
        low = note("C", 2, 4)
        root = ET.fromstring(
            "<score-partwise>"
            f'<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>{high}</measure></part>'
            f'<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes>{low}</measure></part>'
            "</score-partwise>"
        )
        self.assertEqual(check_score(root), [])

    def test_midi_pitch(self):
        p = ET.fromstring("<pitch><step>A</step><octave>0</octave></pitch>")
        self.assertEqual(midi_pitch(p), 21)
        p = ET.fromstring("<pitch><step>B</step><alter>1</alter><octave>7</octave></pitch>")
        self.assertEqual(midi_pitch(p), 108)


class BadScoresTest(unittest.TestCase):
    def test_missing_left_hand(self):
        errors = check_score(score(note("C", 4, 4)))
        self.assertEqual(len(errors), 1)
        self.assertIn("left hand has no notes", errors[0])

    def test_single_hand_declared(self):
        self.assertEqual(check_score(score(note("C", 4, 4)), single_hand="right"), [])
        errors = check_score(score(BOTH), single_hand="right")
        self.assertIn("left hand has notes", errors[0])

    def test_off_the_piano(self):
        high = note("D", 8, 4) + "<backup><duration>4</duration></backup>" + note("C", 3, 4, staff=2)
        errors = check_score(score(high))
        self.assertTrue(any("off the piano" in e for e in errors))
        low = note("C", 4, 4) + "<backup><duration>4</duration></backup>" + note("G", 0, 4, staff=2)
        self.assertTrue(any("off the piano" in e for e in check_score(score(low))))

    def test_zero_duration(self):
        bad = note("C", 4, 0) + note("C", 4, 4) + "<backup><duration>4</duration></backup>" + note("C", 3, 4, staff=2)
        errors = check_score(score(bad))
        self.assertTrue(any("no positive duration" in e for e in errors))

    def test_overfull_bar(self):
        bar = note("C", 4, 5) + "<backup><duration>5</duration></backup>" + note("C", 3, 4, staff=2)
        errors = check_score(score(bar))
        self.assertEqual(errors, ["bar 1: 5 beats in a bar of 4"])

    def test_short_bar_only_at_the_ends(self):
        short = note("C", 4, 2) + "<backup><duration>2</duration></backup>" + note("C", 3, 2, staff=2)
        # First (upbeat) and last bars may be short ...
        self.assertEqual(check_score(score(short, BOTH, short)), [])
        # ... a bar in the middle may not.
        self.assertEqual(check_score(score(BOTH, short, BOTH)), ["bar 2: only 2 of 4 beats"])
        implicit = score(BOTH, short, BOTH)
        implicit.find("part/measure[2]").set("implicit", "yes")
        self.assertEqual(check_score(implicit), [])

    def test_time_signature_change(self):
        three = note("C", 4, 3) + "<backup><duration>3</duration></backup>" + note("C", 3, 3, staff=2)
        root = score(BOTH, BOTH, BOTH)
        # Bar 2 switches to 3/4 but still holds four beats: overfull.
        m2 = root.find("part/measure[2]")
        m2.insert(0, ET.fromstring("<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>"))
        self.assertIn("bar 2: 4 beats in a bar of 3", check_score(root))
        root = score(BOTH, three, three)
        root.find("part/measure[2]").insert(
            0, ET.fromstring("<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>")
        )
        self.assertEqual(check_score(root), [])

    def test_backup_before_bar_start(self):
        bar = BOTH + "<backup><duration>9</duration></backup>"
        self.assertTrue(any("before the start" in e for e in check_score(score(bar))))


class FileTest(unittest.TestCase):
    def test_reads_mxl_and_rejects_garbage(self):
        xml = arrange.to_musicxml(arrange.parse("RH: C4w\nLH: C3w\n"))
        with tempfile.TemporaryDirectory() as tmp:
            mxl = Path(tmp) / "score.mxl"
            with zipfile.ZipFile(mxl, "w") as z:
                z.writestr(
                    "META-INF/container.xml",
                    '<container><rootfiles><rootfile full-path="music/score.musicxml"/></rootfiles></container>',
                )
                z.writestr("music/score.musicxml", xml)
            self.assertEqual(load_score(mxl).tag, "score-partwise")
            self.assertEqual(check_file(mxl), [])
            bad = Path(tmp) / "bad.musicxml"
            bad.write_text("<score-timewise/>", encoding="utf-8")
            self.assertIn("partwise", check_file(bad)[0])
            broken = Path(tmp) / "broken.mxl"
            broken.write_bytes(b"not a zip")
            self.assertIn("not valid", check_file(broken)[0])


if __name__ == "__main__":
    unittest.main()

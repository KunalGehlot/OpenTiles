"""Tests for the catalogue pipeline. Run: python3 -m unittest discover -s tools/pipeline/tests"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import arrange  # noqa: E402
from catalogue_lib import Piece, validate_piece  # noqa: E402
from eu_term import is_free, latest_free_death_year  # noqa: E402

GOOD = {
    "title": "Test Piece",
    "composer": "Erik Satie",
    "composer_death_year": 1925,
    "traditional": False,
    "transcriber": "someone",
    "arranger": None,
    "source_url": "https://example.org/piece",
    "source_licence": "CC0-1.0",
    "edition_note": "Own transcription.",
    "eu_term_check": {"result": "pass", "date": "2026-10-07"},
    "difficulty": 2,
    "reviewed_by": None,
    "verified": False,
    "score_file": "score.musicxml",
}

ARRANGEMENT = """title: Test
composer: Nobody
time: 2/4
tempo: 90
RH: C4q E4q | [C4 E4 G4]h
LH: C3h | rh
"""


class EuTermTest(unittest.TestCase):
    def test_boundary(self):
        self.assertEqual(latest_free_death_year(2026), 1955)
        self.assertTrue(is_free(1955, 2026))
        self.assertFalse(is_free(1956, 2026))

    def test_traditional_and_unknown(self):
        self.assertTrue(is_free(None, 2026, traditional=True))
        self.assertFalse(is_free(None, 2026))


class ArrangeTest(unittest.TestCase):
    def test_renders_two_staves_with_chords_and_rests(self):
        xml = arrange.to_musicxml(arrange.parse(ARRANGEMENT))
        self.assertIn("<staves>2</staves>", xml)
        self.assertEqual(xml.count("<chord/>"), 2)
        self.assertIn("<rest/>", xml)
        self.assertIn('<sound tempo="90"/>', xml)

    def test_rejects_wrong_bar_lengths(self):
        with self.assertRaises(arrange.ArrangementError):
            arrange.to_musicxml(arrange.parse("time: 4/4\nRH: C4q\nLH: C3w\n"))

    def test_sharps_are_not_comments(self):
        bars = arrange.parse("RH: F#4q G4q # a comment\nLH: rh\n").rh
        self.assertEqual(bars[0][0].pitches, [("F", 1, 4)])
        self.assertEqual(len(bars[0]), 2)


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "test-piece"
        self.dir.mkdir()
        (self.dir / "score.musicxml").write_text(
            arrange.to_musicxml(arrange.parse(ARRANGEMENT)), encoding="utf-8"
        )

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, record, slug="test-piece"):
        return validate_piece(Piece(slug, self.dir, record), 2026)

    def test_good_record(self):
        self.assertEqual(self.check(copy.deepcopy(GOOD)), [])

    def test_missing_field(self):
        r = copy.deepcopy(GOOD)
        del r["source_url"]
        self.assertIn("missing field 'source_url'", self.check(r))

    def test_composer_inside_eu_term(self):
        r = copy.deepcopy(GOOD)
        r["composer_death_year"] = 1960
        self.assertTrue(any("1955 or earlier" in e for e in self.check(r)))

    def test_lyricist_inside_eu_term(self):
        r = copy.deepcopy(GOOD)
        r["lyricist"] = "Someone"
        r["lyricist_death_year"] = 1990
        self.assertTrue(any("lyricist" in e for e in self.check(r)))

    def test_verified_needs_reviewer(self):
        r = copy.deepcopy(GOOD)
        r["verified"] = True
        self.assertTrue(any("reviewed_by" in e for e in self.check(r)))

    def test_licence_and_attribution(self):
        r = copy.deepcopy(GOOD)
        r["source_licence"] = "CC-BY-NC-4.0"
        self.assertTrue(any("licence" in e for e in self.check(r)))
        r["source_licence"] = "CC-BY-4.0"
        self.assertTrue(any("attribution" in e for e in self.check(r)))

    def test_bad_score_and_slug(self):
        (self.dir / "score.musicxml").write_text("<html/>", encoding="utf-8")
        errors = self.check(copy.deepcopy(GOOD), slug="Bad Slug")
        self.assertTrue(any("partwise" in e for e in errors))
        self.assertTrue(any("folder name" in e for e in errors))

    def test_real_catalogue_is_valid(self):
        from catalogue_lib import load_pieces

        for piece in load_pieces():
            self.assertEqual(validate_piece(piece, 2026), [], piece.slug)


if __name__ == "__main__":
    unittest.main()

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
from catalogue_lib import Piece, index_entry, validate_piece, validate_songs  # noqa: E402
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
        errors = self.check(r)
        self.assertTrue(any("reviewed_by" in e for e in errors))
        self.assertTrue(any("reviewed_on" in e for e in errors))
        r.update(reviewed_by="someone", reviewed_on="2026-10-08")
        self.assertEqual(self.check(r), [])
        r["reviewed_on"] = "2026-02-30"
        self.assertTrue(any("reviewed_on" in e for e in self.check(r)))

    def test_reviewer_without_verification(self):
        r = copy.deepcopy(GOOD)
        r["reviewed_by"] = "someone"
        self.assertTrue(any("verified is false" in e for e in self.check(r)))

    def test_optional_fields(self):
        r = copy.deepcopy(GOOD)
        r.update(composer_wikidata="Q23441", lyricist=None, lyricist_death_year=None)
        self.assertEqual(self.check(r), [])
        r["composer_wikidata"] = "Satie"
        self.assertTrue(any("Wikidata item ID" in e for e in self.check(r)))
        r = copy.deepcopy(GOOD)
        r["colour"] = "blue"
        self.assertIn("unknown field 'colour' (see catalogue/schema/provenance.schema.json)", self.check(r))
        r = copy.deepcopy(GOOD)
        r["single_hand"] = "both"
        self.assertTrue(any("single_hand" in e for e in self.check(r)))

    def test_edition_evidence(self):
        r = copy.deepcopy(GOOD)
        r["edition_note"] = "A nice score."
        self.assertTrue(any("own transcription" in e for e in self.check(r)))
        r["edition_note"] = "Own transcription of the Bärenreiter Urtext."
        self.assertTrue(any("Urtext" in e for e in self.check(r)))

    def test_score_sanity_is_checked(self):
        (self.dir / "score.musicxml").write_text(
            arrange.to_musicxml(arrange.parse("time: 2/4\nRH: C4q E4q | G4h\nLH: rh | rh\n")), encoding="utf-8"
        )
        errors = self.check(copy.deepcopy(GOOD))
        self.assertTrue(any("left hand has no notes" in e for e in errors))
        r = copy.deepcopy(GOOD)
        r["single_hand"] = "right"
        self.assertEqual(self.check(r), [])

    def test_bad_term_check_date(self):
        r = copy.deepcopy(GOOD)
        r["eu_term_check"] = {"result": "pass", "date": "07/10/2026"}
        self.assertTrue(any("YYYY-MM-DD" in e for e in self.check(r)))

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


class SongLevelsTest(unittest.TestCase):
    def piece(self, slug, **extra):
        record = {**copy.deepcopy(GOOD), **extra}
        return Piece(slug, Path("."), record)

    def test_levels_of_one_song_must_agree_on_the_rights(self):
        a = self.piece("a", song="s", variant="Melody")
        b = self.piece("b", song="s", variant="Full", composer_death_year=1900)
        errors = validate_songs([a, b])
        self.assertEqual(len(errors), 1)
        self.assertIn("composer_death_year", errors[0])

    def test_variant_labels_are_unique_within_a_song(self):
        a = self.piece("a", song="s", variant="Melody")
        b = self.piece("b", song="s", variant="melody")
        self.assertIn("same variant label", " ".join(validate_songs([a, b])))

    def test_song_and_variant_go_together(self):
        errors = validate_piece(self.piece("a", song="s"), 2026)
        self.assertTrue(any("go together" in e for e in errors))

    def test_the_index_carries_song_and_variant(self):
        entry = index_entry(self.piece("a", song="s", variant="Melody"))
        self.assertEqual((entry["song"], entry["variant"]), ("s", "Melody"))
        self.assertNotIn("song", index_entry(self.piece("b")))

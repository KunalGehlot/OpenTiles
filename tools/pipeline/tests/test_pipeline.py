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
from build_index import composer_years  # noqa: E402
from wikidata import Cache  # noqa: E402

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

    def test_thirty_seconds_and_triplets(self):
        text = ARRANGEMENT.replace("RH: C4q E4q | [C4 E4 G4]h", "RH: C4t D4t E4t F4t G4e3 A4e3 B4e3 C5e | [C4 E4 G4]h")
        xml = arrange.to_musicxml(arrange.parse(text))
        self.assertIn("<divisions>24</divisions>", xml)
        self.assertIn("<type>32nd</type>", xml)
        self.assertEqual(xml.count("<time-modification>"), 3)
        # Pieces without thirty-seconds keep 12 divisions, so their scores do not change.
        self.assertIn("<divisions>12</divisions>", arrange.to_musicxml(arrange.parse(ARRANGEMENT)))

    def test_triplet_groups_are_marked(self):
        # Verovio draws and times a triplet only with <tuplet> start and stop marks (P2-04): one
        # group of three eighths, one of eighths and two sixteenths, and a group with a rest.
        text = "time: 2/4\nRH: C4e3 D4e3 E4e3 F4e3 G4s3 A4s3 B4e3 | re3 C5e3 [E4 G4]e3@2 C4q\nLH: C3h | C3h\n"
        events = arrange.parse(text).rh
        self.assertEqual(arrange.tuplet_marks(events[0]), ["start", None, "stop", "start", None, None, "stop"])
        self.assertEqual(arrange.tuplet_marks(events[1]), ["start", None, "stop", None])
        xml = arrange.to_musicxml(arrange.parse(text))
        self.assertEqual(xml.count('<tuplet type="start"/>'), 3)
        self.assertEqual(xml.count('<tuplet type="stop"/>'), 3)
        # A rest can start a group, and a chord's marks go on its first note with its fingering.
        rest = xml[xml.index("<note><rest/>") :]
        self.assertIn('<tuplet type="start"/>', rest[: rest.index("</note>")])
        self.assertIn(
            '<notations><tuplet type="stop"/><technical><fingering>2</fingering></technical></notations>',
            xml,
        )
        self.assertEqual(xml.count("<tuplet"), 6)

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

    def test_print_source_must_name_an_old_print(self):
        r = copy.deepcopy(GOOD)
        r.update(print_source="Collection Litolff, 19th Century")
        self.assertEqual(self.check(r), [])
        r.update(print_source="Breitkopf & Härtel, 1888", print_year=1888)
        self.assertEqual(self.check(r), [])
        # The print is recorded for the reviewer; an undated or recent one is refused.
        r.update(print_source="Edition Peters")
        r.pop("print_year")
        self.assertTrue(any("no year or century" in e for e in self.check(r)))
        r.update(print_source="Dover, 1989", print_year=1989)
        self.assertTrue(any("not before 1930" in e for e in self.check(r)))

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


class ComposerYearsTest(unittest.TestCase):
    """The Player's programme shows a composer's years, from the Wikidata cache (CC0)."""

    cache = Cache(
        path=None,
        names={"ludwig van beethoven": {"ids": ["Q255", "Q12368917"]}},
        entities={
            "Q255": {"birth_year": 1770, "death_year": 1827},
            "Q12368917": {"birth_year": 1712, "death_year": 1773},
            "Q1": {"birth_year": 1866, "death_year": 1925},
        },
    )

    def test_picks_the_namesake_whose_death_year_is_the_records(self):
        record = {"composer": "Ludwig van Beethoven", "composer_death_year": 1827}
        self.assertEqual(composer_years(record, self.cache), [1770, 1827])

    def test_an_item_named_in_the_record_wins(self):
        record = {"composer": "E. S.", "composer_death_year": 1925, "composer_wikidata": "Q1"}
        self.assertEqual(composer_years(record, self.cache), [1866, 1925])

    def test_nothing_when_unsure_or_traditional(self):
        self.assertIsNone(
            composer_years({"composer": "Ludwig van Beethoven", "composer_death_year": 1830}, self.cache)
        )
        self.assertIsNone(composer_years({"composer": "Nobody", "composer_death_year": 1900}, self.cache))
        self.assertIsNone(
            composer_years({"composer": "Traditional", "traditional": True, "composer_death_year": None}, self.cache)
        )

    def test_the_index_carries_them(self):
        piece = Piece(slug="a", path=Path("."), record=dict(GOOD))
        self.assertEqual(index_entry(piece, [1866, 1925])["composer_years"], [1866, 1925])
        self.assertNotIn("composer_years", index_entry(piece))


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

"""Wikidata death-year lookups, run offline against recorded API responses.

tests/fixtures/wikidata_responses.json holds real responses recorded on 2026-10-07, trimmed to
the claims the module reads (P31, P106, P569, P570). Wikidata content is CC0.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wikidata  # noqa: E402
from catalogue_lib import load_pieces  # noqa: E402

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "wikidata_responses.json").read_text(encoding="utf-8"))


class FakeFetcher:
    """Answers from the recorded responses and counts calls; unknown requests fail the test."""

    def __init__(self):
        self.calls: list[dict] = []
        self.entities: dict[str, dict] = {}
        for key, data in FIXTURES.items():
            if key.startswith("wbgetentities:"):
                self.entities.update(data["entities"])

    def __call__(self, params: dict) -> dict:
        self.calls.append(params)
        if params["action"] == "wbsearchentities":
            key = f"wbsearchentities:{params['search']}"
            if key not in FIXTURES:
                raise AssertionError(f"no recorded response for {key}")
            return copy.deepcopy(FIXTURES[key])
        if params["action"] == "wbgetentities":
            ids = params["ids"].split("|")
            return {
                "entities": {
                    i: copy.deepcopy(self.entities.get(i, {"id": i, "missing": ""})) for i in ids
                }
            }
        raise AssertionError(f"unexpected action {params['action']}")


def fresh(fetch=None) -> wikidata.Wikidata:
    return wikidata.Wikidata(wikidata.Cache(None), fetch, today="2026-10-07")


def time_claim(time: str, precision: int, rank: str = "normal") -> dict:
    return {
        "rank": rank,
        "mainsnak": {
            "snaktype": "value",
            "property": "P570",
            "datavalue": {"type": "time", "value": {"time": time, "precision": precision}},
        },
    }


class LookupTest(unittest.TestCase):
    def test_unique_composer(self):
        fetch = FakeFetcher()
        wd = fresh(fetch)
        m = wd.by_name("Johannes Brahms")
        self.assertEqual((m.status, m.qid, m.death_year), ("found", "Q7294", 1897))
        self.assertEqual(len(fetch.calls), 2)  # one search, one batch of entities
        # Statues, streets and articles named after him are not cached.
        self.assertEqual(list(wd.cache.entities), ["Q7294"])
        self.assertEqual(wd.cache.names["johannes brahms"]["ids"], ["Q7294"])

    def test_cache_answers_without_network(self):
        wd = fresh(FakeFetcher())
        wd.by_name("Johannes Brahms")
        offline = wikidata.Wikidata(wd.cache, None)
        self.assertEqual(offline.by_name("  johannes   BRAHMS ").death_year, 1897)
        self.assertEqual(offline.by_name("Clara Schumann").status, "not-cached")

    def test_ambiguous_names(self):
        wd = fresh(FakeFetcher())
        m = wd.by_name("John Williams")
        self.assertEqual(m.status, "ambiguous")
        # Only people with a musical or literary occupation are candidates.
        self.assertEqual(set(m.candidates), {"Q131285", "Q921945", "Q370293"})
        self.assertIsNone(m.latest_death_year)  # two of them are alive
        # Two composers called Franz Xaver Gruber: the Silent Night one must be pinned. Both died
        # in the 19th century, so a bulk term check can still pass the name.
        gruber = wd.by_name("Franz Xaver Gruber")
        self.assertEqual(gruber.status, "ambiguous")
        self.assertEqual(gruber.latest_death_year, 1871)

    def test_pinned_item_and_ranks(self):
        wd = fresh(FakeFetcher())
        m = wd.by_id("Q513185", "Franz Xaver Gruber")
        # Preferred 1863-06-07 wins over a normal 1863 and a deprecated 1863-06-06 statement.
        self.assertEqual((m.status, m.death_year, m.entity["death_precision"]), ("found", 1863, 11))

    def test_not_found(self):
        self.assertEqual(fresh(FakeFetcher()).by_name("Nobody Atall Xyzzy").status, "not-found")


class DistilTest(unittest.TestCase):
    def entity(self, *claims):
        return {"labels": {"en": {"value": "X"}}, "claims": {"P31": [], "P570": list(claims)}}

    def test_precision(self):
        year = lambda *c: wikidata.distil_entity(self.entity(*c), "d")["death_year"]  # noqa: E731
        self.assertEqual(year(time_claim("+1897-04-03T00:00:00Z", 11)), 1897)
        self.assertEqual(year(time_claim("+1890-00-00T00:00:00Z", 8)), 1899)  # 1890s: latest 1899
        self.assertEqual(year(time_claim("+1801-00-00T00:00:00Z", 7)), 1900)  # 19th century
        self.assertEqual(year(time_claim("+1900-00-00T00:00:00Z", 7)), 1900)
        self.assertIsNone(year(time_claim("+2000-00-00T00:00:00Z", 6)))  # millennium: too vague

    def test_conservative_choice(self):
        e = wikidata.distil_entity(
            self.entity(time_claim("+1700-01-01T00:00:00Z", 9), time_claim("+1702-01-01T00:00:00Z", 9)), "d"
        )
        self.assertEqual(e["death_year"], 1702)
        deprecated = wikidata.distil_entity(
            self.entity(time_claim("+1700-01-01T00:00:00Z", 9), time_claim("+1990-01-01T00:00:00Z", 9, "deprecated")),
            "d",
        )
        self.assertEqual(deprecated["death_year"], 1700)

    def test_unknown_value(self):
        some = {"rank": "normal", "mainsnak": {"snaktype": "somevalue", "property": "P570"}}
        e = wikidata.distil_entity(self.entity(some), "d")
        self.assertIsNone(e["death_year"])
        self.assertTrue(e["death_unknown"])


class CheckRecordTest(unittest.TestCase):
    def setUp(self):
        self.wd = fresh(FakeFetcher())

    def record(self, **kw):
        r = {"composer": "Johannes Brahms", "composer_death_year": 1897, "traditional": False}
        r.update(kw)
        return r

    def test_agreeing_year(self):
        self.assertEqual(wikidata.check_record(self.record(), self.wd), ([], []))

    def test_disagreeing_year(self):
        errors, _ = wikidata.check_record(self.record(composer_death_year=1898), self.wd)
        self.assertEqual(len(errors), 1)
        self.assertIn("Wikidata (Q7294) says 1897", errors[0])

    def test_ambiguous_is_a_note_until_pinned(self):
        r = self.record(composer="Franz Xaver Gruber", composer_death_year=1863)
        errors, notes = wikidata.check_record(r, self.wd)
        self.assertEqual(errors, [])
        self.assertIn("composer_wikidata", notes[0])
        r["composer_wikidata"] = "Q513185"
        self.assertEqual(wikidata.check_record(r, self.wd), ([], []))

    def test_living_creator_is_an_error(self):
        r = self.record(composer="Johannes Brahms", composer_wikidata="Q131285")
        errors, notes = wikidata.check_record(r, self.wd)
        self.assertIn("records no death", errors[0])
        # The pinned item is somebody else: the reviewer is told.
        self.assertIn("labelled 'John Williams'", notes[0])

    def test_traditional_skipped_and_lyricist_checked(self):
        r = {"composer": "Traditional", "composer_death_year": None, "traditional": True,
             "lyricist": "Johannes Brahms", "lyricist_death_year": 1896}
        errors, _ = wikidata.check_record(r, self.wd)
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("lyricist_death_year"))

    def test_offline_miss_is_a_note(self):
        offline = wikidata.Wikidata(wikidata.Cache(None), None)
        errors, notes = wikidata.check_record(self.record(), offline)
        self.assertEqual(errors, [])
        self.assertIn("not in the Wikidata cache", notes[0])


class CacheTest(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cache" / "wikidata.json"
            cache = wikidata.Cache(path)
            wd = wikidata.Wikidata(cache, FakeFetcher(), today="2026-10-07")
            wd.by_name("Johannes Brahms")
            cache.save()
            loaded = wikidata.Cache.load(path)
            self.assertEqual(loaded.entities["Q7294"]["death_year"], 1897)
            self.assertEqual(loaded.dumps(), path.read_text(encoding="utf-8"))

    def test_rejects_unknown_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "w.json"
            path.write_text('{"version": 99}', encoding="utf-8")
            with self.assertRaises(wikidata.WikidataError):
                wikidata.Cache.load(path)


class CommittedCacheTest(unittest.TestCase):
    def test_catalogue_matches_cache(self):
        """Every named creator in the catalogue is in the committed cache and agrees with it."""
        wd = wikidata.Wikidata(wikidata.Cache.load(), None)
        for piece in load_pieces():
            errors, notes = wikidata.check_record(piece.record, wd)
            self.assertEqual(errors, [], piece.slug)
            self.assertEqual(notes, [], piece.slug)


if __name__ == "__main__":
    unittest.main()

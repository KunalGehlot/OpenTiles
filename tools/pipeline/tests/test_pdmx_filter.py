"""PDMX metadata filter (spec §9 step 1). The fixture CSV is generated here with PDMX's real
column layout (PDMX.csv from https://zenodo.org/records/15571083) and made-up rows."""

from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pdmx_filter  # noqa: E402
import wikidata  # noqa: E402

# The header of PDMX.csv as published (version of 2025-06), in order.
PDMX_COLUMNS = (
    "path,metadata,mxl,pdf,mid,version,is_user_pro,is_user_publisher,is_user_staff,has_paywall,"
    "is_rated,is_official,is_original,is_draft,has_custom_audio,has_custom_video,n_comments,"
    "n_favorites,n_views,n_ratings,rating,license,license_url,license_conflict,genres,groups,tags,"
    "song_name,title,subtitle,artist_name,composer_name,publisher,complexity,n_tracks,tracks,"
    "song_length,song_length.seconds,song_length.bars,song_length.beats,n_notes,notes_per_bar,"
    "n_annotations,has_annotations,n_lyrics,has_lyrics,n_tokens,pitch_class_entropy,"
    "scale_consistency,groove_consistency,best_path,is_best_path,best_arrangement,"
    "is_best_arrangement,best_unique_arrangement,is_best_unique_arrangement,subset:all,"
    "subset:rated,subset:deduplicated,subset:rated_deduplicated,subset:no_license_conflict,"
    "subset:all_valid"
).split(",")

BASE = {c: "NA" for c in PDMX_COLUMNS}
BASE.update(
    {
        "version": "3.01",
        "is_user_pro": "False",
        "is_user_publisher": "False",
        "is_user_staff": "False",
        "has_paywall": "False",
        "is_rated": "True",
        "is_official": "False",
        "is_original": "False",
        "is_draft": "False",
        "n_ratings": "5",
        "rating": "4.6",
        "license": "cc-zero",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "license_conflict": "False",
        "genres": "classical",
        "composer_name": "Erik Satie",
        "artist_name": "Erik Satie",
        "complexity": "1",
        "n_tracks": "1",
        "tracks": "0",
        "song_length.seconds": "180.5",
        "song_length.bars": "78",
        "n_notes": "420",
        "notes_per_bar": "5.4",
        "pitch_class_entropy": "2.9",
        "has_lyrics": "False",
        "subset:all": "True",
        "subset:rated": "True",
        "subset:deduplicated": "True",
        "subset:no_license_conflict": "True",
        "subset:all_valid": "True",
    }
)


def make_row(name: str, **kw: str) -> dict:
    r = dict(BASE)
    r.update({"path": f"./data/{name}.json", "mxl": f"./mxl/{name}.mxl", "metadata": f"./metadata/{name}.json", "title": name})
    r.update(kw)
    return r


ROWS = [
    make_row("keep-solo"),
    make_row("keep-two-tracks", tracks="0-0", n_tracks="2", complexity="2"),
    make_row("keep-harpsichord", tracks="6"),
    make_row("conflict", license_conflict="True", **{"subset:no_license_conflict": "False"}),
    make_row("invalid-files", **{"subset:all_valid": "False"}),
    make_row("violin", tracks="40"),
    make_row("piano-and-voice", tracks="0-52", n_tracks="2"),
    make_row("three-pianos", tracks="0-0-0", n_tracks="3"),
    make_row("unrated", is_rated="False", n_ratings="0", rating="0.0"),
    make_row("low-rating", rating="3.5"),
    make_row("pd-mark", license="publicdomain", license_url="https://creativecommons.org/publicdomain/mark/1.0/"),
    make_row("urtext", tags="satie-henle-urtext"),
    make_row("scanned", subtitle="scanned with PhotoScore"),
    make_row("not-deduplicated", **{"subset:deduplicated": "False"}),
]


class FilterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = Path(self.tmp.name) / "PDMX.csv"
        with self.src.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=PDMX_COLUMNS)
            writer.writeheader()
            writer.writerows(ROWS)
        self.dest = Path(self.tmp.name) / "out" / "candidates.csv"

    def tearDown(self):
        self.tmp.cleanup()

    def run_filter(self, **opts) -> tuple[pdmx_filter.Report, list[dict]]:
        report = pdmx_filter.run(self.src, self.dest, pdmx_filter.Options(**opts))
        with self.dest.open(newline="", encoding="utf-8") as f:
            return report, list(csv.DictReader(f))

    def test_default_filters(self):
        report, rows = self.run_filter()
        titles = [r["title"] for r in rows]
        self.assertEqual(
            titles, ["keep-solo", "keep-two-tracks", "keep-harpsichord", "pd-mark", "not-deduplicated"]
        )
        self.assertEqual(
            report.counts,
            {
                "rows read": 14,
                "no_license_conflict": 13,
                "all files valid": 12,
                "piano only": 9,
                "rated >= 4 by >= 3": 7,
                "edition rules": 5,
            },
        )
        self.assertEqual(report.edition, {"keep": 4, "review": 1, "exclude": 2})
        self.assertEqual(report.complexity, {"1": 4, "2": 1})

    def test_output_columns(self):
        _, rows = self.run_filter()
        self.assertEqual(list(rows[0]), pdmx_filter.OUT_COLUMNS)
        first = rows[0]
        self.assertEqual(first["mxl"], "./mxl/keep-solo.mxl")
        self.assertEqual(first["composer_guess"], "Erik Satie")
        self.assertEqual((first["complexity"], first["notes_per_bar"]), ("1", "5.4"))
        pd = next(r for r in rows if r["title"] == "pd-mark")
        self.assertEqual(pd["edition_status"], "review")
        self.assertIn("not a CC0 dedication", pd["edition_reasons"])

    def test_options(self):
        _, rows = self.run_filter(strict_editions=True, deduplicated=True)
        self.assertEqual([r["title"] for r in rows], ["keep-solo", "keep-two-tracks", "keep-harpsichord"])
        _, rows = self.run_filter(programs=pdmx_filter.parse_programs("0-5"), max_tracks=1)
        self.assertEqual([r["title"] for r in rows], ["keep-solo", "pd-mark", "not-deduplicated"])
        _, rows = self.run_filter(min_rating=4.7)
        self.assertEqual(rows, [])

    def test_term_check_with_cache(self):
        cache = wikidata.Cache(None)
        cache.names["erik satie"] = {"ids": ["Q23441"], "fetched": "2026-10-07"}
        cache.entities["Q23441"] = {
            "label": "Erik Satie", "description": "", "aliases": [], "human": True,
            "occupations": ["Q36834"], "birth_year": 1866, "death_year": 1925,
            "death_precision": 11, "death_unknown": False, "fetched": "2026-10-07",
        }
        # Two people called "Johann Beispiel": both died long ago, so either way the work is free.
        for qid, died in (("Q1001", 1750), ("Q1002", 1802)):
            cache.entities[qid] = dict(cache.entities["Q23441"], label="Johann Beispiel", death_year=died)
        cache.names["johann beispiel"] = {"ids": ["Q1001", "Q1002"], "fetched": "2026-10-07"}
        cache.entities["Q1003"] = dict(cache.entities["Q23441"], label="Max Muster", death_year=None)
        cache.entities["Q1004"] = dict(cache.entities["Q23441"], label="Max Muster", death_year=1801)
        cache.names["max muster"] = {"ids": ["Q1003", "Q1004"], "fetched": "2026-10-07"}
        wd = wikidata.Wikidata(cache, None)
        rows = [
            {"composer_guess": "Erik Satie"},
            {"composer_guess": "Traditional"},
            {"composer_guess": ""},
            {"composer_guess": "Someone Else"},
            {"composer_guess": "Johann Beispiel"},
            {"composer_guess": "Max Muster"},
        ]
        out = list(pdmx_filter.add_term_check(rows, wd, 2026))
        self.assertEqual(
            [(r["eu_term"], r["composer_death_year"], r["wikidata_id"]) for r in out],
            [
                ("pass", "1925", "Q23441"),
                ("traditional", "", ""),
                ("unknown", "", ""),
                ("not-cached", "", ""),
                ("pass", "1802", "Q1001|Q1002"),
                ("ambiguous", "", ""),  # one candidate may still be alive
            ],
        )
        self.assertEqual(next(pdmx_filter.add_term_check([{"composer_guess": "Erik Satie"}], wd, 1990))["eu_term"], "fail")


class HelpersTest(unittest.TestCase):
    def test_parse_programs(self):
        self.assertEqual(pdmx_filter.parse_programs("0-3,6"), frozenset({0, 1, 2, 3, 6}))
        self.assertEqual(pdmx_filter.parse_programs("0"), frozenset({0}))

    def test_clean_composer(self):
        cases = {
            "Claude Debussy(1862-1918)": "Claude Debussy",
            "Domenico Scarlatti (1685-1757)": "Domenico Scarlatti",
            "Jean-Baptiste Duvernoy c. 1802 c. 1880": "Jean-Baptiste Duvernoy",
            "William Collissonarr. E Muirhead": "William Collisson",
            "Benjamin Carr": "Benjamin Carr",
            "Trad.": "Traditional",
            "Misc Traditional": "Traditional",
            "Misc tunes": "",
            "Composer": "",
            "Composed by Somebody Piano arrangement by Other": "Somebody",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(pdmx_filter.clean_composer({"composer_name": raw}), want)
        # Falls back to the artist field.
        self.assertEqual(pdmx_filter.clean_composer({"composer_name": "NA", "artist_name": "Erik Satie"}), "Erik Satie")

    def test_fix_mojibake(self):
        broken = "Dvořák".encode("utf-8").decode("latin-1")
        self.assertEqual(pdmx_filter.fix_mojibake(broken), "Dvořák")
        self.assertEqual(pdmx_filter.fix_mojibake("Frédéric Chopin"), "Frédéric Chopin")
        self.assertEqual(pdmx_filter.fix_mojibake("Ångström"), "Ångström")


if __name__ == "__main__":
    unittest.main()

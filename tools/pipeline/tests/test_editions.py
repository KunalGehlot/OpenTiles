"""Protected-edition rules (spec §9 step 3)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import editions  # noqa: E402

CLEAN = {
    "title": "Gymnopédie No. 1",
    "subtitle": "NA",
    "song_name": "Gymnopédie No. 1",
    "artist_name": "Erik Satie",
    "composer_name": "Erik Satie",
    "publisher": "NA",
    "tags": "satie-piano-gymnopedie",
    "groups": "NA",
    "license": "cc-zero",
    "is_user_publisher": "False",
    "is_official": "False",
}


def row(**kw):
    r = dict(CLEAN)
    r.update(kw)
    return r


class PdmxTest(unittest.TestCase):
    def test_clean_cc0_is_kept(self):
        self.assertEqual(editions.judge_pdmx(row()).status, "keep")

    def test_publisher_metadata_excludes(self):
        self.assertEqual(editions.judge_pdmx(row(publisher="Some Music House")).status, "exclude")
        self.assertEqual(editions.judge_pdmx(row(is_user_publisher="True")).status, "exclude")
        self.assertEqual(editions.judge_pdmx(row(is_official="True")).status, "exclude")

    def test_edition_and_scan_keywords_exclude(self):
        for text in [
            "Sonata (Henle Urtext)",
            "Nocturne - Bärenreiter",
            "from the Breitkopf & Härtel parts",
            "Edition Peters",
            "Neue Mozart-Ausgabe",
            "Erstausgabe 1830",
            "scanned with PhotoScore",
            "OMR import",
            "facsimile of the autograph",
        ]:
            with self.subTest(text=text):
                self.assertEqual(editions.judge_pdmx(row(subtitle=text)).status, "exclude")

    def test_tags_are_searched(self):
        self.assertEqual(editions.judge_pdmx(row(tags="bach-henleurtext-piano")).status, "exclude")

    def test_names_that_only_look_like_publishers(self):
        # A surname, a town and an Italian word are not publishers; "Comrade" is not OMR.
        for text in ["arr. Tamara Peters", "Henley Regatta March", "Ricordi d'infanzia", "Arr. Comrade Izzy"]:
            with self.subTest(text=text):
                self.assertNotEqual(editions.judge_pdmx(row(license="cc-zero", subtitle=text)).status, "exclude")

    def test_negated_mentions_are_ignored(self):
        v = editions.judge_pdmx(row(subtitle="my own transcription, not from the Henle Urtext"))
        self.assertEqual(v.status, "keep")
        # "No 3" is a number, not a negation.
        self.assertEqual(editions.judge_pdmx(row(title="Prelude No 3 Henle")).status, "exclude")

    def test_pd_mark_needs_review(self):
        v = editions.judge_pdmx(row(license="publicdomain"))
        self.assertEqual(v.status, "review")
        self.assertIn("not a CC0 dedication", v.reasons[0])
        v = editions.judge_pdmx(row(license="publicdomain", composer_name="Erik Satie arr. Someone"))
        self.assertTrue(any("arrangement" in r for r in v.reasons))

    def test_soft_signs_need_review(self):
        self.assertEqual(editions.judge_pdmx(row(subtitle="from IMSLP")).status, "review")
        self.assertEqual(editions.judge_pdmx(row(subtitle="edited by A. Person")).status, "review")


class ProvenanceTest(unittest.TestCase):
    def record(self, note, **kw):
        r = {"edition_note": note, "transcriber": "someone", "arranger": None, "source_url": "https://example.org/x"}
        r.update(kw)
        return r

    def test_catalogue_wording_passes(self):
        note = (
            "Original simplified arrangement written for OpenTiles from the public-domain melody; "
            "not copied from any published edition."
        )
        self.assertEqual(editions.check_provenance(self.record(note)), ([], []))
        self.assertEqual(editions.check_provenance(self.record("Own transcription from a 1890 print."))[0], [])

    def test_needs_own_work_evidence(self):
        errors, _ = editions.check_provenance(self.record("Nice score."))
        self.assertTrue(any("own transcription" in e for e in errors))

    def test_protected_edition_fails(self):
        errors, _ = editions.check_provenance(self.record("Own transcription of the Henle Urtext."))
        self.assertTrue(any("Urtext" in e or "henle" in e.lower() for e in errors))
        errors, _ = editions.check_provenance(self.record("Own transcription.", transcriber="Bärenreiter-Verlag"))
        self.assertTrue(errors)

    def test_soft_signs_become_notes(self):
        errors, notes = editions.check_provenance(self.record("Own typesetting from the IMSLP scan of a 1850 print."))
        # "scan" is a hard sign: copying a scan is not the transcriber's own work.
        self.assertTrue(errors)
        errors, notes = editions.check_provenance(self.record("Own typesetting, checked against IMSLP."))
        self.assertEqual(errors, [])
        self.assertTrue(any("IMSLP" in n for n in notes))


if __name__ == "__main__":
    unittest.main()

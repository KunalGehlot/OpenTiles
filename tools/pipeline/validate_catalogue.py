#!/usr/bin/env python3
"""Validates every catalogue piece's provenance and score (spec §9, §12). CC0 1.0.

Exit status 1 if any piece has a problem. Per piece it checks the provenance record and the EU
term (step 2), the edition evidence (step 3), the score's musical sanity (step 4: both hands,
piano range, positive durations, bar lengths) and, for pieces written with arrange.py, that
score.musicxml matches arrangement.txt. It compares death years with Wikidata through the
committed cache (catalogue/cache/wikidata.json) and checks catalogue/index.json is current.

Lines starting with "note:" do not fail the run; they tell the reviewer what to look at.

Usage: validate_catalogue.py [--release-year YEAR] [--wikidata cache|online|off]
"""

from __future__ import annotations

import argparse
import datetime
import sys

import arrange
import wikidata
from build_index import build_index, index_path
from catalogue_lib import load_pieces, review_notes, validate_piece, validate_songs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release-year", type=int, default=datetime.date.today().year)
    ap.add_argument(
        "--wikidata",
        choices=("cache", "online", "off"),
        default="cache",
        help="cache: compare with the committed cache only (default, used in CI); "
        "online: also look up names missing from the cache and save them; off: skip",
    )
    args = ap.parse_args(argv)

    wd = None
    if args.wikidata != "off":
        cache = wikidata.Cache.load()
        wd = wikidata.Wikidata(cache, wikidata.http_fetcher() if args.wikidata == "online" else None)

    pieces = load_pieces()
    failed = 0
    try:
        for piece in pieces:
            errors = validate_piece(piece, args.release_year)
            notes = review_notes(piece)
            source = piece.path / "arrangement.txt"
            score = piece.path / piece.record.get("score_file", "score.musicxml")
            if source.exists() and score.exists():
                try:
                    expected = arrange.to_musicxml(arrange.parse(source.read_text(encoding="utf-8")))
                    if score.read_text(encoding="utf-8") != expected:
                        errors.append("score.musicxml is out of date; regenerate it with arrange.py")
                except arrange.ArrangementError as e:
                    errors.append(f"arrangement.txt: {e}")
            if wd is not None and piece.record:
                try:
                    wd_errors, wd_notes = wikidata.check_record(piece.record, wd)
                except wikidata.WikidataError as e:
                    # Network trouble: say so and carry on with the cache alone.
                    print(f"Wikidata lookups stopped: {e}")
                    wd.fetch = None
                    wd_errors, wd_notes = wikidata.check_record(piece.record, wd)
                errors += wd_errors
                notes += wd_notes
            if errors:
                failed += 1
            for e in errors:
                print(f"{piece.slug}: {e}")
            for n in notes:
                print(f"{piece.slug}: note: {n}")
    finally:
        if wd is not None:
            wd.cache.save()
    for e in validate_songs(pieces):
        print(e)
        failed += 1
    current = index_path().read_text(encoding="utf-8") if index_path().exists() else ""
    if current != build_index(pieces):
        print("catalogue/index.json is out of date; run tools/pipeline/build_index.py")
        failed += 1
    verified = sum(1 for p in pieces if p.record.get("verified"))
    print(f"{len(pieces)} pieces checked, {verified} verified, {failed} with problems.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

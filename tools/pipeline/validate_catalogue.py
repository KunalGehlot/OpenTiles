#!/usr/bin/env python3
"""Validates every catalogue piece's provenance and score (spec §9, §12). CC0 1.0.

Exit status 1 if any piece has a problem. Also checks that catalogue/index.json is current and,
for pieces written with arrange.py, that score.musicxml matches arrangement.txt.

Usage: validate_catalogue.py [--release-year YEAR]
"""

from __future__ import annotations

import argparse
import datetime
import sys

import arrange
from build_index import build_index, index_path
from catalogue_lib import load_pieces, validate_piece


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--release-year", type=int, default=datetime.date.today().year)
    args = ap.parse_args()

    pieces = load_pieces()
    failed = 0
    for piece in pieces:
        errors = validate_piece(piece, args.release_year)
        source = piece.path / "arrangement.txt"
        score = piece.path / piece.record.get("score_file", "score.musicxml")
        if source.exists() and score.exists():
            try:
                expected = arrange.to_musicxml(arrange.parse(source.read_text(encoding="utf-8")))
                if score.read_text(encoding="utf-8") != expected:
                    errors.append("score.musicxml is out of date; regenerate it with arrange.py")
            except arrange.ArrangementError as e:
                errors.append(f"arrangement.txt: {e}")
        if errors:
            failed += 1
            for e in errors:
                print(f"{piece.slug}: {e}")
    current = index_path().read_text(encoding="utf-8") if index_path().exists() else ""
    if current != build_index(pieces):
        print("catalogue/index.json is out of date; run tools/pipeline/build_index.py")
        failed += 1
    verified = sum(1 for p in pieces if p.record.get("verified"))
    print(f"{len(pieces)} pieces checked, {verified} verified, {failed} with problems.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Writes catalogue/index.json from the pieces' provenance records. CC0 1.0.

The web app lists catalogue pieces from this file. Unverified pieces are included with
"verified": false; production builds show only verified ones (spec §2: the home page lists only
verified public-domain or CC0 scores).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from catalogue_lib import CATALOGUE, Piece, index_entry, load_pieces


def index_path() -> Path:
    return CATALOGUE / "index.json"


def build_index(pieces: list[Piece]) -> str:
    entries = [index_entry(p) for p in pieces if p.record]
    entries.sort(key=lambda e: (e["difficulty"], e["title"].lower()))
    return json.dumps({"version": 1, "pieces": entries}, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    index_path().write_text(build_index(load_pieces()), encoding="utf-8")
    print(f"wrote {index_path().relative_to(CATALOGUE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
